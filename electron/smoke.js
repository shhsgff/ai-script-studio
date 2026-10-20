'use strict';
/* 冒烟测试驱动器：仅在命令行带 --smoke 时由主进程调用 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const MINI_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitReady(win, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const ready = await win.webContents.executeJavaScript(
        '(function(){ try { return !!(window.App && window.Workspace && window.Tabs && window.Outline); } catch (e) { return false; } })()'
      );
      if (ready) return true;
    } catch (e) { /* 页面还在加载 */ }
    await sleep(200);
  }
  return false;
}

function postRpc(port, token, action, args) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ action: action, args: args || {} }), 'utf8');
    const req = http.request({
      host: '127.0.0.1',
      port: port,
      path: '/rpc',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-aisc-token': token
      },
      timeout: 20000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('桥返回非 JSON：' + text.slice(0, 160))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('桥连接超时')));
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

function startStdioServer(serverFile, configFile) {
  const child = spawn('node', [serverFile, configFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  let stderr = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  const notify = (msg) => {
    try { child.stdin.write(JSON.stringify(msg) + '\n'); } catch (e) { /* ignore */ }
  };
  const request = (msg, timeoutMs) => new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve: resolve, reject: reject });
    try { child.stdin.write(JSON.stringify(msg) + '\n'); } catch (e) { reject(e); return; }
    setTimeout(() => {
      if (pending.has(msg.id)) {
        pending.delete(msg.id);
        reject(new Error('MCP 应答超时：' + msg.method + (stderr ? ' / ' + stderr.slice(-160) : '')));
      }
    }, timeoutMs || 20000);
  });
  const close = () => {
    try { child.stdin.end(); } catch (e) { /* ignore */ }
    try { child.kill(); } catch (e) { /* ignore */ }
  };
  return { request: request, notify: notify, close: close, stderrText: () => stderr };
}

/* 主进程侧验证 MCP 双向通道：HTTP 桥 → 渲染进程建文档；stdio server → 桥 → 渲染进程 */
async function runMcpTests(win) {
  const log = [];
  const rec = (name, ok, extra) => log.push({ name: name, ok: !!ok, extra: extra === undefined ? null : extra });
  const data = {};
  let enabled = false;
  let status = null;

  try {
    const res = await win.webContents.executeJavaScript('window.api.mcpEnable()', true);
    enabled = !!(res && res.ok);
    status = res && res.status;
    rec('MCP 服务已开启', enabled && status && status.running, status && status.port);
  } catch (e) {
    rec('MCP 服务已开启', false, String(e.message || e));
  }

  const titles = async () => {
    try {
      return await win.webContents.executeJavaScript('window.Workspace.list().map(function(d){return d.model.meta.title;})', true);
    } catch (e) { return []; }
  };

  if (enabled && status) {
    data.port = status.port;
    data.serverFile = status.serverFile;
    try {
      const r = await postRpc(status.port, status.token, 'create_script', {
        title: 'MCP 桥接剧本',
        chapters: [{ title: '第一章：桥', paragraphs: ['来自 MCP 桥的第一段。'] }]
      });
      rec('HTTP 桥 create_script 返回成功', !!(r && r.ok), r && r.error);
      await sleep(400);
      const list = await titles();
      data.bridgeTitles = list;
      rec('软件里出现桥接剧本', list.indexOf('MCP 桥接剧本') >= 0, list.length);
    } catch (e) {
      rec('HTTP 桥 create_script 返回成功', false, String(e.message || e));
    }

    try {
      const r = await postRpc(status.port, status.token, 'list_scripts', {});
      const text = JSON.stringify(r && r.result);
      rec('HTTP 桥 list_scripts 可用', !!(r && r.ok) && text.indexOf('MCP 桥接剧本') >= 0);
    } catch (e) {
      rec('HTTP 桥 list_scripts 可用', false, String(e.message || e));
    }

    try {
      const bad = await postRpc(status.port, 'wrong-token', 'list_scripts', {});
      rec('错误令牌被拒绝', !bad || bad.ok !== true);
    } catch (e) {
      rec('错误令牌被拒绝', true);
    }

    /* stdio MCP server 本体：按 DSH 那套 JSON-RPC 逐条验证 */
    let cli = null;
    try {
      cli = startStdioServer(status.serverFile, status.configFile);
      const init = await cli.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
      data.serverInfo = init.result && init.result.serverInfo;
      rec('MCP initialize 握手', !!(init.result && init.result.serverInfo && init.result.serverInfo.name === 'ai-script-studio'));
      cli.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const tools = await cli.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const names = ((tools.result && tools.result.tools) || []).map((t) => t.name);
      data.tools = names;
      rec('MCP tools/list 有 5 个工具', names.length === 5, names.join(','));
      rec('MCP 工具含 create_script', names.indexOf('create_script') >= 0);

      const call = await cli.request({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'create_script', arguments: { title: 'MCP 协议剧本', chapters: [{ title: '第一章：协议', sections: [{ title: '第一场：握手', paragraphs: ['协议跑通了。'] }] }] } }
      });
      const outText = ((call.result && call.result.content) || []).map((c) => c.text).join(' ');
      data.stdioCall = outText.slice(0, 120);
      rec('MCP tools/call 未报错', !!(call.result && !call.result.isError), call.result && call.result.isError ? outText.slice(0, 120) : null);
      await sleep(500);
      const list2 = await titles();
      data.stdioTitles = list2;
      rec('协议调用建立了新剧本', list2.indexOf('MCP 协议剧本') >= 0, list2.length);

      const ls = await cli.request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_scripts', arguments: {} } });
      const lsText = ((ls.result && ls.result.content) || []).map((c) => c.text).join(' ');
      rec('协议列出现有剧本', lsText.indexOf('MCP 协议剧本') >= 0 || lsText.indexOf('MCP 桥接剧本') >= 0);
    } catch (e) {
      rec('MCP initialize 握手', false, String(e.message || e));
    } finally {
      if (cli) cli.close();
    }
  } else {
    rec('MCP 通道可用', false, '服务未能开启');
  }

  try {
    const res = await win.webContents.executeJavaScript('window.api.mcpDisable()', true);
    rec('MCP 服务可关闭', !!(res && res.ok) && res.status && res.status.running === false);
  } catch (e) {
    rec('MCP 服务可关闭', false, String(e.message || e));
  }

  return { log: log, data: data };
}

/* 主进程侧验证 DSH 自动注册：临时 DSH_HOME 里真的能写对、幂等、可撤销，并用真实 dsh 校验 YAML 合法 */
async function runDshMcpTests(ctx) {
  const log = [];
  const rec = (name, ok, extra) => log.push({ name: name, ok: !!ok, extra: extra === undefined ? null : extra });
  const data = {};

  let dshMcp;
  try { dshMcp = require('./dsh-mcp'); } catch (e) {
    rec('dsh-mcp 模块可用', false, String(e.message || e));
    return { log: log, data: data };
  }
  rec('dsh-mcp 模块可用', true);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aisc-dshhome-'));
  const profDir = path.join(home, 'profiles', 'demo');
  fs.mkdirSync(profDir, { recursive: true });
  const patchFile = path.join(profDir, 'cordis.patch.yml');
  const original = '# profile patch layer\n[]\n';
  fs.writeFileSync(patchFile, original, 'utf8');
  fs.mkdirSync(path.join(home, 'profiles', 'other'), { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles', 'other', 'cordis.patch.yml'), '- id: foo\n  name: bar\n', 'utf8');

  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const st = dshMcp.status();
    data.home = st.home;
    data.profiles = st.profiles.map((p) => p.name);
    rec('能发现 DSH profile', st.exists && st.profiles.length === 2, data.profiles.join(','));

    const res = dshMcp.install({
      profile: 'demo',
      serverFile: path.join(home, 'mcp-server.js'),
      configFile: path.join(home, 'mcp-bridge.json')
    });
    rec('能写入 profile 的 cordis.patch.yml', !!(res && res.ok), res && res.error);
    const after = fs.readFileSync(patchFile, 'utf8');
    data.block = after.slice(0, 200);
    rec('写入内容是 dsh-mcp-client 条目', after.indexOf('mcp-ai-script-studio') >= 0 && after.indexOf('dsh-mcp-client') >= 0);
    rec('原有注释头保留', after.indexOf('# profile patch layer') === 0);
    rec('写前有备份', !!(res && res.backup) && fs.existsSync(res.backup));

    const again = dshMcp.install({
      profile: 'demo',
      serverFile: path.join(home, 'mcp-server.js'),
      configFile: path.join(home, 'mcp-bridge.json')
    });
    const twice = fs.readFileSync(patchFile, 'utf8');
    const count = (twice.match(/mcp-ai-script-studio/g) || []).length;
    rec('重复注册是幂等的', !!(again && again.ok) && count === 1, count);

    const prof = dshMcp.listProfiles().profiles.filter((p) => p.name === 'demo')[0];
    rec('状态里标记为已注册', !!(prof && prof.installed));

    const un = dshMcp.uninstall({ profile: 'demo' });
    const restored = fs.readFileSync(patchFile, 'utf8');
    data.restored = restored;
    rec('能撤销注册', !!(un && un.ok) && restored.indexOf('mcp-ai-script-studio') < 0);
    rec('撤销后恢复空数组', /\[\]/.test(restored), restored.trim());

    /* 用真实 dsh 的 --patch 校验生成的 YAML 这个版本能解析（不碰用户真实配置） */
    const probeFile = path.join(home, 'probe.patch.yml');
    fs.writeFileSync(probeFile, dshMcp.buildBlock({
      serverFile: path.join(home, 'mcp-server.js'),
      configFile: path.join(home, 'mcp-bridge.json')
    }), 'utf8');
    const probe = await new Promise((resolve) => {
      let child;
      try {
        child = spawn('dsh', ['--profile', 'headless', '--patch', probeFile, '--dump-config'], { shell: true, windowsHide: true });
      } catch (e) { resolve({ ok: false, error: String(e.message || e) }); return; }
      let out = '';
      let err = '';
      let done = false;
      const timer = setTimeout(() => { if (done) return; done = true; try { child.kill(); } catch (e) {} resolve({ ok: false, error: '探测超时' }); }, 60000);
      child.stdout.on('data', (c) => { out += c.toString('utf8'); });
      child.stderr.on('data', (c) => { err += c.toString('utf8'); });
      child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, error: String(e.message || e) }); });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const found = out.indexOf('mcp-ai-script-studio') >= 0;
        resolve({ ok: code === 0 && found, code: code, found: found, error: (err || out).slice(-200) });
      });
    });
    data.probe = { ok: probe.ok, code: probe.code, found: probe.found };
    rec('真实 dsh 能解析注册条目（--patch 校验）', probe.ok === true, probe.ok ? null : probe.error);
  } catch (e) {
    rec('DSH 自动注册', false, String(e.message || e));
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  return { log: log, data: data };
}

/* ---------- 本地 AI 网关（用本机 dsh 顶替外部 API） ---------- */
function chatRequest(port, token, payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port: port, path: '/v1/chat/completions', method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        authorization: 'Bearer ' + token
      }
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: text }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String((e && e.message) || e) }));
    req.write(body);
    req.end();
  });
}

async function runGatewayTests(win) {
  const log = [];
  const data = {};
  const add = (name, ok, extra) => { log.push({ name: name, ok: !!ok, extra: extra }); };

  let status = null;
  try { status = await win.webContents.executeJavaScript('window.api.gatewayStatus()', true); } catch (e) { /* ignore */ }

  add('本地网关已启动', !!(status && status.running), status ? { port: status.port, baseUrl: status.baseUrl } : null);
  add('已生成本地密钥', !!(status && /^aisc-local-[0-9a-f]{16,}$/.test(String(status.token || ''))),
    status ? String(status.token || '').slice(0, 20) + '…' : null);
  // 「填入 AI 配置」能真正写进设置（先还原成外部地址，保证与用例顺序无关）
  const applyRes = await win.webContents.executeJavaScript(`(async () => {
    try {
      await window.api.saveSettings({ api: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' } });
      const st = await window.api.gatewayApply();
      const cur = await window.api.getSettings();
      return { ok: !!(st && st.ok), baseUrl: (cur.api || {}).baseUrl || '', model: (cur.api || {}).model || '', hasKey: !!String((cur.api || {}).apiKey || '').trim() };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  })()`, true);
  add('「填入 AI 配置」把网关写进设置',
    !!(applyRes && applyRes.ok && /^https?:\/\/127\.0\.0\.1:\d+\/v1$/.test(String(applyRes.baseUrl)) && applyRes.hasKey),
    applyRes);
  data.applyRes = applyRes;

  if (!status || !status.running) {
    add('网关请求（跳过：未启动）', false);
    return { log: log, data: data };
  }
  const port = status.port;
  const token = status.token;

  const bad = await chatRequest(port, 'aisc-local-wrong-token', {
    model: 'dsh-local', stream: false,
    messages: [{ role: 'user', content: '你好' }]
  });
  add('错误密钥被网关拒绝（401）', bad.status === 401, { status: bad.status });

  const started = Date.now();
  const stream = await chatRequest(port, token, {
    model: 'dsh-local', stream: true,
    messages: [
      { role: 'system', content: '你是一位中文编剧，只输出正文。' },
      { role: 'user', content: '把这句话改得更凝练：风从北面吹来，卷起地上的枯叶。' }
    ]
  });
  const lines = stream.body.split('\n').filter((l) => l.indexOf('data:') === 0).map((l) => l.slice(5).trim());
  let text = '';
  let sawStop = false;
  let usage = null;
  lines.forEach((l) => {
    if (l === '[DONE]') return;
    try {
      const j = JSON.parse(l);
      const ch = j.choices && j.choices[0];
      if (ch && ch.delta && ch.delta.content) text += ch.delta.content;
      if (ch && ch.finish_reason === 'stop') sawStop = true;
      if (j.usage) usage = j.usage;
    } catch (e) { /* 半包忽略 */ }
  });
  data.gatewayText = text;
  data.gatewayMs = Date.now() - started;
  data.gatewayUsage = usage;

  add('网关返回 200', stream.status === 200, { status: stream.status });
  add('网关流式送回正文', text.length > 0, { text: text.slice(0, 60) });
  add('网关正文来自本机 dsh', text.indexOf('改写后') >= 0, { text: text.slice(0, 60) });
  add('网关以 [DONE] 收尾', lines.length > 0 && lines[lines.length - 1] === '[DONE]');
  add('网关给出 finish_reason=stop', sawStop);
  add('网关带 usage 统计', !!(usage && usage.total_tokens > 0), usage || null);

  const nonStream = await chatRequest(port, token, {
    model: 'dsh-local', stream: false,
    messages: [{ role: 'user', content: '只回复两个字：正常' }]
  });
  let plain = '';
  try { plain = (JSON.parse(nonStream.body).choices[0].message.content || ''); } catch (e) { /* ignore */ }
  add('网关支持非流式（OpenAI 兼容）', nonStream.status === 200 && plain.length > 0, { text: plain.slice(0, 40) });

  /* 走软件自己的 AI 面板链路：改设置 → 触发一次真实改写 */
  try {
    const roundTrip = await win.webContents.executeJavaScript(`(async function () {
      try {
        const st = await window.api.gatewayStatus();
        await window.Store.patch({ api: Object.assign({}, window.Store.get().api, {
          baseUrl: st.baseUrl, apiKey: st.token, model: 'dsh-local'
        }) });
        window.App.refreshApiStatus();
        if (!window.Workspace.count()) {
          await window.App.newProject({ title: '网关测试', dirty: true });
          await new Promise(function (r) { setTimeout(r, 250); });
        }
        const acts = window.Project.get().acts;
        window.Project.setActHtml(acts[0].id, '<h2 data-section="gw-sec">网关小节</h2><p>风从北面吹来，卷起地上的枯叶。</p>');
        window.Outline.switchTo(acts[0].id);
        await new Promise(function (r) { setTimeout(r, 120); });
        const body = document.getElementById('actBody');
        const p = Array.from(body.querySelectorAll('p')).find(function (n) { return (n.textContent || '').trim().length > 0; });
        if (!p) return { ok: false, reason: '没有段落' };
        body.focus();
        const range = document.createRange();
        range.selectNodeContents(p);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        await new Promise(function (r) { setTimeout(r, 150); });
        document.getElementById('promptInput').value = '改得更凝练';
        await window.AIPanel.run();
        for (let i = 0; i < 200; i++) {
          await new Promise(function (r) { setTimeout(r, 120); });
          const s = document.getElementById('aiStatus').textContent || '';
          if (/已完成|失败|停止/.test(s)) break;
        }
        return {
          ok: true,
          status: document.getElementById('aiStatus').textContent,
          text: document.getElementById('aiResultText').textContent,
          applyEnabled: !document.getElementById('aiApply').disabled
        };
      } catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
    })()`, true);
    data.roundTrip = roundTrip;
    add('AI 面板经本地网关完成改写', !!(roundTrip && roundTrip.ok && /已完成/.test(String(roundTrip.status))),
      roundTrip && { status: roundTrip.status, text: String(roundTrip.text || '').slice(0, 40) });
    add('网关改写结果里是本机 dsh 的文本', !!(roundTrip && /改写后/.test(String(roundTrip.text || ''))),
      roundTrip && String(roundTrip.text || '').slice(0, 40));
  } catch (e) {
    add('AI 面板经本地网关完成改写', false, { error: (e && e.message) || String(e) });
  }

  return { log: log, data: data };
}

/* 主进程侧诊断断言：日志文件、子进程登记、孤儿进程清理 */
async function runDiagnosticsTests(ctx) {
  const log = [];
  const add = (name, ok, extra) => log.push({ name: name, ok: !!ok, extra: extra });
  let ud = '';
  try { ud = ctx.app.getPath('userData'); } catch (e) { /* ignore */ }
  const logFile = path.join(ud, 'logs', 'app.log');
  let txt = '';
  try { txt = fs.readFileSync(logFile, 'utf8'); } catch (e) { /* ignore */ }

  add('主进程写了诊断日志', txt.indexOf('[boot]') >= 0, { bytes: txt.length });
  add('日志里有启动与退出关键节点', /\[boot\]/.test(txt) && /\[gateway\]|\[cleanup\]/.test(txt));

  await sleep(700);
  add('子进程登记文件已清理（没有残留）', !fs.existsSync(path.join(ud, 'children.json')));

  let liveCount = -1;
  try {
    const dshMod = require('./dsh');
    liveCount = dshMod.livePids().length;
  } catch (e) { /* ignore */ }
  add('没有遗留的 dsh 子进程', liveCount === 0, { live: liveCount });

  return { log: log, data: { logFile: logFile, logBytes: txt.length, liveChildren: liveCount } };
}

async function run(ctx) {
  const win = ctx.win;
  const dialog = ctx.dialog;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aisc-smoke-'));
  const savedPath = path.join(dir, 'demo.aisc');
  const mdPath = path.join(dir, 'import.md');
  const pngPath = path.join(dir, 'wall.png');
  fs.writeFileSync(mdPath, '# 第一章 起点\n\n这是第一段。\n\n这是第二段。\n\n## 第二章 转折\n\n新的段落。\n', 'utf8');
  fs.writeFileSync(pngPath, Buffer.from(MINI_PNG, 'base64'));

  const exportPath = (ext) => path.join(dir, 'demo.' + ext);

  const openStub = async (w, options) => {
    const exts = (((options && options.filters) || [])[0] || {}).extensions || [];
    const low = exts.map((s) => String(s).toLowerCase());
    if (low.indexOf('aisc') >= 0 || low.indexOf('json') >= 0) return { canceled: false, filePaths: [savedPath] };
    if (low.indexOf('md') >= 0 || low.indexOf('markdown') >= 0 || low.indexOf('txt') >= 0) return { canceled: false, filePaths: [mdPath] };
    return { canceled: false, filePaths: [pngPath] };
  };
  const saveStub = async (w, options) => {
    const exts = (((options && options.filters) || [])[0] || {}).extensions || ['aisc'];
    const ext = String(exts[0] || 'aisc');
    return { canceled: false, filePath: ext === 'aisc' ? savedPath : exportPath(ext) };
  };

  dialog.showOpenDialog = openStub;
  dialog.showSaveDialog = saveStub;

  // 本地模拟 OpenAI 兼容接口，验证 AI 改写全链路
  const { startMockAI } = require('./mock-ai');
  const mockAI = await startMockAI();

  if (!(await waitReady(win, 20000))) {
    console.log('SMOKE_FAIL 渲染进程未就绪');
    return 1;
  }

  const scenario = {
    url: mockAI.url,
    badUrl: mockAI.badUrl,
    expectText: mockAI.expectText
  };
  /* 打包后 fake-dsh.js 在 asar 里，普通 node 进程读不到，先复制到临时目录 */
  let fakeDsh = path.join(__dirname, '..', 'scripts', 'fake-dsh.js');
  try {
    const copy = path.join(dir, 'fake-dsh.js');
    fs.writeFileSync(copy, fs.readFileSync(fakeDsh));
    fakeDsh = copy;
  } catch (e) { /* 读不到就沿用原路径 */ }
  const dshScenario = { command: 'node "' + fakeDsh + '"' };
  const script = 'window.__SMOKE_AI = ' + JSON.stringify(scenario) + ';\n' +
    'window.__SMOKE_DSH = ' + JSON.stringify(dshScenario) + ';\n' +
    fs.readFileSync(path.join(__dirname, 'smoke-renderer.js'), 'utf8');
  let report;
  try {
    report = await win.webContents.executeJavaScript(script, true);
  } catch (err) {
    console.log('SMOKE_FAIL 渲染进程抛出异常：' + ((err && err.message) || err));
    return 1;
  }

  // 主进程侧：MCP 双向通道 + DSH 自动注册
  const mcp = await runMcpTests(win);
  const dshMcp = await runDshMcpTests(ctx);
  const gw = await runGatewayTests(win);
  const diag = await runDiagnosticsTests(ctx);

  const allLog = (report.log || []).concat(mcp.log).concat(dshMcp.log).concat(gw.log).concat(diag.log);
  const lines = allLog.map((item) =>
    (item.ok ? '  PASS  ' : '  FAIL  ') + item.name + (item.extra ? '  → ' + JSON.stringify(item.extra) : '')
  );

  console.log('SMOKE_LOG_BEGIN');
  console.log(lines.join('\n'));
  console.log('SMOKE_LOG_END');

  const data = Object.assign({}, report.data, { mcp: mcp.data, dshMcp: dshMcp.data, gateway: gw.data, diag: diag.data });
  console.log('SMOKE_DATA ' + JSON.stringify(data));

  const checks = snapshot(dir, savedPath);
  console.log('SMOKE_FILES ' + JSON.stringify(checks));

  console.log('SMOKE_AI ' + JSON.stringify({
    url: mockAI.lastUrl(),
    model: mockAI.lastBody() && mockAI.lastBody().model,
    messages: mockAI.lastBody() && mockAI.lastBody().messages && mockAI.lastBody().messages.length,
    stream: mockAI.lastBody() && mockAI.lastBody().stream
  }));

  const failedCount = allLog.filter((l) => !l.ok).length;
  const ok = failedCount === 0;
  const summary = 'SMOKE_RESULT ' + (ok ? 'PASS' : 'FAIL') + ' (' + (allLog.length - failedCount) + '/' + allLog.length + ')';
  console.log(summary);

  // 打包后的 GUI 程序不一定能把 stdout 传出来，可指定文件落地结果
  if (process.env.SMOKE_OUT) {
    try {
      fs.writeFileSync(process.env.SMOKE_OUT, lines.join('\n') + '\n' + summary + '\nSMOKE_DATA ' + JSON.stringify(data) + '\n', 'utf8');
    } catch (e) { /* ignore */ }
  }

  try { await mockAI.close(); } catch (e) { /* ignore */ }
  return ok ? 0 : 1;
}

function snapshot(dir, savedPath) {
  const out = {};
  const list = fs.readdirSync(dir);
  out.dir = dir;
  list.forEach((name) => {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    const buf = fs.readFileSync(full);
    out[name] = { bytes: st.size, head: buf.slice(0, 5).toString('latin1') };
  });
  try {
    const raw = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    out.project = {
      version: raw.version,
      title: raw.meta && raw.meta.title,
      acts: Array.isArray(raw.acts) ? raw.acts.length : -1,
      hasHistory: Array.isArray(raw.history)
    };
  } catch (e) {
    out.project = { error: String((e && e.message) || e) };
  }
  return out;
}

module.exports = { run };
