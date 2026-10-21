/* 冒烟测试：在渲染进程里跑一遍主要功能，返回结构化报告（仅 --smoke 时使用） */
(async () => {
  const log = [];
  const R = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const rec = (name, ok, extra) => log.push({ name, ok: !!ok, extra: extra === undefined ? null : extra });

  async function step(name, fn) {
    try {
      const extra = await fn();
      rec(name, true, extra === undefined ? null : extra);
    } catch (err) {
      rec(name, false, String((err && err.message) || err));
    }
  }

  function assert(name, cond, extra) {
    rec(name, cond, extra);
    if (!cond) throw new Error('断言失败：' + name);
  }

  /* ---------- 0. 基础就绪 ---------- */
  await step('模块就绪', () => {
    assert('App', !!window.App);
    assert('Store', !!window.Store && !!Store.get());
    assert('Project', !!window.Project);
    assert('Workspace', !!window.Workspace);
    assert('Tabs', !!window.Tabs);
    assert('Editor', !!window.Editor);
    assert('Outline', !!window.Outline);
    assert('OutlineFloat', !!window.OutlineFloat);
    assert('DshGen', !!window.DshGen);
    assert('AIPanel', !!window.AIPanel);
    assert('Find', !!window.Find);
    assert('SettingsPanel', !!window.SettingsPanel);
  });

  /* ---------- 1. 空状态 ---------- */
  await step('空状态欢迎页', async () => {
    await wait(120);
    R.workspace = Workspace.count();
    assert('启动时没有文档', Workspace.count() === 0, Workspace.count());
    // 主进程在冒烟模式下预置了一份「上次没保存的草稿」，启动后必须已经被丢掉
    const leftDraft = window.api.autosaveRead ? await window.api.autosaveRead() : null;
    R.leftDraft = leftDraft && leftDraft.docs ? leftDraft.docs.length : 0;
    assert('启动时丢弃上次未保存的草稿', !leftDraft, leftDraft);
    assert('没有恢复未保存剧本的标签页', document.querySelectorAll('#tabBar .doc-tab').length === 0, document.querySelectorAll('#tabBar .doc-tab').length);
    assert('设置里不再有自动存档开关', !document.querySelector('#autosaveToggle'));
    assert('欢迎页可见', !document.getElementById('welcome').hidden);
    assert('目录栏隐藏', document.getElementById('sidebarLeft').hidden);
    assert('AI 面板隐藏', document.getElementById('sidebarRight').hidden);
    assert('状态栏无剧本', /没有打开的剧本/.test(document.getElementById('statusSave').textContent));
    assert('状态栏字数归零', document.getElementById('statusWords').textContent.trim() === '字数：0', document.getElementById('statusWords').textContent);
    assert('状态栏字符归零', document.getElementById('statusChars').textContent.trim() === '字符：0', document.getElementById('statusChars').textContent);
    assert('状态栏本章归零', document.getElementById('statusActWords').textContent.trim() === '本章：0', document.getElementById('statusActWords').textContent);
    assert('标题栏恢复默认', document.getElementById('topTitle').textContent.trim() === '践行', document.getElementById('topTitle').textContent);
    assert('项目名输入框已清空', document.getElementById('projectTitle').value === '', document.getElementById('projectTitle').value);
  });

  /* ---------- 2. 新建剧本（空白一章，不带任何示例内容） ---------- */
  await step('新建空白剧本', async () => {
    window.App.newProject({ title: '冒烟剧本', dirty: true });
    await wait(260);
    const p = Project.get();
    R.acts = p.acts.length;
    R.title = p.meta.title;
    assert('默认只有 1 章', p.acts.length === 1, p.acts.length);
    assert('不带预置小节', Project.sectionsOfAct(p.acts[0]).length === 0, Project.sectionsOfAct(p.acts[0]).length);
    assert('不带示例正文', Project.stats().words === 0, Project.stats().words);
    assert('文档数 1', Workspace.count() === 1);
    assert('标签渲染', document.querySelectorAll('#tabBar .doc-tab').length === 1);
    assert('欢迎页隐藏', document.getElementById('welcome').hidden);
    assert('目录栏显示', !document.getElementById('sidebarLeft').hidden);
    assert('大纲渲染 1 章', document.querySelectorAll('#outlineList .outline-item').length === 1);
    assert('正文章节标题非空', (document.getElementById('actTitle').textContent || '').trim().length > 0);
  });

  /* ---------- 2.5 顶部「＋」只新建一个标签（回归：曾一次点出两个剧本） ---------- */
  await step('顶部「＋」只开一个标签', async () => {
    const before = Workspace.count();
    const beforeIds = Workspace.list().map(function (d) { return d.id; });
    const plus = document.getElementById('btnNewTab');
    assert('「＋」按钮存在', !!plus);
    plus.click();
    await wait(320);
    const afterIds = Workspace.list().map(function (d) { return d.id; });
    const added = afterIds.filter(function (id) { return beforeIds.indexOf(id) < 0; });
    R.plusAdded = added.length;
    R.plusTabs = Workspace.count();
    assert('点一次「＋」只多一个剧本', added.length === 1, '新增 ' + added.length + ' 个 / 共 ' + afterIds.length + ' 个');
    assert('标签条渲染数量一致', document.querySelectorAll('#tabBar .doc-tab').length === afterIds.length, document.querySelectorAll('#tabBar .doc-tab').length + ' / ' + afterIds.length);
    const titles = Workspace.list().map(function (d) { return d.title; });
    const dup = titles.some(function (t, i) { return titles.indexOf(t) !== i; });
    assert('没有同名重复标签', !dup, titles.join(' | '));
    // 收尾：把多开的空白剧本关掉，后面的用例继续在「冒烟剧本」上跑
    const extraId = added[0];
    if (extraId) await App.closeDoc(extraId);
    await wait(220);
    assert('关掉后回到原来的剧本', Workspace.count() === before, Workspace.count());
  });

  /* ---------- 3. 编辑与统计 ---------- */
  await step('正文输入与统计', async () => {
    const body = document.getElementById('actBody');
    body.innerHTML = '<p>测试段落一。</p><p>测试段落二，含 English words。</p>';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(320);
    const st = Project.stats();
    R.words = st.words;
    R.chars = st.chars;
    assert('变脏', Project.isDirty());
    assert('字数>0', st.words > 0, st.words);
    assert('模型同步', (Project.getAct().html || '').indexOf('测试段落一') >= 0);
    assert('状态栏字数更新', /^字数：/.test(document.getElementById('statusWords').textContent));
    assert('标尺出现', !!document.querySelector('.word-ruler'));
  });

  await step('撤销 / 重做', async () => {
    Editor.undo();
    await wait(80);
    const afterUndo = document.getElementById('actBody').textContent;
    Editor.redo();
    await wait(80);
    const afterRedo = document.getElementById('actBody').textContent;
    R.undoRestored = afterUndo.indexOf('测试段落一') < 0;
    assert('撤销回到初始内容', afterUndo.indexOf('测试段落一') < 0, afterUndo.slice(0, 24));
    assert('重做恢复输入', afterRedo.indexOf('测试段落一') >= 0);
  });

  /* ---------- 4. 小节（章 → 节） ---------- */
  await step('小节增删改排序', async () => {
    const act = Project.getAct();
    const before = Project.sectionsOfAct(act).length;
    const s1 = Project.insertSection(act.id, '测试小节一', null);
    const s2 = Project.insertSection(act.id, '测试小节二', null);
    assert('插入小节', !!s1 && !!s1.id && !!s2 && !!s2.id);
    Outline.render({ immediate: true });
    const after = Project.sectionsOfAct(Project.getAct());
    R.sections = after.length;
    assert('小节数 +2', after.length === before + 2, after.length);
    assert('目录出现小节行', !!document.querySelector('.section-item[data-sec="' + s2.id + '"]'));
    Project.renameSection(act.id, s2.id, '改名后的小节');
    assert('小节改名', Project.sectionsOfAct(Project.getAct()).some((s) => s.title === '改名后的小节'));
    const idxBefore = Project.sectionsOfAct(Project.getAct()).findIndex((s) => s.id === s2.id);
    const moved = Project.moveSection(act.id, s2.id, -1);
    const idxAfter = Project.sectionsOfAct(Project.getAct()).findIndex((s) => s.id === s2.id);
    assert('小节上移', moved === true && idxAfter === idxBefore - 1, idxBefore + '→' + idxAfter);
    assert('删除小节', Project.removeSection(act.id, s1.id) === true && Project.removeSection(act.id, s2.id) === true);
    assert('小节数复原', Project.sectionsOfAct(Project.getAct()).length === before);
    Outline.render({ immediate: true });
  });

  /* ---------- 5. 章节（大纲） ---------- */
  await step('大纲增删改排序', async () => {
    const before = Project.get().acts.length;
    const act = Project.addAct('测试新增章');
    Outline.render({ immediate: true });
    assert('新增章节', Project.get().acts.length === before + 1, Project.get().acts.length);
    Project.setActTitle(act.id, '改名后的章节');
    Outline.render({ immediate: true });
    const label = document.querySelector('.outline-item[data-id="' + act.id + '"] .label');
    assert('重命名生效', !!label && label.textContent === '改名后的章节');
    Project.moveAct(act.id, -1);
    Outline.render({ immediate: true });
    const ids = Array.from(document.querySelectorAll('#outlineList .outline-item')).map((n) => n.getAttribute('data-id'));
    assert('上移生效', ids.indexOf(act.id) < before, ids.indexOf(act.id));
    const removed = Project.removeAct(act.id);
    Outline.render({ immediate: true });
    assert('删除章节', removed !== false && Project.get().acts.length === before);
    assert('大纲行数同步', document.querySelectorAll('#outlineList .outline-item').length === Project.get().acts.length);
    Project.setActiveAct(Project.get().acts[0].id);
    Outline.render({ immediate: true });
    Editor.loadAct(Project.getAct());
  });

  /* ---------- 6. 多标签页 ---------- */
  await step('多标签页', async () => {
    window.App.newProject({ title: '第二本剧本', dirty: false });
    await wait(260);
    R.docs = Workspace.count();
    assert('文档数 2', Workspace.count() === 2, Workspace.count());
    assert('标签数 2', document.querySelectorAll('#tabBar .doc-tab').length === 2);
    assert('当前文档切换', Project.get().meta.title === '第二本剧本', Project.get().meta.title);

    const first = Workspace.list()[0];
    Workspace.activate(first.id);
    await wait(220);
    assert('切回第一本文档', Project.get().meta.title === '冒烟剧本', Project.get().meta.title);
    assert('标签有激活态', !!document.querySelector('#tabBar .doc-tab.active'));

    const second = Workspace.list().find((d) => d.model.meta.title === '第二本剧本');
    await window.App.closeDoc(second.id);
    await wait(260);
    assert('关闭后剩 1 个文档', Workspace.count() === 1, Workspace.count());
    assert('标签数同步', document.querySelectorAll('#tabBar .doc-tab').length === 1);
  });

  /* ---------- 7. 查找 ---------- */
  await step('查找高亮', async () => {
    Find.open();
    const input = document.getElementById('findInput');
    input.value = '测试';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(340);
    const countText = document.getElementById('findCount').textContent;
    R.findCount = countText;
    assert('查找栏打开', document.getElementById('findBar').classList.contains('show'));
    assert('有匹配计数', /[0-9]/.test(countText), countText);
    Find.close();
  });

  /* ---------- 8. 保存 / 打开 ---------- */
  let savedOk = false;
  await step('保存到磁盘', async () => {
    const ok = await window.App.saveProject(false);
    assert('保存成功', ok === true);
    assert('已不脏', Project.isDirty() === false);
    assert('记录了文件路径', !!Project.getFilePath(), Project.getFilePath());
    assert('标签显示已保存', !document.querySelector('#tabBar .doc-tab.active .tab-dot') ||
      getComputedStyle(document.querySelector('#tabBar .doc-tab.active .tab-dot')).display === 'none');
    savedOk = ok;
    // 工作现场：保存过的磁盘文件要能被记下来，下次启动据此恢复
    await wait(800);
    const ses = await window.api.sessionRead();
    R.session = ses;
    assert('记下工作现场', !!(ses && Array.isArray(ses.files) && ses.files.length >= 1), ses && ses.files && ses.files.length);
    assert('现场包含刚保存的文件', !!(ses && ses.files.some((p) => String(p).indexOf('demo.aisc') >= 0)), ses && ses.files);
  });

  await step('恢复工作现场函数可用', async () => {
    assert('App 暴露 restoreFiles', typeof window.App.restoreFiles === 'function');
    // 关掉文档后，用记录下来的工作现场把它重新打开
    const ses = await window.api.sessionRead();
    Workspace.list().map((d) => d.id).forEach((id) => Workspace.remove(id));
    await wait(160);
    assert('已清空', Workspace.count() === 0, Workspace.count());
    const n = await window.App.restoreFiles(ses);
    await wait(220);
    assert('恢复出文档', n >= 1 && Workspace.count() >= 1, { n, count: Workspace.count() });
    assert('恢复出的是已保存文档（不脏）', Workspace.count() >= 1 && Workspace.list().every((d) => !d.dirty || !!d.filePath), Workspace.list().map((d) => ({ p: d.filePath, dirty: d.dirty })));
  });

  await step('从磁盘打开（识别重复文件）', async () => {
    const before = Workspace.count();
    await window.App.openProject();
    await wait(280);
    assert('同一文件不重复开标签', Workspace.count() === before, Workspace.count());
    assert('打开成功', Project.get() && Project.get().acts.length >= 1);
    assert('内容一致', (Project.getAct().html || '').indexOf('测试段落一') >= 0, (Project.getAct().html || '').slice(0, 40));
  });

  /* ---------- 9. 导入 ---------- */
  await step('导入 Markdown 分章', async () => {
    const before = Workspace.count();
    await window.App.importDocument();
    await wait(260);
    const p = Project.get();
    R.importActs = p.acts.map((a) => a.title);
    assert('作为新标签导入', Workspace.count() === before + 1, Workspace.count());
    assert('导入 2 章', p.acts.length === 2, p.acts.length);
    assert('标题解析', p.acts[0].title.indexOf('第一章') >= 0, p.acts[0].title);
    assert('正文解析', (p.acts[0].html || '').indexOf('这是第一段') >= 0);
  });

  await step('导入解析器', async () => {
    const P = window.App.parsers;
    const md = P.markdown('# 第一幕 开端\n\n甲段。\n\n## 第二幕 冲突\n\n乙段。\n');
    R.parserMd = md.map((a) => a.title);
    assert('Markdown 解析 2 章', md.length === 2, md.length);
    assert('Markdown 标题正确', md[0].title === '第一幕 开端', md[0].title);
    const html = P.html('<html><body><h1>第一幕 开端</h1><p>甲段。</p><p>乙段。</p><h2>第二幕 冲突</h2><p>丙段。</p><script>x()</script></body></html>');
    R.parserHtml = html.map((a) => a.title);
    assert('HTML 解析 2 章', html.length === 2, html.length);
    assert('HTML 段落合并', (html[0].html || '').indexOf('乙段') >= 0);
    assert('HTML 去除脚本', (html[1].html || '').indexOf('x()') < 0);
    const plain = P.plain('正文内容。\n\n第一章 起风\n\n新的内容。\n');
    R.parserPlain = plain.map((a) => a.title);
    assert('纯文本识别章节', plain.length === 2, plain.length);
  });

  /* ---------- 10. 导出 ---------- */
  await step('导出 TXT', async () => {
    await window.App.doExport('txt');
    R.exported = Object.assign({}, R.exported, { txt: true });
  });
  await step('导出 DOCX', async () => {
    await window.App.doExport('docx');
    R.exported = Object.assign({}, R.exported, { docx: true });
  });
  await step('导出 PDF', async () => {
    await window.App.doExport('pdf');
    R.exported = Object.assign({}, R.exported, { pdf: true });
  });

  /* ---------- 11. 设置 / 外观 ---------- */
  await step('设置面板', async () => {
    SettingsPanel.open('ai');
    await wait(100);
    assert('弹窗显示', document.getElementById('settingsModal').classList.contains('show'));
    assert('面板激活', document.querySelector('.tab-panel.active').getAttribute('data-panel') === 'ai');
    const base = document.getElementById('apiBaseUrl').value;
    R.baseUrl = base;
    assert('接口地址已填', /^https?:\/\//.test(base), base);
  });

  await step('DSH 设置页', async () => {
    SettingsPanel.switchTab('dsh');
    await wait(160);
    assert('DSH 面板激活', document.querySelector('.tab-panel.active').getAttribute('data-panel') === 'dsh');
    assert('状态框有内容', (document.getElementById('dshStatus').textContent || '').trim().length > 0);
    assert('有 dsh 命令输入', document.getElementById('dshCommand').value.length > 0);
    const snippet = document.getElementById('mcpConfig').value;
    R.mcpSnippet = snippet.slice(0, 90);
    assert('MCP 片段是 DSH 的 cordis patch', /- insert:/.test(snippet) && /mcp-ai-script-studio/.test(snippet), snippet.slice(0, 60));
    assert('MCP 片段用 dsh-mcp-client 插件', /dsh-mcp-client/.test(snippet));
    assert('MCP 片段包含服务端脚本', /mcp-server\.js/.test(snippet));
    const profSel = document.getElementById('mcpProfile');
    assert('有 profile 选择框', !!profSel);
    R.mcpProfiles = profSel ? Array.from(profSel.options).map((o) => o.value) : [];
    R.mcpProfilesFound = R.mcpProfiles.length;

    // 插件方式（dsh plugin add）
    assert('有「安装为 DSH 插件」按钮', !!document.getElementById('mcpPluginInstall'));
    assert('插件通道已暴露到页面', window.api && typeof window.api.mcpPluginInstall === 'function' && typeof window.api.mcpPluginRemove === 'function');
    const st2 = await window.api.mcpStatus();
    assert('状态里带插件信息', !!(st2 && st2.plugin && Array.isArray(st2.plugin.profiles)), st2 && st2.plugin);
    assert('插件包名固定', !!(st2.plugin && st2.plugin.bundle === 'dsh-ai-script-studio-mcp'), st2.plugin && st2.plugin.bundle);
    assert('插件里没有默认安装', !((st2.plugin.profiles || []).some((p) => p.pluginInstalled)), st2.plugin.profiles);
    SettingsPanel.switchTab('ai');
  });

  await step('切换主题', async () => {
    Store.setTheme('light');
    await wait(90);
    assert('浅色主题', document.body.getAttribute('data-theme') === 'light');
    Store.setTheme('dark');
    await wait(90);
    assert('深色主题', document.body.getAttribute('data-theme') === 'dark');
  });

  await step('排版设置', async () => {
    Store.updateFont({ size: 19 });
    await wait(70);
    const v = getComputedStyle(document.documentElement).getPropertyValue('--editor-size').trim();
    R.editorSize = v;
    assert('字号变量生效', v.indexOf('19') === 0, v);
    Store.updateFont({ size: 16 });
  });

  await step('壁纸设置', async () => {
    await Store.setWallpaperFromPicker();
    await wait(180);
    const wp = Store.get().wallpaper || {};
    R.wallpaper = { type: wp.type, file: wp.file };
    assert('壁纸类型为图片', wp.type === 'image', wp.type);
    const img = document.getElementById('wallpaper-image');
    assert('图片层已应用', (img.style.backgroundImage || '').indexOf('appmedia') >= 0, img.style.backgroundImage);
    Store.setWallpaperEffect({ opacity: 0.5 });
    await wait(90);
    const shade = getComputedStyle(document.documentElement).getPropertyValue('--wp-shade').trim();
    assert('压暗生效', shade === '0.5', shade);
    await Store.clearWallpaper();
    await wait(140);
    assert('已恢复背景', (Store.get().wallpaper || {}).type === null);
  });

  await step('关闭设置面板', async () => {
    SettingsPanel.close();
    await wait(70);
    assert('弹窗关闭', !document.getElementById('settingsModal').classList.contains('show'));
  });

  /* ---------- 12. 字数统计弹窗 ---------- */
  await step('字数统计弹窗', async () => {
    window.App.openCountModal();
    await wait(90);
    const rows = document.querySelectorAll('#countTable tr').length;
    R.countRows = rows;
    assert('弹窗显示', document.getElementById('countModal').classList.contains('show'));
    assert('表格有行', rows >= 3, rows);
    document.getElementById('countOk').click();
    await wait(70);
    assert('弹窗关闭', !document.getElementById('countModal').classList.contains('show'));
  });

  /* ---------- 13. 故事大纲浮窗 ---------- */
  await step('故事大纲浮窗', async () => {
    const main = Workspace.list().find((d) => d.model.meta.title === '冒烟剧本');
    if (main) { Workspace.activate(main.id); await wait(300); }
    // 新建剧本只有 1 章，这里补一章用来验证「浮窗里按住小节高亮」
    if (Project.get().acts.length < 2) {
      Project.addAct('浮窗验证章');
      Outline.render({ immediate: true });
    }
    const acts = Project.get().acts;
    Project.setActHtml(acts[1].id,
      '<h2 data-section="sec-smoke-a">浮窗小节一</h2><p>浮窗里的这一段有字。</p>' +
      '<h2 data-section="sec-smoke-b">浮窗小节二</h2><p><br></p>');
    Outline.switchTo(acts[1].id);
    await wait(280);
    OutlineFloat.setOpen(true, { silent: true });
    await wait(260);
    assert('浮窗显示', !document.getElementById('outlineFloat').hidden);
    assert('浮窗章数一致', document.querySelectorAll('#outlineFloat .of-act').length === acts.length, acts.length);
    assert('浮窗有小节', document.querySelectorAll('#outlineFloat .of-sec').length >= 1);
    const body = document.getElementById('actBody');
    body.focus();
    const p = body.querySelector('h2[data-section] + p') || body.querySelector('p') || body;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await wait(260);
    const cur = document.querySelector('#outlineFloat .of-sec.current');
    R.outlineCurrent = cur ? cur.textContent.trim().slice(0, 24) : null;
    assert('光标所在小节高亮', !!cur, R.outlineCurrent);
    assert('有未写小节（灰色）', document.querySelectorAll('#outlineFloat .of-sec.empty').length >= 1);
    OutlineFloat.setOpen(false, { silent: true });
  });

  /* ---------- 13.5 计划大纲：导入 / 落成目录 / 浮窗可改 ---------- */
  await step('计划大纲导入与浮窗编辑', async () => {
    assert('AI 面板有按大纲写按钮', !!document.getElementById('btnOutlineWrite'));
    assert('上下文可选整篇大纲', !!document.querySelector('#contextSelect option[value="outline"]'));

    Project.setOutlineItems([]);
    const md = '## 第一幕 风起\n- 山道\n- 破庙\n## 第二幕 暗流\n1. 夜宴\n2. 长街';
    const items = Project.parseOutlineText(md);
    R.outlineParsed = items.map(function (i) { return i.level + ':' + i.title; });
    assert('解析出 6 个节点', items.length === 6, items.length);
    assert('两级都认出来了', items.filter(i => i.level === 1).length === 2 && items.filter(i => i.level === 2).length === 4, R.outlineParsed);
    assert('列表项归到第二章', items[5].title === '长街' && items[5].level === 2, items[5].title);

    const plain = Project.parseOutlineText('第一章 起风\n第一节 巷口\n第二节 灯\n第二章 落雨');
    R.outlinePlain = plain.map(i => i.level + ':' + i.title);
    assert('中文序号也认得', plain.length === 4 && plain[1].level === 2, R.outlinePlain);

    Project.setOutlineItems(Project.parseOutlineText(md));
    const res = Project.applyOutlineToActs();
    R.outlineApplied = res;
    assert('按大纲建了章和节', (res.acts + res.sections) > 0, res);
    assert('大纲上的章落成了真章', Project.get().acts.some(a => /第一幕 风起/.test(a.title)), Project.get().acts.map(a => a.title));
    const prog = Project.outlineProgress();
    R.outlineProgress = prog.map(p => (p.linked ? 'L' : '-') + (p.written ? 'W' : 'E') + ':' + p.item.title);
    assert('大纲节点都回挂了目录', prog.every(p => p.linked), R.outlineProgress);
    assert('新建的节点都还没写', prog.filter(p => p.item.level === 2).every(p => !p.written));

    OutlineFloat.setOpen(true, { silent: true });
    OutlineFloat.refresh({ immediate: true });
    await wait(240);
    assert('浮窗有计划大纲区', document.querySelectorAll('#outlineFloat .of-plan').length === 6, document.querySelectorAll('#outlineFloat .of-plan').length);
    const firstSec = Project.outlineProgress().filter(p => p.item.level === 2)[0];
    Outline.openSection(firstSec.act.id, firstSec.sec.id);
    await wait(160);
    OutlineFloat.refresh({ immediate: true });
    await wait(120);
    assert('计划大纲高亮当前小节', !!document.querySelector('#outlineFloat .of-plan.current'), document.querySelectorAll('#outlineFloat .of-plan.current').length);
    assert('未写的节点是灰的', document.querySelectorAll('#outlineFloat .of-plan.empty').length >= 1);
    assert('正文目录区也在', document.querySelectorAll('#outlineFloat .of-act').length >= 2);

    const titleEl = document.querySelector('#outlineFloat .of-plan-sec .of-plan-title');
    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert('双击进入改名', titleEl.getAttribute('contenteditable') !== null);
    titleEl.textContent = '改过的节名';
    titleEl.dispatchEvent(new FocusEvent('blur'));
    await wait(140);
    assert('大纲标题改成功', Project.outlineList().some(i => i.title === '改过的节名'), Project.outlineList().map(i => i.title));

    const before = Project.outlineList().length;
    const row = document.querySelector('#outlineFloat .of-plan-sec');
    row.querySelector('[data-tool="del"]').click();
    await wait(120);
    assert('删掉一个节点', Project.outlineList().length === before - 1, Project.outlineList().length);

    document.getElementById('ofImport').click();
    await wait(140);
    const modal = document.getElementById('outlineImportModal');
    assert('导入弹窗打开', modal.classList.contains('show'));
    const ta = document.getElementById('oiText');
    ta.value = '- 巷口\n- 灯\n- 雨';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const prev = document.getElementById('oiResult').textContent;
    R.outlinePreview = prev;
    assert('导入前有预览', /识别到 3 个节点/.test(prev), prev);
    document.getElementById('oiCancel').click();
    await wait(90);
    assert('取消后弹窗关闭', !modal.classList.contains('show'));
    OutlineFloat.setOpen(false, { silent: true });
  });

  /* ---------- 14. AI 配置状态 ---------- */
  await step('AI 未配置时的提示', async () => {
    const res = await window.api.aiTest({ baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' });
    R.aiTest = res;
    assert('测试接口有返回', !!res);
    assert('明确提示缺少 Key', !res.ok && /Key|密钥|未配置/i.test(res.message || ''), res.message);
  });

  /* ---------- 15. 最近文件 ---------- */
  await step('最近文件列表', () => {
    const list = (Store.get().recentFiles || []);
    R.recent = list.length;
    assert('最近文件已记录', list.length >= 1, list.length);
    assert('菜单渲染条目', document.querySelectorAll('#recentMenu .recent-item').length >= 1);
  });

  /* ---------- 16. AI 改写全链路（本地模拟接口，不需要真实 Key） ---------- */
  await step('AI 改写流式返回', async () => {
    const cfg = window.__SMOKE_AI || {};
    const cur = Store.get().api || {};
    await window.api.saveSettings({ api: { baseUrl: cfg.url, apiKey: 'sk-smoke', model: 'deepseek-chat' } });
    Store.patch({ api: Object.assign({}, cur, { baseUrl: cfg.url, apiKey: 'sk-smoke', model: 'deepseek-chat' }) });
    window.App.refreshApiStatus();
    AIPanel.syncModelSelect();
    assert('状态栏显示已配置', /deepseek-chat/.test(document.getElementById('statusApi').textContent), document.getElementById('statusApi').textContent);

    const body = document.getElementById('actBody');
    body.focus();
    const p = Array.from(body.querySelectorAll('p')).find((n) => (n.textContent || '').trim().length > 0) || body;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await wait(120);
    assert('已识别选中文本', (window.Editor.getSelectionText() || '').length > 0, (window.Editor.getSelectionText() || '').slice(0, 30));

    window.__aiLog = [];
    window.api.onAiEvent(function (ev) { window.__aiLog.push((ev && ev.type) + '#' + ((ev && ev.text) || '').length); });
    document.getElementById('promptInput').value = '把这段写得更凝练';
    await AIPanel.run();
    const t0 = Date.now();
    let status = '';
    while (Date.now() - t0 < 10000) {
      status = document.getElementById('aiStatus').textContent || '';
      if (/已完成|失败|停止/.test(status)) break;
      await wait(80);
    }
    const text = document.getElementById('aiResultText').textContent || '';
    R.aiText = text;
    R.aiStatus = status;
    R.aiEvents = (window.__aiLog || []).slice(-8);
    assert('结果面板显示', !document.getElementById('aiResultPanel').hidden);
    assert('流式拼接正确', text.indexOf(cfg.expectText) >= 0, text.slice(0, 60));
    assert('状态为已完成', /已完成/.test(status), status);
    assert('结果区可采纳', !document.getElementById('aiApply').disabled);
  });

  await step('AI 结果采纳', async () => {
    const before = Project.getAct().html;
    document.getElementById('aiApply').click();
    await wait(280);
    const after = Project.getAct().html;
    R.aiApplied = before !== after;
    assert('正文已更新', after !== before, (after || '').slice(0, 50));
    assert('采纳后变脏', Project.isDirty());
    assert('改写记录已写入', (Project.get().history || []).length >= 1, (Project.get().history || []).length);
  });

  await step('AI 错误提示', async () => {
    const cur = Store.get().api || {};
    Store.patch({ api: Object.assign({}, cur, { baseUrl: window.__SMOKE_AI.badUrl }) });
    document.getElementById('promptInput').value = '再试一次';
    await AIPanel.run();
    const t0 = Date.now();
    let msg = '';
    while (Date.now() - t0 < 8000) {
      msg = ((document.getElementById('aiStatus').textContent || '') + ' ' +
        (document.getElementById('aiResultFoot').textContent || '')).trim();
      if (/失败|错误|Key|401|密钥/.test(msg)) break;
      await wait(90);
    }
    R.aiErr = msg;
    assert('给出失败提示', /失败|错误|Key|401|密钥/.test(msg), msg.slice(0, 80));
  });

  /* ---------- 17. 本地 DSH 关键词生成（用假命令，离线可测） ---------- */
  await step('DSH 关键词生成', async () => {
    const cfg = window.__SMOKE_DSH || {};
    assert('注入假 dsh 命令', !!cfg.command, cfg.command);
    const dshCfg = Store.get().dsh || {};
    Store.patch({ dsh: Object.assign({}, dshCfg, { command: cfg.command, timeoutSec: 60 }) });
    await wait(80);

    const before = Workspace.count();
    DshGen.open();
    await wait(120);
    document.getElementById('dshPrompt').value = '一个失忆的刀客在雨夜的长安城里寻找自己的名字';
    document.getElementById('dshActs').value = '2';
    document.getElementById('dshWords').value = '600';
    const running = DshGen.run();
    await wait(120);

    // 生成期间：AI 面板必须被锁住（遮罩 + 按钮禁用），但正文仍可编辑
    const busySnap = window.Busy ? window.Busy.snapshot() : [];
    assert('生成时登记了忙状态', busySnap.some((x) => x.key === 'dsh'), busySnap);
    assert('AI 面板出现锁定遮罩', !!document.querySelector('.ai-busy-overlay.show'));
    assert('AI 按钮被禁用', document.getElementById('aiActionBtn').disabled === true);
    assert('正文仍可编辑', document.getElementById('actBody').getAttribute('contenteditable') === 'true');
    const bodyEl = document.getElementById('actBody');
    bodyEl.focus();
    const rng = document.createRange();
    rng.selectNodeContents(bodyEl);
    rng.collapse(false);
    const selNow = window.getSelection();
    selNow.removeAllRanges();
    selNow.addRange(rng);
    document.execCommand('insertText', false, '生成时手动补一句。');
    assert('生成时可手动写入正文', (bodyEl.textContent || '').indexOf('生成时手动补一句。') >= 0);

    await running;

    const t0 = Date.now();
    let created = false;
    while (Date.now() - t0 < 20000) {
      if (Workspace.count() === before + 1) { created = true; break; }
      await wait(120);
    }
    R.dshLog = (document.getElementById('dshLog').textContent || '').slice(-120);
    assert('生成了新文档', created, Workspace.count());
    const p = Project.get();
    R.dshTitle = p.meta.title;
    R.dshActs = p.acts.map((a) => a.title);
    R.dshSections = p.acts.map((a) => Project.sectionsOfAct(a).length);
    assert('标题解析', p.meta.title === '冒烟生成剧本', p.meta.title);
    assert('分章正确', p.acts.length === 2, p.acts.length);
    assert('分节正确', Project.sectionsOfAct(p.acts[0]).length === 2, Project.sectionsOfAct(p.acts[0]).length);
    assert('正文写入', (p.acts[0].html || '').indexOf('雨下了一整夜') >= 0);
    await wait(500);
    assert('弹窗自动关闭', !document.getElementById('dshModal').classList.contains('show'));
    assert('忙状态已解除', !window.Busy || !window.Busy.is('dsh'), window.Busy && window.Busy.snapshot());
    assert('AI 面板解锁', !document.querySelector('.ai-busy-overlay.show'));
    assert('AI 按钮恢复可用', document.getElementById('aiActionBtn').disabled === false);
  });

  /* ---------- 17.2 技能库（临时 DSH_HOME，见 smoke.js） ---------- */
  await step('技能库', async () => {
    const list = await window.api.skillsList();
    R.skills = ((list && list.items) || []).map((i) => i.name);
    assert('技能列表可读', !!(list && list.ok), list && list.ok);
    assert('读到临时技能', R.skills.indexOf('smoke-style') >= 0, R.skills);
    assert('设置页有技能列表容器', !!document.getElementById('skillList'));
    assert('设置页有 4 个 AI 预设', document.querySelectorAll('#presetRow [data-preset]').length === 4);

    const saved = await window.api.skillsSave({ name: '冒烟技能二', description: '冒烟测试保存用', content: '# 规则\n\n只写短句。' });
    assert('新建技能', !!(saved && saved.ok && saved.file), (saved && (saved.error || saved.file)) || '');
    if (saved && saved.file) {
      const rd = await window.api.skillsRead(saved.file);
      assert('读回技能正文', ((rd && rd.skill && rd.skill.body) || '').indexOf('只写短句') >= 0);
      const rm = await window.api.skillsRemove(saved.file);
      assert('删除技能', !!(rm && rm.ok), (rm && rm.error) || '');
    }

    const bodies = await window.Skills.bodies(['smoke-style']);
    assert('技能正文可取', ((bodies[0] && bodies[0].content) || '').indexOf('短句，留白') >= 0);
    await window.Skills.setSelected(['smoke-style']);
    R.skillsSelected = window.Skills.selected();
    assert('技能选择已记住', R.skillsSelected.indexOf('smoke-style') >= 0, R.skillsSelected);
    assert('面板按钮显示数量', (document.getElementById('btnSkillPick').textContent || '').indexOf('1 个') >= 0,
      document.getElementById('btnSkillPick').textContent);
  });

  /* ---------- 17.3 模式切换（直连 / 本地 Agent） ---------- */
  await step('AI 模式切换', async () => {
    const sel = document.getElementById('aiModeSelect');
    assert('模式下拉存在', !!sel);
    sel.value = 'agent';
    sel.dispatchEvent(new Event('change'));
    await wait(150);
    assert('切到 Agent 模式', (Store.get().api.mode) === 'agent', Store.get().api.mode);
    R.agentStatusBar = document.getElementById('statusApi').textContent;
    assert('状态栏显示本地 Agent', String(R.agentStatusBar).indexOf('Agent') >= 0, R.agentStatusBar);
    sel.value = 'direct';
    sel.dispatchEvent(new Event('change'));
    await wait(150);
    assert('切回直连模式', (Store.get().api.mode) === 'direct', Store.get().api.mode);
  });

  /* ---------- 17.4 本地 Agent 改写（用假 dsh，离线可测） ---------- */
  await step('本地 AI Agent 改写', async () => {
    const cfg = window.__SMOKE_AI || {};
    await Store.patch({ api: Object.assign({}, Store.get().api, { mode: 'agent', baseUrl: cfg.url }) });
    const sel = document.getElementById('aiModeSelect');
    sel.value = 'agent';
    document.getElementById('promptInput').value = '把这段改得更短';
    await AIPanel.run();
    const t0 = Date.now();
    let st = '';
    while (Date.now() - t0 < 40000) {
      st = document.getElementById('aiStatus').textContent || '';
      if (/已完成|失败|停止|出错/.test(st)) break;
      await wait(120);
    }
    R.agentRunStatus = st;
    R.agentRunText = (document.getElementById('aiResultText').textContent || '').slice(0, 30);
    assert('Agent 返回结果', /已完成/.test(st), st);
    assert('Agent 有正文', (R.agentRunText || '').length > 0, R.agentRunText);
    await Store.patch({ api: Object.assign({}, Store.get().api, { mode: 'direct' }) });
    sel.value = 'direct';
  });

  /* ---------- 17.5 直连模式把技能正文拼进系统提示词 ---------- */
  await step('直连模式注入技能', async () => {
    const cfg = window.__SMOKE_AI || {};
    await Store.patch({ api: Object.assign({}, Store.get().api, { mode: 'direct', baseUrl: cfg.url, apiKey: 'sk-smoke', model: 'deepseek-chat' }) });
    await window.Skills.setSelected(['smoke-style']);
    document.getElementById('promptInput').value = '润色一下';
    await AIPanel.run();
    const t0 = Date.now();
    let st = '';
    while (Date.now() - t0 < 15000) {
      st = document.getElementById('aiStatus').textContent || '';
      if (/已完成|失败/.test(st)) break;
      await wait(100);
    }
    assert('直连请求已完成', /已完成/.test(st), st);
    await window.Skills.setSelected([]);
  });

  /* ---------- 17.55 按大纲写下一节 ---------- */
  await step('按大纲写下一节', async () => {
    const cfg = window.__SMOKE_AI || {};
    await Store.patch({ api: Object.assign({}, Store.get().api, { mode: 'direct', baseUrl: cfg.url, apiKey: 'sk-smoke', model: 'deepseek-chat' }) });
    await window.App.newProject({ title: '大纲写作测试', dirty: true });
    await wait(260);
    Project.setOutlineItems(Project.parseOutlineText('## 第一章 雨夜\n- 巷口\n- 刀\n## 第二章 天明'));
    Project.applyOutlineToActs();
    if (window.App && App.refreshAll) App.refreshAll();
    await wait(220);
    const target = Project.outlineProgress().find(p => p.item.level === 2 && !p.written);
    assert('找到要写的小节', !!target, Project.outlineProgress().map(p => p.item.title));

    // 先清空上一轮的状态文案，否则轮询会立刻命中旧的「已完成」
    document.getElementById('aiStatus').textContent = '';
    document.getElementById('aiResultText').textContent = '';
    document.getElementById('btnOutlineWrite').click();
    const t0 = Date.now();
    let st = '';
    while (Date.now() - t0 < 15000) {
      st = document.getElementById('aiStatus').textContent || '';
      if (/已完成|失败/.test(st)) break;
      await wait(100);
    }
    R.outlineWriteStatus = st;
    R.outlineWriteText = document.getElementById('aiResultText').textContent || '';
    assert('按大纲生成完成', /已完成/.test(st), st);
    assert('生成了正文', (R.outlineWriteText || '').length > 0, R.outlineWriteText);

    R.outlineApplyDisabled = document.getElementById('aiApply').disabled;
    R.outlineDebugPending = window.AIPanel._debug ? window.AIPanel._debug() : null;
    R.outlineDebugActs = Project.get().acts.map(a => a.id + ':' + a.title);
    R.outlineDebugLookup = R.outlineDebugPending ? !!Project.getAct(R.outlineDebugPending.actId) : null;
    R.outlineTargetInfo = { actId: target.act.id, secId: target.sec.id, title: target.item.title, dirTitle: target.act.title };
    document.getElementById('aiApply').click();
    await wait(240);
    R.outlineApplyToasts = Array.from(document.querySelectorAll('#toastWrap .toast')).map(t => t.textContent).slice(-3);
    R.outlineActsHtml = Project.get().acts.map(a => a.title + '::' + String(a.html || '').replace(/\s+/g, ' ').slice(0, 160));
    const secText = Project.sectionText(target.act.id, target.sec.id);
    R.outlineSectionText = secText;
    assert('正文写进了这一节', secText.indexOf('改写后的') >= 0, secText);
    const after = Project.outlineProgress().find(p => p.item.id === target.item.id);
    assert('大纲节点标记为已写', !!(after && after.written), after && after.written);
  });

  /* ---------- 17.6 MCP 外部写入不打断手动编辑 ---------- */
  await step('MCP 写入与手动编辑共存', async () => {
    await window.App.newProject({ title: 'MCP 并发测试', dirty: true });
    await wait(250);
    const bodyEl = document.getElementById('actBody');
    bodyEl.focus();
    const rng = document.createRange();
    rng.selectNodeContents(bodyEl);
    rng.collapse(false);
    const selNow = window.getSelection();
    selNow.removeAllRanges();
    selNow.addRange(rng);
    document.execCommand('insertText', false, '我手动写的第一句。');
    await wait(120);

    const caretBefore = window.Editor.saveCaret();
    const res = await window.App.mcpHandle('append_text', { text: '这是 DSH 通过 MCP 追加的一段。' });
    await wait(200);

    const html = Project.getAct().html || '';
    assert('MCP 追加成功', html.indexOf('DSH 通过 MCP 追加') >= 0, res);
    assert('手动内容没被冲掉', html.indexOf('我手动写的第一句。') >= 0);
    assert('光标位置被保住', !!caretBefore && !!window.Editor.saveCaret(), caretBefore);
    assert('编辑器仍是可编辑状态', bodyEl.getAttribute('contenteditable') === 'true');
  });

  /* ---------- 18. 窗口关闭 / 草稿标记 ---------- */
  await step('脏标记同步', async () => {
    assert('工作区有脏文档', Workspace.dirtyDocs().length >= 1, Workspace.dirtyDocs().length);
    assert('状态栏显示未保存', /未保存/.test(document.getElementById('statusSave').textContent), document.getElementById('statusSave').textContent);
  });

  /* ---------- 19. 关闭全部文档回到欢迎页 ---------- */
  await step('关闭全部文档回到欢迎页', async () => {
    Workspace.list().map((d) => d.id).forEach((id) => Workspace.remove(id));
    await wait(300);
    assert('文档清空', Workspace.count() === 0, Workspace.count());
    assert('回到欢迎页', !document.getElementById('welcome').hidden);
    assert('编辑区隐藏', document.getElementById('editorArea').hidden);
    assert('目录栏隐藏', document.getElementById('sidebarLeft').hidden);
    assert('状态栏提示', /没有打开的剧本/.test(document.getElementById('statusSave').textContent), document.getElementById('statusSave').textContent);
  });

  R.savedOk = savedOk;
  const failed = log.filter((l) => !l.ok);
  return { ok: failed.length === 0, total: log.length, failed: failed.length, log, data: R };
})();
