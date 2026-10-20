'use strict';
/* 本机 DeepSeek Harness 调用封装：检测、流式调用、MCP 桥 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IS_WIN = process.platform === 'win32';
let running = null; /* { id, child } */

/* 所有还活着的 dsh 子进程：退出时统一清理，避免留下孤儿 node 占住 DSH 的端口 */
const live = new Set();
let childWatcher = null;

function livePids() {
  const out = [];
  live.forEach(function (c) { if (c && c.pid) out.push(c.pid); });
  return out;
}

function notifyChildren() {
  if (typeof childWatcher !== 'function') return;
  try { childWatcher(livePids()); } catch (e) { /* ignore */ }
}

function trackChild(child) {
  if (!child || !child.pid) return;
  live.add(child);
  notifyChildren();
  const done = function () {
    if (!live.has(child)) return;
    live.delete(child);
    notifyChildren();
  };
  child.on('close', done);
  child.on('exit', done);
  child.on('error', done);
}

function setChildWatcher(fn) {
  childWatcher = typeof fn === 'function' ? fn : null;
  notifyChildren();
}

function killAllLive() {
  const kids = Array.from(live);
  kids.forEach(function (c) { try { killTree(c); } catch (e) { /* ignore */ } });
  return kids.length;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {
    try { child.kill(); } catch (e2) {}
  }
}

/* 用 shell 拉起 dsh，参数里不含用户输入（任务走 stdin），避免引号问题 */
function spawnDsh(command, opts) {
  const args = ['headless', '--json', '-'];
  const child = spawn(command, args, {
    cwd: (opts && opts.cwd) || os.tmpdir(),
    env: Object.assign({}, process.env, { NO_COLOR: '1', FORCE_COLOR: '0' }),
    shell: true,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  trackChild(child);
  return child;
}

function detect(command) {
  return new Promise(function (resolve) {
    const cmd = String(command || 'dsh').trim() || 'dsh';
    let done = false;
    const finish = function (ok, extra) {
      if (done) return;
      done = true;
      resolve(Object.assign({ ok: ok, command: cmd }, extra || {}));
    };
    let child;
    try {
      child = spawn(cmd, ['--version'], { shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      trackChild(child);
    } catch (e) {
      finish(false, { message: '启动失败：' + e.message });
      return;
    }
    let out = '';
    const timer = setTimeout(function () { killTree(child); finish(false, { message: '检测超时' }); }, 15000);
    child.stdout.on('data', function (d) { out += String(d); });
    child.stderr.on('data', function (d) { out += String(d); });
    child.on('error', function (e) { clearTimeout(timer); finish(false, { message: e.message }); });
    child.on('close', function (code) {
      clearTimeout(timer);
      const text = out.replace(/\u001b\[[0-9;]*m/g, '').trim();
      if (code === 0) finish(true, { version: text.split(/\r?\n/)[0] || '' });
      else finish(false, { message: text.split(/\r?\n/)[0] || ('退出码 ' + code) });
    });
  });
}

/**
 * 执行一次 headless 任务。
 * @param {object} o { command, task, cwd, timeoutMs, onEvent(type,payload) }
 * @returns {{ id:string, abort:Function, promise:Promise<{ok:boolean,text:string,error?:string}> }}
 */
function run(o) {
  const id = 'dsh-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const timeoutMs = (o && o.timeoutMs) || 240000;
  const onEvent = (o && o.onEvent) || function () {};
  let aborted = false;
  let finalText = '';
  let lastText = '';
  let stderr = '';
  let finished = false;

  const child = spawnDsh((o && o.command) || 'dsh', { cwd: o && o.cwd });
  running = { id: id, child: child };

  const promise = new Promise(function (resolve) {
    let buf = '';
    const settle = function (res) {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (running && running.id === id) running = null;
      resolve(res);
    };

    const hardTimer = setTimeout(function () {
      onEvent('timeout', {});
      killTree(child);
      settle({ ok: false, text: lastText, error: '生成超时（超过 ' + Math.round(timeoutMs / 1000) + ' 秒），已中断。' });
    }, timeoutMs);

    const handleLine = function (line) {
      const t = line.trim();
      if (!t) return;
      let ev;
      try { ev = JSON.parse(t); } catch (e) { return; }
      if (!ev || typeof ev !== 'object') return;
      if (ev.type === 'text' && typeof ev.text === 'string') {
        lastText += ev.text;
        onEvent('text', { text: ev.text, full: lastText });
      } else if (ev.type === 'thinking' && typeof ev.text === 'string') {
        onEvent('thinking', { text: ev.text });
      } else if (ev.type === 'status') {
        if (ev.phase === 'step_start') onEvent('status', { text: '思考中…' });
        else if (ev.phase === 'step_end') onEvent('status', { text: '正在整理输出…' });
        else if (ev.phase === 'turn_start') onEvent('status', { text: '已连接 DeepSeek Harness…' });
      } else if (ev.type === 'final' && typeof ev.text === 'string') {
        finalText = ev.text;
      } else if (ev.type === 'error') {
        onEvent('error', { message: ev.message || '未知错误' });
      }
    };

    child.stdout.on('data', function (d) {
      buf += String(d);
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });
    child.stderr.on('data', function (d) {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.stdin.on('error', function () {});
    try {
      child.stdin.write(String((o && o.task) || ''));
      child.stdin.end();
    } catch (e) {}

    child.on('error', function (e) {
      settle({ ok: false, text: lastText, error: '无法启动 dsh：' + e.message + '\n请确认已安装 DeepSeek Harness 并在 PATH 中。' });
    });
    child.on('close', function (code) {
      if (buf.trim()) handleLine(buf);
      if (aborted) { settle({ ok: false, text: lastText, error: '已停止生成', aborted: true }); return; }
      const text = (finalText || lastText || '').trim();
      if (code === 0 && text) { settle({ ok: true, text: text }); return; }
      const detail = stderr.trim().split(/\r?\n/).slice(-4).join('\n');
      settle({ ok: false, text: text, error: text ? (detail || '') : ('dsh 退出码 ' + code + (detail ? '\n' + detail : '')) });
    });
  });

  return {
    id: id,
    promise: promise,
    abort: function () {
      aborted = true;
      killTree(child);
    }
  };
}

function abortCurrent() {
  if (running) { killTree(running.child); return true; }
  return false;
}

/* ---------- MCP 本地桥 ---------- */
function makeBridge(opts) {
  const token = (opts && opts.token) || crypto.randomBytes(18).toString('hex');
  const preferredPort = Math.max(0, Number(opts && opts.port) || 0);
  let server = null;
  let port = 0;
  const pending = new Map();
  let seq = 0;
  const ask = opts.ask; /* (action, args) => Promise<any> */

  function start() {
    return new Promise(function (resolve, reject) {
      server = http.createServer(function (req, res) {
        const cors = {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type, x-aisc-token',
          'access-control-allow-methods': 'POST, OPTIONS'
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404, cors); res.end('{"ok":false,"error":"not found"}'); return; }
        if (String(req.headers['x-aisc-token'] || '') !== token) { res.writeHead(401, cors); res.end('{"ok":false,"error":"token 无效"}'); return; }
        const chunks = [];
        let size = 0;
        req.on('data', function (c) {
          size += c.length;
          if (size > 8 * 1024 * 1024) { req.destroy(); return; }
          chunks.push(c);
        });
        req.on('end', function () {
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
            res.writeHead(200, cors); res.end(JSON.stringify({ ok: false, error: '请求不是合法 JSON' })); return;
          }
          Promise.resolve(ask(body.action, body.args || {}))
            .then(function (result) {
              res.writeHead(200, cors);
              res.end(JSON.stringify({ ok: true, result: result === undefined ? '完成' : result }));
            })
            .catch(function (e) {
              res.writeHead(200, cors);
              res.end(JSON.stringify({ ok: false, error: (e && e.message) || String(e) }));
            });
        });
      });
      let tries = 0;
      function attempt(p) {
        server.once('error', function (err) {
          tries += 1;
          if (p > 0 && err && err.code === 'EADDRINUSE' && tries <= 6) {
            setTimeout(function () { attempt(p + 1); }, 60);
            return;
          }
          if (p > 0 && tries <= 6) { setTimeout(function () { attempt(p + 1); }, 60); return; }
          reject(err);
        });
        server.listen(p, '127.0.0.1', function () {
          port = server.address().port;
          resolve({ port: port, token: token });
        });
      }
      attempt(preferredPort);
    });
  }

  function stop() {
    return new Promise(function (resolve) {
      if (!server) { resolve(false); return; }
      const s = server;
      server = null;
      try { s.close(function () { resolve(true); }); } catch (e) { resolve(false); }
    });
  }

  return {
    start: start,
    stop: stop,
    getPort: function () { return port; },
    getToken: function () { return token; },
    isRunning: function () { return !!server; }
  };
}

module.exports = { detect, run, abortCurrent, makeBridge, killTree, livePids, killAllLive, setChildWatcher };
