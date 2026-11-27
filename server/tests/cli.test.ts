/**
 * The server's command line (server/src/cli.ts), run as whoever runs the server would: on its data
 * folder, with no account. Its recovery link is what an admin who lost their identity gets back in by.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { newKey, proof } from './identity.ts';

const CLI = resolve(import.meta.dirname, '../src/cli.ts');
let dir = '';
let server: RunningServer | undefined;
let store: Store | undefined;

afterEach(async () => {
  await server?.close();
  store?.close();
  server = store = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const run = (...args: string[]) =>
  execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, SOUNDWAVE_DATA: dir, SOUNDWAVE_PUBLIC_URL: 'https://play.example.com' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('the server’s command line', () => {
  it('lists the admins and makes a recovery link that gives an admin their account back', async () => {
    dir = mkdtempSync(join(tmpdir(), 'soundwave-cli-'));
    const before = new Store(dir);
    before.addUser({ id: 'a1', name: 'Boss', pubkey: newKey().publicKey, role: 'owner', created: 1 });
    before.addUser({ id: 'p1', name: 'Player', pubkey: newKey().publicKey, role: 'player', created: 2 });
    before.close();

    expect(run('admins').trim()).toBe('Boss');
    const out = run('recover', 'Boss');
    const code = out.match(/https:\/\/play\.example\.com\/join\?recover=([A-Za-z0-9_-]+)/)?.[1];
    expect(code).toBeDefined();
    expect(() => run('recover', 'Nobody')).toThrow(/no player with that name/);

    store = new Store(dir);
    server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: dir }, store, () => {});
    const res = await fetch(server.url + '/auth/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...(await proof(server.url, newKey())) }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Session).user).toMatchObject({ name: 'Boss', role: 'owner' });
  });
});
