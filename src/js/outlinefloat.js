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
    bindDrag();
    const c = cfg();
    setOpen(c.open, { silent: true });
    if (window.App && App.onOutlineFloatReady) App.onOutlineFloatReady();
  }

  window.OutlineFloat = { init, render, refresh, onCaretChange, setOpen, toggle, isOpen: () => open };
})();
