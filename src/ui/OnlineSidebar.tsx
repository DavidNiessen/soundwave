/**
 * The connected main menu (docs/specs/online-play.md, 4.3): while signed in to a server, a sidebar
 * beside the Play tab with you and the server, your party, the week's top players and who is online.
 * Offline it is not there, and the menu looks as it always did.
 */
import { Crown, Trophy, Users } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { online } from '../net/client';
import type { Online } from '../net/protocol';
import { ICON_STROKE } from './icons';

export function OnlineSidebar({ onTogether, onBoards }: { onTogether(): void; onBoards(): void }) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const [top, setTop] = useState<{ name: string; score: number }[]>([]);
  const [people, setPeople] = useState<Online[]>([]);
  const signedIn = !!s.account && (s.status === 'online' || s.status === 'reconnecting');

  // Asked again every half minute while the menu is open: nothing runs in the background otherwise.
  useEffect(() => {
    if (!signedIn) return;
    const load = () => {
      void online.topThisWeek().then(setTop, () => {});
      void online.presence().then(setPeople, () => {});
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [signedIn]);

  if (!signedIn) return null;
  const party = s.party;
  const others = people.filter((p) => p.name !== s.account!.name);
  return (
    <aside className="online-side" aria-label="On the server" data-nav-group="online-side">
      <section className="online-you">
        <span className={`online-dot ${s.status === 'online' ? 'on' : ''}`} aria-hidden />
        <span className="party-name">{s.account!.name}</span>
        <span className="dim">{s.status === 'online' ? s.info?.name : 'Reconnecting…'}</span>
      </section>
      <button type="button" className="online-card" onClick={onTogether}>
        <span className="label">
          <Users strokeWidth={ICON_STROKE} aria-hidden /> Party
        </span>
        {party ? (
          <>
            <span className="party-name">{party.code}</span>
            <span className="dim">
              {party.members.length} {party.members.length === 1 ? 'player' : 'players'} · {party.members.filter((m) => m.ready).length}{' '}
              ready
            </span>
          </>
        ) : (
          <span className="dim">Play together: start a party or join one</span>
        )}
      </button>
      <button type="button" className="online-card" onClick={onBoards}>
        <span className="label">
          <Trophy strokeWidth={ICON_STROKE} aria-hidden /> This week
        </span>
        {top.length === 0 && <span className="dim">No scores yet this week</span>}
        <ol className="online-list">
          {top.map((t, i) => (
            <li key={t.name} className={t.name === s.account!.name ? 'me' : ''}>
              <span className="num">{i === 0 ? <Crown strokeWidth={ICON_STROKE} aria-label="First" /> : i + 1}</span>
              <span className="party-name">{t.name}</span>
              <span className="num">{t.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      </button>
      <section className="online-card">
        <span className="label">Online · {people.length}</span>
        {others.length === 0 && <span className="dim">Nobody else right now</span>}
        <ul className="online-list">
          {others.slice(0, 8).map((p) => (
            <li key={p.name}>
              <span className="online-dot on" aria-hidden />
              <span className="party-name">{p.name}</span>
              <span className="dim">{p.activity}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
