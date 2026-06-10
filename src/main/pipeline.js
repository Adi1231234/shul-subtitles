'use strict';

const fs = require('fs');
const path = require('path');

const { toMp4, extractAudio, burnSubs } = require('./ffmpeg');
const { transcribe } = require('./whisper');
const { transcribeHe } = require('./whisper-he');
const { ensureModel } = require('./whisper-model');
const { translateCues } = require('./translate');
const { buildSrt, mergeCues } = require('./srt');
const { probeDuration, workDir, cleanupWork, readJson, safeOut, burnExt } = require('./pipeline-util');

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

  let outCues, suffix;
  if (opts.sourceLang === 'he') {
    // Hebrew source: transcribe directly with whisper.cpp (ivrit.ai), no translation.
    let heCues = readJson(heJson);
    if (!heCues) {
      send('מכין מנוע עברית', 6);
      const model = await ensureModel((pct) => send('מוריד מנוע עברית', 6 + pct * 0.28), signal);
      send('מתמלל בעברית', 34);
      heCues = await transcribeHe(wav, path.join(wd, 'whisper.json'), model,
        (pct) => send('מתמלל בעברית', 34 + pct * 0.58), signal);
      if (!heCues.length) throw new Error('לא זוהה דיבור בסרטון');
      heCues = mergeCues(heCues);
      fs.writeFileSync(heJson, JSON.stringify(heCues), 'utf-8');
    }
    outCues = heCues;
    suffix = 'he';
  } else {
    let enCues = readJson(cuesJson);
    if (!enCues) {
      send('מתמלל', 8);
      enCues = await transcribe(wav, cuesJson, opts.model, (stage, pct) =>
        send(stage === 'load' ? 'טוען מנוע תמלול' : 'מתמלל',
          stage === 'load' ? 8 : 8 + pct * 0.72), signal);
    }
    if (!enCues.length) throw new Error('לא זוהה דיבור בסרטון');
    enCues = mergeCues(enCues);   // merge orphan/too-short cues per subtitle conventions

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
