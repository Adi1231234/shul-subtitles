'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { toMp4, extractAudio, burnSubs } = require('./ffmpeg');
const { transcribe } = require('./whisper');
const { translateCues } = require('./translate');
const { buildSrt, mergeCues } = require('./srt');

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

// Process one video end-to-end, resuming any completed stages from cache.
async function runFile(file, opts, send, signal) {
  const base = path.parse(file).name;
  const dur = (await probeDuration(file)) || 1;
  const outputs = [];

  // Subtitles are optional. With them off, the only action is the MP4 conversion.
  if (!opts.subtitles) {
    send('ממיר וידאו ל-MP4', 5);
    const convPath = safeOut(path.join(opts.outputDir, `${base}.mp4`), file);
    await toMp4(file, convPath, (t) => send('ממיר וידאו ל-MP4', 5 + (t / dur) * 94), signal);
    send('הושלם', 100);
    return { ok: true, outputs: [convPath] };
  }

  const wd = workDir(file);
  fs.mkdirSync(wd, { recursive: true });
  const wav = path.join(wd, 'audio.wav');
  const cuesJson = path.join(wd, 'cues.json');
  const heJson = path.join(wd, 'cues_he.json');

  if (!fs.existsSync(wav)) {
    send('מחלץ שמע', 4);
    await extractAudio(file, wav, signal);
  }

  let enCues = readJson(cuesJson);
  if (!enCues) {
    send('מתמלל', 8);
    enCues = await transcribe(wav, cuesJson, opts.model, (stage, pct) =>
      send(stage === 'load' ? 'טוען מנוע תמלול' : 'מתמלל',
        stage === 'load' ? 8 : 8 + pct * 0.72), signal);
  }
  if (!enCues.length) throw new Error('לא זוהה דיבור בסרטון');
  enCues = mergeCues(enCues);   // merge orphan/too-short cues per subtitle conventions

  let outCues, suffix;
  if (opts.hebrew === false) {
    outCues = enCues;              // Claude unavailable - keep English subtitles
    suffix = 'en';
  } else {
    let heCues = readJson(heJson);
    if (!heCues) {
      send('מתרגם לעברית', 80);
      heCues = await translateCues(enCues, (done, total) =>
        send('מתרגם לעברית', 80 + (done / total) * 14), signal);
      fs.writeFileSync(heJson, JSON.stringify(heCues), 'utf-8');
    }
    outCues = heCues;
    suffix = 'he';
  }

  send('יוצר כתוביות', 95);
  const srt = buildSrt(outCues);
  if (opts.mode === 'srt') {
    const srtPath = safeOut(path.join(opts.outputDir, `${base}.${suffix}.srt`), file);
    fs.writeFileSync(srtPath, srt, 'utf-8');
    outputs.push(srtPath);
  }
  if (opts.mode === 'burn') {
    // MP4 toggle picks the output container; otherwise keep the original format.
    const ext = burnExt(file, opts.convertMp4);
    const tmpSrt = path.join(wd, 'subs.srt');
    fs.writeFileSync(tmpSrt, buildSrt(outCues, { rtl: suffix === 'he' }), 'utf-8');
    const outVid = safeOut(path.join(opts.outputDir, `${base}.${suffix}${ext}`), file);
    send('צורב כתוביות לוידאו', 95);
    await burnSubs(file, tmpSrt, outVid, (t) =>
      send('צורב כתוביות לוידאו', 95 + (t / dur) * 4), signal);
    outputs.push(outVid);
  }
  if (opts.mode === 'srt' && opts.convertMp4) {   // SRT sidecar plus a converted MP4
    const convPath = safeOut(path.join(opts.outputDir, `${base}.mp4`), file);
    send('ממיר וידאו ל-MP4', 96);
    await toMp4(file, convPath, (t) => send('ממיר וידאו ל-MP4', 96 + (t / dur) * 3), signal);
    outputs.push(convPath);
  }
  send('הושלם', 100);
  cleanupWork(file);
  return { ok: true, outputs };
}

module.exports = { runFile, cleanupWork };
