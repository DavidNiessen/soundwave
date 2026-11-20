#!/usr/bin/env node
/**
 * `soundwave-server`. The server checks scores with the game's own judging (src/game/), whose
 * imports need the resolve hook in resolve.mjs; it has to be in place before anything else loads.
 */
import { register } from 'node:module';

register('./resolve.mjs', import.meta.url);
await import('./serve.ts');
