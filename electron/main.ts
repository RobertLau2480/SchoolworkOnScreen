import { app, BrowserWindow, ipcMain, powerSaveBlocker, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let blockerId: number | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function dataDirectory(): string {
  if (!app.isPackaged) return app.getAppPath();
  const directory = process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
  for (const filename of ['config.ini', 'content.json']) {
    const target = path.join(directory, filename);
    const bundled = path.join(process.resourcesPath, filename);
    if (!fs.existsSync(target) && fs.existsSync(bundled)) fs.copyFileSync(bundled, target);
  }
  return directory;
}

function readJson<T>(filename: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDirectory(), filename), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filename: string, value: unknown): void {
  const target = path.join(dataDirectory(), filename);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function readSettings(): Record<string, string> {
  const target = path.join(dataDirectory(), 'config.ini');
  const settings: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(target, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator > 0) settings[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  } catch {
    return {};
  }
  return settings;
}

function writeSettings(settings: Record<string, string>): void {
  const groups = new Map<string, string[]>();
  for (const [key, value] of Object.entries(settings)) {
    const group = key.includes('.') ? key.slice(0, key.indexOf('.')) : 'appearance';
    const entry = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
    groups.set(group, [...(groups.get(group) ?? []), `${entry}=${value}`]);
  }
  const contents = [...groups].map(([group, entries]) => `[${group}]\n${entries.join('\n')}`).join('\n\n');
  fs.writeFileSync(path.join(dataDirectory(), 'config.ini'), `${contents}\n`, 'utf8');
}

function setDisplayAwake(awake: boolean): void {
  if (awake && blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  if (!awake && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#29332f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'https://github.com/RobertLau2480/SchoolworkOnScreen') void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('focus', () => setDisplayAwake(true));
  mainWindow.on('blur', () => setDisplayAwake(false));
  mainWindow.on('closed', () => {
    setDisplayAwake(false);
    mainWindow = null;
  });

  if (app.isPackaged) void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  else void mainWindow.loadURL('http://127.0.0.1:5173');
}

ipcMain.handle('data:load', () => ({
  content: readJson('content.json', null),
  settings: readSettings(),
}));
ipcMain.handle('data:save-content', (_event, content: unknown) => writeJson('content.json', content));
ipcMain.handle('data:save-settings', (_event, settings: Record<string, string>) => writeSettings(settings));
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('dialog:confirm-layout', async (_event, message: string) => {
  const { dialog } = await import('electron');
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    buttons: ['取消', '清空并切换'],
    defaultId: 0,
    cancelId: 0,
    title: '切换表格布局',
    message,
    detail: '切换后将清除当前所有作业内容，此操作无法撤销。',
  });
  return result.response === 1;
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
