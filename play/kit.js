'use strict';
/* Shared kit for the toddler games: scaled canvas stage, speech, synthesized audio,
   particles, tweens, pointer input, the hold-to-go-home button and the main loop.
   A game page includes this file and then calls start({ VL, VP, update, draw, down, move, up, hint, layout }). */

const cv = document.getElementById('c');
const g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, SAFE_TOP = 0, T = 0;
let LY = null, K = 1, OX = 0, OY = 0;   // stage layout, scale and offset
let GAME = null, L = null, idle = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = k => 1 - Math.pow(1 - k, 3);
const inR = (x, y, r, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;
const EF = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const NF = 'ui-rounded,"SF Pro Rounded",system-ui,-apple-system,sans-serif';
const CONF = ['#ff4d4d', '#ff9a1f', '#ffd21f', '#4cd137', '#2e86ff', '#9b59ff', '#ff66c4'];

/* The game supplies a landscape (VL) and a portrait (VP) layout in virtual units. */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  SAFE_TOP = document.getElementById('sat').offsetHeight || 0;
  const prev = LY;
  LY = W >= H ? GAME.VL : GAME.VP;
  const avH = H - SAFE_TOP;
  K = Math.min(W / LY.w, avH / LY.h);
  OX = (W - LY.w * K) / 2; OY = SAFE_TOP + (avH - LY.h * K) / 2;
  if (prev !== LY && GAME.layout) GAME.layout();
}
const toStage = (x, y) => [(x - OX) / K, (y - OY) / K];
/* The visible screen, in stage units (the stage is letterboxed inside it). */
const view = () => ({ x0: -OX / K, y0: -OY / K, x1: (W - OX) / K, y1: (H - OY) / K });

/* ---------- language (en / uk / de, override with ?lang=xx) ---------- */
let voice = null;
function pickVoice() {
  if (!L || !('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices(), pre = L.code.slice(0, 2);
  voice = vs.find(v => v.lang.replace('_', '-') === L.code) || vs.find(v => v.lang.startsWith(pre)) || null;
}
function pickLang(LANGS) {
  const key = ((new URLSearchParams(location.search).get('lang')) || navigator.language || 'en').slice(0, 2).toLowerCase();
  L = LANGS[key] || LANGS.en;
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  return L;
}
function say(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = L.code; if (voice) u.voice = voice;
    u.rate = 0.95; u.pitch = 1.25; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---------- audio (all synthesized) ---------- */
let ac = null, master = null;
function unlockAudio() {
  if (!ac) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.7;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource();
    s.buffer = b; s.connect(ac.destination); s.start(0);
  }
  if (ac.state !== 'running') ac.resume();
}
function tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null, delay = 0) {
  if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), gn = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn); gn.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
const noiseBufs = {};
function noise(dur, vol = 0.3, freq = 2000, delay = 0, type = 'bandpass') {
  if (!ac) return;
  const key = Math.round(dur * 100);
  let buf = noiseBufs[key];
  if (!buf) {
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    noiseBufs[key] = buf;
  }
  const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
  s.buffer = buf; f.type = type; f.frequency.value = freq; gn.gain.value = vol;
  s.connect(f); f.connect(gn); gn.connect(master); s.start(t);
}
const sfx = {
  pick() { tone(520, 0.12, 'sine', 0.25, 880); },
  nope() { tone(300, 0.15, 'triangle', 0.2, 220); },
  pop() { tone(rand(500, 900), 0.08, 'sine', 0.2, 1400); },
  plop() { noise(0.12, 0.3, 700); tone(220, 0.1, 'sine', 0.25, 120); },
  nom() { noise(0.1, 0.35, 1200); tone(180, 0.09, 'square', 0.1, 120); },
  ding() { tone(1568, 0.5, 'sine', 0.3); tone(2093, 0.7, 'sine', 0.25, null, 0.12); },
  whoosh() { noise(0.4, 0.3, 700); },
  sparkle() { tone(rand(1400, 2400), 0.12, 'sine', 0.08); },
  yay() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.45, 'triangle', 0.22, null, i * 0.12)); }
};

/* ---------- drawing helpers ---------- */
function emoji(ch, x, y, size, rot = 0, alpha = 1) {
  g.save(); g.globalAlpha = alpha; g.translate(x, y); if (rot) g.rotate(rot);
  g.font = `${Math.round(size)}px ${EF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#000';   // emoji glyphs inherit the fill's alpha
  g.fillText(ch, 0, 0); g.restore();
}
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function disc(x, y, r, color) { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
function starPath(x, y, r, rot = 0) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r2 = i % 2 ? r * 0.45 : r, a = rot + i * Math.PI / 5 - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
  }
  g.closePath();
}
/* Fills the whole screen, including the letterbox bars around the stage. */
function backdrop(top, bottom) {
  const v = view(), gr = g.createLinearGradient(0, v.y0, 0, v.y1);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
}

/* ---------- particles (stage units) ---------- */
let parts = [];
function addP(p) { if (parts.length < 900) { p.max = p.life; parts.push(p); } }
function burst(x, y, colors, n, spd, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = spd * rand(0.3, 1);
    addP({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand((o.life || 1) * 0.6, o.life || 1),
      size: (o.size || 9) * rand(0.6, 1.3), color: pick(colors), g: o.g ?? 600, drag: o.drag ?? 0.97,
      type: o.type || 'confetti', ch: o.ch, rot: rand(0, 6), vr: rand(-10, 10) });
  }
}
function sparkleAt(x, y) {
  burst(x, y, ['#fff', '#ffe066', '#ffd6f5', '#bdf'], 10, 260, { type: 'star', g: 0, life: 0.6, size: 10, drag: 0.9 });
  sfx.sparkle();
}
function confettiRain() {
  const v = view();
  for (let k = 0; k < 150; k++) addP({
    x: rand(v.x0, v.x1), y: v.y0 + rand(-300, 0), vx: rand(-60, 60), vy: rand(50, 250), life: rand(2.2, 3.5),
    size: rand(7, 12), color: pick(CONF), g: 180, drag: 0.99, type: 'confetti', rot: rand(0, 6), vr: rand(-8, 8)
  });
}
function updateParts(dt) {
  for (const p of parts) {
    p.life -= dt; const d = Math.pow(p.drag, dt * 60);
    p.vx *= d; p.vy *= d; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  }
  const bottom = view().y1 + 200;
  parts = parts.filter(p => p.life > 0 && p.y < bottom);
}
function drawParts() {
  for (const p of parts) {
    const a = Math.min(1, 2 * p.life / p.max);
    g.globalAlpha = a; g.fillStyle = p.color;
    if (p.type === 'star') { starPath(p.x, p.y, p.size, p.rot); g.fill(); }
    else if (p.type === 'dot') { g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill(); }
    else if (p.type === 'emoji') emoji(p.ch, p.x, p.y, p.size, p.rot * 0.1, a);
    else { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size); g.restore(); }
  }
  g.globalAlpha = 1;
}

/* ---------- tweens ---------- */
function tween(o, x1, y1, d, arc, done) { o.tw = { x0: o.x, y0: o.y, x1, y1, t: 0, d, arc, done }; }
function stepTween(o, dt) {
  const w = o.tw; if (!w) return;
  w.t += dt; const k = Math.min(1, w.t / w.d), e = ease(k);
  o.x = lerp(w.x0, w.x1, e); o.y = lerp(w.y0, w.y1, e) - w.arc * Math.sin(Math.PI * k);
  if (k >= 1) { o.tw = null; w.done && w.done(o); }
}

/* ---------- parent-only way back to the /play/ menu: press and hold the house ---------- */
const HB = { id: null, t: 0, HOLD: 1.2 };
function hbPos() { const r = 26; return { x: W - r - 10, y: SAFE_TOP + r + 10, r }; }
function drawHomeBtn() {
  const p = hbPos();
  g.globalAlpha = 0.85; g.fillStyle = '#fff'; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); g.globalAlpha = 1;
  emoji('🏠', p.x, p.y + 2, p.r * 1.1);
  if (HB.id !== null) {
    g.lineWidth = p.r * 0.22; g.strokeStyle = '#ff4d4d'; g.lineCap = 'round';
    g.beginPath(); g.arc(p.x, p.y, p.r * 1.05, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, HB.t / HB.HOLD)); g.stroke();
  }
}

/* ---------- input: every finger is a pointer P the game can hang its own state on ---------- */
const ptrs = new Map();
let started = false;
function extras() {
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { extras(); if (ac && ac.state !== 'running') ac.resume(); }
});
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); unlockAudio();
  if (!started) { started = true; extras(); }
  idle = 0;
  const hp = hbPos();
  if (Math.hypot(e.clientX - hp.x, e.clientY - hp.y) < hp.r * 1.3) { HB.id = e.pointerId; HB.t = 0; return; }
  const [x, y] = toStage(e.clientX, e.clientY);
  const P = { x, y, sx: x, sy: y, far: false, kind: 'none' };
  ptrs.set(e.pointerId, P);
  if (GAME.down) GAME.down(P);
}, { passive: false });
cv.addEventListener('pointermove', e => {
  e.preventDefault();
  const P = ptrs.get(e.pointerId); if (!P) return;
  [P.x, P.y] = toStage(e.clientX, e.clientY);
  if (Math.hypot(P.x - P.sx, P.y - P.sy) > 14) P.far = true;
  idle = 0;
  if (GAME.move) GAME.move(P);
}, { passive: false });
function endPointer(e) {
  if (e.pointerId === HB.id) HB.id = null;
  const P = ptrs.get(e.pointerId); if (!P) return;
  ptrs.delete(e.pointerId);
  if (GAME.up) GAME.up(P);
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
for (const ev of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

/* ---------- main loop ---------- */
function start(game) {
  GAME = game;
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  if (GAME.init) GAME.init();
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; T += dt; idle += dt;
    if (HB.id !== null && (HB.t += dt) >= HB.HOLD) { HB.id = null; location.href = '../play/' + location.search; }
    GAME.update(dt); updateParts(dt);
    g.setTransform(DPR * K, 0, 0, DPR * K, DPR * OX, DPR * OY);
    GAME.draw(); drawParts();
    // a pointing hand shows the next step after a few idle seconds
    const p = idle > 4 && GAME.hint && GAME.hint();
    if (p) emoji('👆', p[0] + 10, p[1] + 50 + Math.abs(Math.sin(T * 5)) * 14, 62, -0.2, 0.95);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawHomeBtn();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
