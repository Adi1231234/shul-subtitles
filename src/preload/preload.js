'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
  pickOutput: () => ipcRenderer.invoke('pick-output'),
  lastOutput: () => ipcRenderer.invoke('last-output'),
  claudeStatus: () => ipcRenderer.invoke('claude-status'),
  enqueue: (jobs) => ipcRenderer.invoke('enqueue', jobs),
  stopFile: (id) => ipcRenderer.invoke('stop-file', id),
  removeFile: (id, file) => ipcRenderer.invoke('remove-file', id, file),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, msg) => cb(msg)),
});
