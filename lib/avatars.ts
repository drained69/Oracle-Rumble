/**
 * Procedural arcade-style avatars for entrants.
 *
 * Deterministic — same wallet always maps to the same character + palette so
 * a player has an identity across arenas and reloads. Zero deps, pure SVG,
 * cheap enough to render inline in every roster row.
 */

const PALETTES = [
  { skin: "#00ff9d", trim: "#00cf7c" },   // phosphor
  { skin: "#ffb54c", trim: "#d18f2e" },   // amber
  { skin: "#45f0d4", trim: "#2ec7ae" },   // cyan
  { skin: "#ff4d6a", trim: "#c73e58" },   // magenta
  { skin: "#a774ff", trim: "#8757d9" },   // violet
  { skin: "#4dc0ff", trim: "#2b95c9" },   // sky
  { skin: "#ffe14d", trim: "#c9b02f" },   // yellow
  { skin: "#f37ba1", trim: "#c95b83" }    // pink
];

/** FNV-1a 32-bit hash — deterministic, fast, no crypto needed for visual salt. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Returns { face, palette } picked deterministically from the wallet string. */
export function pickAvatar(wallet: string): { face: number; palette: typeof PALETTES[number] } {
  const h = hash(wallet || "anon");
  return {
    face: h % 6,             // 6 face variants
    palette: PALETTES[(h >> 8) % PALETTES.length]
  };
}

/**
 * Renders a compact arcade fighter head — 24x24 by default, scales cleanly.
 * The 6 face variants give a bit of personality without needing sprites.
 */
export function avatarSvg(wallet: string, size = 24): string {
  const { face, palette } = pickAvatar(wallet);
  const eyeGap = face % 2 === 0 ? 4 : 5;
  const mouth = face < 2 ? "M 10 17 Q 12 19 14 17" : face < 4 ? "M 10 17 L 14 17" : "M 10 18 L 12 16 L 14 18";
  const helmY = face % 3 === 0 ? 6 : 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-hidden="true">
    <rect x="0" y="0" width="24" height="24" rx="6" fill="#101a30"/>
    <path d="M4 ${helmY} L 12 3 L 20 ${helmY} L 20 14 L 12 20 L 4 14 Z" fill="${palette.skin}" stroke="${palette.trim}" stroke-width="1"/>
    <circle cx="${12 - eyeGap / 2}" cy="12" r="1.2" fill="#070b16"/>
    <circle cx="${12 + eyeGap / 2}" cy="12" r="1.2" fill="#070b16"/>
    <path d="${mouth}" stroke="#070b16" stroke-width="1.2" stroke-linecap="round" fill="none"/>
  </svg>`;
}

/** For direct <img src={dataUrl}/> usage. */
export function avatarDataUrl(wallet: string, size = 24): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(wallet, size))}`;
}
