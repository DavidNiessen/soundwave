/**
 * The page an invite link opens (`/join?invite=…`). Every server serves its own, so an invite works
 * with nothing hosted anywhere else: it opens the desktop app on a soundwave:// link, or the web
 * game with the invite filled in, and says how to paste the link in by hand.
 */
import type { Config } from './config.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The query an invite hands the game: which server, and the code. */
export const joinQuery = (server: string, code: string, kind: 'invite' | 'recover' = 'invite') =>
  `server=${encodeURIComponent(server)}&${kind}=${encodeURIComponent(code)}`;

/**
 * `kind`: an invite (the default), or a recovery link an admin made for a player who lost their
 * identity (it binds their new one to their account).
 */
export function joinPage(config: Config, code: string, valid: boolean, kind: 'invite' | 'recover' = 'invite'): string {
  const name = esc(config.name);
  const query = joinQuery(config.publicUrl, code, kind);
  const app = `soundwave://join?${query}`;
  const web = `${config.webGameUrl}/?${query}`;
  const link = `${config.publicUrl}/join?${kind}=${encodeURIComponent(code)}`;
  const body = valid
    ? `<p>${kind === 'recover' ? `This link gives you back your account on <strong>${name}</strong>, with the identity of the game you open it in. It works once.` : `You are invited to play Soundwave together on <strong>${name}</strong>.`}</p>
       <a class="btn primary" href="${esc(app)}">Open in the Soundwave app</a>
       <a class="btn" href="${esc(web)}">Play in your browser</a>
       <p class="small">Nothing happens when you open the app? In Soundwave, choose <strong>Play together</strong> and paste this link:</p>
       <code>${esc(link)}</code>
       <p class="small">No Soundwave yet? <a href="${esc(config.downloadUrl)}">Download it</a> for Windows, macOS or Linux.</p>`
    : `<p>This invite to <strong>${name}</strong> has run out or was used up.</p>
       <p class="small">Ask whoever sent it for a new link.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join ${name} · Soundwave</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0e0828; color: #f6f3ff;
    font: 17px/1.5 system-ui, sans-serif; }
  main { box-sizing: border-box; width: min(32rem, 100%); padding: 2rem 1rem; display: flex; flex-direction: column; gap: 0.9rem; }
  h1 { margin: 0; font-size: 1.8rem; font-style: italic; font-weight: 900; text-transform: uppercase; letter-spacing: 0.02em; }
  .btn { display: block; padding: 0.85rem 1rem; border-radius: 0.75rem; background: rgb(255 255 255 / 0.09); color: inherit;
    text-align: center; font-weight: 800; text-decoration: none; }
  .btn.primary { background: #ff4d9d; color: #2c0421; }
  .btn:focus-visible { outline: 3px solid #5df2d6; outline-offset: 2px; }
  .small { margin: 0; color: #aba1e6; font-size: 0.92rem; }
  code { display: block; padding: 0.6rem 0.8rem; border-radius: 0.5rem; background: rgb(0 0 0 / 0.32); word-break: break-all; user-select: all; }
  a { color: #ff7ab8; }
</style>
</head>
<body>
<main>
<h1>Soundwave</h1>
${body}
</main>
</body>
</html>`;
}
