'use strict';
/* 本地 DeepSeek Harness 生成剧本：
   关键词 → dsh headless --json 流式生成 → 解析结构化 JSON → 作为新标签打开（自动分章分节） */
(function () {
  const U = window.U;

  let els = null;
  let running = false;
  let jobId = null;
  let streamText = '';
  let bound = false;
  let lastPrompt = '';

  function q() {
    if (els) return els;
    els = {
      modal: document.getElementById('dshModal'),
      close: document.getElementById('dshClose'),
      prompt: document.getElementById('dshPrompt'),
      acts: document.getElementById('dshActs'),
      words: document.getElementById('dshWords'),
      style: document.getElementById('dshStyle'),
      sections: document.getElementById('dshSections'),
      log: document.getElementById('dshLog'),
      hint: document.getElementById('dshHint'),
      stop: document.getElementById('dshStop'),
      run: document.getElementById('dshRun')
    };
    return els;
  }

  /* ---------- 提示词 ---------- */
  function buildTask(o) {
    const lines = [];
    lines.push('你现在是资深中文编剧。请根据下面的关键词与设定，一次性创作出可以直接使用的剧本正文。');
    lines.push('');
    lines.push('【关键词 / 设定】' + (o.prompt || ''));
    if (o.style) lines.push('【文风要求】' + o.style);
    lines.push('');
    lines.push('【创作要求】');
    lines.push('1. 一共分 ' + o.acts + ' 章，章标题要短、有画面感，不超过 20 字。');
    if (o.sections) {
      lines.push('2. 每章拆成 2 到 4 个小节，小节标题不超过 16 字；每个小节写 2 到 5 段正文，段落之间有明确的画面推进。');
    } else {
      lines.push('2. 每章写 4 到 8 段正文，段落之间空行分隔。');
    }
    lines.push('3. 全篇正文总字数控制在 ' + o.words + ' 字左右，只写故事本身，不要写创作说明、章节小结、"本章完"等元信息。');
    lines.push('4. 不要调用任何工具，不要读写文件，不要执行命令，不要输出思考过程。');
    lines.push('5. 最终只输出一个 JSON 对象，不要解释、不要 Markdown 代码块标记。JSON 结构必须严格如下：');
    lines.push('{"title":"剧本标题","chapters":[{"title":"第一章 章节标题","sections":[{"title":"小节标题","paragraphs":["第一段正文","第二段正文"]}]}]}');
    lines.push('即使不需要小节，也请把整章正文放进一个小节里。');
    return lines.join('\n');
  }

  /* ---------- 解析 ---------- */
  function extractJson(text) {
    let t = String(text || '').trim();
    t = t.replace(/^\uFEFF/, '');
    t = t.replace(/^\s*```[a-zA-Z0-9_-]*\s*/, '').replace(/```\s*$/, '').trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    const cand = t.slice(s, e + 1);
    try { return JSON.parse(cand); } catch (err) { /* 继续尝试修复 */ }
    try { return JSON.parse(cand.replace(/,\s*([}\]])/g, '$1')); } catch (err) { /* ignore */ }
    return null;
  }

  function toParagraphs(v) {
    if (Array.isArray(v)) {
      return v.map(x => String(x === null || x === undefined ? '' : x).trim()).filter(Boolean);
    }
    return String(v === null || v === undefined ? '' : v)
      .split(/\n+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function normalizeScript(raw, fallbackTitle) {
    const src = Array.isArray(raw.chapters) ? raw.chapters
      : (Array.isArray(raw.acts) ? raw.acts
        : (Array.isArray(raw.scenes) ? raw.scenes : []));
    const chapters = [];
    src.forEach((c, i) => {
      if (!c || typeof c !== 'object') return;
      const title = String(c.title || c.name || c.chapter || ('第' + (i + 1) + '章')).trim();
      const rawSections = Array.isArray(c.sections) ? c.sections
        : (Array.isArray(c.subs) ? c.subs : null);
      const sections = [];
      if (rawSections && rawSections.length) {
        rawSections.forEach((s, j) => {
          if (!s || typeof s !== 'object') {
            const paras = toParagraphs(s);
            if (paras.length) sections.push({ title: '小节 ' + (j + 1), paragraphs: paras });
            return;
          }
          sections.push({
            title: String(s.title || s.name || ('小节 ' + (j + 1))).trim(),
            paragraphs: toParagraphs(s.paragraphs || s.content || s.text || s.body || '')
          });
        });
      }
      if (!sections.length) {
        sections.push({ title: title, paragraphs: toParagraphs(c.paragraphs || c.content || c.text || c.body || '') });
      }
      chapters.push({ title: title, sections: sections });
    });
    const total = chapters.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.paragraphs.join('').length, 0), 0);
    if (!chapters.length || total < 20) return null;
    return { title: String(raw.title || fallbackTitle || 'AI 生成剧本').trim(), chapters: chapters };
  }

  /** 兜底：模型没按 JSON 输出时，用现成的纯文本分章器切成章节 */
  function scriptFromText(text, prompt) {
    const plain = (window.App && App.parsers && App.parsers.plain) ? App.parsers.plain(text) : null;
    const chapters = [];
    if (Array.isArray(plain) && plain.length) {
      plain.forEach((a) => {
        const txt = String(a.text || '').trim() || (a.html ? Project.htmlToText(a.html) : '');
        const paras = txt.split(/\n+/).map(s => s.trim()).filter(Boolean);
        const count = Math.max(1, Math.min(4, Math.round(paras.length / 4)));
        if (paras.length <= 4) {
          chapters.push({ title: a.title || '未命名章节', sections: [{ title: a.title || '正文', paragraphs: paras }] });
        } else {
          const per = Math.ceil(paras.length / count);
          const sections = [];
          for (let i = 0; i < paras.length; i += per) {
            const part = paras.slice(i, i + per);
            if (part.length) sections.push({ title: (a.title || '') + ' · ' + (sections.length + 1), paragraphs: part });
          }
          chapters.push({ title: a.title || '未命名章节', sections: sections });
        }
      });
    }
    if (!chapters.length) {
      const paras = String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
      chapters.push({ title: 'AI 生成章节', sections: [{ title: '正文', paragraphs: paras }] });
    }
    return { title: (prompt || 'AI 生成剧本').slice(0, 24), chapters: chapters };
  }

  /* ---------- 写入工作区 ---------- */
  function makeModel(script, prompt) {
    const now = new Date().toISOString();
    const model = {
      version: Project.SCHEMA_VERSION,
      meta: {
        title: script.title || 'AI 生成剧本',
        author: '',
        createdAt: now,
        updatedAt: now,
        app: 'AI Script Studio',
        summary: String(prompt || '').slice(0, 200)
      },
      acts: script.chapters.map((ch) => Project.actFromSections(ch.title, ch.sections)),
      activeActId: null,
      outline: script.chapters.map(c => ({ title: c.title, note: '' })),
      history: []
    };
    if (!model.acts.length) model.acts.push({ id: U.uid('act'), title: '第一章', html: '<p><br></p>' });
    model.activeActId = model.acts[0].id;
    return model;
  }

  function commitScript(script, prompt, done) {
    const model = makeModel(script, prompt);
    const doc = Workspace.create(model, null, { dirty: true, activate: true });
    const totalWords = Project.stats().words;
    if (done) done(doc, totalWords);
    return doc;
  }

  /* ---------- 日志 ---------- */
  function log(text, cls) {
    const el = q().log;
    if (!el) return;
    const row = document.createElement('div');
    row.className = 'dsh-log-row' + (cls ? ' ' + cls : '');
    row.textContent = text;
    el.appendChild(row);
    while (el.childNodes.length > 60) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  function clearLog() {
    const el = q().log;
    if (el) el.innerHTML = '';
  }

  function setRunning(on) {
    running = !!on;
    const e = q();
    if (e.run) { e.run.disabled = !!on; e.run.textContent = on ? '生成中…' : '开始生成'; }
    if (e.stop) e.stop.hidden = !on;
    if (e.hint) e.hint.textContent = on ? '正在调用本地 DeepSeek Harness…' : '首次调用需要几秒到几十秒';
    [e.prompt, e.acts, e.words, e.style, e.sections].forEach((n) => { if (n) n.disabled = !!on; });
  }

  /* ---------- 事件 ---------- */
  function onEvent(ev) {
    if (!ev || (jobId && ev.id && ev.id !== jobId)) return;
    const e = q();
    if (ev.type === 'status') {
      if (ev.text) log('· ' + ev.text);
      return;
    }
    if (ev.type === 'thinking') return;
    if (ev.type === 'text') {
      streamText = ev.full || (streamText + (ev.text || ''));
      if (e.hint) e.hint.textContent = '正在生成… 已收到 ' + streamText.length + ' 字';
      return;
    }
    if (ev.type === 'delta') {
      streamText += (ev.text || '');
      if (e.hint) e.hint.textContent = '正在生成… 已收到 ' + streamText.length + ' 字';
      return;
    }
    if (ev.type === 'done') {
      const finalText = ev.text || streamText;
      finish(finalText, null);
      return;
    }
    if (ev.type === 'error') {
      finish(streamText, ev.message || '生成失败');
    }
  }

  function finish(text, errMsg) {
    const e = q();
    jobId = null;
    setRunning(false);
    if (errMsg) {
      log('✗ ' + errMsg, 'err');
      if (e.hint) e.hint.textContent = '生成失败';
      U.toast(errMsg, 'error');
      return;
    }
    const raw = extractJson(text);
    let script = raw ? normalizeScript(raw, lastPrompt) : null;
    let fallback = false;
    if (!script) {
      script = scriptFromText(text, lastPrompt);
      fallback = true;
    }
    try {
      commitScript(script, lastPrompt, (doc, words) => {
        log('✓ 已生成《' + script.title + '》：' + script.chapters.length + ' 章 · ' + Project.stats().acts.reduce((n, a) => n + a.sections, 0) + ' 节 · ' + words + ' 字', 'ok');
        if (e.hint) e.hint.textContent = '已作为新标签打开' + (fallback ? '（模型未按 JSON 输出，已自动分段）' : '');
        U.toast('已生成剧本：' + script.title, 'success');
        setTimeout(close, 420);
      });
    } catch (err) {
      log('✗ 写入失败：' + ((err && err.message) || err), 'err');
      U.toast('写入失败：' + ((err && err.message) || err), 'error');
    }
  }

  /* ---------- 运行 ---------- */
  async function run() {
    if (running) return;
    const e = q();
    const prompt = String((e.prompt && e.prompt.value) || '').trim();
    if (!prompt) {
      U.toast('请先填写关键词或设定', 'warn');
      if (e.prompt) e.prompt.focus();
      return;
    }
    lastPrompt = prompt;
    const cfg = (window.Store && Store.get && Store.get().dsh) || {};
    const acts = Math.max(1, Math.min(12, parseInt((e.acts && e.acts.value) || '3', 10) || 3));
    const words = Math.max(200, Math.min(4000, parseInt((e.words && e.words.value) || '800', 10) || 800));
    const task = buildTask({
      prompt: prompt,
      acts: acts,
      words: words,
      style: String((e.style && e.style.value) || '').trim(),
      sections: !!(e.sections && e.sections.checked)
    });
    clearLog();
    streamText = '';
    streamText = '';
    setRunning(true);
    log('▶ 正在调用本地 DeepSeek Harness（' + (cfg.command || 'dsh') + '）…');
    let res;
    try {
      res = await window.api.dshStart({
        task: task,
        command: cfg.command || 'dsh',
        timeoutMs: Math.max(60000, Math.min(900000, (cfg.timeoutSec || 240) * 1000))
      });
    } catch (err) {
      finish('', '调用失败：' + ((err && err.message) || err));
      return;
    }
    if (!res || res.error || !res.id) {
      finish('', (res && res.error) || '调用失败');
      return;
    }
    jobId = res.id;
  }

  async function stop() {
    if (!running) return;
    try { await window.api.dshAbort(); } catch (err) { /* ignore */ }
    log('■ 已请求停止');
  }

  /* ---------- 弹窗 ---------- */
  function open(preset) {
    const e = q();
    if (!e.modal) return;
    bind();
    e.modal.classList.add('show');
    if (preset && e.prompt) e.prompt.value = String(preset);
    setTimeout(() => { if (e.prompt) e.prompt.focus(); }, 60);
  }

  function close() {
    const e = q();
    if (!e.modal) return;
    if (running) {
      U.toast('生成还在进行，请先点「停止」', 'warn');
      return;
    }
    e.modal.classList.remove('show');
  }

  function bind() {
    if (bound) return;
    bound = true;
    const e = q();
    if (e.close) e.close.addEventListener('click', close);
    if (e.run) e.run.addEventListener('click', run);
    if (e.stop) e.stop.addEventListener('click', stop);
    if (e.modal) {
      e.modal.addEventListener('mousedown', (ev) => { if (ev.target === e.modal) close(); });
    }
    if (e.prompt) {
      e.prompt.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); run(); }
      });
    }
    if (window.api && window.api.onDshEvent) window.api.onDshEvent(onEvent);
  }

  function init() {
    q();
    bind();
  }

  window.DshGen = {
    init: init,
    open: open,
    close: close,
    run: run,
    stop: stop,
    isRunning: function () { return running; },
    // 供测试与调试
    _buildTask: buildTask,
    _extractJson: extractJson,
    _normalizeScript: normalizeScript,
    _scriptFromText: scriptFromText,
    _makeModel: makeModel
  };
})();
