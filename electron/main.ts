import { app, BrowserWindow, ipcMain, nativeTheme, powerSaveBlocker, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// 字体通过自定义协议直接从磁盘读取，避免每次启动把几十 MB 字体转成 base64 传给渲染进程。
protocol.registerSchemesAsPrivileged([
  { scheme: 'swos-font', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let mainWindow: BrowserWindow | null = null;
let blockerId: number | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
/** 字体文件 base64 缓存，避免导出图片时重复读取。 */
const fontDataUrlCache = new Map<string, string>();

const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);
/** 单次返回字体数量上限，避免异常目录拖慢启动 */
const MAX_FONTS = 200;

/** 用户可增减字体的目录：打包后位于 EXE 旁的 fonts/，开发时位于项目根 fonts/。 */
function userFontDirectory(): string {
  if (app.isPackaged) {
    const directory = process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
    return path.join(directory, 'fonts');
  }
  return path.join(app.getAppPath(), 'fonts');
}

/** 按扩展名推断 MIME 类型。 */
function fontMime(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.woff') return 'font/woff';
  if (extension === '.otf') return 'font/otf';
  return 'font/ttf';
}

/** 把 swos-font:// URL 解析为磁盘路径。 */
function resolveFontUrl(url: string): string | null {
  const raw = url.slice(url.indexOf('//') + 2);
  const name = decodeURIComponent(raw.slice(raw.indexOf('/') + 1).split('?')[0].split('#')[0]);
  if (!name) return null;
  const target = path.join(userFontDirectory(), path.basename(name));
  if (!FONT_EXTENSIONS.has(path.extname(target).toLowerCase())) return null;
  return fs.existsSync(target) ? target : null;
}

/** 把字体读成 data URL，供导出 PNG 时内嵌（避免 file:// 无法 fetch）。 */
function fontDataUrl(url: string): string | null {
  const cached = fontDataUrlCache.get(url);
  if (cached) return cached;
  const file = resolveFontUrl(url);
  if (!file) return null;
  const dataUrl = `data:${fontMime(file)};base64,${fs.readFileSync(file).toString('base64')}`;
  fontDataUrlCache.set(url, dataUrl);
  return dataUrl;
}

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
    title: '屏上作业',
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
  // 只允许打开项目主页与作者 B 站主页，其它外链一律拦截。
  const allowedHosts = new Set(['github.com', 'space.bilibili.com']);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)) void shell.openExternal(url);
    } catch {
      /* 非法 URL 直接忽略 */
    }
    return { action: 'deny' };
  });
  // 阻止窗口内跳转到外部站点（例如误点链接），改由系统浏览器打开。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)) {
        event.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      /* ignore */
    }
  });
  // 不再注册 context-menu：右键 / 长按弹出的菜单统一由渲染进程的横排样式工具栏承担，
  // 避免触屏长按时同时出现原生菜单与自定义工具栏两套。
  mainWindow.on('focus', () => setDisplayAwake(true));
  mainWindow.on('blur', () => setDisplayAwake(false));
  mainWindow.on('closed', () => {
    setDisplayAwake(false);
    mainWindow = null;
  });

  if (app.isPackaged) void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  else void mainWindow.loadURL('http://127.0.0.1:5173');
}

// 字体资源协议：swos-font://local/<文件名> → 用户字体目录。
// 浏览器按需流式加载并缓存，启动时无需把几十 MB 字体转成 base64。
// Electron 22 使用 registerBufferProtocol（protocol.handle 需要 v25+）。
function registerFontProtocol(): void {
  protocol.registerBufferProtocol('swos-font', (request, callback) => {
    try {
      const file = resolveFontUrl(request.url);
      if (!file) {
        callback({ error: -6 });
        return;
      }
      callback({ mimeType: fontMime(file), data: fs.readFileSync(file) });
    } catch (error) {
      console.error('font protocol failed', error);
      callback({ error: -2 });
    }
  });
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
// 导出 PNG 时把字体转成 data URL 内嵌，避免非 http 协议无法 fetch 导致字体丢失。
ipcMain.handle('fonts:data-urls', (_event, urls: string[]) => {
  const result: Record<string, string> = {};
  urls.forEach((url) => {
    const dataUrl = fontDataUrl(url);
    if (dataUrl) result[url] = dataUrl;
  });
  return result;
});

// 每次启动扫描一次用户字体目录，用户增删字体后重启即可生效。
// 只返回轻量元数据 + 协议 URL，字体本体由 swos-font:// 按需从磁盘读取，
// 避免启动时把几十 MB 字体转成 base64 经 IPC 传输（这是之前启动慢的根因）。
ipcMain.handle('fonts:list', () => {
  const directory = userFontDirectory();
  if (!fs.existsSync(directory)) {
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch {
      return [];
    }
    return [];
  }
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && FONT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .slice(0, MAX_FONTS)
      .map((entry) => ({
        label: decodeURIComponent(entry.name.replace(/\.[^.]+$/, '')),
        url: `swos-font://local/${encodeURIComponent(entry.name)}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  } catch (error) {
    console.error('fonts:list failed', error);
    return [];
  }
});
// 让系统原生菜单（复制/剪切/粘贴）跟随应用主题，避免白底白字。
ipcMain.handle('theme:set', (_event, theme: string) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
});
// 历史记录：按天把当天最后一次编辑的内容以极简 HTML 保存到 history/ 目录。
ipcMain.handle('history:save', (_event, payload: { date: string; html: string; enabled: boolean }) => {
  const directory = path.join(dataDirectory(), 'history');
  const target = path.join(directory, `${payload.date}.html`);
  try {
    if (!payload.enabled) {
      // 关闭记录时清除当天快照，避免残留误导
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return true;
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, payload.html, 'utf8');
    return true;
  } catch (error) {
    console.error('history save failed', error);
    return false;
  }
});
// 导出图片：弹出系统「另存为」对话框并写入 PNG。
// 渲染进程会一直等待此调用返回，因此「导出中」橙色状态会保持到对话框关闭。
ipcMain.handle('image:save', async (_event, dataUrl: string, suggestedName: string) => {
  if (!mainWindow) return false;
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出图片',
    defaultPath: path.join(app.getPath('pictures'), suggestedName),
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return true;
  } catch (error) {
    console.error('save image failed', error);
    return false;
  }
});

// 打开 history 目录（供底栏「每日存档」下的超链接调用）。
ipcMain.handle('history:open', async () => {
  const directory = path.join(dataDirectory(), 'history');
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch {
    /* ignore */
  }
  const error = await shell.openPath(directory);
  return error === '';
});

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
  app.whenReady().then(() => {
    registerFontProtocol();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}