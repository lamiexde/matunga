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
const fxBoardCanvas = document.getElementById("fx-board");
const arenaEl = document.getElementById("arena");
const titleEl = document.getElementById("title");
const crtEl = document.getElementById("crt");

if (
  !boardEl || !statusEl || !historyWrapEl || !modeEl || !newGameBtn || !undoBtn || !arenaEl || !titleEl || !crtEl ||
  !(bgCanvas instanceof HTMLCanvasElement) || !(fxBoardCanvas instanceof HTMLCanvasElement)
) {
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
  animMove: null, // {piece, from,to,x,y,tx,ty}
  animFromBot: false,
};

const renderState = {
  mouseX: 0,
  mouseY: 0,
  scrollTarget: 0,
  scrollSmooth: 0,
  noiseT: 0,
  waveT: 0,
  flicker: 0.11,
  fire: null,
  particles: [],
  trails: [],
  boardRect: null,
};

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const FIRE_PALETTE = buildPalette();
let cellRefs = [];
let lastTime = performance.now();

function buildPalette() {
  const c0 = [11, 11, 10];
  const c1 = [110, 23, 23];
  const c2 = [213, 155, 69];
  const out = [];
  for (let i = 0; i <= 36; i++) {
    if (i <= 18) {
      const t = i / 18;
      out.push([
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ]);
    } else {
      const t = (i - 18) / 18;
      out.push([
        Math.round(c1[0] + (c2[0] - c1[0]) * t),
        Math.round(c1[1] + (c2[1] - c1[1]) * t),
        Math.round(c1[2] + (c2[2] - c1[2]) * t),
      ]);
    }
  }
  return out;
}

function other(player) {
  return player === U ? H : U;
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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
  if (state.gameOver || state.animMove) return false;
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
      item.type === "move" ? { ...item, move: { from: [...item.move.from], to: [...item.move.to] } } : { ...item }
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
    item.type === "move" ? { ...item, move: { from: [...item.move.from], to: [...item.move.to] } } : { ...item }
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

function cellCenter(r, c) {
  if (!renderState.boardRect) return { x: 0, y: 0 };
  const rect = renderState.boardRect;
  const cw = rect.width / SIZE;
  const ch = rect.height / SIZE;
  return { x: rect.left + cw * (c + 0.5), y: rect.top + ch * (r + 0.5) };
}

function startMoveAnimation(move, piece, fromBot) {
  const from = cellCenter(move.from[0], move.from[1]);
  const to = cellCenter(move.to[0], move.to[1]);
  state.animMove = {
    piece,
    from: [...move.from],
    to: [...move.to],
    x: from.x,
    y: from.y,
    tx: to.x,
    ty: to.y,
  };
  state.animFromBot = fromBot;
}

function finalizeMove(move, fromBot) {
  state.board = applyMove(state.board, move);
  state.history.push({ type: "move", player: state.turn, move });
  state.selected = null;
  state.validTargets = [];
  state.info = fromBot ? "Jogada do bot concluída." : "";

  addTrailForMove(move);

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

function executeMove(move, fromBot = false) {
  if (state.gameOver || state.animMove) return;
  const [fr, fc] = move.from;
  const piece = state.board[fr][fc];
  if (piece !== state.turn) return;

  saveSnapshot();
  startMoveAnimation(move, piece, fromBot);
}

function onCellClick(r, c) {
  if (state.gameOver || isBotTurn() || state.animMove) return;
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
  cellRefs = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const validSet = new Set(state.validTargets.map(([r, c]) => `${r},${c}`));
  const winSet = new Set(state.winningCells.map(([r, c]) => `${r},${c}`));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.r = String(r);
      button.dataset.c = String(c);
      let piece = state.board[r][c];

      if (state.animMove && state.animMove.from[0] === r && state.animMove.from[1] === c) {
        piece = "";
      }

      if (piece === U) button.classList.add("a");
      if (piece === H) button.classList.add("b");
      if (state.selected && state.selected[0] === r && state.selected[1] === c) button.classList.add("selected");
      if (validSet.has(`${r},${c}`)) button.classList.add("valid");
      if (winSet.has(`${r},${c}`)) {
        button.classList.add("win");
        button.style.setProperty("--win-color", state.winner === U ? "#d59b45" : "#69d49a");
      }

      button.textContent = piece === U ? "🦄" : piece === H ? "🐴" : "";
      button.addEventListener("click", () => onCellClick(r, c));
      button.addEventListener("mouseenter", () => { state.hoverCell = [r, c]; });

      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = `${r},${c}`;
      button.appendChild(coord);
      boardEl.appendChild(button);
      cellRefs[r][c] = button;
    }
  }
  boardEl.addEventListener("mouseleave", () => { state.hoverCell = null; }, { once: true });
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
  undoBtn.disabled = state.undoUsed || !state.snapshotBeforeMove || !!state.animMove;
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
  state.hoverCell = null;
  state.animMove = null;
  state.animFromBot = false;
  renderState.trails = [];
  applyPassLogic();
  render();
  scheduleBotTurn();
}

function initInput() {
  window.addEventListener("mousemove", (event) => {
    renderState.mouseX = event.clientX;
    renderState.mouseY = event.clientY;
    titleEl.style.setProperty("--tx", `${(event.clientX / window.innerWidth - 0.5) * 6}px`);
    titleEl.style.setProperty("--ty", `${(event.clientY / window.innerHeight - 0.5) * 4}px`);
  });

  window.addEventListener("scroll", () => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    renderState.scrollTarget = Math.min(1, window.scrollY / max);
  }, { passive: true });
}

function ensureBoardRect() {
  renderState.boardRect = boardEl.getBoundingClientRect();
  const arenaRect = arenaEl.getBoundingClientRect();
  const w = arenaRect.width;
  const h = arenaRect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxBoardCanvas.width = Math.max(1, Math.floor(w * dpr));
  fxBoardCanvas.height = Math.max(1, Math.floor(h * dpr));
  fxBoardCanvas.style.width = `${w}px`;
  fxBoardCanvas.style.height = `${h}px`;
}

function initFireBuffer(width, height) {
  const fw = Math.max(80, Math.floor(width / 4));
  const fh = Math.max(60, Math.floor(height / 4));
  const a = new Uint8Array(fw * fh);
  const b = new Uint8Array(fw * fh);
  for (let x = 0; x < fw; x++) a[(fh - 1) * fw + x] = 36;
  const fireCanvas = document.createElement("canvas");
  fireCanvas.width = fw;
  fireCanvas.height = fh;
  const fireCtx = fireCanvas.getContext("2d");
  if (!fireCtx) return null;
  return {
    fw,
    fh,
    a,
    b,
    fireCanvas,
    fireCtx,
    img: fireCtx.createImageData(fw, fh),
  };
}

function updateFire(dt) {
  if (!renderState.fire) {
    renderState.fire = initFireBuffer(bgCanvas.width / (window.devicePixelRatio || 1), bgCanvas.height / (window.devicePixelRatio || 1));
    if (!renderState.fire) return;
  }
  const fire = renderState.fire;
  const { fw, fh, a, b } = fire;
  b.fill(0);
  const fuel = 34 + Math.floor((1 - renderState.scrollSmooth) * 2);
  for (let x = 0; x < fw; x++) a[(fh - 1) * fw + x] = fuel;

  for (let y = 1; y < fh; y++) {
    const row = y * fw;
    const above = (y - 1) * fw;
    for (let x = 0; x < fw; x++) {
      const decay = (Math.random() * 4) | 0;
      const nx = clamp(x + ((Math.random() * 3) | 0) - 1, 0, fw - 1);
      const val = a[row + x] - decay;
      b[above + nx] = val > 0 ? val : 0;
    }
  }
  fire.a = b;
  fire.b = a;
}

function renderBackground(ctx, width, height, time) {
  if (!renderState.fire) return;
  const fire = renderState.fire;
  const { fw, fh, a, fireCtx, img, fireCanvas } = fire;
  const data = img.data;
  for (let i = 0; i < a.length; i++) {
    const color = FIRE_PALETTE[a[i]];
    const p = i * 4;
    data[p] = color[0];
    data[p + 1] = color[1];
    data[p + 2] = color[2];
    data[p + 3] = 255;
  }
  fireCtx.putImageData(img, 0, 0);

  ctx.clearRect(0, 0, width, height);
  const stripe = 4;
  const amp = 4 + renderState.scrollSmooth * 6;
  for (let y = 0; y < height; y += stripe) {
    const srcY = Math.floor((y / height) * fh);
    const offsetX = Math.sin(y * 0.018 + time * 0.003) * amp + Math.cos(y * 0.011 + time * 0.0023) * (amp * 0.35);
    ctx.drawImage(fireCanvas, 0, srcY, fw, 1, offsetX, y, width, stripe + 1);
  }
}

function initParticles(width, height) {
  const count = Math.max(90, Math.min(220, Math.floor((width * height) / 9000)));
  renderState.particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
  }));
}

function noiseLike(x, y, t) {
  return Math.sin(x * 0.012 + t * 0.0017) * 0.5 + Math.cos(y * 0.013 - t * 0.0014) * 0.5;
}

function updateParticles(width, height, time) {
  if (!renderState.particles.length) initParticles(width, height);
  const mx = renderState.mouseX;
  const my = renderState.mouseY;

  for (const p of renderState.particles) {
    const angle = noiseLike(p.x * 0.17, p.y * 0.17, time) * Math.PI * 2;
    p.vx += Math.cos(angle) * 0.06;
    p.vy += Math.sin(angle) * 0.06;

    const dx = mx - p.x;
    const dy = my - p.y;
    const d = Math.hypot(dx, dy) + 0.001;
    const force = Math.max(0, 1 - d / 260) * 0.22;
    p.vx += (dx / d) * force;
    p.vy += (dy / d) * force;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 1.6) {
      p.vx = (p.vx / speed) * 1.6;
      p.vy = (p.vy / speed) * 1.6;
    }
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;

    if (p.x < 0) p.x += width;
    if (p.x > width) p.x -= width;
    if (p.y < 0) p.y += height;
    if (p.y > height) p.y -= height;
  }
}

function renderParticles(ctx) {
  for (const p of renderState.particles) {
    ctx.fillStyle = "rgba(184,164,140,0.16)";
    ctx.fillRect(p.x, p.y, 2, 2);
  }
}

function renderDither(ctx, width, height, time) {
  const threshold = ((Math.sin(time * 0.0015) + 1) * 0.5) * 15;
  const step = 4;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const m = BAYER_4X4[(y / step) % 4][(x / step) % 4];
      if (m < threshold && Math.random() < 0.32) {
        ctx.fillStyle = "rgba(0,0,0,0.05)";
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

function updateCellLighting() {
  if (!cellRefs.length) return;
  const mx = renderState.mouseX;
  const my = renderState.mouseY;
  const radius = 260;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellRefs[r][c];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const d = Math.hypot(mx - cx, my - cy);
      const intensity = clamp(1 - d / radius, 0, 1);
      el.style.setProperty("--ray", intensity.toFixed(3));
    }
  }
}

function addTrailForMove(move) {
  const from = cellCenter(move.from[0], move.from[1]);
  const to = cellCenter(move.to[0], move.to[1]);
  const dr = to.y - from.y;
  const dc = to.x - from.x;
  const mid = Math.abs(dr) > Math.abs(dc)
    ? { x: from.x, y: from.y + dr * 0.65 }
    : { x: from.x + dc * 0.65, y: from.y };
  renderState.trails.push({
    points: [from, mid, to],
    life: 1,
    color: state.turn === U ? "rgba(213,155,69," : "rgba(105,212,154,",
  });
  if (renderState.trails.length > 12) renderState.trails.shift();
}

function drawKnightOverlay(fxCtx, rect) {
  const origin = state.selected || state.hoverCell;
  if (!origin) return;
  const [r, c] = origin;
  const o = cellCenter(r, c);
  const ox = o.x - rect.left;
  const oy = o.y - rect.top;

  fxCtx.strokeStyle = "rgba(184,164,140,0.18)";
  fxCtx.lineWidth = 1.1;
  fxCtx.beginPath();
  for (const [dr, dc] of DELTAS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    const t = cellCenter(nr, nc);
    fxCtx.moveTo(ox, oy);
    fxCtx.lineTo(t.x - rect.left, t.y - rect.top);
  }
  fxCtx.stroke();
}

function drawTrailsAndAnim() {
  const fxCtx = fxBoardCanvas.getContext("2d");
  if (!fxCtx || !renderState.boardRect) return;
  const rect = arenaEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxCtx.clearRect(0, 0, rect.width, rect.height);

  drawKnightOverlay(fxCtx, rect);

  for (const trail of renderState.trails) {
    fxCtx.lineWidth = 2.2;
    fxCtx.strokeStyle = `${trail.color}${trail.life.toFixed(3)})`;
    fxCtx.beginPath();
    trail.points.forEach((p, i) => {
      const x = p.x - rect.left;
      const y = p.y - rect.top;
      if (i === 0) fxCtx.moveTo(x, y);
      else fxCtx.lineTo(x, y);
    });
    fxCtx.stroke();
    trail.life -= 0.03;
  }
  renderState.trails = renderState.trails.filter((t) => t.life > 0);

  if (state.animMove) {
    const a = state.animMove;
    const x = a.x - rect.left;
    const y = a.y - rect.top;
    fxCtx.font = "26px serif";
    fxCtx.textAlign = "center";
    fxCtx.textBaseline = "middle";
    fxCtx.fillStyle = a.piece === U ? "rgba(213,155,69,0.96)" : "rgba(105,212,154,0.96)";
    fxCtx.fillText(a.piece === U ? "🦄" : "🐴", x, y);
  }
}

function updateAnimation() {
  if (!state.animMove) return;
  const a = state.animMove;
  a.x += (a.tx - a.x) * 0.2;
  a.y += (a.ty - a.y) * 0.2;
  const done = Math.hypot(a.tx - a.x, a.ty - a.y) < 1.4;
  if (!done) return;
  const move = { from: [...a.from], to: [...a.to] };
  const fromBot = state.animFromBot;
  state.animMove = null;
  state.animFromBot = false;
  finalizeMove(move, fromBot);
}

function finalizeMove(move, fromBot) {
  state.board = applyMove(state.board, move);
  state.history.push({ type: "move", player: state.turn, move });
  state.selected = null;
  state.validTargets = [];
  state.info = fromBot ? "Jogada do bot concluída." : "";
  addTrailForMove(move);

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

function loop(now) {
  const dt = Math.min(40, now - lastTime);
  lastTime = now;
  renderState.noiseT += dt * 0.001;
  renderState.waveT += dt * 0.0012;
  renderState.scrollSmooth += (renderState.scrollTarget - renderState.scrollSmooth) * 0.06;
  renderState.flicker = 0.105 + Math.sin(now * 0.026) * 0.02;
  crtEl.style.opacity = renderState.flicker.toFixed(3);

  const bgCtx = bgCanvas.getContext("2d");
  if (bgCtx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (bgCanvas.width !== Math.floor(w * dpr) || bgCanvas.height !== Math.floor(h * dpr)) {
      bgCanvas.width = Math.floor(w * dpr);
      bgCanvas.height = Math.floor(h * dpr);
      bgCanvas.style.width = `${w}px`;
      bgCanvas.style.height = `${h}px`;
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderState.fire = initFireBuffer(w, h);
      initParticles(w, h);
      ensureBoardRect();
    }

    updateFire(dt);
    renderBackground(bgCtx, w, h, now);
    updateParticles(w, h, now);
    renderParticles(bgCtx);
    renderDither(bgCtx, w, h, now);
  }

  updateAnimation();
  updateCellLighting();
  ensureBoardRect();
  drawTrailsAndAnim();

  requestAnimationFrame(loop);
}

newGameBtn.addEventListener("click", startGame);
modeEl.addEventListener("change", startGame);
undoBtn.addEventListener("click", () => {
  if (state.undoUsed || !state.snapshotBeforeMove || state.animMove) return;
  clearBotTimer();
  restoreSnapshot(state.snapshotBeforeMove);
  state.snapshotBeforeMove = null;
  state.undoUsed = true;
  state.info = "Última jogada desfeita.";
  render();
  scheduleBotTurn();
});

window.addEventListener("resize", ensureBoardRect);
initInput();
startGame();
requestAnimationFrame(loop);
