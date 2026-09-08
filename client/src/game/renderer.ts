// Renderizador 2D da arena. Desenha grade, peças, projeção fantasma, o pulso do
// lock delay, o flash das linhas eliminadas, partículas e um leve screen shake.
import { GameWorld } from "./game-world";
import { getCells, PIECE_COLORS } from "./pieces";
import { BLACKOUT_ROWS } from "./modifiers";
import { BOARD_HEIGHT, BOARD_WIDTH, type CellValue, type GameEvent, type GameSnapshot, type SavedRun } from "./types";

const GARBAGE_COLORS = { edge: "#5c7488", fill: "#33424f", glow: "#7c94a8" };

export type GameHandle = {
  world: GameWorld;
  resize: () => void;
  dispose: () => void;
};

type RendererCallbacks = {
  onSnapshot?: (snapshot: GameSnapshot) => void;
  onEvent?: (event: GameEvent) => void;
};

type RendererOptions = {
  savedRun?: SavedRun | null;
  seed?: number;
};

type Fx = { x: number; y: number; v: number; len: number; a: number };
const DANGER_ROW = 3;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type RowFlash = { row: number; life: number; max: number };
type FullFlash = { color: string; life: number; max: number };

const GRID_LINE = "rgba(101, 243, 255, 0.10)";
const FRAME_LINE = "rgba(101, 243, 255, 0.42)";
const BOARD_FILL = "rgba(7, 17, 31, 0.55)";

function getGhostY(snapshot: GameSnapshot) {
  let y = snapshot.active.y;
  const cells = getCells(snapshot.active.kind, snapshot.active.rotation);
  const collides = (testY: number) =>
    cells.some(({ x, y: localY }) => {
      const boardX = snapshot.active.x + x;
      const boardY = testY + localY;
      return (
        boardX < 0 ||
        boardX >= BOARD_WIDTH ||
        boardY >= BOARD_HEIGHT ||
        (boardY >= 0 && snapshot.board[boardY][boardX])
      );
    });
  while (!collides(y + 1)) y += 1;
  return y;
}

export function createGameRenderer(
  canvas: HTMLCanvasElement,
  callbacks: RendererCallbacks = {},
  options: RendererOptions = {}
): GameHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const world = options.savedRun
    ? GameWorld.fromSaved(options.savedRun)
    : new GameWorld(Math.random, options.seed);
  let latest: GameSnapshot = world.snapshot;
  const particles: Particle[] = [];
  const rowFlashes: RowFlash[] = [];
  let shake = 0;
  let fullFlash: FullFlash | null = null;

  // --- ambiente do cenário (efeito de fundo) ---
  const shell = canvas.closest<HTMLElement>(".game-shell");
  let scenario = shell?.dataset.scenario ?? "megacity";
  const fx: Fx[] = [];
  const seedFx = () => {
    fx.length = 0;
    const count = scenario === "datacenter" ? 0 : scenario === "orbit" ? 70 : 46;
    for (let i = 0; i < count; i += 1) {
      fx.push({
        x: Math.random(),
        y: Math.random(),
        v: 0.00006 + Math.random() * 0.00018,
        len: 6 + Math.random() * 18,
        a: 0.15 + Math.random() * 0.4,
      });
    }
  };
  seedFx();

  let cssWidth = 0;
  let cssHeight = 0;
  let cell = 0;
  let originX = 0;
  let originY = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = window.innerWidth || canvas.clientWidth || 360;
    cssHeight = window.innerHeight || canvas.clientHeight || 640;
    const nextW = Math.round(cssWidth * dpr);
    const nextH = Math.round(cssHeight * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const frame = canvas.ownerDocument.querySelector<HTMLElement>(".arena-viewport");
    const rect = frame?.getBoundingClientRect();
    const areaX = rect && rect.width > 40 ? rect.left : 0;
    const areaY = rect && rect.height > 40 ? rect.top : 0;
    const areaW = rect && rect.width > 40 ? rect.width : cssWidth;
    const areaH = rect && rect.height > 40 ? rect.height : cssHeight;
    const inset = Math.min(areaW, areaH) * 0.05;

    cell = Math.floor(Math.min((areaW - inset * 2) / BOARD_WIDTH, (areaH - inset * 2) / BOARD_HEIGHT));
    const boardW = cell * BOARD_WIDTH;
    const boardH = cell * BOARD_HEIGHT;
    originX = Math.round(areaX + (areaW - boardW) / 2);
    originY = Math.round(areaY + (areaH - boardH) / 2);
  };
  resize();

  const drawCell = (cx: number, cy: number, kind: Exclude<CellValue, null>, ghost: boolean) => {
    if (cy < 0) return;
    const colors = kind === "GARBAGE" ? GARBAGE_COLORS : PIECE_COLORS[kind];
    const px = originX + cx * cell;
    const py = originY + cy * cell;
    const pad = Math.max(1, Math.round(cell * 0.06));
    const size = cell - pad * 2;
    const radius = Math.max(2, Math.round(cell * 0.16));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(px + pad, py + pad, size, size, radius);
    else ctx.rect(px + pad, py + pad, size, size);
    if (ghost) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.strokeStyle = colors.edge;
      ctx.globalAlpha = 0.32;
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.save();
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = Math.max(4, cell * 0.35);
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1, cell * 0.07);
    ctx.strokeStyle = colors.edge;
    ctx.stroke();
  };

  const drawFx = (now: number) => {
    if (scenario === "datacenter") {
      // varredura de scanline
      const sweep = ((now / 3200) % 1) * cssHeight;
      const grad = ctx.createLinearGradient(0, sweep - 60, 0, sweep + 60);
      grad.addColorStop(0, "rgba(255,46,166,0)");
      grad.addColorStop(0.5, "rgba(255,46,166,0.06)");
      grad.addColorStop(1, "rgba(255,46,166,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, sweep - 60, cssWidth, 120);
      return;
    }
    const rain = scenario === "megacity";
    const ember = scenario === "reactor";
    for (const p of fx) {
      const px = p.x * cssWidth;
      const py = p.y * cssHeight;
      ctx.globalAlpha = p.a * 0.6;
      if (rain) {
        ctx.strokeStyle = "#65f3ff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, py + p.len);
        ctx.stroke();
      } else if (ember) {
        ctx.fillStyle = "#f5b94c";
        ctx.fillRect(px, py, 2, 2);
      } else {
        ctx.fillStyle = "#a9c6ff";
        ctx.fillRect(px, py, p.len > 16 ? 2 : 1, p.len > 16 ? 2 : 1);
      }
    }
    ctx.globalAlpha = 1;
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    drawFx(now);

    ctx.save();
    if (shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    const boardW = cell * BOARD_WIDTH;
    const boardH = cell * BOARD_HEIGHT;

    ctx.fillStyle = BOARD_FILL;
    ctx.fillRect(originX, originY, boardW, boardH);

    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID_LINE;
    ctx.beginPath();
    for (let x = 0; x <= BOARD_WIDTH; x += 1) {
      ctx.moveTo(originX + x * cell + 0.5, originY);
      ctx.lineTo(originX + x * cell + 0.5, originY + boardH);
    }
    for (let y = 0; y <= BOARD_HEIGHT; y += 1) {
      ctx.moveTo(originX, originY + y * cell + 0.5);
      ctx.lineTo(originX + boardW, originY + y * cell + 0.5);
    }
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = FRAME_LINE;
    ctx.strokeRect(originX - 1, originY - 1, boardW + 2, boardH + 2);

    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        const kind = latest.board[y][x];
        if (kind) drawCell(x, y, kind, false);
      }
    }

    const ghostY = getGhostY(latest);
    for (const { x, y } of getCells(latest.active.kind, latest.active.rotation)) {
      drawCell(latest.active.x + x, ghostY + y, latest.active.kind, true);
    }
    const activeCells = getCells(latest.active.kind, latest.active.rotation);
    for (const { x, y } of activeCells) {
      drawCell(latest.active.x + x, latest.active.y + y, latest.active.kind, false);
    }

    // Pulso do lock delay: quanto mais perto de travar, mais forte o contorno branco.
    if (latest.lockProgress > 0) {
      ctx.globalAlpha = 0.12 + latest.lockProgress * 0.4;
      ctx.lineWidth = Math.max(1.5, cell * 0.09);
      ctx.strokeStyle = "#ffffff";
      for (const { x, y } of activeCells) {
        const py = originY + (latest.active.y + y) * cell;
        if (latest.active.y + y < 0) continue;
        const px = originX + (latest.active.x + x) * cell;
        ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
      }
      ctx.globalAlpha = 1;
    }

    // Flash das linhas eliminadas.
    for (const flash of rowFlashes) {
      const t = 1 - flash.life / flash.max;
      if (t <= 0) continue;
      ctx.globalAlpha = t;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(originX, originY + flash.row * cell, boardW, cell);
    }
    ctx.globalAlpha = 1;

    for (const particle of particles) {
      const alpha = Math.max(0, 1 - particle.life / particle.maxLife);
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(
        originX + particle.x * cell - particle.size / 2,
        originY + particle.y * cell - particle.size / 2,
        particle.size,
        particle.size
      );
    }
    ctx.globalAlpha = 1;

    // BLACKOUT: escurece as linhas de baixo.
    if (latest.modifier === "blackout") {
      const y = originY + (BOARD_HEIGHT - BLACKOUT_ROWS) * cell;
      ctx.fillStyle = "rgba(2, 4, 10, 0.82)";
      ctx.fillRect(originX, y, boardW, BLACKOUT_ROWS * cell);
      ctx.strokeStyle = "rgba(167, 139, 250, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(originX, y + 0.5);
      ctx.lineTo(originX + boardW, y + 0.5);
      ctx.stroke();
    }

    // PULSO: tinta magenta enquanto a rajada de gravidade está ativa.
    if (latest.pulseActive) {
      ctx.fillStyle = "rgba(255, 46, 166, 0.07)";
      ctx.fillRect(originX, originY, boardW, boardH);
    }

    // PERIGO: pilha nas linhas do topo — vinheta vermelha pulsante.
    let topFilled = BOARD_HEIGHT;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      if (latest.board[y].some(Boolean)) {
        topFilled = y;
        break;
      }
    }
    if (topFilled <= DANGER_ROW && !latest.gameOver && !latest.paused) {
      const pulse = 0.14 + 0.12 * Math.sin(now / 160);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 46, 90, ${pulse})`;
      ctx.lineWidth = Math.max(6, cell * 0.5);
      ctx.strokeRect(originX, originY, boardW, boardH);
      ctx.restore();
    }

    ctx.restore();

    // Flash de tela cheia (garbage / checkpoint), fora do shake.
    if (fullFlash) {
      const t = Math.max(0, 1 - fullFlash.life / fullFlash.max);
      ctx.globalAlpha = t * 0.5;
      ctx.fillStyle = fullFlash.color;
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.globalAlpha = 1;
    }
  };

  const spawnBurst = (event: GameEvent) => {
    if (event.type !== "lineClear") return;
    const perfect = event.perfectClear;
    shake = Math.min(12, 2.5 + event.count * 2 + (perfect ? 6 : 0));
    const count = perfect ? 40 : 24 + event.count * 4;
    for (const row of event.rows) {
      rowFlashes.push({ row, life: 0, max: 260 });
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2;
        const speed = 0.006 + (index % 4) * 0.0018;
        particles.push({
          x: BOARD_WIDTH / 2,
          y: row + 0.5,
          vx: Math.cos(angle) * speed * cell,
          vy: Math.sin(angle) * speed * cell,
          life: 0,
          maxLife: 620 + (index % 5) * 60,
          size: Math.max(2, cell * (index % 3 ? 0.12 : 0.2)),
          color: perfect ? "#ffd45a" : index % 3 ? "#65f3ff" : "#ff2ea6",
        });
      }
    }
  };

  const unsubscribe = world.subscribe((snapshot) => {
    latest = snapshot;
    callbacks.onSnapshot?.(snapshot);
  });
  const unsubscribeEvents = world.onEvent((event) => {
    spawnBurst(event);
    if (event.type === "garbage") {
      shake = Math.max(shake, 5);
      rowFlashes.push({ row: BOARD_HEIGHT - 1, life: 0, max: 220 });
    }
    if (event.type === "checkpoint") {
      shake = Math.max(shake, event.ok ? 8 : 4);
      fullFlash = { color: event.ok ? "#9aff8a" : "#ff2ea6", life: 0, max: 340 };
    }
    if (event.type === "phase") {
      fullFlash = { color: "#65f3ff", life: 0, max: 300 };
    }
    callbacks.onEvent?.(event);
  });

  let frame = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const delta = Math.min(64, now - last);
    last = now;
    resize();
    world.update(delta);

    if (shake > 0.4) shake *= 0.86;
    else shake = 0;

    if (fullFlash) {
      fullFlash.life += delta;
      if (fullFlash.life >= fullFlash.max) fullFlash = null;
    }

    for (let index = rowFlashes.length - 1; index >= 0; index -= 1) {
      rowFlashes[index].life += delta;
      if (rowFlashes[index].life >= rowFlashes[index].max) rowFlashes.splice(index, 1);
    }

    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life += delta;
      particle.x += (particle.vx * delta) / (16 * cell);
      particle.y += (particle.vy * delta) / (16 * cell);
      particle.vy += 0.00002 * delta * cell;
      if (particle.life >= particle.maxLife) particles.splice(index, 1);
    }

    // cenário mudou? re-semeia o efeito de fundo
    const currentScenario = shell?.dataset.scenario ?? scenario;
    if (currentScenario !== scenario) {
      scenario = currentScenario;
      seedFx();
    }
    const up = scenario === "reactor";
    for (const p of fx) {
      p.y += (up ? -p.v : p.v) * delta;
      if (p.y > 1.05) p.y = -0.05;
      if (p.y < -0.05) p.y = 1.05;
    }

    draw(now);
    frame = window.requestAnimationFrame(loop);
  };
  frame = window.requestAnimationFrame(loop);

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  // A arena é dimensionada por flexbox/svh e pode mudar de tamanho sem um
  // "resize" de janela (fonte carregando, barra de URL recolhendo, gaveta
  // abrindo, rotação). Sem isto o tabuleiro fica preso na 1ª medição.
  let frameObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver === "function") {
    const frameEl = canvas.ownerDocument.querySelector<HTMLElement>(".arena-viewport");
    if (frameEl) {
      frameObserver = new ResizeObserver(() => resize());
      frameObserver.observe(frameEl);
    }
  }

  const demoParams = new URLSearchParams(window.location.search);
  const phaseParam = Number(demoParams.get("phase"));
  if (Number.isFinite(phaseParam) && phaseParam >= 2) world.jumpToPhase(phaseParam, demoParams.has("intro"));
  let demoTimer: number | undefined;
  let demoClearTimer: number | undefined;
  if (demoParams.has("demo") && demoParams.get("demo") !== "clear") {
    let demoStep = 0;
    demoTimer = window.setInterval(() => {
      if (demoStep % 3 === 0) world.rotate(1);
      world.move(demoStep % 2 === 0 ? -1 : 1);
      world.hardDrop();
      demoStep += 1;
    }, 900);
  }
  if (demoParams.get("demo") === "clear") {
    world.primeDemoClear();
    demoClearTimer = window.setTimeout(() => world.hardDrop(), 420);
  }

  return {
    world,
    resize,
    dispose: () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      frameObserver?.disconnect();
      if (demoTimer) window.clearInterval(demoTimer);
      if (demoClearTimer) window.clearTimeout(demoClearTimer);
      unsubscribe();
      unsubscribeEvents();
    },
  };
}
