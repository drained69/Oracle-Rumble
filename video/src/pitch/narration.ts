/**
 * The pitch voice-over, line by line — this is the script you read.
 *
 * Record each line as public/pitch-vo/<id>.wav (48 kHz mono, 16-bit, trimmed),
 * then `npm run voiceover:pitch -- --measure` and `npm run render:pitch`.
 * The edit re-times itself to your recordings.
 *
 * `text` is what the subtitles show; `say` (optional) is spelled for the
 * scratch synthesiser only. `pause` adds seconds of silence before a line.
 */
import type { NarrationLine } from "../narration";

/** Your name, as said in the first line and shown on the name card. */
export const SPEAKER_NAME = "drained69";
/** Shown on the "shipped" slide and the close. Set to "" to hide it. */
export const GITHUB = "github.com/drained69";

export const NARRATION: NarrationLine[] = [
  // Intro
  { id: "intro-1", section: "intro", text: `Hi, I'm ${SPEAKER_NAME}.`, say: "Hi, I'm drained sixty-nine.", pause: 0.6 },
  { id: "intro-2", section: "intro", text: "I'm building The Pit: prediction markets you play with your friends." },

  // Who I am
  { id: "who-1", section: "who", text: "I come from finance, so I think in risk, incentives, and who's holding the money." },
  { id: "who-2", section: "who", text: "I'm a security researcher and bug bounty hunter: I read code and ask how it breaks." },
  { id: "who-3", section: "who", text: "And I love building things." },

  // What I've shipped
  { id: "ship-1", section: "ship", text: "Since July, I've shipped ten projects in public." },
  { id: "ship-2", section: "ship", text: "A reputation-backed prediction market, a confidential treasury, a deterministic tax engine." },
  { id: "ship-3", section: "ship", text: "Different chains, one theme: make the money flow provable." },

  // The problem
  { id: "problem-1", section: "problem", text: "Here's what I kept seeing: prediction markets are a solo sport." },
  { id: "problem-2", section: "problem", text: "But the arguing happens together, in group chats and on streams." },
  { id: "problem-3", section: "problem", text: "There's no way to play the call with your friends." },

  // The Pit
  { id: "pit-1", section: "pit", text: "The Pit fixes that. A host opens a pit on a live Panta market." },
  { id: "pit-2", section: "pit", text: "Friends sign in with X, put a seat into on-chain escrow, and trade against each other.", say: "Friends sign in with ex, put a seat into on-chain escrow, and trade against each other." },
  { id: "pit-3", section: "pit", text: "Each round, the bottom half is cut. At the bell, the top three split the pool." },

  // Why me
  { id: "why-1", section: "why", text: "Why me? Finance shaped the format: an entry, your own vault, the cuts, a 0.1% fee.", say: "Why me? Finance shaped the format: an entry, your own vault, the cuts, a zero point one percent fee." },
  { id: "why-2", section: "why", text: "Security shaped the escrow. It's non-custodial: only your signature withdraws, and payouts can never exceed deposits." },
  { id: "why-3", section: "why", text: "If the host never settles, players recover their own funds after the deadline." },
  { id: "why-4", section: "why", text: "I break code for a living, so I built The Pit assuming someone will try." },

  // Close
  { id: "close-1", section: "close", text: "It's live on devnet today at trythepit.xyz.", say: "It's live on devnet today, at try the pit dot x y z." },
  { id: "close-2", section: "close", text: "I'd love to keep building it with Colosseum. Thanks for watching." },
];
