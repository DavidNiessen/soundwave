/**
 * The connected main menu (docs/specs/online-play.md, 4.3): on the Online tab while signed in, a
 * column with you and the server, the week's top players and who is online.
 */
import { Crown, Trophy } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { online } from '../net/client';
import type { Online } from '../net/protocol';
import { ICON_STROKE } from './icons';

export function OnlineSidebar({ onBoards }: { onBoards(): void }) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const [top, setTop] = useState<{ name: string; score: number }[]>([]);
  const [people, setPeople] = useState<Online[]>([]);
  const signedIn = !!s.account && (s.status === 'online' || s.status === 'reconnecting');

  // Fetched as the menu opens and again whenever the server says the scores or who is online changed.
  useEffect(() => {
    if (!signedIn) return;
    const top = () => void online.topThisWeek().then(setTop, () => {});
    const people = () => void online.presence().then(setPeople, () => {});
    top();
    people();
    const stopTop = online.onChanged(['boards'], top);
    const stopPeople = online.onChanged(['presence'], people);
    return () => (stopTop(), stopPeople());
  }, [signedIn]);

  if (!signedIn) return null;
  const others = people.filter((p) => p.name !== s.account!.name);
  return (
    <aside className="online-side" aria-label="On the server" data-nav-group="online-side">
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
