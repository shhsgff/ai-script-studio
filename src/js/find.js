'use strict';
/* 查找 / 替换：全文档查找（CSS Highlight API 高亮），替换作用于当前章节 */
(function () {
  const U = window.U;
  const els = {};
  let query = '';
  let ranges = [];        // 当前章节内的匹配 Range
  let curIdx = -1;        // 当前章节内索引
  let found = false;
  let lastActCache = null; // { actId, query, ranges }

  const supportsHighlight = (typeof CSS !== 'undefined') && !!CSS.highlights && (typeof Highlight !== 'undefined');

  function q() {
    els.bar = document.getElementById('findBar');
    els.input = document.getElementById('findInput');
    els.replace = document.getElementById('replaceInput');
    els.count = document.getElementById('findCount');
    els.prev = document.getElementById('findPrev');
    els.next = document.getElementById('findNext');
    els.one = document.getElementById('findReplaceOne');
    els.all = document.getElementById('findReplaceAll');
    els.close = document.getElementById('findClose');
    els.body = document.getElementById('actBody');
  }

  function isOpen() { return els.bar && els.bar.classList.contains('show'); }

  function open() {
    if (!els.bar) return;
    els.bar.classList.add('show');
    if (els.input) {
      els.input.focus();
      els.input.select();
    }
    if (query) doSearch();
  }

  function close() {
    if (!els.bar) return;
    els.bar.classList.remove('show');
    clearHighlights();
    ranges = [];
    curIdx = -1;
    if (window.Editor) window.Editor.focusBody();
  }

  function clearHighlights() {
    if (!supportsHighlight) return;
    try {
      CSS.highlights.delete('find-match');
      CSS.highlights.delete('find-current');
    } catch (e) {}
  }

  /* ---------- 搜索 ---------- */
  function collectRanges(root, needle) {
    const out = [];
    if (!root || !needle) return out;
    const q2 = needle.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n = walker.nextNode();
    while (n) { nodes.push(n); n = walker.nextNode(); }
    // 拼接全文，记录每个节点的起始偏移
    let full = '';
    const offsets = [];
    nodes.forEach((node) => {
      offsets.push({ node: node, start: full.length, end: full.length + node.nodeValue.length });
      full += node.nodeValue;
    });
    const lower = full.toLowerCase();
    let idx = 0;
    while ((idx = lower.indexOf(q2, idx)) >= 0) {
      const start = idx;
      const end = idx + q2.length;
      const startNode = offsets.find(o => start >= o.start && start < o.end);
      const endNode = offsets.find(o => end > o.start && end <= o.end);
      if (startNode && endNode) {
        try {
          const range = document.createRange();
          range.setStart(startNode.node, start - startNode.start);
          range.setEnd(endNode.node, end - endNode.start);
          out.push(range);
        } catch (e) {}
      }
      idx = end;
    }
    return out;
  }

  function countInText(text) {
    if (!query || !text) return 0;
    const t = text.toLowerCase();
    const qs = query.toLowerCase();
    let n = 0, i = 0;
    while ((i = t.indexOf(qs, i)) >= 0) { n++; i += qs.length; }
    return n;
  }

  function docTotal() {
    const p = Project.get();
    if (!p || !query) return 0;
    const activeId = p.activeActId;
    let total = 0;
    p.acts.forEach(a => {
      if (a.id === activeId) total += ranges.length;
      else total += countInText(Project.htmlToText(a.html));
    });
    return total;
  }

  function toNextAct() {
    const p = Project.get();
    if (!p) return false;
    const idx = p.acts.findIndex(a => a.id === p.activeActId);
    for (let k = 1; k <= p.acts.length; k++) {
      const a = p.acts[(idx + k) % p.acts.length];
      if (a.id === p.activeActId) continue;
      if (countInText(Project.htmlToText(a.html)) > 0) {
        if (window.Outline) window.Outline.switchTo(a.id);
        return true;
      }
    }
    return false;
  }

  function doSearch(keepIndex) {
    query = els.input ? els.input.value : '';
    if (!query) {
      ranges = [];
      curIdx = -1;
      clearHighlights();
      if (els.count) els.count.textContent = '0/0';
      return;
    }
    const body = document.getElementById('actBody');
    ranges = collectRanges(body, query);
    if (!keepIndex || curIdx >= ranges.length) curIdx = ranges.length ? 0 : -1;
    paint();
    updateCount();
    if (ranges.length) {
      found = true;
      focusCurrent();
    }
  }

  function buildOtherActRanges() {
    // 其它章节的匹配数（仅计数）
    const p = Project.get();
    if (!p) return 0;
    let n = 0;
    p.acts.forEach(a => {
      if (a.id === p.activeActId) return;
      n += countInText(Project.htmlToText(a.html));
    });
    return n;
  }

  function paint() {
    if (!supportsHighlight) return;
    try {
      if (ranges.length) {
        CSS.highlights.set('find-match', new Highlight(...ranges));
        if (curIdx >= 0 && ranges[curIdx]) CSS.highlights.set('find-current', new Highlight(ranges[curIdx]));
        else CSS.highlights.delete('find-current');
      } else {
        clearHighlights();
      }
    } catch (e) {}
  }

  function updateCount() {
    if (!els.count) return;
    const others = buildOtherActRanges();
    const total = ranges.length + others;
    if (!total) {
      els.count.textContent = query ? '0/0' : '0/0';
      els.count.style.color = query ? 'var(--warn)' : '';
      return;
    }
    els.count.style.color = '';
    const cur = (curIdx >= 0 && ranges.length) ? (curIdx + 1) : 0;
    els.count.textContent = ranges.length ? (cur + '/' + total) : ('0/' + total);
  }

  function focusCurrent() {
    const r = ranges[curIdx];
    if (!r) return;
    paint();
    try {
      const node = r.startContainer.parentElement || r.startContainer;
      if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {}
    updateCount();
  }

  function next() {
    if (!query) { doSearch(); return; }
    if (!ranges.length) {
      if (toNextAct()) { setTimeout(() => { doSearch(); }, 80); }
      else U.status('未找到「' + query + '」');
      return;
    }
    if (curIdx < ranges.length - 1) {
      curIdx++;
      focusCurrent();
    } else {
      if (toNextAct()) {
        curIdx = -1;
        setTimeout(() => { doSearch(); }, 90);
      } else {
        curIdx = 0;
        focusCurrent();
        U.status('已回到本章第一处匹配');
      }
    }
  }

  function prev() {
    if (!query) { doSearch(); return; }
    if (!ranges.length) { U.status('未找到「' + query + '」'); return; }
    if (curIdx > 0) {
      curIdx--;
      focusCurrent();
    } else {
      curIdx = ranges.length - 1;
      focusCurrent();
    }
  }

  /* ---------- 替换（当前章节） ---------- */
  function replaceOne() {
    if (!ranges.length || curIdx < 0) return;
    const repl = els.replace ? els.replace.value : '';
    const r = ranges[curIdx];
    try {
      r.deleteContents();
      r.insertNode(document.createTextNode(repl));
    } catch (e) { U.toast('替换失败', 'error'); return; }
    if (window.Editor) window.Editor.onEdited();
    const keep = curIdx;
    doSearch(true);
    if (curIdx >= ranges.length) curIdx = Math.max(0, ranges.length - 1);
    else curIdx = Math.min(keep, ranges.length - 1);
    paint();
    updateCount();
  }

  function replaceAll() {
    if (!ranges.length) { U.toast('当前章节没有匹配项', 'warn'); return; }
    const repl = els.replace ? els.replace.value : '';
    const n = ranges.length;
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i];
      try {
        r.deleteContents();
        r.insertNode(document.createTextNode(repl));
      } catch (e) {}
    }
    if (window.Editor) window.Editor.onEdited();
    const p = Project.get();
    const others = buildOtherActRanges();
    doSearch(true);
    curIdx = ranges.length ? 0 : -1;
    paint();
    updateCount();
    U.toast('已在当前章节替换 ' + n + ' 处' + (others ? '（另有 ' + others + ' 处位于其它章节，需切换到对应章节替换）' : ''), 'success');
  }

  /* ---------- 初始化 ---------- */
  let timer = null;
  function init() {
    q();
    if (!els.bar) return;

    if (els.input) {
      els.input.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; doSearch(); }, 180);
      });
      els.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? prev() : next(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }
    if (els.replace) {
      els.replace.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }
    if (els.next) els.next.addEventListener('click', next);
    if (els.prev) els.prev.addEventListener('click', prev);
    if (els.one) els.one.addEventListener('click', replaceOne);
    if (els.all) els.all.addEventListener('click', replaceAll);
    if (els.close) els.close.addEventListener('click', close);
  }

  /** 章节切换后刷新 */
  function onActChanged() {
    if (!isOpen() || !query) return;
    doSearch();
  }

  window.Find = { init, open, close, next, prev, replaceOne, replaceAll, onActChanged, isOpen };
})();
