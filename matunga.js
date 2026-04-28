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

if (!boardEl || !statusEl || !historyEl || !modeEl || !newGameBtn || !undoBtn) {
  throw new Error("Elementos da interface não encontrados.");
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
  if (state.mode.startsWith("pvb") && state.turn === H) return true;
  return false;
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

  render();
}

function renderBoard() {
  boardEl.innerHTML = "";
  const validSet = new Set(state.validTargets.map(([r, c]) => `${r},${c}`));
  const winSet = new Set(state.winningCells.map(([r, c]) => `${r},${c}`));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell btn btn-sm";
      const piece = state.board[r][c];
      if (piece === U) button.classList.add("uni");
      if (piece === H) button.classList.add("hor");
      if (state.selected && state.selected[0] === r && state.selected[1] === c) button.classList.add("select");
      if (validSet.has(`${r},${c}`)) button.classList.add("valid");
      if (winSet.has(`${r},${c}`)) button.classList.add("win");
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

function initParticles() {
  const canvas = document.getElementById("fx-particles");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  let particles = [];

  function createParticle() {
    const warm = Math.random() < 0.62;
    const baseHue = warm ? 42 : 108;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * (warm ? 0.32 : 0.26),
      vy: (Math.random() - 0.5) * (warm ? 0.32 : 0.26),
      radius: Math.random() * 2.2 + 0.8,
      alpha: Math.random() * 0.45 + 0.18,
      hue: baseHue + (Math.random() * 16 - 8),
    };
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * DPR);
    canvas.height = Math.floor(height * DPR);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const count = Math.max(50, Math.min(140, Math.floor((width * height) / 17000)));
    particles = Array.from({ length: count }, createParticle);
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 7);
      grad.addColorStop(0, `hsla(${p.hue}, 90%, 68%, ${p.alpha})`);
      grad.addColorStop(1, `hsla(${p.hue}, 90%, 68%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 7, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 118) continue;
        const opacity = (1 - dist / 118) * 0.12;
        ctx.strokeStyle = `rgba(238, 214, 150, ${opacity})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    if (!reduceMotion) requestAnimationFrame(step);
  }

  resize();
  step();
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
  render();
  scheduleBotTurn();
});

initParticles();
startGame();
