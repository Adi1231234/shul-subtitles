'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Use the bundled ffmpeg/ffprobe in the packaged app, else fall back to PATH.
const RES = process.resourcesPath || '';
function bin(name) {
  const p = path.join(RES, 'bin', `${name}.exe`);
  return fs.existsSync(p) ? p : name;
}

const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
let hwCache; // undefined = untested, string = encoder name, null = none usable

function parseTime(line) {
  const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
}

function run(args, { cwd, onTime, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin('ffmpeg'), args, { cwd, windowsHide: true, signal });
    let err = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err = (err + s).slice(-8000);
      if (onTime) { const t = parseTime(s); if (t != null) onTime(t); }
    });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve()
      : reject(new Error(`ffmpeg יצא עם קוד ${c}\n${err.slice(-600)}`))));
  });
}

function probe(file) {
  return new Promise((resolve) => {
    const p = spawn(bin('ffprobe'), ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name', '-of', 'default=nk=1:nw=1', file],
      { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(out.trim()));
  });
}

// Detect a working hardware H.264 encoder once (Intel QSV / NVIDIA / AMD).
async function hwEncoder() {
  if (hwCache !== undefined) return hwCache;
  for (const enc of ['h264_qsv', 'h264_nvenc', 'h264_amf']) {
    try {
      await run(['-hide_banner', '-f', 'lavfi', '-i',
        'color=black:s=256x256:d=0.2', '-c:v', enc, '-f', 'null', '-']);
      hwCache = enc;
      return enc;
    } catch (_) { /* not available, try next */ }
  }
  hwCache = null;
  return null;
}

// Re-encode video to MP4, preferring hardware, falling back to libx264.
async function encode(input, output, onTime, signal) {
  const enc = await hwEncoder();
  const audio = ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
  if (enc) {
    try {
      return await run(['-y', '-i', input, '-c:v', enc, ...audio, output], { onTime, signal });
    } catch (e) { if (signal && signal.aborted) throw e; hwCache = null; }
  }
  return run(['-y', '-i', input, ...X264, ...audio, output], { onTime, signal });
}

// Convert to MP4 - instant stream-copy when the video is already H.264/HEVC.
async function toMp4(input, output, onTime, signal) {
  const codec = await probe(input);
  if (codec === 'h264' || codec === 'hevc') {
    return run(['-y', '-i', input, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', output], { signal });
  }
  return encode(input, output, onTime, signal);
}

function extractAudio(input, output, signal) {
  return run(['-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1',
    '-c:a', 'pcm_s16le', output], { signal });
}

// Burn subtitles - always re-encodes; prefer hardware, fall back to libx264.
async function burnSubs(input, srtName, output, onTime, signal) {
  const style = 'FontName=Arial,FontSize=17,PrimaryColour=&H00FFFFFF,'
    + 'OutlineColour=&H00000000,BorderStyle=1,Outline=1.6,Shadow=0,'
    + 'Alignment=2,MarginV=24';
  const cwd = path.dirname(srtName);
  const vf = `subtitles=${path.basename(srtName)}:force_style='${style}'`;
  const out = path.resolve(output);
  const enc = await hwEncoder();
  const base = ['-y', '-i', input, '-vf', vf];
  if (enc) {
    try {
      return await run([...base, '-c:v', enc, '-c:a', 'aac', out], { cwd, onTime, signal });
    } catch (e) { if (signal && signal.aborted) throw e; hwCache = null; }
  }
  return run([...base, ...X264, '-c:a', 'aac', out], { cwd, onTime, signal });
}

module.exports = { toMp4, extractAudio, burnSubs };
