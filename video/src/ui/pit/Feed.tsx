import React from "react";
import { prog } from "../../anim";
import { F } from "../../fonts";
import { C, rgba } from "../../theme";

export type FeedKind = "trade" | "rank" | "cutline" | "round" | "champion" | "elim" | "info";
export type FeedItem = { id: string; text: string; kind: FeedKind; born: number; ago?: string };

const KIND_COLOR: Record<FeedKind, string> = {
  trade: C.plasma, rank: C.up, cutline: C.xp, round: C.neon, champion: C.gold, elim: C.down, info: C.text3
};

/** The Activity column of app/ArenaStage.tsx. Newest first; new lines push the rest down. */
export const Feed: React.FC<{ m: boolean; beat: number; items: FeedItem[]; w: number | string; h: number; rowH?: number; title?: string }> = ({
  m, beat, items, w, h, rowH, title = "Activity"
}) => {
  const rh = rowH ?? (m ? 40 : 44);
  const live = items.filter((it) => it.born <= beat).sort((a, b) => b.born - a.born);
  return (
    <div style={{
      width: w, height: h, borderRadius: 14, overflow: "hidden", position: "relative",
      background: "linear-gradient(180deg, rgba(19,24,36,0.92), rgba(13,16,23,0.92))", border: `1px solid ${rgba(C.neon, 0.18)}`
    }}>
      <div style={{ padding: m ? "10px 12px 6px" : "12px 14px 8px", fontFamily: F.display, fontWeight: 800, fontSize: m ? 9.5 : 10.5, letterSpacing: 2, color: C.neon, textTransform: "uppercase" }}>{title}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: m ? 32 : 38, bottom: 0 }}>
        {live.map((it, i) => {
          let y = 0;
          for (let j = 0; j < i; j++) y += rh * prog(beat, live[j].born, 0.4);
          const p = prog(beat, it.born, 0.4);
          const fresh = 1 - prog(beat, it.born + 0.3, 1.2);
          const col = KIND_COLOR[it.kind];
          return (
            <div key={it.id} style={{
              position: "absolute", left: m ? 8 : 10, right: m ? 8 : 10, top: y, minHeight: rh - 6, opacity: p,
              transform: `translateY(${(1 - p) * -10}px)`, display: "flex", alignItems: "flex-start", gap: 8, padding: m ? "6px 8px" : "7px 9px", borderRadius: 9,
              background: fresh > 0 ? rgba(col, 0.1 * fresh) : "transparent", border: `1px solid ${rgba(col, 0.25 * fresh)}`
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, marginTop: 5, flexShrink: 0, boxShadow: `0 0 6px ${col}` }} />
              <span style={{ flex: 1, fontFamily: F.text, fontSize: m ? 11 : 12, lineHeight: 1.35, color: C.text }}>{it.text}</span>
              <span style={{ fontFamily: F.mono, fontSize: m ? 9 : 10, color: C.text3, paddingTop: 1 }}>{it.ago ?? "now"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
