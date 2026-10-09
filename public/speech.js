// Speech recognition: Whisper runs in a separate worker (speech-worker.js) so the page does not freeze.
// Here: the client for that worker and a voice-activity detector that cuts phrases at pauses (MicVAD).
export const LANGS = { auto: null, 'ru-RU': 'russian', 'en-US': 'english', 'pt-PT': 'portuguese', 'uk-UA': 'ukrainian' };

export class WhisperClient {
  // device: 'webgpu' (the GPU, if suitable) or 'wasm' (the CPU)
  constructor(model, device = 'webgpu') { this.model = model; this.prefer = device; this.done = 0; this.restarts = 0; this.device = '?'; this.start(); }
  start() {
    this.w = new Worker(new URL('./speech-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map(); this.n = this.n || 0; this.done = 0;
    this.ready = new Promise((res, rej) => { this.resReady = res; this.rejReady = rej; });
    this.ready.catch(() => {});
    const w = this.w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { this.device = m.device; this.resReady(); }
      else if (m.type === 'fail') this.rejReady(new Error(m.error));
      else if (m.type === 'text' || m.type === 'error') { const p = this.pending.get(m.id); if (p) { clearTimeout(p.timer); this.pending.delete(m.id); m.type === 'text' ? p.res({ text: m.text, lang: m.lang }) : p.rej(new Error(m.error)); } }
    };
    w.onerror = (e) => { this.rejReady(new Error(e.message || 'recognition worker error')); this.restart('worker crashed'); };
    w.postMessage({ type: 'load', model: this.model, device: this.prefer, threads: self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1 });
  }
  // Restart a “hung” worker: every waiting phrase gets an error, and we continue with a clean worker
  restart(why) {
    if (this.dead) return;
    this.restarts++; this.w.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.rej(new Error(why)); }
    this.start();
  }
  async transcribe(audio, lang) {
    await this.ready;
    if (this.done >= 40) this.restart('scheduled restart'), await this.ready; // a safeguard against memory build-up
    return new Promise((res, rej) => {
      const id = ++this.n, sec = audio.length / 16000, limit = (this.device === 'webgpu' ? 12000 : 30000) + sec * 1500;
      const timer = setTimeout(() => this.restart('recognition hung'), limit);
      this.pending.set(id, { res: (t) => { this.done++; res(t); }, rej, timer });
      this.w.postMessage({ type: 'run', id, audio, lang: LANGS[lang] || null }, [audio.buffer]);
    });
  }
  terminate() { this.dead = true; this.w.terminate(); for (const p of this.pending.values()) clearTimeout(p.timer); }
}

// Catches phrases at pauses and hands each one over as a 16 kHz array
export class MicVAD {
  constructor(stream, onUtterance, onState, onPartial) {
    this.stream = stream; this.onUtterance = onUtterance; this.onState = onState || (() => {}); this.onPartial = onPartial; this.utter = 0; this.sincePartial = 0; this.ms = 0; this.startMs = 0;
    this.ctx = new AudioContext({ sampleRate: 16000 }); if (this.ctx.state === 'suspended') this.ctx.resume();
    this.blocks = 0; this.maxRms = 0;
    const src = this.ctx.createMediaStreamSource(stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.pre = []; this.buf = null; this.silence = 0; this.voicedBlocks = 0; this.nf = 0.005; this.run = 0;
    this.proc.onaudioprocess = (e) => this.handle(e.inputBuffer.getChannelData(0).slice());
    src.connect(this.proc); this.proc.connect(this.ctx.destination);
    this.src = src;
  }
  handle(b) {
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    const rms = Math.sqrt(s / b.length); this.blocks++; this.ms += (b.length / 16000) * 1000; if (rms > this.maxRms) this.maxRms = rms;
    const thr = Math.max(0.008, this.nf * 3.5), voiced = rms > thr, ms = (b.length / 16000) * 1000;
    if (!this.buf) {
      this.nf = Math.max(0.002, this.nf * 0.98 + rms * 0.02);
      this.pre.push(b); if (this.pre.length > 4) this.pre.shift();
      this.run = voiced ? this.run + 1 : 0;
      if (this.run >= 2) { this.buf = [...this.pre]; this.startMs = this.ms - this.pre.length * (b.length / 16000) * 1000; this.silence = 0; this.voicedBlocks = 0; this.onState('voice'); }
    } else {
      this.buf.push(b);
      if (voiced) { this.silence = 0; this.voicedBlocks++; } else this.silence += ms;
      this.sincePartial += ms;
      if (this.onPartial && this.sincePartial >= 1700 && this.voicedBlocks >= 6) { this.sincePartial = 0; this.onPartial(this.concat(this.buf), this.utter); } // partial text while the person is still speaking
      if (this.silence >= 700 || this.buf.length * ms > 8000) this.finish();
    }
  }
  concat(blocks) { const n = blocks.reduce((a, x) => a + x.length, 0), out = new Float32Array(n); let o = 0; for (const x of blocks) { out.set(x, o); o += x.length; } return out; }
  finish() {
    const blocks = this.buf; this.buf = null; this.run = 0; this.pre = []; this.sincePartial = 0; const id = this.utter++;
    if (this.voicedBlocks < 3) { this.onState('idle'); return; } // too short: a click or noise
    this.onState('think'); this.onUtterance(this.concat(blocks), id, { t0: Math.max(0, this.startMs) / 1000, t1: Math.max(this.startMs + 400, this.ms - this.silence + 150) / 1000 }); // seconds on the microphone clock
  }
  stop() { try { this.proc.disconnect(); this.src.disconnect(); this.ctx.close(); } catch (e) { /* already closed */ } }
}

// Language detection among the allowed ones: one decoder step, to see which language token the model finds most likely.
// (Without this the model assumes English by default and “translates” other speech.)
export async function detectLang(asr, audio, allowed = ['ru', 'en']) {
  const inputs = await asr.processor(audio);
  const gc = asr.model.generation_config, l2i = gc.lang_to_id || {};
  const ids = new TF.Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id ?? 50258)]), [1, 1]);
  const out = await asr.model.forward({ ...inputs, decoder_input_ids: ids });
  const data = out.logits.data; const V = out.logits.dims[out.logits.dims.length - 1], base = data.length - V;
  let best = allowed[0], bv = -Infinity; const all = {};
  for (const code of allowed) { const id = l2i['<|' + code + '|>']; if (id === undefined) continue; const v = data[base + id]; all[code] = +v.toFixed(2); if (v > bv) { bv = v; best = code; } }
  return { best, all };
}
