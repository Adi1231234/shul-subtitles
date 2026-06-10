'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { runFile, cleanupWork } = require('./pipeline');
const { checkClaude } = require('./translate');

let claudeStatus = null;

// Tiny persistent settings (remembers the last chosen output folder).
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')); } catch (_) { return {}; } }
function writeSettings(patch) { try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch })); } catch (_) {} }

let win;

const VIDEO_EXT = ['mov', 'mp4', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'm4v',
  'mpg', 'mpeg', 'ts', '3gp', 'm2ts', 'vob', 'ogv'];

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#EEF1F6', title: 'Shul', show: false,
    icon: path.join(__dirname, '..', 'renderer', 'img', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('pick-videos', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'בחר סרטונים', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'קובצי וידאו', extensions: VIDEO_EXT }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('pick-output', async () => {
  const last = readSettings().lastOutput;
  const r = await dialog.showOpenDialog(win, {
    title: 'בחר תיקיית פלט', properties: ['openDirectory', 'createDirectory'],
    defaultPath: last && fs.existsSync(last) ? last : undefined,
  });
  if (r.canceled) return null;
  writeSettings({ lastOutput: r.filePaths[0] });   // remember for next time
  return r.filePaths[0];
});

// Last output folder used, if it still exists - to pre-fill the picker on launch.
ipcMain.handle('last-output', () => {
  const d = readSettings().lastOutput;
  return d && fs.existsSync(d) ? d : null;
});

ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-item', (_e, p) => shell.showItemInFolder(p));

// Is the Claude CLI available + working? (gates Hebrew translation)
ipcMain.handle('claude-status', async () => {
  if (claudeStatus === null) claudeStatus = await checkClaude();
  return claudeStatus;
});

// ---- processing queue with per-file cancellation ----
const queue = [];
const controllers = new Map();
let running = false;

function emit(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('progress', msg);
}

async function worker() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    const ac = new AbortController();
    controllers.set(job.id, ac);
    const send = (stage, percent) => emit({ id: job.id, stage, percent });
    try {
      const res = await runFile(job.file, job.opts, send, ac.signal);
      emit({ id: job.id, done: true, ok: true, outputs: res.outputs });
    } catch (err) {
      if (ac.signal.aborted || err.name === 'AbortError') emit({ id: job.id, stopped: true });
      else emit({ id: job.id, done: true, ok: false, error: err.message });
    } finally {
      controllers.delete(job.id);
    }
  }
  running = false;
}

ipcMain.handle('enqueue', (_e, jobs) => {
  for (const j of jobs) queue.push(j);
  worker();
});

ipcMain.handle('stop-file', (_e, id) => {
  const ac = controllers.get(id);
  if (ac) ac.abort();
  const i = queue.findIndex((j) => j.id === id);
  if (i >= 0) queue.splice(i, 1);
});

ipcMain.handle('remove-file', (_e, id, file) => {
  const ac = controllers.get(id);
  if (ac) ac.abort();
  const i = queue.findIndex((j) => j.id === id);
  if (i >= 0) queue.splice(i, 1);
  if (file) cleanupWork(file);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
