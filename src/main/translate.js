'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cache = require('./cache');

const CHUNK = 25;
const CONCURRENCY = 5;
const MODEL = 'claude-haiku-4-5';

// User-editable translation guidance (shown in the settings dialog).
const DEFAULT_PROMPT = [
  'הטקסט הבא הוא כתוביות שהופקו אוטומטית בתמלול דיבור (STT) של הרצאה רפואית באנגלית,',
  'וייתכנו שגיאות אופייניות ל-STT: מילים ושמות שנשמעו לא נכון, הומופונים, ופיסוק חסר.',
  'תרגם כל משפט לעברית טבעית וזורמת (לא מילולית), והסק בתבונה את המשמעות המכוונת',
  'היכן שנראה שה-STT טעה.',
  'במונחים מקצועיים נהג כפי שרופא דובר עברית מדבר בפועל:',
  'השאר באנגלית רק שמות ספציפיים - מחלות על שם אדם (Sjögren), תרופות, גנים, חלבונים,',
  'קולטנים וראשי תיבות (HLA-DR, EBV), ומונחים לטיניים שאין להם צורה עברית מקובלת',
  '(כמו keratoconjunctivitis sicca).',
  'אך תרגם לעברית מונחים כלליים שיש להם צורה עברית רווחת, למשל autoimmune ל-אוטואימוני,',
  'chronic ל-כרוני, inflammatory ל-דלקתי, systemic ל-מערכתי, antibody ל-נוגדן.',
  'תקן איות שגוי שנובע מה-STT.',
].join('\n');

// Fixed output contract - always appended, never shown or edited by the user.
const FORMAT_SUFFIX = 'החזר אך ורק מערך JSON של מחרוזות עברית. המערך חייב להכיל בדיוק {count} '
  + 'מחרוזות - אחת לכל משפט קלט, באותו סדר, גם אם המשפט קצר או בודד. אל תאחד ואל תשמיט.';

function settingsPath() {
  try { return path.join(require('electron').app.getPath('userData'), 'settings.json'); }
  catch (_) { return path.join(os.tmpdir(), 'subtitle-studio', 'settings.json'); }
}
function promptTemplate() {
  try {
    const t = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')).translatePrompt;
    if (typeof t === 'string' && t.trim()) return t;
  } catch (_) {}
  return DEFAULT_PROMPT;
}

function claudeCmd() {
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}

// Send a prompt to the local Claude CLI (Haiku) via stdin, return its text reply.
function askClaude(prompt, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(claudeCmd(), ['-p', '--model', MODEL], { windowsHide: true, shell: false, signal });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out)
      : reject(new Error(`Claude יצא עם קוד ${code}\n${err.slice(-400)}`))));
    p.stdin.write(prompt);
    p.stdin.end();
  });
}

// Startup check: is the Claude CLI present and responding?
async function checkClaude() {
  try {
    return /\bok\b/i.test(await askClaude('Reply with exactly: OK'));
  } catch (_) {
    return false;
  }
}

function buildPrompt(lines) {
  const tpl = promptTemplate();                                    // user guidance only
  const fmt = FORMAT_SUFFIX.replace(/\{count\}/g, String(lines.length)); // fixed contract
  return `${tpl}\n${fmt}\n\nהמשפטים:\n${JSON.stringify(lines)}`;
}

function parseArray(reply, expected) {
  const a = reply.indexOf('['), b = reply.lastIndexOf(']');
  if (a < 0 || b < 0) throw new Error('אין JSON בתשובה');
  const arr = JSON.parse(reply.slice(a, b + 1));
  if (!Array.isArray(arr) || arr.length !== expected) {
    throw new Error(`אורך לא תואם (${arr.length} != ${expected})`);
  }
  return arr.map((s) => String(s).trim());
}

async function translateLine(text, signal) {
  const p = 'תרגם לעברית טבעית את המשפט הבא מתוך כתוביות (תמלול STT, ייתכנו טעויות). '
    + 'השאר מונחים רפואיים ושמות מחלות באנגלית. החזר אך ורק את התרגום:\n' + text;
  const hit = cache.get(p);
  if (typeof hit === 'string') return hit;
  const r = await askClaude(p, signal);
  const he = r.trim().replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0] || text;
  cache.set(p, he);
  return he;
}

async function translateChunk(slice, signal) {
  const lines = slice.map((c) => c.text);
  const prompt = buildPrompt(lines);
  const hit = cache.get(prompt);                     // identical prompt -> skip Claude
  if (Array.isArray(hit) && hit.length === lines.length) {
    return slice.map((c, j) => ({ start: c.start, end: c.end, text: hit[j] }));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    try {
      const he = parseArray(await askClaude(prompt, signal), lines.length);
      cache.set(prompt, he);                         // store only a valid, matching array
      return slice.map((c, j) => ({ start: c.start, end: c.end, text: he[j] }));
    } catch (e) {
      if (signal && signal.aborted) throw e;
    }
  }
  // Fallback: translate line-by-line so the count always matches.
  const out = [];
  for (let j = 0; j < slice.length; j++) {
    const he = await translateLine(lines[j], signal).catch(() => lines[j]);
    out.push({ start: slice[j].start, end: slice[j].end, text: he });
  }
  cache.set(prompt, out.map((o) => o.text));          // cache the assembled chunk too
  return out;
}

// Translate English cues to Hebrew, running chunks in parallel. onProgress(done,total).
async function translateCues(cues, onProgress, signal) {
  const chunks = [];
  for (let i = 0; i < cues.length; i += CHUNK) chunks.push(cues.slice(i, i + CHUNK));
  const results = new Array(chunks.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < chunks.length) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const idx = next++;
      results[idx] = await translateChunk(chunks[idx], signal);
      done += 1;
      if (onProgress) onProgress(Math.min(cues.length, done * CHUNK), cues.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return results.flat();
}

module.exports = { translateCues, checkClaude, DEFAULT_PROMPT };
