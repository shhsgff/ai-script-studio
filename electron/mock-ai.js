'use strict';
/**
 * 冒烟测试用的本地 OpenAI 兼容接口（SSE 流式），用于在不配置真实 Key 的情况下
 * 验证「AI 改写」全链路：请求构造 → 流式增量渲染 → 结果采纳 → 错误提示。
 */
const http = require('node:http');

const PIECES = ['改写后的', '第一句。', '第二句，', '更凝练。'];

function startMockAI() {
  let lastBody = null;
  let lastUrl = '';
  const bodies = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastUrl = req.url || '';
      if (lastUrl.indexOf('/bad/') >= 0) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }));
        return;
      }
      if (!/\/chat\/completions/.test(lastUrl)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      try { lastBody = JSON.parse(body); } catch (e) { lastBody = { raw: body }; }
      bodies.push(lastBody);
      if (bodies.length > 20) bodies.shift();

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });

      let i = 0;
      const timer = setInterval(() => {
        if (i < PIECES.length) {
          const chunk = {
            id: 'mock-1',
            object: 'chat.completion.chunk',
            model: 'mock-model',
            choices: [{ index: 0, delta: { content: PIECES[i] }, finish_reason: null }]
          };
          res.write('data: ' + JSON.stringify(chunk) + '\n\n');
          i += 1;
          return;
        }
        const last = {
          id: 'mock-1',
          object: 'chat.completion.chunk',
          model: 'mock-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 }
        };
        res.write('data: ' + JSON.stringify(last) + '\n\n');
        res.write('data: [DONE]\n\n');
        clearInterval(timer);
        res.end();
      }, 40);

      // 注意：必须监听响应侧的 close（客户端断开），
      // 监听 req 的 close 会在请求体读完时立即触发，导致定时器被提前清掉、永远不返回数据
      res.on('close', () => clearInterval(timer));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port: port,
        url: 'http://127.0.0.1:' + port + '/v1',
        badUrl: 'http://127.0.0.1:' + port + '/bad/v1',
        expectText: PIECES.join(''),
        lastBody: () => lastBody,
        allBodies: () => bodies.slice(),
        lastUrl: () => lastUrl,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

module.exports = { startMockAI };
