'use strict';

const MAX_LINE = 45;          // chars per line (slightly denser than Netflix 42)
const MAX_CUE_CHARS = 92;     // soft cap when merging normal cues (~2 lines)
const HARD_MAX = 132;         // hard cap when rescuing orphans (~3 lines)
const MAX_CUE_DUR = 7.0;      // Netflix max display time
const MIN_CUE_DUR = 1.2;      // readable minimum
const KEEP_SENTENCE = 30;     // keep a finished sentence on its own once this long
const MERGE_GAP = 1.5;        // merge across silences up to this many seconds
const MIN_GAP = 0.05;         // enforced gap so cues never overlap
const ORPHAN_WORDS = 2;       // <= this many words -> fragment
const ORPHAN_CHARS = 20;      // shorter than this -> fragment
const RLE = '‫';        // right-to-left embedding
const PDF = '‬';        // pop directional formatting

function fmt(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

const words = (t) => t.trim().split(/\s+/).filter(Boolean);
const endsSentence = (t) => /[.?!]["'’)\]]?\s*$/.test(t);
const isOrphan = (c) => words(c.text).length <= ORPHAN_WORDS || c.text.length < ORPHAN_CHARS;
const join = (a, b) => `${a} ${b}`.replace(/\s+/g, ' ').trim();

// Should cue b be glued onto the end of cue a during the greedy pass?
function canMerge(a, b) {
  if (a.text.length + 1 + b.text.length > MAX_CUE_CHARS) return false;
  if (b.end - a.start > MAX_CUE_DUR) return false;
  if (b.start - a.end > MERGE_GAP) return false;
  if (endsSentence(a.text) && a.text.length >= KEEP_SENTENCE) return false; // keep whole sentences
  return true;
}

// Merge fragmented ASR cues into fuller ones, rescue orphans, and guarantee
// no two cues ever overlap in time (the cause of stacked subtitles).
function mergeCues(cues) {
  let cs = cues.map((c) => ({ start: c.start, end: c.end, text: (c.text || '').trim() }))
    .filter((c) => c.text)
    .sort((a, b) => a.start - b.start);

  const out = [];                                   // pass 1: greedy density merge
  for (const c of cs) {
    const prev = out[out.length - 1];
    if (prev && canMerge(prev, c)) { prev.text = join(prev.text, c.text); prev.end = c.end; }
    else out.push({ ...c });
  }

  for (let i = 0; i < out.length; i++) {            // pass 2: rescue leftover orphans
    if (!isOrphan(out[i]) || out.length === 1) continue;
    const cur = out[i], prev = out[i - 1], next = out[i + 1];
    const okBack = prev && prev.text.length + cur.text.length <= HARD_MAX
      && cur.end - prev.start <= MAX_CUE_DUR + 2 && cur.start - prev.end <= MERGE_GAP;
    const okFwd = next && next.text.length + cur.text.length <= HARD_MAX
      && next.end - cur.start <= MAX_CUE_DUR + 2 && next.start - cur.end <= MERGE_GAP;
    if (okBack) { prev.text = join(prev.text, cur.text); prev.end = cur.end; out.splice(i, 1); i -= 2; }
    else if (okFwd) { next.text = join(cur.text, next.text); next.start = cur.start; out.splice(i, 1); i -= 1; }
  }

  for (let i = 0; i < out.length; i++) {            // pass 3: min duration, never overlap
    const next = out[i + 1];
    let end = out[i].end;
    if (end - out[i].start < MIN_CUE_DUR) end = out[i].start + MIN_CUE_DUR;
    if (next && end > next.start - MIN_GAP) end = next.start - MIN_GAP;
    if (end <= out[i].start) end = out[i].start + 0.4;
    out[i].end = end;
  }
  return out;
}

// Wrap into up to 3 balanced lines so dense cues still read cleanly.
function wrap(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_LINE) return t;
  const ws = t.split(' ');
  const lines = Math.min(3, Math.ceil(t.length / MAX_LINE));
  const target = Math.ceil(t.length / lines);
  const res = [];
  let cur = '';
  for (const w of ws) {
    if (cur && cur.length + 1 + w.length > target && res.length < lines - 1) { res.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) res.push(cur);
  return res.join('\n');
}

// cues: [{ start, end, text }]. opts.rtl wraps each line for right-to-left rendering.
function buildSrt(cues, opts = {}) {
  const blocks = [];
  let idx = 0;
  for (const c of cues) {
    let text = (c.text || '').trim();
    if (!text) continue;
    text = wrap(text);
    if (opts.rtl) text = text.split('\n').map((l) => RLE + l + PDF).join('\n');
    idx += 1;
    blocks.push(`${idx}\n${fmt(c.start)} --> ${fmt(c.end)}\n${text}\n`);
  }
  return blocks.join('\n');
}

module.exports = { buildSrt, mergeCues, fmt, wrap };
