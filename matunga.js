const SIZE = 6;
const U = "U";
const H = "H";

const DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

const L_SHAPES = [
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 1], [1, 1], [2, 0], [2, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 2]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [1, 1], [1, 2]],
  [[0, 2], [1, 0], [1, 1], [1, 2]],
];

const MODE_DEPTH = {
  pvp: 0,
  "pvb-easy": 1,
  "pvb-medium": 2,
  "pvb-hard": 4,
  bvb: 2,
};

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const historyWrapEl = document.getElementById("history");
const modeEl = document.getElementById("mode");
const newGameBtn = document.getElementById("new-game");
const undoBtn = document.getElementById("undo");
const bgCanvas = document.getElementById("bg");

if (!boardEl || !statusEl || !historyWrapEl || !modeEl || !newGameBtn || !undoBtn || !(bgCanvas instanceof HTMLCanvasElement)) {
  throw new Error("Elementos obrigatórios da interface não encontrados.");
}

const state = {
  board: [],
  turn: U,
  selected: null,
  validTargets: [],
  history: [],
  gameOver: false,
  winner: null,
  winningCells: [],
  mode: modeEl.value,
  undoUsed: false,
  snapshotBeforeMove: null,
  botTimer: null,
  info: "",
  lastMove: null,
  lastMoveAt: 0,
};

const bgState = {
  mouseX: 0,
  mouseY: 0,
  targetOffsetX: 0,
  targetOffsetY: 0,
  offsetX: 0,
  offsetY: 0,
  scrollTarget: 0,
  scrollValue: 0,
};

function other(player) {
  return player === U ? H : U;
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function pieceLabel(player) {
  return player === U ? "🦄 Unicórnio" : "🐴 Cavalo";
}

function moveText(move) {
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  return `(${fr},${fc})→(${tr},${tc})`;
}

function initialBoard() {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(""));
  [0, 2, 4].forEach((r) => (b[r][0] = U));
  [1, 3, 5].forEach((r) => (b[r][0] = H));
  [1, 3, 5].forEach((r) => (b[r][5] = U));
  [0, 2, 4].forEach((r) => (b[r][5] = H));
  return b;
}

function validMovesForPiece(board, r, c) {
  if (!board[r][c]) return [];
  return DELTAS
    .map(([dr, dc]) => [r + dr, c + dc])
    .filter(([nr, nc]) => inBounds(nr, nc) && board[nr][nc] === "");
}

function allMovesForPlayer(board, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] !== player) continue;
      for (const [nr, nc] of validMovesForPiece(board, r, c)) {
        moves.push({ from: [r, c], to: [nr, nc] });
      }
    }
  }
  return moves;
}

function applyMove(board, move) {
  const next = cloneBoard(board);
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  next[tr][tc] = next[fr][fc];
  next[fr][fc] = "";
  return next;
}

function checkWin(board, player) {
  const set = new Set();
  const pieces = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === player) {
        set.add(`${r},${c}`);
        pieces.push([r, c]);
      }
    }
  }

  for (const [r, c] of pieces) {
    for (const shape of L_SHAPES) {
      const coords = shape.map(([dr, dc]) => [r + dr, c + dc]);
      if (coords.every(([nr, nc]) => inBounds(nr, nc) && set.has(`${nr},${nc}`))) {
        return { won: true, coords };
      }
    }
  }
  return { won: false, coords: [] };
}

function countProtoL(board, player) {
  let total = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (const shape of L_SHAPES) {
        const coords = shape.map(([dr, dc]) => [r + dr, c + dc]);
        if (!coords.every(([nr, nc]) => inBounds(nr, nc))) continue;
        let mine = 0;
        let empty = 0;
        let blocked = 0;
        for (const [nr, nc] of coords) {
          if (board[nr][nc] === player) mine++;
          else if (board[nr][nc] === "") empty++;
          else blocked++;
        }
        if (mine === 3 && empty === 1 && blocked === 0) total++;
      }
    }
  }
  return total;
}

function countPairL(board, player) {
  let total = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (const shape of L_SHAPES) {
        const coords = shape.map(([dr, dc]) => [r + dr, c + dc]);
        if (!coords.every(([nr, nc]) => inBounds(nr, nc))) continue;
        let mine = 0;
        let blocked = 0;
        for (const [nr, nc] of coords) {
          if (board[nr][nc] === player) mine++;
          else if (board[nr][nc] !== "") blocked++;
        }
        if (mine === 2 && blocked <= 1) total++;
      }
    }
  }
  return total;
}

function evaluate(board, me) {
  const opp = other(me);
  if (checkWin(board, me).won) return 100000;
  if (checkWin(board, opp).won) return -100000;

  let score = 0;
  const center = [2.5, 2.5];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === me) {
        const dist = Math.abs(r - center[0]) + Math.abs(c - center[1]);
        score += 8 * (5 - dist);
      } else if (board[r][c] === opp) {
        const dist = Math.abs(r - center[0]) + Math.abs(c - center[1]);
        score -= 8 * (5 - dist);
      }
    }
  }
  score += 50 * countProtoL(board, me);
  score -= 30 * countProtoL(board, opp);
  score += 10 * countPairL(board, me);
  score -= 10 * countPairL(board, opp);
  score += 5 * allMovesForPlayer(board, me).length;
  score -= 5 * allMovesForPlayer(board, opp).length;
  return score;
}

function boardKey(board, turn, depth) {
  return `${turn}|${depth}|${board.map((row) => row.join("")).join("/")}`;
}

function minimax(board, depth, alpha, beta, turn, me, cache) {
  const key = boardKey(board, turn, depth);
  if (cache.has(key)) return cache.get(key);

  if (depth === 0 || checkWin(board, me).won || checkWin(board, other(me)).won) {
    const leaf = { score: evaluate(board, me), move: null };
    cache.set(key, leaf);
    return leaf;
  }

  const moves = allMovesForPlayer(board, turn);
  if (!moves.length) {
    const oppMoves = allMovesForPlayer(board, other(turn));
    if (!oppMoves.length) return { score: 0, move: null };
    return minimax(board, depth - 1, alpha, beta, other(turn), me, cache);
  }

  const maximizing = turn === me;
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestMove = null;

  const orderedMoves = moves
    .map((move) => ({ move, hint: evaluate(applyMove(board, move), me) }))
    .sort((a, b) => (maximizing ? b.hint - a.hint : a.hint - b.hint))
    .map((x) => x.move);

  for (const move of orderedMoves) {
    const result = minimax(applyMove(board, move), depth - 1, alpha, beta, other(turn), me, cache);
    const score = result.score;
    if (maximizing) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, score);
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
      beta = Math.min(beta, score);
    }
    if (beta <= alpha) break;
  }

  const out = { score: bestScore, move: bestMove };
  cache.set(key, out);
  return out;
}

function chooseBotMove() {
  const moves = allMovesForPlayer(state.board, state.turn);
  if (!moves.length) return null;

  const depth = MODE_DEPTH[state.mode] || 1;
  if (depth <= 1) {
    let best = moves[0];
    let bestScore = -Infinity;
    for (const move of moves) {
      const score = evaluate(applyMove(state.board, move), state.turn);
      if (score > bestScore) {
        best = move;
        bestScore = score;
      }
    }
    return best;
  }

  const cache = new Map();
  return minimax(state.board, depth, -Infinity, Infinity, state.turn, state.turn, cache).move;
}

function isBotTurn() {
  if (state.gameOver) return false;
  if (state.mode === "bvb") return true;
  return state.mode.startsWith("pvb") && state.turn === H;
}

function clearBotTimer() {
  if (state.botTimer) {
    clearTimeout(state.botTimer);
    state.botTimer = null;
  }
}

function scheduleBotTurn() {
  clearBotTimer();
  if (!isBotTurn()) return;
  state.botTimer = setTimeout(() => {
    if (!isBotTurn() || state.gameOver) return;
    const move = chooseBotMove();
    if (!move) {
      applyPassLogic();
      render();
      scheduleBotTurn();
      return;
    }
    executeMove(move, true);
  }, state.mode === "bvb" ? 420 : 280);
}

function saveSnapshot() {
  state.snapshotBeforeMove = {
    board: cloneBoard(state.board),
    turn: state.turn,
    selected: state.selected ? [...state.selected] : null,
    validTargets: state.validTargets.map(([r, c]) => [r, c]),
    history: state.history.map((item) =>
      item.type === "move"
        ? { ...item, move: { from: [...item.move.from], to: [...item.move.to] } }
        : { ...item }
    ),
    gameOver: state.gameOver,
    winner: state.winner,
    winningCells: state.winningCells.map(([r, c]) => [r, c]),
    info: state.info,
    lastMove: state.lastMove ? { from: [...state.lastMove.from], to: [...state.lastMove.to] } : null,
    lastMoveAt: state.lastMoveAt,
  };
}

function restoreSnapshot(snapshot) {
  state.board = cloneBoard(snapshot.board);
  state.turn = snapshot.turn;
  state.selected = snapshot.selected ? [...snapshot.selected] : null;
  state.validTargets = snapshot.validTargets.map(([r, c]) => [r, c]);
  state.history = snapshot.history.map((item) =>
    item.type === "move"
      ? { ...item, move: { from: [...item.move.from], to: [...item.move.to] } }
      : { ...item }
  );
  state.gameOver = snapshot.gameOver;
  state.winner = snapshot.winner;
  state.winningCells = snapshot.winningCells.map(([r, c]) => [r, c]);
  state.info = snapshot.info;
  state.lastMove = snapshot.lastMove ? { from: [...snapshot.lastMove.from], to: [...snapshot.lastMove.to] } : null;
  state.lastMoveAt = snapshot.lastMoveAt;
}

function applyPassLogic() {
  let passes = 0;
  while (passes < 2) {
    if (allMovesForPlayer(state.board, state.turn).length > 0) return;
    state.history.push({ type: "pass", player: state.turn });
    state.turn = other(state.turn);
    passes++;
  }
  state.gameOver = true;
  state.winner = null;
  state.winningCells = [];
  state.info = "Jogo travado.";
}

function executeMove(move, fromBot = false) {
  if (state.gameOver) return;
  const [fr, fc] = move.from;
  if (state.board[fr][fc] !== state.turn) return;

  saveSnapshot();
  state.board = applyMove(state.board, move);
  state.history.push({ type: "move", player: state.turn, move });
  state.selected = null;
  state.validTargets = [];
  state.info = fromBot ? "Jogada do bot concluída." : "";
  state.lastMove = { from: [...move.from], to: [...move.to] };
  state.lastMoveAt = performance.now();

  const result = checkWin(state.board, state.turn);
  if (result.won) {
    state.gameOver = true;
    state.winner = state.turn;
    state.winningCells = result.coords;
    render();
    return;
  }

  state.turn = other(state.turn);
  applyPassLogic();
  render();
  scheduleBotTurn();
}

function onCellClick(r, c) {
  if (state.gameOver || isBotTurn()) return;
  const piece = state.board[r][c];

  if (state.selected) {
    const valid = state.validTargets.some(([vr, vc]) => vr === r && vc === c);
    if (valid) {
      executeMove({ from: state.selected, to: [r, c] }, false);
      return;
    }
  }

  if (piece === state.turn) {
    state.selected = [r, c];
    state.validTargets = validMovesForPiece(state.board, r, c);
    state.info = state.validTargets.length ? "" : "Essa peça está sem movimentos.";
  } else {
    state.selected = null;
    state.validTargets = [];
    state.info = "";
  }

  renderBoard();
  renderStatus();
}

function renderBoard() {
  boardEl.innerHTML = "";
  const validSet = new Set(state.validTargets.map(([r, c]) => `${r},${c}`));
  const winSet = new Set(state.winningCells.map(([r, c]) => `${r},${c}`));
  const moving = state.lastMove && performance.now() - state.lastMoveAt < 190 ? state.lastMove : null;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      const piece = state.board[r][c];

      if (piece === U) button.classList.add("piece-a");
      if (piece === H) button.classList.add("piece-b");
      if (state.selected && state.selected[0] === r && state.selected[1] === c) button.classList.add("selected");
      if (validSet.has(`${r},${c}`)) button.classList.add("valid");
      if (winSet.has(`${r},${c}`)) {
        button.classList.add("win");
        button.style.setProperty("--win-color", state.winner === U ? "#d59b45" : "#69d49a");
      }
      if (moving) {
        if (moving.from[0] === r && moving.from[1] === c) button.classList.add("move-from");
        if (moving.to[0] === r && moving.to[1] === c) button.classList.add("move-to");
      }

      button.textContent = piece === U ? "🦄" : piece === H ? "🐴" : "";
      button.addEventListener("click", () => onCellClick(r, c));

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = `${r},${c}`;
      button.appendChild(coord);
      boardEl.appendChild(button);
    }
  }
}

function renderHistory() {
  const ol = document.createElement("ol");
  state.history.forEach((item, i) => {
    const li = document.createElement("li");
    if (item.type === "move") {
      li.innerHTML = `<strong>${i + 1}.</strong> ${pieceLabel(item.player)} ${moveText(item.move)}`;
    } else {
      li.innerHTML = `<strong>${i + 1}.</strong> ${pieceLabel(item.player)} sem jogadas (passa a vez)`;
    }
    if (i === state.history.length - 1) li.classList.add("latest");
    ol.appendChild(li);
  });
  historyWrapEl.innerHTML = "";
  historyWrapEl.appendChild(ol);
}

function renderStatus() {
  if (state.gameOver) {
    if (state.winner) {
      const cls = state.winner === U ? "a" : "b";
      statusEl.innerHTML = `<strong><span class="${cls}">${pieceLabel(state.winner)}</span> venceu!</strong>`;
    } else {
      statusEl.innerHTML = `<strong>Empate.</strong> <span class="warn">Nenhum jogador possui movimentos.</span>`;
    }
    return;
  }

  const cls = state.turn === U ? "a" : "b";
  const bot = isBotTurn() ? " (pensando...)" : "";
  const info = state.info ? `<br>${state.info}` : "";
  statusEl.innerHTML = `Vez: <strong><span class="${cls}">${pieceLabel(state.turn)}</span>${bot}</strong>${info}`;
}

function render() {
  undoBtn.disabled = state.undoUsed || !state.snapshotBeforeMove;
  renderBoard();
  renderHistory();
  renderStatus();
}

function startGame() {
  clearBotTimer();
  state.mode = modeEl.value;
  state.board = initialBoard();
  state.turn = U;
  state.selected = null;
  state.validTargets = [];
  state.history = [];
  state.gameOver = false;
  state.winner = null;
  state.winningCells = [];
  state.undoUsed = false;
  state.snapshotBeforeMove = null;
  state.info = "";
  state.lastMove = null;
  state.lastMoveAt = 0;
  applyPassLogic();
  render();
  scheduleBotTurn();
}

function initBackground() {
  const ctx = bgCanvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = 1;

  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = (v) => v - Math.floor(v);
  const fade = (t) => t * t * (3 - 2 * t);

  const LOW0 = [11, 11, 10];
  const LOW1 = [36, 24, 20];
  const MID = [31, 143, 95];
  const HIGH = [110, 23, 23];

  function hash2(x, y) {
    return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
  }

  function valueNoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const n00 = hash2(xi, yi);
    const n10 = hash2(xi + 1, yi);
    const n01 = hash2(xi, yi + 1);
    const n11 = hash2(xi + 1, yi + 1);

    const u = fade(xf);
    const v = fade(yf);

    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  }

  function fbm(x, y) {
    let total = 0;
    let amp = 0.58;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < 4; i++) {
      total += valueNoise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return total / norm;
  }

  function colorFor(v) {
    let c0;
    let c1;
    let t;
    if (v < 0.36) {
      c0 = LOW0;
      c1 = LOW1;
      t = v / 0.36;
    } else if (v < 0.72) {
      c0 = LOW1;
      c1 = MID;
      t = (v - 0.36) / 0.36;
    } else {
      c0 = MID;
      c1 = HIGH;
      t = (v - 0.72) / 0.28;
    }
    return [
      Math.round(lerp(c0[0], c1[0], t)),
      Math.round(lerp(c0[1], c1[1], t)),
      Math.round(lerp(c0[2], c1[2], t)),
    ];
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    bgCanvas.width = Math.floor(width * dpr);
    bgCanvas.height = Math.floor(height * dpr);
    bgCanvas.style.width = `${width}px`;
    bgCanvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(time) {
    bgState.offsetX += (bgState.targetOffsetX - bgState.offsetX) * 0.06;
    bgState.offsetY += (bgState.targetOffsetY - bgState.offsetY) * 0.06;
    bgState.scrollValue += (bgState.scrollTarget - bgState.scrollValue) * 0.06;

    const step = 14;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const nx = x / width;
        const ny = y / height;
        const n = fbm(
          nx * 4 + bgState.offsetX + time * 0.00011 + bgState.scrollValue * 0.8,
          ny * 4 + bgState.offsetY - time * 0.00009 - bgState.scrollValue * 0.6
        );
        const c = colorFor(n);
        ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
        ctx.fillRect(x, y, step, step);
      }
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener("mousemove", (event) => {
    bgState.mouseX = event.clientX / Math.max(1, width);
    bgState.mouseY = event.clientY / Math.max(1, height);
    bgState.targetOffsetX = (bgState.mouseX - 0.5) * 0.55;
    bgState.targetOffsetY = (bgState.mouseY - 0.5) * 0.55;
  });

  window.addEventListener("scroll", () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    bgState.scrollTarget = Math.min(1, window.scrollY / max);
  }, { passive: true });

  resize();
  requestAnimationFrame(draw);
  window.addEventListener("resize", resize);
}

newGameBtn.addEventListener("click", startGame);
modeEl.addEventListener("change", startGame);
undoBtn.addEventListener("click", () => {
  if (state.undoUsed || !state.snapshotBeforeMove) return;
  clearBotTimer();
  restoreSnapshot(state.snapshotBeforeMove);
  state.snapshotBeforeMove = null;
  state.undoUsed = true;
  state.info = "Última jogada desfeita.";
  render();
  scheduleBotTurn();
});

initBackground();
startGame();
