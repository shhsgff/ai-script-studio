'use strict';
/* 多文档工作区：顶部标签页 = 一份独立剧本，各自持有项目模型 / 文件路径 / 脏标记 */
(function () {
  const U = window.U;

  const docs = [];
  let activeId = null;

  function notify() {
    if (window.Tabs && window.Tabs.refresh) window.Tabs.refresh();
    if (window.App && window.App.onWorkspaceChanged) window.App.onWorkspaceChanged();
  }

  function active() {
    return docs.find(d => d.id === activeId) || null;
  }

  function list() { return docs.slice(); }
  function count() { return docs.length; }
  function getById(id) { return docs.find(d => d.id === id) || null; }
  function findByPath(fp) {
    if (!fp) return null;
    const norm = String(fp).toLowerCase();
    return docs.find(d => d.filePath && String(d.filePath).toLowerCase() === norm) || null;
  }

  /** 把当前 Project 的脏标记 / 标题 / 路径同步回活动文档 */
  function syncActive() {
    const doc = active();
    if (!doc) return null;
    const p = Project.get();
    if (p) {
      doc.model = p;
      doc.title = (p.meta && p.meta.title) || '未命名剧本';
    }
    doc.dirty = Project.isDirty();
    doc.filePath = Project.getFilePath();
    return doc;
  }

  function create(model, filePath, opts) {
    const o = opts || {};
    const doc = {
      id: U.uid('doc'),
      model: model,
      filePath: filePath || null,
      dirty: !!o.dirty,
      title: (model && model.meta && model.meta.title) || '未命名剧本',
      createdAt: Date.now()
    };
    docs.push(doc);
    if (o.activate !== false || !activeId) activate(doc.id);
    else notify();
    return doc;
  }

  /** 切换活动文档（会先把当前文档状态存回去） */
  function activate(id) {
    if (id === activeId) return active();
    const doc = getById(id);
    if (!doc) return null;
    if (window.Editor && window.Editor.flushSnapshot) window.Editor.flushSnapshot();
    syncActive();
    activeId = doc.id;
    Project.attach(doc.model, doc.filePath, doc.dirty);
    notify();
    if (window.App && window.App.onWorkspaceActivated) window.App.onWorkspaceActivated(doc);
    return doc;
  }

  /** 移除文档（不负责未保存确认），返回被移除的 doc */
  function remove(id) {
    const idx = docs.findIndex(d => d.id === id);
    if (idx < 0) return null;
    const wasActive = docs[idx].id === activeId;
    const doc = docs.splice(idx, 1)[0];
    if (wasActive) {
      activeId = null;
      const next = docs[Math.min(idx, docs.length - 1)] || null;
      if (next) {
        activeId = next.id;
        Project.attach(next.model, next.filePath, next.dirty);
        notify();
        if (window.App && window.App.onWorkspaceActivated) window.App.onWorkspaceActivated(next);
      } else {
        Project.attach(null, null, false);
        notify();
        if (window.App && window.App.onEmptyWorkspace) window.App.onEmptyWorkspace();
      }
    } else {
      notify();
    }
    return doc;
  }

  function closeAll() {
    docs.length = 0;
    activeId = null;
    Project.attach(null, null, false);
    notify();
  }

  function dirtyDocs() {
    syncActive();
    return docs.filter(d => d.dirty);
  }

  function markActiveSaved(path) {
    const doc = active();
    if (!doc) return;
    doc.dirty = false;
    if (path) doc.filePath = path;
    if (doc.model && doc.model.meta) doc.title = doc.model.meta.title;
  }

  window.Workspace = {
    list, count, active, getById, findByPath, create, activate, remove, closeAll,
    syncActive, dirtyDocs, markActiveSaved,
    getActiveId: () => activeId
  };
})();
