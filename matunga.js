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

function initVisualEffects() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.body;
  const title = document.querySelector("h1.h2");

  const revealItems = document.querySelectorAll(".reveal");
  if (!reduceMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );
    revealItems.forEach((el) => observer.observe(el));
  } else {
    revealItems.forEach((el) => el.classList.add("in"));
  }

  if (reduceMotion) return;

  const parallaxEls = [...document.querySelectorAll(".parallax")];
  const auroraEl = document.querySelector(".fx-aurora");
  let raf = 0;

  function updateParallax(mx, my, sy) {
    root.style.setProperty("--mx", mx.toFixed(4));
    root.style.setProperty("--my", my.toFixed(4));
    root.style.setProperty("--scroll", Math.min(1, sy / 800).toFixed(4));

    parallaxEls.forEach((el) => {
      const depth = Number(el.getAttribute("data-depth") || "0");
      const tx = mx * depth * 18;
      const ty = my * depth * 14 - sy * depth * 0.18;
      el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
    });
    if (auroraEl) {
      auroraEl.style.transform = `translate3d(${(mx * -8).toFixed(2)}px, ${(my * -6 - sy * 0.03).toFixed(2)}px, 0)`;
    }
    if (title) {
      title.style.filter = `brightness(${(1 + Math.abs(mx) * 0.24 + Math.abs(my) * 0.2).toFixed(3)})`;
    }
  }

  let mouseX = 0;
  let mouseY = 0;
  let scrollY = window.scrollY;

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateParallax(mouseX, mouseY, scrollY);
    });
  }

  window.addEventListener("mousemove", (event) => {
    mouseX = event.clientX / window.innerWidth - 0.5;
    mouseY = event.clientY / window.innerHeight - 0.5;
    schedule();
  });

  window.addEventListener("scroll", () => {
    scrollY = window.scrollY;
    schedule();
  }, { passive: true });
}

function initParticles() {
  const nebulaCanvas = document.getElementById("fx-nebula");
  const particleCanvas = document.getElementById("fx-particles");
  if (!(nebulaCanvas instanceof HTMLCanvasElement) || !(particleCanvas instanceof HTMLCanvasElement)) return;

  const nctx = nebulaCanvas.getContext("2d");
  const pctx = particleCanvas.getContext("2d");
  if (!nctx || !pctx) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 1.6);
  let width = 0;
  let height = 0;
  let particles = [];
  let mouse = { x: 0, y: 0, active: false, push: false };
  let caGrid = [];
  let caW = 0;
  let caH = 0;
  let frame = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * (3 - 2 * t);
  const fract = (v) => v - Math.floor(v);
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

  function fbm(x, y, octaves = 4) {
    let value = 0;
    let amp = 0.55;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      value += valueNoise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.02;
    }
    return value / norm;
  }

  function fourier(t, phase) {
    return (
      Math.sin(t + phase) * 1 +
      Math.sin(2 * t - phase * 0.7) * 0.52 +
      Math.sin(3.6 * t + phase * 1.2) * 0.24
    );
  }

  function createParticle() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      age: Math.random() * 1000,
      speed: 0.34 + Math.random() * 0.45,
      hue: Math.random() < 0.55 ? 154 : 3,
      alpha: 0.08 + Math.random() * 0.16,
    };
  }

  function createCA() {
    caW = Math.max(36, Math.floor(width / 22));
    caH = Math.max(26, Math.floor(height / 22));
    caGrid = Array.from({ length: caW * caH }, () => (Math.random() < 0.17 ? 1 : 0));
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    [nebulaCanvas, particleCanvas].forEach((canvas) => {
      canvas.width = Math.floor(width * DPR);
      canvas.height = Math.floor(height * DPR);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    });
    nctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    pctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const count = Math.max(180, Math.min(460, Math.floor((width * height) / 4200)));
    particles = Array.from({ length: count }, createParticle);
    createCA();
    nctx.clearRect(0, 0, width, height);
    pctx.clearRect(0, 0, width, height);
  }

  function fieldAt(x, y, time, scrollN) {
    const nx = x * 0.0033;
    const ny = y * 0.0033;
    const noise = fbm(nx + time * 0.05, ny - time * 0.04, 4);
    const wave = fourier(nx * 1.9 + ny * 1.2, time * 1.3 + scrollN * 6);
    const angle = noise * Math.PI * 4 + wave * 0.55;
    return { angle, force: 0.7 + noise * 0.8 };
  }

  function updateCA() {
    if (frame % 6 !== 0 || caGrid.length === 0) return;
    const next = new Array(caGrid.length).fill(0);
    for (let y = 0; y < caH; y++) {
      for (let x = 0; x < caW; x++) {
        let neighbors = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = (x + ox + caW) % caW;
            const ny = (y + oy + caH) % caH;
            neighbors += caGrid[ny * caW + nx];
          }
        }
        const idx = y * caW + x;
        const alive = caGrid[idx] === 1;
        next[idx] = alive ? (neighbors === 2 || neighbors === 3 ? 1 : 0) : neighbors === 3 ? 1 : 0;
      }
    }
    caGrid = next;
  }

  function drawNebula(time, scrollN) {
    const step = 9;
    nctx.clearRect(0, 0, width, height);

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const nx = x / width;
        const ny = y / height;
        const n = fbm(nx * 3.4 + time * 0.06, ny * 3.1 - time * 0.05, 5);
        const w = fourier((nx - ny) * 5.4, time * 1.8 + scrollN * 5.2) * 0.12;
        const v = Math.max(0, Math.min(1, n + w));
        if (v < 0.44) continue;
        const hue = v > 0.63 ? 154 : 5;
        const alpha = (v - 0.42) * 0.11;
        nctx.fillStyle = `hsla(${hue}, 52%, ${hue === 154 ? 33 : 36}%, ${alpha.toFixed(3)})`;
        nctx.fillRect(x, y, step, step);
      }
    }

    const cellSizeX = width / caW;
    const cellSizeY = height / caH;
    nctx.fillStyle = "rgba(160, 192, 171, 0.04)";
    for (let y = 0; y < caH; y++) {
      for (let x = 0; x < caW; x++) {
        if (!caGrid[y * caW + x]) continue;
        nctx.fillRect(x * cellSizeX, y * cellSizeY, Math.max(1, cellSizeX * 0.7), Math.max(1, cellSizeY * 0.7));
      }
    }
  }

  function step() {
    frame++;
    const time = performance.now() * 0.00026;
    const scrollN = Math.min(1.2, window.scrollY / Math.max(500, document.body.scrollHeight - window.innerHeight));

    if (frame % 2 === 0) {
      updateCA();
      drawNebula(time, scrollN);
    }

    pctx.fillStyle = "rgba(14, 14, 14, 0.11)";
    pctx.fillRect(0, 0, width, height);

    const pointerInfluence = mouse.active ? 1 : 0;
    for (const p of particles) {
      p.age += 0.0034;
      const f = fieldAt(p.x, p.y, time + p.age, scrollN);
      let vx = Math.cos(f.angle) * p.speed * f.force;
      let vy = Math.sin(f.angle) * p.speed * f.force;

      if (pointerInfluence) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy) + 0.0001;
        const power = Math.max(0, 1 - dist / 260);
        const pull = (mouse.push ? -1 : 1) * power * 1.35;
        vx += (dx / dist) * pull;
        vy += (dy / dist) * pull;
      }

      p.x += vx;
      p.y += vy;

      if (p.x < -8) p.x = width + 8;
      if (p.x > width + 8) p.x = -8;
      if (p.y < -8) p.y = height + 8;
      if (p.y > height + 8) p.y = -8;

      const grad = pctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 6 + p.speed * 4);
      grad.addColorStop(0, `hsla(${p.hue}, 58%, 68%, ${p.alpha.toFixed(3)})`);
      grad.addColorStop(1, `hsla(${p.hue}, 58%, 68%, 0)`);
      pctx.fillStyle = grad;
      pctx.beginPath();
      pctx.arc(p.x, p.y, 5 + p.speed * 3.2, 0, Math.PI * 2);
      pctx.fill();
    }

    for (let i = 0; i < particles.length; i += 2) {
      for (let j = i + 1; j < particles.length; j += 3) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 62) continue;
        const opacity = (1 - dist / 62) * 0.09;
        pctx.strokeStyle = `rgba(145, 171, 157, ${opacity.toFixed(3)})`;
        pctx.lineWidth = 0.8;
        pctx.beginPath();
        pctx.moveTo(a.x, a.y);
        pctx.lineTo(b.x, b.y);
        pctx.stroke();
      }
    }

    if (!reduceMotion) requestAnimationFrame(step);
  }

  window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.active = true;
  });

  window.addEventListener("mouseleave", () => {
    mouse.active = false;
  });

  window.addEventListener("mousedown", () => {
    mouse.push = true;
  });

  window.addEventListener("mouseup", () => {
    mouse.push = false;
  });

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

initVisualEffects();
initParticles();
startGame();
