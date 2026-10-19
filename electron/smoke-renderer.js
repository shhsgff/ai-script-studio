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
    assert('欢迎页可见', !document.getElementById('welcome').hidden);
    assert('目录栏隐藏', document.getElementById('sidebarLeft').hidden);
    assert('AI 面板隐藏', document.getElementById('sidebarRight').hidden);
    assert('状态栏无剧本', /没有打开的剧本/.test(document.getElementById('statusSave').textContent));
    assert('状态栏字数归零', document.getElementById('statusWords').textContent.trim() === '字数：0', document.getElementById('statusWords').textContent);
    assert('状态栏字符归零', document.getElementById('statusChars').textContent.trim() === '字符：0', document.getElementById('statusChars').textContent);
    assert('状态栏本章归零', document.getElementById('statusActWords').textContent.trim() === '本章：0', document.getElementById('statusActWords').textContent);
    assert('标题栏恢复默认', document.getElementById('topTitle').textContent.trim() === 'AI 智能剧本创作工具', document.getElementById('topTitle').textContent);
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
    await DshGen.run();

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
