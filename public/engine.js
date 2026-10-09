// Engine: video -> brightness grid -> characters -> canvas.
// Everything is computed locally in the browser.

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function h32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
export const rnd = (i, s = 0) => h32((Math.imul(i, 374761393) + Math.imul(s, 668265263)) | 0) / 4294967296;

// ---------- character sets ----------
const CODE_GROUPS = [".,'`", ':;-_', '=+~/\\|;', '()[]{}<>', 'ilt1!rj', 'acenosuvxz23', 'ABEFKLPRSTVXYZ4579', '#@$%&0869GOQDHMNW', 'MW@#8&%$B'];
const ASCII_RAMP = ".'`:;-~+=*xoX#%@".split('');
const WORDS = ['if', 'else', 'return', 'void', 'for', 'int', 'null', 'let', 'fn', 'try'];

export const CHARSETS = {
  code: { label: 'Code: { } [ ] ( ) ; = if else return', groups: CODE_GROUPS, words: true },
  ascii: { label: 'ASCII: . : - = + * # @', groups: ASCII_RAMP, words: false },
  binary: { label: 'Binary: 0 and 1', groups: Array(6).fill('01'), words: false },
  words: { label: 'My words (text or speech)', groups: Array(8).fill('.'), text: true },
};
const UNIVERSE = [...new Set((CODE_GROUPS.join('') + ASCII_RAMP.join('') + '01abcdefghijklmnopqrstuvwxyz').split(''))];
export const CH_INDEX = Object.fromEntries(UNIVERSE.map((c, i) => [c, i]));
for (const cs of Object.values(CHARSETS)) {
  cs.K = cs.groups.length;
  cs.idx = cs.groups.map((g) => Uint16Array.from([...g].map((c) => CH_INDEX[c])));
}
const RAIN_CH = [...'(){}[];=+/<>0123456789abcdefghijklmnopqrstuvwxyz'].map((c) => CH_INDEX[c]);
export const GLYPH_COUNT = UNIVERSE.length; // base glyphs only: the intro/outro particles are drawn from these
// Adds characters from user text to the glyph set (any script, including Cyrillic). Returns the text with collapsed whitespace.
export function registerText(str) {
  for (const c of ((str || '') + (str || '').toUpperCase())) if (c.trim() && CH_INDEX[c] === undefined) { CH_INDEX[c] = UNIVERSE.length; UNIVERSE.push(c); }
  return (str || '').replace(/\s+/g, ' ').trim();
}
export const LV = 14; // brightness steps

// ---------- layout and framing ----------
// A cell = 3x5 sub-pixels (so a sub-pixel is nearly square for a 3:5 cell).
export function makeLayout(W, H, cols) {
  const rows = Math.max(2, Math.round(cols * (H / W) * 0.6));
  return { W, H, cols, rows, cw: W / cols, ch: H / rows, n: cols * rows, sw: cols * 3, sh: rows * 5 };
}

export function placement(vw, vh, sw, sh, p) {
  let s = p.fit === 'cover' ? Math.max(sw / vw, sh / vh) * (p.zoom || 1) : Math.min(sw / vw, sh / vh);
  const dw = vw * s, dh = vh * s;
  const ox = Math.max(0, dw - sw), oy = Math.max(0, dh - sh);
  return {
    dw, dh,
    dx: ox > 0 ? -ox * (p.panX ?? 0.5) : (sw - dw) / 2,
    dy: oy > 0 ? -oy * (p.panY ?? 0.5) : (sh - dh) / 2,
  };
}

// A background tab in Chrome does not update video frames, so we wait until the tab is visible again
export function whenVisible() {
  if (!document.hidden) return Promise.resolve();
  return new Promise((res) => { const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); res(); } }; document.addEventListener('visibilitychange', f); });
}

export async function seekTo(v, t) {
  await whenVisible();
  t = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
  if (!(Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2 && !v.seeking)) {
    await new Promise((res) => {
      const on = () => { v.removeEventListener('seeked', on); res(); };
      v.addEventListener('seeked', on);
      v.currentTime = t;
    });
  }
  await whenVisible();
}

// ---------- person segmentation (local, MediaPipe) ----------
export async function loadSegmenter() {
  const mp = await import('./vendor/mediapipe/vision_bundle.mjs');
  const fileset = await mp.FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const make = (delegate) => mp.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: './vendor/mediapipe/selfie_segmenter.tflite', delegate },
    runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
  });
  try { return await make('GPU'); } catch (e) { console.warn('GPU unavailable, using CPU', e); return await make('CPU'); }
}

export async function loadHandLandmarker() {
  const mp = await import('./vendor/mediapipe/vision_bundle.mjs');
  const fileset = await mp.FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const make = (delegate) => mp.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: './vendor/mediapipe/hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { return await make('GPU'); } catch (e) { console.warn('GPU unavailable for hands, using CPU', e); return await make('CPU'); }
}

export async function loadFaceLandmarker() {
  const mp = await import('./vendor/mediapipe/vision_bundle.mjs');
  const fileset = await mp.FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
  const make = (delegate) => mp.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: './vendor/mediapipe/face_landmarker.task', delegate },
    runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
  });
  try { return await make('GPU'); } catch (e) { console.warn('GPU unavailable for the face, using CPU', e); return await make('CPU'); }
}

// Probability of “person” for a canvas/video. Returns {w,h,data:Uint8Array 0..255}
function runSegmentation(seg, source, out) {
  const res = seg.segment(source);
  const masks = res.confidenceMasks;
  // selfie_segmenter has a single mask: the probability of “person”
  const m = masks[masks.length - 1];
  const f = m.getAsFloat32Array();
  if (!out || out.length !== f.length) out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i] * 255;
  const r = { w: m.width, h: m.height, data: out };
  masks.forEach((x) => x.close());
  return r;
}

// Put the frame in a square (no squeezing along one axis): the model is more accurate on an undistorted image
const sqCv = document.createElement('canvas'); sqCv.width = sqCv.height = 320;
const sqCx = sqCv.getContext('2d', { willReadFrequently: true });
function segFrame(seg, src, out) {
  const vw = src.videoWidth || src.width, vh = src.videoHeight || src.height;
  const w = 320, h = Math.round((320 * vh) / vw), y0 = (320 - h) >> 1;
  sqCx.fillStyle = '#000'; sqCx.fillRect(0, 0, 320, 320); sqCx.drawImage(src, 0, y0, w, h);
  const m = runSegmentation(seg, sqCv);
  const sc = m.w / 320, a = Math.round(y0 * sc), b = Math.round((y0 + h) * sc);
  const oh = b - a; if (!out || out.length !== m.w * oh) out = new Uint8Array(m.w * oh);
  out.set(m.data.subarray(a * m.w, b * m.w));
  return { w: m.w, h: oh, data: out };
}

function dilateBool(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (src[y * w + k]) { v = 1; break; }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x]) { v = 1; break; }
    out[y * w + x] = v;
  }
  return out;
}

// ---------- background model: median of the frames outside the person ----------
// The person is excluded from every sample, so no “ghosts” of earlier poses remain.
export async function buildBackground(video, seg, t0, t1, N = 21, onProgress, live = false) {
  const bw = 400, bh = Math.round((bw * video.videoHeight) / video.videoWidth);
  const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const frames = [], masks = [];
  const cur = video.currentTime;
  for (let i = 0; i < N; i++) {
    if (live) await new Promise((r) => setTimeout(r, 200)); else await seekTo(video, t0 + ((t1 - t0) * (i + 0.5)) / N);
    cx.drawImage(video, 0, 0, bw, bh);
    frames.push(cx.getImageData(0, 0, bw, bh).data.slice());
    const person = new Uint8Array(bw * bh);
    if (seg) {
      const m = segFrame(seg, cv);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        person[y * bw + x] = m.data[Math.min(m.h - 1, ((y / bh) * m.h) | 0) * m.w + Math.min(m.w - 1, ((x / bw) * m.w) | 0)] > 70 ? 1 : 0;
      }
    }
    masks.push(dilateBool(person, bw, bh, 9));
    onProgress && onProgress((i + 1) / N);
  }
  const out = cx.createImageData(bw, bh), o = out.data;
  const rel = cx.createImageData(bw, bh), rd = rel.data;
  const vals = new Uint8Array(N);
  const med = (cnt) => { for (let i = 1; i < cnt; i++) { const v = vals[i]; let j = i - 1; while (j >= 0 && vals[j] > v) { vals[j + 1] = vals[j]; j--; } vals[j + 1] = v; } return vals[cnt >> 1]; };
  for (let p = 0; p < bw * bh; p++) {
    let valid = 0; for (let i = 0; i < N; i++) if (!masks[i][p]) valid++;
    rd[p * 4] = rd[p * 4 + 1] = rd[p * 4 + 2] = valid >= 7 ? 255 : 0; rd[p * 4 + 3] = 255;
    for (let ch = 0; ch < 3; ch++) {
      let cnt = 0;
      for (let i = 0; i < N; i++) if (valid < 4 || !masks[i][p]) vals[cnt++] = frames[i][p * 4 + ch];
      o[p * 4 + ch] = med(cnt);
    }
    o[p * 4 + 3] = 255;
  }
  cx.putImageData(out, 0, 0);
  const rc = document.createElement('canvas'); rc.width = bw; rc.height = bh; rc.getContext('2d').putImageData(rel, 0, 0);
  cv.rel = rc;
  if (!live) await seekTo(video, cur);
  return cv;
}

// ---------- frame processing ----------
function boxBlur(src, dst, tmp, cols, rows, r) {
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let s = 0, c = 0; for (let k = Math.max(0, x - r); k <= Math.min(cols - 1, x + r); k++) { s += src[y * cols + k]; c++; }
    tmp[y * cols + x] = s / c;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let s = 0, c = 0; for (let k = Math.max(0, y - r); k <= Math.min(rows - 1, y + r); k++) { s += tmp[k * cols + x]; c++; }
    dst[y * cols + x] = s / c;
  }
}
function maxFilter(src, dst, tmp, cols, rows, r) {
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let m = 0; for (let k = Math.max(0, x - r); k <= Math.min(cols - 1, x + r); k++) m = Math.max(m, src[y * cols + k]);
    tmp[y * cols + x] = m;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let m = 0; for (let k = Math.max(0, y - r); k <= Math.min(rows - 1, y + r); k++) m = Math.max(m, tmp[k * cols + x]);
    dst[y * cols + x] = m;
  }
}

export class Processor {
  constructor(layout, shared) {
    this.L = layout; this.shared = shared; // shared: {segmenter, bg}
    const { sw, sh, n } = layout;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; };
    [this.c1, this.x1] = mk(sw, sh); [this.c2, this.x2] = mk(sw, sh); [this.c3, this.x3] = mk(sw, sh); [this.c4, this.x4] = mk(sw, sh);
    [this.segIn, this.segX] = mk(320, 214);
    this.maskCv = null; this.maskData = null;
    this.I = new Float32Array(n);
    for (const k of ['aL', 'aD', 'aM', 'tone', 'S', 'P', 'aB', 'aR', 'aA', 'T1', 'T2', 'T3', 'T4']) this[k] = new Float32Array(n);
    this.frameNo = 0; this.hasMask = false; this.lo = 0; this.hi = 1;
  }

  reset() { this.frameNo = 0; }

  runSeg(video) {
    const seg = this.shared.segmenter; if (!seg) return;
    const m = segFrame(seg, video, this.maskData);
    this.maskData = m.data;
    if (!this.maskCv || this.maskCv.width !== m.w || this.maskCv.height !== m.h) {
      this.maskCv = document.createElement('canvas'); this.maskCv.width = m.w; this.maskCv.height = m.h;
      this.maskCx = this.maskCv.getContext('2d'); this.maskImg = this.maskCx.createImageData(m.w, m.h);
    }
    const d = this.maskImg.data;
    for (let i = 0; i < m.data.length; i++) { const v = m.data[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    this.maskCx.putImageData(this.maskImg, 0, 0);
    this.hasMask = true;
  }

  // Fills this.I (smoothed brightness 0..1 per cell)
  process(video, p, { fresh = false, seg = true } = {}) {
    const { cols, rows, sw, sh, n } = this.L;
    const { aL, aD, aM, tone, S, P, T1, T2, T3 } = this;
    const pl = placement(video.videoWidth, video.videoHeight, sw, sh, p);
    const place = (x, src) => {
      if (!p.mirror) return x.drawImage(src, pl.dx, pl.dy, pl.dw, pl.dh);
      x.save(); x.translate(sw, 0); x.scale(-1, 1); x.drawImage(src, sw - pl.dx - pl.dw, pl.dy, pl.dw, pl.dh); x.restore();
    };
    this.x1.fillStyle = '#000'; this.x1.fillRect(0, 0, sw, sh); place(this.x1, video);
    const d1 = this.x1.getImageData(0, 0, sw, sh).data;
    const useBg = p.mode !== 'full' && this.shared.bg;
    const useMask = p.mode === 'smart' && this.shared.segmenter;
    let d2 = null, d3 = null, off = 0;
    if (useBg) {
      this.x2.fillStyle = '#000'; this.x2.fillRect(0, 0, sw, sh); place(this.x2, this.shared.bg);
      d2 = this.x2.getImageData(0, 0, sw, sh).data;
      // global brightness shift (camera auto-exposure): the median of the difference via a histogram
      const hist = new Uint32Array(256);
      for (let i = 0; i < d1.length; i += 16) {
        const dl = ((d1[i] - d2[i]) * 0.2126 + (d1[i + 1] - d2[i + 1]) * 0.7152 + (d1[i + 2] - d2[i + 2]) * 0.0722);
        hist[clamp(Math.round(dl / 2) + 128, 0, 255)]++;
      }
      let tot = 0; for (let i = 0; i < 256; i++) tot += hist[i];
      let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= tot / 2) { off = (i - 128) * 2 / 255; break; } }
      off = clamp(off, -0.08, 0.08);
    }
    let d4 = null;
    if (useBg && this.shared.bg.rel) { this.x4.fillStyle = '#000'; this.x4.fillRect(0, 0, sw, sh); place(this.x4, this.shared.bg.rel); d4 = this.x4.getImageData(0, 0, sw, sh).data; }
    if (useMask) {
      if (seg || !this.hasMask) this.runSeg(video);
      if (this.hasMask) {
        this.x3.fillStyle = '#000'; this.x3.fillRect(0, 0, sw, sh); place(this.x3, this.maskCv);
        d3 = this.x3.getImageData(0, 0, sw, sh).data;
      }
    }
    // per cell
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let sumL = 0, maxL = 0, sumD = 0, sumM = 0, sumB = 0, sumR = 0, sumA = 0;
      for (let y = 0; y < 5; y++) {
        let i = ((r * 5 + y) * sw + c * 3) * 4;
        for (let x = 0; x < 3; x++, i += 4) {
          const l = (0.2126 * d1[i] + 0.7152 * d1[i + 1] + 0.0722 * d1[i + 2]) / 255;
          sumL += l; if (l > maxL) maxL = l;
          if (d2) sumB += (d2[i] * 0.2126 + d2[i + 1] * 0.7152 + d2[i + 2] * 0.0722) / 255;
          if (d2 && p.mode === 'smart') sumD += Math.max(0, l - (d2[i] * 0.2126 + d2[i + 1] * 0.7152 + d2[i + 2] * 0.0722) / 255 - off);
          else if (d2) sumD += (Math.abs((d1[i] - d2[i]) / 255 - off) + Math.abs((d1[i + 1] - d2[i + 1]) / 255 - off) + Math.abs((d1[i + 2] - d2[i + 2]) / 255 - off)) / 3;
          if (d3) sumM += d3[i] / 255;
          if (d4) { sumR += d4[i] / 255; sumA += (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2])) / 765; }
        }
      }
      const k = r * cols + c;
      aL[k] = (sumL / 15) * 0.65 + maxL * 0.35; aD[k] = sumD / 15; this.aB[k] = sumB / 15; this.aR[k] = sumR / 15; this.aA[k] = sumA / 15; aM[k] = sumM / 15;
    }
    // auto-levels: stretch the person's brightness between the 5th and 95th percentile so facial features read
    {
      const hist = new Uint16Array(64); let cnt = 0;
      const onlyMask = p.mode === 'smart' && d3;
      for (let k = 0; k < n; k++) { if (onlyMask && aM[k] < 0.5) continue; hist[Math.min(63, (aL[k] * 64) | 0)]++; cnt++; }
      let lo = 0, hi = 1, acc = 0, f = false;
      for (let i = 0; i < 64; i++) { acc += hist[i]; if (!f && acc >= cnt * 0.05) { lo = i / 64; f = true; } if (acc >= cnt * 0.95) { hi = (i + 1) / 64; break; } }
      if (this.frameNo === 0 || fresh) { this.lo = lo; this.hi = hi; } else { this.lo += (lo - this.lo) * 0.08; this.hi += (hi - this.hi) * 0.08; }
    }
    const lo = this.lo, span = Math.max(0.15, this.hi - this.lo);
    boxBlur(aL, T1, T2, cols, rows, 3);
    const detailK = p.mode === 'full' ? p.boost * 2.2 + p.edge * 1.2 : p.edge * 2.4;
    for (let k = 0; k < n; k++) {
      const ln = clamp((aL[k] - lo) / span);
      let t = Math.pow(clamp((ln - 0.5) * p.contrast + 0.5 + p.brightness), 1.5);
      tone[k] = clamp(t + detailK * (aL[k] - T1[k]));
    }
    const I = this.I; const T = new Float32Array(0);
    const target = this.T4;
    if (p.mode === 'full') {
      for (let k = 0; k < n; k++) target[k] = tone[k];
    } else {
      // smoke and anything moving: the difference from the background
      const thr = 0.008 + p.supp * 0.07, gain = 3 + p.boost * 16;
      const gate = this.T3; // smoke is visible on a dark background: light walls give false edges
      if (p.mode === 'smart') { maxFilter(this.aB, T1, T2, cols, rows, 2); for (let k = 0; k < n; k++) gate[k] = 1 - smooth(0.2, 0.34, T1[k]); } else gate.fill(1);
      for (let k = 0; k < n; k++) S[k] = clamp((aD[k] - thr) * gain) * gate[k];
      boxBlur(S, T1, T2, cols, rows, 1);
      for (let k = 0; k < n; k++) S[k] = Math.max(S[k] * 0.4, T1[k] * 1.1) ;
      if (p.mode === 'smart' && d3) {
        for (let k = 0; k < n; k++) T1[k] = smooth(0.55, 0.8, aM[k]);
        // where the background is reliably known and the frame matches it, there is no “person” (a model error at a wall edge)
        for (let k = 0; k < n; k++) T1[k] *= 1 - this.aR[k] * (1 - smooth(0.03, 0.09, Math.max(0, this.aA[k] - Math.abs(off))));
        maxFilter(T1, P, T2, cols, rows, p.grow | 0);
        // edges by tone inside the person
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const k = r * cols + c;
          const xm = c > 0 ? k - 1 : k, xp = c < cols - 1 ? k + 1 : k, ym = r > 0 ? k - cols : k, yp = r < rows - 1 ? k + cols : k;
          const e = clamp((Math.abs(tone[xp] - tone[xm]) * 1.2 + Math.abs(tone[yp] - tone[ym])) * 0.5);
          const person = Math.max(tone[k], p.sil * smooth(0.8, 0.98, aM[k]));
          target[k] = Math.max(clamp(person + p.edge * 0.5 * e) * P[k], S[k]);
        }
        // suppress isolated static thin lines (a wall edge the model took for a person)
        const tmpT = this.T3;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const k = r * cols + c; tmpT[k] = target[k];
          if (target[k] > 0.1 && this.aA[k] < 0.05) {
            let cnt = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue; const rr = r + dy, cc = c + dx;
              if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && target[rr * cols + cc] > 0.12) cnt++;
            }
            if (cnt < 4) tmpT[k] = target[k] * 0.2;
          }
        }
        target.set(tmpT);
      } else {
        for (let k = 0; k < n; k++) target[k] = S[k];
      }
    }
    const a = fresh || this.frameNo === 0 ? 1 : 1 - p.stab;
    for (let k = 0; k < n; k++) I[k] += (target[k] - I[k]) * a;
    this.frameNo++;
    return I;
  }
}

// ---------- brightness grid -> glyph + brightness ----------
export class Mapper {
  // Words inside the silhouette: every row of the figure reads left to right in whole words, and the text stays in place.
  // A new phrase “floods” the figure from top to bottom, with the previous one remaining below it, slightly dimmer.
  fillWords(cols, rows, o) {
    const { lvl, glyph, bri } = this, ph = o.phrases, wipe = Math.min(1, (o.phraseAge ?? 9999) / 1400) * rows;
    const split = (p) => p.split(' ').filter(Boolean), W0 = split(ph[0]), W1 = split(ph[1] || ph[0]), dot = CH_INDEX['.'];
    for (let r = 0; r < rows; r++) {
      const fresh = r <= wipe, W = fresh ? W0 : W1; if (!W.length) continue;
      const lead = wipe < rows && Math.abs(r - wipe) < 1.5;
      let c = 0;
      while (c < cols) {
        if (!lvl[r * cols + c]) { c++; continue; }
        let e = c; while (e < cols && lvl[r * cols + e]) e++;
        const n = e - c; let pos = 0, wi = W.length >= 5 ? (r >> 2) % W.length : 0;
        if (n >= 3) while (pos < n) {
          const w = W[wi % W.length]; if (pos + w.length > n) break;
          for (let k = 0; k < w.length; k++) {
            const cell = r * cols + c + pos + k; glyph[cell] = CH_INDEX[w[k]] ?? dot;
            let b = Math.max(4, bri[cell]);
            b = lead ? LV - 1 : fresh ? Math.round(b + (LV - 1 - b) * (o.freshK || 0) * 0.8) : Math.round(b * 0.7);
            bri[cell] = Math.max(3, b);
          }
          pos += w.length; if (pos < n) { bri[r * cols + c + pos] = 1; pos++; } wi++;
        }
        for (let k = pos; k < n; k++) bri[r * cols + c + k] = Math.min(bri[r * cols + c + k], 2); // rest of the row: faint dots, so the shape of the figure is kept
        c = e;
      }
    }
  }

  constructor(n) { this.fresh = true; this.lvl = new Uint8Array(n); this.glyph = new Uint16Array(n); this.bri = new Uint8Array(n); }
  // sticky: hysteresis, so a character does not flicker when brightness jitters
  map(I, cols, rows, T, o, sticky = true) {
    let cs = CHARSETS[o.charset]; const asText = cs.text && o.phrases && o.phrases.length; if (cs.text && !asText) cs = CHARSETS.code;
    const K = cs.K, n = I.length, { lvl, glyph, bri } = this;
    const rate = o.liveness * 1.5;
    if (this.fresh) { sticky = false; this.fresh = false; }
    for (let c = 0; c < n; c++) {
      const x = I[c] * K; let l = lvl[c];
      if (!sticky || x >= l + 1.3 || x < l - 0.3) l = Math.min(K, Math.floor(x));
      lvl[c] = l;
      if (l === 0) { bri[c] = 0; continue; }
      const g = cs.idx[l - 1];
      if (asText) { bri[c] = Math.max(1, Math.round(1 + (LV - 2) * Math.pow(clamp(I[c]), 0.6))); glyph[c] = CH_INDEX['.']; continue; }
      const ep = rate ? Math.floor(T * rate + rnd(c, 1) * 8) : 0;
      glyph[c] = g[h32(Math.imul(c, 7919) + Math.imul(ep, 104729)) % g.length];
      bri[c] = Math.max(1, Math.round(1 + (LV - 2) * Math.pow(clamp(I[c]), 0.85)));
    }
    if (asText) this.fillWords(cols, rows, o);
    if (cs.words && o.words) {
      const lo = Math.ceil(K * 0.55);
      for (let r = 0; r < rows; r++) for (let s = 0; s * 9 + 8 < cols; s++) {
        if (rnd(r * 977 + s, 5) > 0.1) continue;
        const w = WORDS[(rnd(r * 977 + s, 6) * WORDS.length) | 0], st = s * 9 + ((rnd(r * 977 + s, 7) * 3) | 0);
        let ok = st + w.length < cols;
        for (let k = 0; ok && k < w.length; k++) if (lvl[r * cols + st + k] < lo) ok = false;
        if (ok) for (let k = 0; k < w.length; k++) glyph[r * cols + st + k] = CH_INDEX[w[k]];
      }
    }
    return this;
  }
}

// ---------- rendering ----------
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;

export class Renderer {
  constructor(canvas, layout, style) {
    this.cv = canvas; this.L = layout; canvas.width = layout.W; canvas.height = layout.H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.setStyle(style);
    const n = layout.n; this.r1 = new Float32Array(n); this.r2 = new Float32Array(n); this.r3 = new Float32Array(n); this.r4 = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.r1[i] = rnd(i, 11); this.r2[i] = rnd(i, 12); this.r3[i] = rnd(i, 13); this.r4[i] = rnd(i, 14); }
  }
  setStyle(style) {
    this.style = style;
    const { cw, ch } = this.L; const acw = Math.ceil(cw) + 1, ach = Math.ceil(ch) + 1;
    this.acw = acw; this.ach = ach;
    const a = document.createElement('canvas'); this.atlasN = UNIVERSE.length; a.width = UNIVERSE.length * acw; a.height = LV * ach;
    const x = a.getContext('2d');
    x.font = `${Math.round(ch * 0.86)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const [R, G, B] = hex(style.fg);
    for (let l = 1; l < LV; l++) {
      x.fillStyle = `rgba(${R},${G},${B},${(0.16 + 0.84 * Math.pow(l / (LV - 1), 1.1)).toFixed(3)})`;
      for (let g = 0; g < UNIVERSE.length; g++) x.fillText(UNIVERSE[g], g * acw + acw / 2, l * ach + ach / 2 + ch * 0.04);
    }
    this.atlas = a;
  }
  putAt(g, b, cx, cy) { this.put(g, b, Math.round(cx - this.acw / 2), Math.round(cy - this.ach / 2)); }
  clear() { if (this.atlasN !== UNIVERSE.length) this.setStyle(this.style); this.ctx.fillStyle = this.style.bg; this.ctx.fillRect(0, 0, this.L.W, this.L.H); }
  put(g, b, x, y) { this.ctx.drawImage(this.atlas, g * this.acw, b * this.ach, this.acw, this.ach, x, y, this.acw, this.ach); }

  // mode: 'still' | 'intro' | 'outro'; t = 0..1 within the transition
  draw(m, mode = 'still', t = 1, T = 0, o = {}) {
    const { cols, rows, cw, ch, W, H } = this.L; const n = cols * rows;
    this.clear();
    const { glyph, bri } = m;
    if (mode === 'still') {
      for (let k = 0; k < n; k++) { const b = bri[k]; if (b) this.put(glyph[k], b, Math.round((k % cols) * cw), Math.round(((k / cols) | 0) * ch)); }
      if (o.rain) this.rainAny(T, o.rain, m, 1);
      return;
    }
    const { r1, r2, r3, r4 } = this; const tick = Math.floor(T * 9);
    for (let k = 0; k < n; k++) {
      const b0 = bri[k]; if (!b0) continue;
      const tx = (k % cols) * cw, ty = ((k / cols) | 0) * ch;
      let x, y, b, g = glyph[k];
      if (mode === 'intro') {
        const d = r1[k] * 0.5, p = clamp((t - d) / 0.5), e = easeOut(p);
        const sx = r2[k] * W, sy = r3[k] * H, sw = Math.sin(p * Math.PI) * (r4[k] - 0.5) * 0.3;
        x = lerp(sx, tx, e) + sw * H; y = lerp(sy, ty, e) - sw * W * 0.2;
        b = Math.max(1, Math.round(b0 * (0.28 + 0.72 * e)));
        if (p < 0.78) g = h32(Math.imul(k, 31) + tick * 7) % GLYPH_COUNT;
      } else {
        const d = r1[k] * 0.5, p = clamp((t - d) / 0.5);
        const e = easeIn(p) * 0.85 + p * 0.15;
        const ang = r2[k] * 6.2832, dist = (0.12 + 0.7 * r3[k]) * W * 0.5;
        x = tx + Math.cos(ang) * dist * e + Math.sin(T * 3 + k) * 3 * p;
        y = ty + Math.sin(ang) * dist * e * 0.6 + e * e * H * 0.22;
        b = Math.round(b0 * Math.pow(1 - p, 1.3)); if (b < 1) continue;
        if (p > 0.12) g = h32(Math.imul(k, 31) + tick * 7) % GLYPH_COUNT;
      }
      this.put(g, b, Math.round(x), Math.round(y));
    }
    if (o.rain) this.rainAny(T, o.rain, null, mode === 'intro' ? t : 1 - t);
  }

  rainAny(T, o, m, fade) { if (o.mode === 'flow') this.rainFlow(T, o, m, fade); else this.rain(T, o, m && m.bri, fade); }
  drawSparks(T, text) { if (this.sparks) this.sparks.draw(this, T, text); }

  // Rain that flows around the silhouette: drops slide along the contour and “soak into” the figure, flashing its edge
  rainFlow(T, o, m, fade) {
    const { cols, rows, cw, ch, n } = this.L; const top = LV - 1;
    let sim = this.sim;
    if (!sim || sim.n !== n) sim = this.sim = { T: null, drops: [], flash: new Float32Array(n), n };
    const occ = m ? m.bri : null, solid = (r, c) => occ && r >= 0 && r < rows && c >= 0 && c < cols && occ[r * cols + c] > 2;
    const text = o.text || '', mk = (y) => ({ x: Math.floor(Math.random() * cols), y, v: (6 + 14 * Math.random()) * o.speed, len: 6 + Math.floor(18 * Math.random()), side: 0, h: [], k: Math.floor(Math.random() * 1000), t0: Math.floor(Math.random() * 1000) });
    const absorb = (dp, r, c) => {
      if (r >= 0 && r < rows && c >= 0 && c < cols) sim.flash[r * cols + c] = 1;
      if (dp.shed) dp.dead = true; else Object.assign(dp, mk(-Math.random() * rows * 0.5));
    };
    const step = (d) => {
      for (const dp of sim.drops) {
        for (const f of this.forces || []) { // hand gestures: a palm repels, a fist gathers
          const fx = dp.x - f.x, fy = dp.y - f.y, dd = Math.hypot(fx, fy);
          if (dd < f.r && dd > 0.01) { const w = (1 - dd / f.r) * (f.type === 'repel' ? 1 : -1.6); dp.x += (fx / dd) * w * 55 * d; dp.y += (fy / dd) * w * 40 * d; }
        }
        const c = Math.max(0, Math.min(cols - 1, Math.round(dp.x))), r = Math.floor(dp.y);
        if (solid(r, c)) { absorb(dp, r, c); continue; }
        const nr = Math.floor(dp.y + dp.v * d + 1);
        if (solid(nr, c)) {
          if (!dp.side) { // look for the nearest edge of the figure where the drop can keep falling
            let side = 0; for (let k = 1; k < 16 && !side; k++) { const L = !solid(r + 1, c - k) && c - k >= 0, R = !solid(r + 1, c + k) && c + k < cols; if (L || R) side = L && R ? (Math.random() < 0.5 ? -1 : 1) : L ? -1 : 1; }
            if (!side) { absorb(dp, nr, c); continue; }
            dp.side = side;
          }
          dp.x += dp.side * (20 + dp.v) * d;
          if (Math.random() < 0.5 * d) { absorb(dp, nr, c); continue; }
        } else { dp.side = 0; dp.y += dp.v * d; }
        const cc = Math.max(0, Math.min(cols - 1, Math.round(dp.x))), rr = Math.floor(dp.y), hh = dp.h[0];
        if (!hh || hh[0] !== cc || hh[1] !== rr) { dp.k++; dp.h.unshift([cc, rr, text ? CH_INDEX[text[(dp.t0 + dp.k) % text.length]] : undefined]); if (dp.h.length > dp.len) dp.h.pop(); }
        if (dp.y > rows + dp.len || dp.x < -2 || dp.x > cols + 2) { if (dp.shed) dp.dead = true; else Object.assign(dp, mk(-Math.random() * 6)); }
      }
      const k = Math.exp(-3.5 * d); for (let i = 0; i < n; i++) sim.flash[i] *= k;
      if (occ && o.shed > 0) { // the figure drips code downward
        const tries = Math.ceil(o.shed * 120 * d * 30);
        for (let t = 0; t < tries && sim.drops.length < want + 260; t++) {
          const q = Math.floor(Math.random() * n), r = (q / cols) | 0, c = q % cols;
          if (occ[q] > 3 && !solid(r + 1, c) && r + 1 < rows) { const dp = mk(r + 1); dp.x = c; dp.shed = true; dp.len = 4 + Math.floor(Math.random() * 10); dp.v *= 0.7; sim.drops.push(dp); }
        }
      }
      if (sim.drops.some((x) => x.dead)) sim.drops = sim.drops.filter((x) => !x.dead);
    };
    const want = Math.max(1, Math.round(cols * o.amt * 1.2));
    let dt = sim.T === null ? -1 : T - sim.T;
    if (dt < 0 || dt > 0.3) {
      sim.drops.length = 0; sim.flash.fill(0);
      for (let i = 0; i < want; i++) sim.drops.push(mk(Math.random() * rows));
      for (let i = 0; i < 40; i++) step(1 / 30);
      dt = 0;
    }
    let base = 0; for (const x of sim.drops) if (!x.shed) base++;
    while (base < want) { sim.drops.push(mk(-Math.random() * rows * 0.5)); base++; }
    if (base > want) { let ex = base - want; sim.drops = sim.drops.filter((x) => x.shed || ex-- <= 0); }
    for (let left = dt; left > 1e-4; left -= 1 / 30) step(Math.min(1 / 30, left));
    sim.T = T;
    for (const dp of sim.drops) {
      for (let i = 0; i < dp.h.length; i++) {
        const [c, r, gg] = dp.h[i]; if (r < 0 || r >= rows || solid(r, c)) continue;
        const b = Math.round(top * (i === 0 ? 1 : Math.pow(1 - i / dp.len, 1.6) * 0.75) * fade); if (b < 1) continue;
        if (gg === undefined && text) continue; // a space in the text: an empty cell
        this.put(gg !== undefined ? gg : RAIN_CH[h32(Math.imul(c, 977) + Math.imul(r, 131) + Math.floor(T * 3 + dp.len * 0.3) * 7919) % RAIN_CH.length], b, Math.round(c * cw), Math.round(r * ch));
      }
    }
    if (m) for (let k = 0; k < n; k++) { const f = sim.flash[k]; if (f > 0.04 && m.bri[k]) this.put(m.glyph[k], Math.min(top, m.bri[k] + Math.round((top - m.bri[k]) * f)), Math.round((k % cols) * cw), Math.round(((k / cols) | 0) * ch)); }
  }

  // Falling code: columns of characters with a bright head and a fading tail; not drawn in cells occupied by the figure
  rain(T, o, occ, fade = 1) {
    const { cols, rows, cw, ch } = this.L; const top = LV - 1;
    for (let c = 0; c < cols; c++) {
      if (rnd(c, 21) > o.amt) continue;
      const v = (6 + 14 * rnd(c, 22)) * o.speed, len = 6 + Math.floor(18 * rnd(c, 23)), gap = Math.floor(rows * 1.2 * rnd(c, 24));
      const cyc = rows + len + gap, head = ((T * v + rnd(c, 25) * cyc) % cyc) - len * 0.2;
      for (let d = 0; d < len; d++) {
        const r = Math.floor(head - d); if (r < 0 || r >= rows) continue;
        if (occ && occ[r * cols + c]) continue;
        const f = d === 0 ? 1 : Math.pow(1 - d / len, 1.6) * 0.75;
        const b = Math.round(top * f * fade); if (b < 1) continue;
        const tx = o.text; if (tx && tx[(c * 17 + r) % tx.length] === ' ') continue;
        const g = tx ? CH_INDEX[tx[(c * 17 + r) % tx.length]] : RAIN_CH[h32(Math.imul(c, 977) + Math.imul(r, 131) + Math.floor(T * 3 + rnd(c, 26) * 5) * 7919) % RAIN_CH.length];
        this.put(g, b, Math.round(c * cw), Math.round(r * ch));
      }
    }
  }
}

export function hex(s) { const v = parseInt(s.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }

// ---------- threads of code between the hands ----------
const STREAM = 'if (hand) { return a + b; } else { void run(); } for (i = 0; i < n; i++) { x[i] = y[i] / 2; } let t = null; try { go(); } while (1) { sync(); } ';
const BONES = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [5, 9, 13, 17], [0, 17]];
const TIPS = [4, 8, 12, 16, 20];

export class HandThreads {
  constructor() { this.p = [null, null]; this.pres = 0; this.skel = 0; this.text = ''; this.oneWay = false; this.speed = 14; this.vib = 0; this.energy = 0; this.tau = 0; }
  // hands: an array of hands, each with 21 points [x, y] already in canvas pixels
  update(hands, dt) {
    const k = 1 - Math.pow(0.0005, dt); // smoothing of point jitter
    if (hands.length >= 1) {
      const sorted = hands.slice(0, 2).sort((a, b) => a[0][0] - b[0][0]);
      const dist = (s, h) => (this.p[s] ? Math.hypot(this.p[s][0][0] - h[0][0], this.p[s][0][1] - h[0][1]) : 1e9);
      const slots = sorted.length >= 2 ? [0, 1] : [dist(0, sorted[0]) <= dist(1, sorted[0]) ? 0 : 1];
      sorted.forEach((h, i) => {
        const s = slots[i], prev = this.p[s];
        this.p[s] = prev ? h.map((pt, j) => [prev[j][0] + (pt[0] - prev[j][0]) * k, prev[j][1] + (pt[1] - prev[j][1]) * k]) : h.map((pt) => pt.slice());
      });
      this.skel = Math.min(1, this.skel + dt * 6);
    } else this.skel = Math.max(0, this.skel - dt * 3);
    this.pres = hands.length >= 2 ? Math.min(1, this.pres + dt * 5) : Math.max(0, this.pres - dt * 2.5);
  }

  chain(rend, a, b, T, o) {
    const { cw } = rend.L; const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy); const n = Math.max(1, Math.round(len / (cw * 1.1)));
    for (let k = 0; k <= n; k++) {
      const ST = this.text || STREAM, t = k / n, ch = ST[(k * 3 + Math.floor(T * this.speed * 0.4)) % ST.length], g = CH_INDEX[ch];
      if (g === undefined) continue;
      rend.putAt(g, o.b, a[0] + dx * t, a[1] + dy * t);
    }
  }

  draw(rend, T, { skeleton }) {
    const { cw, W } = rend.L; const [A, B] = this.p; const top = LV - 1;
    if (skeleton && this.skel > 0.02) {
      for (const h of this.p) if (h) for (const bone of BONES) for (let i = 0; i + 1 < bone.length; i++) this.chain(rend, h[bone[i]], h[bone[i + 1]], T, { b: Math.max(1, Math.round(top * 0.55 * this.skel)) });
    }
    if (!A || !B || this.pres < 0.02) return;
    const pres = this.pres;
    const strand = (a, b, i, dir, dim) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      const tau = clamp(d / (0.55 * W)), slack = 1 - tau;
      const nx = -dy / d, ny = dx / d;
      const sag = slack * 0.32 * d * (0.7 + 0.3 * Math.sin(T * 1.7 + i));
      const wob = Math.sin(T * 2.3 + i * 1.7) * 0.14 * d * slack + (i - 2) * 0.05 * d * slack;
      const cx = (a[0] + b[0]) / 2 + nx * wob, cy = (a[1] + b[1]) / 2 + ny * wob + sag;
      const n = Math.max(2, Math.round((Math.hypot(cx - a[0], cy - a[1]) + Math.hypot(b[0] - cx, b[1] - cy)) / (cw * 1.05)));
      for (let k = 0; k <= n; k++) {
        const t = k / n, u = 1 - t;
        // “pluck”: a standing wave, more visible on a taut thread
        const pl = Math.sin(Math.PI * t) * Math.sin(T * 9 + i * 1.3) * (0.012 + 0.05 * this.vib + 0.02 * this.energy) * d * tau;
        const x = u * u * a[0] + 2 * u * t * cx + t * t * b[0] + nx * pl, y = u * u * a[1] + 2 * u * t * cy + t * t * b[1] + ny * pl;
        const ST = this.text || STREAM, ch = ST[(((k + Math.floor(T * this.speed * dir)) % ST.length) + ST.length) % ST.length], g = CH_INDEX[ch];
        if (g === undefined) continue;
        const pulse = 0.78 + 0.22 * Math.sin(k * 0.55 - T * 8 * dir);
        const br = Math.round(top * pres * (0.55 + 0.45 * tau) * pulse * dim);
        if (br >= 1) rend.putAt(g, Math.min(top, br), x, y);
      }
    };
    const dist = Math.hypot(A[9][0] - B[9][0], A[9][1] - B[9][1]); this.tau = clamp(dist / (0.55 * W));
    TIPS.forEach((tp, i) => strand(A[tp], B[tp], i, this.oneWay ? 1 : i % 2 ? -1 : 1, 1));
    const web = clamp(1 - dist / (0.5 * W)); // when the hands are close, the threads interweave
    if (web > 0.05) for (let i = 0; i < 4; i++) strand(A[TIPS[i]], B[TIPS[i + 1]], i + 0.5, i % 2 ? 1 : -1, 0.6 * web);
    for (const h of [A, B]) for (const tp of TIPS) rend.putAt(CH_INDEX['0'], Math.max(1, Math.round(top * pres)), h[tp][0], h[tp][1]);
  }
}

// ---------- sparks: mouth smoke and the clap burst ----------
export class Sparks {
  constructor() { this.p = []; }
  // x, y are in cells; vx, vy are cells per second
  add(x, y, vx, vy, life, o = {}) { if (this.p.length < 2200) this.p.push({ x, y, vx, vy, life, age: 0, drag: o.drag ?? 1.2, grav: o.grav ?? 0, g: Math.random(), turb: o.turb ?? 14 }); }
  burst(x, y, count) { for (let i = 0; i < count; i++) { const a = Math.random() * 6.283, s = 6 + Math.random() * 26; this.add(x, y, Math.cos(a) * s, Math.sin(a) * s * 0.7, 0.8 + Math.random() * 1.1, { drag: 1.8, grav: 7, turb: 6 }); } }
  step(d) {
    for (const q of this.p) {
      q.age += d; q.vx += (Math.random() - 0.5) * q.turb * d * 4; q.vy += (Math.random() - 0.5) * q.turb * d * 2 + q.grav * d;
      const k = Math.exp(-q.drag * d); q.vx *= k; q.vy *= k; q.x += q.vx * d; q.y += q.vy * d;
    }
    this.p = this.p.filter((q) => q.age < q.life);
  }
  draw(rend, T, text) {
    const { cols, rows, cw, ch } = rend.L, top = LV - 1;
    for (const q of this.p) {
      const c = Math.round(q.x), r = Math.round(q.y); if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const b = Math.round(top * 0.85 * Math.pow(1 - q.age / q.life, 1.2)); if (b < 1) continue;
      const g = text ? CH_INDEX[text[Math.floor(q.g * 997 + T * 6) % text.length]] : RAIN_CH[Math.floor(q.g * 997 + T * 6) % RAIN_CH.length];
      if (g !== undefined) rend.put(g, b, Math.round(c * cw), Math.round(r * ch));
    }
  }
}
