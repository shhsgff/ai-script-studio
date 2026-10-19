'use strict';
/*
 * 本地 OpenAI 兼容网关：把外部请求转成本机 dsh headless 任务，
 * 让「AI 改写」在没有真实 API Key 的情况下也能工作。
 *
 *   POST /v1/chat/completions   （支持 stream / 非 stream）
 *   GET  /v1/models
 *   GET  /health
 *
 * 校验 Authorization: Bearer <本地密钥>（也接受 x-api-key）。
 */
const http = require('node:http');
const crypto = require('node:crypto');

function newToken() {
  return 'aisc-local-' + crypto.randomBytes(20).toString('hex');
}

function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(function (p) {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          if (typeof p.text === 'string') return p.text;
          if (p.type === 'image_url') return ''; /* 本地 dsh 不吃图片，静默丢掉 */
          if (typeof p.content === 'string') return p.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content === 'object' && typeof content.text === 'string') return content.text;
  return String(content);
}

/* 把 OpenAI messages 拼成一段给 dsh headless 的中文任务 */
function buildTask(messages, extra) {
  const list = Array.isArray(messages) ? messages : [];
  const sys = [];
  const convo = [];
  list.forEach(function (m) {
    if (!m || !m.role) return;
    const text = contentToText(m.content).trim();
    if (!text) return;
    if (m.role === 'system' || m.role === 'developer') sys.push(text);
    else convo.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text: text });
  });
  if (!convo.length && sys.length) convo.push({ role: 'user', text: sys.join('\n\n') });

  const lines = [];
  lines.push('你正在作为一个 OpenAI 兼容接口的模型后端被调用。请直接完成下面这个请求，');
  lines.push('只输出最终结果本身：不要输出任何解释、前言、后记、标题、引号或 Markdown 代码块标记。');
  if (extra && String(extra).trim()) {
    lines.push('', '【额外要求】', String(extra).trim());
  }
  if (sys.length) {
    lines.push('', '【系统要求】', sys.join('\n\n'));
  }
  if (convo.length === 1) {
    lines.push('', '【请求内容】', convo[0].text);
  } else if (convo.length > 1) {
    lines.push('', '【对话记录】');
    convo.forEach(function (c) {
      lines.push('（' + (c.role === 'assistant' ? '助手' : '用户') + '）' + c.text);
    });
    lines.push('', '【要求】请接着上面的对话，回答最后一条用户消息。');
  }
  return lines.join('\n');
}

function estimateTokens(text) {
  const s = String(text || '');
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, Math.round(cjk * 1.05 + other / 4));
}

/**
 * @param {object} opts
 *  - run:        (task, onEvent, timeoutMs) => { promise, abort }   由 dsh.run 包装
 *  - getCommand: () => string
 *  - getTimeoutMs: () => number
 *  - port / token / model
 */
function createGateway(opts) {
  const o = opts || {};
  let port = Math.max(0, Number(o.port) || 0);
  let token = o.token || newToken();
  const model = o.model || 'dsh-local';
  let server = null;
  const jobs = new Set();

  function cors(extra) {
    return Object.assign(
      {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization, x-api-key',
        'access-control-allow-methods': 'GET, POST, OPTIONS'
      },
      extra || {}
    );
  }

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, cors({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) }));
    res.end(body);
  }

  function sendError(res, status, message, type) {
    sendJson(res, status, { error: { message: message, type: type || 'invalid_request_error', code: status } });
  }

  function readBody(req, limit) {
    return new Promise(function (resolve, reject) {
      const chunks = [];
      let size = 0;
      req.on('data', function (c) {
        size += c.length;
        if (size > (limit || 16 * 1024 * 1024)) {
          reject(new Error('请求体过大'));
          try { req.destroy(); } catch (e) {}
          return;
        }
        chunks.push(c);
      });
      req.on('end', function () {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) { resolve({}); return; }
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求不是合法 JSON')); }
      });
      req.on('error', reject);
    });
  }

  function authOk(req) {
    const h = String(req.headers.authorization || '').trim();
    let key = '';
    if (/^bearer\s+/i.test(h)) key = h.replace(/^bearer\s+/i, '').trim();
    if (!key) key = String(req.headers['x-api-key'] || '').trim();
    if (!key) return { ok: false, message: '缺少 API Key。请在请求头里带上 Authorization: Bearer <本地密钥>。' };
    if (key !== token) return { ok: false, message: '本地密钥不正确（401）。请在「设置 → AI 配置 → 本地网关」里复制正确的密钥。' };
    return { ok: true };
  }

  function handleModels(res) {
    sendJson(res, 200, {
      object: 'list',
      data: [
        { id: model, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'local-dsh' },
        { id: 'deepseek-chat', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'local-dsh' },
        { id: 'deepseek-reasoner', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'local-dsh' }
      ]
    });
  }

  async function handleChat(req, res) {
    const a = authOk(req);
    if (!a.ok) { sendError(res, 401, a.message, 'authentication_error'); return; }

    let body;
    try { body = await readBody(req); } catch (e) { sendError(res, 400, e.message); return; }

    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      sendError(res, 400, 'messages 不能为空（需要 [{role,content}] 数组）。');
      return;
    }
    const useModel = String(body.model || model).trim() || model;
    const wantStream = body.stream !== false && body.stream !== 0;
    const task = buildTask(messages, body.aisc_extra_prompt);
    const id = 'chatcmpl-' + crypto.randomBytes(9).toString('hex');
    const created = Math.floor(Date.now() / 1000);
    const timeoutMs = Math.max(30000, Number(o.getTimeoutMs ? o.getTimeoutMs() : 0) || 240000);

    const sink = { fn: null };
    const job = o.run(task, function (type, payload) {
      if (type === 'text' && payload && typeof payload.full === 'string' && sink.fn) sink.fn(payload.full);
    }, timeoutMs);
    jobs.add(job);
    let closed = false;
    let text = '';

    const cleanup = function () {
      closed = true;
      jobs.delete(job);
      try { job.abort(); } catch (e) {}
    };
    req.on('aborted', cleanup);
    res.on('close', function () { if (!res.writableEnded) cleanup(); });

    let headersSent = false;
    const openSse = function () {
      if (headersSent) return;
      headersSent = true;
      res.writeHead(200, cors({
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      }));
      writeSse({ id: id, object: 'chat.completion.chunk', created: created, model: useModel,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
    };
    const writeSse = function (obj) {
      if (closed || res.writableEnded) return;
      try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
    };

    /* 等待 dsh 首个字符期间发心跳，避免上游 90 秒无数据被判定卡死 */
    const keepAlive = setInterval(function () {
      if (closed || res.writableEnded) return;
      if (headersSent) { try { res.write(': ping\n\n'); } catch (e) {} }
    }, 15000);

    /* dsh 的 text 事件是增量文本，直接当 delta 推送 */
    let lastLen = 0;
    const pokeText = function (full) {
      if (typeof full !== 'string') return;
      const chunk = full.slice(lastLen);
      lastLen = full.length;
      if (!chunk) return;
      text = full;
      if (!wantStream) return; /* 非流式：只累积，最后一次性回 */
      openSse();
      writeSse({ id: id, object: 'chat.completion.chunk', created: created, model: useModel,
        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] });
    };

    sink.fn = pokeText;

    let result;
    try {
      result = await job.promise;
    } catch (e) {
      result = { ok: false, error: (e && e.message) || String(e) };
    } finally {
      clearInterval(keepAlive);
      jobs.delete(job);
    }
    if (closed) return;

    if (!result || (!result.ok && !text)) {
      const msg = (result && result.error) || '本地 dsh 生成失败';
      if (!headersSent) { sendError(res, 502, msg, 'upstream_error'); return; }
      writeSse({ id: id, object: 'chat.completion.chunk', created: created, model: useModel,
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
        error: { message: msg, type: 'upstream_error' } });
      try { res.write('data: [DONE]\n\n'); res.end(); } catch (e) {}
      return;
    }

    const finalText = String(text || result.text || '');
    const usage = {
      prompt_tokens: estimateTokens(task),
      completion_tokens: estimateTokens(finalText),
      total_tokens: estimateTokens(task) + estimateTokens(finalText)
    };

    if (!wantStream) {
      if (headersSent) {
        /* 已经按流开了头，无法再回整体，按流结束 */
        writeSse({ id: id, object: 'chat.completion.chunk', created: created, model: useModel,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: usage });
        try { res.write('data: [DONE]\n\n'); res.end(); } catch (e) {}
        return;
      }
      sendJson(res, 200, {
        id: id, object: 'chat.completion', created: created, model: useModel,
        choices: [{ index: 0, message: { role: 'assistant', content: finalText }, finish_reason: 'stop' }],
        usage: usage
      });
      return;
    }

    openSse();
    if (finalText.length > lastLen) {
      writeSse({ id: id, object: 'chat.completion.chunk', created: created, model: useModel,
        choices: [{ index: 0, delta: { content: finalText.slice(lastLen) }, finish_reason: null }] });
    }
    writeSse({ id: id, object: 'chat.completion.chunk', created: created, model: useModel,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: usage });
    try { res.write('data: [DONE]\n\n'); res.end(); } catch (e) {}
  }

  function start() {
    return new Promise(function (resolve, reject) {
      server = http.createServer(function (req, res) {
        let url = String(req.url || '/');
        const q = url.indexOf('?');
        if (q >= 0) url = url.slice(0, q);
        if (req.method === 'OPTIONS') {
          res.writeHead(204, cors({ 'content-length': '0' }));
          res.end();
          return;
        }
        if (url === '/health') {
          sendJson(res, 200, { ok: true, service: 'ai-script-studio-gateway', model: model, backend: 'dsh', running: true });
          return;
        }
        if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
          const a = authOk(req);
          if (!a.ok) { sendError(res, 401, a.message, 'authentication_error'); return; }
          handleModels(res);
          return;
        }
        if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
          handleChat(req, res).catch(function (e) {
            try { sendError(res, 500, (e && e.message) || String(e), 'server_error'); } catch (e2) {}
          });
          return;
        }
        sendError(res, 404, '没有这个接口：' + req.method + ' ' + url + '（可用：POST /v1/chat/completions、GET /v1/models）', 'not_found');
      });
      server.on('clientError', function (err, socket) {
        try { socket.destroy(); } catch (e) {}
      });
      let tries = 0;
      function attempt(p) {
        server.once('error', function (err) {
          tries += 1;
          if (p > 0 && tries <= 8) { setTimeout(function () { attempt(p + 1); }, 80); return; }
          reject(err);
        });
        server.listen(p, '127.0.0.1', function () {
          port = server.address().port;
          resolve({ port: port, token: token, baseUrl: 'http://127.0.0.1:' + port + '/v1' });
        });
      }
      attempt(port);
    });
  }

  function stop() {
    return new Promise(function (resolve) {
      jobs.forEach(function (j) { try { j.abort(); } catch (e) {} });
      jobs.clear();
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
    getModel: function () { return model; },
    getBaseUrl: function () { return port ? 'http://127.0.0.1:' + port + '/v1' : ''; },
    setToken: function (t) { token = t || newToken(); return token; },
    setPort: function (p) { if (!server) port = Math.max(0, Number(p) || 0); return port; },
    rotate: function () { token = newToken(); return token; },
    isRunning: function () { return !!server; }
  };
}

module.exports = { createGateway: createGateway, newToken: newToken, buildTask: buildTask, estimateTokens: estimateTokens };
