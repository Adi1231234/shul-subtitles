'use strict';

const state = { items: [], outputDir: null, model: 'parakeet', subtitles: true, mode: 'srt', convertMp4: false, hebrew: true };
const $ = (id) => document.getElementById(id);
const base = (p) => p.split(/[\\/]/).pop();
let idc = 0;

const SVG = {
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18M8 5v4.5M16 5v4.5" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4 4 10-10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 8v5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/><path d="M10.3 4l-7 12A2 2 0 0 0 5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0z" stroke-linejoin="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
};

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

function openModal() { $('modal').classList.remove('hidden'); updateSummary(); }
function closeModal() { $('modal').classList.add('hidden'); updateSummary(); }

function rightHtml(it) {
  if (it.status === 'active') return `<button class="iconbtn stop" data-stop="${it.id}" title="עצור">${SVG.stop}</button>`;
  let h = '';
  if (it.status === 'paused') h += `<button class="iconbtn play" data-resume="${it.id}" title="המשך">${SVG.play}</button>`;
  if (it.status === 'error') h += `<button class="btn" data-resume="${it.id}">נסה שוב</button>`;
  if (it.status === 'done') h += it.outputs.map((o, k) => `<button class="btn" data-open="${it.id}:${k}">${o.endsWith('.srt') ? 'פתח כתוביות' : 'פתח וידאו'}</button>`).join('');
  return h + `<button class="remove" data-rm="${it.id}" title="הסר">✕</button>`;
}

function rowHtml(it) {
  const ico = it.status === 'done' ? SVG.check : it.status === 'error' ? SVG.alert : SVG.film;
  const sub = it.sub || (it.status === 'paused' ? 'הופסק' : 'מוכן לעיבוד');
  return `<li class="qrow ${it.status}" id="row-${it.id}"><div class="qrow-main">
    <span class="qrow-ico">${ico}</span>
    <div class="qrow-body"><span class="qrow-name">${base(it.path)}</span><span class="qrow-sub">${sub}</span></div>
    <div class="qrow-right">${rightHtml(it)}</div></div>
    <div class="qrow-bar"><div class="qrow-fill" style="width:${it.shown}%"></div></div></li>`;
}

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
  $('subopts').classList.toggle('hidden', !subs);
  $('claude-warn').classList.toggle('hidden', !subs || state.hebrew);
}

const nowMs = () => performance.now();

function opts() { return { outputDir: state.outputDir, model: state.model, subtitles: state.subtitles, mode: state.mode, convertMp4: state.convertMp4, hebrew: state.hebrew }; }

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
  document.querySelectorAll('.seg-opt').forEach((x) => x.classList.remove('selected'));
  b.classList.add('selected'); state.mode = b.dataset.mode;
  syncControls(); updateSummary();
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
