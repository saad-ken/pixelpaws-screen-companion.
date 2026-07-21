const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  openChat: () => ipcRenderer.send('open-chat'),
  beginDrag: (screenX, screenY) => ipcRenderer.send('begin-float-drag', { screenX, screenY }),
  moveDrag: (screenX, screenY) => ipcRenderer.send('move-float-drag', { screenX, screenY }),
  endDrag: () => ipcRenderer.send('end-float-drag'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  captureLiveFrame: () => ipcRenderer.invoke('capture-live-frame'),
  setChatShareMode: (enabled) => ipcRenderer.invoke('set-chat-share-mode', enabled),
  setCaptureProtection: (enabled) => ipcRenderer.invoke('set-capture-protection', enabled),
  schedulerList: () => ipcRenderer.invoke('scheduler-list'),
  schedulerSave: (task) => ipcRenderer.invoke('scheduler-save', task),
  schedulerToggle: (id, enabled) => ipcRenderer.invoke('scheduler-toggle', id, enabled),
  schedulerRunNow: (id) => ipcRenderer.invoke('scheduler-run-now', id),
  schedulerDelete: (id) => ipcRenderer.invoke('scheduler-delete', id),
  config: () => ipcRenderer.invoke('config'),
  saveOpenAISettings: (settings) => ipcRenderer.invoke('save-openai-settings', settings),
  clearOpenAISettings: () => ipcRenderer.invoke('clear-openai-settings'),
});