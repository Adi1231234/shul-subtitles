'use strict';

const { spawn } = require('child_process');
const cache = require('./cache');

const CHUNK = 25;
const CONCURRENCY = 5;
const MODEL = 'claude-haiku-4-5';

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
  return [
    'הטקסט הבא הוא כתוביות שהופקו אוטומטית בתמלול דיבור (STT) של הרצאה רפואית באנגלית,',
    'וייתכנו שגיאות אופייניות ל-STT: מילים ושמות שנשמעו לא נכון, הומופונים, ופיסוק חסר.',
    'תרגם כל משפט לעברית טבעית וזורמת (לא מילולית), והסק בתבונה את המשמעות המכוונת',
    'היכן שנראה שה-STT טעה.',
    'חשוב: אל תתרגם מונחים רפואיים, שמות מחלות, מונחים אנטומיים, שמות תרופות ומונחים',
    'מקצועיים לעברית - השאר אותם באנגלית כפי שהם (אך תקן איות שגוי שנובע מה-STT).',
    `החזר אך ורק מערך JSON של מחרוזות עברית. המערך חייב להכיל בדיוק ${lines.length} `,
    'מחרוזות - אחת לכל משפט קלט, באותו סדר, גם אם המשפט קצר או בודד. אל תאחד ואל תשמיט.',
    '',
    'המשפטים:',
    JSON.stringify(lines),
  ].join('\n');
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

module.exports = { translateCues, checkClaude };
