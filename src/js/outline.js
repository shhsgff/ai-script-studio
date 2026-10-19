'use strict';
/* 左侧剧本目录：章 → 节 两级树，增删改排序、切换、折叠 */
(function () {
  const U = window.U;
  const els = {};
  const collapsed = new Set();
  let pending = null;
  let activeSectionKey = null;

  function q() {
    els.list = document.getElementById('outlineList');
    els.add = document.getElementById('btnAddAct');
    els.count = document.getElementById('outlineCount');
    els.words = document.getElementById('outlineWords');
    els.title = document.getElementById('projectTitle');
  }

  function activeId() {
    const p = Project.get();
    return p ? p.activeActId : null;
  }

  function render(opts) {
    if (!els.list) return;
    if (opts && opts.immediate) { if (pending) { clearTimeout(pending); pending = null; } doRender(); return; }
    if (pending) return;
    pending = setTimeout(function () { pending = null; doRender(); }, 130);
  }

  function doRender() {
    if (!els.list) return;
    const p = Project.get();
    if (!p) { els.list.innerHTML = ''; return; }
    const actId = activeId();
    const frag = document.createDocumentFragment();

    p.acts.forEach(function (act, i) {
      const isActive = act.id === actId;
      const secs = Project.sectionsOfAct(act);
      const isCollapsed = collapsed.has(act.id);

      const row = U.el('div', {
        class: 'outline-item' + (isActive ? ' active' : ''),
        'data-id': act.id,
        title: act.title,
        draggable: 'false'
      }, [
        U.el('div', { class: 'outline-row' }, [
          U.el('button', {
            class: 'fold-btn' + (isCollapsed ? ' folded' : ''),
            type: 'button',
            'data-tool': 'fold',
            title: isCollapsed ? '展开小节' : '折叠小节',
            text: secs.length ? '▾' : '·'
          }),
          U.el('span', { class: 'num', text: String(i + 1) }),
          U.el('div', { class: 'label', text: act.title }),
          U.el('div', { class: 'row-tools' }, [
            U.el('button', { title: '上移本章', text: '↑', 'data-tool': 'up' }),
            U.el('button', { title: '下移本章', text: '↓', 'data-tool': 'down' }),
            U.el('button', { title: '在本章新增小节', text: '＋', 'data-tool': 'addSec' }),
            U.el('button', { class: 'del', title: '删除本章', text: '✕', 'data-tool': 'del' })
          ])
        ])
      ]);

      if (secs.length && !isCollapsed) {
        const secWrap = U.el('div', { class: 'section-list' });
        secs.forEach(function (sec) {
          const current = isActive && activeSectionKey === sec.id;
          const s = U.el('div', {
            class: 'section-item' + (current ? ' current' : '') + (sec.has ? ' written' : ' empty'),
            'data-act': act.id,
            'data-sec': sec.id,
            title: sec.title + ' · ' + U.formatNumber(sec.words) + ' 字'
          }, [
            U.el('span', { class: 's-dot' }),
            U.el('div', { class: 's-title', text: sec.title }),
            U.el('span', { class: 's-words', text: sec.words ? U.formatNumber(sec.words) : '' }),
            U.el('div', { class: 'row-tools' }, [
              U.el('button', { title: '上移小节', text: '↑', 'data-tool': 'secUp' }),
              U.el('button', { title: '下移小节', text: '↓', 'data-tool': 'secDown' }),
              U.el('button', { class: 'del', title: '删除小节', text: '✕', 'data-tool': 'secDel' })
            ])
          ]);
          s.addEventListener('dblclick', function (e) {
            if (e.target.closest('.row-tools')) return;
            startRenameSection(act.id, sec.id);
          });
          secWrap.appendChild(s);
        });
        row.appendChild(secWrap);
      }
      frag.appendChild(row);
    });

    els.list.innerHTML = '';
    els.list.appendChild(frag);

    if (els.title && document.activeElement !== els.title) els.title.value = p.meta.title || '';
    updateFooter();
  }

  function updateFooter(stats) {
    const p = Project.get();
    if (!p) return;
    let secCount = 0;
    p.acts.forEach(function (a) { secCount += Project.sectionsOfAct(a).length; });
    if (els.count) els.count.textContent = '共 ' + p.acts.length + ' 章 · ' + secCount + ' 节';
    if (stats && els.words) els.words.textContent = U.formatNumber(stats.words) + ' 字';
    else if (els.words) els.words.textContent = U.formatNumber(Project.stats().words) + ' 字';
  }

  function switchTo(actId, opts) {
    const p = Project.get();
    if (!p) return;
    if (window.Editor) window.Editor.flushSnapshot();
    const act = Project.setActiveAct(actId);
    if (!act) return;
    if (window.Editor) window.Editor.loadAct(act);
    activeSectionKey = (opts && opts.sectionKey) || null;
    render({ immediate: true });
    if (window.AIPanel) window.AIPanel.onActChanged();
    if (window.Find) window.Find.onActChanged();
    if (window.App && window.App.onActSwitched) window.App.onActSwitched(act);
    U.status('已切换到「' + act.title + '」');
    if (opts && opts.sectionKey && window.Editor && Editor.scrollToSection) {
      Editor.scrollToSection(opts.sectionKey);
      setActiveSection(act.id, opts.sectionKey);
    }
  }

  function openSection(actId, key) {
    if (Project.get() && Project.get().activeActId === actId) {
      if (window.Editor && Editor.scrollToSection) Editor.scrollToSection(key);
      setActiveSection(actId, key);
      return;
    }
    switchTo(actId, { sectionKey: key });
  }

  function setActiveSection(actId, key) {
    if (Project.get() && Project.get().activeActId !== actId) return;
    if (activeSectionKey === key) {
      paintSectionState();
      return;
    }
    activeSectionKey = key || null;
    paintSectionState();
  }

  function paintSectionState() {
    if (!els.list) return;
    const items = els.list.querySelectorAll('.section-item');
    Array.prototype.forEach.call(items, function (el) {
      const on = el.getAttribute('data-sec') === activeSectionKey;
      el.classList.toggle('current', on);
    });
  }

  function addAct() {
    if (!Project.get()) { U.toast('请先新建剧本', 'warn'); return null; }
    if (window.Editor) window.Editor.flushSnapshot();
    const act = Project.addAct();
    Project.setActiveAct(act.id);
    if (window.Editor) window.Editor.loadAct(act);
    activeSectionKey = null;
    render({ immediate: true });
    if (window.AIPanel) window.AIPanel.onActChanged();
    U.status('已新增「' + act.title + '」');
    setTimeout(function () { startRename(act.id); }, 60);
    return act;
  }

  async function removeAct(actId) {
    const p = Project.get();
    if (!p) return;
    if (p.acts.length <= 1) { U.toast('至少保留一章', 'warn'); return; }
    const act = Project.getAct(actId);
    const ok = await U.confirmBox({
      title: '删除章节',
      message: '确定删除「' + (act ? act.title : '该章节') + '」及其中的全部小节？删除后不可恢复。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    if (window.Editor) window.Editor.flushSnapshot();
    const wasActive = p.activeActId === actId;
    if (!Project.removeAct(actId)) { U.toast('删除失败', 'error'); return; }
    if (wasActive) {
      const next = Project.getAct();
      activeSectionKey = null;
      if (next && window.Editor) window.Editor.loadAct(next);
    }
    render({ immediate: true });
    if (window.App) { window.App.refreshStats(); window.App.onDirtyChanged(); }
    U.status('章节已删除');
  }

  function move(actId, dir) {
    if (window.Editor) window.Editor.flushSnapshot();
    if (Project.moveAct(actId, dir)) { render({ immediate: true }); U.status('顺序已调整'); }
  }

  async function addSection(actId, afterKey) {
    if (!Project.get()) return null;
    if (window.Editor) window.Editor.flushSnapshot();
    const act = Project.getAct(actId);
    if (!act) return null;
    if (Project.get().activeActId !== actId) switchTo(actId);
    const sec = Project.insertSection(actId, '', afterKey || null);
    if (!sec) return null;
    if (window.Editor) {
      window.Editor.loadAct(Project.getAct(actId));
      window.Editor.scrollToSection(sec.id);
    }
    render({ immediate: true });
    if (window.App) window.App.refreshStats();
    setTimeout(function () { startRenameSection(actId, sec.id); }, 80);
    return sec;
  }

  async function removeSection(actId, key) {
    const ok = await U.confirmBox({
      title: '删除小节',
      message: '确定删除这个小节（含其中的正文）？删除后不可恢复。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    if (window.Editor) window.Editor.flushSnapshot();
    if (!Project.removeSection(actId, key)) { U.toast('删除失败', 'error'); return; }
    if (window.Editor && Project.get() && Project.get().activeActId === actId) {
      window.Editor.loadAct(Project.getAct(actId));
    }
    if (activeSectionKey === key) activeSectionKey = null;
    render({ immediate: true });
    if (window.App) { window.App.refreshStats(); window.App.onDirtyChanged(); }
    U.status('小节已删除');
  }

  function moveSection(actId, key, dir) {
    if (window.Editor) window.Editor.flushSnapshot();
    if (!Project.moveSection(actId, key, dir)) return;
    if (window.Editor && Project.get() && Project.get().activeActId === actId) {
      const keep = key;
      window.Editor.loadAct(Project.getAct(actId));
      window.Editor.scrollToSection(keep);
    }
    render({ immediate: true });
    U.status('小节顺序已调整');
  }

  function startRename(actId) {
    const row = els.list.querySelector('.outline-item[data-id="' + actId + '"]');
    if (!row) return;
    const label = row.querySelector('.outline-row .label');
    const act = Project.getAct(actId);
    if (!label || !act) return;
    const input = U.el('input', { type: 'text', value: act.title, maxlength: '80' });
    label.innerHTML = '';
    label.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = function (save) {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (save && val && val !== act.title) {
        Project.setActTitle(actId, val);
        if (Project.get().activeActId === actId) {
          const titleEl = document.getElementById('actTitle');
          if (titleEl) titleEl.textContent = val;
        }
        U.status('章节名已修改');
      }
      render({ immediate: true });
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function startRenameSection(actId, key) {
    const item = els.list.querySelector('.section-item[data-sec="' + key + '"]');
    if (!item) return;
    const titleEl = item.querySelector('.s-title');
    const act = Project.getAct(actId);
    const oldTitle = Project.sectionTitleOf(act, key);
    if (!titleEl) return;
    const input = U.el('input', { class: 'section-rename', type: 'text', value: oldTitle, maxlength: '80' });
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = function (save) {
      if (done) return;
      done = true;
      const val = (input.value || '').trim();
      if (save && val && val !== oldTitle) {
        Project.renameSection(actId, key, val);
        if (window.Editor && Project.get() && Project.get().activeActId === actId) {
          window.Editor.loadAct(Project.getAct(actId));
          window.Editor.scrollToSection(key);
        }
        U.status('小节名已修改');
      }
      render({ immediate: true });
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  function bind() {
    if (els.add) els.add.addEventListener('click', function () { addAct(); });

    if (els.list) {
      els.list.addEventListener('click', function (e) {
        const tool = e.target.closest('button[data-tool]');
        const secRow = e.target.closest('.section-item');
        const actRow = e.target.closest('.outline-item');
        if (!actRow) return;
        const actId = actRow.getAttribute('data-id');

        if (secRow && tool) {
          e.stopPropagation();
          const key = secRow.getAttribute('data-sec');
          const kind = tool.getAttribute('data-tool');
          if (kind === 'secUp') moveSection(actId, key, -1);
          else if (kind === 'secDown') moveSection(actId, key, 1);
          else if (kind === 'secDel') removeSection(actId, key);
          return;
        }
        if (secRow) {
          openSection(actId, secRow.getAttribute('data-sec'));
          return;
        }
        if (tool) {
          e.stopPropagation();
          const kind = tool.getAttribute('data-tool');
          if (kind === 'up') move(actId, -1);
          else if (kind === 'down') move(actId, 1);
          else if (kind === 'del') removeAct(actId);
          else if (kind === 'addSec') addSection(actId, null);
          else if (kind === 'fold') {
            if (collapsed.has(actId)) collapsed.delete(actId); else collapsed.add(actId);
            render({ immediate: true });
          }
          return;
        }
        switchTo(actId);
      });

      els.list.addEventListener('dblclick', function (e) {
        if (e.target.closest('.row-tools')) return;
        const secRow = e.target.closest('.section-item');
        if (secRow) { startRenameSection(secRow.getAttribute('data-act'), secRow.getAttribute('data-sec')); return; }
        const actRow = e.target.closest('.outline-item');
        if (actRow) startRename(actRow.getAttribute('data-id'));
      });
    }

    if (els.title) {
      els.title.addEventListener('input', function () {
        if (!Project.get()) return;
        Project.setTitle(els.title.value);
        if (window.App) window.App.onDirtyChanged();
        if (window.Tabs) Tabs.refresh();
      });
      els.title.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); els.title.blur(); }
      });
    }
  }

  function init() {
    q();
    bind();
    render({ immediate: true });
  }

  window.Outline = {
    init, render, updateFooter, addAct, removeAct, move, switchTo, startRename,
    addSection, removeSection, moveSection, startRenameSection, openSection, setActiveSection,
    getActiveSectionKey: () => activeSectionKey
  };
})();
