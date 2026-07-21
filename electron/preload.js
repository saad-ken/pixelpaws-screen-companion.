import { contextBridge, ipcRenderer } from 'electron';
// Keep the renderer isolated: only these safe, named actions cross the preload bridge.
contextBridge.exposeInMainWorld('companion',{openChat:()=>ipcRenderer.send('toggle-chat'),captureScreen:()=>ipcRenderer.invoke('capture-screen'),config:()=>ipcRenderer.invoke('config')});