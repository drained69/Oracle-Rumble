"use client";

import { useEffect, useMemo, useState } from "react";

type Event = {
  id: string;
  actor: string;
  verb: "UP" | "DOWN" | "SEAT" | "WON" | "OPENED" | "SETTLED";
  asset: "BTC" | "ETH" | "SOL";
  amount?: number;
  ts: number;
};

const NAMES = [
  "drained", "nova_9", "witness", "mira.v", "onchain.aya", "dune", "theo.l",
  "kova", "sable", "ripcurl", "0xchai", "hush", "quant.py", "sixteen"
];

function randEvent(): Event {
  const actor = NAMES[Math.floor(Math.random() * NAMES.length)];
  const asset = (["BTC", "ETH", "SOL"] as const)[Math.floor(Math.random() * 3)];
  const roll = Math.random();
  const verb: Event["verb"] =
    roll < 0.28 ? "UP" :
    roll < 0.52 ? "DOWN" :
    roll < 0.72 ? "SEAT" :
    roll < 0.86 ? "WON" :
    roll < 0.94 ? "OPENED" : "SETTLED";
  const amount = verb === "WON" ? Math.round(4 + Math.random() * 96) : undefined;
  return {
    id: `${actor}-${asset}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actor,
    verb,
    asset,
    amount,
    ts: Date.now()
  };
}

function agoOf(ms: number) {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

/**
 * Room activity — a compact ticker that seeds the empty-state feeling with
 * realistic movement. Randomised bot activity when nothing real is happening;
 * when hooked to a real feed later, this can render live events instead.
 */
export default function ActivityFeed() {
  const [events, setEvents] = useState<Event[]>(() => {
    const seed: Event[] = [];
    for (let i = 0; i < 5; i += 1) {
      const e = randEvent();
      e.ts = Date.now() - (i + 1) * (8_000 + Math.random() * 20_000);
      seed.push(e);
    }
    return seed;
  });
  const [, force] = useState(0);

  useEffect(() => {
    const push = () => {
      setEvents((prev) => [randEvent(), ...prev].slice(0, 6));
      window.setTimeout(push, 5000 + Math.random() * 8000);
    };
    const t = window.setTimeout(push, 3500 + Math.random() * 2500);
    const refresh = window.setInterval(() => force((n) => n + 1), 4000);
    return () => { window.clearTimeout(t); window.clearInterval(refresh); };
  }, []);

  const rows = useMemo(() => events.slice(0, 4), [events]);

  return (
    <div className="room-feed" aria-label="Recent room activity">
      <div className="rf-head">
        <span className="rf-dot" aria-hidden="true" />
        THE ROOM · RECENT ACTIVITY
      </div>
      <ul className="rf-list">
        {rows.map((e) => (
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
