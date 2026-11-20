/**
 * The main menu's Online tab: everything on a Soundwave server in one place. Signed out, a way in;
 * signed in, starting or joining a party (or the one the player is in), the leaderboards, shared
 * songs, the player's look, who is online and their account. The party itself (its lobby and
 * songs) and signing in are on the Play together screen, which this opens.
 */
import {
  Download,
  Gavel,
  LogIn,
  LogOut,
  PartyPopper,
  Send,
  Shirt,
  Trophy,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { online } from '../net/client';
import { PARTY_MAX, type Role } from '../net/protocol';
import type { SongMeta } from '../storage/db';
import { Hint, useActions, useHints, type Action } from './actions';
import type { Part } from '../chart/types';
import { setMenuLook } from '../render/aurora/menuStage';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';
import { OnlineSidebar } from './OnlineSidebar';
import { MODES } from './PartyScreen';
import { AdminPanel, download, InvitePanel } from './ServerAdmin';

/** A role as players read it: the server's owner is its admin. */
const ROLE_LABEL: Record<Role, string> = { owner: 'Admin', moderator: 'Moderator', player: 'Player' };

export interface OnlinePanelProps {
  settings: Settings;
  /** The player's setlist (the server tools can make it the Showdown rotation). */
  setlist: SongMeta[];
  /** The player's library (the admin adds songs from it to the server). */
  library: SongMeta[];
  /** Opens the Play together screen: signing in, or the party's lobby. */
  onParty(): void;
  onBoards(): void;
  /** The part the player plays: their band member stands under the nametag. */
  part: Part;
  onAvatar(): void;
  /** The main menu's own actions (settings, exit…), kept while this tab declares its own. */
  base: Action[];
}

export function OnlinePanel(props: OnlinePanelProps) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  // A stored sign-in connects by itself.
  useEffect(() => online.resume(), []);
  return s.account ? <SignedIn {...props} /> : <SignedOut {...props} />;
}

/** Not signed in: what playing online gives, and the way to a server. */
function SignedOut({ settings, onParty, base }: OnlinePanelProps) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const hints = useHints(settings);
  useActions([...base, { id: 'online-connect', label: 'Connect', icon: LogIn, ...keysOf('party.create'), bar: false, run: onParty }]);
  const waiting = s.status === 'connecting' || s.status === 'reconnecting';
  const features: [string, string][] = [
    ['Parties', 'Up to 16 friends play a set at the same moment: Versus or Showdown.'],
    ['Leaderboards', 'Every song’s best runs on the server, checked from each run, and Watch.'],
    ['Shared songs', 'A party’s songs reach the players who lack them by themselves.'],
  ];
  return (
    <div className="online-panel signed-out">
      <div className="tiles party-tiles" data-nav-group="tiles">
        <button type="button" className="tile hero" data-action="online-connect" data-autofocus onClick={onParty}>
          <span className="mosaic blank" aria-hidden>
            <Users strokeWidth={ICON_STROKE} />
          </span>
          <span className="tile-text">
            <span className="tile-title">
              {waiting ? 'Connecting…' : 'Connect to a server'}
              {!waiting && <Hint {...keysOf('party.create')} {...hints} />}
            </span>
            <span className="tile-cap">
              {waiting
                ? `To ${s.server?.replace(/^https?:\/\//, '') ?? 'your server'}.`
                : 'Soundwave servers are run by players, for their friends. Sign in with the address or the invite link you were sent.'}
            </span>
            <span className="hero-songs">
              {features.map(([name, cap], i) => (
                <span key={name} className="hero-song">
                  <span className="hero-num">{i + 1}</span>
                  <span className="hero-name">{name}</span>
                  <span className="hero-by">{cap}</span>
                </span>
              ))}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

/** Signed in: the party, the server's boards and songs, who is online, and the account. */
function SignedIn({ settings, setlist, library, onParty, onBoards, onAvatar, base, part }: OnlinePanelProps) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const hints = useHints(settings);
  /** The window open over the tab: the account, an invite, or the server's tools. */
  const [modal, setModal] = useState<'account' | 'invite' | 'admin' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const mod = s.account!.role !== 'player';
  const party = s.party;
  const [code, setCode] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  const saveData = async () => {
    try {
      const data = await online.exportData();
      download(`soundwave-${s.info?.name ?? 'server'}-my-data.zip`.replace(/[^\w.-]+/g, '-'), data);
    } catch (e) {
      online.report((e as Error).message);
    }
  };
  // Starting or joining a party from here opens its lobby as soon as the party is there.
  const asked = useRef(false);
  const join = () => {
    if (!code.trim()) return;
    asked.current = true;
    online.joinParty(code);
  };
  const start = () => {
    if (party) return onParty();
    asked.current = true;
    online.createParty();
  };
  useEffect(() => {
    if (party && asked.current) {
      asked.current = false;
      onParty();
    }
  }, [party, onParty]);
  useEffect(() => {
    if (s.error) asked.current = false;
  }, [s.error]);

  useActions([
    ...base,
    {
      id: 'party-create',
      label: party ? 'Your party' : 'Start a party',
      icon: PartyPopper,
      ...keysOf('party.create'),
      bar: false,
      run: start,
    },
    {
      id: 'party-join',
      label: 'Join a party',
      icon: UserPlus,
      ...keysOf('party.join'),
      bar: false,
      run: () => (code.trim() ? join() : codeInput.current?.focus()),
    },
    { id: 'party-account', label: 'Your account', icon: UserRound, ...keysOf('party.signOut'), bar: false, run: () => setModal('account') },
    { id: 'party-invite', label: 'Invite', icon: Send, ...keysOf('party.invite'), run: () => setModal('invite') },
    { id: 'party-boards', label: 'Leaderboards', icon: Trophy, ...keysOf('party.boards'), bar: false, run: onBoards },
    { id: 'party-avatar', label: 'Your look', icon: Shirt, ...keysOf('party.avatar'), bar: false, run: onAvatar },
    ...(mod ? [{ id: 'party-admin', label: 'Admin', icon: Gavel, ...keysOf('party.admin'), run: () => setModal('admin') }] : []),
  ]);

  const more: [string, string, LucideIcon, string, string, () => void][] = [
    ['party-boards', 'party.boards', Trophy, 'Leaderboards', 'The best runs of every song here.', onBoards],
    ['party-avatar', 'party.avatar', Shirt, 'Your look', 'Your colours, on stage for everyone.', onAvatar],
  ];
  const players = party ? party.members.length : 0;
  // The stage's camera holds on the player's band member, under their nametag.
  useEffect(() => {
    setMenuLook(part);
    return () => setMenuLook(null);
  }, [part]);

  return (
    <div className="online-panel">
      {s.error && (
        <p className="party-error" role="alert">
          {s.error}
          <button type="button" className="btn small" onClick={() => online.clearError()}>
            OK
          </button>
        </p>
      )}
      <div className="online-stage">
        {/* Left: playing together. */}
        <div className="online-col" data-nav-group="tiles">
          <button
            type="button"
            className={`online-party ${party ? 'in-party' : ''}`}
            data-action="party-create"
            data-autofocus
            onClick={start}
          >
            <span className="online-party-art" aria-hidden>
              <PartyPopper strokeWidth={ICON_STROKE} />
            </span>
            <span className="online-party-text">
              <span className="online-party-title">
                {party ? 'Your party' : 'Start a party'}
                <Hint {...keysOf('party.create')} {...hints} />
              </span>
              {party ? (
                <>
                  <span className="display party-code-text">{party.code}</span>
                  <span className="dim">
                    {players} {players === 1 ? 'player' : 'players'}
                    {party.mode ? ` · ${MODES[party.mode].label}` : ' · picking what to play'}
                  </span>
                </>
              ) : (
                <span className="dim">Versus or Showdown, up to {PARTY_MAX} players</span>
              )}
            </span>
          </button>
          {!party && (
            <form
              className="online-join"
              onSubmit={(e) => {
                e.preventDefault();
                join();
              }}
            >
              <span className="online-row-label">
                Join with a code
                <Hint {...keysOf('party.join')} {...hints} />
              </span>
              <span className="party-join-row">
                <input
                  ref={codeInput}
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, 5),
                    )
                  }
                  placeholder="B7KQX"
                  aria-label="The party’s code, from its host"
                  maxLength={12}
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <button type="submit" className="btn primary" data-action="party-join" disabled={!code.trim()}>
                  <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
                  Join
                </button>
              </span>
            </form>
          )}
          <nav className="online-links" aria-label="On the server">
            {more.map(([id, binding, Icon, label, cap, run]) => (
              <button key={id} type="button" className="online-link" data-action={id} onClick={run}>
                <Icon strokeWidth={ICON_STROKE} aria-hidden />
                <span className="online-link-text">
                  <span className="online-link-title">{label}</span>
                  <span className="dim">{cap}</span>
                </span>
                <Hint {...keysOf(binding)} {...hints} />
              </button>
            ))}
          </nav>
        </div>

        {/* Middle: the player, on stage behind, with their nametag over them. */}
        <div className="online-me">
          <button type="button" className="nametag" data-action="party-account" onClick={() => setModal('account')}>
            <span className={`online-dot ${s.status === 'online' ? 'on' : ''}`} aria-hidden />
            <span className="nametag-name">{s.account!.name}</span>
            <span className="nametag-sub">
              {mod ? `${ROLE_LABEL[s.account!.role]} · ` : ''}
              {s.status === 'online' ? (s.info?.name ?? 'Soundwave server') : 'Reconnecting…'}
            </span>
            <Hint {...keysOf('party.signOut')} {...hints} />
          </button>
          <span className="nametag-pin" aria-hidden />
        </div>

        {/* Right: the week's best and who is online. */}
        <OnlineSidebar onBoards={onBoards} />
      </div>

      {modal === 'account' && (
        <Dialog title="Your account" variant="card" onClose={() => setModal(null)}>
          {(close) => (
            <div className="pause-card account-card">
              <span className="online-dot on" aria-hidden />
              <h2 className="display">{s.account!.name}</h2>
              <p className="hint">
                {mod ? `${ROLE_LABEL[s.account!.role]} · ` : ''}
                {s.status === 'online' ? `Signed in to ${s.info?.name ?? s.server}` : 'Connection lost, trying again…'}
              </p>
              <button type="button" className="btn wide" data-autofocus onClick={() => void saveData()}>
                <Download strokeWidth={ICON_STROKE} aria-hidden />
                Save my data
              </button>
              <button type="button" className="btn wide" data-sfx="back" onClick={() => online.signOut()}>
                <LogOut strokeWidth={ICON_STROKE} aria-hidden />
                Sign out
              </button>
              <button type="button" className="btn wide quiet" data-sfx="back" onClick={() => online.forget()}>
                Forget this server
              </button>
              {s.account!.role !== 'owner' &&
                (deleting ? (
                  <button
                    type="button"
                    className="btn wide danger"
                    onClick={() => void online.deleteAccount().catch((e) => online.report((e as Error).message))}
                  >
                    Delete it, with all my scores
                  </button>
                ) : (
                  <button type="button" className="btn wide quiet" onClick={() => setDeleting(true)}>
                    Delete my account
                  </button>
                ))}
              <button type="button" className="btn primary wide" onClick={close}>
                Done
              </button>
            </div>
          )}
        </Dialog>
      )}
      {modal === 'invite' && (
        <Dialog title="Invite friends" variant="card" className="wide-card" onClose={() => setModal(null)}>
          {(close) => (
            <div className="window-body">
              <InvitePanel mod={mod} />
              <button type="button" className="btn primary wide" onClick={close}>
                Done
              </button>
            </div>
          )}
        </Dialog>
      )}
      {modal === 'admin' && mod && (
        <Dialog title="Admin" className="admin-sheet" onClose={() => setModal(null)}>
          {() => (
            <div className="window-body">
              <h2 className="display">Admin</h2>
              <AdminPanel owner={s.account!.role === 'owner'} setlist={setlist} library={library} />
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
