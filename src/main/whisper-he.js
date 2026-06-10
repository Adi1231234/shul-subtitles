'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Bundled whisper.cpp CLI (used for Hebrew-source transcription).
function whisperBin() {
  const p = path.join(process.resourcesPath || '', 'whisper', 'whisper-cli.exe');
  return fs.existsSync(p) ? p : 'whisper-cli';
}

// Transcribe Hebrew audio with whisper.cpp. onProgress(percent). Resolves to
// [{ start, end, text }] cues parsed from whisper's JSON output.
function transcribeHe(wavPath, outJson, modelPath, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const prefix = outJson.replace(/\.json$/i, '');
    const threads = Math.max(2, Math.min(8, os.cpus().length));
    const args = ['-m', modelPath, '-f', wavPath, '-l', 'he', '-oj', '-of', prefix,
      '-t', String(threads), '-pp', '-np', '-ml', '0'];
    const p = spawn(whisperBin(), args, { windowsHide: true, signal });
    let err = '';
    const scan = (s) => { const m = s.match(/progress\s*=\s*(\d+)/i); if (m && onProgress) onProgress(parseInt(m[1], 10)); };
    p.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-4000); scan(s); });
    p.stdout.on('data', (d) => scan(d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Whisper נכשל (קוד ${code})\n${err.slice(-400)}`));
      try {
        const j = JSON.parse(fs.readFileSync(`${prefix}.json`, 'utf-8'));
        const cues = (j.transcription || []).map((s) => ({
          start: (s.offsets && s.offsets.from || 0) / 1000,
          end: (s.offsets && s.offsets.to || 0) / 1000,
          text: (s.text || '').trim(),
        })).filter((c) => c.text);
        resolve(cues);
      } catch (e) { reject(new Error('לא ניתן לקרוא תמלול עברית: ' + e.message)); }
    });
  });
}

module.exports = { transcribeHe };
