#!/usr/bin/env node
'use strict';
/*
 * AI Script Studio —— MCP stdio server
 * 用法：node mcp-server.js <bridge-config.json>
 * 由本软件主进程在「设置 → DSH / MCP」里生成配置后，注册给 DeepSeek Harness 使用。
 * 它把 MCP 的 tools/call 转发到本软件里的本地 HTTP 桥，从而实现「DSH 直接往软件里写剧本」。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const cfgPath = process.argv[2] || path.join(__dirname, 'mcp-bridge.json');
let cfg = { port: 0, token: '' };
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
  process.stderr.write('无法读取桥配置: ' + cfgPath + ' (' + e.message + ')\n');
}

const SERVER_INFO = { name: 'ai-script-studio', version: '1.0.0' };
const PROTOCOL = '2024-11-05';

const TOOLS = [
  {
    name: 'create_script',
    description: '在本软件里新建一个剧本标签页。可一次给出全部章节与小节。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '剧本标题' },
        chapters: {
          type: 'array',
          description: '章节数组',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              paragraphs: { type: 'array', items: { type: 'string' }, description: '这一章的正文段落（没有小节时用）' },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    paragraphs: { type: 'array', items: { type: 'string' } }
                  },
                  required: ['title']
                }
              }
            },
            required: ['title']
          }
        }
      },
      required: ['title']
    }
  },
  {
    name: 'add_chapter',
    description: '在当前剧本末尾新增一章。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        paragraphs: { type: 'array', items: { type: 'string' } }
      },
      required: ['title']
    }
  },
  {
    name: 'append_text',
    description: '往当前（或指定）章节的正文末尾追加段落。',
    inputSchema: {
      type: 'object',
      properties: {
        chapter: { type: 'string', description: '章节标题，省略则用当前章节' },
        text: { type: 'string', description: '要追加的正文，可用空行分段' }
      },
      required: ['text']
    }
  },
  {
    name: 'list_scripts',
    description: '列出当前打开的所有剧本标签及其字数。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_script',
    description: '读取剧本正文（默认当前标签），用于续写前了解已有内容。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '剧本标题，省略则取当前标签' },
        maxChars: { type: 'number', description: '最多返回多少字符，默认 6000' }
      }
    }
  }
];

function rpc(payload) {
  return new Promise(function (resolve, reject) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = http.request({
      host: '127.0.0.1',
      port: cfg.port,
      path: '/rpc',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-aisc-token': cfg.token || ''
      },
      timeout: 30000
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('桥返回了非 JSON：' + text.slice(0, 200))); }
      });
    });
    req.on('timeout', function () { req.destroy(new Error('桥连接超时')); });
    req.on('error', function (e) { reject(new Error('无法连接到 AI 剧本创作工具（MCP 服务可能未开启）：' + e.message)); });
    req.write(body);
    req.end();
  });
}

async function callTool(name, args) {
  if (!cfg || !cfg.port) {
    return { content: [{ type: 'text', text: '错误：没有找到桥配置（mcp-bridge.json），请在 AI 剧本创作工具里点「开启 MCP 服务」后重新注册。' }], isError: true };
  }
  const res = await rpc({ action: name, args: args || {} });
  if (!res || res.ok !== true) {
    const msg = (res && res.error) || '工具执行失败';
    return { content: [{ type: 'text', text: '错误：' + msg }], isError: true };
  }
  const text = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
  return { content: [{ type: 'text', text: text }] };
}

let stdoutBroken = false;
function send(msg) {
  if (stdoutBroken) return;
  try {
    process.stdout.write(JSON.stringify(msg) + '\n');
  } catch (e) {
    stdoutBroken = true;
    shutdown(0);
  }
}

/* ---------- 生命周期兜底 ----------
 * 这个进程是被外部宿主（DeepSeek Harness）用 stdio 拉起来的。
 * 宿主一退出，stdin 会被关闭；如果我们不主动退出，就会变成一个
 * 占着内存、在任务管理器里看起来像「软件的残留进程」，还会让宿主下次启动时各种检查以为端口被占。
 * 所以：stdin 结束 / 收到信号 / stdout 断开 / 未捕获异常 → 一律立刻退出。
 */
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  const c = typeof code === 'number' ? code : 0;
  const done = function () { process.exit(c); };
  try { process.stdin.pause(); } catch (e) { /* ignore */ }
  try { process.stdin.destroy(); } catch (e) { /* ignore */ }
  try {
    if (process.stdout.writableLength > 0) {
      process.stdout.once('drain', done);
    }
  } catch (e) { /* ignore */ }
  // 最多等 300ms 把缓冲写干净，然后务必退出（不退就会变成残留进程）
  setTimeout(done, 300);
}

process.on('SIGTERM', function () { shutdown(0); });
process.on('SIGINT', function () { shutdown(0); });
process.on('SIGHUP', function () { shutdown(0); });
process.on('disconnect', function () { shutdown(0); });
process.on('uncaughtException', function (e) {
  try { process.stderr.write('[mcp-server] uncaught: ' + ((e && e.stack) || e) + '\n'); } catch (e2) { /* ignore */ }
  shutdown(1);
});
process.on('unhandledRejection', function (e) {
  try { process.stderr.write('[mcp-server] unhandled: ' + ((e && e.stack) || e) + '\n'); } catch (e2) { /* ignore */ }
  shutdown(1);
});

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('end', function () { shutdown(0); });
process.stdin.on('close', function () { shutdown(0); });
process.stdin.on('error', function () { shutdown(0); });
process.stdin.on('data', function (chunk) {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleLine(line);
  }
});

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  const id = msg.id;
  const method = msg.method;
  if (method === undefined) return; /* 客户端发来的通知 */

  try {
    if (method === 'initialize') {
      // 回显客户端请求的协议版本：不同 DSH 版本用的 MCP SDK 版本不同，
      // 硬写一个旧版本会让新客户端协商失败。客户端没给就用默认值。
      const asked = (msg.params && msg.params.protocolVersion) || '';
      const proto = (typeof asked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asked)) ? asked : PROTOCOL;
      if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: { protocolVersion: proto, capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
      return;
    }
    if (method === 'notifications/cancelled' || method === 'notifications/roots/list_changed') return;
    if (method === 'logging/setLevel') { if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: {} }); return; }
    if (method === 'completion/complete') { if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: { completion: { values: [] } } }); return; }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') { if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: {} }); return; }
    if (method === 'tools/list') {
      if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: { tools: TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const params = msg.params || {};
      const out = await callTool(params.name, params.arguments || {});
      if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: out });
      return;
    }
    if (method === 'resources/list') { if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: { resources: [] } }); return; }
    if (method === 'prompts/list') { if (id !== undefined) send({ jsonrpc: '2.0', id: id, result: { prompts: [] } }); return; }
    if (id !== undefined) send({ jsonrpc: '2.0', id: id, error: { code: -32601, message: '未实现的方法: ' + method } });
  } catch (e) {
    if (id !== undefined) send({ jsonrpc: '2.0', id: id, error: { code: -32000, message: e.message || String(e) } });
  }
}
