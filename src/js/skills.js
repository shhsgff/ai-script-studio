'use strict';
/* 技能库（renderer 侧）：把 DSH 技能目录里的 SKILL.md 列出来，供 AI 面板勾选、
 * 设置页里新建/编辑。技能会被两种情况用到：
 *   - 模型直连：把技能正文拼进系统提示词（equivalent to 「风格规则卡」）
 *   - 本地 AI Agent：把技能名交给 dsh，由 agent 自己用 skill 工具加载
 */
(function () {
  const U = window.U;
  const els = {};
  let cache = [];           // 技能元数据
  let loading = false;
  let editing = null;       // { file, name, description, content }
  let lastRoot = '';

  function q() {
    els.mode = document.getElementById('aiModeSelect');
    els.row = document.getElementById('aiSkillRow');
    els.pick = document.getElementById('btnSkillPick');
    els.pop = document.getElementById('skillPop');
    els.popList = document.getElementById('skillPopList');
    els.popClose = document.getElementById('skillPopClose');
    els.popManage = document.getElementById('skillPopManage');
    els.popHint = document.getElementById('skillPopHint');

    els.list = document.getElementById('skillList');
    els.rootHint = document.getElementById('skillRootHint');
    els.newBtn = document.getElementById('skillNew');
    els.openFolder = document.getElementById('skillOpenFolder');
    els.refresh = document.getElementById('skillRefresh');
    els.editor = document.getElementById('skillEditor');
    els.name = document.getElementById('skillName');
    els.desc = document.getElementById('skillDesc');
    els.content = document.getElementById('skillContent');
    els.save = document.getElementById('skillSave');
    els.del = document.getElementById('skillDelete');
    els.cancel = document.getElementById('skillCancel');
    els.editHint = document.getElementById('skillEditHint');
  }

  function selected() {
    const api = (window.Store && window.Store.get().api) || {};
    return Array.isArray(api.skills) ? api.skills.slice() : [];
  }

  async function setSelected(names) {
    const api = (window.Store && window.Store.get().api) || {};
    await window.Store.patch({ api: Object.assign({}, api, { skills: names }) });
    renderPicker();
    updatePanelButton();
  }

  function updatePanelButton() {
    if (!els.pick) return;
    const names = selected();
    els.pick.textContent = names.length ? ('已选 ' + names.length + ' 个技能') : '未选择技能';
    els.pick.title = names.length ? names.join('、') : '点这里选择技能';
  }

  function mode() {
    return (els.mode && els.mode.value) || ((window.Store.get().api || {}).mode || 'direct');
  }

  function aiModeLabel() {
    return mode() === 'agent' ? 'Agent 会自己加载技能' : '技能规则会拼进系统提示词';
  }

  /* ---------- 右侧面板的技能浮层 ---------- */
  function renderPicker() {
    if (!els.popList) return;
    els.popList.innerHTML = '';
    const names = selected();
    if (loading) {
      els.popList.appendChild(U.el('div', { class: 'skill-empty', text: '正在读取技能目录…' }));
      return;
    }
    if (!cache.length) {
      els.popList.appendChild(U.el('div', { class: 'skill-empty', text: '技能目录里还没有技能。点「管理技能库」新建一个，例如「冷峻武侠文风」。' }));
      return;
    }
    cache.forEach(function (item) {
      const on = names.indexOf(item.name) >= 0;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = on;
      box.addEventListener('change', function () {
        const cur = selected();
        const idx = cur.indexOf(item.name);
        if (box.checked && idx < 0) cur.push(item.name);
        if (!box.checked && idx >= 0) cur.splice(idx, 1);
        setSelected(cur);
      });
      const nameLine = U.el('div', { class: 'sp-name', text: item.name });
      const descLine = U.el('div', { class: 'sp-desc', text: (item.description || '（无描述）').slice(0, 120) });
      const label = U.el('label', { class: 'skill-pop-item' }, [box, U.el('div', {}, [nameLine, descLine])]);
      els.popList.appendChild(label);
    });
  }

  function openPicker() {
    if (!els.pop) return;
    els.pop.hidden = false;
    if (els.popHint) els.popHint.textContent = aiModeLabel();
    if (!cache.length) refresh();
    renderPicker();
  }

  function closePicker() {
    if (els.pop) els.pop.hidden = true;
  }

  function togglePicker() {
    if (els.pop && !els.pop.hidden) closePicker();
    else openPicker();
  }

  /* ---------- 设置页：技能列表 / 编辑器 ---------- */
  function renderManager() {
    if (!els.list) return;
    els.list.innerHTML = '';
    if (els.rootHint) els.rootHint.textContent = lastRoot ? ('目录：' + lastRoot) : '';
    if (loading) {
      els.list.appendChild(U.el('div', { class: 'skill-empty', text: '正在读取…' }));
      return;
    }
    if (!cache.length) {
      els.list.appendChild(U.el('div', { class: 'skill-empty', text: '还没有技能。点「新建技能」写一份，例如：冷峻武侠文风 / 悬疑节奏 / 人物口吻表。' }));
      return;
    }
    cache.forEach(function (item) {
      const node = U.el('div', { class: 'skill-item', 'data-file': item.file }, [
        U.el('div', { class: 'si-main' }, [
          U.el('div', { class: 'si-name', text: item.name }),
          U.el('div', { class: 'si-desc', text: item.description || '（无描述）' })
        ]),
        U.el('div', { class: 'si-src', text: item.sourceLabel || item.source || '' })
      ]);
      if (editing && editing.file === item.file) node.classList.add('active');
      node.addEventListener('click', function () { openEditor(item.file); });
      els.list.appendChild(node);
    });
  }

  async function openEditor(file) {
    if (!file) {
      editing = { file: '', name: '', description: '', content: '' };
    } else {
      const r = await window.api.skillsRead(file);
      if (!r.ok) { U.toast(r.error || '读取技能失败', 'error'); return; }
      editing = {
        file: file,
        name: r.skill.name,
        description: r.skill.description,
        content: r.skill.body || ''
      };
    }
    if (els.editor) els.editor.hidden = false;
    if (els.name) els.name.value = editing.name;
    if (els.desc) els.desc.value = editing.description;
    if (els.content) els.content.value = editing.content;
    if (els.editHint) els.editHint.textContent = editing.file ? '正在编辑已有技能' : '新建技能';
    if (els.del) els.del.disabled = !editing.file;
    renderManager();
    if (els.name) els.name.focus();
  }

  function closeEditor() {
    editing = null;
    if (els.editor) els.editor.hidden = true;
    renderManager();
  }

  async function saveEditor() {
    const name = (els.name && els.name.value || '').trim();
    if (!name) { U.toast('请先填写技能名称', 'warn'); if (els.name) els.name.focus(); return; }
    const payload = {
      file: editing && editing.file ? editing.file : '',
      name: name,
      description: (els.desc && els.desc.value || '').trim(),
      content: (els.content && els.content.value || '')
    };
    const r = await window.api.skillsSave(payload);
    if (!r.ok) { U.toast(r.error || '保存失败', 'error'); return; }
    U.toast('技能已保存，DSH 下次调用就能看到它', 'success');
    await refresh();
    if (r.file) openEditor(r.file);
  }

  async function deleteEditor() {
    if (!editing || !editing.file) return;
    const ok = await U.confirmBox({
      title: '删除技能',
      message: '确定删除技能「' + (editing.name || '') + '」？文件会从磁盘上移除。',
      okText: '删除', danger: true
    });
    if (!ok) return;
    const r = await window.api.skillsRemove(editing.file);
    if (!r.ok) { U.toast(r.error || '删除失败', 'error'); return; }
    U.toast('技能已删除', 'success');
    closeEditor();
    await refresh();
  }

  /* ---------- 数据刷新 ---------- */
  async function refresh() {
    loading = true;
    renderPicker();
    renderManager();
    try {
      const r = await window.api.skillsList();
      if (r && r.ok) {
        cache = r.items || [];
        lastRoot = r.root || '';
      } else {
        cache = [];
        if (r && r.error) U.toast('读取技能目录失败：' + r.error, 'error');
      }
    } catch (e) {
      cache = [];
    }
    loading = false;
    renderPicker();
    renderManager();
    updatePanelButton();
  }

  /* 取选中技能的正文（模型直连模式用来拼提示词） */
  async function bodies(names) {
    const wanted = (names || []).map(function (s) { return String(s).toLowerCase(); });
    if (!wanted.length) return [];
    const out = [];
    for (let i = 0; i < cache.length; i++) {
      const item = cache[i];
      if (wanted.indexOf(String(item.name).toLowerCase()) < 0) continue;
      try {
        const r = await window.api.skillsRead(item.file);
        if (r && r.ok) out.push({ name: item.name, content: String(r.skill.body || '').slice(0, 6000) });
      } catch (e) { /* ignore */ }
    }
    return out;
  }

  function bind() {
    if (els.pick) els.pick.addEventListener('click', togglePicker);
    if (els.popClose) els.popClose.addEventListener('click', closePicker);
    if (els.popManage) els.popManage.addEventListener('click', function () {
      closePicker();
      if (window.SettingsPanel) window.SettingsPanel.open('ai');
      setTimeout(function () { if (els.list && els.list.scrollIntoView) els.list.scrollIntoView({ block: 'center' }); }, 260);
    });
    if (els.newBtn) els.newBtn.addEventListener('click', function () { openEditor(''); });
    if (els.openFolder) els.openFolder.addEventListener('click', async function () {
      const r = await window.api.skillsOpenFolder();
      if (r && r.dir) U.status('技能目录：' + r.dir);
    });
    if (els.refresh) els.refresh.addEventListener('click', refresh);
    if (els.save) els.save.addEventListener('click', saveEditor);
    if (els.del) els.del.addEventListener('click', deleteEditor);
    if (els.cancel) els.cancel.addEventListener('click', closeEditor);
    if (els.mode) {
      els.mode.addEventListener('change', async function () {
        const api = window.Store.get().api || {};
        await window.Store.patch({ api: Object.assign({}, api, { mode: els.mode.value }) });
        if (window.App) window.App.refreshApiStatus();
        if (els.popHint) els.popHint.textContent = aiModeLabel();
        U.toast(els.mode.value === 'agent'
          ? '已切到本地 AI Agent：改写会交给本机 dsh，能加载技能，但会慢一些'
          : '已切回模型直连：秒级流式返回', '', 4200);
      });
    }
    // 点浮层外部关闭
    document.addEventListener('click', function (e) {
      if (!els.pop || els.pop.hidden) return;
      if (els.pop.contains(e.target)) return;
      if (els.pick && els.pick.contains(e.target)) return;
      closePicker();
    });
  }

  function syncModeSelect() {
    if (!els.mode) return;
    const m = (window.Store.get().api || {}).mode || 'direct';
    els.mode.value = m === 'agent' ? 'agent' : 'direct';
  }

  function init() {
    q();
    bind();
    syncModeSelect();
    updatePanelButton();
    refresh();
  }

  window.Skills = {
    init: init,
    refresh: refresh,
    selected: selected,
    setSelected: setSelected,
    bodies: bodies,
    mode: mode,
    syncModeSelect: syncModeSelect,
    updatePanelButton: updatePanelButton,
    openPicker: openPicker,
    closePicker: closePicker
  };
})();
