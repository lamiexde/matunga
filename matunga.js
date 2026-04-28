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
const historyEl = document.getElementById("history");
const modeEl = document.getElementById("mode");
const newGameBtn = document.getElementById("new-game");
const undoBtn = document.getElementById("undo");
const titleEl = document.getElementById("brand-title");
const stageEl = document.getElementById("stage");
const body = document.body;

if (!boardEl || !statusEl || !historyEl || !modeEl || !newGameBtn || !undoBtn || !titleEl || !stageEl) {
  throw new Error("Estrutura de interface incompleta.");
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
  hoverCell: null,
};

const fxState = {
  mouseX: 0.5,
  mouseY: 0.5,
  mouseWorldX: 0,
  mouseWorldY: 0,
  mouseDown: false,
  boardEnergy: 0,
  movePulse: 0,
  scrollTarget: 0,
  scrollCurrent: 0,
};

let cellRefs = [];

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
  }, state.mode === "bvb" ? 420 : 300);
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
  fxState.movePulse = 1.0;

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

function applyCellForceField() {
  if (!cellRefs.length) return;
  const [hr, hc] = state.hoverCell || [-999, -999];
  const energy = fxState.boardEnergy;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellRefs[r][c];
      if (!el) continue;
      const dx = c - hc;
      const dy = r - hr;
      const dist = Math.hypot(dx, dy);
      const baseForce = state.hoverCell ? Math.max(0, 1 - dist / 2.8) : 0;
      const force = baseForce * (0.55 + energy * 0.45);
      const fx = dist < 0.001 ? 0 : dx / (dist + 0.001);
      const fy = dist < 0.001 ? 0 : dy / (dist + 0.001);
      el.style.setProperty("--force", force.toFixed(3));
      el.style.setProperty("--fx", (fx * force).toFixed(3));
      el.style.setProperty("--fy", (fy * force).toFixed(3));
    }
  }
}

function renderBoard() {
  boardEl.innerHTML = "";
  cellRefs = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const validSet = new Set(state.validTargets.map(([r, c]) => `${r},${c}`));
  const winSet = new Set(state.winningCells.map(([r, c]) => `${r},${c}`));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot";
      button.dataset.r = String(r);
      button.dataset.c = String(c);
      const piece = state.board[r][c];

      if (piece === U) button.classList.add("unicorn");
      if (piece === H) button.classList.add("horse");
      if (state.selected && state.selected[0] === r && state.selected[1] === c) button.classList.add("selected");
      if (validSet.has(`${r},${c}`)) button.classList.add("valid");
      if (winSet.has(`${r},${c}`)) button.classList.add("winning");
      button.textContent = piece === U ? "🦄" : piece === H ? "🐴" : "";
      button.addEventListener("click", () => onCellClick(r, c));
      button.addEventListener("mouseenter", () => {
        state.hoverCell = [r, c];
        fxState.boardEnergy = Math.min(1, fxState.boardEnergy + 0.35);
        applyCellForceField();
      });

      const coord = document.createElement("span");
      coord.className = "rc";
      coord.textContent = `${r},${c}`;
      button.appendChild(coord);
      boardEl.appendChild(button);
      cellRefs[r][c] = button;
    }
  }
  applyCellForceField();
}

function renderHistory() {
  historyEl.innerHTML = "";
  state.history.forEach((item, i) => {
    const li = document.createElement("li");
    if (item.type === "move") {
      li.innerHTML = `<strong>${i + 1}.</strong> ${pieceLabel(item.player)} ${moveText(item.move)}`;
    } else {
      li.innerHTML = `<strong>${i + 1}.</strong> ${pieceLabel(item.player)} sem jogadas (passa a vez)`;
    }
    historyEl.appendChild(li);
  });
}

function renderStatus() {
  if (state.gameOver) {
    if (state.winner) {
      const cls = state.winner === U ? "u" : "h";
      statusEl.innerHTML = `<strong><span class="${cls}">${pieceLabel(state.winner)}</span> venceu!</strong>`;
      return;
    }
    statusEl.innerHTML = `<strong>Empate.</strong> <span class="warn">Nenhum jogador possui movimentos.</span>`;
    return;
  }
  const cls = state.turn === U ? "u" : "h";
  const bot = isBotTurn() ? " (pensando...)" : "";
  const infoClass = state.info.includes("travado") ? "warn" : "ok";
  const info = state.info ? ` <span class="${infoClass}">${state.info}</span>` : "";
  statusEl.innerHTML = `Vez: <strong><span class="${cls}">${pieceLabel(state.turn)}</span>${bot}</strong>${info}`;
}

function render() {
  undoBtn.disabled = state.undoUsed || !state.snapshotBeforeMove;
  renderBoard();
  renderHistory();
  renderStatus();
}

function initUIPhysics() {
  boardEl.addEventListener("mouseleave", () => {
    state.hoverCell = null;
  });

  window.addEventListener("mousemove", (event) => {
    const nx = event.clientX / window.innerWidth - 0.5;
    const ny = event.clientY / window.innerHeight - 0.5;
    fxState.mouseX = nx;
    fxState.mouseY = ny;
    fxState.mouseWorldX = event.clientX;
    fxState.mouseWorldY = event.clientY;
  });

  window.addEventListener("scroll", () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    fxState.scrollTarget = Math.min(1, window.scrollY / max);
  }, { passive: true });

  window.addEventListener("mousedown", () => { fxState.mouseDown = true; });
  window.addEventListener("mouseup", () => { fxState.mouseDown = false; });
}

function startVisualLoop() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  let tilt = 0;
  function frame() {
    fxState.scrollCurrent += (fxState.scrollTarget - fxState.scrollCurrent) * 0.06;
    fxState.boardEnergy *= 0.92;
    fxState.movePulse *= 0.94;
    tilt += (fxState.mouseX * 0.9 - tilt) * 0.08;

    body.style.setProperty("--mx", fxState.mouseX.toFixed(4));
    body.style.setProperty("--my", fxState.mouseY.toFixed(4));
    body.style.setProperty("--tilt", tilt.toFixed(4));
    body.style.setProperty("--scroll-energy", fxState.scrollCurrent.toFixed(4));
    body.style.setProperty("--pulse", fxState.movePulse.toFixed(4));

    if (state.hoverCell) applyCellForceField();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function startBackgroundSystem() {
  const canvas = document.getElementById("bg-system");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0;
  let h = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let particles = [];
  let automata = [];
  let cellCols = 0;
  let cellRows = 0;
  let frameCount = 0;

  const fract = (v) => v - Math.floor(v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * (3 - 2 * t);
  const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);

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

  function fbm(x, y, oct = 5) {
    let total = 0;
    let amp = 0.5;
    let freq = 1.0;
    let sumAmp = 0;
    for (let i = 0; i < oct; i++) {
      total += valueNoise(x * freq, y * freq) * amp;
      sumAmp += amp;
      amp *= 0.5;
      freq *= 2.02;
    }
    return total / sumAmp;
  }

  function fourierWave(t, phase) {
    return (
      Math.sin(t + phase) * 1.0 +
      Math.sin(2.0 * t - phase * 0.61) * 0.5 +
      Math.sin(3.4 * t + phase * 1.34) * 0.24
    );
  }

  function vectorField(x, y, time) {
    const nx = x * 0.0028;
    const ny = y * 0.0028;
    const n = fbm(nx + time * 0.1, ny - time * 0.08, 4);
    const f = fourierWave(nx * 1.7 + ny * 1.4, time * 2.3 + fxState.scrollCurrent * 3.5);
    const angle = n * Math.PI * 4.5 + f * 0.48;
    return {
      ax: Math.cos(angle),
      ay: Math.sin(angle),
      mag: 0.3 + n * 0.65,
    };
  }

  function createParticle() {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      hue: Math.random() < 0.56 ? 150 : 4,
      life: Math.random() * 1000,
      alpha: 0.08 + Math.random() * 0.16,
      mass: 0.6 + Math.random() * 1.3,
    };
  }

  function initAutomata() {
    cellCols = Math.max(28, Math.floor(w / 26));
    cellRows = Math.max(18, Math.floor(h / 26));
    automata = Array.from({ length: cellCols * cellRows }, () => (Math.random() < 0.16 ? 1 : 0));
  }

  function stepAutomata() {
    if (frameCount % 5 !== 0) return;
    const next = new Array(automata.length).fill(0);
    for (let y = 0; y < cellRows; y++) {
      for (let x = 0; x < cellCols; x++) {
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = (x + ox + cellCols) % cellCols;
            const ny = (y + oy + cellRows) % cellRows;
            n += automata[ny * cellCols + nx];
          }
        }
        const idx = y * cellCols + x;
        const alive = automata[idx] === 1;
        next[idx] = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    automata = next;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = Array.from({ length: Math.max(220, Math.min(560, Math.floor((w * h) / 3500))) }, createParticle);
    initAutomata();
  }

  function drawProceduralField(time) {
    const s = 11;
    ctx.clearRect(0, 0, w, h);

    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        const nx = x / w;
        const ny = y / h;
        const n = fbm(nx * 3.6 + time * 0.08, ny * 3.3 - time * 0.06, 4);
        const wave = fourierWave((nx - ny) * 5.2, time * 1.9 + fxState.scrollCurrent * 7.4) * 0.09;
        const v = n + wave;
        if (v < 0.43) continue;
        const hue = v > 0.64 ? 152 : 5;
        const alpha = (v - 0.4) * (0.22 + fxState.boardEnergy * 0.08 + fxState.movePulse * 0.12);
        ctx.fillStyle = `hsla(${hue}, 56%, ${hue === 152 ? 26 : 30}%, ${alpha.toFixed(3)})`;
        ctx.fillRect(x, y, s, s);
      }
    }

    const cw = w / cellCols;
    const ch = h / cellRows;
    for (let y = 0; y < cellRows; y++) {
      for (let x = 0; x < cellCols; x++) {
        if (!automata[y * cellCols + x]) continue;
        const hue = (x + y + Math.floor(time * 100)) % 7 < 4 ? 152 : 6;
        ctx.fillStyle = `hsla(${hue}, 52%, 46%, 0.04)`;
        ctx.fillRect(x * cw, y * ch, Math.max(1, cw * 0.74), Math.max(1, ch * 0.74));
      }
    }
  }

  function updateParticles(time) {
    const mx = fxState.mouseWorldX;
    const my = fxState.mouseWorldY;
    const mouseActive = mx > 0 && my > 0;
    const pulse = fxState.movePulse;

    ctx.fillStyle = "rgba(8, 8, 8, 0.14)";
    ctx.fillRect(0, 0, w, h);

    for (const p of particles) {
      p.life += 0.004;

      const f = vectorField(p.x, p.y, time + p.life);
      p.vx += f.ax * 0.08 * f.mag;
      p.vy += f.ay * 0.08 * f.mag;

      if (mouseActive) {
        const dx = mx - p.x;
        const dy = my - p.y;
        const d = Math.hypot(dx, dy) + 0.001;
        const influence = Math.max(0, 1 - d / 220);
        const force = influence * (fxState.mouseDown ? -0.9 : 0.74);
        p.vx += (dx / d) * force;
        p.vy += (dy / d) * force;
      }

      p.vx += (Math.random() - 0.5) * 0.02;
      p.vy += (Math.random() - 0.5) * 0.02;

      p.vx *= 0.965;
      p.vy *= 0.965;

      p.x += p.vx * p.mass;
      p.y += p.vy * p.mass;

      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;

      const radius = 4 + p.mass * 2.8 + pulse * 4;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 1.8);
      grad.addColorStop(0, `hsla(${p.hue}, 60%, 64%, ${(p.alpha + pulse * 0.22).toFixed(3)})`);
      grad.addColorStop(1, `hsla(${p.hue}, 60%, 64%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i += 2) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j += 6) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d > 72) continue;
        const alpha = (1 - d / 72) * (0.06 + pulse * 0.1);
        ctx.strokeStyle = `rgba(138, 166, 149, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function animate() {
    if (reduceMotion) return;
    frameCount++;
    const t = performance.now() * 0.00024;
    stepAutomata();
    drawProceduralField(t);
    updateParticles(t);
    requestAnimationFrame(animate);
  }

  resize();
  if (!reduceMotion) requestAnimationFrame(animate);
  window.addEventListener("resize", resize);
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
  applyPassLogic();
  render();
  scheduleBotTurn();
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
  fxState.movePulse = 0.45;
  render();
  scheduleBotTurn();
});

initUIPhysics();
startVisualLoop();
startBackgroundSystem();
startGame();
