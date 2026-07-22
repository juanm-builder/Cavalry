// Keep the renderer contract narrow: privileged filesystem, process, and network work stays behind IPC.
const { contextBridge, ipcRenderer } = require('electron');

const invokeFileCommand = (channel, payload) => ipcRenderer.invoke(channel, payload || {});
const invokeAdvisorCommand = (channel, payload) => ipcRenderer.invoke(channel, payload || {});
const invokeCompanionCommand = (channel, payload) => ipcRenderer.invoke(channel, payload || {});
const invokeCloudCommand = (channel, payload) => ipcRenderer.invoke(channel, payload || {});
const invokeUpdateCommand = (channel) => ipcRenderer.invoke(channel);

contextBridge.exposeInMainWorld('cavalryFiles', {
  getActiveWorkbookFile: () => invokeFileCommand('cavalry-files:get-active'),
  listRecentWorkbooks: () => invokeFileCommand('cavalry-files:list-recent'),
  openRecentWorkbook: (payload) => invokeFileCommand('cavalry-files:open-recent', payload),
  openWorkbookFile: () => invokeFileCommand('cavalry-files:open'),
  saveWorkbookAs: (payload) => invokeFileCommand('cavalry-files:save-as', payload),
  saveActiveWorkbook: (payload) => invokeFileCommand('cavalry-files:save-active', payload),
  forgetActiveWorkbookFile: () => invokeFileCommand('cavalry-files:forget-active'),
  revealActiveWorkbookFile: () => invokeFileCommand('cavalry-files:reveal-active'),
  onCommand: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('cavalry-command', listener);
    return () => ipcRenderer.removeListener('cavalry-command', listener);
  }
});

contextBridge.exposeInMainWorld('cavalryCompanion', {
  publishWorkbook: (payload) =>
    invokeCompanionCommand('cavalry-companion:publish-workbook', payload),
  getStatus: () => invokeCompanionCommand('cavalry-companion:get-status'),
  onWorkbookUpdated: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('cavalry-companion:workbook-updated', listener);
    return () => ipcRenderer.removeListener('cavalry-companion:workbook-updated', listener);
  },
  onStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, status) => callback(status || {});
    ipcRenderer.on('cavalry-companion:status', listener);
    return () => ipcRenderer.removeListener('cavalry-companion:status', listener);
  }
});

contextBridge.exposeInMainWorld('cavalryAdvisor', {
  getSettings: () => invokeAdvisorCommand('cavalry-advisor:get-settings'),
  saveSettings: (payload) => invokeAdvisorCommand('cavalry-advisor:save-settings', payload),
  getServerStatus: (payload) => invokeAdvisorCommand('cavalry-advisor:get-server-status', payload),
  startServer: (payload) => invokeAdvisorCommand('cavalry-advisor:start-server', payload),
  stopServer: (payload) => invokeAdvisorCommand('cavalry-advisor:stop-server', payload),
  chooseLocalModel: () => invokeAdvisorCommand('cavalry-advisor:choose-local-model'),
  chooseMmproj: () => invokeAdvisorCommand('cavalry-advisor:choose-mmproj'),
  testConnection: (payload) => invokeAdvisorCommand('cavalry-advisor:test', payload),
  chat: (payload) => invokeAdvisorCommand('cavalry-advisor:chat', payload),
  runAgentTurn: (payload) => invokeAdvisorCommand('cavalry-advisor:agent', payload),
  getMicrophoneStatus: () => invokeAdvisorCommand('cavalry-advisor:get-microphone-status'),
  requestMicrophoneAccess: () => invokeAdvisorCommand('cavalry-advisor:request-microphone-access'),
  openMicrophoneSettings: () => invokeAdvisorCommand('cavalry-advisor:open-microphone-settings'),
  transcribeAudio: (payload) => invokeAdvisorCommand('cavalry-advisor:transcribe-audio', payload),
  cancel: (payload) => invokeAdvisorCommand('cavalry-advisor:cancel', payload),
  onStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }
    const listener = (_event, status) => callback(status || {});
    ipcRenderer.on('cavalry-advisor:status', listener);
    return () => ipcRenderer.removeListener('cavalry-advisor:status', listener);
  }
});

contextBridge.exposeInMainWorld('cavalryCloud', {
  getState: () => invokeCloudCommand('cavalry-cloud:get-state'),
  signInWithGoogle: () => invokeCloudCommand('cavalry-cloud:sign-in-google'),
  signOut: () => invokeCloudCommand('cavalry-cloud:sign-out'),
  updateProfile: (payload) => invokeCloudCommand('cavalry-cloud:update-profile', payload),
  listWorkbooks: () => invokeCloudCommand('cavalry-cloud:list-workbooks'),
  uploadWorkbook: (payload) => invokeCloudCommand('cavalry-cloud:upload-workbook', payload),
  downloadWorkbook: (payload) => invokeCloudCommand('cavalry-cloud:download-workbook', payload),
  deleteWorkbook: (payload) => invokeCloudCommand('cavalry-cloud:delete-workbook', payload),
  onStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state || {});
    ipcRenderer.on('cavalry-cloud:state-changed', listener);
    return () => ipcRenderer.removeListener('cavalry-cloud:state-changed', listener);
  }
});

contextBridge.exposeInMainWorld('cavalryUpdates', {
  getState: () => invokeUpdateCommand('cavalry-updates:get-state'),
  checkForUpdates: () => invokeUpdateCommand('cavalry-updates:check'),
  downloadUpdate: () => invokeUpdateCommand('cavalry-updates:download'),
  restartAndInstall: () => invokeUpdateCommand('cavalry-updates:restart-and-install'),
  onStateChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state || {});
    ipcRenderer.on('cavalry-updates:state-changed', listener);
    return () => ipcRenderer.removeListener('cavalry-updates:state-changed', listener);
  }
});
