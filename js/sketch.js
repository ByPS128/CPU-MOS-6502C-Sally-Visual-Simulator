// --- p5 entry point: render loop + step/run state machine ---------------------

const NOTE_FRAMES = 16;     // how long a "note" step is held
const INTER_DELAY = 2;      // pause between micro-steps
const INSTR_DELAY = 3;      // extra pause between instructions

let stepQueue = [];
let activeAnim = null;
let autoRun = false;
let halted = false;
let willHalt = false;
let delayTimer = 0;
let currentLine = -1;
let activeNode = null;
let activeDevice = null;
let lastNote = 'Press STEP or RUN';

function setup() {
  const c = createCanvas(CW, CH);
  c.parent('canvas-holder');
  textFont('monospace');
  cpuReset();
  anticReset();
  currentLine = lineFor(regs.PC);
  bindControls();
}

function draw() {
  background(255);
  anticUpdate();          // ANTIC runs continuously, independent of the CPU
  advance();              // CPU; pauses itself while ANTIC owns the bus
  drawHeader();
  drawASM(currentLine);
  drawSchematic(activeNode, activeDevice);
  drawDot();
  drawAnticDot();
  drawFooter();
}

// ---- state machine ----------------------------------------------------------

function advance() {
  if (halted) return;
  if (anticHalt) return;          // ANTIC has the bus — Sally is paused (cycle-stealing)
  if (delayTimer > 0) { delayTimer--; return; }

  if (activeAnim) {
    if (activeAnim.note) {
      if (--activeAnim.timer <= 0) finishStep();
    } else {
      activeAnim.elapsed++;
      if (activeAnim.elapsed >= activeAnim.frames) finishStep();
    }
    return;
  }

  if (stepQueue.length) {
    const s = stepQueue.shift();
    activeAnim = makeAnim(s);
    // highlight whichever endpoint is a register (prefer destination)
    if (isReg(s.to)) activeNode = s.to;
    else if (isReg(s.from)) activeNode = s.from;
    // highlight the decoded memory-mapped device for bus transfers
    activeDevice = (s.bus === 'addr' || s.bus === 'data') ? deviceFor(s.at).key : null;
    return;
  }

  // instruction finished
  if (willHalt) { halted = true; willHalt = false; lastNote = 'HALTED (BRK)'; activeNode = null; activeDevice = null; return; }
  if (autoRun) { loadNext(); delayTimer = INSTR_DELAY; }
}

function finishStep() {
  activeAnim.step.apply();
  lastNote = activeAnim.step.desc;
  activeAnim = null;
  delayTimer = INTER_DELAY;
}

function loadNext() {
  currentLine = lineFor(regs.PC);
  if (currentLine < 0) { halted = true; lastNote = 'No instruction at $' + hex4(regs.PC); return; }
  const { steps, halt } = execute();
  stepQueue.push(...steps);
  willHalt = halt;
}

function lineFor(pc) {
  const ln = asm.addrToLine[pc];
  return (ln === undefined) ? -1 : ln;
}

function isReg(name) { return NODES[name] !== undefined; }

// ---- animation construction -------------------------------------------------

function makeAnim(s) {
  if (s.bus === 'none' || s.from === s.to)
    return { step: s, note: true, timer: Math.max(10, Math.round(stepFrames() * 0.55)) };
  const path = routePath(s.from, s.to, s.bus, s.at);
  const segs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const len = dist(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
    segs.push(len); total += len;
  }
  // time-based: every step takes the same time, regardless of wire length
  return { step: s, note: false, path, segs, total, frames: stepFrames(), elapsed: 0 };
}

function posAlong(path, segs, total, distv) {
  let d = constrain(distv, 0, total);
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const t = segs[i] === 0 ? 0 : d / segs[i];
      const a = path[i], b = path[i + 1];
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    }
    d -= segs[i];
  }
  return path[path.length - 1];
}
function pointAlong(anim) {
  const d = anim.total * Math.min(1, anim.elapsed / anim.frames);
  return posAlong(anim.path, anim.segs, anim.total, d);
}

function currentSpeed() {
  const sl = document.getElementById('speed');
  return sl ? Number(sl.value) : 14;
}
// Time per micro-step (in frames), so long and short wires take the same time.
// Higher slider = faster = fewer frames.
function stepFrames() { return constrain(Math.round(map(currentSpeed(), 2, 30, 64, 3)), 3, 70); }

// ---- drawing the moving dot + header + footer -------------------------------

function drawDot() {
  if (!activeAnim || activeAnim.note) return;
  const p = pointAlong(activeAnim);
  const s = activeAnim.step;
  const isAddr = (s.bus === 'addr');

  noStroke(); fill(0);
  if (isAddr) rectMode(CENTER), rect(p.x, p.y, 14, 14), rectMode(CORNER);
  else circle(p.x, p.y, 15);

  if (s.value !== null && s.value !== undefined) {
    const txt = (s.fmt === 'hex4') ? '$' + hex4(s.value) : '$' + hex2(s.value);
    textSize(13); textAlign(CENTER, BOTTOM);
    const w = textWidth(txt) + 10;
    stroke(0); strokeWeight(1); fill(255);
    rect(p.x - w / 2, p.y - 31, w, 18, 2);
    noStroke(); fill(0); text(txt, p.x, p.y - 16);
  }
}

// ANTIC's DMA dot — drawn as a double ring to tell it apart from the CPU dot.
function drawAnticDot() {
  if (!anticDMA) return;
  const d = anticDMA.total * Math.min(1, anticDMA.elapsed / anticDMA.frames);
  const p = posAlong(anticDMA.path, anticDMA.segs, anticDMA.total, d);
  noFill(); stroke(0); strokeWeight(2); circle(p.x, p.y, 16); circle(p.x, p.y, 8);
  noStroke(); fill(0);
  const txt = '$' + hex2(anticDMA.value);
  textSize(12); textAlign(CENTER, TOP);
  const w = textWidth(txt) + 10;
  stroke(0); strokeWeight(1); fill(255);
  rect(p.x - w / 2, p.y + 13, w, 17, 2);
  noStroke(); fill(0); text(txt, p.x, p.y + 15);
  // small caption near the dot
  textSize(10); fill(90); text('ANTIC DMA', p.x, p.y + 33); fill(0);
}

function drawHeader() {
  noStroke(); fill(0);
  textAlign(LEFT, TOP); textSize(20);
  text('6502C "Sally" — Visual Simulator', 16, 14);
  textSize(11);
  text('a simplified Atari-800-class machine: CPU · address/data bus · RAM', 16, 42);

  // big current-action line, centred over the machine
  let desc, phase;
  if (anticDMA) {
    desc = 'ANTIC borrows the bus to read the picture — Sally waits';
    phase = 'DMA · cycle-stealing';
  } else if (nmiFlash > 16) {
    desc = 'ANTIC finished a frame → taps the CPU (NMI / VBLANK)';
    phase = 'INTERRUPT';
  } else {
    desc = activeAnim ? activeAnim.step.desc : lastNote;
    phase = activeAnim && !activeAnim.note
      ? (activeAnim.step.bus === 'addr' ? 'ADDRESS BUS' : activeAnim.step.bus === 'data' ? 'DATA BUS' : 'INTERNAL')
      : (halted ? '' : 'idle');
  }
  textAlign(CENTER, TOP); textSize(15);
  text(desc, (CPU_X + BUS_END) / 2, 20);
  textSize(11); fill(90);
  text(phase, (CPU_X + BUS_END) / 2, 42);
  fill(0);
}

function drawFooter() {
  const y = CH - 42;
  noStroke(); fill(0); textAlign(LEFT, TOP); textSize(12);
  const mode = halted ? 'HALTED' : autoRun ? 'RUNNING' : 'STEP MODE';
  text('Mode: ' + mode +
    '     A=$' + hex2(regs.A) + '  X=$' + hex2(regs.X) + '  Y=$' + hex2(regs.Y) +
    '  SP=$' + hex2(regs.SP) + '  PC=$' + hex4(regs.PC) +
    '   P[NV-BDIZC]=' + flagLetters(regs.P), 16, y);
  textAlign(RIGHT, TOP); fill(90);
  text('■ = address (16-bit)    ● = data/internal (8-bit)', CW - 16, y);
  fill(0);
}

// ---- HTML control wiring ----------------------------------------------------

function resetMachine(noteText) {
  cpuReset();
  anticReset();
  stepQueue = []; activeAnim = null; autoRun = false; halted = false;
  willHalt = false; delayTimer = 0; activeNode = null; activeDevice = null;
  currentLine = lineFor(regs.PC);
  lastNote = noteText || 'Reset — press STEP or RUN';
}

function bindControls() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('run', () => { if (!halted) autoRun = true; });
  on('pause', () => { autoRun = false; });
  on('step', () => {
    if (halted) return;
    autoRun = false;
    if (!activeAnim && stepQueue.length === 0 && delayTimer === 0) loadNext();
  });
  on('reset', () => resetMachine());

  // ANTIC live toggle
  const ant = document.getElementById('antic');
  if (ant) { anticLive = ant.checked; ant.addEventListener('change', () => { anticLive = ant.checked; }); }

  // populate the demo dropdown and load on change
  const sel = document.getElementById('demo');
  if (sel) {
    DEMOS.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = d.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      setDemo(Number(sel.value));
      resetMachine('Loaded: ' + currentDemoName + ' — press STEP or RUN');
    });
  }
}
