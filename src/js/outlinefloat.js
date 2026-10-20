'use strict';
/* 故事大纲浮窗：跟随光标高亮当前章节/小节，灰色＝还没写，浅色＝已写 */
(function () {
  const U = window.U;
  const els = {};
  let open = false;
  let dragState = null;
  let refreshTimer = null;
  let caret = { actId: null, key: null };

  function cfg() {
    const s = (window.Store && Store.get()) || {};
    const ui = s.ui || {};
    return Object.assign({ open: false, x: 0, y: 0, right: 336, top: 96 }, ui.outlineFloat || {});
  }

  async function saveCfg(patch) {
    if (!window.Store) return;
    const s = Store.get() || {};
    const ui = Object.assign({}, s.ui || {});
    ui.outlineFloat = Object.assign({}, cfg(), patch || {});
    await Store.patch({ ui: ui });
  }

  function q() {
    els.root = document.getElementById('outlineFloat');
    els.head = document.getElementById('ofHead');
    els.body = document.getElementById('ofBody');
    els.close = document.getElementById('ofClose');
    els.refresh = document.getElementById('ofRefresh');
    els.foot = document.getElementById('ofFoot');
    els.importBtn = document.getElementById('ofImport');
    els.editBtn = document.getElementById('ofEdit');
    els.modal = document.getElementById('outlineImportModal');
    els.oiText = document.getElementById('oiText');
    els.oiApply = document.getElementById('oiApply');
    els.oiResult = document.getElementById('oiResult');
    els.oiOk = document.getElementById('oiOk');
    els.oiCancel = document.getElementById('oiCancel');
    els.oiClose = document.getElementById('oiClose');
  }

  /* ---------- 计划大纲（作者先建 / 导入，AI 照着写） ---------- */
  function progressOf(id) {
    return Project.outlineProgress().find(function (x) { return x.item.id === id; }) || null;
  }

  function jumpNow(pp) {
    if (!pp) return;
    try {
      if (pp.sec && window.Outline) Outline.openSection(pp.act.id, pp.sec.id);
      else if (pp.act && window.Outline) Outline.switchTo(pp.act.id);
    } catch (e) {}
  }

  function jumpTo(id) {
    const pp = progressOf(id);
    if (!pp) return;
    if (pp.linked) { jumpNow(pp); return; }
    const res = Project.applyOutlineToActs();
    if (res.acts || res.sections) {
      U.status('已按大纲建立目录：新建 ' + res.acts + ' 章 / ' + res.sections + ' 节');
      if (window.App && App.refreshAll) App.refreshAll();
    }
    jumpNow(progressOf(id));
  }

  function editText(elem, item, field) {
    if (!elem || !item) return;
    const original = field === 'note' ? (item.note || '') : (item.title || '');
    elem.setAttribute('contenteditable', 'plaintext-only');
    elem.classList.add('editing');
    elem.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(elem);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
    function finish(commit) {
      elem.removeAttribute('contenteditable');
      elem.classList.remove('editing');
      const val = (elem.textContent || '').replace(/\u00a0/g, ' ').trim();
      if (!commit || (field === 'title' && !val)) {
        elem.textContent = original || (field === 'note' ? '＋备注' : '新节点');
      } else if (val !== original) {
        const patch = {};
        patch[field] = val;
        Project.updateOutlineItem(item.id, patch);
      }
      render();
    }
    elem.addEventListener('blur', function () { finish(true); }, { once: true });
    elem.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); elem.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); elem.textContent = original; elem.blur(); }
    });
  }

  function addNode(afterId, level) {
    const items = Project.outlineList();
    const last = items[items.length - 1];
    const it = Project.addOutlineItem({
      title: '新节点',
      level: level || (last ? 2 : 1),
      afterId: afterId || (last ? last.id : null)
    });
    render();
    const titleEl = els.body.querySelector('[data-ol="' + it.id + '"] .of-plan-title');
    if (titleEl) editText(titleEl, it, 'title');
    return it;
  }

  function renderPlan(frag) {
    const items = Project.outlineList();
    const head = U.el('div', { class: 'of-group-title' }, [
      U.el('span', { text: '计划大纲' }),
      U.el('span', { class: 'of-group-note', text: items.length ? items.length + ' 个节点' : '' })
    ]);
    frag.appendChild(head);
    if (!items.length) {
      frag.appendChild(U.el('div', {
        class: 'of-hint',
        text: '还没有大纲。点右上角 📥 导入文本，或 ＋ 手写节点，AI 就能按它一节一节写。'
      }));
      return;
    }
    Project.outlineProgress().forEach(function (pp) {
      const it = pp.item;
      const isCur = !!(pp.act && pp.sec && caret.actId === pp.act.id && caret.key === pp.sec.id);
      const cls = 'of-plan ' + (it.level === 1 ? 'of-plan-act' : 'of-plan-sec') +
        (pp.written ? ' written' : ' empty') + (isCur ? ' current' : '') + (pp.linked ? '' : ' unlinked');
      const row = U.el('div', { class: cls, 'data-ol': it.id, 'data-level': String(it.level), title: pp.linked ? '点击跳到这一节' : '点击按大纲建立并跳到这一节' });
      row.appendChild(U.el('span', { class: 'of-plan-bullet' }));
      row.appendChild(U.el('span', { class: 'of-plan-title', text: it.title }));
      row.appendChild(U.el('span', {
        class: 'of-plan-note' + (it.note ? '' : ' none'),
        text: it.note || '＋备注'
      }));
      row.appendChild(U.el('span', {
        class: 'of-words',
        text: pp.words ? U.formatNumber(pp.words) : ''
      }));
      row.appendChild(U.el('div', { class: 'of-row-tools' }, [
        U.el('button', { class: 'of-mini', 'data-tool': 'note', title: '改备注（也可以双击备注）', text: '✎' }),
        U.el('button', { class: 'of-mini', 'data-tool': 'add', title: '在下面加一个节点', text: '＋' }),
        U.el('button', { class: 'of-mini', 'data-tool': 'up', title: '上移', text: '↑' }),
        U.el('button', { class: 'of-mini', 'data-tool': 'down', title: '下移', text: '↓' }),
        U.el('button', { class: 'of-mini danger', 'data-tool': 'del', title: '删除这个节点（正文不动）', text: '✕' })
      ]));
      frag.appendChild(row);
    });
  }

  /* ---------- 导入大纲 ---------- */
  function updatePreview() {
    if (!els.oiResult) return;
    const raw = (els.oiText && els.oiText.value) || '';
    if (!raw.trim()) {
      els.oiResult.className = 'oi-preview';
      els.oiResult.textContent = '先粘贴一段大纲文本';
      return;
    }
    const items = Project.parseOutlineText(raw);
    if (!items.length) {
      els.oiResult.className = 'oi-preview bad';
      els.oiResult.textContent = '✗ 没识别出节点，检查一下格式（换行分段、每行一个节点）';
      return;
    }
    const acts = items.filter(function (i) { return i.level === 1; }).length;
    const secs = items.filter(function (i) { return i.level === 2; }).length;
    els.oiResult.className = 'oi-preview ok';
    els.oiResult.textContent = '✓ 识别到 ' + items.length + ' 个节点：' + acts + ' 章 / ' + secs + ' 节 · 第一个「' + items[0].title + '」';
  }

  function openImport() {
    if (!els.modal) return;
    if (els.oiText) {
      els.oiText.value = Project.outlineToText();
      updatePreview();
    }
    els.modal.classList.add('show');
    setTimeout(function () { if (els.oiText) els.oiText.focus(); }, 40);
  }

  function closeImport() {
    if (els.modal) els.modal.classList.remove('show');
  }

  async function doImport() {
    const items = Project.parseOutlineText((els.oiText && els.oiText.value) || '');
    if (!items.length) {
      if (els.oiResult) { els.oiResult.className = 'oi-preview bad'; els.oiResult.textContent = '✗ 没识别出节点'; }
      U.status('没有解析出大纲，检查一下格式', 'warn');
      return;
    }
    if (Project.outlineList().length) {
      const ok = await U.confirmBox({
        title: '替换现有大纲？',
        message: '导入会用新文本替换当前大纲（正文一个字都不会动）。',
        okText: '替换',
        cancelText: '取消'
      });
      if (!ok) return;
    }
    Project.setOutlineItems(items);
    let msg = '已导入 ' + items.length + ' 个大纲节点';
    if (els.oiApply && els.oiApply.checked) {
      const res = Project.applyOutlineToActs();
      msg += '，新建 ' + res.acts + ' 章 / ' + res.sections + ' 节';
    }
    closeImport();
    U.toast(msg, 'success');
    if (window.App && App.refreshAll) App.refreshAll(msg);
    else render();
  }

  function bindPlan() {
    if (!els.body) return;
    els.body.addEventListener('click', function (e) {
      const row = e.target.closest('[data-ol]');
      if (!row) return;
      const id = row.getAttribute('data-ol');
      const tool = e.target.closest('[data-tool]');
      if (tool) {
        e.preventDefault();
        e.stopPropagation();
        const t = tool.getAttribute('data-tool');
        const item = Project.outlineList().find(function (x) { return x.id === id; });
        if (t === 'del') {
          Project.removeOutlineItem(id);
          render();
          U.status('已删除这个大纲节点（正文没动）');
        } else if (t === 'up') {
          if (Project.moveOutlineItem(id, 'up')) render(); else U.status('已经是最上面了', 'warn');
        } else if (t === 'down') {
          if (Project.moveOutlineItem(id, 'down')) render(); else U.status('已经是最下面了', 'warn');
        } else if (t === 'add') {
          addNode(id, Number(row.getAttribute('data-level')) || 2);
        } else if (t === 'note') {
          const noteEl = row.querySelector('.of-plan-note');
          if (noteEl && item) editText(noteEl, item, 'note');
        }
        return;
      }
      if (e.target.isContentEditable) return;
      jumpTo(id);
    });
    els.body.addEventListener('dblclick', function (e) {
      const t = e.target.closest('.of-plan-title, .of-plan-note');
      if (!t) return;
      const row = t.closest('[data-ol]');
      if (!row) return;
      const item = Project.outlineList().find(function (x) { return x.id === row.getAttribute('data-ol'); });
      if (!item) return;
      editText(t, item, t.classList.contains('of-plan-title') ? 'title' : 'note');
    });
  }

  function applyPos() {
    if (!els.root) return;
    const c = cfg();
    els.root.style.setProperty('--of-x', (c.x || 0) + 'px');
    els.root.style.setProperty('--of-y', (c.y || 0) + 'px');
    if (c.x || c.y) {
      els.root.style.left = c.x + 'px';
      els.root.style.top = c.y + 'px';
      els.root.style.right = 'auto';
    } else {
      els.root.style.left = 'auto';
      els.root.style.top = (c.top || 96) + 'px';
      els.root.style.right = (c.right || 336) + 'px';
    }
  }

  function setOpen(on, opts) {
    open = !!on;
    if (!els.root) return;
    els.root.hidden = !open;
    els.root.classList.toggle('show', open);
    if (open) {
      applyPos();
      render();
    }
    if (!(opts && opts.silent)) saveCfg({ open: open });
  }

  function toggle() { setOpen(!open); }

  function emptyNode(text, cls) {
    return U.el('div', { class: 'of-empty ' + (cls || ''), text: text });
  }

  function render() {
    if (!els.body || !open) return;
    const p = window.Project ? Project.get() : null;
    if (!p) {
      els.body.innerHTML = '';
      els.body.appendChild(emptyNode('还没有打开的剧本', 'big'));
      return;
    }
    const activeActId = p.activeActId;
    const frag = document.createDocumentFragment();

    renderPlan(frag);

    frag.appendChild(U.el('div', { class: 'of-group-title' }, [
      U.el('span', { text: '正文目录' }),
      U.el('span', { class: 'of-group-note', text: '灰色＝还没写' })
    ]));

    p.acts.forEach(function (act, i) {
      const isActCurrent = caret.actId ? caret.actId === act.id : act.id === activeActId;
      const secs = Project.sectionsOfAct(act);
      const actWords = (Project.stats().acts.find(function (a) { return a.id === act.id; }) || { words: 0 }).words;

      const head = U.el('div', {
        class: 'of-act' + (isActCurrent && !caret.key ? ' current' : '') +
          (actWords > 0 ? ' written' : ' empty'),
        'data-act': act.id,
        title: act.title
      }, [
        U.el('span', { class: 'of-num', text: String(i + 1) }),
        U.el('span', { class: 'of-act-title', text: act.title }),
        U.el('span', { class: 'of-words', text: actWords ? U.formatNumber(actWords) : '' })
      ]);
      head.addEventListener('click', function () {
        if (window.Outline) Outline.switchTo(act.id);
      });
      frag.appendChild(head);

      secs.forEach(function (sec) {
        const isCurrent = isActCurrent && caret.key === sec.id;
        const row = U.el('div', {
          class: 'of-sec' + (isCurrent ? ' current' : '') + (sec.has ? ' written' : ' empty'),
          'data-act': act.id,
          'data-sec': sec.id,
          title: sec.title + ' · ' + U.formatNumber(sec.words) + ' 字'
        }, [
          U.el('span', { class: 'of-dot' }),
          U.el('span', { class: 'of-sec-title', text: sec.title }),
          U.el('span', { class: 'of-words', text: sec.words ? U.formatNumber(sec.words) : '' })
        ]);
        row.addEventListener('click', function () {
          if (window.Outline) Outline.openSection(act.id, sec.id);
        });
        frag.appendChild(row);
      });
    });

    els.body.innerHTML = '';
    els.body.appendChild(frag);
    if (els.foot) {
      const st = Project.stats();
      els.foot.textContent = '共 ' + p.acts.length + ' 章 · ' + U.formatNumber(st.words) + ' 字 · 灰色＝尚未写';
    }
    const cur = els.body.querySelector('.of-sec.current') || els.body.querySelector('.of-act.current');
    if (cur && cur.scrollIntoView) {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }

  function refresh(opts) {
    if (!open) return;
    if (opts && opts.immediate) { if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; } render(); return; }
    if (refreshTimer) return;
    refreshTimer = setTimeout(function () { refreshTimer = null; render(); }, 220);
  }

  function onCaretChange(info) {
    if (!open) return;
    const next = { actId: info ? info.actId : null, key: info ? info.key : null };
    if (next.actId === caret.actId && next.key === caret.key) return;
    caret = next;
    refresh({ immediate: true });
  }

  function bindDrag() {
    if (!els.head) return;
    els.head.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      const rect = els.root.getBoundingClientRect();
      dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      els.root.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      const x = Math.max(4, Math.min(window.innerWidth - 120, e.clientX - dragState.dx));
      const y = Math.max(4, Math.min(window.innerHeight - 80, e.clientY - dragState.dy));
      els.root.style.left = x + 'px';
      els.root.style.top = y + 'px';
      els.root.style.right = 'auto';
      dragState.x = x;
      dragState.y = y;
    });
    window.addEventListener('mouseup', function () {
      if (!dragState) return;
      const pos = { x: dragState.x || 0, y: dragState.y || 0 };
      dragState = null;
      els.root.classList.remove('dragging');
      saveCfg(pos);
    });
  }

  function init() {
    q();
    if (!els.root) return;
    if (els.close) els.close.addEventListener('click', function () { setOpen(false); U.status('故事大纲浮窗已关闭（设置菜单可重新打开）'); });
    if (els.refresh) els.refresh.addEventListener('click', function () { refresh({ immediate: true }); U.status('大纲已刷新'); });
    if (els.importBtn) els.importBtn.addEventListener('click', openImport);
    if (els.editBtn) els.editBtn.addEventListener('click', function () { addNode(null, null); });
    if (els.oiOk) els.oiOk.addEventListener('click', doImport);
    if (els.oiCancel) els.oiCancel.addEventListener('click', closeImport);
    if (els.oiClose) els.oiClose.addEventListener('click', closeImport);
    if (els.modal) els.modal.addEventListener('click', function (e) { if (e.target === els.modal) closeImport(); });
    if (els.oiText) els.oiText.addEventListener('input', updatePreview);
    bindPlan();
    bindDrag();
    const c = cfg();
    setOpen(c.open, { silent: true });
    if (window.App && App.onOutlineFloatReady) App.onOutlineFloatReady();
  }

  window.OutlineFloat = { init, render, refresh, onCaretChange, setOpen, toggle, isOpen: () => open };
})();
