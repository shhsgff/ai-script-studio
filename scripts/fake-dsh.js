'use strict';
/* 冒烟测试专用的假 dsh：模仿 `dsh headless --json` 的 NDJSON 事件流，让「关键词→剧本」与「本地网关」全链路可离线验证 */
const JSON_PAYLOAD = {
  title: '冒烟生成剧本',
  chapters: [
    {
      title: '第一章：雨夜',
      sections: [
        { title: '第一场：巷口', paragraphs: ['雨下了一整夜。', '有人在巷口等他。'] },
        { title: '第二场：刀', paragraphs: ['刀鞘上的血还没干。'] }
      ]
    },
    {
      title: '第二章：天明',
      sections: [
        { title: '第一场：城门', paragraphs: ['天亮时城门开了。'] }
      ]
    }
  ]
};
const PLAIN_TEXT = '改写后的句子一。改写后的句子二，更凝练。';

let input = '';
let done = false;

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function emit() {
  // 本地网关会把 OpenAI messages 拼成含「【请求内容】」的任务；此时回答纯文本，模拟改写结果
  const plain = input.indexOf('【请求内容】') >= 0 || input.indexOf('【对话记录】') >= 0;
  const body = plain ? PLAIN_TEXT : JSON.stringify(JSON_PAYLOAD);
  const parts = plain
    ? [body.slice(0, 6), body.slice(6, 13), body.slice(13)]
    : [body.slice(0, 48), body.slice(48, 160), body.slice(160)];
  send({ type: 'session', sessionId: 'fake-dsh', cwd: process.cwd() });
  send({ type: 'status', phase: 'turn_start', turn: 1 });
  send({ type: 'status', phase: 'step_start', turn: 1, step: 1 });
  send({ type: 'thinking', text: '' });
  parts.forEach(function (t) { if (t) send({ type: 'text', text: t }); });
  send({ type: 'status', phase: 'step_end', turn: 1, step: 1, usage: { inputTokens: 40, outputTokens: 120, totalTokens: 160 } });
  send({ type: 'status', phase: 'turn_end', reason: { kind: 'completed' } });
  send({ type: 'final', text: body });
}

process.stdin.on('data', function (c) { input += String(c); });
process.stdin.on('end', function () {
  if (done) return;
  done = true;
  emit();
});
process.stdin.resume();
setTimeout(function () {
  if (done) return;
  done = true;
  emit();
}, 3000);
