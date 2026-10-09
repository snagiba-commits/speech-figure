// Prepares public/vendor and public/models for Speech Figure: copies browser libraries out of node_modules and downloads the models.
//   npm run setup                         core: MediaPipe (person / hands / face) + video muxers   (~50 MB)
//   npm run setup:speech                  + local Whisper speech-to-text (default model: small)     (~700 MB)
//   npm run setup:speech -- --model base  lighter / faster, understands Russian worse               (~335 MB)
//   npm run setup:speech -- --model both
// Add --force to re-download files that already exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public'), NM = path.join(ROOT, 'node_modules');
const args = process.argv.slice(2), has = (f) => args.includes(f), val = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const force = has('--force'), speech = has('--speech'), model = val('--model', 'small');

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
function copy(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Missing ${path.relative(ROOT, from)}. Run "npm install" first.`);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true });
}
async function download(url, to) {
  if (!force && fs.existsSync(to) && fs.statSync(to).size > 0) { console.log('  have', path.relative(PUB, to)); return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0, tmp = to + '.part'; let got = 0, last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => { got += c.length; if (Date.now() - last > 500) { last = Date.now(); process.stdout.write(`\r  ${path.relative(PUB, to)}  ${mb(got)}${total ? ' / ' + mb(total) : ''}   `); } });
  await pipeline(body, fs.createWriteStream(tmp)); fs.renameSync(tmp, to);
  console.log(`\r  done ${path.relative(PUB, to)}  ${mb(got)}            `);
}

console.log('1/2 Browser libraries (from node_modules)');
copy(path.join(NM, '@mediapipe/tasks-vision/vision_bundle.mjs'), path.join(PUB, 'vendor/mediapipe/vision_bundle.mjs'));
copy(path.join(NM, '@mediapipe/tasks-vision/wasm'), path.join(PUB, 'vendor/mediapipe/wasm'));
copy(path.join(NM, 'mp4-muxer/build/mp4-muxer.mjs'), path.join(PUB, 'vendor/mp4-muxer.mjs'));
copy(path.join(NM, 'webm-muxer/build/webm-muxer.mjs'), path.join(PUB, 'vendor/webm-muxer.mjs'));
if (speech) {
  copy(path.join(NM, '@huggingface/transformers/dist/transformers.min.js'), path.join(PUB, 'vendor/transformers.min.js'));
  const ortDir = path.join(NM, 'onnxruntime-web/dist');
  if (!fs.existsSync(ortDir)) throw new Error('onnxruntime-web not found in node_modules. Run "npm install" first.');
  for (const f of fs.readdirSync(ortDir)) if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(f)) copy(path.join(ortDir, f), path.join(PUB, 'vendor/ort', f));
}

console.log('2/2 Models');
const MP = 'https://storage.googleapis.com/mediapipe-models';
await download(`${MP}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`, path.join(PUB, 'vendor/mediapipe/selfie_segmenter.tflite'));
await download(`${MP}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`, path.join(PUB, 'vendor/mediapipe/hand_landmarker.task'));
await download(`${MP}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`, path.join(PUB, 'vendor/mediapipe/face_landmarker.task'));
if (speech) {
  const names = model === 'both' ? ['small', 'base'] : [model];
  const files = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json', 'merges.txt', 'normalizer.json',
    'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4f16.onnx', // GPU (WebGPU) path
    'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']; // CPU fallback
  for (const n of names) {
    if (!['small', 'base'].includes(n)) throw new Error('--model must be small, base or both');
    console.log(`Whisper ${n} (Xenova/whisper-${n}, MIT-licensed weights)`);
    for (const f of files) await download(`https://huggingface.co/Xenova/whisper-${n}/resolve/main/${f}`, path.join(PUB, 'models/Xenova', `whisper-${n}`, f));
  }
}
console.log('\nAll set. Start with: npm start   (or double-click start.command on macOS)');
if (!speech) console.log('Speech-to-text is optional: npm run setup:speech');
