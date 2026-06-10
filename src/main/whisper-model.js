'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// Hebrew Whisper models (whisper.cpp ggml), downloaded on demand. ivrit.ai is
// fine-tuned for Hebrew; small is the lighter fallback for low-end machines.
const MODELS = {
  'ivrit-turbo': {
    url: 'https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ggml/resolve/main/ggml-model.bin',
    file: 'ivrit-large-v3-turbo.bin',
    minBytes: 1_000_000_000,
  },
  small: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    file: 'whisper-small.bin',
    minBytes: 300_000_000,
  },
};

// Best model the machine can comfortably run.
function pickModel() {
  const ramGB = os.totalmem() / 1024 ** 3;
  const cores = os.cpus().length;
  return ramGB >= 7.5 && cores >= 4 ? 'ivrit-turbo' : 'small';
}

function modelsDir() {
  let base;
  try { base = require('electron').app.getPath('userData'); }
  catch (_) { base = path.join(os.tmpdir(), 'subtitle-studio'); }
  const d = path.join(base, 'whisper-models');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function download(url, dest, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.part`;
    const file = fs.createWriteStream(tmp);
    const cleanup = () => { try { file.close(); } catch (_) {} try { fs.rmSync(tmp, { force: true }); } catch (_) {} };
    const req = https.get(url, { signal }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        cleanup();
        const next = new URL(res.headers.location, url).toString();   // handle relative redirects
        return resolve(download(next, dest, onProgress, signal));
      }
      if (res.statusCode !== 200) { cleanup(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      res.on('data', (c) => { got += c.length; if (total && onProgress) onProgress((got / total) * 100); });
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        if (total && fs.statSync(tmp).size !== total) { fs.rmSync(tmp, { force: true }); return reject(new Error('הורדה לא שלמה')); }
        fs.renameSync(tmp, dest);
        resolve(dest);
      }));
    });
    req.on('error', (e) => { cleanup(); reject(e); });
  });
}

// Ensure the chosen Hebrew model exists locally; download it (with progress) if not.
async function ensureModel(onProgress, signal) {
  const m = MODELS[pickModel()];
  const dest = path.join(modelsDir(), m.file);
  if (fs.existsSync(dest) && fs.statSync(dest).size >= m.minBytes) {
    if (onProgress) onProgress(100);
    return dest;
  }
  await download(m.url, dest, onProgress, signal);
  return dest;
}

module.exports = { ensureModel, pickModel };
