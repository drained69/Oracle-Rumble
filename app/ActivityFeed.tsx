"use client";

import { useEffect, useState } from "react";

type Event = {
  id: string;
  actor: string;
  verb: "UP" | "DOWN" | "SEAT" | "WON" | "OPENED" | "SETTLED";
  asset: string;
  arenaCode: string;
  amount?: number;
  ts: number;
};

function agoOf(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Room activity — real events pulled from /api/activity, humans only. Hides
 * the whole panel when nothing has happened yet; no demo rows ever rendered.
 */
export default function ActivityFeed() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const r = await fetch("/api/activity?limit=5", { cache: "no-store" }).then((r) => r.json());
        if (!cancelled) setEvents(Array.isArray(r.items) ? r.items : []);
      } catch {
        if (!cancelled) setEvents([]);
      }
    };
    pull();
    const poll = window.setInterval(pull, 8000);
    const relabel = window.setInterval(() => force((n) => n + 1), 4000);
    return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(relabel); };
  }, []);

  // Hide until we have real activity to show.
  if (!events || events.length === 0) return null;

  return (
    <div className="room-feed" aria-label="Recent room activity">
      <div className="rf-head">
        <span className="rf-dot" aria-hidden="true" />
        THE ROOM · RECENT ACTIVITY
      </div>
      <ul className="rf-list">
        {events.slice(0, 4).map((e) => (
          <li key={e.id} className={`rf-row rf-${e.verb.toLowerCase()}`}>
            <span className="rf-actor">@{e.actor}</span>
            <span className="rf-verb">
              {e.verb === "UP" && <>called <b className="up">▲ UP</b> on {e.asset}</>}
              {e.verb === "DOWN" && <>called <b className="down">▼ DOWN</b> on {e.asset}</>}
              {e.verb === "SEAT" && <>took a seat · {e.asset} room</>}
              {e.verb === "WON" && <>won <b className="win">+${e.amount}</b> on {e.asset}</>}
              {e.verb === "OPENED" && <>opened a new {e.asset} arena</>}
              {e.verb === "SETTLED" && <>settled a {e.asset} round on-chain</>}
            </span>
            <span className="rf-ago">{agoOf(e.ts)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
