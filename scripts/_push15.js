'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const REPO = 'shhsgff/ai-script-studio';
const reg = JSON.parse(fs.readFileSync('C:/Users/xwj/.dsh/skill-mcp-manager/registry.json', 'utf8'));
const entry = (reg.entries || []).find((e) => e && e.env && e.env.GITHUB_TOKEN);
const TOKEN = entry.env.GITHUB_TOKEN;
async function api(method, p, body) {
  const res = await fetch('https://api.github.com' + p, {
    method, headers: { authorization: 'Bearer ' + TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'aisc-release', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(method + ' ' + p + ' → ' + res.status + ' ' + JSON.stringify(data).slice(0, 300));
  return data;
}
(async () => {
  const headSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const msg = execSync('git log -1 --pretty=%s', { encoding: 'utf8' }).trim();
  const ref = await api('GET', '/repos/' + REPO + '/git/ref/heads/main');
  const parentSha = ref.object.sha;
  if (parentSha === headSha) { console.log('ALREADY_IN_SYNC'); return; }
  const all = execSync('git ls-files', { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  const tree = [];
  for (const f of all) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) continue;
    const blob = await api('POST', '/repos/' + REPO + '/git/blobs', { content: fs.readFileSync(abs).toString('base64'), encoding: 'base64' });
    tree.push({ path: f.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await api('POST', '/repos/' + REPO + '/git/trees', { tree });
  const commit = await api('POST', '/repos/' + REPO + '/git/commits', { message: msg, tree: newTree.sha, parents: [parentSha] });
  await api('PATCH', '/repos/' + REPO + '/git/refs/heads/main', { sha: commit.sha });
  console.log('PUSHED ' + commit.sha.slice(0, 8) + ' blobs=' + tree.length);
})().catch((e) => { console.log('PUSH_FAIL ' + e.message); process.exitCode = 1; });
