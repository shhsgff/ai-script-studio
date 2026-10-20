'use strict';

/**
 * AI 智能剧本创作工具 —— Electron 主进程
 * 职责：窗口管理、本地文件读写、导出（docx/pdf/txt）、壁纸持久化、AI 流式请求代理、设置持久化
 */

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const { Readable } = require('node:stream');
const crypto = require('node:crypto');

const os = require('node:os');
const dsh = require('./dsh');
const dshMcp = require('./dsh-mcp');
const localGatewayMod = require('./local-gateway');
const IS_DEV = process.argv.includes('--dev');
const SMOKE = process.argv.includes('--smoke');
const SHOT = process.argv.some((a) => a === '--shot' || a.startsWith('--shot='));

// 测试 / 截图模式使用一次性用户目录：既不会被上一次运行污染，也不会污染真实用户设置
if (SMOKE || SHOT) {
  try {
    // AISC_PROFILE_DIR 指定一个固定目录（验证「真实用户数据下的首启表现」时用）
    const fixed = process.env.AISC_PROFILE_DIR;
    const tmpProfile = fixed
      ? (fs.mkdirSync(fixed, { recursive: true }), fixed)
      : fs.mkdtempSync(path.join(os.tmpdir(), (SMOKE ? 'aisc-smoke-profile-' : 'aisc-shot-profile-')));
    app.setPath('userData', tmpProfile);
    if (fixed) console.log('PROFILE_DIR ' + tmpProfile);
  } catch (err) {
    console.error('PROFILE_FAIL', err && err.message);
  }
}

// ---------- 路径 ----------
const USER_DIR = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DIR, 'settings.json');
const WALLPAPER_DIR = path.join(USER_DIR, 'wallpapers');
const AUTOSAVE_FILE = path.join(USER_DIR, 'autosave.json');
const SESSION_FILE = path.join(USER_DIR, 'session.json');
const BACKUP_DIR = path.join(USER_DIR, 'backups');
const LOG_DIR = path.join(USER_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const CHILDREN_FILE = path.join(USER_DIR, 'children.json');

// 清理上次异常退出残留的临时写入文件（JSON 原子写入的中间态）
try {
  for (const name of fs.readdirSync(USER_DIR)) {
    if (/\\.tmp-\\d+$/.test(name)) {
      try { fs.unlinkSync(path.join(USER_DIR, name)); } catch (e) { /* ignore */ }
    }
  }
} catch (e) { /* ignore */ }

let mainWindow = null;
let settings = null;
let settingsSaveTimer = null;

/* ---------- 诊断日志 ----------
 * 出问题时用户只需要把 %APPDATA%\ai-script-studio\logs\app.log 发过来，就能看到
 * 窗口有没有建起来、网关/MCP 有没有启起来、子进程有没有残留。
 */
function logLine(tag, msg) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    try {
      const st = fs.statSync(LOG_FILE);
      if (st.size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch (e) { /* 文件还不存在 */ }
    const line = '[' + new Date().toISOString() + '] [' + tag + '] ' + String(msg) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (e) { /* 日志失败不能影响主流程 */ }
}

process.on('uncaughtException', (err) => {
  logLine('uncaught', (err && err.stack) || String(err));
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logLine('rejection', (reason && reason.stack) || String(reason));
  console.error('unhandledRejection', reason);
});

/* ---------- 子进程登记 ----------
 * 每次拉起 dsh 都把 pid 写到 children.json，正常退出时删掉。
 * 下次启动先检查这些 pid：如果还活着就杀掉，避免上次崩溃/被强杀留下的 node
 * 进程继续占着 DSH 的端口（表现就是「DeepSeek Harness 起不来」）。
 */
let childrenSaveTimer = null;
function persistChildren(pids) {
  clearTimeout(childrenSaveTimer);
  childrenSaveTimer = setTimeout(() => {
    try {
      const list = Array.isArray(pids) ? pids : [];
      if (!list.length) {
        try { fs.unlinkSync(CHILDREN_FILE); } catch (e) { /* 不存在就算了 */ }
        return;
      }
      writeJSONAtomic(CHILDREN_FILE, { at: Date.now(), pids: list });
    } catch (e) { /* ignore */ }
  }, 400);
}
if (typeof dsh.setChildWatcher === 'function') dsh.setChildWatcher(persistChildren);

const DEFAULT_SETTINGS = {
  version: 1,
  theme: 'dark',
  font: {
    family: 'Microsoft YaHei, PingFang SC, sans-serif',
    size: 16,
    lineHeight: 2,
    indent: 2,
    paragraphGap: 20
  },
  wallpaper: { type: null, file: null, url: null, opacity: 1, blur: 0 },
  api: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.8,
    maxTokens: 4096,
    systemPrompt: '你是一位资深的中文编剧，擅长小说与剧本写作。请严格只输出改写后的正文内容，不要输出任何解释、前缀、代码块标记或免责声明。',
    supportsVision: false
  },
  ui: {
    showRuler: true,
    outlineFloat: { open: false, x: 0, y: 0, right: 336, top: 96 }
  },
  recentFiles: [],
  window: { width: 1440, height: 900, x: null, y: null, maximized: false },
  autosave: { enabled: true, intervalMs: 15000 },
  dsh: { command: 'dsh', timeoutSec: 240 },
  mcp: { enabled: false, port: 45871 },
  gateway: { enabled: true, port: 45872, token: '', model: 'dsh-local', autoFill: true }
};

// ---------- 通用工具 ----------
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(patch)) {
    const bv = base ? base[k] : undefined;
    if (bv && typeof bv === 'object' && !Array.isArray(bv) && patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
      out[k] = deepMerge(bv, patch[k]);
    } else {
      out[k] = patch[k];
    }
  }
  return out;
}

function readJSONSync(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

async function writeJSONAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp-' + process.pid;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    try { await fsp.unlink(tmp); } catch (_) {}
  }
}

function loadSettings() {
  const loaded = readJSONSync(SETTINGS_FILE, {});
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), loaded || {});
}

function persistSettings() {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(async () => {
    settingsSaveTimer = null;
    try { await writeJSONAtomic(SETTINGS_FILE, settings); } catch (e) { console.error('保存设置失败', e); }
  }, 200);
}

function guessMime(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
    '.ogv': 'video/ogg'
  };
  return map[ext] || 'application/octet-stream';
}

function mediaUrl(absPath) {
  return 'appmedia://media/?p=' + encodeURIComponent(absPath);
}

// ---------- 自定义媒体协议（支持 Range，视频可拖动进度） ----------
protocol.registerSchemesAsPrivileged([
  { scheme: 'appmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

function registerMediaProtocol() {
  protocol.handle('appmedia', async (request) => {
    try {
      const url = new URL(request.url);
      const raw = url.searchParams.get('p');
      if (!raw) return new Response('missing path', { status: 400 });
      const filePath = path.resolve(decodeURIComponent(raw));
      const allowed = path.resolve(USER_DIR) + path.sep;
      if (!filePath.startsWith(allowed) && filePath !== path.resolve(USER_DIR)) {
        return new Response('forbidden', { status: 403 });
      }
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return new Response('not a file', { status: 404 });
      const mime = guessMime(filePath);
      const range = request.headers.get('range');
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
        if (start > end) { start = 0; end = stat.size - 1; }
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(end - start + 1),
            'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          }
        });
      }
      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (err) {
      return new Response('media error: ' + (err && err.message), { status: 500 });
    }
  });
}

// ---------- 窗口 ----------
function createWindow() {
  const w = settings.window || {};
  const options = {
    width: Math.max(900, w.width || 1440),
    height: Math.max(600, w.height || 900),
    minWidth: 960,
    minHeight: 640,
    backgroundColor: settings.theme === 'light' ? '#f4f4f7' : '#1e1e24',
    title: 'AI 智能剧本创作工具',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  };
  if (Number.isInteger(w.x) && Number.isInteger(w.y)) { options.x = w.x; options.y = w.y; }

  mainWindow = new BrowserWindow(options);
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (settings.window && settings.window.maximized) mainWindow.maximize();
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // 渲染进程的错误输出到主进程控制台，便于排障
  mainWindow.webContents.on('console-message', (...args) => {
    try {
      const d = args[0];
      if (d && typeof d === 'object' && typeof d.level === 'string') {
        if (d.level === 'error' || d.level === 'warning') {
          console.log('[renderer:' + d.level + '] ' + d.message + ' @' + (d.sourceId || '') + ':' + (d.lineNumber || 0));
        }
        return;
      }
      const level = args[1];
      const message = args[2];
      const line = args[3];
      const sourceId = args[4];
      if (level >= 2) console.log('[renderer] ' + message + ' @' + sourceId + ':' + line);
    } catch (e) { /* ignore */ }
  });

  // --shot <png路径>：把窗口内容截图保存后退出（用于无桌面交互环境下的界面自检）
  const shotIdx = process.argv.findIndex((a) => a === '--shot' || a === '--shot=');
  if (shotIdx >= 0) {
    const argVal = process.argv[shotIdx].indexOf('=') > 0 ? process.argv[shotIdx].split('=').slice(1).join('=') : process.argv[shotIdx + 1];
    const shotPath = argVal && !argVal.startsWith('--') ? path.resolve(argVal) : path.join(USER_DIR, 'shot.png');
    const waitMs = Number(process.env.SHOT_DELAY || 2600);
    let shotMock = null;
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const sceneFile = process.env.SHOT_SCRIPT;
          if (process.env.SHOT_AI) {
            const { startMockAI } = require('./mock-ai');
            shotMock = await startMockAI();
            await mainWindow.webContents.executeJavaScript(
              'window.__SHOT_AI = ' + JSON.stringify({ url: shotMock.url, badUrl: shotMock.badUrl, expectText: shotMock.expectText }) + ';', true);
          }
          if (sceneFile) {
            const code = await fsp.readFile(path.resolve(sceneFile), 'utf8');
            await mainWindow.webContents.executeJavaScript(code, true);
            await new Promise((r) => setTimeout(r, Number(process.env.SHOT_SETTLE || 900)));
          }
          const image = await mainWindow.webContents.capturePage();
          await fsp.writeFile(shotPath, image.toPNG());
          console.log('SHOT_OK ' + shotPath);
        } catch (err) {
          console.error('SHOT_FAIL', err && err.message);
        }
        if (shotMock) { try { await shotMock.close(); } catch (e) { /* ignore */ } }
        setTimeout(() => app.exit(0), 120);
      }, waitMs);
    });
  }

  if (SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => {
      require('./smoke').run({ win: mainWindow, app, dialog })
        .then((code) => { setTimeout(() => app.exit(code || 0), 120); })
        .catch((err) => { console.error('SMOKE_FAIL', err); setTimeout(() => app.exit(1), 120); });
    });
  }

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds();
    settings.window = { width: b.width, height: b.height, x: b.x, y: b.y, maximized };
    persistSettings();
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('maximize', saveBounds);
  mainWindow.on('unmaximize', saveBounds);
  mainWindow.on('closed', () => { mainWindow = null; });

  // 未保存修改的退出确认
  mainWindow.on('close', async (ev) => {
    if (forceClose || !rendererDirty) return;
    ev.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['保存并退出', '不保存直接退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '有未保存的修改',
      message: '当前剧本还有未保存的修改，确定要退出吗？',
      detail: '选择“保存并退出”会先把项目写入磁盘（若从未保存过会弹出另存为对话框）。'
    });
    if (response === 0) {
      sendToRenderer('app:requestSaveAndQuit', true);
    } else if (response === 1) {
      forceClose = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    }
  });

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, payload); } catch (e) {}
  }
}

// ---------- 设置 IPC ----------
ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:set', (event, patch) => {
  settings = deepMerge(settings, patch || {});
  persistSettings();
  return settings;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  userData: USER_DIR,
  autosavePath: AUTOSAVE_FILE,
  logDir: LOG_DIR,
  logFile: LOG_FILE
}));

ipcMain.handle('app:openLogs', async () => {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const err = await shell.openPath(LOG_DIR);
    return err || 'ok';
  } catch (e) {
    return (e && e.message) || '打开日志目录失败';
  }
});

let rendererDirty = false;
let forceClose = false;

ipcMain.on('app:dirty', (event, value) => { rendererDirty = !!value; });

ipcMain.handle('app:forceQuit', () => {
  forceClose = true;
  setImmediate(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); else app.quit(); });
  return true;
});

ipcMain.handle('app:setTitle', (event, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title ? title + ' - AI 智能剧本创作工具' : 'AI 智能剧本创作工具');
  }
  return true;
});

// ---------- 项目文件 ----------
const PROJECT_FILTERS = [
  { name: '剧本项目', extensions: ['aisc', 'json'] },
  { name: '所有文件', extensions: ['*'] }
];

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '打开剧本项目',
    properties: ['openFile'],
    filters: PROJECT_FILTERS
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const filePath = res.filePaths[0];
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const project = JSON.parse(raw);
    addRecent(filePath, project && project.meta ? project.meta.title : null);
    return { canceled: false, filePath, project };
  } catch (err) {
    return { canceled: true, error: '无法读取项目文件：' + err.message };
  }
});

ipcMain.handle('project:openPath', async (event, filePath) => {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const project = JSON.parse(raw);
    addRecent(filePath, project && project.meta ? project.meta.title : null);
    return { canceled: false, filePath, project };
  } catch (err) {
    removeRecent(filePath);
    return { canceled: true, error: '文件不存在或已损坏：' + path.basename(filePath) };
  }
});

ipcMain.handle('project:save', async (event, payload) => {
  const { filePath, project } = payload;
  if (!filePath) return await saveAs(project);
  try {
    await writeJSONAtomic(filePath, project);
    addRecent(filePath, project.meta ? project.meta.title : null);
    return { canceled: false, filePath, savedAt: Date.now() };
  } catch (err) {
    return { canceled: true, error: '保存失败：' + err.message };
  }
});

ipcMain.handle('project:saveAs', async (event, payload) => {
  return await saveAs(payload.project, payload.suggestedName);
});

async function saveAs(project, suggestedName) {
  const base = (suggestedName || (project && project.meta && project.meta.title) || '未命名剧本').replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '剧本另存为',
    defaultPath: path.join(app.getPath('documents'), base + '.aisc'),
    filters: PROJECT_FILTERS
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    await writeJSONAtomic(res.filePath, project);
    addRecent(res.filePath, project && project.meta ? project.meta.title : null);
    return { canceled: false, filePath: res.filePath, savedAt: Date.now() };
  } catch (err) {
    return { canceled: true, error: '保存失败：' + err.message };
  }
}

// 自动保存草稿
ipcMain.handle('autosave:write', async (event, payload) => {
  try {
    await writeJSONAtomic(AUTOSAVE_FILE, { at: Date.now(), ...payload });
    return { ok: true, at: Date.now() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('autosave:read', async () => {
  const data = readJSONSync(AUTOSAVE_FILE, null);
  return data;
});

ipcMain.handle('autosave:clear', async () => {
  try { await fsp.unlink(AUTOSAVE_FILE); } catch (e) {}
  return { ok: true };
});

// 上次打开过哪些磁盘文件：用于「再次启动时回到上次的工作现场」
ipcMain.handle('session:write', async (event, payload) => {
  try {
    await writeJSONAtomic(SESSION_FILE, { at: Date.now(), ...payload });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('session:read', async () => readJSONSync(SESSION_FILE, null));

ipcMain.handle('session:clear', async () => {
  try { await fsp.unlink(SESSION_FILE); } catch (e) {}
  return { ok: true };
});


// 备份（保存时保留最近 5 份）
ipcMain.handle('project:backup', async (event, payload) => {
  try {
    ensureDir(BACKUP_DIR);
    const name = (payload && payload.name ? payload.name : 'script').replace(/[\\/:*?"<>|]/g, '_') + '-' + Date.now() + '.aisc';
    await writeJSONAtomic(path.join(BACKUP_DIR, name), payload.project);
    const files = (await fsp.readdir(BACKUP_DIR)).filter(f => f.endsWith('.aisc')).sort();
    while (files.length > 10) {
      const old = files.shift();
      try { await fsp.unlink(path.join(BACKUP_DIR, old)); } catch (e) {}
    }
    return { ok: true, path: path.join(BACKUP_DIR, name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 导入本地 txt / md / html 文档
ipcMain.handle('project:importText', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '打开本地文档',
    properties: ['openFile'],
    filters: [
      { name: '文本 / Markdown', extensions: ['txt', 'md', 'markdown'] },
      { name: '网页 HTML', extensions: ['html', 'htm'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  try {
    const fp = res.filePaths[0];
    const raw = await fsp.readFile(fp, 'utf8');
    const ext = path.extname(fp).replace(/^\./, '').toLowerCase();
    return {
      canceled: false,
      filePath: fp,
      name: path.basename(fp),
      base: path.basename(fp, path.extname(fp)),
      ext: ext,
      content: raw
    };
  } catch (err) {
    return { canceled: true, error: '读取失败：' + err.message };
  }
});

// ---------- 最近文件 ----------
function addRecent(filePath, title) {
  const list = (settings.recentFiles || []).filter(item => item.path !== filePath);
  list.unshift({ path: filePath, title: title || path.basename(filePath), name: path.basename(filePath), at: Date.now() });
  settings.recentFiles = list.slice(0, 12);
  persistSettings();
  sendToRenderer('recent:changed', settings.recentFiles);
}

function removeRecent(filePath) {
  settings.recentFiles = (settings.recentFiles || []).filter(item => item.path !== filePath);
  persistSettings();
  sendToRenderer('recent:changed', settings.recentFiles);
}

ipcMain.handle('recent:remove', (event, filePath) => { removeRecent(filePath); return settings.recentFiles; });
ipcMain.handle('recent:clear', () => { settings.recentFiles = []; persistSettings(); sendToRenderer('recent:changed', settings.recentFiles); return []; });

// ---------- 壁纸 ----------
ipcMain.handle('wallpaper:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择壁纸（图片或视频）',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] },
      { name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const src = res.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  const isVideo = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
  try {
    ensureDir(WALLPAPER_DIR);
    const keep = 'wallpaper-' + Date.now() + ext;
    const dest = path.join(WALLPAPER_DIR, keep);
    // 大文件直接复制（视频可能很大）
    await fsp.copyFile(src, dest);
    for (const f of await fsp.readdir(WALLPAPER_DIR)) {
      if (f !== keep) { try { await fsp.unlink(path.join(WALLPAPER_DIR, f)); } catch (e) {} }
    }
    const url = mediaUrl(dest);
    settings.wallpaper = { type: isVideo ? 'video' : 'image', file: dest, url, opacity: settings.wallpaper.opacity, blur: settings.wallpaper.blur };
    persistSettings();
    return { canceled: false, wallpaper: settings.wallpaper };
  } catch (err) {
    return { canceled: true, error: '导入壁纸失败：' + err.message };
  }
});

ipcMain.handle('wallpaper:clear', () => {
  settings.wallpaper = { type: null, file: null, url: null, opacity: 1, blur: 0 };
  persistSettings();
  return settings.wallpaper;
});

// ---------- 富文本 / 纯文本写作工具 ----------
function htmlToPlainBlocks(html) {
  // 在渲染进程已把内容序列化成结构，这里仅兜底
  return String(html || '').replace(/<[^>]+>/g, '').split(/\n+/).map(s => s.trim()).filter(Boolean);
}

function blocksFromActs(acts) {
  const out = [];
  for (const act of acts || []) {
    out.push({ type: 'h1', text: act.title || '未命名章节' });
    for (const b of act.blocks || []) {
      out.push({ type: b.type === 'h2' ? 'h2' : 'p', text: b.text || '' });
    }
  }
  return out;
}

// ---------- 导出：TXT ----------
ipcMain.handle('export:txt', async (event, payload) => {
  const safe = (payload.title || '未命名剧本').replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出为纯文本',
    defaultPath: path.join(app.getPath('documents'), safe + '.txt'),
    filters: [{ name: '文本文件', extensions: ['txt'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  const lines = [];
  lines.push(payload.title || '未命名剧本');
  lines.push('='.repeat(30));
  lines.push('');
  for (const act of payload.acts || []) {
    lines.push('【' + (act.title || '未命名章节') + '】');
    lines.push('');
    for (const b of act.blocks || []) {
      if (b.type === 'h2') lines.push('· ' + b.text);
      else { lines.push('　　' + b.text); lines.push(''); }
    }
    lines.push('');
  }
  try {
    await fsp.writeFile(res.filePath, lines.join('\r\n'), 'utf8');
    return { canceled: false, filePath: res.filePath };
  } catch (err) {
    return { canceled: true, error: '导出失败：' + err.message };
  }
});

// ---------- 导出：DOCX ----------
ipcMain.handle('export:docx', async (event, payload) => {
  const safe = (payload.title || '未命名剧本').replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出为 Word 文档',
    defaultPath: path.join(app.getPath('documents'), safe + '.docx'),
    filters: [{ name: 'Word 文档', extensions: ['docx'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    const docx = await import('docx');
    const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = docx;
    const children = [];
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: payload.title || '未命名剧本', bold: true, size: 40, font: '黑体' })]
    }));
    for (const act of payload.acts || []) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 200 },
        children: [new TextRun({ text: act.title || '未命名章节', bold: true, size: 30, font: '黑体' })]
      }));
      for (const b of act.blocks || []) {
        if (b.type === 'h2') {
          children.push(new Paragraph({
            spacing: { before: 200, after: 120 },
            children: [new TextRun({ text: b.text, bold: true, size: 26, font: '黑体' })]
          }));
        } else {
          children.push(new Paragraph({
            indent: { firstLine: 480 },
            spacing: { line: 400, after: 120 },
            children: [new TextRun({ text: b.text, size: 24, font: '宋体' })]
          }));
        }
      }
    }
    const doc = new Document({
      creator: 'AI 智能剧本创作工具',
      title: payload.title || '未命名剧本',
      sections: [{ properties: {}, children }]
    });
    const buf = await Packer.toBuffer(doc);
    await fsp.writeFile(res.filePath, buf);
    return { canceled: false, filePath: res.filePath };
  } catch (err) {
    console.error(err);
    return { canceled: true, error: '导出 Word 失败：' + err.message };
  }
});

// ---------- 导出：PDF ----------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

ipcMain.handle('export:pdf', async (event, payload) => {
  const safe = (payload.title || '未命名剧本').replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出为 PDF',
    defaultPath: path.join(app.getPath('documents'), safe + '.pdf'),
    filters: [{ name: 'PDF 文件', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  const body = [];
  body.push('<h1 class="doc-title">' + escapeHtml(payload.title || '未命名剧本') + '</h1>');
  for (const act of payload.acts || []) {
    body.push('<h2 class="act-title">' + escapeHtml(act.title || '未命名章节') + '</h2>');
    for (const b of act.blocks || []) {
      if (b.type === 'h2') body.push('<h3 class="sub-title">' + escapeHtml(b.text) + '</h3>');
      else body.push('<p>' + escapeHtml(b.text) + '</p>');
    }
  }
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>' +
    '@page { size: A4; margin: 22mm 20mm; }' +
    'body { font-family: "Microsoft YaHei","SimSun",serif; font-size: 12pt; line-height: 1.9; color:#111; }' +
    '.doc-title { text-align:center; font-size:22pt; margin:0 0 24pt; }' +
    '.act-title { font-size:16pt; margin:18pt 0 10pt; border-bottom:1px solid #ddd; padding-bottom:6pt; }' +
    '.sub-title { font-size:13pt; margin:12pt 0 6pt; }' +
    'p { text-indent: 2em; margin: 0 0 8pt; text-align: justify; }' +
    '</style></head><body>' + body.join('') + '</body></html>';

  let printWin = null;
  try {
    printWin = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true } });
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    await fsp.writeFile(res.filePath, pdf);
    return { canceled: false, filePath: res.filePath };
  } catch (err) {
    return { canceled: true, error: '导出 PDF 失败：' + err.message };
  } finally {
    if (printWin && !printWin.isDestroyed()) printWin.destroy();
  }
});

// ---------- AI 代理（主进程发请求，规避 CORS 并隐藏 Key） ----------
const aiJobs = new Map();

function normalizeChatUrl(base) {
  let b = String(base || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(b)) return b;
  if (/\/v\d+$/i.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

function friendlyAiError(status, text) {
  let detail = '';
  try {
    const j = JSON.parse(text);
    detail = (j.error && (j.error.message || j.error.type)) || j.message || '';
  } catch (e) { detail = String(text || '').slice(0, 300); }
  if (status === 401) return 'API Key 无效或未填写，请在「设置 → AI 配置」里检查。';
  if (status === 402) return '账户余额不足，请前往服务商控制台充值。';
  if (status === 403) return '无权访问该模型，请确认模型名称或权限：' + detail;
  if (status === 404) return '接口地址或模型不存在（404）。请检查 Base URL 与模型名：' + detail;
  if (status === 429) return '请求过于频繁或并发超限（429），请稍后重试。';
  if (status >= 500) return '服务端错误（' + status + '）：' + detail;
  return '请求失败（' + status + '）：' + detail;
}

async function runAI(jobId, payload) {
  const { net } = require('electron');
  const cfg = settings.api || {};
  const apiKey = (payload.apiKey || cfg.apiKey || '').trim();
  const url = normalizeChatUrl(payload.baseUrl || cfg.baseUrl);
  const model = (payload.model || cfg.model || 'deepseek-chat').trim();
  const controller = new AbortController();
  aiJobs.set(jobId, controller);

  const emit = (data) => {
    if (SMOKE) console.log('SMOKE_AI_EVENT ' + (data && data.type) + ' ' + ((data && (data.text || data.message)) || '').length);
    sendToRenderer('ai:event', Object.assign({ id: jobId }, data));
  };

  if (!apiKey) {
    emit({ type: 'error', message: '还没有配置 API Key。请打开「设置 → AI 配置」，填入服务商提供的 Key 后重试。' });
    aiJobs.delete(jobId);
    return;
  }

  let full = '';
  let timedOut = false;
  let stallTimer = null;
  // 超过 90 秒没有任何新数据就自动中断，避免界面永远停在“生成中”
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      timedOut = true;
      try { controller.abort(); } catch (e) {}
    }, 90000);
  };
  try {
    const body = {
      model,
      messages: payload.messages || [],
      stream: true
    };
    if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
    if (typeof payload.maxTokens === 'number' && payload.maxTokens > 0) body.max_tokens = payload.maxTokens;

    const resp = await net.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      emit({ type: 'error', message: friendlyAiError(resp.status, text), status: resp.status });
      aiJobs.delete(jobId);
      return;
    }

    armStall();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall();
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { buffer = ''; break; }
        try {
          const json = JSON.parse(data);
          if (json.usage) usage = json.usage;
          const choice = json.choices && json.choices[0];
          if (!choice) continue;
          const delta = (choice.delta && (choice.delta.content || choice.delta.reasoning_content)) || '';
          if (delta) { full += delta; emit({ type: 'delta', text: delta, fullLength: full.length }); }
        } catch (e) { /* 忽略半包 */ }
      }
    }
    emit({ type: 'done', text: full, usage, model });
  } catch (err) {
    if (timedOut) {
      emit({ type: 'error', message: '长时间没有收到数据（超过 90 秒），已自动中断。请检查网络或代理设置后重试。' });
    } else if (err && err.name === 'AbortError') {
      emit({ type: 'aborted', text: full });
    } else {
      emit({ type: 'error', message: '网络请求失败：' + (err && err.message ? err.message : String(err)) + '（请检查网络或代理设置）' });
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    aiJobs.delete(jobId);
  }
}

ipcMain.handle('ai:start', (event, payload) => {
  const jobId = (payload && payload.id) || crypto.randomUUID();
  runAI(jobId, payload || {});
  return { id: jobId };
});

ipcMain.handle('ai:abort', (event, jobId) => {
  const controller = aiJobs.get(jobId);
  if (controller) { try { controller.abort(); } catch (e) {} }
  return true;
});

ipcMain.handle('ai:test', async (event, override) => {
  const { net } = require('electron');
  const cfg = Object.assign({}, settings.api, override || {});
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) return { ok: false, message: '尚未填写 API Key' };
  const url = normalizeChatUrl(cfg.baseUrl);
  const controller = new AbortController();
  const hardTimer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, 20000);
  try {
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '你好，只回复"连接成功"四个字。' }],
        max_tokens: 16,
        stream: false
      })
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, message: friendlyAiError(resp.status, text) };
    let content = '';
    try { const j = JSON.parse(text); content = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : ''; } catch (e) {}
    return { ok: true, message: '连接成功：' + (content || '模型已响应'), model: cfg.model, url };
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? '连接超时（20 秒无响应），请检查 Base URL 与网络/代理'
      : '连接失败：' + (err && err.message ? err.message : String(err));
    return { ok: false, message: msg };
  } finally {
    clearTimeout(hardTimer);
  }
});

// ---------- 剪贴板 / 系统 ----------
ipcMain.handle('clipboard:write', (event, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('shell:showItem', (event, filePath) => { if (filePath) shell.showItemInFolder(filePath); return true; });
ipcMain.handle('shell:openPath', async (event, filePath) => { const r = await shell.openPath(filePath); return r || 'ok'; });
ipcMain.handle('shell:openExternal', (event, url) => { if (/^https?:/i.test(url)) shell.openExternal(url); return true; });

/* ---------- 本地 DeepSeek Harness ---------- */
let dshJob = null;

function dshCommand(override) {
  const c = (override && String(override).trim()) || (settings && settings.dsh && settings.dsh.command) || 'dsh';
  return c;
}

ipcMain.handle('dsh:detect', async (event, command) => {
  const res = await dsh.detect(dshCommand(command));
  return res;
});

ipcMain.handle('dsh:test', async (event, command) => {
  const job = dsh.run({
    command: dshCommand(command),
    task: '只回复四个字：连接成功',
    cwd: os.tmpdir(),
    timeoutMs: 90000
  });
  const r = await job.promise;
  return { ok: r.ok, text: r.text || '', error: r.error || '' };
});

ipcMain.handle('dsh:start', (event, payload) => {
  const p = payload || {};
  if (dshJob) return { error: '已有生成任务正在进行，请先停止或等待完成' };
  let jobRef = null;
  const cfgTimeout = (settings && settings.dsh && settings.dsh.timeoutSec) ? settings.dsh.timeoutSec * 1000 : 0;
  const timeoutMs = Math.max(30000, Math.min(900000, (p.timeoutMs || cfgTimeout || 240000)));
  const job = dsh.run({
    command: dshCommand(p.command),
    task: String(p.task || ''),
    cwd: p.cwd || os.tmpdir(),
    timeoutMs: timeoutMs,
    onEvent: (type, data) => {
      if (jobRef) sendToRenderer('dsh:event', Object.assign({ id: jobRef.id, type: type }, data || {}));
    }
  });
  jobRef = job;
  dshJob = job;
  job.promise.then((final) => {
    if (dshJob === job) dshJob = null;
    sendToRenderer('dsh:event', {
      id: job.id,
      type: final.ok ? 'done' : 'error',
      text: final.text || '',
      message: final.error || '',
      aborted: !!final.aborted
    });
  }).catch((e) => {
    if (dshJob === job) dshJob = null;
    sendToRenderer('dsh:event', { id: job.id, type: 'error', message: (e && e.message) || String(e) });
  });
  return { id: job.id };
});

ipcMain.handle('dsh:abort', () => {
  if (!dshJob) return false;
  dshJob.abort();
  return true;
});

/* ---------- MCP 本地桥（供 DSH 反向写剧本） ---------- */
const MCP_DIR = path.join(USER_DIR, 'mcp');
const MCP_CONFIG_FILE = path.join(MCP_DIR, 'mcp-bridge.json');
const MCP_SERVER_FILE = path.join(MCP_DIR, 'mcp-server.js');
const MCP_META_FILE = path.join(USER_DIR, 'mcp-meta.json');

let mcpMeta = readJSONSync(MCP_META_FILE, null) || { enabled: false, port: 45871, token: '' };
let mcpBridge = null;
const pendingMcp = new Map();
let mcpSeq = 0;

function ensureMcpFiles() {
  ensureDir(MCP_DIR);
  if (!mcpMeta.token) mcpMeta.token = crypto.randomBytes(18).toString('hex');
  try {
    fs.copyFileSync(path.join(__dirname, 'mcp-server.js'), MCP_SERVER_FILE);
  } catch (e) {
    console.error('复制 mcp-server.js 失败', e && e.message);
  }
}

function askRenderer(action, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) { reject(new Error('软件窗口未就绪')); return; }
    const id = 'mcpreq-' + (++mcpSeq);
    pendingMcp.set(id, { resolve: resolve, reject: reject });
    mainWindow.webContents.send('mcp:request', { id: id, action: action, args: args || {} });
    setTimeout(() => {
      const p = pendingMcp.get(id);
      if (p) {
        pendingMcp.delete(id);
        p.reject(new Error('软件界面响应超时（' + ((timeoutMs || 20000) / 1000) + ' 秒）'));
      }
    }, timeoutMs || 20000);
  });
}

ipcMain.handle('mcp:reply', (event, id, result) => {
  const p = pendingMcp.get(id);
  if (p) {
    pendingMcp.delete(id);
    if (result && result.ok === false) p.reject(new Error(result.error || '执行失败'));
    else p.resolve(result ? result.value : '');
  }
  return true;
});

function mcpSnippet() {
  // DSH 读的是 profile 层的 cordis patch YAML（不是 mcpServers JSON）
  return dshMcp.buildBlock({ serverFile: MCP_SERVER_FILE, configFile: MCP_CONFIG_FILE });
}

// 其它 MCP 客户端（Claude Desktop / Cursor 等）用的通用 JSON 片段
function mcpSnippetJson() {
  return JSON.stringify({
    mcpServers: {
      'ai-script-studio': { command: 'node', args: [MCP_SERVER_FILE, MCP_CONFIG_FILE] }
    }
  }, null, 2);
}

function mcpStatus() {
  const running = !!(mcpBridge && mcpBridge.isRunning());
  return {
    running: running,
    port: running ? mcpBridge.getPort() : (mcpMeta.port || 45871),
    token: mcpMeta.token || '',
    serverFile: MCP_SERVER_FILE,
    configFile: MCP_CONFIG_FILE,
    snippet: mcpSnippet(),
    snippetJson: mcpSnippetJson(),
    command: 'node "' + MCP_SERVER_FILE + '" "' + MCP_CONFIG_FILE + '"',
    dsh: dshMcp.status()
  };
}

async function startMcpBridge() {
  if (mcpBridge && mcpBridge.isRunning()) return mcpStatus();
  ensureMcpFiles();
  const bridge = dsh.makeBridge({ ask: askRenderer, port: mcpMeta.port || 0, token: mcpMeta.token });
  const info = await bridge.start();
  mcpMeta.port = info.port;
  mcpMeta.token = info.token;
  mcpMeta.enabled = true;
  mcpBridge = bridge;
  await writeJSONAtomic(MCP_META_FILE, mcpMeta);
  await writeJSONAtomic(MCP_CONFIG_FILE, {
    port: info.port,
    token: info.token,
    pid: process.pid,
    updatedAt: new Date().toISOString()
  });
  return mcpStatus();
}

async function stopMcpBridge() {
  if (!mcpBridge) {
    mcpMeta.enabled = false;
    await writeJSONAtomic(MCP_META_FILE, mcpMeta);
    return mcpStatus();
  }
  await mcpBridge.stop();
  mcpBridge = null;
  mcpMeta.enabled = false;
  await writeJSONAtomic(MCP_META_FILE, mcpMeta);
  // 故意保留 mcp-bridge.json：DSH 启动时会 fork mcp-server.js，它需要这个文件才能给出友好错误
  return mcpStatus();
}

ipcMain.handle('mcp:status', () => mcpStatus());
ipcMain.handle('mcp:enable', async () => {
  try { return { ok: true, status: await startMcpBridge() }; }
  catch (e) { return { ok: false, error: '启动 MCP 服务失败：' + ((e && e.message) || e) }; }
});
ipcMain.handle('mcp:disable', async () => {
  try { return { ok: true, status: await stopMcpBridge() }; }
  catch (e) { return { ok: false, error: '停止失败：' + ((e && e.message) || e) }; }
});

/* --- 一键注册进 DSH（自动适配版本：先探测该版本实际使用的 mcp-client 插件名） --- */
ipcMain.handle('mcp:dshStatus', () => dshMcp.status());

ipcMain.handle('mcp:dshInstall', async (event, profileName) => {
  try {
    ensureMcpFiles();
    const cmd = (settings && settings.dsh && settings.dsh.command) || 'dsh';
    const probe = await dshMcp.detectPluginName(profileName, cmd);
    const res = dshMcp.install({
      profile: profileName,
      serverFile: MCP_SERVER_FILE,
      configFile: MCP_CONFIG_FILE,
      pluginName: probe.ok ? probe.pluginName : dshMcp.DEFAULT_PLUGIN
    });
    if (!res.ok) return res;
    const check = await dshMcp.verify(profileName, cmd);
    res.pluginName = probe.ok ? probe.pluginName : dshMcp.DEFAULT_PLUGIN;
    res.probeFound = !!probe.found;
    res.verify = check;
    res.status = dshMcp.status();
    return res;
  } catch (e) {
    return { ok: false, error: '注册失败：' + ((e && e.message) || e) };
  }
});

ipcMain.handle('mcp:dshUninstall', async (event, profileName) => {
  try {
    const res = dshMcp.uninstall({ profile: profileName });
    if (!res.ok) return res;
    res.status = dshMcp.status();
    return res;
  } catch (e) {
    return { ok: false, error: '撤销失败：' + ((e && e.message) || e) };
  }
});

/* ---------- 本地 AI 网关（用本机 dsh 驱动，不需要外部 API Key） ---------- */
const GW_INFO_FILE = path.join(USER_DIR, 'gateway.json');

const localGateway = localGatewayMod.createGateway({
  port: 0,
  token: '',
  model: 'dsh-local',
  run: function (task, onEvent, timeoutMs) {
    return dsh.run({ command: dshCommand(), task: task, cwd: os.tmpdir(), timeoutMs: timeoutMs, onEvent: onEvent });
  },
  getTimeoutMs: function () {
    const sec = (settings && settings.dsh && settings.dsh.timeoutSec) || 240;
    return Math.max(60, sec) * 1000;
  }
});

function gatewayStatus() {
  const gw = (settings && settings.gateway) || {};
  const running = localGateway.isRunning();
  return {
    enabled: !!gw.enabled,
    running: running,
    port: running ? localGateway.getPort() : (gw.port || 0),
    baseUrl: running ? localGateway.getBaseUrl() : '',
    token: localGateway.getToken(),
    model: gw.model || 'dsh-local',
    dshCommand: dshCommand(),
    infoFile: GW_INFO_FILE,
    api: settings ? {
      baseUrl: settings.api.baseUrl,
      model: settings.api.model,
      hasKey: !!String(settings.api.apiKey || '').trim()
    } : null
  };
}

/* 只有「还没配过 Key」或者「当前填的就是本机网关」时才自动回填，绝不覆盖用户自己填的外部 Key */
function shouldAutoFillGateway() {
  const api = (settings && settings.api) || {};
  const key = String(api.apiKey || '').trim();
  const url = String(api.baseUrl || '');
  if (!key) return true;
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(url);
}

function applyLocalGatewayToApi() {
  if (!settings) return { ok: false, message: '设置尚未加载' };
  if (!localGateway.isRunning()) return { ok: false, message: '本地网关没有运行，请先开启。' };
  const gw = settings.gateway || (settings.gateway = {});
  const api = settings.api || (settings.api = {});
  api.baseUrl = localGateway.getBaseUrl();
  api.apiKey = localGateway.getToken();
  api.model = gw.model || 'dsh-local';
  persistSettings();
  return { ok: true, api: Object.assign({}, api), status: gatewayStatus() };
}

async function startLocalGateway() {
  if (!settings) return gatewayStatus();
  const gw = settings.gateway || (settings.gateway = {});
  if (!gw.enabled) return gatewayStatus();
  if (localGateway.isRunning()) return gatewayStatus();
  if (!gw.token) gw.token = localGatewayMod.newToken();
  localGateway.setToken(gw.token);
  localGateway.setPort(gw.port || 0);
  const started = await localGateway.start();
  gw.port = started.port;
  persistSettings();
  try {
    await writeJSONAtomic(GW_INFO_FILE, {
      baseUrl: started.baseUrl,
      token: gw.token,
      model: gw.model || 'dsh-local',
      port: started.port,
      updatedAt: new Date().toISOString(),
      note: '本地网关：把 baseUrl 与 token 填进任何支持 OpenAI 协议的客户端，即可用本机 dsh 生成内容。'
    });
  } catch (e) { /* ignore */ }
  if (gw.autoFill !== false && shouldAutoFillGateway()) applyLocalGatewayToApi();
  return gatewayStatus();
}

async function stopLocalGateway() {
  if (!settings) return { ok: true, status: gatewayStatus() };
  const gw = settings.gateway || (settings.gateway = {});
  gw.enabled = false;
  persistSettings();
  await localGateway.stop();
  return { ok: true, status: gatewayStatus() };
}

ipcMain.handle('gateway:status', () => gatewayStatus());

ipcMain.handle('gateway:enable', async () => {
  try {
    if (!settings) return { ok: false, error: '设置尚未加载' };
    settings.gateway.enabled = true;
    if (!settings.gateway.token) settings.gateway.token = localGatewayMod.newToken();
    persistSettings();
    const status = await startLocalGateway();
    return { ok: true, status: status };
  } catch (e) {
    return { ok: false, error: '启动本地网关失败：' + ((e && e.message) || e) };
  }
});

ipcMain.handle('gateway:disable', async () => {
  try { return await stopLocalGateway(); }
  catch (e) { return { ok: false, error: '停止失败：' + ((e && e.message) || e) }; }
});

ipcMain.handle('gateway:rotate', async () => {
  try {
    if (!settings) return { ok: false, error: '设置尚未加载' };
    const token = localGatewayMod.newToken();
    settings.gateway.token = token;
    localGateway.setToken(token);
    persistSettings();
    if (localGateway.isRunning()) {
      try {
        await writeJSONAtomic(GW_INFO_FILE, {
          baseUrl: localGateway.getBaseUrl(), token: token,
          model: settings.gateway.model || 'dsh-local',
          port: localGateway.getPort(), updatedAt: new Date().toISOString()
        });
      } catch (e) { /* ignore */ }
      if (shouldAutoFillGateway()) applyLocalGatewayToApi();
    }
    return { ok: true, token: token, status: gatewayStatus() };
  } catch (e) {
    return { ok: false, error: '重新生成失败：' + ((e && e.message) || e) };
  }
});

ipcMain.handle('gateway:apply', () => {
  const res = applyLocalGatewayToApi();
  if (res.ok) res.status = gatewayStatus();
  return res;
});

ipcMain.handle('gateway:test', async () => {
  const { net } = require('electron');
  if (!localGateway.isRunning()) return { ok: false, message: '本地网关没有运行，请先开启它。' };
  const url = localGateway.getBaseUrl() + '/chat/completions';
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch (e) {} }, 180000);
  try {
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localGateway.getToken() },
      signal: controller.signal,
      body: JSON.stringify({
        model: (settings.gateway && settings.gateway.model) || 'dsh-local',
        messages: [{ role: 'user', content: '只回复两个字：正常' }],
        stream: false
      })
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, message: '网关返回 ' + resp.status + '：' + String(text).slice(0, 300) };
    let content = '';
    try {
      const j = JSON.parse(text);
      content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    } catch (e) { /* ignore */ }
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    return { ok: true, message: '网关正常（' + sec + ' 秒）：' + (content || '已响应'), content: content, ms: Date.now() - started };
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? '等待超时（180 秒），dsh 没有返回内容'
      : '调用失败：' + (err && err.message ? err.message : String(err));
    return { ok: false, message: msg };
  } finally {
    clearTimeout(timer);
  }
});

// ---------- 清理上次残留的子进程 ----------
function readChildrenFile() {
  try {
    const txt = fs.readFileSync(CHILDREN_FILE, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(txt);
    const pids = Array.isArray(data && data.pids) ? data.pids.filter((n) => Number.isInteger(n) && n > 4) : [];
    return pids;
  } catch (e) {
    return [];
  }
}

function runPowerShell(script, timeoutMs) {
  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    let out = '';
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    let child;
    try {
      child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (e) {
      finish('');
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } finish(out); }, timeoutMs || 8000);
    child.stdout.on('data', (d) => { out += String(d); if (out.length > 200000) out = out.slice(0, 200000); });
    child.on('error', () => { clearTimeout(timer); finish(''); });
    child.on('close', () => { clearTimeout(timer); finish(out); });
  });
}

/**
 * 上次运行留下的 dsh 子进程如果还活着，会占住 DeepSeek Harness 的端口/会话，
 * 表现就是「DSH 打不开、要手动去任务管理器杀掉一个 node」。
 * 这里在启动时把它们清掉，并把结果写进日志。
 */
async function cleanupStaleChildren() {
  const pids = readChildrenFile();
  if (!pids.length) return { found: 0, killed: [] };
  logLine('cleanup', '发现上次残留的子进程记录：' + pids.join(', '));

  const ids = pids.join(',');
  const script = [
    '$ids = @(' + ids + ')',
    '$rows = @()',
    'foreach ($i in $ids) {',
    '  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $i) -ErrorAction SilentlyContinue',
    '  if ($p) { $rows += [pscustomobject]@{ pid = [int]$p.ProcessId; name = [string]$p.Name; cl = [string]$p.CommandLine } }',
    '}',
    'if ($rows.Count -eq 0) { "[]" } else { $rows | ConvertTo-Json -Compress }'
  ].join('\n');

  const raw = (await runPowerShell(script, 8000)).trim();
  let rows = [];
  try {
    const parsed = JSON.parse(raw || '[]');
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    rows = [];
  }

  const killed = [];
  const looksLikeOurs = (row) => {
    const txt = String((row && row.cl) || '').toLowerCase();
    const name = String((row && row.name) || '').toLowerCase();
    if (!txt && !name) return false;
    if (name === 'node.exe' || name === 'cmd.exe') {
      return /headless|--json|mcp-server|ai-script|dsh/.test(txt);
    }
    return false;
  };

  for (const row of rows) {
    if (!looksLikeOurs(row)) continue;
    try {
      const { spawnSync } = require('node:child_process');
      spawnSync('taskkill', ['/PID', String(row.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
      killed.push(row.pid);
    } catch (e) { /* ignore */ }
  }
  try { fs.unlinkSync(CHILDREN_FILE); } catch (e) { /* ignore */ }
  if (killed.length) logLine('cleanup', '已清理残留进程：' + killed.join(', '));
  else logLine('cleanup', '残留记录里的进程都已退出');
  return { found: rows.length, killed: killed };
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    logLine('boot', '启动 v' + app.getVersion() + ' · ' + process.platform + ' · userData=' + USER_DIR);
    settings = loadSettings();
    ensureDir(WALLPAPER_DIR);
    ensureDir(BACKUP_DIR);
    Menu.setApplicationMenu(null);
    registerMediaProtocol();

    // 先清掉上次残留的 dsh 子进程（最多等 1.5 秒，绝不影响开窗）
    try {
      const cleaned = await Promise.race([
        cleanupStaleChildren(),
        new Promise((r) => setTimeout(() => r(null), 1500))
      ]);
      if (cleaned && cleaned.killed && cleaned.killed.length) {
        console.log('已清理上次残留的子进程：' + cleaned.killed.join(', '));
      }
    } catch (e) {
      logLine('cleanup', '清理残留进程失败：' + ((e && e.message) || e));
    }

    // 本地 AI 网关：先启动再开窗，这样首屏读到设置时已经填好本地密钥
    try {
      await startLocalGateway();
      const gwNow = gatewayStatus();
      logLine('gateway', '网关就绪 · port=' + gwNow.port + ' model=' + gwNow.model + ' enabled=' + gwNow.enabled);
    } catch (e) {
      logLine('gateway', '启动失败：' + ((e && e.message) || e));
      console.error('启动本地网关失败：', e && e.message);
    }

    createWindow();
    logLine('boot', '窗口已创建');

    // 上次退出前开着 MCP 服务的话自动恢复
    if (mcpMeta && mcpMeta.enabled) {
      startMcpBridge().catch((e) => console.error('恢复 MCP 服务失败：', e && e.message));
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    logLine('quit', '开始退出');
    clearTimeout(childrenSaveTimer);
    // 关键：把我们拉起的 dsh 子进程全部结束，否则它们会变成孤儿 node，
    // 占着 DSH 的端口/会话，导致下一次 DeepSeek Harness 起不来。
    try {
      if (dshJob) dshJob.abort();
    } catch (e) { /* ignore */ }
    try {
      const n = dsh.killAllLive();
      if (n) logLine('quit', '结束 ' + n + ' 个 dsh 子进程');
    } catch (e) { /* ignore */ }
    try { fs.unlinkSync(CHILDREN_FILE); } catch (e) { /* ignore */ }
    persistSettings();
    try { if (mcpBridge) mcpBridge.stop(); } catch (e) { /* ignore */ }
    try { localGateway.stop(); } catch (e) { /* ignore */ }
  });
}
