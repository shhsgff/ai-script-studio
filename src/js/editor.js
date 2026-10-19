'use strict';
/* 正文编辑器：输入、脏标记、撤销重做、选区追踪、悬浮工具条 */
(function () {
  const U = window.U;

  const els = {};
  let applying = false;
  let currentActId = null;
  const stacks = new Map();      // actId -> { list: [html], idx }
  let savedSelection = { text: '', range: null, actId: null };
  let snapshotTimer = null;
  let hideTimer = null;

  const MAX_HISTORY = 150;

  function q() {
    els.title = document.getElementById('actTitle');
    els.body = document.getElementById('actBody');
    els.area = document.getElementById('editorArea');
    els.scroll = document.getElementById('editorScroll');
    els.float = document.getElementById('floatBtn');
    els.toolbar = document.getElementById('contextToolbar');
    els.selCount = document.getElementById('selectedCount');
    els.selText = document.getElementById('selectedText');
  }

  /* ---------- 撤销栈 ---------- */
  function stackOf(actId) {
    if (!stacks.has(actId)) stacks.set(actId, { list: [], idx: -1 });
    return stacks.get(actId);
  }

  function pushSnapshot(html) {
    if (!currentActId) return;
    const st = stackOf(currentActId);
    if (st.list[st.idx] === html) return;
    st.list = st.list.slice(0, st.idx + 1);
    st.list.push(html);
    if (st.list.length > MAX_HISTORY) st.list.shift();
    st.idx = st.list.length - 1;
    notifyHistChange();
  }

  function notifyHistChange() {
    if (window.App && window.App.onHistoryChanged) window.App.onHistoryChanged();
  }

  function resetStack(actId, html) {
    stacks.set(actId, { list: [html], idx: 0 });
    notifyHistChange();
  }

  function canUndo() {
    const st = currentActId ? stacks.get(currentActId) : null;
    return !!(st && st.idx > 0);
  }
  function canRedo() {
    const st = currentActId ? stacks.get(currentActId) : null;
    return !!(st && st.idx < st.list.length - 1);
  }

  function applySnapshot(html) {
    applying = true;
    const body = els.body;
    body.innerHTML = html || '';
    placeCaretAtEnd(body);
    applying = false;
    syncToModel();
    if (window.App) window.App.refreshStats();
    notifyHistChange();
  }

  function undo() {
    flushSnapshot();
    if (!canUndo()) { U.status('没有可撤销的操作'); return false; }
    const st = stackOf(currentActId);
    st.idx--;
    applySnapshot(st.list[st.idx]);
    return true;
  }

  function redo() {
    flushSnapshot();
    if (!canRedo()) { U.status('没有可重做的操作'); return false; }
    const st = stackOf(currentActId);
    st.idx++;
    applySnapshot(st.list[st.idx]);
    return true;
  }

  /* ---------- 光标工具 ---------- */
  function getCaretOffset(root) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function setCaretOffset(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let remaining = offset || 0;
    let node = walker.nextNode();
    let last = null;
    while (node) {
      const len = node.textContent.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        root.focus();
        return true;
      }
      remaining -= len;
      last = node;
      node = walker.nextNode();
    }
    if (last) {
      const range = document.createRange();
      range.setStart(last, last.textContent.length);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      root.focus();
      return true;
    }
    return false;
  }

  function placeCaretAtEnd(root) {
    try {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      root.focus();
    } catch (e) {}
  }

  /* ---------- 同步 ---------- */
  function syncToModel() {
    if (!currentActId) return;
    const act = Project.getAct(currentActId);
    if (!act) return;
    const html = els.body.innerHTML;
    if (act.html !== html) {
      act.html = html;
      Project.markDirty();
    }
    const title = (els.title.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (act.title !== title) {
      act.title = title || '未命名章节';
      Project.markDirty();
      if (window.Outline) window.Outline.render();
    } else if (window.Outline) {
      window.Outline.render();
    }
  }

  function scheduleSnapshot() {
    if (snapshotTimer) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => { snapshotTimer = null; flushSnapshot(); }, 700);
  }

  function flushSnapshot() {
    if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
    if (applying || !currentActId) return;
    pushSnapshot(els.body.innerHTML);
  }

  /* ---------- 选区 ---------- */
  function computeSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    const node = range.commonAncestorContainer;
    const inside = (els.body && els.body.contains(node)) || (els.title && els.title.contains(node));
    if (!inside) return null;
    const text = sel.toString();
    if (!text || !text.trim()) return null;
    return { text: text, range: range.cloneRange() };
  }

  function updateSelectionUI() {
    const info = computeSelection();
    if (info) {
      savedSelection = { text: info.text, range: info.range, actId: currentActId };
      renderSelectionInfo(info.text);
      showFloating(info.range);
    } else {
      hideFloating();
      // 保留上一次有效选区文本（点击右侧面板后浏览器会清空选区）
      renderSelectionInfo(savedSelection.text && savedSelection.actId === currentActId ? savedSelection.text : '');
    }
  }

  function renderSelectionInfo(text) {
    if (!els.selCount) return;
    if (text) {
      els.selCount.textContent = '已选中 ' + U.countWords(text) + ' 字 / ' + text.length + ' 字符';
      els.selText.textContent = text.replace(/\s+/g, ' ').slice(0, 220) + (text.length > 220 ? '…' : '');
    } else {
      els.selCount.textContent = '尚未选中任何文字';
      els.selText.textContent = '';
    }
  }

  function positionFloating(rect) {
    if (!els.area) return;
    const areaRect = els.area.getBoundingClientRect();
    const top = rect.top - areaRect.top - 42;
    const left = rect.left - areaRect.left + rect.width / 2;

    if (els.float) {
      els.float.style.display = 'block';
      const fw = els.float.offsetWidth || 96;
      let fl = left - fw / 2;
      fl = Math.max(8, Math.min(areaRect.width - fw - 8, fl));
      els.float.style.left = fl + 'px';
      els.float.style.top = Math.max(6, top) + 'px';
    }
    if (els.toolbar) {
      els.toolbar.classList.add('show');
      const tw = els.toolbar.offsetWidth || 220;
      let tl = left - tw / 2;
      tl = Math.max(8, Math.min(areaRect.width - tw - 8, tl));
      els.toolbar.style.left = tl + 'px';
      els.toolbar.style.top = Math.max(6, top) + 'px';
    }
  }

  function showFloating(range) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    let rect = null;
    try { rect = range.getBoundingClientRect(); } catch (e) {}
    if (!rect || (!rect.width && !rect.height)) {
      const rects = range.getClientRects();
      rect = rects.length ? rects[rects.length - 1] : null;
    }
    if (!rect) { hideFloating(); return; }
    positionFloating(rect);
  }

  function hideFloating() {
    if (els.float) els.float.style.display = 'none';
    if (els.toolbar) els.toolbar.classList.remove('show');
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const info = computeSelection();
      if (!info) hideFloating();
    }, 180);
  }

  /* ---------- 小节定位 / 光标所在小节 ---------- */
  function headingsOf() {
    if (!els.body) return [];
    const out = [];
    const kids = Array.from(els.body.childNodes);
    let ordinal = 0;
    kids.forEach(function (n) {
      if (n.nodeType === 1 && /^h[1-3]$/i.test(n.tagName || '')) {
        out.push({ node: n, key: n.getAttribute('data-section') || ('i' + ordinal), ordinal: ordinal });
        ordinal++;
      }
    });
    return out;
  }

  function caretSection() {
    if (!els.body) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!els.body.contains(range.startContainer)) return null;
    let node = range.startContainer;
    while (node && node.parentNode !== els.body) node = node.parentNode;
    if (!node) return null;
    const kids = Array.from(els.body.childNodes);
    const upto = kids.indexOf(node);
    const list = headingsOf();
    let current = null;
    list.forEach(function (h) {
      if (upto >= kids.indexOf(h.node)) current = h;
    });
    const title = current ? (current.node.textContent || '').replace(/\u00a0/g, ' ').trim() : '';
    return { key: current ? current.key : null, title: title || '', actId: currentActId };
  }

  function scrollToSection(key) {
    if (!els.body || !key) return false;
    const list = headingsOf();
    const target = list.find(function (h) { return h.key === key; });
    if (!target) return false;
    const scroller = els.scroll || els.area;
    if (scroller) {
      const top = target.node.offsetTop - 72;
      scroller.scrollTop = Math.max(0, top);
    }
    try {
      const range = document.createRange();
      const walker = document.createTreeWalker(els.body, NodeFilter.SHOW_TEXT, null);
      walker.currentNode = target.node;
      const t = walker.nextNode();
      if (t) range.setStart(t, 0); else range.setStartAfter(target.node);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      els.body.focus();
    } catch (e) {}
    hideFloating();
    return true;
  }

  let caretTimer = null;
  function reportCaret() {
    if (caretTimer) return;
    caretTimer = setTimeout(function () {
      caretTimer = null;
      const info = caretSection();
      if (window.Outline && Outline.setActiveSection && info) Outline.setActiveSection(info.actId, info.key);
      if (window.OutlineFloat && window.OutlineFloat.onCaretChange) window.OutlineFloat.onCaretChange(info);
    }, 140);
  }

  /* ---------- 选择文本助手（供 AI 面板使用） ---------- */
  function getSelectionText() {
    const info = computeSelection();
    if (info) { savedSelection = { text: info.text, range: info.range, actId: currentActId }; return info.text; }
    if (savedSelection.text && savedSelection.actId === currentActId) return savedSelection.text;
    return '';
  }

  function restoreSavedSelection() {
    if (!savedSelection.range) return false;
    if (savedSelection.actId !== currentActId) return false;
    if (!els.body.contains(savedSelection.range.commonAncestorContainer) && !els.title.contains(savedSelection.range.commonAncestorContainer)) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelection.range);
    return true;
  }

  /** 用文本替换选中内容（用于采纳 AI 结果） */
  function replaceSelection(text) {
    if (!text) return false;
    els.body.focus();
    const restored = restoreSavedSelection();
    const sel = window.getSelection();
    if (!restored || !sel || !sel.rangeCount || sel.isCollapsed) {
      placeCaretAtEnd(els.body);
    }
    const blocks = String(text).split(/\n+/).map(s => s.trim()).filter(Boolean);
    let ok = false;
    try {
      if (blocks.length <= 1) {
        ok = document.execCommand('insertText', false, blocks[0] || String(text).trim());
      } else {
        const html = blocks.map(b => '<p>' + U.escapeHtml(b) + '</p>').join('');
        ok = document.execCommand('insertHTML', false, html);
      }
    } catch (e) { ok = false; }
    if (!ok) {
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        range.insertNode(document.createTextNode(blocks.join('\n')));
      }
    }
    savedSelection = { text: '', range: null, actId: currentActId };
    onEdited();
    return true;
  }

  function insertText(text) {
    els.body.focus();
    placeCaretAtEnd(els.body);
    document.execCommand('insertText', false, text);
    onEdited();
  }

  /* ---------- 编辑事件 ---------- */
  function onEdited() {
    if (applying) return;
    syncToModel();
    scheduleSnapshot();
    if (window.App) window.App.refreshStats();
    updateSelectionUI();
  }

  /* ---------- 载入 / 切换章节 ---------- */
  function loadAct(act) {
    flushSnapshot();
    applying = true;
    currentActId = act ? act.id : null;
    if (els.title) els.title.textContent = act ? act.title : '';
    if (els.body) els.body.innerHTML = act ? (act.html || '') : '';
    applying = false;
    savedSelection = { text: '', range: null, actId: currentActId };
    renderSelectionInfo('');
    hideFloating();
    if (act) {
      if (!stacks.has(act.id)) resetStack(act.id, act.html || '');
      else notifyHistChange();
    }
    if (els.scroll) els.scroll.scrollTop = 0;
    if (window.App) window.App.refreshStats();
  }

  function focusBody() {
    if (els.body) {
      els.body.focus();
      placeCaretAtEnd(els.body);
    }
  }

  /* ---------- 粘贴 / 拖放 ---------- */
  function onPaste(e) {
    const clip = e.clipboardData;
    if (!clip) return;
    const files = Array.from(clip.files || []);
    if (files.length) {
      const img = files.find(f => /^image\//.test(f.type));
      if (img) {
        e.preventDefault();
        U.toast('暂不支持直接粘贴图片，可存为文件后在「设置 → 壁纸」中上传', 'warn');
        return;
      }
      e.preventDefault();
      return;
    }
    const text = clip.getData('text/plain');
    if (text === null || text === undefined) return;
    e.preventDefault();
    const blocks = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    try {
      if (blocks.length <= 1) {
        document.execCommand('insertText', false, String(text).replace(/\r\n/g, '\n').trim());
      } else {
        document.execCommand('insertHTML', false, blocks.map(b => '<p>' + U.escapeHtml(b).replace(/\n/g, '<br>') + '</p>').join(''));
      }
    } catch (err) {
      document.execCommand('insertText', false, text);
    }
    onEdited();
  }

  function onDrop(e) {
    // 只允许文本拖放，文件拖放交给主进程/忽略
    if (e.dataTransfer && Array.from(e.dataTransfer.files || []).length) {
      e.preventDefault();
      U.toast('暂不支持拖入文件', 'warn');
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    q();
    if (!els.body) return;

    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
    els.body.setAttribute('data-placeholder', '在这里开始你的故事…（可选中文字后使用右侧 AI 改写）');

    ['input', 'keyup', 'mouseup'].forEach(evt => {
      els.body.addEventListener(evt, () => onEdited());
    });
    els.title.addEventListener('input', () => { syncToModel(); scheduleSnapshot(); if (window.App) window.App.refreshStats(); });
    els.title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); els.body.focus(); placeCaretAtEnd(els.body); }
    });

    els.body.addEventListener('paste', onPaste);
    els.body.addEventListener('drop', onDrop);
    els.title.addEventListener('paste', onPaste);
    els.title.addEventListener('drop', onDrop);

    els.body.addEventListener('blur', () => { flushSnapshot(); });
    els.title.addEventListener('blur', () => { flushSnapshot(); });

    document.addEventListener('selectionchange', () => {
      if (applying) return;
      updateSelectionUI();
      reportCaret();
    });

    els.body.addEventListener('scroll', hideFloating);
    if (els.scroll) els.scroll.addEventListener('scroll', () => hideFloating());

    // 悬浮按钮：保持选区不丢失
    if (els.float) {
      els.float.addEventListener('mousedown', (e) => e.preventDefault());
      els.float.addEventListener('click', (e) => {
        e.stopPropagation();
        hideFloating();
        if (window.AIPanel) window.AIPanel.focusPrompt();
      });
    }
    if (els.toolbar) {
      els.toolbar.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') e.preventDefault();
      });
      els.toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-ctx]');
        if (!btn) return;
        e.stopPropagation();
        hideFloating();
        const kind = btn.getAttribute('data-ctx');
        if (window.AIPanel) window.AIPanel.runContextAction(kind);
      });
    }

    document.addEventListener('mousedown', (e) => {
      if (els.float && els.float.contains(e.target)) return;
      if (els.toolbar && els.toolbar.contains(e.target)) return;
      scheduleHide();
    });
  }

  window.Editor = {
    init, loadAct, focusBody, flushSnapshot,
    undo, redo, canUndo, canRedo,
    getSelectionText, replaceSelection, insertText,
    onEdited, syncToModel,
    scrollToSection, caretSection, headingsOf, reportCaret,
    getCurrentActId: () => currentActId
  };
})();
