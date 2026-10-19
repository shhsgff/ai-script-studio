'use strict';
/* 顶部网页式文档标签：切换 / 关闭 / 右键菜单 / 双击重命名 */
(function () {
  const U = window.U;

  const els = {};
  let menu = null;

  function q() {
    els.bar = document.getElementById('tabBar');
    els.strip = document.getElementById('tabStrip');
    els.add = document.getElementById('btnNewTab');
  }

  function refresh() {
    if (!els.strip) return;
    const docs = window.Workspace ? Workspace.list() : [];
    const activeId = window.Workspace ? Workspace.getActiveId() : null;
    els.strip.innerHTML = '';
    if (!docs.length) {
      if (els.bar) els.bar.classList.add('is-empty');
      return;
    }
    if (els.bar) els.bar.classList.remove('is-empty');
    docs.forEach(function (doc) {
      const isActive = doc.id === activeId;
      const tab = U.el('div', {
        class: 'doc-tab' + (isActive ? ' active' : '') + (doc.dirty ? ' dirty' : ''),
        'data-id': doc.id,
        title: doc.title + (doc.filePath ? '\n' + doc.filePath : '\n（尚未保存）')
      }, [
        U.el('span', { class: 'tab-icon', text: '📄' }),
        U.el('span', { class: 'tab-title', text: doc.title || '未命名剧本' }),
        U.el('span', { class: 'tab-dot', text: '●' }),
        U.el('button', { class: 'tab-close', type: 'button', text: '✕', title: '关闭（未保存会提示）' })
      ]);
      els.strip.appendChild(tab);
    });
    const activeTab = els.strip.querySelector('.doc-tab.active');
    if (activeTab && activeTab.scrollIntoView) {
      try { activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    }
  }

  function closeMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
  }

  function showMenu(x, y, doc) {
    closeMenu();
    menu = U.el('div', { class: 'tab-menu', style: 'left:' + x + 'px;top:' + y + 'px;' });
    const items = [
      { label: '重命名剧本…', act: 'rename' },
      { label: '保存', act: 'save' },
      { label: '另存为…', act: 'saveAs' },
      { sep: true },
      { label: '关闭标签', act: 'close' },
      { label: '关闭其他标签', act: 'closeOthers' },
      { label: '关闭全部标签', act: 'closeAll' },
      { sep: true },
      { label: '在文件夹中显示', act: 'reveal' }
    ];
    items.forEach(function (it) {
      if (it.sep) { menu.appendChild(U.el('div', { class: 'tab-menu-sep' })); return; }
      const row = U.el('div', { class: 'tab-menu-item', text: it.label });
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        closeMenu();
        runMenu(it.act, doc);
      });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw - 8) menu.style.left = Math.max(8, vw - rect.width - 8) + 'px';
    if (rect.bottom > vh - 8) menu.style.top = Math.max(8, vh - rect.height - 8) + 'px';
  }

  function runMenu(act, doc) {
    const App = window.App || {};
    if (act === 'rename') return startRename(doc.id);
    if (act === 'save') return App.saveProject && App.saveProject(false);
    if (act === 'saveAs') return App.saveProject && App.saveProject(true);
    if (act === 'close') return App.closeDoc && App.closeDoc(doc.id);
    if (act === 'closeOthers') return App.closeOtherDocs && App.closeOtherDocs(doc.id);
    if (act === 'closeAll') return App.closeAllDocs && App.closeAllDocs();
    if (act === 'reveal') {
      if (doc.filePath && window.api && api.showItemInFolder) api.showItemInFolder(doc.filePath);
      else U.toast('这个剧本还没有保存到磁盘', 'warn');
    }
  }

  function startRename(docId) {
    const tab = els.strip.querySelector('.doc-tab[data-id="' + docId + '"]');
    if (!tab) return;
    const titleEl = tab.querySelector('.tab-title');
    const doc = window.Workspace.getById(docId);
    if (!titleEl || !doc) return;
    const input = U.el('input', { class: 'tab-rename', type: 'text', value: doc.title, maxlength: '80' });
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = function (save) {
      if (done) return;
      done = true;
      const val = (input.value || '').trim();
      if (save && val) {
        if (doc.id === (window.Workspace ? Workspace.getActiveId() : null) && window.Project) {
          Project.setTitle(val);
          if (window.App) App.onDirtyChanged();
        } else {
          if (doc.model && doc.model.meta) doc.model.meta.title = val;
          doc.title = val;
          doc.dirty = true;
          refresh();
        }
      } else {
        refresh();
      }
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
    if (els.add) {
      els.add.addEventListener('click', function () {
        if (window.App && App.newProject) App.newProject();
      });
    }
    if (els.strip) {
      els.strip.addEventListener('click', function (e) {
        const tab = e.target.closest('.doc-tab');
        if (!tab) return;
        const id = tab.getAttribute('data-id');
        if (e.target.closest('.tab-close')) {
          e.stopPropagation();
          if (window.App && App.closeDoc) App.closeDoc(id);
          return;
        }
        if (window.Workspace) Workspace.activate(id);
      });
      els.strip.addEventListener('dblclick', function (e) {
        const tab = e.target.closest('.doc-tab');
        if (!tab) return;
        if (e.target.closest('.tab-close')) return;
        startRename(tab.getAttribute('data-id'));
      });
      els.strip.addEventListener('auxclick', function (e) {
        if (e.button !== 1) return;
        const tab = e.target.closest('.doc-tab');
        if (!tab) return;
        e.preventDefault();
        if (window.App && App.closeDoc) App.closeDoc(tab.getAttribute('data-id'));
      });
      els.strip.addEventListener('contextmenu', function (e) {
        const tab = e.target.closest('.doc-tab');
        if (!tab) return;
        e.preventDefault();
        e.stopPropagation();
        const doc = window.Workspace ? Workspace.getById(tab.getAttribute('data-id')) : null;
        if (doc) showMenu(e.clientX, e.clientY, doc);
      });
    }
    U.$$('.tab-strip-scroll').forEach(function (n) {
      n.addEventListener('wheel', function (e) {
        if (!e.deltaY) return;
        e.preventDefault();
        n.scrollLeft += e.deltaY;
      }, { passive: false });
    });
    document.addEventListener('mousedown', function (e) {
      if (menu && !menu.contains(e.target)) closeMenu();
    });
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
  }

  function init() {
    q();
    bind();
    refresh();
  }

  window.Tabs = { init, refresh, startRename, closeMenu };
})();
