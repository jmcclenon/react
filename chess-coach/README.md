# ♞ Chess Coach

A self-contained chess app that **coaches** you on opening strategy and
positioning while you play — with difficulty levels from Beginner all the way
up to **Grandmaster**, optional clocks, full move history, and live analysis.

No build step, no dependencies, no network. Just open `index.html` in any modern
browser.

```
chess-coach/
├── index.html      # App shell & layout
├── css/styles.css  # Theme & responsive layout
└── js/
    ├── engine.js   # Chess rules engine (move gen, legality, SAN, FEN)
    ├── ai.js       # Evaluation + iterative-deepening alpha-beta search
    ├── coach.js    # Opening book + principle-based coaching
    └── app.js      # UI controller wiring it all together
```

## Features

### Coaching (the whole point)
- **Opening recognition** — the coach names the opening you're playing (Ruy
  Lopez, Sicilian, Queen's Gambit, French, Caro-Kann, English, and more) and
  explains the strategic ideas behind it.
- **Book recommendations** — principled next moves for the position you're in.
- **Move-by-move feedback** — every move you make is graded by *centipawn loss*
  against the engine's best move and labelled **Best / Good / Inaccuracy /
  Mistake / Blunder**, with plain-English tips.
- **Positional principles** — the coach flags things like bringing the queen out
  too early, knights on the rim, or neglecting development, and praises center
  control, development, and castling.
- **Hint button** — shows the engine's recommended move when you're stuck.

### Difficulty levels
Six levels, each with its own search depth, thinking-time budget, and
"human-ness" (weaker levels deliberately blunder and add evaluation noise):

| Level | Approx. rating | Style |
|-------|----------------|-------|
| Beginner | ~600 | Fast, blunders often |
| Casual | ~1000 | Still makes mistakes |
| Intermediate | ~1400 | Solid tactics, looks a few moves ahead |
| Advanced | ~1800 | Rarely blunders |
| Expert | ~2100 | Deep, accurate calculation |
| **Grandmaster** | ~2500 | Max depth + quiescence — a serious fight |

### Opponents & scouting
- **Named personalities at every ELO** — each opponent has a playing style:
  Aggressive, Tactical, Positional, Solid/Defensive, or Balanced. Styles are
  real: they reshape the engine's evaluation (material vs. king-attack vs.
  positional weighting) and give each personality its own **opening
  repertoire** (e.g. the Tactical players open with the King's Gambit, the
  Positional players prefer 1.d4/1.c4, the Defensive players play the London).
- **Scouting Report** — pick an opponent and read a dossier of their opening
  book (as White and Black), offense, defense, search depth, and a "how to beat
  it" tip.

### Rating, history & tournaments
- **Elo rating** starting at 1000, updated only after *uncoached* games (Coach
  off, Analysis off, no hints), with a **rating-history line chart**.
- **Tournament mode** — best-of-3/5/7 matches with alternating colors and a
  running scoreline.

### Saved games
- Finished games auto-save; a **Saved Games** panel lets you **replay** (step
  through) or delete them. Stored locally in the browser.

### Play & tools
- Click-to-move with legal-move highlighting and pawn-promotion picker.
- Play as **White or Black**; the board can be flipped.
- **Optional clocks** with configurable base time + increment.
- **Move history** in algebraic notation — click any move to review the
  position, or step through with the arrow keys / navigation buttons.
- **Live analysis**: evaluation bar and the engine's top candidate lines.
- **Undo** and **Copy PGN**.

## Under the hood

- **Engine** (`engine.js`): a from-scratch legal move generator (castling, en
  passant, promotion, check/checkmate/stalemate, draws), SAN + FEN support. It
  passes `perft` verification against the standard reference positions
  (startpos, Kiwipete, and positions 3–5) at every tested depth.
- **AI** (`ai.js`): a proper alpha-beta engine — **principal-variation search
  with a Zobrist-hashed transposition table** (persisted across moves),
  **null-move pruning**, **late-move reductions**, **check extensions**,
  killer-move and history-heuristic ordering, MVV-LVA captures, a quiescence
  search, and **iterative deepening under a per-move time budget**. Legality is
  checked lazily during search (a big speedup), so the Grandmaster reaches a
  serious depth (typically 6–10+ ply) in a few seconds.
  Evaluation blends material, piece-square tables (middlegame/endgame king),
  pawn structure (doubled/isolated/passed), rook files, king safety, the bishop
  pair, and a tempo bonus — plus per-personality style weighting.
- **Opening book**: all AIs play real, varied theory drawn from the opening
  library (weighted by style) before the search takes over.
- **Player profile**: name, nickname, and "member since" date, alongside your
  Elo rating, record, and rating-history graph — all saved locally.
- **Coach** (`coach.js`): an opening book keyed by move sequence plus a
  principle engine and a centipawn-loss move classifier.

## Running it

Open `chess-coach/index.html` directly in a browser — that's it. (The scripts
are plain classic scripts specifically so it works from a `file://` URL with no
server.)
