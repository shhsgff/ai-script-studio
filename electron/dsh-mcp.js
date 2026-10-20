'use strict';
/*
 * 把本软件的 MCP server 注册进 DeepSeek Harness。
 *
 * DSH 的 MCP 注册不在「mcpServers」这种 Claude 风格 JSON 里，而是 profile 层的
 * cordis patch YAML：$DSH_HOME/profiles/<profile>/cordis.patch.yml
 * （一个顶层 YAML 数组，元素是 loader patch entry）。
 * 本模块负责：定位 DSH_HOME、列出 profile、幂等写入/撤销条目、用 --dump-config 校验。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ENTRY_ID = 'mcp-ai-script-studio';
const DEFAULT_PLUGIN = '@deepseek-ai/dsh-mcp-client';
const MARK_BEGIN = '# >>> ai-script-studio MCP (auto-added by AI Script Studio) >>>';
const MARK_END = '# <<< ai-script-studio MCP <<<';

function dshHome() {
  const env = (process.env.DSH_HOME || '').trim();
  if (env && fs.existsSync(env)) return env;
  const fallback = path.join(os.homedir(), '.dsh');
  return fallback;
}

function profilesDir() {
  return path.join(dshHome(), 'profiles');
}

function listProfiles() {
  const dir = profilesDir();
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory(); })
      .map(function (d) { return d.name; });
  } catch (e) {
    return { home: dshHome(), dir: dir, exists: false, profiles: [] };
  }
  const profiles = names.map(function (name) {
    const patchFile = path.join(dir, name, 'cordis.patch.yml');
    let text = '';
    try { text = fs.readFileSync(patchFile, 'utf8'); } catch (e) { text = ''; }
    return {
      name: name,
      patchFile: patchFile,
      hasFile: !!text,
      installed: text.indexOf(ENTRY_ID) >= 0
    };
  });
  return { home: dshHome(), dir: dir, exists: true, profiles: profiles };
}

function yamlQuote(p) {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

function buildBlock(opts) {
  const serverFile = opts.serverFile;
  const configFile = opts.configFile;
  const pluginName = (opts && opts.pluginName) || DEFAULT_PLUGIN;
  const lines = [
    MARK_BEGIN,
    '- insert:',
    '    - id: ' + ENTRY_ID,
    '      name: "' + pluginName + '"',
    '      config:',
    '        serverName: ai-script-studio',
    '        transport: stdio',
    '        command: node',
    '        args:',
    '          - ' + yamlQuote(serverFile),
    '          - ' + yamlQuote(configFile),
    '        toolCallTimeoutMs: 45000',
    MARK_END
  ];
  return lines.join('\n');
}

/* 去掉上一次写入的块（幂等） */
function stripBlock(text) {
  const begin = text.indexOf(MARK_BEGIN);
  if (begin < 0) return text;
  const end = text.indexOf(MARK_END, begin);
  if (end < 0) return text.slice(0, begin);
  return text.slice(0, begin) + text.slice(end + MARK_END.length);
}

/* 判断 patch 文件的「有效内容」是不是空数组 []（只有注释和 []） */
function isEffectivelyEmpty(text) {
  const body = text.split(/\r?\n/)
    .map(function (l) { return l.trim(); })
    .filter(function (l) { return l && l.charAt(0) !== '#'; })
    .join('');
  return body === '' || body === '[]' || body === '---[]' || body === '-[]';
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function backupOf(file) {
  if (!fs.existsSync(file)) return '';
  const bak = file + '.bak-' + Date.now();
  try { fs.copyFileSync(file, bak); return bak; } catch (e) { return ''; }
}

function install(opts) {
  const profile = String((opts && opts.profile) || '').trim();
  if (!profile) return { ok: false, error: '请选择一个 DSH profile' };
  const info = listProfiles();
  if (!info.exists) {
    return { ok: false, error: '没有找到 DSH 配置目录：' + info.dir + '（可先运行一次 dsh 以生成 profile）' };
  }
  const target = info.profiles.filter(function (p) { return p.name === profile; })[0];
  if (!target) return { ok: false, error: '找不到 profile「' + profile + '」，现有：' + info.profiles.map(function (p) { return p.name; }).join(' / ') };

  const block = buildBlock({ serverFile: opts.serverFile, configFile: opts.configFile, pluginName: opts.pluginName });
  let text = '';
  try { text = fs.readFileSync(target.patchFile, 'utf8'); } catch (e) { text = ''; }
  const hadContent = text;
  let next = stripBlock(text);
  if (!next.trim()) {
    next = '# DSH patch layer (ai-script-studio)\n[]\n';
  }
  if (isEffectivelyEmpty(next)) {
    // 整个文件是空数组：直接换成我们的数组内容（保留原有注释头）
    const commentLines = next.split(/\r?\n/).filter(function (l) { return l.trim().charAt(0) === '#'; });
    next = (commentLines.length ? commentLines.join('\n') + '\n' : '') + block + '\n';
  } else {
    next = next.replace(/\s*$/, '') + '\n\n' + block + '\n';
  }

  const backup = backupOf(target.patchFile);
  try {
    ensureParent(target.patchFile);
    fs.writeFileSync(target.patchFile, next, 'utf8');
  } catch (e) {
    return { ok: false, error: '写入失败：' + (e && e.message) + '（文件：' + target.patchFile + '）' };
  }

  return {
    ok: true,
    profile: profile,
    patchFile: target.patchFile,
    backup: backup,
    changed: hadContent !== next,
    verified: null
  };
}

function uninstall(opts) {
  const profile = String((opts && opts.profile) || '').trim();
  if (!profile) return { ok: false, error: '请选择一个 DSH profile' };
  const info = listProfiles();
  const target = info.profiles.filter(function (p) { return p.name === profile; })[0];
  if (!target) return { ok: false, error: '找不到 profile「' + profile + '」' };
  let text = '';
  try { text = fs.readFileSync(target.patchFile, 'utf8'); } catch (e) { return { ok: true, changed: false }; }
  if (text.indexOf(MARK_BEGIN) < 0) return { ok: true, changed: false };
  const backup = backupOf(target.patchFile);
  let next = stripBlock(text);
  if (isEffectivelyEmpty(next)) {
    const commentLines = next.split(/\r?\n/).filter(function (l) { return l.trim().charAt(0) === '#'; });
    next = (commentLines.length ? commentLines.join('\n') + '\n' : '') + '[]\n';
  }
  try {
    fs.writeFileSync(target.patchFile, next.replace(/\s*$/, '') + '\n', 'utf8');
  } catch (e) {
    return { ok: false, error: '写入失败：' + (e && e.message) };
  }
  return { ok: true, changed: true, backup: backup };
}

/* 用 dsh --profile X --dump-config 校验条目真的被这个版本识别（跨版本最可靠的验证） */
function verify(profile, command) {
  return new Promise(function (resolve) {
    const cmd = command || 'dsh';
    const args = ['--profile', profile, '--dump-config'];
    let child;
    try {
      child = cp.spawn(cmd, args, { shell: true, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: '无法运行 ' + cmd + '：' + (e && e.message) });
      return;
    }
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { child.kill(); } catch (e) {}
      resolve({ ok: false, error: 'dsh --dump-config 超时（30 秒）' });
    }, 30000);
    child.stdout.on('data', function (c) { out += c.toString('utf8'); });
    child.stderr.on('data', function (c) { err += c.toString('utf8'); });
    child.on('error', function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: '无法运行 ' + cmd + '：' + (e && e.message) });
    });
    child.on('close', function (code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const found = out.indexOf(ENTRY_ID) >= 0 || out.indexOf('ai-script-studio') >= 0;
      if (code === 0 && found) resolve({ ok: true, detected: true });
      else if (code === 0) resolve({ ok: true, detected: false, error: '配置已写入，但 --dump-config 里没有看到条目（该版本可能不支持这个插件名）' });
      else resolve({ ok: false, error: 'dsh --dump-config 失败（退出码 ' + code + '）：' + (err || out).slice(-400) });
    });
  });
}


/* 从 dsh --profile X --dump-config 的输出里找出该版本真正使用的 mcp-client 插件名。
   这样换 DSH 版本 / 换了包名也能写对，而不是死写一个名字。 */
function detectPluginName(profile, command) {
  return new Promise(function (resolve) {
    const cmd = command || 'dsh';
    let child;
    try {
      child = cp.spawn(cmd, ['--profile', profile, '--dump-config'], { shell: true, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, pluginName: DEFAULT_PLUGIN, error: (e && e.message) || String(e) });
      return;
    }
    let out = '';
    let err = '';
    let done = false;
    const finish = function (res) { if (done) return; done = true; clearTimeout(timer); resolve(res); };
    const timer = setTimeout(function () { try { child.kill(); } catch (e) {} finish({ ok: false, pluginName: DEFAULT_PLUGIN, error: '探测超时（30 秒）' }); }, 30000);
    child.stdout.on('data', function (c) { out += c.toString('utf8'); });
    child.stderr.on('data', function (c) { err += c.toString('utf8'); });
    child.on('error', function (e) { finish({ ok: false, pluginName: DEFAULT_PLUGIN, error: (e && e.message) || String(e) }); });
    child.on('close', function (code) {
      if (code !== 0) { finish({ ok: false, pluginName: DEFAULT_PLUGIN, error: (err || out).slice(-300) }); return; }
      const names = [];
      const re = /name:\s*['"]?([^'"\s]*mcp-client[^'"\s]*)['"]?/g;
      let m;
      while ((m = re.exec(out))) { if (names.indexOf(m[1]) < 0) names.push(m[1]); }
      const picked = names[0] || DEFAULT_PLUGIN;
      finish({ ok: true, pluginName: picked, candidates: names, found: names.length > 0 });
    });
  });
}

function status() {
  const info = listProfiles();
  return {
    home: info.home,
    profilesDir: info.dir,
    exists: info.exists,
    profiles: info.profiles,
    entryId: ENTRY_ID
  };
}

module.exports = { dshHome, listProfiles, install, uninstall, verify, detectPluginName, status, buildBlock, ENTRY_ID, DEFAULT_PLUGIN };
