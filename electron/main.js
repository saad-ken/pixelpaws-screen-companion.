import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, Menu, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createServer } from './server.js';
import { startScheduler } from './scheduler.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dev = !app.isPackaged;
const rendererUrl = dev ? 'http://127.0.0.1:5173' : null;
let floatingWindow;
let chatWindow;
let backend;
let scheduler;
let dragState;
let normalChatBounds;
function settingsPath() { return path.join(app.getPath('userData'), 'openai-settings.json'); }
function loadOpenAISettings() { try { const saved=JSON.parse(fs.readFileSync(settingsPath(),'utf8')); if(saved.disabled) { process.env.OPENAI_API_KEY=''; return; } if(saved.apiKey) process.env.OPENAI_API_KEY=safeStorage.decryptString(Buffer.from(saved.apiKey,'base64')); if(saved.model) process.env.OPENAI_MODEL=saved.model; } catch {} }
function clearOpenAISettings() { fs.writeFileSync(settingsPath(), JSON.stringify({ disabled:true, model:process.env.OPENAI_MODEL || 'gpt-5-mini' }), 'utf8'); process.env.OPENAI_API_KEY=''; return { hasApiKey:false }; }
function saveOpenAISettings({ apiKey, model }) { if(!safeStorage.isEncryptionAvailable()) throw Error('Windows secure storage is unavailable.'); const key=String(apiKey||'').trim(); if(!key) throw Error('Enter an OpenAI API key.'); const chosen=String(model||'gpt-5-mini').trim() || 'gpt-5-mini'; fs.writeFileSync(settingsPath(),JSON.stringify({apiKey:safeStorage.encryptString(key).toString('base64'),model:chosen}),'utf8'); process.env.OPENAI_API_KEY=key; process.env.OPENAI_MODEL=chosen; return {hasApiKey:true,model:chosen}; }
function load(window, page) { return rendererUrl ? window.loadURL(`${rendererUrl}/${page}`) : window.loadFile(path.join(__dirname, '..', 'dist', page)); }
function makeFloating() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return floatingWindow;
  const area = screen.getPrimaryDisplay().workArea;
  floatingWindow = new BrowserWindow({ x: area.x + area.width - 110, y: area.y + area.height - 110, width: 72, height: 72, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.on('closed', () => { floatingWindow = null; });
  load(floatingWindow, 'floating.html');
  return floatingWindow;
}
function makeChat() {
  if (chatWindow && !chatWindow.isDestroyed()) return chatWindow;
  chatWindow = new BrowserWindow({ width: 980, height: 720, minWidth: 760, minHeight: 560, show: false, title: 'Screen Companion', autoHideMenuBar: true, menuBarVisible: false, backgroundColor: '#10131a', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  chatWindow.on('minimize', () => floatingWindow?.show());
  chatWindow.on('restore', () => floatingWindow?.hide());
  chatWindow.on('closed', () => { chatWindow = null; normalChatBounds = undefined; if (!app.isQuitting) app.quit(); });
  load(chatWindow, 'chat.html');
  return chatWindow;
}
function showChat() { const window = makeChat(); floatingWindow?.hide(); window.show(); window.focus(); }
function toggleChat() { const window = makeChat(); window.isVisible() ? window.hide() : showChat(); }

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  loadOpenAISettings();
  backend = await createServer();
  scheduler = startScheduler(path.join(app.getPath('userData'), 'scheduled-automations.json'));
  makeFloating().show();
  ipcMain.on('open-chat', showChat);
  ipcMain.on('begin-float-drag', (event, point) => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return; const [x, y] = window.getPosition(); dragState = { window, offsetX: point.screenX - x, offsetY: point.screenY - y }; });
  ipcMain.on('move-float-drag', (event, point) => { if (!dragState || dragState.window !== BrowserWindow.fromWebContents(event.sender)) return; dragState.window.setPosition(Math.round(point.screenX - dragState.offsetX), Math.round(point.screenY - dragState.offsetY)); });
  ipcMain.on('end-float-drag', () => { dragState = undefined; });
  ipcMain.handle('capture-screen', async () => {
    const chatWasVisible = Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible());
    const floatingWasVisible = Boolean(floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible());
    chatWindow?.hide();
    floatingWindow?.hide();
    await new Promise((resolve) => setTimeout(resolve, 120));
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
      if (!sources.length) throw Error('No screen source found.');
      return sources[0].thumbnail.toDataURL();
    } finally {
      if (chatWasVisible) chatWindow?.show();
      if (floatingWasVisible && !chatWasVisible) floatingWindow?.show();
    }
  });
  // Live-only capture: Windows excludes the protected chat window without hiding it.
  ipcMain.handle('capture-live-frame', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: 540 } });
    if (!sources.length) throw Error('No screen source found.');
    return sources[0].thumbnail.toDataURL();
  });
  ipcMain.handle('set-capture-protection', (event, enabled) => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    chatWindow.setContentProtection(Boolean(enabled));
  });
  // Compact mode is temporary: it keeps only the input visible while sharing.
  ipcMain.handle('set-chat-share-mode', (event, enabled) => {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    if (enabled) {
      if (!normalChatBounds) normalChatBounds = chatWindow.getBounds();
      const area = screen.getDisplayMatching(chatWindow.getBounds()).workArea;
      const width = Math.min(920, Math.max(680, area.width - 40));
      chatWindow.setMinimumSize(680, 460);
      chatWindow.setBounds({ width, height: 560, x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - 584 });
      chatWindow.setAlwaysOnTop(true, 'floating');
    } else if (normalChatBounds) {
      chatWindow.setAlwaysOnTop(false);
      chatWindow.setMinimumSize(760, 560);
      chatWindow.setBounds(normalChatBounds);
      normalChatBounds = undefined;
    }
  });
  ipcMain.handle('scheduler-list', () => scheduler?.list() || []);
  ipcMain.handle('scheduler-save', (event, task) => scheduler?.saveTask(task || {}));
  ipcMain.handle('scheduler-toggle', (event, id, enabled) => scheduler?.toggle(id, enabled));
  ipcMain.handle('scheduler-run-now', async (event, id) => scheduler?.runNow(id));
  ipcMain.handle('scheduler-delete', (event, id) => scheduler?.remove(id));
  ipcMain.handle('config', () => ({ hasApiKey: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5-mini' }));
  ipcMain.handle('save-openai-settings', (event, settings) => saveOpenAISettings(settings || {}));
  ipcMain.handle('clear-openai-settings', () => clearOpenAISettings());
  globalShortcut.register('Alt+Shift+A', toggleChat);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async () => { app.isQuitting = true; globalShortcut.unregisterAll(); scheduler?.stop(); await backend?.close(); });