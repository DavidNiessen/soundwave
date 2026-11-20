/**
 * Starts a Soundwave server with the settings in its data folder and the environment (see
 * config.ts and server/README.md). Run through main.ts, which teaches Node the game's imports first.
 */
import { startServer } from './app.ts';
import { loadConfig } from './config.ts';
import { Store } from './db.ts';

const config = loadConfig();
const store = new Store(config.dataDir);
const server = await startServer(config, store);

console.log(`${config.name} is running on port ${server.port} (${config.mode} mode).`);
console.log(`Players connect to ${config.publicUrl}`);
if (server.accounts.ownerCode) {
  console.log('');
  console.log('This server has no owner yet. Make the owner account in the game: connect to the server,');
  console.log('choose "Make an account", and enter this set-up code as the invite. It works once.');
  console.log(`  Set-up code: ${server.accounts.ownerCode}`);
}
if (!process.env.SOUNDWAVE_PUBLIC_URL && config.publicUrl.includes('localhost'))
  console.log('\nSet SOUNDWAVE_PUBLIC_URL (or publicUrl) to the address friends reach this server at: invite links carry it.');
if (config.publicUrl.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(config.publicUrl))
  console.log('\nThe public address is plain HTTP: the game only connects to a server over HTTPS outside your own network.');

const stop = async () => {
  await server.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
