import { WhisperClient, MicVAD } from './speech.js';
import { HandThreads, Sparks, registerText, loadFaceLandmarker, loadHandLandmarker, placement, CHARSETS, makeLayout, Processor, Mapper, Renderer, loadSegmenter, buildBackground, seekTo, clamp } from './engine.js';
import * as Mp4 from './vendor/mp4-muxer.mjs';
import * as WebM from './vendor/webm-muxer.mjs';

const $ = (id) => document.getElementById(id);

// ---------- settings ----------
const S = {
  hands: true, showFig: true, gest: true, smoke: false, audioReact: false, speech: false, subs: true, subsPos: 'bottom', wordSpeed: 1.5, performance: false, speechLang: 'auto', speechEngine: 'whisper', speechModel: 'whisper-small', text: '', rainShed: 0.5, rain: false, rainMode: 'flow', rainAmt: 0.3, rainSpeed: 1,
  charset: 'code', size: 5.5, liveness: 0.2, words: true,
  brightness: -0.04, contrast: 1.5, boost: 0.55, edge: 0.5, stab: 0.45,
  mode: 'smart', supp: 0.35, grow: 1, sil: 0,
  fg: '#f1eee4', bg: '#050505',
  format: 'orig', fit: 'contain', zoom: 1, panX: 0.55, panY: 0.5,
  intro: 2.5, outro: 2.5, noTrans: false,
  preview: 1280, exportH: 1080, fps: 30,
};
const LAYOUT_KEYS = ['format', 'size', 'preview'];
const ANALYSIS_KEYS = ['mode', 'contrast', 'brightness', 'boost', 'edge', 'stab', 'supp', 'grow', 'sil', 'fit', 'zoom', 'panX', 'panY'];
const STYLE_KEYS = ['fg', 'bg'];

const UI = [
  { title: 'Video clip', items: [
    { t: 'trim' },
  ] },
  { title: 'Characters', items: [
    { t: 'select', k: 'charset', label: 'Character set', opts: Object.entries(CHARSETS).map(([v, c]) => [v, c.label]) },
    { t: 'range', k: 'size', label: 'Character size', min: 5, max: 22, step: 0.5, fmt: (v) => v + ' px' },
    { t: 'range', k: 'wordSpeed', label: 'Word scroll speed', min: 0.2, max: 8, step: 0.1, fmt: (v) => v.toFixed(1) + ' ch/s', showIf: () => S.charset === 'words' },
    { t: 'range', k: 'liveness', label: 'Liveliness (character changes)', min: 0, max: 1, step: 0.05, fmt: (v) => (v ? Math.round(v * 100) + '%' : 'off') },
    { t: 'check', k: 'words', label: 'if / else / return words in code mode' },
  ] },
  { title: 'Image', items: [
    { t: 'range', k: 'brightness', label: 'Brightness', min: -0.3, max: 0.4, step: 0.01, fmt: (v) => v.toFixed(2) },
    { t: 'range', k: 'contrast', label: 'Contrast', min: 0.5, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
    { t: 'range', k: 'boost', label: 'Faint-detail boost (smoke)', min: 0, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100) + '%' },
    { t: 'range', k: 'edge', label: 'Edge sharpness', min: 0, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100) + '%' },
    { t: 'range', k: 'stab', label: 'Stability (against flicker)', min: 0, max: 0.9, step: 0.02, fmt: (v) => Math.round(v * 100) + '%' },
  ] },
  { title: 'Background', items: [
    { t: 'select', k: 'mode', label: 'Background suppression', opts: [['smart', 'Smart: person + smoke (recommended)'], ['diff', 'Only what differs from the background'], ['full', 'Off: whole frame']] },
    { t: 'range', k: 'supp', label: 'Suppression strength', min: 0, max: 1, step: 0.02, fmt: (v) => Math.round(v * 100) + '%', showIf: () => S.mode !== 'full' },
    { t: 'range', k: 'grow', label: 'Margin around the person', min: 0, max: 4, step: 1, fmt: (v) => v + ' cells', showIf: () => S.mode === 'smart' },
    { t: 'range', k: 'sil', label: 'Silhouette (dark parts of the person)', min: 0, max: 0.6, step: 0.02, fmt: (v) => Math.round(v * 100) + '%', showIf: () => S.mode === 'smart' },
  ] },
  { title: 'Code rain', items: [
    { t: 'check', k: 'rain', label: 'Code falls from the top, Matrix style' },
    { t: 'select', k: 'rainMode', label: 'How it falls', opts: [['flow', 'Flows around the silhouette and soaks into it'], ['behind', 'Falls behind the silhouette']], showIf: () => S.rain },
    { t: 'text', k: 'text', label: 'Your own text instead of random code (script, post words)' },
    { t: 'range', k: 'rainShed', label: 'Figure drips into the rain', min: 0, max: 1, step: 0.05, fmt: (v) => (v ? Math.round(v * 100) + '%' : 'off'), showIf: () => S.rain && S.rainMode === 'flow' },
    { t: 'range', k: 'rainAmt', label: 'Density', min: 0.05, max: 0.8, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', showIf: () => S.rain },
    { t: 'range', k: 'rainSpeed', label: 'Speed', min: 0.3, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + '×', showIf: () => S.rain },
  ] },
  { title: 'Colors', items: [
    { t: 'color', k: 'fg', label: 'Character color' },
    { t: 'color', k: 'bg', label: 'Background color' },
  ] },
  { title: 'Frame format', items: [
    { t: 'select', k: 'format', label: 'Aspect ratio', opts: [['orig', 'Same as source'], ['9:16', 'Vertical 9:16'], ['1:1', 'Square 1:1'], ['16:9', 'Horizontal 16:9']] },
    { t: 'select', k: 'fit', label: 'Placement', opts: [['contain', 'Fit (nothing is cropped)'], ['cover', 'Crop to fill']] },
    { t: 'range', k: 'zoom', label: 'Frame zoom', min: 1, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×', showIf: () => S.fit === 'cover' },
    { t: 'range', k: 'panX', label: 'Horizontal shift', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', showIf: () => S.fit === 'cover' },
    { t: 'range', k: 'panY', label: 'Vertical shift', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', showIf: () => S.fit === 'cover' },
  ] },
  { title: 'Intro and outro', items: [
    { t: 'check', k: 'noTrans', label: 'No transitions' },
    { t: 'range', k: 'intro', label: 'Intro: characters assemble', min: 0.5, max: 8, step: 0.25, fmt: (v) => v + ' s', showIf: () => !S.noTrans },
    { t: 'range', k: 'outro', label: 'Outro: characters scatter', min: 0.5, max: 8, step: 0.25, fmt: (v) => v + ' s', showIf: () => !S.noTrans },
  ] },
  { title: 'Quality', items: [
    { t: 'select', k: 'preview', label: 'Preview resolution', num: true, opts: [[640, 'Low (fast)'], [960, 'Medium'], [1280, 'High']] },
    { t: 'select', k: 'exportH', label: 'Exported video resolution', num: true, opts: [[720, '720p'], [1080, '1080p (recommended)']] },
    { t: 'select', k: 'fps', label: 'Frames per second', num: true, opts: [[24, '24'], [30, '30']] },
  ] },
];

// ---------- state ----------
const pv = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' }); // for the preview
const wv = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' }); // for analysis and export
const shared = { segmenter: null, bg: null };
let pre = null; // {layout, proc, mapper, rend}
let snaps = null; // {key, first, last}
let vid = null; // {name, w, h, dur, size}
let range = { a: 0, b: 0 };
let T = 0, playing = false, busy = 0, exporting = false;
let live = null, lastSrc = null;
let faceModel = null, faceFail = false; const sparks = new Sparks();
let speechBuf = '', speechRec = null;
const audio = { ctx: null, an: null, buf: null, level: 0, stream: null };
let speechInterim = '';
let handModel = null, handsFail = false; const threads = new HandThreads();
let lastVT = -1, lastNow = 0, rafId = 0, renderTok = 0;

const clip = () => Math.max(0.1, range.b - range.a);
const tIntro = () => (S.noTrans ? 0 : S.intro);
const tOutro = () => (S.noTrans ? 0 : S.outro);
const total = () => tIntro() + clip() + tOutro();
const fmtT = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const phase = (t = T) => (t < tIntro() ? 'intro' : t < tIntro() + clip() ? 'main' : 'outro');

function status(msg) { const e = $('status'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }
function showErr(msg) { const e = $('errBox'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }

function aspect() {
  if (S.format === '9:16') return 9 / 16;
  if (S.format === '1:1') return 1;
  if (S.format === '16:9') return 16 / 9;
  return vid ? vid.w / vid.h : 16 / 9;
}
function colsFor() { const A = aspect(); return Math.round((A >= 1 ? 1080 * A : 1080) / S.size); }
function dimsFor(longSide, shortSide) {
  const A = aspect(); let W, H;
  if (longSide) { if (A >= 1) { W = longSide; H = Math.round(longSide / A); } else { H = longSide; W = Math.round(longSide * A); } }
  else if (A >= 1) { H = shortSide; W = Math.round(shortSide * A); } else { W = shortSide; H = Math.round(shortSide / A); }
  return [W & ~1, H & ~1];
}
const style = () => ({ fg: S.fg, bg: S.bg });

function buildPre() {
  const [W, H] = dimsFor(S.preview);
  const layout = makeLayout(W, H, colsFor());
  const cv = $('cv');
  const rend = new Renderer(cv, layout, style());
  pre = { layout, proc: new Processor(layout, shared), mapper: new Mapper(layout.n), tmp: new Mapper(layout.n), rend };
  invalidateSnaps();
}
function invalidateSnaps() { snaps = null; }
function invalidateAll() { invalidateSnaps(); }

// ---------- snapshots of the first/last frame for the transitions ----------
async function ensureSnaps() {
  const key = JSON.stringify([ANALYSIS_KEYS.map((k) => S[k]), LAYOUT_KEYS.map((k) => S[k]), range, !!shared.bg]);
  if (snaps && snaps.key === key) return snaps;
  const proc = new Processor(pre.layout, shared);
  const p = { ...S };
  await seekTo(wv, range.a);
  proc.process(wv, p, { fresh: true });
  const first = proc.I.slice();
  await seekTo(wv, Math.max(range.a, range.b - 1 / 30));
  proc.process(wv, p, { fresh: true });
  snaps = { key, first, last: proc.I.slice() };
  return snaps;
}

// ---------- drawing ----------
const currentText = () => ((speechBuf + ' ' + speechInterim).trim() || S.text.trim());
const rainOpts = () => (S.rain ? { amt: S.rainAmt, speed: S.rainSpeed, mode: S.rainMode, text: currentText(), shed: S.rainShed } : null);
let freshAt = 0, phrases = [], lastInterim = '';
// phrases for the figure: the one being spoken now (if any), then earlier ones; or the text typed by hand
const phraseList = () => { const cur = speechInterim.trim(); const l = cur ? [cur, ...phrases] : phrases.slice(); return l.length ? l : S.text.trim() ? [S.text.trim()] : []; };
const mapOpts = () => ({ charset: S.charset, liveness: S.liveness, words: S.words, text: currentText(), phrases: phraseList(), phraseAge: performance.now() - freshAt, freshK: clamp(1 - (performance.now() - freshAt) / 7000) });
function drawMain() {
  pre.mapper.map(pre.proc.I, pre.layout.cols, pre.layout.rows, T, mapOpts(), true);
  pre.rend.draw(pre.mapper, 'still', 1, T, { rain: rainOpts() });
}
function drawTransition(ph, sn) {
  const { layout, tmp, rend } = pre;
  const I = ph === 'intro' ? sn.first : sn.last;
  tmp.fresh = true; tmp.map(I, layout.cols, layout.rows, T, mapOpts(), false);
  const t = ph === 'intro' ? T / tIntro() : (T - tIntro() - clip()) / tOutro();
  rend.draw(tmp, ph, clamp(t), T, { rain: rainOpts() });
}

// Show the scene frame at time T (when paused / seeking)
async function renderStill() {
  if (!vid || !pre || live) return;
  const tok = ++renderTok; busy++;
  try {
    const ph = phase();
    if (ph === 'main') {
      await seekTo(pv, range.a + (T - tIntro()));
      if (tok !== renderTok) return;
      pre.proc.process(pv, S, { fresh: true });
      pre.mapper.fresh = true;
      drawMain();
    } else {
      status('Preparing the first and last frames…');
      const sn = await ensureSnaps(); status('');
      if (tok !== renderTok) return;
      drawTransition(ph, sn);
    }
  } finally { busy--; }
  updateTime();
}

// ---------- playback ----------
function updateTime() {
  $('scrub').max = total(); $('scrub').value = T;
  $('timeLbl').textContent = `${fmtT(T)} / ${fmtT(total())}`;
  const i = tIntro(), o = tOutro();
  $('totalLbl').textContent = vid ? `Total video length: ${fmtT(total())} (${i ? `intro ${i} s + ` : ''}clip ${clip().toFixed(1)} s${o ? ` + outro ${o} s` : ''})` : '';
}
function setPlayingUI() { $('btnPlay').textContent = playing ? '❚❚ Pause' : '▶ Play'; }

async function play() {
  if (!vid || exporting || live) return;
  if (T >= total() - 0.02) T = 0;
  playing = true; setPlayingUI(); lastNow = performance.now(); lastVT = -1;
  const tok = ++renderTok;
  if (phase() === 'main') {
    await seekTo(pv, range.a + (T - tIntro()));
    pre.proc.process(pv, S, { fresh: true }); pre.mapper.fresh = true;
    if (tok !== renderTok || !playing) return;
    pv.play();
  } else {
    status('Preparing frames…'); await ensureSnaps(); status('');
    if (tok !== renderTok || !playing) return;
  }
  lastNow = performance.now();
  cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop);
}
function pause() {
  playing = false; pv.pause(); cancelAnimationFrame(rafId); setPlayingUI(); renderTok++;
}
let fpsAcc = [];
function loop(now) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - lastNow) / 1000); lastNow = now;
  const ph = phase();
  if (ph === 'main') {
    if (pv.paused && !pv.ended && T < tIntro() + clip()) { enterMain(); return; }
    const vt = pv.currentTime;
    T = tIntro() + (vt - range.a);
    if (vt >= range.b - 0.03 || pv.ended) { pv.pause(); T = tIntro() + clip() + 0.0001; if (tOutro() === 0) return finish(); }
    else if (vt !== lastVT) {
      lastVT = vt; const t0 = performance.now();
      pre.proc.process(pv, S, { seg: (pre.proc.frameNo & 1) === 0 });
      drawMain();
      fpsAcc.push(performance.now() - t0); if (fpsAcc.length > 30) fpsAcc.shift();
    }
  } else {
    if (!pv.paused) pv.pause();
    T += dt;
    if (T >= total()) { T = total(); if (snaps) drawTransition('outro', snaps); return finish(); }
    if (snaps) drawTransition(ph, snaps);
    if (ph === 'intro' && T + dt >= tIntro()) { /* the switch to the main scene happens on the next frame */ }
  }
  if (phase() === 'main' && ph === 'intro') { enterMain(); return; }
  updateTime();
  rafId = requestAnimationFrame(loop);
}
async function enterMain() {
  cancelAnimationFrame(rafId);
  const tok = ++renderTok;
  T = Math.max(T, tIntro());
  await seekTo(pv, range.a + (T - tIntro()));
  pre.proc.process(pv, S, { fresh: true }); pre.mapper.fresh = true; drawMain();
  if (tok !== renderTok || !playing) return;
  await pv.play(); lastVT = -1; lastNow = performance.now();
  rafId = requestAnimationFrame(loop);
}
function finish() { playing = false; pv.pause(); setPlayingUI(); updateTime(); }

async function seekScene(t) {
  const was = playing; if (was) pause();
  T = clamp(t, 0, total()); await renderStill(); if (was) play();
}

// ---------- interface ----------
function buildControls() {
  const root = $('controls'); root.innerHTML = '';
  const showIfs = [];
  for (const sec of UI) {
    const h = document.createElement('h2'); h.textContent = sec.title; root.appendChild(h);
    for (const it of sec.items) {
      const row = document.createElement('div'); row.className = 'row';
      if (it.t === 'trim') { root.appendChild(row); buildTrim(row); continue; }
      const lab = document.createElement('label'); lab.textContent = it.label;
      if (it.t === 'range') {
        const val = document.createElement('span'); val.className = 'val';
        const inp = Object.assign(document.createElement('input'), { type: 'range', min: it.min, max: it.max, step: it.step, value: S[it.k] });
        const upd = () => { val.textContent = it.fmt(+inp.value); };
        inp.oninput = () => { S[it.k] = +inp.value; upd(); onSetting(it.k); };
        upd(); row.append(lab, val, inp);
      } else if (it.t === 'select') {
        const sel = document.createElement('select');
        for (const [v, l] of it.opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
        sel.value = S[it.k];
        sel.onchange = () => { S[it.k] = it.num ? +sel.value : sel.value; onSetting(it.k); };
        row.append(lab, sel);
      } else if (it.t === 'check') {
        row.className = 'row check';
        const inp = Object.assign(document.createElement('input'), { type: 'checkbox', checked: S[it.k] });
        inp.onchange = () => { S[it.k] = inp.checked; onSetting(it.k); };
        row.append(inp, lab);
      } else if (it.t === 'text') {
        const ta = Object.assign(document.createElement('textarea'), { rows: 3, value: S[it.k], placeholder: 'For example: the text of your post. It will fall as rain and run along the threads between your hands.' });
        ta.style.cssText = 'grid-column:1/-1;width:100%;background:#1d1d22;color:inherit;border:1px solid #2a2a30;border-radius:6px;padding:6px;font:inherit;resize:vertical';
        ta.oninput = () => { S[it.k] = ta.value; registerText(ta.value); if (!playing) requestRender(); };
        row.append(lab, ta);
      } else if (it.t === 'color') {
        row.className = 'row inline';
        const inp = Object.assign(document.createElement('input'), { type: 'color', value: S[it.k] });
        inp.oninput = () => { S[it.k] = inp.value; onSetting(it.k); };
        row.append(lab, inp);
      }
      if (it.showIf) showIfs.push([row, it.showIf]);
      root.appendChild(row);
    }
  }
  root._showIfs = showIfs; refreshVisibility();
}
function refreshVisibility() { for (const [row, f] of $('controls')._showIfs || []) row.classList.toggle('hidden', !f()); }

let trimEls = null;
function buildTrim(row) {
  row.style.display = 'block';
  row.innerHTML = `
    <div class="row"><label>Start</label><span class="val" id="aVal">0.00 s</span><input type="range" id="aR" min="0" max="1" step="0.01" value="0"></div>
    <div class="row"><label>End</label><span class="val" id="bVal">0.00 s</span><input type="range" id="bR" min="0" max="1" step="0.01" value="1"></div>
    <div class="btns"><button id="aNow">Start = now</button><button id="bNow">End = now</button></div>
    <div class="note" id="clipLbl"></div>`;
  trimEls = { a: row.querySelector('#aR'), b: row.querySelector('#bR') };
  trimEls.a.oninput = () => setRange(+trimEls.a.value, range.b, 'a');
  trimEls.b.oninput = () => setRange(range.a, +trimEls.b.value, 'b');
  row.querySelector('#aNow').onclick = () => { if (vid && phase() === 'main') setRange(range.a + (T - tIntro()), range.b, 'a'); };
  row.querySelector('#bNow').onclick = () => { if (vid && phase() === 'main') setRange(range.a, range.a + (T - tIntro()), 'b'); };
  syncTrim();
}
function syncTrim() {
  if (!trimEls) return;
  const d = vid ? vid.dur : 1;
  trimEls.a.max = trimEls.b.max = d; trimEls.a.value = range.a; trimEls.b.value = range.b;
  $('aVal').textContent = range.a.toFixed(2) + ' s'; $('bVal').textContent = range.b.toFixed(2) + ' s';
  $('clipLbl').textContent = vid ? `Clip length: ${clip().toFixed(2)} s of ${d.toFixed(2)} s` : '';
}
let rangeTimer = 0;
function setRange(a, b, who) {
  if (!vid || live) return;
  const minLen = 0.5;
  a = clamp(a, 0, vid.dur - minLen); b = clamp(b, minLen, vid.dur);
  if (b - a < minLen) { if (who === 'a') a = b - minLen; else b = a + minLen; }
  range = { a, b }; syncTrim(); invalidateSnaps();
  if (playing) pause();
  T = tIntro(); updateTime(); // show the start of the clip
  clearTimeout(rangeTimer);
  rangeTimer = setTimeout(async () => { await renderStill(); scheduleBg(); }, 250);
}

function onSetting(k) {
  refreshVisibility();
  if (LAYOUT_KEYS.includes(k)) { buildPre(); }
  else if (STYLE_KEYS.includes(k)) { pre && pre.rend.setStyle(style()); }
  else if (ANALYSIS_KEYS.includes(k)) { invalidateSnaps(); }
  if (k === 'intro' || k === 'outro' || k === 'noTrans') { T = clamp(T, 0, total()); updateTime(); }
  if (k === 'fps' || k === 'exportH' || k === 'format') showFmt();
  if (!playing) requestRender();
  else if (LAYOUT_KEYS.includes(k)) { pause(); requestRender(); }
}
let rqTimer = 0;
function requestRender() { clearTimeout(rqTimer); rqTimer = setTimeout(renderStill, 60); }

// ---------- loading a video ----------
const HELP_CONVERT = `How to convert the video (the original file is not changed):
• macOS: open it in QuickTime Player → File → Export As → 1080p.
• Or in a terminal with ffmpeg: ffmpeg -i input -c:v libx264 -pix_fmt yuv420p -an output.mp4
• macOS without ffmpeg: avconvert --source "your_file" --preset PresetHighestQuality --output "new_file.mov"`;

async function loadVideo(src, name, size) {
  if (live) await stopLive(true);
  lastSrc = [src, name, size];
  showErr(''); pause(); status('Opening video…');
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  S.mirror = false;
  const ok = await new Promise((res) => {
    const to = setTimeout(() => res(false), 15000);
    const done = (v) => { clearTimeout(to); pv.onloadeddata = pv.onerror = null; res(v); };
    pv.onloadeddata = () => done(pv.videoWidth > 0);
    pv.onerror = () => done(false);
    pv.src = url; pv.load();
  });
  if (!ok) {
    status(''); showErr(`Could not open “${name}”: the browser does not support this video's format or codec.\n\n${HELP_CONVERT}`);
    return;
  }
  wv.src = url; await new Promise((r) => { wv.onloadeddata = r; wv.load(); });
  vid = { name, w: pv.videoWidth, h: pv.videoHeight, dur: pv.duration, size };
  range = { a: 0, b: vid.dur }; T = 0; shared.bg = null; invalidateSnaps();
  $('fileInfo').textContent = `${name} — ${vid.w}×${vid.h}, ${vid.dur.toFixed(1)} s${size ? `, ${(size / 1048576).toFixed(1)} MB` : ''}`;
  $('empty').classList.add('hidden'); $('cv').classList.add('on'); $('btnExport').disabled = false;
  syncTrim(); buildPre(); updateTime(); showFmt();
  await renderStill();
  status(''); scheduleBg();
}

let bgTimer = 0, bgTok = 0;
function scheduleBg() { clearTimeout(bgTimer); bgTimer = setTimeout(buildBg, 700); }
async function buildBg() {
  if (!vid || exporting || live) return;
  const tok = ++bgTok; const was = playing; if (was) pause();
  try {
    status('Analyzing background…');
    await segReady;
    const bg = await buildBackground(wv, shared.segmenter, range.a, range.b, 21, (p) => status(`Analyzing background… ${Math.round(p * 100)}%`));
    if (tok !== bgTok) return;
    shared.bg = bg; invalidateSnaps(); status('');
    await renderStill();
  } catch (e) { console.error(e); status('Could not analyze the background: ' + e.message); }
}

// ---------- export ----------
// a pause that is not throttled by timers (matters when the tab is in the background)
const yieldNow = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
let codec = null;
async function pickCodec(W, H, fps) {
  const bitrate = Math.round(W * H * fps * 0.15);
  const cands = [['mp4', 'avc1.640033'], ['mp4', 'avc1.4d0033'], ['webm', 'vp09.00.40.08'], ['webm', 'vp8']];
  if (typeof VideoEncoder === 'undefined') return null;
  for (const [kind, c] of cands) {
    try { const r = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps }); if (r.supported) return { kind, codec: c, bitrate }; } catch (e) { /* try the next one */ }
  }
  return null;
}
async function showFmt() {
  const [W, H] = dimsFor(0, S.exportH);
  codec = await pickCodec(W, H, S.fps);
  $('fmtInfo').textContent = !vid ? '' : !codec ? 'This browser cannot save video. Open the app in Google Chrome.'
    : `Size: ${W}×${H}, ${S.fps} fps, no audio. Format: ${codec.kind === 'mp4' ? 'MP4 (H.264)' : 'WebM (' + (codec.codec.startsWith('vp09') ? 'VP9' : 'VP8') + ') — a real WebM file, not MP4'}.`;
}

let cancelFlag = false;
async function doExport(opts = {}) {
  if (!vid || exporting || live) return null;
  pause(); exporting = true; cancelFlag = false; renderTok++;
  const [W, H] = dimsFor(0, opts.exportH || S.exportH); const fps = opts.fps || S.fps;
  $('btnExport').disabled = true; $('btnCancel').classList.remove('hidden'); $('prog').classList.remove('hidden'); $('prog').value = 0;
  $('result').classList.add('hidden');
  const say = (m) => { $('expStatus').textContent = m; };
  try {
    codec = await pickCodec(W, H, fps);
    if (!codec) throw new Error('This browser does not support video encoding. Open the app in Google Chrome.');
    await segReady; if (!shared.bg) { say('Analyzing background…'); shared.bg = await buildBackground(wv, shared.segmenter, range.a, range.b, 21); }
    const layout = makeLayout(W, H, colsFor());
    const cv = document.createElement('canvas');
    const rend = new Renderer(cv, layout, style());
    const proc = new Processor(layout, shared), mapper = new Mapper(layout.n), tmp = new Mapper(layout.n);
    const p = { ...S }, mo = mapOpts();
    const nI = Math.round(tIntro() * fps), nM = Math.round(clip() * fps), nO = Math.round(tOutro() * fps), N = nI + nM + nO;

    const M = codec.kind === 'mp4' ? Mp4 : WebM;
    const target = new M.ArrayBufferTarget();
    const muxer = codec.kind === 'mp4'
      ? new M.Muxer({ target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' })
      : new M.Muxer({ target, video: { codec: codec.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: W, height: H, frameRate: fps } });
    let encErr = null;
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { encErr = e; } });
    enc.configure({ codec: codec.codec, width: W, height: H, bitrate: codec.bitrate, framerate: fps });

    let done = 0; const t0 = performance.now();
    const push = async () => {
      if (encErr) throw encErr;
      const f = new VideoFrame(cv, { timestamp: Math.round((done * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(f, { keyFrame: done % 60 === 0 }); f.close(); done++;
      while (enc.encodeQueueSize > 6) await yieldNow();
      if (done % 5 === 0) {
        $('prog').value = done / N;
        const el = (performance.now() - t0) / 1000, eta = (el / done) * (N - done);
        say(`Saving: frame ${done} of ${N} (${Math.round((done / N) * 100)}%). About ${Math.ceil(eta)} s left. Keep this tab open and in front.`);
        await yieldNow();
      }
      if (cancelFlag) throw new Error('cancel');
    };
    // 1. intro: the first frame of the clip
    await seekTo(wv, range.a); proc.reset(); proc.process(wv, p, { fresh: true });
    const first = proc.I.slice();
    for (let i = 0; i < nI; i++) {
      const T0 = i / fps; tmp.fresh = true; tmp.map(first, layout.cols, layout.rows, T0, mo, false);
      rend.draw(tmp, 'intro', clamp(T0 / tIntro()), T0, { rain: rainOpts() }); await push();
    }
    // 2. main scene
    proc.reset(); mapper.fresh = true;
    for (let i = 0; i < nM; i++) {
      await seekTo(wv, Math.min(range.a + i / fps + 0.001, vid.dur - 0.01));
      proc.process(wv, p, { seg: true });
      const T0 = tIntro() + i / fps;
      mapper.map(proc.I, layout.cols, layout.rows, T0, mo, true); rend.draw(mapper, 'still', 1, T0, { rain: rainOpts() }); await push();
    }
    // 3. outro: the last frame scatters
    const last = proc.I.slice();
    for (let i = 0; i < nO; i++) {
      const T0 = tIntro() + clip() + i / fps; tmp.fresh = true; tmp.map(last, layout.cols, layout.rows, T0, mo, false);
      rend.draw(tmp, 'outro', clamp((i / fps) / tOutro()), T0, { rain: rainOpts() }); await push();
    }
    await enc.flush(); if (encErr) throw encErr; enc.close(); muxer.finalize();
    const buf = target.buffer;
    if (!buf || buf.byteLength < 1000 || done !== N) throw new Error('The file came out incomplete, saving stopped.');
    const ext = codec.kind, blob = new Blob([buf], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `speech-figure-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}` });
    if (!opts.noDownload) { document.body.appendChild(a); a.click(); a.remove(); }
    let saved = '';
    try { const r = await fetch(`/save?ext=${ext}`, { method: 'POST', body: blob }); if (r.ok) saved = (await r.json()).file; } catch (e) { /* not critical */ }
    $('prog').value = 1;
    say(`Done: ${N} frames, ${(N / fps).toFixed(1)} s, ${W}×${H}, ${(buf.byteLength / 1048576).toFixed(1)} MB, format ${ext === 'mp4' ? 'MP4 (H.264)' : 'WebM'}.\nThe file was downloaded${saved ? `, copy saved to: ${saved}` : ''}.`);
    const rv = $('result'); rv.src = url; rv.classList.remove('hidden');
    return { blob, W, H, N, fps, ext, saved };
  } catch (e) {
    $('prog').classList.add('hidden');
    say(e.message === 'cancel' ? 'Saving cancelled, no file was created.' : 'Error: ' + e.message + '. No file was created.');
    return null;
  } finally {
    exporting = false; $('btnExport').disabled = false; $('btnCancel').classList.add('hidden');
    await renderStill();
  }
}


// ---------- camera: live view and recording ----------
const recBtn = () => $('btnRec');

// Large subtitles: the spoken phrase in a plain readable font over the figure, fading out smoothly
function drawSubs(rend) {
  const list = phraseList(); const txt = list[0]; if (!txt) return;
  const live = speechInterim.trim().length > 0, age = performance.now() - freshAt;
  const alpha = live ? 1 : clamp(1 - (age - 7000) / 1800); if (alpha <= 0.02) return;
  const { W, H } = rend.L, x = rend.ctx, size = Math.round(H * 0.052), maxW = W * 0.84, lh = size * 1.25;
  x.save(); x.font = `600 ${size}px -apple-system, "SF Pro Display", Helvetica, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const lines = []; let cur = '';
  for (const w of txt.split(' ')) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur); const shown = lines.slice(-3);
  const top = S.subsPos === 'top' ? H * 0.08 : S.subsPos === 'center' ? (H - shown.length * lh) / 2 : H * 0.93 - shown.length * lh;
  const boxW = Math.min(maxW + size, Math.max(...shown.map((l) => x.measureText(l).width)) + size * 1.4);
  x.globalAlpha = alpha * 0.62; x.fillStyle = S.bg; x.fillRect(W / 2 - boxW / 2, top - size * 0.2, boxW, shown.length * lh + size * 0.5);
  x.globalAlpha = alpha; x.fillStyle = S.fg;
  shown.forEach((l, i) => x.fillText(l, W / 2, top + size * 0.85 + i * lh));
  x.restore();
}
function audioTick() {
  if (!audio.an) { audio.level *= 0.9; return audio.level; }
  audio.an.getFloatTimeDomainData(audio.buf);
  let s = 0; for (let i = 0; i < audio.buf.length; i++) s += audio.buf[i] * audio.buf[i];
  const target = clamp(Math.sqrt(s / audio.buf.length) * 7);
  audio.level += (target - audio.level) * (target > audio.level ? 0.6 : 0.08);
  const bar = document.querySelector('#micBar i'); if (bar) bar.style.width = Math.round(audio.level * 100) + '%';
  return S.audioReact ? audio.level : 0;
}

async function startLive() {
  if (live || exporting) return;
  pause(); showErr('');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
  } catch (e) {
    showErr(`Could not turn on the camera (${e.name}).\nAllow access: the camera icon in Chrome's address bar, and on macOS System Settings → Privacy & Security → Camera → Google Chrome.`);
    return;
  }
  pv.srcObject = stream; pv.loop = false;
  await pv.play();
  while (!pv.videoWidth) await new Promise((r) => setTimeout(r, 50));
  vid = { name: 'Camera', w: pv.videoWidth, h: pv.videoHeight, dur: 1, size: 0 };
  S.mirror = $('mirror').checked; shared.bg = null; invalidateSnaps();
  live = { stream, rec: null, raf: 0, t0: 0 };
  document.body.classList.add('live'); $('btnCam').classList.add('hidden'); $('btnListen').classList.add('hidden');
  $('camBox').classList.remove('hidden'); $('speechBox').classList.remove('hidden'); renderTranscript();
  $('empty').classList.add('hidden'); $('cv').classList.add('on');
  $('fileInfo').textContent = `Camera: ${vid.w}×${vid.h}`;
  buildPre();
  if (!handModel && !handsFail) loadHandLandmarker().then((m) => { handModel = m; }).catch((e) => { handsFail = true; console.error(e); status('The hand-tracking model did not load: threads are unavailable. Run “npm run setup”.'); });
  let lastTs = 0, lastFrameT = performance.now(), faceTs = 0, faceN = 0, mouth = null, clapT = 0, prevPalms = null;
  const palmHist = [];
  const mapPt = (nx, ny) => {
    const L = pre.layout, pl = placement(vid.w, vid.h, L.sw, L.sh, S);
    let x = pl.dx + nx * pl.dw; const y = pl.dy + ny * pl.dh; if (S.mirror) x = L.sw - x;
    return [(x * L.W) / L.sw, (y * L.H) / L.sh];
  };
  const palmOf = (h) => [0, 5, 9, 13, 17].reduce((s, k) => [s[0] + h[k][0] / 5, s[1] + h[k][1] / 5], [0, 0]);
  const extended = (h) => [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([t, p]) => Math.hypot(h[t][0] - h[0][0], h[t][1] - h[0][1]) > Math.hypot(h[p][0] - h[0][0], h[p][1] - h[0][1]) * 1.12).length;
  const frame = () => {
    if (!live) return;
    const now = performance.now(), dt = Math.min(0.1, (now - lastFrameT) / 1000), T = now / 1000; lastFrameT = now;
    const L = pre.layout, lvl = audioTick();
    const text = currentText(), ro = rainOpts();
    if (ro) ro.speed *= 1 + lvl * 2.5;
    const ph0 = phraseList()[0]; threads.text = ph0 ? (ph0 + '  ·  ').repeat(4) : text.slice(-140); threads.speed = ph0 ? Math.max(0.5, S.wordSpeed * 0.8) : 14; threads.oneWay = !!ph0; threads.energy = lvl; pre.rend.sparks = sparks;
    if (S.showFig) {
      pre.proc.process(pv, S, { seg: (pre.proc.frameNo & 1) === 0 });
      pre.mapper.map(pre.proc.I, L.cols, L.rows, T, mapOpts(), true);
      pre.rend.draw(pre.mapper, 'still', 1, T, { rain: ro });
    } else { pre.rend.clear(); if (ro) pre.rend.rainAny(T, ro, null, 1); }
    let hands = [];
    if (S.hands && handModel) {
      const ts = Math.max(now, lastTs + 1); lastTs = ts;
      let res = null; try { res = handModel.detectForVideo(pv, ts); } catch (e) { /* skip this frame */ }
      hands = res ? res.landmarks.map((h) => h.map((p) => mapPt(p.x, p.y))) : [];
      threads.update(hands, dt);
      threads.draw(pre.rend, T, { skeleton: !S.showFig });
    }
    // gestures: a palm pushes the rain away, a fist gathers it, a clap bursts into characters
    const forces = []; let speed = 0;
    if (S.gest) {
      const palms = hands.map(palmOf);
      hands.forEach((h, i) => {
        const e = extended(h), p = palms[i];
        if (e >= 4) forces.push({ type: 'repel', x: p[0] / L.cw, y: p[1] / L.ch, r: L.cols * 0.13 });
        else if (e <= 1) forces.push({ type: 'attract', x: p[0] / L.cw, y: p[1] / L.ch, r: L.cols * 0.17 });
      });
      if (prevPalms && palms.length === prevPalms.length) palms.forEach((p, i) => { speed += Math.hypot(p[0] - prevPalms[i][0], p[1] - prevPalms[i][1]) / Math.max(dt, 0.001); });
      if (palms.length) speed /= palms.length;
      prevPalms = palms;
      if (palms.length >= 2) {
        const d = Math.hypot(palms[0][0] - palms[1][0], palms[0][1] - palms[1][1]);
        palmHist.push([now, d]); while (palmHist.length && now - palmHist[0][0] > 350) palmHist.shift();
        const mx = Math.max(...palmHist.map((q) => q[1]));
        if (d < L.W * 0.13 && mx > L.W * 0.24 && now - clapT > 900) { clapT = now; sparks.burst((palms[0][0] + palms[1][0]) / 2 / L.cw, (palms[0][1] + palms[1][1]) / 2 / L.ch, 170); }
      } else palmHist.length = 0;
    }
    pre.rend.forces = forces; threads.vib = clamp(speed / (L.W * 1.6));
    // mouth smoke
    if (S.smoke && faceModel && ++faceN % 2 === 0) {
      const ts = Math.max(now, faceTs + 1); faceTs = ts;
      let res = null; try { res = faceModel.detectForVideo(pv, ts); } catch (e) { /* skip */ }
      if (res && res.faceLandmarks.length) {
        const lm = res.faceLandmarks[0].map((p) => mapPt(p.x, p.y));
        const jaw = res.faceBlendshapes && res.faceBlendshapes[0] ? (res.faceBlendshapes[0].categories.find((c) => c.categoryName === 'jawOpen') || { score: 0 }).score : 0;
        const fw = Math.abs(lm[454][0] - lm[234][0]) || 1, mid = (lm[234][0] + lm[454][0]) / 2;
        mouth = { x: (lm[13][0] + lm[14][0]) / 2 / L.cw, y: (lm[13][1] + lm[14][1]) / 2 / L.ch, open: jaw, dir: clamp((lm[1][0] - mid) / fw * 3.2, -1, 1) };
      } else mouth = null;
    }
    if (S.smoke && mouth && mouth.open > 0.08) {
      // the wider the mouth, the thicker and farther the smoke flies: fully open, it leaves the figure far behind
      const o = clamp((mouth.open - 0.08) / 0.55), n = Math.round(dt * (40 + 900 * o * o));
      for (let i = 0; i < n; i++) {
        const sp = 0.6 + 2.4 * o, sx = mouth.dir * (5 + Math.random() * 10) * sp + (Math.random() - 0.5) * (6 + 22 * o);
        sparks.add(mouth.x, mouth.y, sx, -(1.5 + Math.random() * 5) * sp * 0.8, 1.4 + Math.random() * (1.8 + 2 * o), { drag: 0.7 - 0.25 * o, grav: -1.2, turb: 16 + 20 * o });
      }
    }
    sparks.step(dt); pre.rend.drawSparks(T, text);
    if (S.subs) drawSubs(pre.rend);
    if (live.rec) recBtn().textContent = `■ Stop and save (${fmtT((performance.now() - live.t0) / 1000)})`;
    live.raf = requestAnimationFrame(frame);
  };
  frame();
  autoSpeech();
}

// Speech is the point of the app, so it starts together with the camera / microphone
function autoSpeech() { const sp = $('speech'); if (!sp.checked) { sp.checked = true; sp.onchange({ target: sp }); } }

// Microphone only: no camera. The words fall as rain and the latest phrase is shown as large subtitles.
async function startListen() {
  if (live || exporting) return;
  pause(); showErr('');
  vid = { name: 'Microphone', w: 1280, h: 720, dur: 1, size: 0 };
  live = { stream: null, rec: null, raf: 0, t0: 0, kind: 'listen' };
  S.mirror = false; S.rain = true; S.rainMode = 'flow'; shared.bg = null; invalidateSnaps();
  document.body.classList.add('live'); $('btnCam').classList.add('hidden'); $('btnListen').classList.add('hidden'); $('speechBox').classList.remove('hidden');
  $('empty').classList.add('hidden'); $('cv').classList.add('on'); $('fileInfo').textContent = 'Microphone only'; renderTranscript();
  buildPre(); buildControls();
  let last = performance.now();
  const frame = () => {
    if (!live) return;
    const now = performance.now(), T = now / 1000; last = now;
    const lvl = audioTick(), ro = rainOpts();
    pre.rend.clear();
    if (ro) { ro.speed *= 1 + lvl * 2.5; pre.rend.rainAny(T, ro, null, 1); }
    if (S.subs) drawSubs(pre.rend);
    if (live.rec) recBtn().textContent = `■ Stop and save (${fmtT((performance.now() - live.t0) / 1000)})`;
    live.raf = requestAnimationFrame(frame);
  };
  frame(); autoSpeech();
}

async function stopLive(silent) {
  if (!live) return;
  if (live.rec) await stopRec();
  cancelAnimationFrame(live.raf); if (live.stream) live.stream.getTracks().forEach((t) => t.stop()); pv.srcObject = null;
  for (const id of ['monitor', 'performance', 'speech', 'audioReact']) { const el = $(id); if (el.checked) { el.checked = false; el.onchange({ target: el }); } }
  sparks.p.length = 0; if (pre && pre.rend) pre.rend.forces = [];
  live = null; S.mirror = false;
  document.body.classList.remove('live'); $('camBox').classList.add('hidden'); $('speechBox').classList.add('hidden'); $('btnCam').classList.remove('hidden'); $('btnListen').classList.remove('hidden');
  vid = null; shared.bg = null;
  if (!silent) {
    if (lastSrc) await loadVideo(...lastSrc);
    else { $('cv').classList.remove('on'); $('empty').classList.remove('hidden'); $('fileInfo').textContent = 'No video selected.'; }
  }
}

async function liveBackground() {
  if (!live) return;
  const btn = $('btnBg'); btn.disabled = true;
  try {
    await segReady;
    shared.bg = await buildBackground(pv, shared.segmenter, 0, 0, 16, (p) => status(`Capturing background… ${Math.round(p * 100)}% (sit still in frame)`), true);
    status('Background captured: smoke is now visible.'); setTimeout(() => status(''), 2500);
  } finally { btn.disabled = false; }
}

let recStarting = false;
async function startRec() {
  if (recStarting || !live || live.rec) return;
  recStarting = true;
  try {
    // sound: a dedicated microphone stream, so turning speech recognition off mid-recording does not cut the audio
    let mic = null, withSound = false;
    if ($('recAudio').checked) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); withSound = true; }
      catch (e) { status('The microphone is not available, so this recording will have no sound.'); setTimeout(() => status(''), 5000); }
    }
    const av = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const v = ['video/mp4;codecs=avc1.640033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const ok = (t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t);
    const mt = (withSound ? av : v).find(ok) || v.find(ok);
    if (!mt) { showErr('This browser cannot record video. Open the app in Google Chrome.'); if (mic) mic.getTracks().forEach((t) => t.stop()); return; }
    const stream = $('cv').captureStream(30);
    if (withSound) mic.getAudioTracks().forEach((t) => stream.addTrack(t));
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 8e6, audioBitsPerSecond: 128000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    live.rec = { rec, chunks, mt, mic, withSound }; live.t0 = performance.now();
    rec.start(500); recBtn().classList.add('on');
  } finally { recStarting = false; }
}
function stopRec() {
  return new Promise((resolve) => {
    const { rec, chunks, mt, mic, withSound } = live.rec; const dur = (performance.now() - live.t0) / 1000;
    rec.onstop = async () => {
      if (mic) mic.getTracks().forEach((t) => t.stop());
      const ext = mt.startsWith('video/mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mt.split(';')[0] });
      live.rec = null; recBtn().classList.remove('on'); recBtn().textContent = '● Start recording';
      if (blob.size < 1000) { showErr('The recording came out empty, nothing was saved.'); return resolve(); }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `speech-figure-live-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}` });
      if (!window.__noDownload) { document.body.appendChild(a); a.click(); a.remove(); }
      let saved = '';
      try { const r = await fetch(`/save?ext=${ext}`, { method: 'POST', body: blob }); if (r.ok) saved = (await r.json()).file; } catch (e) { /* not critical */ }
      status(`Recording saved: ${dur.toFixed(1)} s, ${(blob.size / 1048576).toFixed(1)} MB, format ${ext === 'mp4' ? 'MP4 (H.264)' : 'WebM'}, ${withSound ? 'with sound' : 'no sound'}${saved ? '. Copy: ' + saved : ''}`);
      setTimeout(() => status(''), 8000); resolve();
    };
    rec.stop();
  });
}

// ---------- startup ----------
const segReady = (async () => {
  try { shared.segmenter = await loadSegmenter(); }
  catch (e) { console.warn('Segmentation unavailable', e); status('The person-segmentation model did not load: using the “only what differs from the background” mode. Run “npm run setup”.'); S.mode = S.mode === 'smart' ? 'diff' : S.mode; buildControls(); }
})();

buildControls(); updateTime();
$('file').onchange = (e) => { const f = e.target.files[0]; if (f) loadVideo(f, f.name, f.size); };
$('btnPlay').onclick = () => (playing ? pause() : play());
$('btnRestart').onclick = async () => { pause(); T = 0; await renderStill(); play(); };
$('scrub').oninput = (e) => { seekScene(+e.target.value); };
$('btnExport').onclick = () => doExport();
$('btnCam').onclick = () => startLive();
$('btnListen').onclick = () => startListen();
$('btnCamStop').onclick = () => stopLive();
$('btnBg').onclick = liveBackground;
$('btnRec').onclick = () => (live && (live.rec ? stopRec() : startRec()));
$('gest').onchange = (e) => { S.gest = e.target.checked; };
$('smoke').onchange = (e) => {
  S.smoke = e.target.checked;
  if (S.smoke && !faceModel && !faceFail) loadFaceLandmarker().then((m) => { faceModel = m; }).catch((er) => { faceFail = true; console.error(er); status('The face model did not load: mouth smoke is unavailable. Run “npm run setup”.'); });
};
const audioCtx = () => { if (!audio.ctx) audio.ctx = new AudioContext(); if (audio.ctx.state === 'suspended') audio.ctx.resume(); return audio.ctx; };
// the microphone is needed both for the sound level and for the speech-recognition meter
async function micUpdate() {
  const need = S.audioReact || S.speech;
  if (need && !audio.stream) {
    try {
      audio.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const c = audioCtx(); audio.an = c.createAnalyser(); audio.an.fftSize = 1024; audio.buf = new Float32Array(audio.an.fftSize);
      c.createMediaStreamSource(audio.stream).connect(audio.an);
    } catch (er) {
      for (const id of ['audioReact', 'speech']) { $(id).checked = false; S[id] = false; }
      showErr('Could not turn on the microphone (' + er.name + '). Allow access: the icon in Chrome\'s address bar, and on macOS System Settings → Privacy & Security → Microphone → Google Chrome.');
      return false;
    }
  } else if (!need && audio.stream) { audio.stream.getTracks().forEach((t) => t.stop()); audio.stream = null; audio.an = null; audio.level = 0; }
  $('micBox').classList.toggle('hidden', !need);
  return true;
}
$('audioReact').onchange = async (e) => { S.audioReact = e.target.checked; await micUpdate(); };
const speechSay = (m) => { $('speechState').textContent = m; };
let whisperVad = null, whisperClient = null, chromeWatch = 0, lastSpeechEvent = 0;
const chromeLang = () => (S.speechLang === 'auto' ? 'ru-RU' : S.speechLang);
// ---- transcript: timestamped phrases, copy and export ----
const transcript = []; let speechT0 = 0, speechOffset = 0, chromeStart = null;
const sessionClock = () => (performance.now() - speechT0) / 1000 + speechOffset;
const langTag = (l) => ({ russian: 'ru', english: 'en', portuguese: 'pt', ukrainian: 'uk' }[l] || (l ? String(l).slice(0, 2) : ''));
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function trLine(e) {
  const d = document.createElement('div'); d.className = 'tl' + (e.interim ? ' interim' : '');
  const t = document.createElement('time'); t.textContent = fmtClock(e.t0); d.appendChild(t); d.appendChild(document.createTextNode(e.text));
  if (e.lang) { const m = document.createElement('em'); m.textContent = e.lang; d.appendChild(m); }
  return d;
}
function renderTranscript() {
  const box = $('transcript'), atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  box.textContent = '';
  const cur = speechInterim.trim();
  if (!transcript.length && !cur) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'Your words will appear here.'; box.appendChild(d); return; }
  for (const e of transcript.slice(-100)) box.appendChild(trLine(e));
  if (cur) box.appendChild(trLine({ t0: sessionClock(), text: cur, interim: true }));
  if (atEnd) box.scrollTop = box.scrollHeight;
}
const srtTime = (s) => { const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
const toSrt = () => transcript.map((e, i) => `${i + 1}\n${srtTime(e.t0)} --> ${srtTime(Math.max(e.t1, e.t0 + 0.6))}\n${e.text}\n`).join('\n');
const toTxt = () => transcript.map((e) => e.text).join('\n');
function saveText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const l = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
$('trCopy').onclick = async () => { try { await navigator.clipboard.writeText(toTxt()); speechSay(`Copied ${transcript.length} phrases.`); } catch (e) { speechSay('Could not copy: ' + e.message); } };
$('trTxt').onclick = () => { if (transcript.length) saveText(`transcript-${stamp()}.txt`, toTxt(), 'text/plain'); else speechSay('Nothing to save yet.'); };
$('trSrt').onclick = () => { if (transcript.length) saveText(`transcript-${stamp()}.srt`, toSrt(), 'application/x-subrip'); else speechSay('Nothing to save yet.'); };
$('trClear').onclick = () => { transcript.length = 0; speechBuf = ''; phrases.length = 0; renderTranscript(); };

const addSpeech = (t, meta = {}) => {
  speechBuf = (speechBuf + ' ' + t).replace(/\s+/g, ' ').slice(-500); registerText(speechBuf);
  phrases.unshift(t.trim()); phrases.length = Math.min(phrases.length, 6); freshAt = performance.now();
  let t0, t1;
  if (meta.t0 != null) { t0 = meta.t0 + speechOffset; t1 = meta.t1 + speechOffset; }
  else { t1 = sessionClock(); t0 = chromeStart != null ? chromeStart : Math.max(0, t1 - 1.5); chromeStart = null; }
  transcript.push({ t0, t1, text: t.trim(), lang: langTag(meta.lang) || (S.speechEngine === 'chrome' ? chromeLang().slice(0, 2) : '') });
  renderTranscript();
};
$('speechLang').onchange = (e) => { S.speechLang = e.target.value; if (speechRec) { speechRec.lang = chromeLang(); try { speechRec.abort(); } catch (er) { /* restarts by itself */ } } };
$('speechEngine').onchange = async (e) => { S.speechEngine = e.target.value; if (S.speech) { const c = $('speech'); c.checked = false; await c.onchange({ target: c }); c.checked = true; await c.onchange({ target: c }); } };
$('speechModel').onchange = (e) => { S.speechModel = e.target.value; if (S.speech && S.speechEngine === 'whisper') $('speechEngine').onchange({ target: $('speechEngine') }); };

function stopSpeech() {
  if (whisperVad) { whisperVad.stop(); whisperVad = null; }
  if (whisperClient) { whisperClient.terminate(); whisperClient = null; }
  if (speechRec) { speechRec.onend = null; try { speechRec.abort(); } catch (er) { /* already stopped */ } speechRec = null; }
  clearInterval(chromeWatch);
}

async function startWhisper(box) {
  speechSay('Loading the speech model from disk… (10–30 seconds the first time)');
  const client = whisperClient = new WhisperClient(S.speechModel, 'webgpu');
  try { await client.ready; }
  catch (er) { console.error(er); speechSay('The speech model did not load (' + er.message + '). Install it with “npm run setup:speech” in the project folder (add -- --model base for the lighter one).'); S.speech = false; box.checked = false; micUpdate(); return; }
  if (!S.speech || whisperClient !== client) return; // the box was unticked while the model was loading
  const queue = []; let busy = false, finalId = -1;
  const work = async () => {
    if (busy) return; busy = true;
    while (queue.length) {
      const job = queue.shift(); speechSay(queue.length ? `Transcribing… (${queue.length} more in the queue)` : 'Transcribing…');
      try {
        const r = await client.transcribe(job.audio, S.speechLang), t = r.text;
        if (!S.speech || whisperClient !== client) break;
        if (job.partial) { if (job.id > finalId && whisperVad && whisperVad.utter === job.id) { if (!speechInterim && t) freshAt = performance.now(); speechInterim = t; registerText(speechBuf + ' ' + t); renderTranscript(); } }
        else { finalId = job.id; speechInterim = ''; if (t) { addSpeech(t, { ...job.meta, lang: r.lang }); speechSay('Heard: ' + t.slice(-70)); } else { renderTranscript(); speechSay('Listening… go ahead.'); } }
      } catch (er) { console.error(er); speechSay('Recognition failed (' + er.message + '), restarting…'); }
    }
    busy = false;
  };
  whisperVad = new MicVAD(audio.stream,
    (a, id, meta) => { // a phrase is finished: it matters more than the partial ones, which are dropped; if we fall behind, the oldest are lost
      for (let k = queue.length - 1; k >= 0; k--) if (queue[k].partial) queue.splice(k, 1);
      while (queue.length >= 3) queue.shift();
      queue.push({ audio: a, id, partial: false, meta }); work();
    },
    (st) => { if (st === 'voice' && !busy) speechSay('Hearing a voice…'); },
    (a, id) => { if (!busy && queue.length === 0) { queue.push({ audio: a, id, partial: true }); work(); } });
  speechSay('Listening… speak (Russian and English can be mixed). Transcription runs ' + (client.device === 'webgpu' ? 'on the GPU' : 'on the CPU, which is slower'));
}

function startChrome(box) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { box.checked = false; S.speech = false; showErr('Chrome speech recognition is only available in Google Chrome.'); micUpdate(); return; }
  speechRec = new SR(); speechRec.lang = chromeLang(); speechRec.continuous = false; speechRec.interimResults = true; speechRec.maxAlternatives = 1;
  speechRec.onstart = () => { lastSpeechEvent = performance.now(); speechSay('Listening… speak (language: ' + chromeLang() + ').'); };
  speechRec.onspeechstart = () => { lastSpeechEvent = performance.now(); chromeStart = sessionClock(); speechSay('Hearing a voice…'); };
  speechRec.onresult = (ev) => {
    lastSpeechEvent = performance.now();
    let fin = '', tmp = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) (ev.results[i].isFinal ? (fin += ev.results[i][0].transcript + ' ') : (tmp += ev.results[i][0].transcript));
    if (tmp.trim() !== lastInterim) { lastInterim = tmp.trim(); freshAt = performance.now(); }
    speechInterim = tmp; if (fin) { speechInterim = ''; addSpeech(fin); }
    registerText(speechBuf + ' ' + speechInterim); renderTranscript();
    speechSay('Recognizing: ' + (tmp || fin).trim().slice(-60));
  };
  speechRec.onerror = (ev) => {
    const msg = { 'not-allowed': 'No microphone access for recognition. Allow it in Chrome.', 'service-not-allowed': 'Chrome does not allow speech recognition on this page.', network: 'Chrome could not reach the speech service: internet is required.', 'audio-capture': 'No microphone found. Check the input device in macOS System Settings → Sound → Input.', 'language-not-supported': 'This language is not supported.' }[ev.error];
    if (ev.error === 'no-speech') { speechSay('Silence… go ahead.'); return; }
    if (ev.error === 'aborted') return;
    speechSay(msg || 'Recognition error: ' + ev.error);
    if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(ev.error)) { S.speech = false; box.checked = false; micUpdate(); }
  };
  // one phrase per session, then a new one right away: this keeps recognition from sticking on a single phrase
  speechRec.onend = () => { speechInterim = ''; if (S.speech && speechRec) setTimeout(() => { if (S.speech && speechRec) { try { speechRec.start(); } catch (er) { /* already running */ } } }, 80); };
  chromeWatch = setInterval(() => { if (S.speech && speechRec && performance.now() - lastSpeechEvent > 12000 && audio.level > 0.12) { lastSpeechEvent = performance.now(); try { speechRec.abort(); } catch (er) { /* will restart */ } } }, 3000);
  try { speechRec.start(); } catch (er) { speechSay('Could not start: ' + er.message); }
}

$('speech').onchange = async (e) => {
  const box = e.target; S.speech = box.checked;
  stopSpeech();
  if (S.speech) {
    if (!(await micUpdate())) return;
    speechT0 = performance.now(); speechOffset = transcript.length ? transcript[transcript.length - 1].t1 + 1 : 0; renderTranscript();
    S.charset = 'words'; if (S.size < 9) { S.size = 10; onSetting('size'); } buildControls(); // the figure is made of words
    if (S.speechEngine === 'whisper') await startWhisper(box); else startChrome(box);
  } else { speechBuf = ''; speechInterim = ''; speechSay(''); renderTranscript(); await micUpdate(); }
};
const toggleFull = () => { const st = $('stage'); document.fullscreenElement ? document.exitFullscreen() : st.requestFullscreen(); };
$('btnFull2').onclick = toggleFull;
addEventListener('keydown', (e) => { if (live && e.code === 'KeyF' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) toggleFull(); });
$('performance').onchange = async (e) => {
  S.performance = e.target.checked;
  if (S.performance) {
    if (!document.fullscreenElement) toggleFull(); // right away, while the user's click is still valid
    S.hands = true; S.showFig = true; S.subs = true; $('subs').checked = true; S.wordSpeed = Math.min(S.wordSpeed, 1.5); S.size = Math.max(S.size, 11); onSetting('size'); $('hands').checked = true; $('showFig').checked = true;
    const sp = $('speech');
    if (!sp.checked) { sp.checked = true; status('Loading speech recognition… (up to 30 seconds)'); await sp.onchange({ target: sp }); status(''); } else buildControls();
  } else { const sp = $('speech'); if (sp.checked) { sp.checked = false; await sp.onchange({ target: sp }); } if (document.fullscreenElement) document.exitFullscreen(); }
};
$('monitor').onchange = (e) => {
  let v = $('monitorVid');
  if (e.target.checked && live) {
    if (!v) { v = Object.assign(document.createElement('video'), { id: 'monitorVid', muted: true, autoplay: true, playsInline: true }); $('stage').appendChild(v); }
    v.srcObject = live.stream; v.style.transform = S.mirror ? 'scaleX(-1)' : ''; v.play();
  } else if (v) v.remove();
};
$('subs').onchange = (e) => { S.subs = e.target.checked; };
$('subsPos').onchange = (e) => { S.subsPos = e.target.value; };
$('hands').onchange = (e) => { S.hands = e.target.checked; };
$('showFig').onchange = (e) => { S.showFig = e.target.checked; };
$('mirror').onchange = (e) => { S.mirror = e.target.checked; shared.bg = null; };
$('btnCancel').onclick = () => { cancelFlag = true; };
$('btnFull').onclick = () => { const st = $('stage'); document.fullscreenElement ? document.exitFullscreen() : st.requestFullscreen(); };
$('stage').onclick = () => { if (vid && document.fullscreenElement) (playing ? pause() : play()); };
addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $('btnPlay').click(); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadVideo(f, f.name, f.size); });
document.addEventListener('fullscreenchange', () => { if (pre) requestRender(); });

// optional sample: put your own clip at public/sample/sample.mp4 and an “Open sample” button appears
fetch('/sample/sample.mp4', { method: 'HEAD' }).then((r) => {
  if (!r.ok) return;
  $('sampleBtn').classList.remove('hidden');
  $('sampleBtn').onclick = (e) => { e.stopPropagation(); loadVideo('/sample/sample.mp4', 'sample.mp4', 0); };
  if (new URLSearchParams(location.search).has('sample')) $('sampleBtn').click();
}).catch(() => {});
