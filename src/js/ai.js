'use strict';
/* 右侧 AI 面板：构建提示词、流式调用、采纳/放弃、改写记录、参考图 */
(function () {
  const U = window.U;
  const els = {};
  let pending = null;        // { id, actId, mode, model, prompt, original }
  let resultText = '';
  let lastRequest = null;    // 供重试
  let streaming = false;
  let refImage = null;       // { dataUrl, name }
  let fileInput = null;
  let busyOverlay = null;    // 「DSH 正在生成，AI 暂不可用」遮罩

  const MAX_TARGET = 12000;
  const MAX_REF = 8000;

  function q() {
    els.panel = document.getElementById('sidebarRight');
    els.help = document.getElementById('btnAiHelp');
    els.refBox = document.getElementById('refImageBox');
    els.refEmpty = document.getElementById('refEmpty');
    els.refPreview = document.getElementById('refPreview');
    els.refImage = document.getElementById('refImage');
    els.refName = document.getElementById('refName');
    els.refRemove = document.getElementById('refRemove');
    els.selCount = document.getElementById('selectedCount');
    els.selText = document.getElementById('selectedText');
    els.prompt = document.getElementById('promptInput');
    els.tags = document.getElementById('quickTags');
    els.model = document.getElementById('modelSelect');
    els.context = document.getElementById('contextSelect');
    els.action = document.getElementById('aiActionBtn');
    els.outlineWrite = document.getElementById('btnOutlineWrite');
    els.resultPanel = document.getElementById('aiResultPanel');
    els.status = document.getElementById('aiStatus');
    els.stop = document.getElementById('aiStop');
    els.apply = document.getElementById('aiApply');
    els.retry = document.getElementById('aiRetry');
    els.copy = document.getElementById('aiCopy');
    els.discard = document.getElementById('aiDiscard');
    els.resultText = document.getElementById('aiResultText');
    els.resultFoot = document.getElementById('aiResultFoot');
    els.history = document.getElementById('historyList');
    els.historyClear = document.getElementById('historyClear');
  }

  /* ---------- 面板状态 ---------- */
  function updateSelectionDisplay() {
    if (!els.selCount) return;
    const text = window.Editor ? window.Editor.getSelectionText() : '';
    if (text) {
      els.selCount.textContent = '已选中 ' + U.countWords(text) + ' 字 / ' + text.length + ' 字符';
      els.selText.textContent = text.replace(/\s+/g, ' ').slice(0, 200) + (text.length > 200 ? '…' : '');
    } else {
      els.selCount.textContent = '尚未选中任何文字';
      els.selText.textContent = '（未选中时将改写整章正文）';
    }
  }

  function showPanel() {
    els.resultPanel.hidden = false;
  }

  function hidePanel() {
    els.resultPanel.hidden = true;
  }

  function setStatus(text, isError) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.style.color = isError ? 'var(--danger)' : '';
  }

  function setStreaming(on) {
    streaming = on;
    if (els.resultText) els.resultText.classList.toggle('streaming', on);
    if (els.stop) els.stop.hidden = !on;
    if (els.action) {
      els.action.disabled = on || !!busyBlocker();
      els.action.textContent = on ? '⏳ 生成中…' : '🚀 立即调用 AI 改写';
    }
    if (!on) {
      if (els.stop) els.stop.hidden = true;
      if (els.action) els.action.textContent = '🚀 立即调用 AI 改写';
    }
    // 生成结束后必须重新计算「采纳」可用状态（否则会一直停用）
    if (els.apply) els.apply.disabled = on || !String(resultText || '').trim();
    if (!on) refreshBusyUI();
  }

  function renderText() {
    if (els.resultText) els.resultText.textContent = resultText;
    if (els.apply) els.apply.disabled = !resultText.trim() || streaming;
  }

  /* ---------- 构建请求 ---------- */
  function buildMessages(target, reference, prompt, image) {
    const api = Store.get().api || {};
    const sysBase = (api.systemPrompt || '').trim() ||
      '你是一位资深的中文小说/剧本润色编辑，擅长在保持作者风格的前提下让文字更有张力。';
    const sys = sysBase + '\n\n严格遵守：只输出改写后的正文本身，不要输出任何解释、前言、后记、标题、Markdown 标记或引号包裹。';

    let userText = '';
    if (reference) userText += '【参考上下文（仅供参考，不需要改写）】\n' + reference + '\n\n';
    userText += '【改写要求】\n' + prompt + '\n\n';
    userText += '【需要改写的原文】\n' + target;

    if (image && api.supportsVision) {
      return [
        { role: 'system', content: sys },
        { role: 'user', content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: image.dataUrl } }
        ] }
      ];
    }
    return [
      { role: 'system', content: sys },
      { role: 'user', content: userText }
    ];
  }

  function collectContext(docText, ctxMode) {
    const p = Project.get();
    if (!p) return '';
    const act = Project.getAct();
    if (!act) return '';
    if (ctxMode === 'outline') {
      try { return (Project.outlineToText() || '').slice(0, MAX_REF); } catch (e) { return ''; }
    }
    if (ctxMode === 'chapter') return docText.slice(0, MAX_REF);
    if (ctxMode === 'prev') {
      const idx = p.acts.findIndex(a => a.id === act.id);
      let prev = '';
      for (let i = Math.max(0, idx - 1); i < idx; i++) {
        prev += '【' + p.acts[i].title + '】\n' + Project.htmlToText(p.acts[i].html) + '\n';
      }
      return prev.slice(-MAX_REF);
    }
    return '';
  }

  /* ---------- 忙状态：DSH 生成期间锁住 AI 改写 ---------- */
  function busyBlocker() {
    return window.Busy ? window.Busy.blocker('ai') : null;
  }

  function ensureBusyUI() {
    if (!els.panel || busyOverlay) return;
    busyOverlay = document.createElement('div');
    busyOverlay.className = 'ai-busy-overlay';
    busyOverlay.innerHTML =
      '<div class="ai-busy-card">' +
        '<div class="ai-busy-icon">⏳</div>' +
        '<div class="ai-busy-title">正在工作，暂时无法使用</div>' +
        '<div class="ai-busy-text"></div>' +
        '<div class="ai-busy-hint">正文仍然可以正常手动编辑</div>' +
      '</div>';
    els.panel.appendChild(busyOverlay);
    busyOverlay.addEventListener('click', function () {
      const b = busyBlocker();
      if (b) U.toast(b.label + '，AI 改写暂时不可用（正文仍可手动编辑）', 'warn', 3200);
    });
  }

  function refreshBusyUI() {
    const b = busyBlocker();
    if (busyOverlay) {
      busyOverlay.classList.toggle('show', !!b);
      const text = busyOverlay.querySelector('.ai-busy-text');
      if (text) text.textContent = b ? (b.label + '…') : '';
    }
    if (els.action) {
      els.action.disabled = !!b || streaming;
      if (b) els.action.textContent = '⏳ ' + b.label;
      else els.action.textContent = streaming ? '⏳ 生成中…' : '🚀 立即调用 AI 改写';
    }
  }

  function warnBusy(b) {
    U.toast((b.label || '正在工作中') + '，AI 改写暂时不可用；正文仍可以手动编辑。', 'warn', 3400);
  }

  /* ---------- 模式与技能 ---------- */
  function aiMode() {
    if (window.Skills && window.Skills.mode) {
      const m = window.Skills.mode();
      if (m) return m;
    }
    return ((Store.get().api || {}).mode) || 'direct';
  }

  function skillNames() {
    return window.Skills ? window.Skills.selected() : [];
  }

  function buildAgentTask(target, reference, prompt) {
    let s = '【任务】按下面的要求处理文字（改写 / 续写 / 润色都可以），最终只输出正文本身，不要解释、不要 Markdown 标记。\n\n';
    s += '【要求】\n' + prompt + '\n\n';
    if (reference) s += '【上下文（只作参考，不需要改它）】\n' + reference + '\n\n';
    s += '【原文】\n' + target;
    return s;
  }

  async function messagesWithSkills(target, reference, prompt, image) {
    const messages = buildMessages(target, reference, prompt, image);
    const names = skillNames();
    if (!names.length || !window.Skills) return messages;
    let bodies = [];
    try { bodies = await window.Skills.bodies(names); } catch (e) { bodies = []; }
    if (!bodies.length) return messages;
    const block = bodies.map(function (b) { return '【技能：' + b.name + '】\n' + b.content; }).join('\n\n');
    messages[0].content = messages[0].content + '\n\n必须遵守下列技能里的写法规则：\n\n' + block;
    return messages;
  }

  async function prepare() {
    const blocker = busyBlocker();
    if (blocker) { warnBusy(blocker); return null; }
    const api = Store.get().api || {};
    const useAgent = aiMode() === 'agent';
    if (!useAgent && (!api.apiKey || !String(api.apiKey).trim())) {
      U.confirmBox({
        title: '尚未配置 API Key',
        message: '模型直连需要大模型接口。现在就打开「设置 → AI 配置」填写 Base URL、API Key 与模型名吗？（也可以把「模式」切到「本地 AI Agent」，不用 Key）',
        okText: '去设置'
      }).then((ok) => { if (ok && window.SettingsPanel) window.SettingsPanel.open('ai'); });
      return null;
    }
    if (streaming) { U.toast('正在生成中，请先等待或点击停止', 'warn'); return null; }

    const act = Project.getAct();
    if (!act) { U.toast('请先选择一个章节', 'warn'); return null; }

    const prompt = (els.prompt.value || '').trim();
    if (!prompt) {
      U.toast('请先填写「改写要求」，或点击下方的快捷标签', 'warn');
      els.prompt.focus();
      return null;
    }

    const selection = window.Editor ? window.Editor.getSelectionText() : '';
    const docText = Project.htmlToText(act.html).trim();
    let target = selection && selection.trim() ? selection.trim() : docText;
    let mode = selection && selection.trim() ? 'selection' : 'document';

    const useOutline = outlineArmed ? outlineTarget : null;
    outlineArmed = false;
    if (useOutline) {
      const secText = (Project.sectionText && useOutline.secId)
        ? Project.sectionText(useOutline.actId, useOutline.secId) : '';
      target = secText || ('【本节：' + useOutline.title + '】' + (useOutline.note ? '（' + useOutline.note + '）' : ''));
      mode = 'outline';
    }

    if (!target) { U.toast('正文还是空的，先写点内容吧', 'warn'); return null; }
    if (mode === 'document' && docText.length === 0) { U.toast('正文还是空的', 'warn'); return null; }

    const truncated = target.length > MAX_TARGET;
    if (truncated) target = target.slice(0, MAX_TARGET);

    const ctxMode = els.context ? els.context.value : 'selection';
    const reference = collectContext(docText, ctxMode);

    const meta = {
      actId: (mode === 'outline' && useOutline && useOutline.actId) ? useOutline.actId : act.id,
      mode: mode,
      outline: (mode === 'outline' && useOutline) ? useOutline : null,
      prompt: prompt,
      original: target,
      truncated: truncated,
      ctxMode: ctxMode,
      agent: useAgent
    };

    if (useAgent) {
      return {
        runMode: 'agent',
        task: buildAgentTask(target, reference, prompt),
        skills: skillNames(),
        model: 'dsh-agent',
        __meta: meta
      };
    }

    if (refImage && !api.supportsVision) {
      U.toast('当前模型未开启「支持图片」开关，参考图不会发送给 AI（可在设置中开启）', 'warn', 4200);
    }

    return {
      runMode: 'direct',
      messages: await messagesWithSkills(target, reference, prompt, refImage),
      model: api.model || 'deepseek-chat',
      baseUrl: api.baseUrl,
      temperature: typeof api.temperature === 'number' ? api.temperature : 0.8,
      maxTokens: api.maxTokens || 4096,
      __meta: meta
    };
  }

  /* ---------- 调用 ---------- */
  async function run() {
    let req = null;
    try { req = await prepare(); } catch (err) { req = null; }
    if (!req) return;
    lastRequest = req;
    const meta = req.__meta;
    const useAgent = req.runMode === 'agent';
    resultText = '';
    pending = {
      id: null, actId: meta.actId, mode: meta.mode, model: req.model,
      prompt: meta.prompt, original: meta.original, outlineTarget: meta.outline || null
    };
    showPanel();
    setStatus(useAgent ? '已交给本地 AI Agent…' : '生成中…');
    if (els.resultFoot) {
      els.resultFoot.textContent = (useAgent ? 'Agent：本机 dsh' : '模型：' + req.model) + ' · 正在连接…';
    }
    renderText();
    setStreaming(true);

    try {
      const api = Store.get().api || {};
      const payload = useAgent
        ? {
            mode: 'agent',
            task: req.task,
            skills: req.skills || [],
            timeoutMs: (Number(api.agentTimeoutSec) || 300) * 1000
          }
        : {
            messages: req.messages,
            model: req.model,
            baseUrl: req.baseUrl,
            temperature: req.temperature,
            maxTokens: req.maxTokens
          };
      const res = await window.api.aiStart(payload);
      if (pending) pending.id = res && res.id;
      if (meta.truncated) U.toast('原文过长，已截取前 ' + MAX_TARGET + ' 字发送', 'warn');
    } catch (err) {
      setStreaming(false);
      setStatus('调用失败', true);
      if (els.resultFoot) els.resultFoot.textContent = String(err && err.message ? err.message : err);
    }
  }

  function handleEvent(ev) {
    if (!pending || !ev || ev.id !== pending.id) return;
    if (ev.type === 'status') {
      if (streaming) setStatus(ev.message || '思考中…');
    } else if (ev.type === 'delta') {
      resultText += (ev.text || '');
      if (els.resultText) els.resultText.textContent = resultText;
      if (streaming) setStatus('生成中… ' + resultText.length + ' 字');
    } else if (ev.type === 'done') {
      resultText = (ev.text || resultText || '').trim();
      renderText();
      setStreaming(false);
      setStatus('已完成 · ' + U.countWords(resultText) + ' 字');
      if (els.resultFoot) {
        const usage = ev.usage || {};
        const parts = ['模型 ' + (ev.model || pending.model)];
        if (usage.total_tokens) parts.push('tokens ' + usage.total_tokens);
        parts.push(U.formatTime(Date.now()));
        els.resultFoot.textContent = parts.join(' · ');
      }
      saveHistory('done');
    } else if (ev.type === 'aborted') {
      resultText = (ev.text || resultText || '').trim();
      renderText();
      setStreaming(false);
      setStatus('已停止');
      if (els.resultFoot) els.resultFoot.textContent = '生成被中断，已保留 ' + resultText.length + ' 字';
      if (resultText) saveHistory('aborted');
    } else if (ev.type === 'error') {
      setStreaming(false);
      setStatus('出错了', true);
      if (els.resultText) {
        els.resultText.textContent = resultText || ('⚠️ ' + (ev.message || '未知错误'));
      }
      if (els.resultFoot) els.resultFoot.textContent = ev.message || '';
      U.toast(ev.message || 'AI 调用失败', 'error', 6000);
    }
  }

  function stop() {
    if (!pending || !pending.id) return;
    window.api.aiAbort(pending.id);
    setStatus('正在停止…');
  }

  /* ---------- 按大纲写下一节 ---------- */
  async function outlineWrite() {
    if (!window.Project) return;
    const items = Project.outlineList();
    if (!items.length) {
      U.toast('还没有大纲：先在大纲浮窗里导入文本或手写节点', 'warn', 3800);
      if (window.OutlineFloat) window.OutlineFloat.setOpen(true);
      return;
    }
    let prog = Project.outlineProgress();
    let target = prog.find(function (p) { return !p.written && p.item.level === 2; }) ||
      prog.find(function (p) { return !p.written; });
    if (!target) {
      U.toast('大纲上每一节都写过了，先在大纲浮窗里加个新节点', 'warn', 3600);
      if (window.OutlineFloat) window.OutlineFloat.setOpen(true);
      return;
    }
    const targetId = target.item.id;
    if (!target.linked) {
      Project.applyOutlineToActs();
      if (window.App && App.refreshAll) App.refreshAll();
      prog = Project.outlineProgress();
      target = prog.find(function (p) { return p.item.id === targetId; }) || target;
    }
    if (target.act && target.sec && window.Outline) {
      try { window.Outline.openSection(target.act.id, target.sec.id); } catch (e) {}
    }
    outlineTarget = {
      actId: target.act ? target.act.id : null,
      secId: target.sec ? target.sec.id : null,
      title: target.item.title,
      note: target.item.note || ''
    };
    outlineArmed = true;
    if (els.prompt) {
      els.prompt.value = '按大纲写「' + target.item.title + '」这一节' +
        (target.item.note ? '：' + target.item.note : '') +
        '。只写这一节的正文，承接前文，不用解释。';
    }
    if (els.context) els.context.value = 'outline';
    U.status('准备按大纲写：' + target.item.title);
    return run();
  }

  /* ---------- 采纳 / 放弃 ---------- */
  function apply() {
    const text = resultText.trim();
    if (!text) return;
    const p = Project.get();
    const actId = pending ? pending.actId : p.activeActId;
    const mode = pending ? pending.mode : 'selection';
    const act = Project.getAct(actId);
    if (!act) { U.toast('找不到目标章节', 'error'); return; }

    if (p.activeActId !== actId) {
      Project.setActiveAct(actId);
      if (window.Editor) window.Editor.loadAct(Project.getAct());
      if (window.Outline) window.Outline.render();
    }

    if (mode === 'outline' && pending && pending.outlineTarget) {
      const t = pending.outlineTarget;
      const ok = Project.appendToSection(t.actId, t.secId, text);
      if (!ok) { U.toast('找不到这一节，可能已被删除', 'error'); return; }
      if (Project.get().activeActId === t.actId && window.Editor && Project.getAct()) {
        window.Editor.loadAct(Project.getAct());
      }
      markApplied();
      if (window.App) window.App.refreshStats();
      if (window.Outline) window.Outline.render();
      if (window.OutlineFloat) window.OutlineFloat.refresh({ immediate: true });
      U.toast('已写进「' + t.title + '」这一节', 'success');
      return;
    }

    if (mode === 'document') {
      U.confirmBox({
        title: '替换整章正文',
        message: '本次改写使用整章作为输入，采纳后将用 AI 结果替换「' + act.title + '」的全部正文。是否继续？',
        okText: '替换'
      }).then((ok) => {
        if (!ok) return;
        const html = text.split(/\n+/).map(s => s.trim()).filter(Boolean)
          .map(s => '<p>' + U.escapeHtml(s) + '</p>').join('');
        Project.setActHtml(actId, html);
        if (window.Editor) window.Editor.loadAct(Project.getAct());
        markApplied();
        if (window.App) window.App.refreshStats();
        U.toast('已替换整章正文', 'success');
      });
      return;
    }

    if (window.Editor) window.Editor.replaceSelection(text);
    markApplied();
    if (window.App) window.App.refreshStats();
    U.toast('已采纳并写回正文', 'success');
  }

  function markApplied() {
    if (pending && pending.historyId) Project.updateHistory(pending.historyId, { applied: true, status: 'applied' });
    else if (currentHistoryId) Project.updateHistory(currentHistoryId, { applied: true, status: 'applied' });
    renderHistory();
    if (window.App) window.App.onDirtyChanged();
  }

  let currentHistoryId = null;

  /* 按大纲写下一节：一次性目标，用掉就清 */
  let outlineTarget = null;
  let outlineArmed = false;

  function discard() {
    if (currentHistoryId && !appliedTo(currentHistoryId)) {
      Project.updateHistory(currentHistoryId, { discarded: true, status: 'discarded' });
    }
    resultText = '';
    currentHistoryId = null;
    hidePanel();
    setStreaming(false);
    renderHistory();
    U.status('已放弃本次结果');
  }

  function appliedTo(id) {
    const p = Project.get();
    const item = (p.history || []).find(h => h.id === id);
    return !!(item && item.applied);
  }

  function saveHistory(status) {
    const meta = lastRequest && lastRequest.__meta;
    if (!meta) return;
    const act = Project.getAct(meta.actId);
    const item = Project.addHistory({
      actId: meta.actId,
      actTitle: act ? act.title : '',
      mode: meta.mode,
      prompt: meta.prompt,
      model: lastRequest.model,
      original: meta.original,
      result: resultText,
      status: status || 'done',
      applied: false,
      discarded: false
    });
    currentHistoryId = item.id;
    if (pending) pending.historyId = item.id;
    renderHistory();
  }

  /* ---------- 记录列表 ---------- */
  function renderHistory() {
    if (!els.history) return;
    const p = Project.get();
    const list = (p && p.history) ? p.history : [];
    els.history.innerHTML = '';
    if (!list.length) {
      els.history.appendChild(U.el('div', { class: 'history-empty', text: '还没有 AI 改写记录' }));
      return;
    }
    list.forEach((item) => {
      const preview = (item.result || item.original || '').replace(/\s+/g, ' ').slice(0, 80);
      const cls = 'h-body' + (item.applied ? ' applied' : (item.discarded ? ' discarded' : ''));
      const node = U.el('div', { class: 'history-item', 'data-id': item.id, title: item.prompt || '' }, [
        U.el('div', { class: 'h-top' }, [
          U.el('span', { text: U.formatTime(item.at) + ' · ' + (item.mode === 'document' ? '整章' : '选区') }),
          U.el('span', { text: (item.applied ? '已采纳' : (item.discarded ? '已放弃' : (item.model || ''))) })
        ]),
        U.el('div', { class: cls, text: preview || '（空）' })
      ]);
      els.history.appendChild(node);
    });
  }

  function loadHistoryItem(id) {
    const p = Project.get();
    const item = (p.history || []).find(h => h.id === id);
    if (!item) return;
    resultText = item.result || '';
    currentHistoryId = item.id;
    pending = { id: null, actId: item.actId, mode: item.mode, model: item.model, prompt: item.prompt, original: item.original, historyId: item.id };
    showPanel();
    setStatus('历史记录 · ' + U.formatTime(item.at));
    if (els.resultFoot) els.resultFoot.textContent = item.applied ? '该结果已采纳过' : (item.discarded ? '该结果已放弃' : '来自历史记录');
    renderText();
    setStreaming(false);
  }

  /* ---------- 参考图 ---------- */
  function ensureFileInput() {
    if (fileInput) return fileInput;
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) readImageFile(f);
      fileInput.value = '';
    });
    return fileInput;
  }

  function readImageFile(file) {
    if (!/^image\//.test(file.type)) { U.toast('请选择图片文件', 'warn'); return; }
    if (file.size > 6 * 1024 * 1024) { U.toast('图片超过 6MB，请压缩后再用', 'warn'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      refImage = { dataUrl: String(reader.result), name: file.name };
      if (els.refImage) els.refImage.src = refImage.dataUrl;
      if (els.refName) els.refName.textContent = file.name;
      if (els.refPreview) els.refPreview.classList.add('on');
      if (els.refEmpty) els.refEmpty.style.display = 'none';
      U.status('参考图已添加（需模型支持图片输入）');
    };
    reader.onerror = () => U.toast('读取图片失败', 'error');
    reader.readAsDataURL(file);
  }

  function clearImage() {
    refImage = null;
    if (els.refImage) els.refImage.removeAttribute('src');
    if (els.refPreview) els.refPreview.classList.remove('on');
    if (els.refEmpty) els.refEmpty.style.display = '';
    if (els.refName) els.refName.textContent = '参考图';
  }

  /* ---------- 模型下拉 ---------- */
  function syncModelSelect() {
    if (!els.model) return;
    const saved = (Store.get().api || {}).model || 'deepseek-chat';
    const opts = Array.from(els.model.options).map(o => o.value);
    if (opts.indexOf(saved) >= 0) {
      els.model.value = saved;
      return;
    }
    // 自定义模型：动态加一项
    let opt = els.model.querySelector('option[data-custom="1"]');
    if (!opt) {
      opt = document.createElement('option');
      opt.setAttribute('data-custom', '1');
      els.model.insertBefore(opt, els.model.querySelector('option[value="__custom__"]'));
    }
    opt.value = saved;
    opt.textContent = saved + '（自定义）';
    els.model.value = saved;
  }

  async function onModelChange() {
    const val = els.model.value;
    if (val === '__custom__') {
      syncModelSelect();
      if (window.SettingsPanel) window.SettingsPanel.open('ai');
      setTimeout(() => {
        const input = document.getElementById('apiModel');
        if (input) { input.focus(); input.select(); }
      }, 260);
      U.toast('在设置里填写自定义模型名后会自动同步到这里的下拉框', '', 4200);
      return;
    }
    await Store.patch({ api: Object.assign({}, Store.get().api, { model: val }) });
    if (window.App) window.App.refreshApiStatus();
  }

  /* ---------- 快捷标签 ---------- */
  function bindTags() {
    if (!els.tags) return;
    els.tags.addEventListener('click', (e) => {
      const tag = e.target.closest('.tag-btn');
      if (!tag) return;
      const text = tag.getAttribute('data-text') || '';
      if (tag.classList.contains('action-tag')) {
        els.prompt.value = text;
        run();
      } else {
        const cur = els.prompt.value.trim();
        els.prompt.value = cur ? cur + '\n' + text : text;
        els.prompt.focus();
      }
    });
  }

  /* ---------- 上下文动作 ---------- */
  const CTX_TEXT = {
    polish: '请润色这段文字，使语句通顺流畅，保持原意不变。',
    expand: '请扩写这段文字，增加更多细节描写与画面感。',
    condense: '请缩写这段文字，压缩到原来的六成左右，保留核心内容。',
    ai: ''
  };

  function runContextAction(kind) {
    if (kind === 'ai') { focusPrompt(); return; }
    const text = CTX_TEXT[kind];
    if (!text) return;
    if (!window.Editor || !window.Editor.getSelectionText()) {
      U.toast('请先在正文中选中要处理的文字', 'warn');
      return;
    }
    els.prompt.value = text;
    updateSelectionDisplay();
    run();
  }

  function focusPrompt() {
    updateSelectionDisplay();
    if (els.prompt) {
      els.prompt.focus();
      els.prompt.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    q();
    ensureBusyUI();
    if (window.Busy) window.Busy.onChange(refreshBusyUI);
    refreshBusyUI();
    window.api.onAiEvent(handleEvent);

    if (els.action) els.action.addEventListener('click', run);
    if (els.outlineWrite) els.outlineWrite.addEventListener('click', outlineWrite);
    if (els.stop) els.stop.addEventListener('click', stop);
    if (els.apply) els.apply.addEventListener('click', apply);
    if (els.discard) els.discard.addEventListener('click', discard);
    if (els.copy) els.copy.addEventListener('click', () => {
      if (!resultText) return;
      window.api.copyText(resultText);
      U.toast('已复制到剪贴板', 'success');
    });
    if (els.retry) els.retry.addEventListener('click', () => {
      if (!lastRequest) { U.toast('还没有可重试的请求', 'warn'); return; }
      run();
    });

    if (els.model) {
      els.model.addEventListener('change', onModelChange);
      syncModelSelect();
    }
    if (els.context) els.context.addEventListener('change', updateSelectionDisplay);

    bindTags();

    if (els.panel) {
      els.panel.addEventListener('click', () => updateSelectionDisplay());
    }

    // 参考图
    if (els.refBox) {
      els.refBox.addEventListener('click', (e) => {
        if (e.target.closest('#refRemove')) return;
        ensureFileInput().click();
      });
      els.refBox.addEventListener('dragover', (e) => { e.preventDefault(); els.refBox.classList.add('dragover'); });
      els.refBox.addEventListener('dragleave', () => els.refBox.classList.remove('dragover'));
      els.refBox.addEventListener('drop', (e) => {
        e.preventDefault();
        els.refBox.classList.remove('dragover');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) readImageFile(f);
      });
    }
    if (els.refRemove) {
      els.refRemove.addEventListener('click', (e) => { e.stopPropagation(); clearImage(); });
    }

    if (els.history) {
      els.history.addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        if (item) loadHistoryItem(item.getAttribute('data-id'));
      });
    }
    if (els.historyClear) {
      els.historyClear.addEventListener('click', async () => {
        const p = Project.get();
        if (!p || !p.history.length) return;
        const ok = await U.confirmBox({ title: '清空改写记录', message: '确定清空全部 AI 改写记录？此操作不可撤销。', okText: '清空', danger: true });
        if (!ok) return;
        Project.clearHistory();
        renderHistory();
        U.status('改写记录已清空');
      });
    }

    if (els.help) {
      els.help.addEventListener('click', () => {
        U.toast('用法：在正文中选中文字 → 写下改写要求或用快捷标签 → 点「立即调用 AI 改写」→ 结果满意后点「采纳」写回正文。未选中时会改写整章。', '', 7000);
      });
    }

    updateSelectionDisplay();
    renderHistory();
  }

  function onActChanged() {
    updateSelectionDisplay();
  }

  window.AIPanel = {
    init, run, stop, apply, discard, runContextAction, focusPrompt, outlineWrite,
    onActChanged, renderHistory, syncModelSelect, updateSelectionDisplay,
    _debug: function () {
      return pending ? {
        actId: pending.actId, mode: pending.mode,
        outline: pending.outlineTarget || null, kind: pending.kind || null
      } : null;
    }
  };
})();
