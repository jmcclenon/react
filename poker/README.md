# Five Card Stud Poker 🂡

A complete browser-based **five-card stud poker** game with table graphics,
chips / game money, AI opponents, and a persistent bankroll — packaged as a
self-contained Docker project.

Everything (cards, felt table, chips, animations) is drawn with plain
HTML/CSS/SVG and vanilla JavaScript, so there are **no external assets or CDNs**
— it runs fully offline once the container is up.

![stack](https://img.shields.io/badge/stack-vanilla%20JS%20%2B%20nginx-brightgreen)

---

## Quick start (Docker)

From this `poker/` directory:

```bash
docker compose up --build
```

Then open <http://localhost:8080>.

Or with plain Docker:

```bash
docker build -t five-card-stud-poker .
docker run --rm -p 8080:80 five-card-stud-poker
```

> On Windows (e.g. `g:\dev\poker`) run the same commands from a terminal
> opened in this folder. The game is served on port **8080**.

To stop: `docker compose down` (or `Ctrl+C`).

### Without Docker

It's just static files — open `public/index.html` in a browser, or serve the
folder with any static server:

```bash
cd public && python -m http.server 8080
```

---

## How to play

Five-card stud is dealt as follows:

1. **Ante** — every player posts a small ante into the pot.
2. Each player gets **one hole card (face down)** and **one up card**.
3. There are **four betting rounds**; before each of the last three a new
   **up card** is dealt to every remaining player.
4. On your turn choose **Fold, Check, Call, Bet,** or **Raise**.
5. At **showdown** the best five-card poker hand wins the pot.

**Stakes:** Ante \$5 · Small bet \$10 (first two rounds) · Big bet \$20 (last two)
· max 4 raises per round.

Your bankroll starts at **\$1,000** and is saved in your browser
(`localStorage`), so it persists between visits. Bust out and you can buy back
in; the AI opponents automatically rebuy so the table stays full. Use
**Reset Bankroll** to start over.

---

## Project layout

```
poker/
├── Dockerfile            # nginx:alpine serving the static game
├── docker-compose.yml    # one-command run on :8080
├── nginx.conf            # SPA-friendly static config
├── .dockerignore
└── public/
    ├── index.html
    ├── css/style.css     # table, cards, chips, layout
    └── js/
        ├── handEvaluator.js  # 5-card poker ranking (+ tiebreakers)
        ├── cards.js          # deck, shuffle, SVG card rendering
        ├── ai.js             # opponent decision heuristics
        ├── game.js           # engine: dealing, betting, side pots, showdown
        └── main.js           # DOM rendering & input wiring
```

## Notes on the engine

- **Hand ranking** is a full evaluator: straight/royal flush, quads, full
  house, flush, straight (including the A-2-3-4-5 wheel), trips, two pair,
  pair, high card — all with correct kicker tiebreakers.
- **Side pots** are computed from each player's committed chips, so all-in
  situations pay out correctly.
- **AI** estimates its own hand strength, reads opponents' visible up cards,
  weighs pot odds, and bluffs occasionally.

The hand evaluator and the full betting/showdown loop are covered by headless
tests (see the game's development notes); chip totals are conserved across
thousands of simulated hands.
