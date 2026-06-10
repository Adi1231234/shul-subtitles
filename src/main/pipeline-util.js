'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function ffprobeBin() {
  const p = path.join(process.resourcesPath || '', 'bin', 'ffprobe.exe');
  return fs.existsSync(p) ? p : 'ffprobe';
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn(ffprobeBin(), ['-v', 'error', '-show_entries',
      'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(0));
    p.on('close', () => resolve(parseFloat(out.trim()) || 0));
  });
}

// Stable per-file work dir so a stopped job can resume from where it left off.
function workDir(file) {
  const id = crypto.createHash('sha1').update(file).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'subtitle-studio', id);
}

function cleanupWork(file) {
  try { fs.rmSync(workDir(file), { recursive: true, force: true }); } catch (_) {}
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return null; }
}

// Never let an output path collide with the input file (ffmpeg can't read+write
// the same file). Happens when the output dir is the input's folder and names match.
function safeOut(out, input) {
  if (path.resolve(out).toLowerCase() !== path.resolve(input).toLowerCase()) return out;
  const ext = path.extname(out);
  return out.slice(0, -ext.length) + ' (1)' + ext;
}

// Container for a burned video: MP4 when requested, else keep the source format
// (only for containers that hold H.264/AAC; anything exotic falls back to MP4).
const BURN_SAFE = new Set(['.mp4', '.mov', '.mkv', '.m4v']);
function burnExt(file, toMp4Flag) {
  if (toMp4Flag) return '.mp4';
  const e = path.extname(file).toLowerCase();
  return BURN_SAFE.has(e) ? e : '.mp4';
}

module.exports = { probeDuration, workDir, cleanupWork, readJson, safeOut, burnExt };
