'use strict';
/* 项目数据模型：新建 / 读取 / 序列化 / 脏标记 / 章节与小节 / 自动保存
   两级结构：章（act）= 一个编辑页；节（section）= 正文里的 <h2 data-section="id"> 标题锚点 */
(function () {
  const U = window.U;

  const SCHEMA_VERSION = 1;
  const SECTION_ATTR = 'data-section';
  const HEADING_RE = /^h[1-3]$/i;

  let project = null;
  let filePath = null;
  let dirty = false;
  let lastSavedAt = 0;

  function nowIso() { return new Date().toISOString(); }

  function emptyAct(index) {
    return actFromSections('第' + (index + 1) + '章：未命名章节', []);
  }

  function createDefault(title) {
    const p = {
      version: SCHEMA_VERSION,
      meta: {
        title: title || '未命名剧本',
        author: '',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        app: 'AI Script Studio',
        summary: ''
      },
      acts: [
        actFromSections('第一章：未命名章节', [])
      ],
      activeActId: null,
      outline: [],
      history: []
    };
    p.activeActId = p.acts[0].id;
    return p;
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return createDefault();
    const p = {
      version: SCHEMA_VERSION,
      meta: Object.assign({ title: '未命名剧本', author: '', createdAt: nowIso(), updatedAt: nowIso(), summary: '' }, raw.meta || {}),
      acts: [],
      activeActId: raw.activeActId || null,
      outline: Array.isArray(raw.outline) ? raw.outline : [],
      history: Array.isArray(raw.history) ? raw.history.slice(0, 80) : []
    };
    const acts = Array.isArray(raw.acts) ? raw.acts : [];
    acts.forEach((a, i) => {
      if (!a || typeof a !== 'object') return;
      p.acts.push({
        id: a.id || U.uid('act'),
        title: (a.title || '第' + (i + 1) + '章').toString(),
        html: typeof a.html === 'string' ? a.html : (typeof a.content === 'string' ? a.content : '<p><br></p>')
      });
    });
    if (!p.acts.length) p.acts.push(emptyAct(0));
    const ids = p.acts.map(a => a.id);
    if (!p.activeActId || ids.indexOf(p.activeActId) < 0) p.activeActId = p.acts[0].id;
    return p;
  }

  function setProject(raw, path) {
    project = normalize(raw);
    filePath = path || null;
    dirty = false;
    lastSavedAt = path ? Date.now() : 0;
    return project;
  }

  /** 直接挂接一个已经规范化的项目对象（多文档切换时使用，保持引用不复制） */
  function attach(model, path, dirtyFlag) {
    project = model || null;
    filePath = path || null;
    dirty = !!dirtyFlag;
    lastSavedAt = path ? Date.now() : 0;
    return project;
  }

  function get() { return project; }
  function getFilePath() { return filePath; }
  function setFilePath(p) { filePath = p; }
  function isDirty() { return dirty; }
  function setDirty(v) { dirty = !!v; }
  function markDirty() {
    dirty = true;
    if (project) {
      project.meta = project.meta || {};
      project.meta.updatedAt = nowIso();
    }
    if (window.App) window.App.onDirtyChanged();
  }
  function markSaved(path) {
    dirty = false;
    if (path) filePath = path;
    lastSavedAt = Date.now();
    if (window.App) window.App.onDirtyChanged();
  }
  function getLastSavedAt() { return lastSavedAt; }

  function getAct(id) {
    if (!project) return null;
    const target = id || project.activeActId;
    return project.acts.find(a => a.id === target) || null;
  }

  function setActiveAct(id) {
    if (!project) return null;
    if (project.acts.some(a => a.id === id)) {
      project.activeActId = id;
      return getAct(id);
    }
    return null;
  }

  function addAct(title) {
    if (!project) return null;
    const act = {
      id: U.uid('act'),
      title: title || ('第' + (project.acts.length + 1) + '章：未命名章节'),
      html: '<p><br></p>'
    };
    project.acts.push(act);
    markDirty();
    return act;
  }

  function insertActAfter(id, act) {
    if (!project) return act;
    const idx = project.acts.findIndex(a => a.id === id);
    if (idx < 0) { project.acts.push(act); return act; }
    project.acts.splice(idx + 1, 0, act);
    markDirty();
    return act;
  }

  function removeAct(id) {
    if (!project) return false;
    if (project.acts.length <= 1) return false;
    const idx = project.acts.findIndex(a => a.id === id);
    if (idx < 0) return false;
    project.acts.splice(idx, 1);
    if (project.activeActId === id) {
      const next = project.acts[Math.min(idx, project.acts.length - 1)];
      project.activeActId = next.id;
    }
    markDirty();
    return true;
  }

  function moveAct(id, dir) {
    if (!project) return false;
    const idx = project.acts.findIndex(a => a.id === id);
    if (idx < 0) return false;
    const target = idx + dir;
    if (target < 0 || target >= project.acts.length) return false;
    const tmp = project.acts[idx];
    project.acts[idx] = project.acts[target];
    project.acts[target] = tmp;
    markDirty();
    return true;
  }

  function setTitle(title) {
    if (!project) return;
    project.meta.title = title || '未命名剧本';
    markDirty();
  }

  function setActTitle(id, title) {
    const act = getAct(id);
    if (!act) return;
    act.title = title || '未命名章节';
    markDirty();
  }

  function setActHtml(id, html) {
    const act = getAct(id);
    if (!act) return;
    act.html = html;
    markDirty();
  }

  /* ==================== 小节（section） ==================== */
  function parseHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div;
  }

  function isHeading(node) {
    return !!(node && node.nodeType === 1 && HEADING_RE.test(node.tagName || ''));
  }

  function sectionKey(node, ordinal) {
    const attr = node && node.getAttribute ? node.getAttribute(SECTION_ATTR) : '';
    return attr || ('i' + ordinal);
  }

  /** 把章正文切成 前置块 + 若干小节块组 */
  function splitBlocks(html) {
    const div = parseHtml(html);
    const nodes = Array.from(div.childNodes);
    const head = [];
    const groups = [];
    nodes.forEach((n) => {
      if (isHeading(n)) {
        groups.push({ heading: n, nodes: [], ordinal: groups.length });
      } else if (groups.length) {
        groups[groups.length - 1].nodes.push(n);
      } else {
        head.push(n);
      }
    });
    return { div, head, groups };
  }

  /** 读出某章的所有小节（含字数） */
  function sectionsOfAct(act) {
    if (!act) return [];
    const { groups } = splitBlocks(act.html);
    return groups.map((g) => {
      let words = 0;
      let chars = 0;
      let has = false;
      g.nodes.forEach((n) => {
        const t = (n.textContent || '').replace(/\u00a0/g, ' ');
        words += U.countWords(t);
        chars += U.countChars(t);
        if (t.trim()) has = true;
      });
      const title = (g.heading.textContent || '').replace(/\u00a0/g, ' ').trim() || '未命名小节';
      return {
        id: sectionKey(g.heading, g.ordinal),
        title: title,
        words: words,
        chars: chars,
        has: has
      };
    });
  }

  function sectionTitleOf(act, key) {
    const list = sectionsOfAct(act);
    const found = list.find(s => s.id === key);
    return found ? found.title : '';
  }

  function newSectionId() { return U.uid('sec'); }

  /** 在指定小节之后（或章末）插入一个小节标题 + 空段 */
  function insertSection(actId, title, afterSectionId) {
    const act = getAct(actId);
    if (!act) return null;
    const { div, groups } = splitBlocks(act.html);
    const id = newSectionId();
    const h = document.createElement('h2');
    h.setAttribute(SECTION_ATTR, id);
    h.textContent = title || ('小节 ' + (groups.length + 1));
    const p = document.createElement('p');
    p.appendChild(document.createElement('br'));

    let inserted = false;
    if (afterSectionId) {
      const idx = groups.findIndex(g => sectionKey(g.heading, g.ordinal) === afterSectionId);
      if (idx >= 0) {
        const next = groups[idx + 1];
        const ref = next ? next.heading : null;
        if (ref) {
          div.insertBefore(h, ref);
          div.insertBefore(p, ref);
        } else {
          div.appendChild(h);
          div.appendChild(p);
        }
        inserted = true;
      }
    }
    if (!inserted) {
      div.appendChild(h);
      div.appendChild(p);
    }
    act.html = div.innerHTML;
    markDirty();
    return { id: id, title: h.textContent };
  }

  /** 从正文里改掉小节的标题 */
  function renameSection(actId, key, title) {
    const act = getAct(actId);
    if (!act) return false;
    const { div, groups } = splitBlocks(act.html);
    const target = groups.find(g => sectionKey(g.heading, g.ordinal) === key);
    if (!target) return false;
    target.heading.textContent = title || '未命名小节';
    if (!target.heading.getAttribute(SECTION_ATTR)) target.heading.setAttribute(SECTION_ATTR, key);
    act.html = div.innerHTML;
    markDirty();
    return true;
  }

  /** 删除小节（连同其正文） */
  function removeSection(actId, key) {
    const act = getAct(actId);
    if (!act) return false;
    const { div, groups } = splitBlocks(act.html);
    const idx = groups.findIndex(g => sectionKey(g.heading, g.ordinal) === key);
    if (idx < 0) return false;
    const g = groups[idx];
    if (g.heading.parentNode) g.heading.parentNode.removeChild(g.heading);
    g.nodes.forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
    act.html = div.innerHTML;
    markDirty();
    return true;
  }

  /** 小节上下移动（连同正文块） */
  function moveSection(actId, key, dir) {
    const act = getAct(actId);
    if (!act) return false;
    const parsed = splitBlocks(act.html);
    const groups = parsed.groups;
    const idx = groups.findIndex(g => sectionKey(g.heading, g.ordinal) === key);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= groups.length) return false;
    const tmp = groups[idx];
    groups[idx] = groups[target];
    groups[target] = tmp;
    const div = document.createElement('div');
    parsed.head.forEach((n) => div.appendChild(n));
    groups.forEach((g) => {
      div.appendChild(g.heading);
      g.nodes.forEach((n) => div.appendChild(n));
    });
    act.html = div.innerHTML;
    markDirty();
    return true;
  }

  /** 用「章标题 + 小节数组」造一章 */
  function actFromSections(title, sections) {
    const div = document.createElement('div');
    (sections || []).forEach((sec) => {
      const h = document.createElement('h2');
      h.setAttribute(SECTION_ATTR, newSectionId());
      h.textContent = (sec && sec.title) || '未命名小节';
      div.appendChild(h);
      const paras = Array.isArray(sec && sec.paragraphs) ? sec.paragraphs : [];
      paras.forEach((t) => {
        const p = document.createElement('p');
        p.textContent = String(t || '');
        if (!p.textContent) p.appendChild(document.createElement('br'));
        div.appendChild(p);
      });
    });
    return {
      id: U.uid('act'),
      title: title || '未命名章节',
      html: div.innerHTML || '<p><br></p>'
    };
  }

  /* ---------- 统计 ---------- */
  function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    div.querySelectorAll('p,div,h1,h2,h3,li,br').forEach(n => { n.insertAdjacentText('afterend', '\n'); });
    return (div.textContent || '').replace(/\u00a0/g, ' ');
  }

  function stats() {
    if (!project) return { words: 0, chars: 0, acts: [] };
    let words = 0;
    let chars = 0;
    const perAct = project.acts.map(a => {
      const text = htmlToText(a.html);
      const w = U.countWords(text);
      const c = U.countChars(text);
      words += w; chars += c;
      return { id: a.id, title: a.title, words: w, chars: c, sections: sectionsOfAct(a).length };
    });
    return { words, chars, acts: perAct };
  }

  /* ---------- 导出序列化 ---------- */
  function blocksOfAct(act) {
    const div = document.createElement('div');
    div.innerHTML = act.html || '';
    const blocks = [];
    const walk = (parent) => {
      Array.from(parent.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = (node.textContent || '').trim();
          if (t) blocks.push({ type: 'p', text: t });
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName.toLowerCase();
        if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
          const t = (node.textContent || '').trim();
          if (t) blocks.push({ type: 'h2', text: t });
          return;
        }
        if (tag === 'ul' || tag === 'ol') {
          Array.from(node.querySelectorAll('li')).forEach((li) => {
            const t = (li.textContent || '').trim();
            if (t) blocks.push({ type: 'p', text: '· ' + t });
          });
          return;
        }
        if (tag === 'br') return;
        const inner = (node.textContent || '').replace(/\u00a0/g, ' ').trim();
        if (!inner) return;
        if (node.querySelector && node.querySelector('p,div,h1,h2,h3,li')) walk(node);
        else blocks.push({ type: 'p', text: inner });
      });
    };
    walk(div);
    return blocks;
  }

  function toExportPayload() {
    if (!project) return { title: '未命名剧本', acts: [] };
    return {
      title: project.meta.title,
      author: project.meta.author,
      acts: project.acts.map(a => ({ id: a.id, title: a.title, blocks: blocksOfAct(a) }))
    };
  }

  /* ---------- 序列化存储 ---------- */
  function toSaveObject() {
    if (!project) return null;
    return {
      version: SCHEMA_VERSION,
      meta: project.meta,
      acts: project.acts,
      activeActId: project.activeActId,
      outline: project.outline || [],
      history: (project.history || []).slice(0, 60)
    };
  }

  /* ---------- AI 记录 ---------- */
  function addHistory(entry) {
    if (!project) return null;
    const item = Object.assign({
      id: U.uid('h'),
      at: Date.now(),
      actId: project.activeActId,
      status: 'pending'
    }, entry || {});
    if (typeof item.original === 'string' && item.original.length > 8000) item.original = item.original.slice(0, 8000) + '…';
    if (typeof item.result === 'string' && item.result.length > 12000) item.result = item.result.slice(0, 12000) + '…';
    project.history = project.history || [];
    project.history.unshift(item);
    if (project.history.length > 60) project.history.length = 60;
    markDirty();
    return item;
  }

  function updateHistory(id, patch) {
    if (!project || !project.history) return;
    const item = project.history.find(h => h.id === id);
    if (!item) return;
    Object.assign(item, patch || {});
    markDirty();
  }

  function clearHistory() {
    if (!project) return;
    project.history = [];
    markDirty();
  }

  window.Project = {
    SCHEMA_VERSION, SECTION_ATTR,
    createDefault, normalize, setProject, attach,
    get, getFilePath, setFilePath,
    isDirty, setDirty, markDirty, markSaved, getLastSavedAt,
    getAct, setActiveAct, addAct, insertActAfter, removeAct, moveAct,
    setTitle, setActTitle, setActHtml,
    splitBlocks, sectionsOfAct, sectionTitleOf, insertSection, renameSection, removeSection, moveSection,
    actFromSections, newSectionId,
    stats, htmlToText, blocksOfAct, toExportPayload, toSaveObject,
    addHistory, updateHistory, clearHistory
  };
})();
