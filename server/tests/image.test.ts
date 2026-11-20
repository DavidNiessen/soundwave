/**
 * The server's Docker image carries only the game files the server imports. A new one that is not
 * copied in starts in development and fails in the image, so every import is checked here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

/** The game files the server needs at run time (type-only imports leave nothing to load). */
function gameFiles(): string[] {
  const found = new Set<string>();
  const queue = readdirSync(join(root, 'server/src'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `server/src/${f}`);
  while (queue.length) {
    const file = queue.pop()!;
    for (const [, spec] of read(file).matchAll(/^(?:import|export) (?!type )[^;]*? from '(\.[^']+)'/gm)) {
      const path = relative(root, resolve(join(root, dirname(file)), spec.endsWith('.ts') ? spec : `${spec}.ts`)).replaceAll('\\', '/');
      if (path.startsWith('server/') || found.has(path)) continue;
      found.add(path);
      queue.push(path);
    }
  }
  return [...found].sort();
}

describe('the server’s image', () => {
  it('copies in every game file the server loads', () => {
    const files = gameFiles();
    expect(files).toContain('src/game/GameSession.ts');
    const dockerfile = read('server/Dockerfile');
    const ignore = read('.dockerignore');
    for (const f of files) {
      expect(dockerfile, `server/Dockerfile copies ${f}`).toContain(f.slice(f.lastIndexOf('/') + 1));
      expect(ignore.split(/\r?\n/), `.dockerignore lets ${f} in`).toContain(`!${f}`);
    }
  });
});
