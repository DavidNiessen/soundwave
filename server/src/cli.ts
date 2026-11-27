#!/usr/bin/env node
/**
 * The server's command line, for whoever runs it (in its container: `docker exec <container> node
 * server/src/cli.ts …`). It works on the server's own data folder, beside the running server, and
 * needs no account: having the server's files is the right to use it.
 *
 *   recover <name>   A one-time link that gives the account back to whoever opens it in their game,
 *                    with that game's identity: for a player, or yourself, who lost their identity.
 *   admins           The server's admins.
 */
import { register } from 'node:module';

register('./resolve.mjs', import.meta.url);
const { Accounts } = await import('./accounts.ts');
const { loadConfig } = await import('./config.ts');
const { Store } = await import('./db.ts');

const [command, ...rest] = process.argv.slice(2);
const config = loadConfig();
const store = new Store(config.dataDir);
const accounts = new Accounts(store, config);

try {
  switch (command) {
    case 'recover': {
      const name = rest.join(' ').trim();
      if (!name) throw new Error('Say whose account: node server/src/cli.ts recover <name>');
      const r = accounts.makeRecovery(null, name);
      console.log(`A recovery link for ${name}, good once, until ${new Date(r.expires).toUTCString()}:`);
      console.log(`  ${r.link}`);
      console.log('Open it on the computer whose game should have the account. It takes that game’s identity.');
      break;
    }
    case 'admins':
      for (const u of store.users().filter((x) => x.role === 'owner')) console.log(u.name);
      break;
    default:
      console.log('Soundwave server commands:');
      console.log('  node server/src/cli.ts recover <name>   a one-time link that gives an account back (a lost identity)');
      console.log('  node server/src/cli.ts admins           the server’s admins');
      process.exitCode = command ? 1 : 0;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
