/**
 * The voice-over, line by line. Each line is synthesised to public/vo/<id>.wav
 * (scripts/build-voiceover.ts) and placed on the timeline at the start of its
 * section, one after another. Swap any clip for a human recording with the
 * same file name and re-run `npm run voiceover:measure` — the edit re-times itself.
 *
 * `say` is the text for the synthesiser (spelled for pronunciation); `text`
 * is what the subtitles show.
 */
export type NarrationLine = { id: string; section: string; text: string; say?: string; pause?: number };

export const NARRATION: NarrationLine[] = [
  // Hook
  { id: "hook-1", section: "intro", text: "Prediction markets put a price on the future." },
  { id: "hook-2", section: "intro", text: "But trading one is still a solo sport." },

  // The problem
  { id: "problem-1", section: "problem", text: "It's you, a chart, and an order book." },
  { id: "problem-2", section: "problem", text: "Creators' audiences call outcomes live, with nothing on the line." },
  { id: "problem-3", section: "problem", text: "And real money means seed phrases, and someone else holding the pot." },

  // The Pit
  { id: "solution-1", section: "solution", text: "The Pit is the experience layer for prediction markets, built on Panta." },
  { id: "solution-2", section: "solution", text: "Host a pit on any market. Everyone takes the same seat, the room trades its own odds, and the best vaults split the pool." },

  // Who it's for
  { id: "audience-1", section: "audience", text: "It's for traders who want real competition, and creators who want their audience in the game." },

  // Demo
  { id: "signin-1", section: "signin", text: "Sign in with one tap on X. It creates your Solana wallet, no seed phrase.", say: "Sign in with one tap on ex. It creates your Solana wallet, no seed phrase." },
  { id: "signin-2", section: "signin", text: "Then pick a live pit." },

  { id: "seat-1", section: "seat", text: "Every seat is the same: an entry into the prize pool, plus a vault to trade with." },
  { id: "seat-2", section: "seat", text: "Both go into a non-custodial escrow on Solana, and your opening call stays hidden." },

  { id: "trade-1", section: "trade", text: "The pit locks at Panta's own price. Then the room trades its own odds." },
  { id: "trade-2", section: "trade", text: "Every buy and sell moves the line for everyone, and the ticket quotes your exact fill." },

  { id: "cut-1", section: "cut", text: "In a royale, the bottom half is cut each round, and survivors carry their vault forward." },
  { id: "cut-2", section: "cut", text: "The Oracle reads the pit's own data and calls a lean." },

  { id: "bell-1", section: "bell", text: "The bell settles on the room's average closing price, so nobody can snipe the close." },
  { id: "bell-2", section: "bell", text: "The top three split the pool." },

  { id: "payout-1", section: "payout", text: "Everyone withdraws to their own wallet, with their own signature. The operator can never move your money." },

  { id: "host-1", section: "host", text: "Hosting takes a minute. Pick a Panta market, or create a brand new one." },
  { id: "host-2", section: "host", text: "You get a join code, a QR, and a live overlay for your stream.", say: "You get a join code, a Q R code, and a live overlay for your stream." },

  // Under the hood
  { id: "tech-1", section: "tech", text: "Under the hood, Panta's API supplies the markets, the opening line, and the resolution.", say: "Under the hood, Panta's A P I supplies the markets, the opening line, and the resolution." },
  { id: "tech-2", section: "tech", text: "Each pit runs its own LMSR book, and a Solana escrow program guarantees payouts never exceed deposits.", say: "Each pit runs its own L M S R book, and a Solana escrow program guarantees payouts never exceed deposits." },

  { id: "formats-1", section: "formats", text: "Four formats, and hosts earn up to five percent of the pool." },

  // Close
  { id: "outro-1", section: "outro", text: "The Pit. Host. Trade. Split." },
  { id: "outro-2", section: "outro", text: "Try it live at trythepit.xyz.", pause: 0.35, say: "Try it live at try the pit dot x y z." }
];
