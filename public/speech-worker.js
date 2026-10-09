// Recognition worker: Whisper entirely locally; the language is detected among Russian and English.
let asr = null, TF = null, device = 'wasm';
// Known Whisper hallucinations on silence or noise (English and Russian subtitle credits, “thanks for watching”, …)
const JUNK = /^(thank you[.!]*|thanks for watching[.!]*|you[.!]*|bye[.!]*|\.+|субтитры.*|продолжение следует.*|спасибо за просмотр.*|редактор субтитров.*|корректор.*)$/i;

async function load(model, threads, prefer) {
  TF = await import('./vendor/transformers.min.js');
  const { pipeline, env } = TF;
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = '/models/'; env.useBrowserCache = false;
  env.backends.onnx.wasm.wasmPaths = '/vendor/ort/'; env.backends.onnx.wasm.numThreads = threads;
  if (prefer === 'webgpu' && self.navigator && navigator.gpu) {
    try { // the GPU: several times faster than the CPU
      asr = await pipeline('automatic-speech-recognition', 'Xenova/' + model, { device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } });
      await asr(new Float32Array(16000), { task: 'transcribe', language: 'english' }); // warm-up: a check and shader compilation
      device = 'webgpu'; return;
    } catch (e) { console.warn('WebGPU did not work, falling back to the CPU:', e); asr = null; }
  }
  asr = await pipeline('automatic-speech-recognition', 'Xenova/' + model, { dtype: 'q8', device: 'wasm' });
  device = 'wasm';
}

// One decoder step: which language token is more likely. Without this the model “translates” everything into English.
async function detectLang(audio, allowed) {
  const inputs = await asr.processor(audio);
  const gc = asr.model.generation_config, l2i = gc.lang_to_id || {};
  const ids = new TF.Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id ?? 50258)]), [1, 1]);
  const out = await asr.model.forward({ ...inputs, decoder_input_ids: ids });
  const data = out.logits.getData ? await out.logits.getData() : out.logits.data, V = out.logits.dims[out.logits.dims.length - 1], base = data.length - V;
  let best = allowed[0], bv = -Infinity;
  for (const code of allowed) { const id = l2i['<|' + code + '|>']; if (id === undefined) continue; if (data[base + id] > bv) { bv = data[base + id]; best = code; } }
  return best;
}

async function run(audio, lang) {
  let language = lang;
  if (!language) language = (await detectLang(audio, ['ru', 'en'])) === 'ru' ? 'russian' : 'english';
  const sec = audio.length / 16000;
  const out = await asr(audio, { task: 'transcribe', language, chunk_length_s: 30, return_timestamps: false, max_new_tokens: Math.ceil(sec * 6) + 12 });
  let t = (out.text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/(\b[\p{L}']+[,.!?]?\s+)\1{3,}/gu, '$1$1$1'); // a safeguard against repetition loops
  return { text: JUNK.test(t) || /DimaTorzok|Амара\.орг/i.test(t) ? '' : t, lang: language };
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') { try { await load(m.model, m.threads, m.device); postMessage({ type: 'ready', device }); } catch (er) { postMessage({ type: 'fail', error: String(er && er.message || er) }); } }
  else if (m.type === 'run') { try { { const r = await run(m.audio, m.lang); postMessage({ type: 'text', id: m.id, text: r.text, lang: r.lang }); } } catch (er) { postMessage({ type: 'error', id: m.id, error: String(er && er.message || er) }); } }
};
