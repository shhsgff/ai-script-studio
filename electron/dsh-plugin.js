'use strict';
/*
 * 把「本软件的 MCP server」做成一个真正的 DeepSeek Harness 插件（bundle）。
 *
 * 为什么要有这个模块：直接往 $DSH_HOME/profiles/<p>/cordis.patch.yml 写 YAML 虽然能用，
 * 但那是「改用户配置」。DSH 官方支持的是 bundle：
 *   <dir>/package.json       声明 { "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
 *   <dir>/cordis.patch.yml   一个 patch 条目数组
 *   （可选 index.js）
 * 然后用 `dsh plugin --profile <p> add <dir>` 安装，DSH 自己把它写进 profile 的
 * dsh.profile.bundles 列表；`dsh plugin --profile <p> remove <包名>` 就能干净卸载。
 *
 * 由于 patch 里必须写本机的绝对路径（server 文件与 bridge 配置），插件目录由本软件在
 * 本机现场生成，路径变了重新生成一次即可。插件名（mcp-client）通过 --dump-config 反查，
 * 因此不同版本的 DSH 都能用。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const dshMcp = require('./dsh-mcp');

const BUNDLE_NAME = 'dsh-ai-script-studio-mcp';
const ENTRY_ID = dshMcp.ENTRY_ID;

function runDsh(command, args, timeoutMs) {
  return new Promise(function (resolve) {
    const child = cp.spawn(command || 'dsh', args, {
      cwd: os.tmpdir(),
      shell: true,
      windowsHide: true
    });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { child.kill(); } catch (e) { /* ignore */ }
      resolve({ ok: false, code: null, stdout: out, stderr: err, error: '超时（' + Math.round((timeoutMs || 0) / 1000) + ' 秒）' });
    }, timeoutMs || 120000);
    child.stdout.on('data', function (d) { out += String(d); });
    child.stderr.on('data', function (d) { err += String(d); });
    child.on('error', function (e) {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: out, stderr: err, error: '无法执行 ' + command + '：' + (e && e.message) });
    });
    child.on('close', function (code) {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ok: code === 0, code: code, stdout: out, stderr: err });
    });
  });
}

/* 插件目录（本机生成，路径随安装位置变化） */
function bundleDir(baseDir) {
  return path.join(baseDir, 'dsh-plugin');
}

function buildBundle(opts) {
  const dir = bundleDir(opts.baseDir);
  fs.mkdirSync(dir, { recursive: true });
  // 注意：服务器文件必须带 .cjs 后缀，而且这个目录里不能声明 "type": "module"。
  // 否则 DSH 用 node 拉起 mcp-server.js 时，Node 会因为最近的 package.json 声明了 ESM
  // 而把 CommonJS 的服务器当 ES 模块跑，直接抛 "require is not defined"。
  const serverCopy = path.join(dir, 'mcp-server.cjs');
  fs.copyFileSync(opts.serverFile, serverCopy);

  const pkg = {
    name: BUNDLE_NAME,
    version: '1.0.0',
    main: 'index.js',
    description: 'AI 剧本创作工具的 MCP 工具（由软件本机生成，路径随机器变化）',
    files: ['cordis.patch.yml', 'mcp-server.cjs', 'index.js'],
    dsh: { bundle: { patch: './cordis.patch.yml' } }
  };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  const yaml = [
    '# 由 AI 剧本创作工具自动生成：把本软件注册成 DSH 的 MCP 工具集。',
    '# 卸载：dsh plugin --profile <profile> remove ' + BUNDLE_NAME,
    '# 想改路径就回软件里点一次「安装为插件」，会重新生成这份文件。',
    dshMcp.buildBlock({
      serverFile: serverCopy,
      configFile: opts.configFile,
      pluginName: opts.pluginName || dshMcp.DEFAULT_PLUGIN
    }),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), yaml, 'utf8');

  const index = [
    "'use strict';",
    '',
    '/* 这个包只贡献一条 patch 行（真正的 MCP 客户端由 @deepseek-ai/dsh-mcp-client 提供）。',
    ' * 写 CommonJS：目录里不声明 type，server.cjs 与 index.js 都能被 Node 正常加载。 */',
    "module.exports = { name: 'ai-script-studio-mcp', apply() {} };",
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'index.js'), index, 'utf8');

  return { dir: dir, serverFile: serverCopy, patchFile: path.join(dir, 'cordis.patch.yml') };
}

function profileDir(profile) {
  return path.join(dshMcp.dshHome(), 'profiles', profile);
}

function readProfileManifest(profile) {
  const file = path.join(profileDir(profile), 'package.json');
  try {
    return { file: file, json: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { file: file, json: null };
  }
}

function isInstalled(profile) {
  const m = readProfileManifest(profile);
  const bundles = (m.json && m.json.dsh && m.json.dsh.profile && m.json.dsh.profile.bundles) || [];
  return bundles.indexOf(BUNDLE_NAME) >= 0;
}

async function install(opts) {
  const profile = opts.profile;
  if (!profile) return { ok: false, error: '没有指定 profile' };
  const command = opts.command || 'dsh';
  const probe = await dshMcp.detectPluginName(profile, command);
  const built = buildBundle({
    baseDir: opts.baseDir,
    serverFile: opts.serverFile,
    configFile: opts.configFile,
    pluginName: probe.ok ? probe.pluginName : dshMcp.DEFAULT_PLUGIN
  });
  const res = await runDsh(command, ['plugin', '--profile', profile, 'add', '"' + built.dir + '"'], 180000);
  const verify = await dshMcp.verify(profile, command);
  const installed = isInstalled(profile);
  return {
    ok: installed && verify.detected,
    dir: built.dir,
    patchFile: built.patchFile,
    bundle: BUNDLE_NAME,
    pluginName: probe.ok ? probe.pluginName : dshMcp.DEFAULT_PLUGIN,
    probeFound: !!probe.found,
    installed: installed,
    verify: verify,
    output: (res.stdout || '').trim().slice(-1200),
    error: res.ok ? '' : ((res.error || '') + ' ' + String(res.stderr || '').trim()).trim().slice(-800)
  };
}

async function uninstall(opts) {
  const profile = opts.profile;
  if (!profile) return { ok: false, error: '没有指定 profile' };
  const command = opts.command || 'dsh';
  const res = await runDsh(command, ['plugin', '--profile', profile, 'remove', BUNDLE_NAME], 120000);
  // pnpm 有时会留下一个指向已删目录的软链，清掉它
  const link = path.join(profileDir(profile), 'node_modules', BUNDLE_NAME);
  try { if (fs.existsSync(link) || fs.lstatSync(link)) fs.rmSync(link, { recursive: true, force: true }); } catch (e) { /* 不存在就算了 */ }
  const still = isInstalled(profile);
  const verify = await dshMcp.verify(profile, command);
  return {
    ok: !still,
    bundle: BUNDLE_NAME,
    installed: still,
    verify: verify,
    output: (res.stdout || '').trim().slice(-800),
    error: res.ok ? '' : String(res.stderr || '').trim().slice(-600)
  };
}

function status() {
  const list = dshMcp.listProfiles();
  const profiles = (list.profiles || []).map(function (p) {
    return { name: p.name, pluginInstalled: isInstalled(p.name), patchInstalled: p.installed };
  });
  return {
    home: list.home,
    bundle: BUNDLE_NAME,
    entryId: ENTRY_ID,
    profiles: profiles
  };
}

module.exports = { BUNDLE_NAME, ENTRY_ID, bundleDir, buildBundle, install, uninstall, status, isInstalled, runDsh };
