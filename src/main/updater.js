'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;            // start downloading as soon as found
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger = null;

// Run one update check at startup. `send(status)` drives the renderer's blocking
// guard. States: checking -> available -> downloading{percent} -> downloaded.
// Resolves when the app may proceed (no update / error / timeout); on "downloaded"
// the app quits and relaunches into the installer instead of resolving.
function checkForUpdates(send, timeoutMs = 60000) {
  return new Promise((resolve) => {
    if (!app.isPackaged) { send({ state: 'idle' }); return resolve(); }

    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      detach();
      if (status) send(status);
      resolve();
    };
    const timer = setTimeout(() => finish({ state: 'idle' }), timeoutMs);

    const onChecking = () => send({ state: 'checking' });
    const onAvailable = (info) => send({ state: 'available', version: info && info.version });
    const onNotAvailable = () => finish({ state: 'idle' });
    const onProgress = (p) => send({ state: 'downloading', percent: p && p.percent });
    const onDownloaded = (info) => {
      clearTimeout(timer);
      send({ state: 'downloaded', version: info && info.version });
      try {
        setTimeout(() => autoUpdater.quitAndInstall(true, true), 800); // silent + relaunch
      } catch (_) { finish({ state: 'idle' }); }
    };
    const onError = () => finish({ state: 'idle' });

    function detach() {
      autoUpdater.removeListener('checking-for-update', onChecking);
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('download-progress', onProgress);
      autoUpdater.removeListener('update-downloaded', onDownloaded);
      autoUpdater.removeListener('error', onError);
    }

    autoUpdater.on('checking-for-update', onChecking);
    autoUpdater.on('update-available', onAvailable);
    autoUpdater.on('update-not-available', onNotAvailable);
    autoUpdater.on('download-progress', onProgress);
    autoUpdater.on('update-downloaded', onDownloaded);
    autoUpdater.on('error', onError);

    send({ state: 'checking' });
    autoUpdater.checkForUpdates().catch(() => finish({ state: 'idle' }));
  });
}

module.exports = { checkForUpdates };
