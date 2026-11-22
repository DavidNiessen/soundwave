/**
 * Accounts on a server: making one (as the server's mode allows), signing in, staying signed in,
 * invites, and what owners and moderators can do (docs/specs/online-play.md, 3.2).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Account, Invite, Role, Session, SignUp, UserEntry } from '../../src/net/protocol.ts';
import {
  ACCESS_TTL_MS,
  checkPassword,
  cleanName,
  hashPassword,
  passwordProblem,
  randomToken,
  REFRESH_TTL_MS,
  sha256,
  Signer,
  type AccessClaims,
} from './auth.ts';
import type { Config } from './config.ts';
import { FOREVER, type Store, type UserRow } from './db.ts';

/** A request that cannot be done, with the status to answer and a sentence for the player. */
export class Refusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const account = (u: UserRow): Account => ({ id: u.id, name: u.name, role: u.role });
const canModerate = (r: Role) => r === 'owner' || r === 'moderator';

/** The link an invite travels as: the server's own join page, which opens the game. */
export const inviteLink = (server: string, code: string) => `${server}/join?invite=${encodeURIComponent(code)}`;

export class Accounts {
  readonly signer: Signer;
  /** The code the owner signs up with, while the server has no owner (printed when it starts). */
  readonly ownerCode: string | undefined;
  /** Hashes a password that matches no account, so signing in as nobody takes as long as signing in. */
  private readonly decoy: Promise<string>;
  private readonly store: Store;
  private readonly config: Config;
  private readonly now: () => number;

  constructor(store: Store, config: Config, now: () => number = Date.now) {
    this.store = store;
    this.config = config;
    this.now = now;
    let secret = store.getMeta('secret');
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      store.setMeta('secret', secret);
    }
    this.signer = new Signer(Buffer.from(secret, 'base64url'));
    if (!store.hasOwner()) {
      let code = store.getMeta('owner-code');
      if (!code || !store.invite(code)) {
        code = randomToken(12);
        store.addInvite({ code, by: null, uses: 1, expires: null, role: 'owner', kind: 'invite', created: now() });
        store.setMeta('owner-code', code);
      }
      this.ownerCode = code;
    }
    this.decoy = hashPassword(randomToken());
  }

  /** Makes an account, if the server's mode lets this request make one, and signs it in. */
  async signUp(req: Partial<SignUp>): Promise<Session> {
    const name = cleanName(req.name);
    if (!name) throw new Refusal(400, 'A name has 2 to 24 letters, digits, spaces, dots, dashes or underscores.');
    const problem = passwordProblem(req.password);
    if (problem) throw new Refusal(400, problem);
    if (this.store.userByName(name)) throw new Refusal(409, 'That name is taken on this server. Pick another one.');
    const now = this.now();
    let role: Role = 'player';
    const mode = this.config.mode;
    // An invite lets its holder in whatever the mode (the owner's set-up code is one, for the owner).
    // Without one, a password server asks for its password and an invite-only server says no.
    if (!req.invite && mode === 'password' && req.serverPassword !== this.config.password)
      throw new Refusal(403, 'Making an account here needs the server’s password, or an invite. Ask its owner.');
    if (!req.invite && mode === 'invite')
      throw new Refusal(403, 'Making an account here needs an invite. Ask someone on the server for an invite link.');
    if (req.invite) {
      const invite = this.store.useInvite(req.invite, 'invite', now);
      if (!invite) throw new Refusal(403, 'That invite has run out or was used up. Ask for a new link.');
      role = invite.role === 'owner' ? 'owner' : 'player';
    }
    const user = { id: randomUUID(), name, hash: await hashPassword(req.password!), role, created: now };
    this.store.addUser(user);
    if (role === 'owner')
      this.store.log({ at: now, actor: user.id, action: 'owner', target: user.id, reason: 'Signed up with the set-up code' });
    return this.issue(this.store.userById(user.id)!);
  }

  async signIn(name: unknown, password: unknown): Promise<Session> {
    const user = typeof name === 'string' ? this.store.userByName(name.trim()) : undefined;
    const ok = typeof password === 'string' && password.length <= 200 && (await checkPassword(password, user?.hash ?? (await this.decoy)));
    if (!user || !ok) throw new Refusal(401, 'That name and password do not match an account on this server.');
    this.checkBan(user);
    return this.issue(user);
  }

  /** Trades a refresh token (single-use) for a new pair. */
  refresh(token: unknown): Session {
    const id = typeof token === 'string' ? this.store.takeRefresh(sha256(token), this.now()) : undefined;
    const user = id ? this.store.userById(id) : undefined;
    if (!user) throw new Refusal(401, 'You were signed out. Sign in again.');
    this.checkBan(user);
    return this.issue(user);
  }

  /** The account an access token belongs to, if it is valid and not banned. */
  authenticate(token: string | undefined): UserRow {
    const claims = token ? this.signer.verify<AccessClaims>(token) : undefined;
    const user = claims?.kind === 'access' && claims.exp > this.now() ? this.store.userById(claims.sub) : undefined;
    if (!user) throw new Refusal(401, 'You were signed out. Sign in again.');
    this.checkBan(user);
    return user;
  }

  private checkBan(user: UserRow) {
    if (user.banned_until !== null && user.banned_until > this.now()) {
      const until = user.banned_until >= FOREVER ? '' : ` until ${new Date(user.banned_until).toUTCString()}`;
      throw new Refusal(403, `You are banned from this server${until}.${user.ban_reason ? ` Reason: ${user.ban_reason}` : ''}`);
    }
  }

  private issue(user: UserRow): Session {
    const now = this.now();
    const access = this.signer.sign({ sub: user.id, exp: now + ACCESS_TTL_MS, kind: 'access' } satisfies AccessClaims);
    const refresh = randomToken(32);
    this.store.addRefresh(sha256(refresh), user.id, now + REFRESH_TTL_MS);
    return { user: account(user), access, refresh };
  }

  deleteAccount(user: UserRow) {
    if (user.role === 'owner' && this.store.owners() <= 1)
      throw new Refusal(409, 'The last admin’s account cannot be deleted: it runs the server. Make someone else an admin first.');
    this.store.deleteUser(user.id);
  }

  /**
   * An invite link: the server's address and a code that makes accounts. On an invite-only server
   * any player can make one (one use, a week); the owner and moderators can make them in any mode,
   * for as many uses and as long as they like (null: no limit).
   */
  makeInvite(by: UserRow, uses: unknown, hours: unknown): Invite {
    const mod = canModerate(by.role);
    if (this.config.mode !== 'invite' && !mod) throw new Refusal(403, 'Only admins and moderators can make invites here.');
    const code = randomToken(12);
    const n = !mod ? 1 : uses === null ? null : typeof uses === 'number' && Number.isInteger(uses) && uses > 0 ? Math.min(uses, 10_000) : 1;
    const h = !mod ? 24 * 7 : hours === null ? null : typeof hours === 'number' && hours > 0 ? Math.min(hours, 24 * 365) : 24 * 7;
    const expires = h === null ? null : this.now() + h * 3_600_000;
    this.store.addInvite({ code, by: by.id, uses: n, expires, role: 'player', kind: 'invite', created: this.now() });
    return { code, uses: n, expires, link: inviteLink(this.config.publicUrl, code) };
  }

  /** Whether an invite still lets someone in (for the join page; it is not used up by looking). */
  inviteValid(code: string): boolean {
    const i = this.store.invite(code);
    const now = this.now();
    return !!i && i.kind === 'invite' && (i.expires === null || i.expires > now) && (i.uses === null || i.uses > 0);
  }

  /* Moderation ------------------------------------------------------------------------------- */

  /** The account a moderation action is about, which the actor must outrank. */
  private target(actor: UserRow, name: unknown): UserRow {
    if (!canModerate(actor.role)) throw new Refusal(403, 'Only admins and moderators can do that.');
    const user = typeof name === 'string' ? this.store.userByName(name.trim()) : undefined;
    if (!user) throw new Refusal(404, 'There is no player with that name on this server.');
    if (user.id === actor.id) throw new Refusal(409, 'That is your own account.');
    if (user.role === 'owner' || (user.role === 'moderator' && actor.role !== 'owner'))
      throw new Refusal(403, 'Moderators can only be moderated by an admin, and admins by nobody.');
    return user;
  }

  private reasonOf = (r: unknown) => (typeof r === 'string' ? r.trim().slice(0, 500) : '');

  ban(actor: UserRow, name: unknown, hours: unknown, reason: unknown): UserRow {
    const user = this.target(actor, name);
    const until = typeof hours === 'number' && hours > 0 ? this.now() + hours * 3_600_000 : FOREVER;
    const why = this.reasonOf(reason);
    this.store.setBan(user.id, until, why || null);
    this.store.dropRefreshes(user.id);
    this.store.log({ at: this.now(), actor: actor.id, action: until >= FOREVER ? 'ban' : `ban ${hours} h`, target: user.id, reason: why });
    return user;
  }

  unban(actor: UserRow, name: unknown, reason: unknown) {
    const user = this.target(actor, name);
    this.store.setBan(user.id, null, null);
    this.store.log({ at: this.now(), actor: actor.id, action: 'unban', target: user.id, reason: this.reasonOf(reason) });
  }

  /** Records a kick from the server (the connection is closed by the caller). */
  kick(actor: UserRow, name: unknown, reason: unknown): UserRow {
    const user = this.target(actor, name);
    this.store.log({ at: this.now(), actor: actor.id, action: 'kick', target: user.id, reason: this.reasonOf(reason) });
    return user;
  }

  /**
   * An admin names another admin (role "owner": every admin can do all the first one can) or a
   * moderator, or makes a player of a moderator. An admin can only be stepped down by themselves,
   * so no admin can push the others out, and never the last one: a server always has an admin.
   */
  setRole(actor: UserRow, name: unknown, role: unknown) {
    if (actor.role !== 'owner') throw new Refusal(403, 'Only an admin names admins and moderators.');
    if (role !== 'owner' && role !== 'moderator' && role !== 'player')
      throw new Refusal(400, 'The role is "owner", "moderator" or "player".');
    const self = typeof name === 'string' && this.store.userByName(name.trim())?.id === actor.id;
    if (self) {
      if (role === 'owner') return;
      if (this.store.owners() <= 1) throw new Refusal(409, 'You are the only admin. Make someone else an admin before you step down.');
      this.store.setRole(actor.id, role);
      this.store.log({ at: this.now(), actor: actor.id, action: `role ${role}`, target: actor.id, reason: 'Stepped down' });
      return;
    }
    const user = this.target(actor, name);
    this.store.setRole(user.id, role);
    this.store.log({ at: this.now(), actor: actor.id, action: `role ${role === 'owner' ? 'admin' : role}`, target: user.id, reason: '' });
  }

  /** The owner resets a forgotten password (there are no emails): a new one to pass on. */
  async resetPassword(actor: UserRow, name: unknown): Promise<string> {
    if (actor.role !== 'owner') throw new Refusal(403, 'Only an admin resets passwords.');
    const user = this.target(actor, name);
    const password = randomToken(9);
    this.store.setHash(user.id, await hashPassword(password));
    this.store.dropRefreshes(user.id);
    this.store.log({ at: this.now(), actor: actor.id, action: 'reset password', target: user.id, reason: '' });
    return password;
  }

  /** Every account, for the admin's list of players (bans still running shown as such). */
  users(actor: UserRow, online: (id: string) => boolean): UserEntry[] {
    if (!canModerate(actor.role)) throw new Refusal(403, 'Only admins and moderators can see the players.');
    const now = this.now();
    return this.store.users().map((u) => {
      const banned = u.banned_until !== null && u.banned_until > now;
      return {
        name: u.name,
        role: u.role,
        created: u.created,
        bannedUntil: banned ? u.banned_until : null,
        banReason: banned ? u.ban_reason : null,
        online: online(u.id),
      };
    });
  }

  audit(actor: UserRow) {
    if (!canModerate(actor.role)) throw new Refusal(403, 'Only admins and moderators can read the moderation log.');
    const name = (id: string) => this.store.userById(id)?.name ?? '(deleted account)';
    return this.store
      .auditLog()
      .map((a) => ({ at: a.at, actor: name(a.actor), action: a.action, target: name(a.target), reason: a.reason }));
  }

  /** Everything the server holds about a player (docs/specs/online-play.md, 3.5). */
  export(user: UserRow) {
    return {
      about:
        'Everything this Soundwave server holds about your account. Your password is stored only as an Argon2id hash, ' +
        'which is left out; sign-ins are stored only as hashes of their tokens.',
      server: { name: this.config.name, address: this.config.publicUrl },
      account: { id: user.id, name: user.name, role: user.role, created: new Date(user.created).toISOString() },
      ban: user.banned_until
        ? { until: user.banned_until >= FOREVER ? 'for ever' : new Date(user.banned_until).toISOString(), reason: user.ban_reason }
        : null,
      invitesMade: this.store.invitesBy(user.id).map((i) => ({
        kind: i.kind,
        usesLeft: i.uses,
        expires: i.expires ? new Date(i.expires).toISOString() : null,
        created: new Date(i.created).toISOString(),
      })),
      moderationAboutYou: this.store
        .auditAbout(user.id)
        .map((a) => ({ at: new Date(a.at).toISOString(), action: a.action, reason: a.reason })),
    };
  }
}
