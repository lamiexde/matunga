# Copilot Instructions for this Repository

## Build, test, and lint commands

Use Node to run locally:

```bash
npm start
```

This runs `server.js` on port `8000` by default (or `PORT` env var).

There is no test or lint setup yet, and no single-test command yet.

For local preview during edits, run:

```bash
PORT=8000 node server.js
```

Then open `http://localhost:8000/matunga.html`.

## High-level architecture

- `matunga-exemple.html` is the gameplay/rules specification source.
- `matunga.html` is the playable app shell (Bootstrap layout + custom theme styles).
- `matunga.js` contains game state, rules, rendering, input handling, history/undo, and bot AI (minimax + alpha-beta).
- `server.js` is a small Node static file server used for local development.

## Key conventions in this codebase

- Coordinate convention is row/column (`r,c`) with 0-based indices on a fixed **6×6** board.
- Board state examples use `board[row][col]` and encode occupants as:
  - `""` for empty
  - `"U"` for unicórnio
  - `"H"` for cavalo
- Rule logic follows the spec constants (`DELTAS`, `L_SHAPES`) and checks victory after each move.
- Human-facing text remains in Brazilian Portuguese and keeps iconography (`🦄`, `🐴`).
- Styling uses Bootstrap for structure plus project tokens in `:root` for board/theme consistency.
