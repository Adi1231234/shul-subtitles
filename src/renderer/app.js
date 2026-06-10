'use strict';

const state = { items: [], outputDir: null, model: 'parakeet', sourceLang: 'en', subtitles: true, mode: 'srt', convertMp4: false, hebrew: true };
const $ = (id) => document.getElementById(id);
let idc = 0;

const item = (id) => state.items.find((x) => x.id === id);

function addFiles(paths) {
  let added = 0;
  for (const p of paths) {
    if (p && !state.items.some((x) => x.path === p)) {
      state.items.push({ id: ++idc, path: p, status: 'pending', sub: '', target: 0, shown: 0, outputs: [] });
      added += 1;
    }
  }
  render();
  if (added) openModal();   // adding videos opens the settings modal
}

// Source language is never persisted - it always resets to English on open.
function setLang(lang) {
  state.sourceLang = lang;
  document.querySelectorAll('#lang .seg-opt').forEach((x) => x.classList.toggle('selected', x.dataset.lang === lang));
  syncControls();
}
function openModal() { setLang('en'); $('modal').classList.remove('hidden'); updateSummary(); }
function closeModal() { $('modal').classList.add('hidden'); updateSummary(); }

function render() {
  $('queue-empty').classList.toggle('hidden', state.items.length > 0);
  $('queue-list').innerHTML = state.items.map(rowHtml).join('');
  updateSummary();
}
function updateRow(id) { const it = item(id); const el = $(`row-${id}`); if (it && el) el.outerHTML = rowHtml(it); }
function setSub(id, txt) { const el = document.querySelector(`#row-${id} .qrow-sub`); if (el) el.textContent = txt; }

function updateSummary() {
  const n = state.items.length;
  const done = state.items.filter((x) => x.status === 'done').length;
  const active = state.items.filter((x) => x.status === 'active').length;
  const todoItems = state.items.filter((x) => ['pending', 'paused', 'error'].includes(x.status));
  const todo = todoItems.length > 0;
  const noOp = !state.subtitles && !state.convertMp4;
  const modalOpen = !$('modal').classList.contains('hidden');

  let txt;                                            // main footer: overall status
  if (!n) txt = 'לא נבחרו סרטונים עדיין';
  else if (active) txt = `<strong>מעבד…</strong> ${done} מתוך ${n} הושלמו`;
  else if (done === n) txt = `<strong>הכול מוכן ✓</strong> ${n} סרטונים עובדו`;
  else txt = `<strong>${todoItems.length}</strong> סרטונים ממתינים · לחצו “המשך להגדרות”`;
  $('summary').innerHTML = txt;
  $('open-settings').classList.toggle('hidden', !(todo && !active && !modalOpen));

  $('modal-count').textContent = n ? `${n} סרטונים נבחרו` : '';  // modal: count + validation
  let hint;
  if (noOp) hint = 'בחרו לפחות פעולה אחת: כתוביות או המרה ל-MP4';
  else if (!state.outputDir) hint = 'בחרו תיקיית פלט כדי להמשיך';
  else hint = `מוכן לעבד ${todoItems.length || n} סרטונים`;
  $('modal-hint').textContent = hint;
  $('out-btn').classList.toggle('need', !state.outputDir);
  $('out-btn').classList.toggle('unset', !state.outputDir);
  $('start').disabled = !(state.outputDir && todo && !noOp);
}

// Each action is independent. Turning on subtitles reveals their sub-options.
// The MP4 toggle sets the video output format (MP4 vs the original container),
// so it stays meaningful in every mode.
function syncControls() {
  const subs = state.subtitles;
  const he = state.sourceLang === 'he';
  $('subopts').classList.toggle('hidden', !subs);
  // Hebrew source transcribes straight to Hebrew, so the Claude/translation note is irrelevant.
  $('claude-warn').classList.toggle('hidden', !subs || he || state.hebrew);
  $('lang-hint').textContent = he
    ? 'תמלול ישיר לעברית עם Whisper. בשימוש ראשון יורד מנוע עברית (פעם אחת).'
    : 'תמלול באנגלית ותרגום אוטומטי לעברית.';
}

const nowMs = () => performance.now();

function opts() { return { outputDir: state.outputDir, model: state.model, sourceLang: state.sourceLang, subtitles: state.subtitles, mode: state.mode, convertMp4: state.convertMp4, hebrew: state.hebrew }; }

function startProcessing() {
  const todo = state.items.filter((x) => ['pending', 'paused', 'error'].includes(x.status));
  if (!todo.length || !state.outputDir) return;
  for (const it of todo) { it.status = 'active'; it.sub = 'בהמתנה…'; it.shown = 0; it.stage = ''; it.upP = 0; it.upT = nowMs(); it.rate = 0; }
  closeModal(); render(); ensureAnim();
  window.api.enqueue(todo.map((it) => ({ id: it.id, file: it.path, opts: opts() })));
}

$('queue-list').addEventListener('click', (e) => {
  const find = (a) => e.target.closest(`[data-${a}]`);
  const rm = find('rm'), stop = find('stop'), res = find('resume'), op = find('open');
  if (rm) { const id = +rm.dataset.rm; const it = item(id); window.api.removeFile(id, it.path); state.items = state.items.filter((x) => x.id !== id); render(); }
  else if (stop) { const id = +stop.dataset.stop; window.api.stopFile(id); setSub(id, 'עוצר…'); }
  else if (res) { const it = item(+res.dataset.resume); it.status = 'active'; it.sub = 'בהמתנה…'; it.shown = 0; it.stage = ''; it.upP = 0; it.upT = nowMs(); it.rate = 0; updateRow(it.id); ensureAnim(); window.api.enqueue([{ id: it.id, file: it.path, opts: opts() }]); }
  else if (op) { const [id, k] = op.dataset.open.split(':'); window.api.showItem(item(+id).outputs[+k]); }
});

$('add-btn').addEventListener('click', async () => addFiles(await window.api.pickVideos()));
$('out-btn').addEventListener('click', async () => { const d = await window.api.pickOutput(); if (d) { state.outputDir = d; $('out-path').textContent = d; } updateSummary(); });
$('subs-toggle').addEventListener('change', (e) => { state.subtitles = e.target.checked; syncControls(); updateSummary(); });
$('convert-mp4').addEventListener('change', (e) => { state.convertMp4 = e.target.checked; updateSummary(); });
$('format').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-opt'); if (!b) return;
  $('format').querySelectorAll('.seg-opt').forEach((x) => x.classList.remove('selected'));
  b.classList.add('selected'); state.mode = b.dataset.mode;
  syncControls(); updateSummary();
});
$('lang').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-opt'); if (!b) return;
  setLang(b.dataset.lang); updateSummary();
});
const drop = $('drop');
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files].map((f) => window.api.getPathForFile(f))));
$('start').addEventListener('click', startProcessing);
$('open-settings').addEventListener('click', openModal);
$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
render();
syncControls();

window.api.claudeStatus().then((ok) => {
  state.hebrew = !!ok;
  syncControls();
});

window.api.lastOutput().then((d) => {            // pre-fill the last folder used
  if (d) { state.outputDir = d; $('out-path').textContent = d; updateSummary(); }
});
