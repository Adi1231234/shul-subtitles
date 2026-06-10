'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, 'python', 'parakeet.py');
const RES = process.resourcesPath || '';
const PK_EXE = path.join(RES, 'parakeet', 'parakeet.exe');
const MODEL_DIR = path.join(RES, 'model');

// Packaged: bundled standalone exe + offline model. Dev: python + script.
function asrCommand(audioPath, outJson, model) {
  if (fs.existsSync(PK_EXE)) {
    return { cmd: PK_EXE, args: [audioPath, outJson, model, MODEL_DIR] };
  }
  const py = process.platform === 'win32' ? 'python' : 'python3';
  return { cmd: py, args: [SCRIPT, audioPath, outJson, model] };
}

// Run the Parakeet ASR engine. onProgress(stage, percent) reports live status.
// Resolves to an array of { start, end, text } English cues.
function transcribe(audioPath, outJson, model, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const { cmd, args } = asrCommand(audioPath, outJson, model);
    const p = spawn(cmd, args, {
      windowsHide: true,
      signal,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    let err = '';
    let buf = '';
    p.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('PROG ')) {
          onProgress('transcribe', parseInt(line.slice(5), 10) || 0);
        } else if (line === 'STAGE loading') {
          onProgress('load', 0);
        } else if (line === 'STAGE transcribing') {
          onProgress('transcribe', 0);
        }
      }
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Whisper נכשל (קוד ${code})\n${err.slice(-600)}`));
      }
      try {
        resolve(JSON.parse(fs.readFileSync(outJson, 'utf-8')));
      } catch (e) {
        reject(new Error('לא ניתן לקרוא את תוצאת התמלול: ' + e.message));
      }
    });
  });
}

module.exports = { transcribe };
