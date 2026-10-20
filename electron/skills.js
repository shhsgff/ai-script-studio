'use strict';
/* 技能库：管理 DSH 能看到的本地 Skill（<根>/<名字>/SKILL.md 或 <根>/<名字>.md）
 *
 * 为什么写在这里：dsh headless 用的是 headless profile，它只挂了「技能框架」
 * （@deepseek-ai/dsh-skill + dsh-skill-filesystem），没有网页端那堆插件技能；
 * 它能看到的磁盘技能根里，最稳的是 <DSH_HOME>/skills（默认 %USERPROFILE%\.dsh\skills），
 * 与 cwd 无关。所以本软件既在这里读技能列表，也把用户新建的技能写到这里——
 * 这样「AI Agent 调用 Skill 写/润色正文」才真的能跑通。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_READ = 512 * 1024;

function dshHome() {
  const env = process.env.DSH_HOME;
  if (env && String(env).trim()) return String(env).trim();
  return path.join(os.homedir(), '.dsh');
}

function userSkillRoot() {
  return path.join(dshHome(), 'skills');
}

function roots() {
  const list = [
    { source: 'dsh', label: 'DSH 用户技能', dir: userSkillRoot() },
    { source: 'agents', label: '用户 agents 技能', dir: path.join(os.homedir(), '.agents', 'skills') }
  ];
  return list.filter(function (r) { return r.dir; });
}

function isInside(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function findRoot(file) {
  const list = roots();
  for (let i = 0; i < list.length; i++) {
    if (isInside(list[i].dir, file)) return list[i];
  }
  return null;
}

function parseFrontmatter(text) {
  const src = String(text || '');
  const meta = {};
  let body = src;
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (m) {
    body = src.slice(m[0].length);
    const lines = m[1].split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const idx = line.indexOf(':');
      if (idx <= 0) { i++; continue; }
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      i++;
      // YAML 块标量：description: > / | （后面跟缩进行）
      if (/^[>|][+-]?$/.test(val)) {
        const folded = val.charAt(0) === '>';
        const parts = [];
        while (i < lines.length && (/^\s+\S/.test(lines[i]) || !lines[i].trim())) {
          parts.push(lines[i].replace(/^\s+/, '').trim());
          i++;
        }
        val = (folded ? parts.join(' ') : parts.join('\n')).trim();
      } else {
        val = val.replace(/^["']|["']$/g, '');
      }
      if (key) meta[key] = val;
    }
  }
  return { meta: meta, body: body };
}

function firstLine(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return '';
  const line = t.split(/\n/).find(function (s) { return s.trim() && !s.trim().startsWith('#'); });
  return (line || '').trim().slice(0, 140);
}

function readSkill(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = parseFrontmatter(raw);
  const fallbackName = path.basename(file.toLowerCase() === 'skill.md' ? path.dirname(file) : file, '.md');
  const name = String(parsed.meta.name || '').trim() || fallbackName;
  const desc = String(parsed.meta.description || '').trim() || firstLine(parsed.body);
  return {
    name: name,
    description: desc,
    whenToUse: String(parsed.meta.whenToUse || parsed.meta.when_to_use || '').trim(),
    file: file,
    dir: path.dirname(file),
    body: parsed.body,
    raw: raw
  };
}

/* 列出所有可被 dsh 看到的技能 */
function list() {
  const out = [];
  const seen = {};
  roots().forEach(function (root) {
    let entries = [];
    try { entries = fs.readdirSync(root.dir, { withFileTypes: true }); } catch (e) { return; }
    entries.forEach(function (ent) {
      if (ent.name.startsWith('.')) return;
      const full = path.join(root.dir, ent.name);
      let file = null;
      if (ent.isDirectory()) {
        const candidate = path.join(full, 'SKILL.md');
        if (fs.existsSync(candidate)) file = candidate;
      } else if (/\.md$/i.test(ent.name)) {
        file = full;
      }
      if (!file) return;
      let item = null;
      try {
        const info = readSkill(file);
        let st = null;
        try { st = fs.statSync(file); } catch (e) { st = null; }
        item = {
          name: info.name,
          description: info.description,
          whenToUse: info.whenToUse,
          file: file,
          source: root.source,
          sourceLabel: root.label,
          size: st ? st.size : info.raw.length,
          updatedAt: st ? st.mtimeMs : Date.now()
        };
      } catch (e) {
        item = null;
      }
      if (!item) return;
      const key = item.name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
  });
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-Hans-CN'); });
  return { ok: true, root: userSkillRoot(), home: dshHome(), items: out };
}

function read(file) {
  if (!file) return { ok: false, error: '缺少文件路径' };
  const root = findRoot(file);
  if (!root) return { ok: false, error: '只能读取技能目录内的文件' };
  if (!fs.existsSync(file)) return { ok: false, error: '技能文件不存在' };
  const st = fs.statSync(file);
  if (st.size > MAX_READ) return { ok: false, error: '技能文件过大（超过 512KB）' };
  const info = readSkill(file);
  return { ok: true, skill: info };
}

function slugify(name) {
  const src = String(name || '').trim();
  const cleaned = src.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned) return cleaned.slice(0, 60);
  return 'skill-' + Date.now().toString(36);
}

/* 保存（新建或覆盖）技能；返回文件路径与名字 */
function save(o) {
  const opts = o || {};
  const name = String(opts.name || '').trim();
  if (!name) return { ok: false, error: '请先填写技能名称' };
  let file = String(opts.file || '').trim();
  let root = null;
  if (file) {
    root = findRoot(file);
    if (!root) return { ok: false, error: '只能保存到技能目录内' };
  } else {
    root = roots()[0];
    file = path.join(root.dir, slugify(name), 'SKILL.md');
  }
  const desc = String(opts.description || '').trim();
  let content = String(opts.content || '');
  if (!/^---\r?\n/.test(content)) {
    content = '---\nname: ' + name + '\ndescription: ' + (desc || '（未填写描述）') + '\n---\n\n' + content.replace(/^\s+/, '');
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  } catch (e) {
    return { ok: false, error: '写入失败：' + ((e && e.message) || e) };
  }
  let info = null;
  try { info = readSkill(file); } catch (e) { info = null; }
  return { ok: true, file: file, skill: info, root: root.dir };
}

function remove(file) {
  if (!file) return { ok: false, error: '缺少文件路径' };
  const root = findRoot(file);
  if (!root) return { ok: false, error: '只能删除技能目录内的文件' };
  try {
    const dir = path.dirname(file);
    if (path.basename(file).toLowerCase() === 'skill.md' && dir !== root.dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    } else {
      fs.unlinkSync(file);
    }
  } catch (e) {
    return { ok: false, error: '删除失败：' + ((e && e.message) || e) };
  }
  return { ok: true };
}

/* 若干技能的正文，供「技能注入」模式拼进系统提示词 */
function bodies(names) {
  const wanted = (names || []).map(function (s) { return String(s).toLowerCase(); });
  if (!wanted.length) return [];
  const all = list().items;
  const out = [];
  all.forEach(function (item) {
    if (wanted.indexOf(item.name.toLowerCase()) < 0) return;
    try {
      const info = readSkill(item.file);
      out.push({ name: item.name, description: item.description, content: info.body.slice(0, 8000) });
    } catch (e) { /* ignore */ }
  });
  return out;
}

function ensureRoot() {
  try { fs.mkdirSync(userSkillRoot(), { recursive: true }); } catch (e) { /* ignore */ }
  return userSkillRoot();
}

module.exports = {
  list: list,
  read: read,
  save: save,
  remove: remove,
  bodies: bodies,
  roots: roots,
  userSkillRoot: userSkillRoot,
  ensureRoot: ensureRoot,
  dshHome: dshHome,
  parseFrontmatter: parseFrontmatter
};
