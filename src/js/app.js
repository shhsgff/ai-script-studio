/* ============================================================
   app.js —— 启动引导 / 菜单 / 快捷键 / 设置面板 / 文件与导出 / 状态栏
   ============================================================ */
(function () {
  'use strict';

  const U = window.U;
  const api = window.api;

  let appInfo = null;
  const els = {};

  let statsTimer = null;
  let titleTimer = null;
  let lastTitleSent = '';
  let quitting = false;

  /* ---------------- 元素缓存 ---------------- */
  function q() {
    els.topTitle = U.$('#topTitle');
    els.topSaveHint = U.$('#topSaveHint');
    els.btnQuickTheme = U.$('#btnQuickTheme');
    els.projectTitle = U.$('#projectTitle');

    els.actBody = U.$('#actBody');
    els.paper = U.$('#paper');
    els.editorArea = U.$('#editorArea');
    els.editorScroll = U.$('#editorScroll');

    els.statusWords = U.$('#statusWords');
    els.statusChars = U.$('#statusChars');
    els.statusActWords = U.$('#statusActWords');
    els.statusSave = U.$('#statusSave');
    els.statusApi = U.$('#statusApi');
    els.statusMessage = U.$('#statusMessage');

    els.settingsModal = U.$('#settingsModal');
    els.settingsTabs = U.$('#settingsTabs');
    els.modalHint = U.$('#modalHint');

    els.wallpaperStatus = U.$('#wallpaperStatus');
    els.pickWallpaper = U.$('#pickWallpaper');
    els.resetWallpaper = U.$('#resetWallpaper');
    els.wpOpacity = U.$('#wpOpacity');
    els.wpOpacityVal = U.$('#wpOpacityVal');
    els.wpBlur = U.$('#wpBlur');
    els.wpBlurVal = U.$('#wpBlurVal');

    els.fontFamily = U.$('#fontFamily');
    els.fontSize = U.$('#fontSize');
    els.fontSizeVal = U.$('#fontSizeVal');
    els.lineHeight = U.$('#lineHeight');
    els.lineHeightVal = U.$('#lineHeightVal');
    els.paraGap = U.$('#paraGap');
    els.paraGapVal = U.$('#paraGapVal');
    els.indent = U.$('#indent');
    els.indentVal = U.$('#indentVal');
    els.showRuler = U.$('#showRuler');

    els.apiBaseUrl = U.$('#apiBaseUrl');
    els.apiKey = U.$('#apiKey');
    els.toggleKey = U.$('#toggleKey');
    els.apiModel = U.$('#apiModel');
    els.apiTemp = U.$('#apiTemp');
    els.apiTempVal = U.$('#apiTempVal');
    els.apiMaxTokens = U.$('#apiMaxTokens');
    els.apiVision = U.$('#apiVision');
    els.apiSystemPrompt = U.$('#apiSystemPrompt');
    els.testApi = U.$('#testApi');
    els.testApiResult = U.$('#testApiResult');
    els.gwStatus = U.$('#gwStatus');
    els.gwBaseUrl = U.$('#gwBaseUrl');
    els.gwToken = U.$('#gwToken');
    els.gwToggle = U.$('#gwToggle');
    els.gwApply = U.$('#gwApply');
    els.gwCopy = U.$('#gwCopy');
    els.gwRotate = U.$('#gwRotate');
    els.gwRun = U.$('#gwRun');
    els.gwTest = U.$('#gwTest');
    els.gwHint = U.$('#gwHint');

    els.aboutVersion = U.$('#aboutVersion');
    els.aboutPaths = U.$('#aboutPaths');

    els.recentMenu = U.$('#recentMenu');
    els.countModal = U.$('#countModal');
    els.countTable = U.$('#countTable');
    els.splash = U.$('#splash');
    els.btnAiHelp = U.$('#btnAiHelp');

    // 多文档 / 两级目录 / 浮窗 / DSH
    els.tabBar = U.$('#tabBar');
    els.tabStrip = U.$('#tabStrip');
    els.btnNewTab = U.$('#btnNewTab');
    els.welcome = U.$('#welcome');
    els.welcomeRecent = U.$('#welcomeRecent');
    els.sidebarLeft = U.$('#sidebarLeft');
    els.sidebarRight = U.$('#sidebarRight');
    els.btnAddAct = U.$('#btnAddAct');
    els.btnDsh = U.$('#btnDsh');
    els.btnOutlineFloat = U.$('#btnOutlineFloat');
    els.outlineFloat = U.$('#outlineFloat');

    // DSH / MCP 设置
    els.dshStatus = U.$('#dshStatus');
    els.dshDetect = U.$('#dshDetect');
    els.dshTest = U.$('#dshTest');
    els.dshCommand = U.$('#dshCommand');
    els.dshMaxActs = U.$('#dshMaxActs');
    els.dshTestResult = U.$('#dshTestResult');
    els.mcpStatus = U.$('#mcpStatus');
    els.mcpToggle = U.$('#mcpToggle');
    els.mcpCopy = U.$('#mcpCopy');
    els.mcpConfig = U.$('#mcpConfig');
    els.mcpProfile = U.$('#mcpProfile');
    els.mcpRegister = U.$('#mcpRegister');
  els.mcpPluginInstall = U.$('#mcpPluginInstall');
  els.mcpPluginRemove = U.$('#mcpPluginRemove');
    els.mcpUnregister = U.$('#mcpUnregister');
    els.mcpRescan = U.$('#mcpRescan');
    els.mcpDshStatus = U.$('#mcpDshStatus');
    els.mcpDshPaths = U.$('#mcpDshPaths');
    els.mcpHint = U.$('#mcpHint');
  }

  /* ---------------- 三选一询问框 ---------------- */
  function askChoice(opts) {
    const o = opts || {};
    return new Promise(function (resolve) {
      const overlay = U.el('div', { class: 'modal-overlay show' });
      const content = U.el('div', { class: 'modal-content narrow' });
      const header = U.el('div', { class: 'modal-header' }, [
        U.el('h3', { text: o.title || '请选择' })
      ]);
      const body = U.el('div', { class: 'modal-body' }, [
        U.el('p', {
          text: o.message || '',
          style: 'font-size:13px;line-height:1.8;color:var(--text-muted);white-space:pre-wrap;'
        })
      ]);
      const footer = U.el('div', { class: 'modal-footer' });
      let settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); }
      }
      (o.buttons || [{ label: '确定', value: 'ok', primary: true }]).forEach(function (b) {
        const cls = 'mini-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
        const btn = U.el('button', { class: cls, type: 'button', text: b.label });
        btn.addEventListener('click', function () { done(b.value); });
        footer.appendChild(btn);
      });
      document.addEventListener('keydown', onKey, true);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) done('cancel'); });
      content.appendChild(header);
      content.appendChild(body);
      content.appendChild(footer);
      overlay.appendChild(content);
      document.body.appendChild(overlay);
      const first = footer.querySelector('.mini-btn.primary') || footer.querySelector('button');
      if (first) first.focus();
    });
  }

  /* ---------------- 状态栏 / 标题 ---------------- */
  function syncDirtyUI() {
    const p = Project.get();
    if (!p) {
      if (els.topTitle) els.topTitle.textContent = '践行';
      if (els.topSaveHint) { els.topSaveHint.textContent = ''; els.topSaveHint.classList.remove('dirty', 'saved'); }
      if (els.statusSave) {
        els.statusSave.textContent = '○ 没有打开的剧本';
        els.statusSave.classList.remove('dirty', 'ok');
        els.statusSave.title = '';
      }
      if (els.projectTitle) els.projectTitle.value = '';
      lastTitleSent = '';
      if (titleTimer) { clearTimeout(titleTimer); titleTimer = null; }
      if (api.setTitle) api.setTitle('');
      if (api.setDirty) api.setDirty(false);
      return;
    }
    const dirty = Project.isDirty();
    const fp = Project.getFilePath();
    const title = (p.meta && p.meta.title) || '未命名剧本';

    if (els.projectTitle && document.activeElement !== els.projectTitle) {
      els.projectTitle.value = title;
    }
    if (els.topTitle) els.topTitle.textContent = title + (dirty ? ' *' : '');

    if (els.topSaveHint) {
      els.topSaveHint.textContent = dirty ? '未保存' : (fp ? '已保存' : '新文件');
      els.topSaveHint.classList.toggle('dirty', dirty);
      els.topSaveHint.classList.toggle('saved', !dirty && !!fp);
    }
    if (els.statusSave) {
      els.statusSave.textContent = dirty ? '● 未保存' : (fp ? '● 已保存' : '○ 新文件');
      els.statusSave.classList.toggle('dirty', dirty);
      els.statusSave.classList.toggle('ok', !dirty && !!fp);
      els.statusSave.title = fp || '尚未保存到磁盘';
    }

    const newTitle = title + (dirty ? ' *' : '');
    if (newTitle !== lastTitleSent) {
      lastTitleSent = newTitle;
      if (titleTimer) clearTimeout(titleTimer);
      titleTimer = setTimeout(function () {
        titleTimer = null;
        if (api.setTitle) api.setTitle(lastTitleSent);
        if (window.Tabs) Tabs.refresh();
      }, 320);
    }
    if (api.setDirty) api.setDirty(dirty);
  }

  function refreshApiStatus() {
    if (!els.statusApi) return;
    const cfg = (Store.get() || {}).api || {};
    const key = (cfg.apiKey || '').trim();
    const ok = !!key;
    const isLocalGw = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(String(cfg.baseUrl || ''));
    const isAgent = (cfg.mode || 'direct') === 'agent';
    if (isAgent) {
      els.statusApi.textContent = '● 本地 Agent';
      els.statusApi.classList.add('ok');
      els.statusApi.classList.remove('bad');
      els.statusApi.title = 'AI 改写交给本机 dsh（可用 Skill），不需要 API Key';
      return;
    }
    els.statusApi.textContent = ok ? ('● ' + (cfg.model || 'deepseek-chat') + (isLocalGw ? ' · 本地' : '')) : '○ AI 未配置';
    els.statusApi.classList.toggle('ok', ok);
    els.statusApi.classList.toggle('bad', !ok);
    els.statusApi.title = ok
      ? (isLocalGw ? '通过本地网关调用本机 dsh：' : '已配置：') + (cfg.baseUrl || '') + ' / ' + (cfg.model || '')
      : '点击打开「设置 → AI 配置」填写 API Key，或把「模式」切成本地 AI Agent';
  }

  /* ---------------- 字数统计 ---------------- */
  function refreshStats(immediate) {
    if (immediate) {
      if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; }
      applyStats();
      return;
    }
    if (statsTimer) return;
    statsTimer = setTimeout(function () {
      statsTimer = null;
      applyStats();
    }, 120);
  }

  function applyStats() {
    const p = Project.get();
    if (!p) {
      if (els.statusWords) els.statusWords.textContent = '字数：0';
      if (els.statusChars) els.statusChars.textContent = '字符：0';
      if (els.statusActWords) els.statusActWords.textContent = '本章：0';
      if (rulerNode) rulerNode.style.display = 'none';
      if (window.Outline && Outline.updateFooter) Outline.updateFooter({ words: 0, chars: 0, acts: [], sections: 0 });
      return;
    }
    const st = Project.stats();
    if (els.statusWords) els.statusWords.textContent = '字数：' + U.formatNumber(st.words);
    if (els.statusChars) els.statusChars.textContent = '字符：' + U.formatNumber(st.chars);
    const act = Project.getAct();
    const cur = (st.acts || []).find(function (a) { return act && a.id === act.id; });
    if (els.statusActWords) els.statusActWords.textContent = '本章：' + U.formatNumber(cur ? cur.words : 0);
    Outline.updateFooter(st);
    updateRuler(st, cur);
  }

  /* ---------------- 字数标尺（浮动角标） ---------------- */
  let rulerNode = null;
  function updateRuler(st, curAct) {
    const ui = (Store.get() || {}).ui || {};
    const show = ui.showRuler !== false;
    if (!show) {
      if (rulerNode) rulerNode.style.display = 'none';
      return;
    }
    if (!rulerNode) {
      rulerNode = U.el('div', { class: 'word-ruler' });
      const host = els.editorArea || document.body;
      host.appendChild(rulerNode);
    }
    rulerNode.style.display = '';
    rulerNode.textContent = '全篇 ' + U.formatNumber(st.words) + ' 字 · 本章 ' + U.formatNumber(curAct ? curAct.words : 0) + ' 字';
  }

  function applyRulerVisibility() {
    const ui = (Store.get() || {}).ui || {};
    const on = ui.showRuler !== false;
    if (rulerNode) rulerNode.style.display = on ? '' : 'none';
    if (on) refreshStats(true);
  }

  /* ---------------- 文件操作（多文档标签） ---------------- */
  async function guardUnsaved(doc) {
    const target = doc || Workspace.active();
    if (!target) return true;
    Workspace.syncActive();
    if (!target.dirty) return true;
    const cur = Workspace.active();
    if (cur && cur.id !== target.id) Workspace.activate(target.id);
    const choice = await askChoice({
      title: '有未保存的修改',
      message: '「' + (target.title || '未命名剧本') + '」还有未保存的修改，是否先保存？',
      buttons: [
        { label: '保存', value: 'save', primary: true },
        { label: '不保存', value: 'discard' },
        { label: '取消', value: 'cancel' }
      ]
    });
    if (choice === 'save') return await saveProject(false);
    return choice === 'discard';
  }

  /** 退出前统一确认所有未保存的文档 */
  async function guardAllDocs() {
    const dirty = Workspace.dirtyDocs();
    if (!dirty.length) return true;
    if (dirty.length === 1) return await guardUnsaved(dirty[0]);
    const choice = await askChoice({
      title: '还有 ' + dirty.length + ' 个剧本未保存',
      message: '下列剧本有未保存的修改：\n' + dirty.map(function (d) { return '· ' + (d.title || '未命名剧本'); }).join('\n'),
      buttons: [
        { label: '全部保存', value: 'save', primary: true },
        { label: '全部不保存', value: 'discard' },
        { label: '取消', value: 'cancel' }
      ]
    });
    if (choice === 'discard') return true;
    if (choice !== 'save') return false;
    for (const d of dirty.slice()) {
      if (!Workspace.getById(d.id)) continue;
      Workspace.activate(d.id);
      const ok = await saveProject(false);
      if (!ok) return false;
    }
    return true;
  }

  async function saveProject(saveAs) {
    const p = Project.get();
    if (!p) return false;
    if (window.Editor && Editor.flushSnapshot) Editor.flushSnapshot();
    const obj = Project.toSaveObject();
    let res;
    try {
      if (saveAs || !Project.getFilePath()) {
        res = await api.saveProjectAs(obj, p.meta.title || '未命名剧本');
      } else {
        res = await api.saveProject(Project.getFilePath(), obj);
      }
    } catch (err) {
      U.toast('保存失败：' + (err && err.message ? err.message : err), 'error');
      return false;
    }
    if (!res || res.canceled) {
      if (res && res.error) U.toast(res.error, 'error');
      return false;
    }
    Project.markSaved(res.filePath);
    Workspace.markActiveSaved(res.filePath);
    syncDirtyUI();
    if (window.Tabs) Tabs.refresh();
    saveSessionSoon();
    try { await api.autosaveClear(); } catch (e) { /* ignore */ }
    api.backup(obj, p.meta.title || '未命名剧本').catch(function () { });
    U.toast('已保存：' + res.filePath, 'success');
    return true;
  }

  /** 新建剧本：开一个新标签（此时才出现剧本目录） */
  function newProject(opts) {
    const o = opts || {};
    const model = Project.createDefault(o.title || '未命名剧本');
    if (o.summary) model.meta.summary = String(o.summary).slice(0, 200);
    const doc = Workspace.create(model, null, { dirty: !!o.dirty, activate: true });
    U.status('新建剧本「' + doc.title + '」');
    setTimeout(function () {
      if (o.focusTitle !== false && els.projectTitle) {
        els.projectTitle.focus();
        els.projectTitle.select();
      }
    }, 60);
    return doc;
  }

  /** 打开/导入得到的内容 → 新标签 */
  function adoptDocument(model, filePath, opts) {
    const o = opts || {};
    if (filePath) {
      const exist = Workspace.findByPath(filePath);
      if (exist) {
        Workspace.activate(exist.id);
        U.toast('「' + exist.title + '」已经在标签里了');
        return exist;
      }
    }
    const doc = Workspace.create(Project.normalize(model), filePath || null, {
      dirty: o.dirty !== false && !filePath,
      activate: true
    });
    if (filePath) {
      doc.title = (doc.model.meta && doc.model.meta.title) || doc.title;
      if (window.Tabs) Tabs.refresh();
    }
    return doc;
  }

  function applyOpened(res) {
    adoptDocument(res.project, res.filePath);
    U.toast('已打开：' + res.filePath, 'success');
  }

  async function openProject() {
    const res = await api.openProject();
    if (!res || res.canceled) {
      if (res && res.error) U.toast(res.error, 'error');
      return;
    }
    applyOpened(res);
  }

  async function openProjectPath(path) {
    if (!path) return;
    const res = await api.openProjectPath(path);
    if (!res || res.canceled) {
      if (res && res.error) U.toast(res.error, 'error');
      return;
    }
    applyOpened(res);
  }

  /* ---------------- 关闭标签 ---------------- */
  async function closeDoc(id) {
    const doc = Workspace.getById(id);
    if (!doc) return true;
    const cur = Workspace.active();
    if (cur && cur.id !== id) {
      Workspace.activate(id);
      if (window.Editor) Editor.flushSnapshot();
      Workspace.syncActive();
    }
    const ok = await guardUnsaved(Workspace.getById(id));
    if (!ok) return false;
    Workspace.remove(id);
    if (!Workspace.count()) refreshAll('所有剧本都已关闭');
    return true;
  }

  async function closeOtherDocs(keepId) {
    const id = keepId || Workspace.getActiveId();
    const others = Workspace.list().filter(function (d) { return d.id !== id; });
    for (const d of others) {
      if (!Workspace.getById(d.id)) continue;
      const ok = await closeDoc(d.id);
      if (!ok) break;
    }
    if (id && Workspace.getById(id)) Workspace.activate(id);
    return true;
  }

  async function closeAllDocs() {
    const all = Workspace.list().slice();
    for (const d of all) {
      if (!Workspace.getById(d.id)) continue;
      const ok = await closeDoc(d.id);
      if (!ok) break;
    }
    return true;
  }

  /* ---------------- 导入外部文本 / Markdown ---------------- */
  function textToHtml(text) {
    const blocks = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/);
    const out = [];
    blocks.forEach(function (block) {
      const t = block.replace(/[ \t]+\n/g, '\n').trim();
      if (!t) return;
      const lines = t.split('\n').map(function (l) { return U.escapeHtml(l.trim()); }).filter(Boolean);
      if (!lines.length) return;
      out.push('<p>' + lines.join('<br>') + '</p>');
    });
    return out.join('') || '<p><br></p>';
  }

  function newActObject(title, html) {
    return { id: U.uid('act'), title: title, html: html || '<p><br></p>' };
  }

  function splitMarkdown(content) {
    const lines = String(content).replace(/\r\n/g, '\n').split('\n');
    const acts = [];
    let curTitle = null;
    let buf = [];
    function flush() {
      const text = buf.join('\n').trim();
      if (curTitle === null && !text) return;
      acts.push(newActObject(curTitle || '正文', textToHtml(text)));
      buf = [];
    }
    lines.forEach(function (line) {
      const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
      if (m) {
        flush();
        curTitle = m[2].trim();
      } else {
        buf.push(line);
      }
    });
    flush();
    return acts;
  }

  /* 从 HTML 文档里抽取段落 / 标题，尽量还原章节 */
  function splitHtml(content) {
    let doc = null;
    try {
      doc = new DOMParser().parseFromString(String(content), 'text/html');
    } catch (e) {
      doc = null;
    }
    if (!doc || !doc.body) return [];
    ['script', 'style', 'noscript', 'nav', 'footer', 'iframe'].forEach(function (tag) {
      Array.prototype.slice.call(doc.body.querySelectorAll(tag)).forEach(function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
    });
    const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre';
    const all = Array.prototype.slice.call(doc.body.querySelectorAll(BLOCK));
    const acts = [];
    let curTitle = null;
    let buf = [];
    function blockText(el) {
      const clone = el.cloneNode(true);
      Array.prototype.slice.call(clone.querySelectorAll('br')).forEach(function (br) {
        br.parentNode.replaceChild(doc.createTextNode('\n'), br);
      });
      return String(clone.textContent || '').replace(/\u00a0/g, ' ').trim();
    }
    function flush() {
      const text = buf.join('\n\n').trim();
      if (curTitle === null && !text) return;
      acts.push(newActObject(curTitle || '正文', textToHtml(text)));
      buf = [];
    }
    all.forEach(function (el) {
      if (el.parentElement && el.parentElement.closest(BLOCK)) return;
      const text = blockText(el);
      if (!text) return;
      if (/^H[1-6]$/.test(el.tagName)) {
        flush();
        curTitle = text.slice(0, 60);
      } else {
        buf.push(text);
      }
    });
    flush();
    if (!acts.length) {
      const plain = String(doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
      if (plain) acts.push(newActObject('正文', textToHtml(plain)));
    }
    return acts;
  }

  const CHAPTER_RE = /^\s*(?:第\s*[一二三四五六七八九十百千零〇0-9]+\s*[幕章节回卷]|序章|楔子|尾声|番外)[^\n]{0,40}$/;

  function splitPlain(content) {
    const lines = String(content).replace(/\r\n/g, '\n').split('\n');
    const chapters = [];
    let cur = null;
    lines.forEach(function (line) {
      const trimmed = line.trim();
      if (CHAPTER_RE.test(trimmed) && trimmed.length <= 44) {
        if (cur) chapters.push(cur);
        cur = { title: trimmed, buf: [] };
      } else {
        if (!cur) cur = { title: '正文', buf: [] };
        cur.buf.push(line);
      }
    });
    if (cur) chapters.push(cur);
    const acts = chapters
      .map(function (c) { return newActObject(c.title, textToHtml(c.buf.join('\n'))); })
      .filter(function (a) { return a.html !== '<p><br></p>'; });
    if (!acts.length) acts.push(newActObject('正文', textToHtml(content)));
    return acts;
  }

  async function importDocument() {
    let res;
    try {
      res = await api.importText();
    } catch (err) {
      U.toast('导入失败：' + (err && err.message ? err.message : err), 'error');
      return;
    }
    if (!res || res.canceled) {
      if (res && res.error) U.toast(res.error, 'error');
      return;
    }
    const name = res.name || '导入稿件.txt';
    const ext = String(res.ext || (name.split('.').pop() || '')).toLowerCase();
    const base = (res.base || name.replace(/\.[a-z0-9]{1,8}$/i, '')).trim() || '导入稿件';
    let acts;
    if (ext === 'md' || ext === 'markdown') acts = splitMarkdown(res.content);
    else if (ext === 'html' || ext === 'htm') acts = splitHtml(res.content);
    else acts = splitPlain(res.content);
    if (!acts.length) { U.toast('这个文件里没有可导入的文本', 'warn'); return; }
    const proj = Project.createDefault(base);
    proj.meta.title = base;
    proj.acts = acts;
    proj.activeActId = acts[0].id;
    proj.history = [];
    const doc = Workspace.create(proj, null, { dirty: true, activate: true });
    U.toast('已导入 ' + acts.length + ' 个章节到「' + doc.title + '」，记得保存', 'success');
  }

  /* ---------------- 导出 ---------------- */
  async function doExport(kind) {
    if (window.Editor && Editor.flushSnapshot) Editor.flushSnapshot();
    const payload = Project.toExportPayload();
    if (!payload || !payload.acts || !payload.acts.length) {
      U.toast('没有可导出的内容', 'warn');
      return;
    }
    U.status('正在导出…', true);
    let res;
    try {
      const fn = kind === 'docx' ? api.exportDocx : (kind === 'pdf' ? api.exportPdf : api.exportTxt);
      res = await fn(payload);
    } catch (err) {
      U.status('');
      U.toast('导出失败：' + (err && err.message ? err.message : err), 'error');
      return;
    }
    U.status('');
    if (!res || res.canceled) {
      if (res && res.error) U.toast(res.error, 'error');
      return;
    }
    U.toast('已导出：' + res.filePath, 'success');
    if (api.showItemInFolder && res.filePath) api.showItemInFolder(res.filePath);
  }

  async function requestExit() {
    if (quitting) return;
    quitting = true;
    try {
      const ok = await guardAllDocs();
      if (!ok) { quitting = false; return; }
      try { await api.autosaveClear(); } catch (e) { }
      await api.forceQuit();
    } catch (err) {
      quitting = false;
      U.toast('退出失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  /* ---------------- 编辑菜单动作 ---------------- */
  function selectAllChapter() {
    const body = els.actBody;
    if (!body) return;
    const range = document.createRange();
    range.selectNodeContents(body);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    body.focus();
  }

  async function copyAllChapter() {
    const act = Project.getAct();
    if (!act) return;
    const text = Project.htmlToText(act.html).trim();
    if (!text) { U.toast('当前章节还没有内容', 'warn'); return; }
    if (api.copyText) await api.copyText(text);
    U.toast('已复制「' + act.title + '」全文', 'success');
  }

  function clearFormat() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { U.toast('请先选中要清除格式的文字', 'warn'); return; }
    const text = sel.toString();
    if (!text.trim()) { U.toast('请先选中要清除格式的文字', 'warn'); return; }
    if (window.Editor) Editor.replaceSelection(text);
    U.toast('已清除所选文字的格式', 'success');
  }

  /* ---------------- 字数统计弹窗 ---------------- */
  function openCountModal() {
    const p = Project.get();
    if (!p || !els.countModal) return;
    if (window.Editor && Editor.flushSnapshot) Editor.flushSnapshot();
    const st = Project.stats();
    const table = els.countTable;
    table.innerHTML = '';
    const head = U.el('tr', {}, [
      U.el('td', { text: '章节' }),
      U.el('td', { text: '字数' })
    ]);
    table.appendChild(head);
    (st.acts || []).forEach(function (a) {
      table.appendChild(U.el('tr', {}, [
        U.el('td', { text: a.title, style: 'max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }),
        U.el('td', { text: U.formatNumber(a.words) })
      ]));
    });
    table.appendChild(U.el('tr', { class: 'total' }, [
      U.el('td', { text: '合计 · 共 ' + (st.acts || []).length + ' 章' }),
      U.el('td', { text: U.formatNumber(st.words) })
    ]));
    table.appendChild(U.el('tr', { class: 'total' }, [
      U.el('td', { text: '字符数（含标点）' }),
      U.el('td', { text: U.formatNumber(st.chars) })
    ]));
    els.countModal.classList.add('show');
  }

  function closeCountModal() {
    if (els.countModal) els.countModal.classList.remove('show');
  }

  /* ---------------- 菜单 ---------------- */
  function closeMenus() {
    U.$$('.dropdown').forEach(function (d) { d.classList.remove('show'); });
    U.$$('.menu-btn').forEach(function (b) { b.classList.remove('active'); });
  }

  function bindMenus() {
    const btns = U.$$('.menu-btn');
    function showFor(btn) {
      const dd = document.getElementById(btn.getAttribute('data-menu'));
      if (!dd) return;
      closeMenus();
      dd.classList.add('show');
      btn.classList.add('active');
    }
    btns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const dd = document.getElementById(btn.getAttribute('data-menu'));
        if (!dd) return;
        const open = dd.classList.contains('show');
        closeMenus();
        if (!open) showFor(btn);
      });
      btn.addEventListener('mouseenter', function () {
        if (U.$$('.dropdown.show').length) showFor(btn);
      });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.dropdown') && !e.target.closest('.menu-btn')) closeMenus();
    });
    window.addEventListener('blur', closeMenus);

    U.$$('.dropdown-item[data-action]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const action = item.getAttribute('data-action');
        closeMenus();
        dispatch(action, item);
      });
    });

    if (els.btnQuickTheme) {
      els.btnQuickTheme.addEventListener('click', function () { Store.toggleTheme(); });
    }
    if (els.btnAiHelp) {
      els.btnAiHelp.addEventListener('click', function () { SettingsPanel.open('ai'); });
    }
    if (els.statusApi) {
      els.statusApi.style.cursor = 'pointer';
      els.statusApi.addEventListener('click', function () { SettingsPanel.open('ai'); });
    }
  }

  function dispatch(action, src) {
    try {
      switch (action) {
        case 'file:new': newProject(); break;
        case 'file:open': openProject(); break;
        case 'file:import': importDocument(); break;
        case 'file:save': saveProject(false); break;
        case 'file:saveAs': saveProject(true); break;
        case 'export:docx': doExport('docx'); break;
        case 'export:pdf': doExport('pdf'); break;
        case 'export:txt': doExport('txt'); break;
        case 'app:exit': requestExit(); break;
        case 'edit:undo': Editor.undo(); break;
        case 'edit:redo': Editor.redo(); break;
        case 'edit:find': Find.open(); break;
        case 'edit:count': openCountModal(); break;
        case 'edit:selectAll': selectAllChapter(); break;
        case 'edit:copyAll': copyAllChapter(); break;
        case 'edit:clearFormat': clearFormat(); break;
        case 'settings:open': SettingsPanel.open(src && src.getAttribute('data-tab')); break;
        case 'theme:toggle': Store.toggleTheme(); break;
        case 'view:outlineFloat':
          if (window.OutlineFloat) OutlineFloat.toggle();
          break;
        case 'dsh:generate':
          if (window.DshGen) DshGen.open();
          break;
        case 'doc:close':
          if (Workspace.count()) closeDoc(Workspace.getActiveId());
          break;
        case 'doc:newDsh':
          if (window.DshGen) DshGen.open();
          break;
        default: break;
      }
    } catch (err) {
      console.error('[dispatch]', action, err);
      U.toast('操作失败：' + (err && err.message ? err.message : err), 'error');
    }
  }

  /* ---------------- 快捷键 ---------------- */
  function isTextField(node) {
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (node.isContentEditable) return node.id !== 'actBody' && node.id !== 'actTitle';
    return false;
  }

  function bindShortcuts() {
    window.addEventListener('keydown', function (e) {
      const mod = e.ctrlKey || e.metaKey;
      const key = (e.key || '').toLowerCase();
      const field = isTextField(e.target);

      if (mod && e.shiftKey && key === 'enter') { e.preventDefault(); AIPanel.apply(); return; }
      if (mod && !e.shiftKey && key === 'enter') { e.preventDefault(); AIPanel.run(); return; }

      if (mod && e.altKey && !e.shiftKey) {
        if (key === 'w') { e.preventDefault(); doExport('docx'); return; }
        if (key === 'p') { e.preventDefault(); doExport('pdf'); return; }
        if (key === 't') { e.preventDefault(); doExport('txt'); return; }
      }

      if (mod && e.shiftKey && !e.altKey) {
        if (key === 's') { e.preventDefault(); saveProject(true); return; }
        if (key === 'z') { if (field) return; e.preventDefault(); Editor.redo(); return; }
        if (key === 'c') { e.preventDefault(); copyAllChapter(); return; }
        if (key === 'l') { e.preventDefault(); Store.toggleTheme(); return; }
        if (key === 'o') { e.preventDefault(); if (window.OutlineFloat) OutlineFloat.toggle(); return; }
        if (key === 'g') { e.preventDefault(); if (window.DshGen) DshGen.open(); return; }
      }

      if (mod && !e.shiftKey && !e.altKey) {
        if (key === 'n') { e.preventDefault(); newProject(); return; }
        if (key === 'o') { e.preventDefault(); openProject(); return; }
        if (key === 'i') { e.preventDefault(); importDocument(); return; }
        if (key === 's') { e.preventDefault(); saveProject(false); return; }
        if (key === 'f') { e.preventDefault(); Find.open(); return; }
        if (key === 'h') {
          e.preventDefault();
          Find.open();
          const ri = U.$('#replaceInput');
          if (ri) setTimeout(function () { ri.focus(); ri.select(); }, 60);
          return;
        }
        if (key === 'z') { if (field) return; e.preventDefault(); Editor.undo(); return; }
        if (key === 'y') { if (field) return; e.preventDefault(); Editor.redo(); return; }
        if (key === 'a') { if (field) return; return; }
        if (key === 'w') {
          if (!Workspace.count()) return;
          e.preventDefault();
          closeDoc(Workspace.getActiveId());
          return;
        }
      }

      if (e.key === 'Escape') {
        if (els.settingsModal && els.settingsModal.classList.contains('show')) { SettingsPanel.close(); return; }
        if (els.countModal && els.countModal.classList.contains('show')) { closeCountModal(); return; }
        if (U.$$('.dropdown.show').length) { closeMenus(); return; }
        if (Find.isOpen()) { Find.close(); return; }
      }
    });
  }

  /* ---------------- 设置面板 ---------------- */
  const FONT_STACKS = {
    'Microsoft YaHei, PingFang SC, sans-serif': '微软雅黑（默认）',
    'SimSun, "Songti SC", serif': '宋体 / 思源宋体',
    'KaiTi, "Kaiti SC", STKaiti, serif': '楷体',
    'FangSong, "FangSong_GB2312", serif': '仿宋',
    'Consolas, "Cascadia Code", "Courier New", monospace': '等宽（代码风）'
  };

  /* ---------------- 本地 AI 网关（用本机 dsh 驱动，不需要外部 Key） ---------------- */
  let gwState = null;
  let gwBusy = false;

  function setGwStatus(text, cls) {
    if (!els.gwStatus) return;
    els.gwStatus.textContent = text;
    els.gwStatus.className = 'gateway-status' + (cls ? ' ' + cls : '');
  }

  function setGwHint(text, cls) {
    if (!els.gwHint) return;
    els.gwHint.textContent = text || '';
    els.gwHint.className = 'setting-desc' + (cls ? ' ' + cls : '');
  }

  function setGatewayUI(st) {
    gwState = st || {};
    const running = !!(st && st.running);
    if (els.gwBaseUrl) els.gwBaseUrl.value = (st && st.baseUrl) || ('http://127.0.0.1:' + ((st && st.port) || 45872) + '/v1');
    if (els.gwToken) els.gwToken.value = (st && st.token) || '';
    if (els.gwRun) els.gwRun.textContent = running ? '关闭网关' : '开启网关';
    if (els.gwApply) els.gwApply.disabled = !running;
    if (els.gwCopy) els.gwCopy.disabled = !running;
    if (els.gwTest) els.gwTest.disabled = !running;
    if (!running) {
      setGwStatus(st && st.enabled ? '○ 网关没有运行（可能端口被占用，或刚被关闭）' : '○ 网关已关闭（可以在上面开启）', 'bad');
      return;
    }
    setGwStatus('✓ 网关运行中 · ' + ((st && st.baseUrl) || '') + ' · 后端 ' + ((st && st.dshCommand) || 'dsh'), 'ok');
  }

  async function refreshGateway() {
    if (!api || !api.gatewayStatus) return;
    try {
      setGatewayUI(await api.gatewayStatus());
    } catch (e) {
      setGwStatus('✗ 读取网关状态失败：' + ((e && e.message) || e), 'bad');
    }
  }

  /* 把网关地址与本地密钥写进「服务接口」配置 */
  async function applyGatewayToConfig() {
    const res = await api.gatewayApply();
    if (!res || !res.ok) {
      setGwHint('✗ ' + ((res && (res.message || res.error)) || '写入失败'), 'bad');
      return false;
    }
    const cur = (Store.get() || {}).api || {};
    await Store.patch({
      api: Object.assign({}, cur, {
        baseUrl: res.api.baseUrl,
        apiKey: res.api.apiKey,
        model: res.api.model
      })
    });
    if (els.apiBaseUrl) els.apiBaseUrl.value = res.api.baseUrl || '';
    if (els.apiKey) els.apiKey.value = res.api.apiKey || '';
    if (els.apiModel) els.apiModel.value = res.api.model || '';
    if (window.AIPanel && AIPanel.syncModelSelect) AIPanel.syncModelSelect();
    refreshApiStatus();
    return true;
  }


  /* 一键预设：把常用的接口配置写好，用户只需补 Key 或模型名 */
  const API_PRESETS = {
    deepseek: { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    gateway: { label: '本机 DSH 网关', gateway: true },
    ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: '', apiKey: 'ollama' },
    lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', model: '', apiKey: 'lm-studio' }
  };

  async function applyApiPreset(name) {
    const preset = API_PRESETS[name];
    if (!preset) return;
    if (preset.gateway) {
      const ok = await applyGatewayToConfig();
      if (ok) U.toast('已切到「本机 DSH 网关」，不需要外面的 Key', 'success');
      return;
    }
    const cur = (Store.get() || {}).api || {};
    const next = Object.assign({}, cur, {
      baseUrl: preset.baseUrl,
      model: preset.model || cur.model || '',
      mode: 'direct',
      preset: name
    });
    if (preset.apiKey) next.apiKey = preset.apiKey;
    await Store.patch({ api: next });
    if (els.apiBaseUrl) els.apiBaseUrl.value = next.baseUrl || '';
    if (els.apiModel) els.apiModel.value = next.model || '';
    if (els.apiKey) els.apiKey.value = next.apiKey || '';
    if (window.AIPanel && AIPanel.syncModelSelect) AIPanel.syncModelSelect();
    if (window.Skills) { try { Skills.syncModeSelect(); } catch (e) { /* ignore */ } }
    refreshApiStatus();
    U.toast('已切到「' + preset.label + '」' + (preset.model ? '' : '，点「探测本地模型」可自动挑一个模型名'), 'success');
  }

  function renderProbeResult(res) {
    const box = U.$('#probeResult');
    const list = U.$('#probeList');
    const endpoints = (res && res.endpoints) || [];
    const hit = endpoints.filter(function (e) { return e && e.ok; });
    if (box) {
      box.textContent = hit.length
        ? ('✓ 发现 ' + hit.length + ' 个可用的本地服务：' + hit.map(function (e) { return e.label; }).join('、') + '（点下面任意一条直接套用）')
        : '✗ 没发现本地模型服务。装了 Ollama / LM Studio 的话先启动它们，再点一次「探测本地模型」。';
      box.className = 'test-result ' + (hit.length ? 'ok' : 'bad');
    }
    if (!list) return;
    list.innerHTML = '';
    endpoints.forEach(function (ep) {
      const row = U.el('div', { class: 'probe-item' + (ep.ok ? ' on' : '') }, [
        U.el('div', { class: 'pi-main' }, [
          U.el('div', { class: 'pi-name', text: ep.label + (ep.ok ? '' : '（未启动）') }),
          U.el('div', { class: 'pi-url', text: ep.baseUrl + (ep.ok && ep.models && ep.models.length ? ' · 模型：' + ep.models.slice(0, 4).join('、') : '') }),
          ep.ok ? null : U.el('div', { class: 'pi-bad', text: ep.message || '连接不上' })
        ])
      ]);
      if (ep.ok) {
        row.title = '点击套用这条本地服务';
        row.addEventListener('click', async function () {
          const cur = (Store.get() || {}).api || {};
          const next = Object.assign({}, cur, {
            baseUrl: ep.baseUrl,
            apiKey: ep.apiKey || 'local',
            mode: 'direct',
            preset: 'local'
          });
          if (ep.models && ep.models.length) next.model = ep.models[0];
          await Store.patch({ api: next });
          if (els.apiBaseUrl) els.apiBaseUrl.value = next.baseUrl || '';
          if (els.apiKey) els.apiKey.value = next.apiKey || '';
          if (els.apiModel) els.apiModel.value = next.model || '';
          if (window.AIPanel && AIPanel.syncModelSelect) AIPanel.syncModelSelect();
          if (window.Skills) { try { Skills.syncModeSelect(); } catch (e) { /* ignore */ } }
          refreshApiStatus();
          U.toast('已套用 ' + ep.label + (next.model ? ' · ' + next.model : ''), 'success');
        });
      }
      list.appendChild(row);
    });
    list.hidden = false;
  }

  function bindGatewaySettings() {
    if (!api || !api.gatewayStatus) return;

    if (els.gwToggle) {
      els.gwToggle.addEventListener('click', function () {
        const input = els.gwToken;
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        els.gwToggle.textContent = show ? '隐藏' : '显示';
      });
    }

    if (els.gwApply) {
      els.gwApply.addEventListener('click', async function () {
        const ok = await applyGatewayToConfig();
        if (ok) {
          setGwHint('✓ 已把网关地址与本地密钥填进下面的「服务接口」，现在「AI 改写」走的是本机 dsh。', 'ok');
          U.toast('已填入本地网关配置', 'success');
        }
      });
    }

    if (els.gwCopy) {
      els.gwCopy.addEventListener('click', async function () {
        if (!gwState || !gwState.token) return;
        await api.copyText(gwState.token);
        setGwHint('✓ 已复制本地密钥：' + gwState.token, 'ok');
        U.toast('本地密钥已复制', 'success');
      });
    }

    if (els.gwRotate) {
      els.gwRotate.addEventListener('click', async function () {
        if (gwBusy) return;
        gwBusy = true;
        els.gwRotate.disabled = true;
        const oldText = els.gwRotate.textContent;
        els.gwRotate.textContent = '生成中…';
        try {
          const res = await api.gatewayRotate();
          if (res && res.ok) {
            setGatewayUI(res.status);
            const cur = ((Store.get() || {}).api || {});
            if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(String(cur.baseUrl || ''))) {
              await applyGatewayToConfig();
            }
            setGwHint('✓ 已生成新的本地密钥（旧密钥立即失效）。需要的话点「填入下面的 AI 配置」。', 'ok');
            U.toast('已重新生成本地密钥', 'success');
          } else {
            setGwHint('✗ ' + ((res && res.error) || '生成失败'), 'bad');
          }
        } finally {
          gwBusy = false;
          els.gwRotate.disabled = false;
          els.gwRotate.textContent = oldText || '重新生成密钥';
        }
      });
    }

    if (els.gwRun) {
      els.gwRun.addEventListener('click', async function () {
        if (gwBusy) return;
        gwBusy = true;
        const wasRunning = !!(gwState && gwState.running);
        els.gwRun.disabled = true;
        els.gwRun.textContent = '处理中…';
        try {
          const res = wasRunning ? await api.gatewayDisable() : await api.gatewayEnable();
          if (res && res.ok) {
            setGatewayUI(res.status);
            if (!wasRunning) {
              await applyGatewayToConfig();
              setGwHint('✓ 网关已开启，并已填进下面的「服务接口」。', 'ok');
            } else {
              setGwHint('网关已关闭。下面的「服务接口」仍保留原地址，可以改成你自己买的 API。');
            }
            U.toast(wasRunning ? '本地网关已关闭' : '本地网关已开启', 'success');
            await refreshGateway();
          } else {
            setGwHint('✗ ' + ((res && res.error) || '操作失败'), 'bad');
          }
        } finally {
          gwBusy = false;
          els.gwRun.disabled = false;
          els.gwRun.textContent = (gwState && gwState.running) ? '关闭网关' : '开启网关';
        }
      });
    }

    if (els.gwTest) {
      els.gwTest.addEventListener('click', async function () {
        if (gwBusy) return;
        gwBusy = true;
        els.gwTest.disabled = true;
        const oldText = els.gwTest.textContent;
        els.gwTest.textContent = '测试中…';
        setGwHint('正在通过网关调用本机 dsh（首次可能要十几秒）…');
        try {
          const res = await api.gatewayTest();
          if (res && res.ok) setGwHint('✓ ' + res.message, 'ok');
          else setGwHint('✗ ' + ((res && res.message) || '未知错误'), 'bad');
        } catch (e) {
          setGwHint('✗ ' + ((e && e.message) || e), 'bad');
        } finally {
          gwBusy = false;
          els.gwTest.disabled = false;
          els.gwTest.textContent = oldText || '测试网关';
        }
      });
    }
  }

  const SettingsPanel = {
    open: function (tab) {
      if (!els.settingsModal) return;
      this.refresh();
      this.switchTab(tab || 'appearance');
      els.settingsModal.classList.add('show');
    },
    close: function () {
      if (els.settingsModal) els.settingsModal.classList.remove('show');
    },
    switchTab: function (tab) {
      if (!els.settingsTabs) return;
      U.$$('.modal-tab', els.settingsTabs).forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === tab);
      });
      U.$$('.tab-panel', els.settingsModal).forEach(function (p) {
        p.classList.toggle('active', p.getAttribute('data-panel') === tab);
      });
      if (els.modalHint) {
        els.modalHint.textContent = tab === 'ai'
          ? '接口地址填到 /v1 即可，程序会自动补全 /chat/completions'
          : (tab === 'appearance' ? '所有设置会立即保存并在下次启动时恢复'
            : (tab === 'dsh' ? 'DSH 生成用于「关键词 → 剧本」；MCP 让 DSH 反过来写进本软件' : ''));
      }
      if (tab === 'ai') refreshGateway();
      if (tab === 'dsh') {
        if (!dshDetecting) detectDsh(false);
        refreshMcpStatus();
      }
    },
    refresh: function () {
      const s = Store.get() || {};
      const wp = s.wallpaper || {};
      const font = s.font || {};
      const apiCfg = s.api || {};
      const ui = s.ui || {};

      if (els.wallpaperStatus) {
        els.wallpaperStatus.textContent = wp.type === 'video'
          ? ('当前：视频壁纸 · ' + (wp.file || wp.url || ''))
          : (wp.type === 'image'
            ? ('当前：图片壁纸 · ' + (wp.file || wp.url || ''))
            : '当前：纯色背景');
      }
      const shade = Math.round((1 - (Number.isFinite(wp.opacity) ? wp.opacity : 1)) * 100);
      if (els.wpOpacity) els.wpOpacity.value = String(U.clamp(shade, 0, 90));
      if (els.wpOpacityVal) els.wpOpacityVal.textContent = U.clamp(shade, 0, 90) + '%';
      if (els.wpBlur) els.wpBlur.value = String(Number.isFinite(wp.blur) ? wp.blur : 0);
      if (els.wpBlurVal) els.wpBlurVal.textContent = (Number.isFinite(wp.blur) ? wp.blur : 0) + 'px';

      U.$$('.theme-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-theme') === (s.theme || 'dark'));
      });

      if (els.fontFamily) {
        const val = font.family || FONT_STACKS['Microsoft YaHei, PingFang SC, sans-serif'];
        if (!Array.prototype.some.call(els.fontFamily.options, function (o) { return o.value === val; })) {
          els.fontFamily.appendChild(U.el('option', { value: val, text: '自定义字体（' + val.split(',')[0] + '）' }));
        }
        els.fontFamily.value = val;
      }
      if (els.fontSize) els.fontSize.value = String(font.size || 16);
      if (els.fontSizeVal) els.fontSizeVal.textContent = (font.size || 16) + 'px';
      const lh = Math.round((Number.isFinite(font.lineHeight) ? font.lineHeight : 2) * 10);
      if (els.lineHeight) els.lineHeight.value = String(lh);
      if (els.lineHeightVal) els.lineHeightVal.textContent = (lh / 10).toFixed(1);
      if (els.paraGap) els.paraGap.value = String(Number.isFinite(font.paragraphGap) ? font.paragraphGap : 20);
      if (els.paraGapVal) els.paraGapVal.textContent = (Number.isFinite(font.paragraphGap) ? font.paragraphGap : 20) + 'px';
      if (els.indent) els.indent.value = String(Number.isFinite(font.indent) ? font.indent : 2);
      if (els.indentVal) els.indentVal.textContent = (Number.isFinite(font.indent) ? font.indent : 2) + ' 字';
      if (els.showRuler) els.showRuler.checked = ui.showRuler !== false;

      if (els.apiBaseUrl) els.apiBaseUrl.value = apiCfg.baseUrl || '';
      if (els.apiKey) els.apiKey.value = apiCfg.apiKey || '';
      if (els.apiModel) els.apiModel.value = apiCfg.model || 'deepseek-chat';
      const temp = Math.round((Number.isFinite(apiCfg.temperature) ? apiCfg.temperature : 0.8) * 10);
      if (els.apiTemp) els.apiTemp.value = String(U.clamp(temp, 0, 20));
      if (els.apiTempVal) els.apiTempVal.textContent = (U.clamp(temp, 0, 20) / 10).toFixed(1);
      if (els.apiMaxTokens) els.apiMaxTokens.value = String(apiCfg.maxTokens || 4096);
      if (els.apiVision) els.apiVision.checked = !!apiCfg.supportsVision;
      if (els.apiSystemPrompt) els.apiSystemPrompt.value = apiCfg.systemPrompt || '';

      if (window.Skills) {
        try { Skills.syncModeSelect(); } catch (e) { /* ignore */ }
        try { Skills.refresh(); } catch (e) { /* ignore */ }
        try { Skills.updatePanelButton(); } catch (e) { /* ignore */ }
      }

      refreshGateway();

      if (els.aboutVersion) {
        const i = appInfo || {};
        els.aboutVersion.textContent = 'v' + (i.version || '1.0.0') +
          ' · Electron ' + (i.electron || '-') +
          ' · Chromium ' + (i.chrome || '-') +
          ' · Node ' + (i.node || '-');
      }
      if (els.aboutPaths) {
        const i = appInfo || {};
        els.aboutPaths.textContent = '数据目录：' + (i.userData || '-') +
          '\n诊断日志：' + (i.logDir || '-');
        els.aboutPaths.style.whiteSpace = 'pre-wrap';
      }
    }
  };

  /* ---------------- 工作区：标签 / 欢迎页 / 浮窗 / DSH 按钮 ---------------- */
  // 生成中的全局提示：状态栏右侧常驻一行，结束后自动清掉
  function bindBusyIndicator() {
    if (!window.Busy) return;
    window.Busy.onChange(function (list) {
      const node = els.statusMessage;
      if (!node) return;
      if (!list.length) {
        if (String(node.textContent || '').indexOf('⏳') === 0) U.status('');
        return;
      }
      U.status('⏳ ' + list[0].label + '…（正文可继续手动编辑）', true);
    });
  }

  function bindWorkspace() {
    if (els.btnNewTab) els.btnNewTab.addEventListener('click', function () { newProject(); });
    if (els.btnDsh) els.btnDsh.addEventListener('click', function () { if (window.DshGen) DshGen.open(); });
    if (els.btnOutlineFloat) {
      els.btnOutlineFloat.addEventListener('click', function () {
        if (window.OutlineFloat) OutlineFloat.toggle();
      });
    }
    const wn = U.$('#welcomeNew'); if (wn) wn.addEventListener('click', function () { newProject(); });
    const wd = U.$('#welcomeDsh'); if (wd) wd.addEventListener('click', function () { if (window.DshGen) DshGen.open(); });
    const wo = U.$('#welcomeOpen'); if (wo) wo.addEventListener('click', function () { openProject(); });
    const wi = U.$('#welcomeImport'); if (wi) wi.addEventListener('click', function () { importDocument(); });
  }

  /* ---------------- DSH / MCP 设置面板 ---------------- */
  let dshDetecting = false;

  function setDshStatus(text, cls) {
    if (!els.dshStatus) return;
    els.dshStatus.textContent = text;
    els.dshStatus.className = 'dsh-status' + (cls ? ' ' + cls : '');
  }

  async function detectDsh(showToast) {
    if (!els.dshStatus || dshDetecting) return;
    dshDetecting = true;
    setDshStatus('正在检测本地 DSH…', 'busy');
    try {
      const cmd = (els.dshCommand && els.dshCommand.value.trim()) || (Store.get().dsh || {}).command || 'dsh';
      const res = await api.dshDetect(cmd);
      if (res && res.ok) {
        setDshStatus('✓ 已找到 ' + (res.command || cmd) + '（' + (res.version || '版本未知') + '）', 'ok');
        if (showToast) U.toast('本地 DeepSeek Harness 可用', 'success');
      } else {
        setDshStatus('✗ 未找到可用的 DSH 命令：' + ((res && res.message) || '未知错误'), 'bad');
        if (showToast) U.toast('未找到本地 DSH，请检查安装', 'error');
      }
      return res;
    } catch (err) {
      setDshStatus('✗ 检测失败：' + ((err && err.message) || err), 'bad');
      return null;
    } finally {
      dshDetecting = false;
    }
  }

  function setMcpUI(st) {
    if (!st) return;
    if (els.mcpStatus) {
      els.mcpStatus.textContent = st.running
        ? '运行中 · 端口 ' + st.port + ' · 等待 DSH 连接'
        : '未开启（开启后 DSH 才能反向写入剧本）';
      els.mcpStatus.className = 'dsh-status' + (st.running ? ' ok' : '');
    }
    if (els.mcpToggle) els.mcpToggle.textContent = st.running ? '关闭 MCP 服务' : '开启 MCP 服务';
    if (els.mcpCopy) els.mcpCopy.disabled = !st.running;
    if (els.mcpConfig) els.mcpConfig.value = st.snippet || '';
    if (st.dsh) setMcpDshUI(st.dsh, st.plugin);
  }

  let mcpDshCache = null;
  let mcpPluginCache = null;

  function profilePluginInstalled(name) {
    const list = (mcpPluginCache && mcpPluginCache.profiles) || [];
    const hit = list.filter(function (p) { return p.name === name; })[0];
    return !!(hit && hit.pluginInstalled);
  }

  function updateMcpPluginButtons() {
    const name = els.mcpProfile ? els.mcpProfile.value : '';
    const hasProfiles = !!(mcpDshCache && (mcpDshCache.profiles || []).length);
    if (els.mcpPluginInstall) els.mcpPluginInstall.disabled = !hasProfiles || profilePluginInstalled(name);
    if (els.mcpPluginRemove) els.mcpPluginRemove.disabled = !hasProfiles || !profilePluginInstalled(name);
  }

  function setMcpDshUI(dshInfo, pluginInfo) {
    mcpDshCache = dshInfo || null;
    if (pluginInfo !== undefined) mcpPluginCache = pluginInfo || null;
    if (els.mcpDshPaths) {
      els.mcpDshPaths.textContent = dshInfo
        ? 'DSH 配置目录：' + dshInfo.home + (dshInfo.profiles && dshInfo.profiles.length
          ? '　·　已发现 profile：' + dshInfo.profiles.map(function (p) { return p.name; }).join(' / ')
          : '　·　没有发现任何 profile')
        : '';
    }
    if (els.mcpProfile) {
      const prev = els.mcpProfile.value;
      const list = (dshInfo && dshInfo.profiles) || [];
      els.mcpProfile.innerHTML = '';
      list.forEach(function (p) {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name
          + (profilePluginInstalled(p.name) ? '（已装插件）' : '')
          + (p.installed ? '（已写 YAML）' : '');
        els.mcpProfile.appendChild(opt);
      });
      if (!list.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '未发现 DSH profile';
        els.mcpProfile.appendChild(opt);
      } else if (prev && list.some(function (p) { return p.name === prev; })) {
        els.mcpProfile.value = prev;
      }
    }
    if (els.mcpDshStatus) {
      if (!dshInfo || !dshInfo.exists) {
        els.mcpDshStatus.textContent = '✗ 没找到 DSH 配置目录（' + ((dshInfo && dshInfo.home) || '') + '），先运行一次 dsh 让 profile 生成';
        els.mcpDshStatus.className = 'dsh-status bad';
      } else {
        const total = (dshInfo.profiles || []).length;
        const plug = (dshInfo.profiles || []).filter(function (p) { return profilePluginInstalled(p.name); }).length;
        const done = (dshInfo.profiles || []).filter(function (p) { return p.installed; }).length;
        let text = '共 ' + total + ' 个 profile，尚未接入';
        if (plug) text = '✓ 已作为插件安装到 ' + plug + ' 个 profile（共 ' + total + ' 个）' + (done ? '，另有 ' + done + ' 个写了 YAML' : '');
        else if (done) text = '✓ 已写入 YAML 到 ' + done + ' 个 profile（共 ' + total + ' 个），建议改用插件方式';
        els.mcpDshStatus.textContent = text;
        els.mcpDshStatus.className = 'dsh-status' + (plug || done ? ' ok' : '');
      }
    }
    if (els.mcpRegister) els.mcpRegister.disabled = !(dshInfo && dshInfo.exists && (dshInfo.profiles || []).length);
    if (els.mcpUnregister) els.mcpUnregister.disabled = !(dshInfo && (dshInfo.profiles || []).some(function (p) { return p.installed; }));
    updateMcpPluginButtons();
  }

  async function rescanDshProfiles() {
    try {
      const info = await api.mcpDshStatus();
      setMcpDshUI(info);
      return info;
    } catch (err) {
      return null;
    }
  }

  async function refreshMcpStatus() {
    try {
      const st = await api.mcpStatus();
      setMcpUI(st);
      return st;
    } catch (err) {
      return null;
    }
  }

  function bindDshSettings() {
    if (els.dshCommand) {
      els.dshCommand.value = (Store.get().dsh || {}).command || 'dsh';
      els.dshCommand.addEventListener('change', function () {
        const dshCfg = Object.assign({}, (Store.get().dsh || {}), { command: els.dshCommand.value.trim() || 'dsh' });
        Store.patch({ dsh: dshCfg });
        detectDsh(false);
      });
    }
    if (els.dshMaxActs) {
      els.dshMaxActs.value = String((Store.get().dsh || {}).maxActs || 6);
      els.dshMaxActs.addEventListener('change', function () {
        const dshCfg = Object.assign({}, (Store.get().dsh || {}), {
          maxActs: U.clamp(parseInt(els.dshMaxActs.value, 10) || 6, 1, 12)
        });
        Store.patch({ dsh: dshCfg });
      });
    }
    if (els.dshDetect) {
      els.dshDetect.addEventListener('click', function () { detectDsh(true); });
    }
    if (els.dshTest) {
      els.dshTest.addEventListener('click', async function () {
        if (!els.dshTestResult) return;
        els.dshTest.disabled = true;
        els.dshTestResult.className = 'setting-desc';
        els.dshTestResult.textContent = '正在试跑（最多等 90 秒）…';
        try {
          const cmd = (els.dshCommand && els.dshCommand.value.trim()) || 'dsh';
          const res = await api.dshTest(cmd);
          if (res && res.ok) {
            els.dshTestResult.className = 'setting-desc ok';
            els.dshTestResult.textContent = '✓ 试跑成功，返回：' + (res.text || '').slice(0, 120);
          } else {
            els.dshTestResult.className = 'setting-desc bad';
            els.dshTestResult.textContent = '✗ 试跑失败：' + ((res && res.error) || '未知错误');
          }
        } catch (err) {
          els.dshTestResult.className = 'setting-desc bad';
          els.dshTestResult.textContent = '✗ 试跑失败：' + ((err && err.message) || err);
        } finally {
          els.dshTest.disabled = false;
        }
      });
    }
    if (els.mcpToggle) {
      els.mcpToggle.addEventListener('click', async function () {
        els.mcpToggle.disabled = true;
        try {
          const st = await api.mcpStatus();
          const res = st && st.running ? await api.mcpDisable() : await api.mcpEnable();
          if (res && res.ok) {
            setMcpUI(res.status);
            U.toast(res.status.running ? 'MCP 服务已开启' : 'MCP 服务已关闭', 'success');
          } else {
            U.toast((res && res.error) || '操作失败', 'error');
          }
        } catch (err) {
          U.toast('操作失败：' + ((err && err.message) || err), 'error');
        } finally {
          els.mcpToggle.disabled = false;
        }
      });
    }
    if (els.mcpCopy) {
      els.mcpCopy.addEventListener('click', async function () {
        const st = await api.mcpStatus();
        if (!st || !st.snippet) return;
        try {
          await api.copyText(st.snippet);
          U.toast('配置片段已复制，粘到 DSH 的 MCP 配置里即可', 'success');
        } catch (err) {
          U.toast('复制失败：' + ((err && err.message) || err), 'error');
        }
      });
    }
    if (els.mcpRescan) {
      els.mcpRescan.addEventListener('click', async function () {
        await rescanDshProfiles();
        U.toast('已重新扫描 DSH 配置', 'info');
      });
    }
    if (els.mcpProfile) {
      els.mcpProfile.addEventListener('change', updateMcpPluginButtons);
    }
    if (els.mcpPluginInstall) {
      els.mcpPluginInstall.addEventListener('click', async function () {
        const profile = els.mcpProfile ? els.mcpProfile.value : '';
        if (!profile) { U.toast('没有可用的 DSH profile', 'error'); return; }
        const old = els.mcpPluginInstall.textContent;
        els.mcpPluginInstall.disabled = true;
        els.mcpPluginInstall.textContent = '安装中…';
        if (els.mcpDshStatus) {
          els.mcpDshStatus.textContent = '正在把本软件打成 DSH 插件并安装（dsh plugin add）…';
          els.mcpDshStatus.className = 'dsh-status busy';
        }
        try {
          const res = await api.mcpPluginInstall(profile);
          if (res && res.status) setMcpDshUI(res.status.dsh, res.plugin || (res.status && res.status.plugin));
          if (res && res.ok) {
            U.toast('插件已装进 ' + profile + '，重启 DSH 后就能反向写剧本', 'success');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '✓ 已安装插件 ' + res.bundle + ' 到 profile「' + profile + '」'
                + (res.verify && res.verify.detected ? '，--dump-config 已验证' : '，但 --dump-config 没看到条目')
                + '（插件包目录：' + res.dir + '）';
              els.mcpDshStatus.className = 'dsh-status' + (res.verify && res.verify.detected ? ' ok' : ' bad');
            }
          } else {
            U.toast((res && res.error) || '安装失败', 'error');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '✗ ' + ((res && res.error) || '安装失败');
              els.mcpDshStatus.className = 'dsh-status bad';
            }
          }
        } catch (err) {
          U.toast('安装失败：' + ((err && err.message) || err), 'error');
        } finally {
          els.mcpPluginInstall.textContent = old;
          updateMcpPluginButtons();
        }
      });
    }
    if (els.mcpPluginRemove) {
      els.mcpPluginRemove.addEventListener('click', async function () {
        const profile = els.mcpProfile ? els.mcpProfile.value : '';
        if (!profile) return;
        const yes = await U.confirmBox({
          title: '卸载插件',
          message: '要把本软件的 MCP 插件从 DSH 的 profile「' + profile + '」里卸载吗？（执行 dsh plugin remove，DSH 自己会把配置还原）',
          okText: '卸载插件',
          danger: true
        });
        if (!yes) return;
        els.mcpPluginRemove.disabled = true;
        try {
          const res = await api.mcpPluginRemove(profile);
          if (res && res.status) setMcpDshUI(res.status.dsh, res.plugin || (res.status && res.status.plugin));
          if (res && res.ok) {
            U.toast('插件已卸载', 'success');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '已从 profile「' + profile + '」卸载插件';
              els.mcpDshStatus.className = 'dsh-status';
            }
          } else {
            U.toast((res && res.error) || '卸载失败', 'error');
          }
        } catch (err) {
          U.toast('卸载失败：' + ((err && err.message) || err), 'error');
        } finally {
          updateMcpPluginButtons();
        }
      });
    }
    if (els.mcpRegister) {
      els.mcpRegister.addEventListener('click', async function () {
        const profile = els.mcpProfile ? els.mcpProfile.value : '';
        if (!profile) { U.toast('没有可注册的 DSH profile', 'error'); return; }
        els.mcpRegister.disabled = true;
        const old = els.mcpRegister.textContent;
        els.mcpRegister.textContent = '写入中…';
        try {
          const res = await api.mcpDshInstall(profile);
          if (!res || !res.ok) {
            U.toast((res && res.error) || '注册失败', 'error');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '✗ ' + ((res && res.error) || '注册失败');
              els.mcpDshStatus.className = 'dsh-status bad';
            }
            return;
          }
          setMcpDshUI(res.status);
          const v = res.verify || {};
          if (v.ok && v.detected) {
            U.toast('已注册到 DSH（' + profile + '），重启 DSH 后生效', 'success');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '✓ 已写入 ' + profile + ' 并用 --dump-config 验证通过' + (res.probeFound ? '（插件名：' + res.pluginName + '）' : '');
              els.mcpDshStatus.className = 'dsh-status ok';
            }
          } else if (v.ok && !v.detected) {
            U.toast('已写入，但该版本没识别到这个条目', 'warn');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '⚠ 已写入 ' + res.patchFile + '，但 --dump-config 里没看到条目，可能是该 DSH 版本不支持';
              els.mcpDshStatus.className = 'dsh-status bad';
            }
          } else {
            U.toast('已写入，但验证没能完成', 'warn');
            if (els.mcpDshStatus) {
              els.mcpDshStatus.textContent = '⚠ 已写入 ' + res.patchFile + '；验证未完成：' + ((v && v.error) || '未知');
              els.mcpDshStatus.className = 'dsh-status bad';
            }
          }
        } catch (err) {
          U.toast('注册失败：' + ((err && err.message) || err), 'error');
        } finally {
          els.mcpRegister.disabled = false;
          els.mcpRegister.textContent = old;
        }
      });
    }
    if (els.mcpUnregister) {
      els.mcpUnregister.addEventListener('click', async function () {
        const profile = els.mcpProfile ? els.mcpProfile.value : '';
        if (!profile) return;
        const yes = await U.confirmBox({
          title: '撤销注册',
          message: '要从 DSH 的 profile「' + profile + '」里移除本软件的 MCP 条目吗？（原文件会先备份）',
          okText: '撤销注册',
          danger: true
        });
        if (!yes) return;
        try {
          const res = await api.mcpDshUninstall(profile);
          if (res && res.ok) {
            setMcpDshUI(res.status);
            U.toast(res.changed ? '已撤销注册' : '这个 profile 里本来就没有注册', res.changed ? 'success' : 'info');
          } else {
            U.toast((res && res.error) || '撤销失败', 'error');
          }
        } catch (err) {
          U.toast('撤销失败：' + ((err && err.message) || err), 'error');
        }
      });
    }
    detectDsh(false);
    refreshMcpStatus();
  }

  /* ---------------- MCP 反向写入（DSH 调本软件） ---------------- */
  function mcpParagraphs(text) {
    return String(text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* 外部写入（MCP / DSH 反向写入）前后保住用户的光标与滚动位置：
     先把正在敲的内容同步进模型，写完重新加载章节再把光标放回去，
     这样"AI 边写、人边改"不会互相打断。 */
  function beforeExternalWrite() {
    const state = { caret: null };
    try {
      if (window.Editor) {
        Editor.flushSnapshot();
        state.caret = Editor.saveCaret();
      }
    } catch (e) { /* ignore */ }
    return state;
  }

  function afterExternalWrite(state) {
    try {
      if (state && state.caret && window.Editor) Editor.restoreCaret(state.caret);
    } catch (e) { /* ignore */ }
  }

  function mcpHandle(action, args) {
    const a = args || {};
    switch (action) {
      case 'list_scripts': {
        Workspace.syncActive();
        const list = Workspace.list().map(function (d) {
          const m = d.model || {};
          const st = (function () {
            const acts = Array.isArray(m.acts) ? m.acts : [];
            let words = 0;
            acts.forEach(function (act) { words += U.countWords(Project.htmlToText(act.html || '')); });
            return { acts: acts.length, words: words };
          })();
          return {
            title: (m.meta && m.meta.title) || d.title,
            filePath: d.filePath,
            chapters: st.acts,
            words: st.words,
            active: d.id === Workspace.getActiveId()
          };
        });
        return { scripts: list };
      }
      case 'get_script': {
        const title = a.title ? String(a.title).trim().toLowerCase() : '';
        const target = title
          ? Workspace.list().find(function (d) {
            const t = String((d.model && d.model.meta && d.model.meta.title) || d.title || '').toLowerCase();
            return t === title || t.indexOf(title) >= 0;
          })
          : Workspace.active();
        if (!target) throw new Error('没有找到对应的剧本' + (title ? '：' + a.title : '（当前没有打开的剧本）'));
        const maxChars = Math.max(200, Math.min(60000, parseInt(a.maxChars, 10) || 8000));
        const acts = (target.model.acts || []).map(function (act) {
          return { title: act.title, text: Project.htmlToText(act.html || '').replace(/\n{2,}/g, '\n').trim() };
        });
        let out = acts.map(function (act) { return '【' + act.title + '】\n' + act.text; }).join('\n\n');
        if (out.length > maxChars) out = out.slice(0, maxChars) + '\n…（已截断）';
        return { title: (target.model.meta && target.model.meta.title) || target.title, chapters: acts.length, text: out };
      }
      case 'create_script': {
        const chapters = Array.isArray(a.chapters) ? a.chapters : [];
        if (!chapters.length) throw new Error('chapters 不能为空');
        const model = Project.createDefault(String(a.title || 'AI 写入的剧本').slice(0, 80));
        model.meta.summary = '由 DSH 通过 MCP 写入';
        model.acts = chapters.map(function (c, i) {
          const title = String((c && (c.title || c.name)) || ('第' + (i + 1) + '章')).slice(0, 80);
          const secs = Array.isArray(c && c.sections) && c.sections.length
            ? c.sections.map(function (s, j) {
              return {
                title: String((s && (s.title || s.name)) || ('小节 ' + (j + 1))).slice(0, 60),
                paragraphs: Array.isArray(s && s.paragraphs) ? s.paragraphs.map(String) : mcpParagraphs(s && s.content)
              };
            })
            : [{ title: title, paragraphs: Array.isArray(c && c.paragraphs) ? c.paragraphs.map(String) : mcpParagraphs(c && c.content) }];
          return Project.actFromSections(title, secs);
        });
        model.activeActId = model.acts[0].id;
        const doc = Workspace.create(model, null, { dirty: true, activate: true });
        return { title: model.meta.title, chapters: model.acts.length, docId: doc.id };
      }
      case 'add_chapter': {
        const title = String(a.title || '新章节').slice(0, 80);
        const paras = Array.isArray(a.paragraphs) ? a.paragraphs.map(String) : mcpParagraphs(a.content || a.text);
        const act = Project.actFromSections(title, [{ title: title, paragraphs: paras }]);
        const p = Project.get();
        if (!p) {
          const model = Project.createDefault(title);
          model.acts = [act];
          model.activeActId = act.id;
          Workspace.create(model, null, { dirty: true, activate: true });
        } else {
          const keep = beforeExternalWrite();
          p.acts.push(act);
          Project.markDirty();
          refreshAll('');
          afterExternalWrite(keep);
        }
        return { title: title, paragraphs: paras.length };
      }
      case 'append_text': {
        const p = Project.get();
        if (!p) throw new Error('当前没有打开的剧本，请先用 create_script 新建');
        const text = String(a.text || '').trim();
        if (!text) throw new Error('text 不能为空');
        const wantTitle = a.chapter ? String(a.chapter).trim().toLowerCase() : '';
        let act = null;
        if (wantTitle) {
          act = p.acts.find(function (x) {
            return String(x.title || '').toLowerCase() === wantTitle;
          }) || p.acts.find(function (x) {
            return String(x.title || '').toLowerCase().indexOf(wantTitle) >= 0;
          });
          if (!act) throw new Error('没有找到章节：' + a.chapter);
        } else {
          act = Project.getAct() || p.acts[0];
        }
        const html = mcpParagraphs(text).map(function (t) {
          const div = document.createElement('div');
          div.textContent = t;
          return '<p>' + U.escapeHtml(t) + '</p>';
        }).join('') || '<p><br></p>';
        const keep = beforeExternalWrite();
        act.html = (act.html || '') + html;
        Project.markDirty();
        refreshAll('');
        afterExternalWrite(keep);
        const added = mcpParagraphs(text).length;
        U.toast('DSH 写入了 ' + added + ' 段到「' + act.title + '」', 'success', 2400);
        return { chapter: act.title, added: added };
      }
      default:
        throw new Error('未知操作：' + action);
    }
  }

  function bindMcpRequests() {
    if (!api.onMcpRequest) return;
    api.onMcpRequest(function (req) {
      if (!req || !req.id) return;
      let payload;
      try {
        const value = mcpHandle(req.action, req.args);
        payload = { ok: true, value: value };
      } catch (err) {
        payload = { ok: false, error: (err && err.message) || String(err) };
      }
      api.mcpReply(req.id, payload);
    });
  }

  function bindSettings() {
  const openLogsBtn = document.getElementById('openLogs');
  if (openLogsBtn) {
    openLogsBtn.addEventListener('click', async function () {
      const err = await api.openLogs();
      if (err && err !== 'ok') U.toast('打开失败：' + err, 'error');
    });
  }

    if (!els.settingsModal) return;
    els.settingsModal.addEventListener('click', function (e) {
      if (e.target === els.settingsModal) SettingsPanel.close();
    });
    const closeBtn = U.$('#closeSettings');
    if (closeBtn) closeBtn.addEventListener('click', function () { SettingsPanel.close(); });
    const closeBtn2 = U.$('#closeSettingsBtn');
    if (closeBtn2) closeBtn2.addEventListener('click', function () { SettingsPanel.close(); });

    if (els.settingsTabs) {
      els.settingsTabs.addEventListener('click', function (e) {
        const tab = e.target.closest('.modal-tab');
        if (!tab) return;
        SettingsPanel.switchTab(tab.getAttribute('data-tab'));
      });
    }

    bindDshSettings();
    bindGatewaySettings();

    /* 壁纸 */
    if (els.pickWallpaper) {
      els.pickWallpaper.addEventListener('click', async function () {
        els.pickWallpaper.disabled = true;
        try {
          await Store.setWallpaperFromPicker();
          const wp = (Store.get() || {}).wallpaper || {};
          if (wp.type && !(wp.opacity < 1)) {
            Store.setWallpaperEffect({ opacity: 0.62 });
          }
          SettingsPanel.refresh();
        } catch (err) {
          U.toast('壁纸设置失败：' + (err && err.message ? err.message : err), 'error');
        } finally {
          els.pickWallpaper.disabled = false;
        }
      });
    }
    if (els.resetWallpaper) {
      els.resetWallpaper.addEventListener('click', async function () {
        try {
          await Store.clearWallpaper();
          SettingsPanel.refresh();
        } catch (err) {
          U.toast('恢复背景失败：' + (err && err.message ? err.message : err), 'error');
        }
      });
    }
    if (els.wpOpacity) {
      els.wpOpacity.addEventListener('input', U.debounce(function () {
        const v = Number(els.wpOpacity.value) || 0;
        if (els.wpOpacityVal) els.wpOpacityVal.textContent = v + '%';
        Store.setWallpaperEffect({ opacity: U.clamp(1 - v / 100, 0.1, 1) });
      }, 40));
    }
    if (els.wpBlur) {
      els.wpBlur.addEventListener('input', U.debounce(function () {
        const v = Number(els.wpBlur.value) || 0;
        if (els.wpBlurVal) els.wpBlurVal.textContent = v + 'px';
        Store.setWallpaperEffect({ blur: v });
      }, 60));
    }
    U.$$('.theme-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        Store.setTheme(b.getAttribute('data-theme'));
        U.$$('.theme-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
    /* 排版 */
    if (els.fontFamily) {
      els.fontFamily.addEventListener('change', function () {
        Store.updateFont({ family: els.fontFamily.value });
      });
    }
    if (els.fontSize) {
      els.fontSize.addEventListener('input', function () {
        const v = Number(els.fontSize.value) || 16;
        if (els.fontSizeVal) els.fontSizeVal.textContent = v + 'px';
        Store.updateFont({ size: v });
      });
    }
    if (els.lineHeight) {
      els.lineHeight.addEventListener('input', function () {
        const raw = Number(els.lineHeight.value) || 20;
        if (els.lineHeightVal) els.lineHeightVal.textContent = (raw / 10).toFixed(1);
        Store.updateFont({ lineHeight: raw / 10 });
      });
    }
    if (els.paraGap) {
      els.paraGap.addEventListener('input', function () {
        const v = Number(els.paraGap.value) || 0;
        if (els.paraGapVal) els.paraGapVal.textContent = v + 'px';
        Store.updateFont({ paragraphGap: v });
      });
    }
    if (els.indent) {
      els.indent.addEventListener('input', function () {
        const v = Number(els.indent.value) || 0;
        if (els.indentVal) els.indentVal.textContent = v + ' 字';
        Store.updateFont({ indent: v });
      });
    }
    if (els.showRuler) {
      els.showRuler.addEventListener('change', function () {
        Store.patch({ ui: { showRuler: els.showRuler.checked } });
        applyRulerVisibility();
      });
    }

    /* AI */
    if (els.apiBaseUrl) {
      els.apiBaseUrl.addEventListener('change', function () {
        Store.patch({ api: { baseUrl: (els.apiBaseUrl.value || '').trim() } });
        refreshApiStatus();
      });
    }
    if (els.apiKey) {
      els.apiKey.addEventListener('change', function () {
        Store.patch({ api: { apiKey: (els.apiKey.value || '').trim() } });
        refreshApiStatus();
        if (AIPanel.syncModelSelect) AIPanel.syncModelSelect();
      });
    }
    if (els.toggleKey) {
      els.toggleKey.addEventListener('click', function () {
        if (!els.apiKey) return;
        const hidden = els.apiKey.type === 'password';
        els.apiKey.type = hidden ? 'text' : 'password';
        els.toggleKey.textContent = hidden ? '隐藏' : '显示';
      });
    }
    if (els.apiModel) {
      els.apiModel.addEventListener('change', function () {
        Store.patch({ api: { model: (els.apiModel.value || '').trim() || 'deepseek-chat' } });
        refreshApiStatus();
        if (AIPanel.syncModelSelect) AIPanel.syncModelSelect();
      });
    }
    if (els.apiTemp) {
      els.apiTemp.addEventListener('input', function () {
        const raw = Number(els.apiTemp.value) || 0;
        if (els.apiTempVal) els.apiTempVal.textContent = (raw / 10).toFixed(1);
        Store.patch({ api: { temperature: raw / 10 } });
      });
    }
    if (els.apiMaxTokens) {
      els.apiMaxTokens.addEventListener('change', function () {
        let v = parseInt(els.apiMaxTokens.value, 10);
        if (!Number.isFinite(v)) v = 4096;
        v = U.clamp(v, 256, 16000);
        els.apiMaxTokens.value = String(v);
        Store.patch({ api: { maxTokens: v } });
      });
    }
    if (els.apiVision) {
      els.apiVision.addEventListener('change', function () {
        Store.patch({ api: { supportsVision: els.apiVision.checked } });
      });
    }
    if (els.apiSystemPrompt) {
      els.apiSystemPrompt.addEventListener('change', function () {
        Store.patch({ api: { systemPrompt: els.apiSystemPrompt.value || '' } });
      });
    }
    if (els.testApi) {
      els.testApi.addEventListener('click', async function () {
        const override = {
          baseUrl: (els.apiBaseUrl && els.apiBaseUrl.value || '').trim(),
          apiKey: (els.apiKey && els.apiKey.value || '').trim(),
          model: (els.apiModel && els.apiModel.value || '').trim()
        };
        if (!override.apiKey) {
          if (els.testApiResult) {
            els.testApiResult.textContent = '请先填写 API Key。';
            els.testApiResult.className = 'test-result bad';
          }
          return;
        }
        els.testApi.disabled = true;
        const oldText = els.testApi.textContent;
        els.testApi.textContent = '测试中…';
        if (els.testApiResult) {
          els.testApiResult.textContent = '正在请求 ' + (override.baseUrl || '默认地址') + ' …';
          els.testApiResult.className = 'test-result';
        }
        try {
          const res = await api.aiTest(override);
          if (els.testApiResult) {
            els.testApiResult.textContent = (res && res.ok ? '✓ ' : '✗ ') + ((res && res.message) || '未知结果');
            els.testApiResult.className = 'test-result ' + (res && res.ok ? 'ok' : 'bad');
          }
        } catch (err) {
          if (els.testApiResult) {
            els.testApiResult.textContent = '✗ ' + (err && err.message ? err.message : err);
            els.testApiResult.className = 'test-result bad';
          }
        } finally {
          els.testApi.disabled = false;
          els.testApi.textContent = oldText || '测试连接';
        }
      });
    }

    /* AI 一键预设 + 探测本地模型 */
    const presetRow = U.$('#presetRow');
    if (presetRow) {
      presetRow.addEventListener('click', function (e) {
        const btn = e.target.closest ? e.target.closest('[data-preset]') : null;
        if (!btn) return;
        applyApiPreset(btn.getAttribute('data-preset'));
      });
    }
    const probeLocal = U.$('#probeLocal');
    if (probeLocal) {
      probeLocal.addEventListener('click', async function () {
        if (probeLocal.disabled) return;
        probeLocal.disabled = true;
        const oldText = probeLocal.textContent;
        probeLocal.textContent = '探测中…';
        const box = U.$('#probeResult');
        if (box) { box.textContent = '正在探测本机常见的本地模型服务（Ollama / LM Studio / llama.cpp …）'; box.className = 'test-result'; }
        try {
          const res = await api.probeLocalModels();
          renderProbeResult(res);
        } catch (err) {
          if (box) { box.textContent = '✗ 探测失败：' + (err && err.message ? err.message : err); box.className = 'test-result bad'; }
        } finally {
          probeLocal.disabled = false;
          probeLocal.textContent = oldText || '探测本地模型';
        }
      });
    }

    /* 字数弹窗 */
    if (els.countModal) {
      els.countModal.addEventListener('click', function (e) {
        if (e.target === els.countModal) closeCountModal();
      });
    }
    const c1 = U.$('#countClose'); if (c1) c1.addEventListener('click', closeCountModal);
    const c2 = U.$('#countOk'); if (c2) c2.addEventListener('click', closeCountModal);
  }

  /* ---------------- 最近文件 ---------------- */
  function renderWelcomeRecent() {
    const box = els.welcomeRecent;
    if (!box) return;
    const list = ((Store.get() || {}).recentFiles || []).slice(0, 5);
    box.innerHTML = '';
    if (!list.length) return;
    box.appendChild(U.el('div', { class: 'welcome-recent-title', text: '最近打开' }));
    list.forEach(function (item) {
      const name = item.title || (item.path || '').split(/[\\/]/).pop() || '未命名';
      const row = U.el('button', { class: 'welcome-recent-item', type: 'button', title: item.path || '' }, [
        U.el('span', { class: 'wr-name', text: name }),
        U.el('span', { class: 'wr-path', text: item.path || '' })
      ]);
      row.addEventListener('click', function () { openProjectPath(item.path); });
      box.appendChild(row);
    });
  }

  function renderRecent() {
    renderWelcomeRecent();
    const box = els.recentMenu;
    if (!box) return;
    const list = ((Store.get() || {}).recentFiles || []).slice(0, 12);
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(U.el('div', { class: 'recent-empty', text: '暂无最近文件' }));
      return;
    }
    list.forEach(function (item) {
      const name = item.title || item.name || (item.path || '').split(/[\\/]/).pop() || '未命名';
      const node = U.el('div', { class: 'dropdown-item recent-item', title: item.path || '' }, [
        U.el('span', { class: 'rname', text: name }),
        U.el('span', { class: 'rpath', text: item.path || '' })
      ]);
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        closeMenus();
        openProjectPath(item.path);
      });
      box.appendChild(node);
    });
    box.appendChild(U.el('div', { class: 'dropdown-divider' }));
    const clear = U.el('div', { class: 'dropdown-item', text: '清空最近文件列表' });
    clear.addEventListener('click', async function (e) {
      e.stopPropagation();
      closeMenus();
      try { await api.clearRecent(); } catch (err) { /* ignore */ }
      renderRecent();
      U.toast('已清空最近文件列表', 'success');
    });
    box.appendChild(clear);
  }

  /* ---------------- 未保存草稿：不跨启动保留 ----------------
   * 1.1.8 起按用户要求改掉了老行为：没保存成 .aisc 的剧本，关掉软件就该消失，
   * 下次启动不再把上次的草稿、那个剧本的标签页恢复出来。
   * 以前版本留在磁盘上的 autosave.json 也会在启动时清掉。
   */
  async function discardOldDrafts() {
    if (!api.autosaveClear) return;
    try { await api.autosaveClear(); } catch (err) { /* ignore */ }
  }

  /* ---------------- 工作现场（上次打开的文件） ---------------- */
  let sessionTimer = null;

  // 只记「有磁盘落点」的剧本：没保存过的新剧本不记账（关掉就消失）
  function sessionPayload() {
    Workspace.syncActive();
    const list = Workspace.list();
    const files = list.filter(function (d) { return !!d.filePath; }).map(function (d) { return d.filePath; });
    const act = Workspace.active();
    return { files: files, active: act && act.filePath ? act.filePath : null };
  }

  function saveSessionSoon() {
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = setTimeout(function () {
      sessionTimer = null;
      saveSessionNow();
    }, 600);
  }

  function saveSessionNow() {
    if (!api.sessionWrite) return;
    try {
      const payload = sessionPayload();
      if (!payload.files.length) { api.sessionClear(); return; }
      api.sessionWrite(payload);
    } catch (err) { /* ignore */ }
  }

  // 把上次打开过的文件重新打开（不弹提示、不打断当前文档）
  async function restoreFiles(saved) {
    if (!saved || !Array.isArray(saved.files) || !saved.files.length) return 0;
    let opened = 0;
    let missing = 0;
    for (const fp of saved.files) {
      if (!fp) continue;
      if (Workspace.findByPath(fp)) continue;
      try {
        const res = await api.openProjectPath(fp);
        if (!res || res.canceled || !res.project) { missing++; continue; }
        adoptDocument(res.project, res.filePath, { dirty: false });
        opened++;
      } catch (err) { missing++; /* 文件被移动或删除：静默跳过 */ }
    }
    if (saved.active) {
      const doc = Workspace.findByPath(saved.active);
      if (doc) Workspace.activate(doc.id);
    }
    // 有文件不见了（被移动/删除）：把工作现场同步成现在真实开着的，避免每次启动都白试一遍
    if (missing) {
      try { saveSessionNow(); } catch (err) { /* ignore */ }
    }
    return opened;
  }

  /* ---------------- 工作区状态（欢迎页 / 三栏） ---------------- */
  function updateWorkspaceUI() {
    const has = Workspace.count() > 0;
    if (els.welcome) els.welcome.hidden = has;
    if (els.sidebarLeft) els.sidebarLeft.hidden = !has;
    if (els.sidebarRight) els.sidebarRight.hidden = !has;
    if (els.editorArea) els.editorArea.hidden = !has;
    if (window.OutlineFloat && !has) OutlineFloat.setOpen(false, { silent: true });
    if (els.tabBar) els.tabBar.classList.toggle('no-docs', !has);
  }

  function onWorkspaceChanged() {
    updateWorkspaceUI();
    syncDirtyUI();
    saveSessionSoon();
  }

  function onWorkspaceActivated() {
    try { refreshAll(''); } catch (err) { console.error('[activate]', err); }
  }

  function onEmptyWorkspace() {
    refreshAll('');
    U.status('没有打开的剧本了');
  }

  /* ---------------- 全局刷新 ---------------- */
  function refreshAll(statusText) {
    updateWorkspaceUI();
    if (window.Tabs) Tabs.refresh();
    const p = Project.get();
    if (!p) {
      syncDirtyUI();
      applyStats();
      if (window.Outline) Outline.render({ immediate: true });
      if (window.OutlineFloat) OutlineFloat.refresh({ immediate: true });
      if (statusText) U.status(statusText, true);
      return;
    }
    if (els.projectTitle) els.projectTitle.value = p.meta.title || '';
    Outline.render();
    Editor.loadAct(Project.getAct());
    AIPanel.onActChanged();
    if (window.Find) Find.onActChanged();
    if (window.OutlineFloat) OutlineFloat.refresh({ immediate: true });
    syncDirtyUI();
    refreshStats(true);
    if (statusText) U.status(statusText, true);
  }

  function onActSwitched(act) {
    if (window.OutlineFloat) OutlineFloat.refresh({ immediate: true });
    syncDirtyUI();
    refreshStats(true);
    if (window.Find && Find.isOpen()) Find.onActChanged();
    if (act) U.status('已切换到「' + act.title + '」');
  }

  /* ---------------- 启动 ---------------- */
  function hideSplash() {
    if (!els.splash) return;
    setTimeout(function () {
      els.splash.classList.add('hide');
      setTimeout(function () {
        if (els.splash) els.splash.style.display = 'none';
      }, 500);
    }, 260);
  }

  async function boot() {
    q();
    try {
      appInfo = await api.info();
    } catch (err) {
      appInfo = null;
    }

    try {
      await Store.load();
      Store.applyAll();
    } catch (err) {
      console.error('[store]', err);
      U.toast('读取设置失败，将使用默认外观', 'warn');
    }

    bindMenus();
    bindShortcuts();
    bindSettings();
    bindWorkspace();
    bindBusyIndicator();
    bindMcpRequests();

    Editor.init();
    Outline.init();
    AIPanel.init();
    Find.init();
    if (window.Skills) Skills.init();
    if (window.Tabs) Tabs.init();
    if (window.OutlineFloat) OutlineFloat.init();
    if (window.DshGen) DshGen.init();

    // 上次没保存成 .aisc 的草稿一律丢弃（用户要求：关掉就该消失）
    await discardOldDrafts();
    let restoredFiles = 0;
    try {
      const saved = api.sessionRead ? await api.sessionRead() : null;
      restoredFiles = await restoreFiles(saved);
    } catch (err) { /* ignore */ }
    const restored = restoredFiles > 0;
    if (restored) {
      refreshAll('已回到上次的工作现场（' + Workspace.count() + ' 个剧本）');
    } else {
      refreshAll('从新建剧本开始吧');
    }

    renderRecent();
    refreshApiStatus();
    applyRulerVisibility();
    detectDsh(false);
    refreshMcpStatus();

    if (api.onRecentChanged) {
      api.onRecentChanged(function (list) {
        if (Array.isArray(list)) {
          Store.patch({ recentFiles: list });
          renderRecent();
        }
      });
    }

    if (api.onQuitRequest) {
      api.onQuitRequest(async function () {
        const ok = await saveProject(false);
        if (ok) {
          try { await api.autosaveClear(); } catch (e) { }
          api.forceQuit();
        }
      });
    }

    window.addEventListener('beforeunload', function () {
      try { saveSessionNow(); } catch (e) { /* ignore */ }
    });

    hideSplash();
  }

  /* ---------------- 对外 ---------------- */
  window.App = {
    boot: boot,
    onDirtyChanged: syncDirtyUI,
    onActSwitched: onActSwitched,
    onWorkspaceChanged: onWorkspaceChanged,
    onWorkspaceActivated: onWorkspaceActivated,
    onEmptyWorkspace: onEmptyWorkspace,
    refreshStats: refreshStats,
    refreshAll: refreshAll,
    refreshApiStatus: refreshApiStatus,
    updateWorkspaceUI: updateWorkspaceUI,
    newProject: newProject,
    openProject: openProject,
    openProjectPath: openProjectPath,
    adoptDocument: adoptDocument,
    saveProject: saveProject,
    closeDoc: closeDoc,
    closeOtherDocs: closeOtherDocs,
    closeAllDocs: closeAllDocs,
    importDocument: importDocument,
    doExport: doExport,
    askChoice: askChoice,
    openCountModal: openCountModal,
    detectDsh: detectDsh,
    restoreFiles: restoreFiles,
    saveSessionNow: saveSessionNow,
    refreshMcpStatus: refreshMcpStatus,
    mcpHandle: mcpHandle,
    parsers: {
      markdown: splitMarkdown,
      plain: splitPlain,
      html: splitHtml,
      textToHtml: textToHtml
    }
  };
  window.SettingsPanel = SettingsPanel;

  window.addEventListener('error', function (e) {
    console.error('[window:error]', e.error || e.message);
  });

  document.addEventListener('DOMContentLoaded', function () {
    boot().catch(function (err) {
      console.error('[boot]', err);
      const splash = document.getElementById('splash');
      if (splash) {
        const sub = splash.querySelector('.splash-sub');
        if (sub) sub.textContent = '启动失败：' + (err && err.message ? err.message : err);
      }
      if (document.getElementById('toastWrap') && window.U && U.toast) {
        U.toast('启动时发生错误：' + (err && err.message ? err.message : err), 'error');
      }
    });
  });
})();
