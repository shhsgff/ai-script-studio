'use strict';
/**
 * 预加载脚本：通过 contextBridge 向渲染进程暴露受控的桌面能力
 */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();

function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  const list = listeners.get(channel) || [];
  list.push(wrapped);
  listeners.set(channel, list);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    const cur = (listeners.get(channel) || []).filter(fn => fn !== wrapped);
    listeners.set(channel, cur);
  };
}

contextBridge.exposeInMainWorld('api', {
  // 应用
  info: () => ipcRenderer.invoke('app:info'),
  setTitle: (title) => ipcRenderer.invoke('app:setTitle', title),
  setDirty: (dirty) => ipcRenderer.send('app:dirty', !!dirty),
  forceQuit: () => ipcRenderer.invoke('app:forceQuit'),
  onQuitRequest: (cb) => on('app:requestSaveAndQuit', cb),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // 项目
  openProject: () => ipcRenderer.invoke('project:open'),
  openProjectPath: (p) => ipcRenderer.invoke('project:openPath', p),
  saveProject: (filePath, project) => ipcRenderer.invoke('project:save', { filePath, project }),
  saveProjectAs: (project, suggestedName) => ipcRenderer.invoke('project:saveAs', { project, suggestedName }),
  importText: () => ipcRenderer.invoke('project:importText'),
  backup: (project, name) => ipcRenderer.invoke('project:backup', { project, name }),

  // 自动保存
  autosaveWrite: (payload) => ipcRenderer.invoke('autosave:write', payload),
  autosaveRead: () => ipcRenderer.invoke('autosave:read'),
  autosaveClear: () => ipcRenderer.invoke('autosave:clear'),
  sessionWrite: (payload) => ipcRenderer.invoke('session:write', payload),
  sessionRead: () => ipcRenderer.invoke('session:read'),
  sessionClear: () => ipcRenderer.invoke('session:clear'),

  // 最近文件
  removeRecent: (p) => ipcRenderer.invoke('recent:remove', p),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  onRecentChanged: (cb) => on('recent:changed', cb),

  // 壁纸
  pickWallpaper: () => ipcRenderer.invoke('wallpaper:pick'),
  clearWallpaper: () => ipcRenderer.invoke('wallpaper:clear'),

  // 导出
  exportTxt: (payload) => ipcRenderer.invoke('export:txt', payload),
  exportDocx: (payload) => ipcRenderer.invoke('export:docx', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),

  // AI
  aiStart: (payload) => ipcRenderer.invoke('ai:start', payload),
  aiAbort: (id) => ipcRenderer.invoke('ai:abort', id),
  aiTest: (override) => ipcRenderer.invoke('ai:test', override),
  onAiEvent: (cb) => on('ai:event', cb),

  // 本地 DeepSeek Harness
  dshDetect: (command) => ipcRenderer.invoke('dsh:detect', command),
  dshTest: (command) => ipcRenderer.invoke('dsh:test', command),
  dshStart: (payload) => ipcRenderer.invoke('dsh:start', payload),
  dshAbort: () => ipcRenderer.invoke('dsh:abort'),
  onDshEvent: (cb) => on('dsh:event', cb),

  // MCP 桥
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpDshStatus: () => ipcRenderer.invoke('mcp:dshStatus'),
  mcpDshInstall: (profile) => ipcRenderer.invoke('mcp:dshInstall', profile),
  mcpDshUninstall: (profile) => ipcRenderer.invoke('mcp:dshUninstall', profile),
  mcpEnable: () => ipcRenderer.invoke('mcp:enable'),
  mcpDisable: () => ipcRenderer.invoke('mcp:disable'),
  onMcpRequest: (cb) => on('mcp:request', cb),
  mcpReply: (id, result) => ipcRenderer.invoke('mcp:reply', id, result),

  // 本地 AI 网关（用本机 dsh 驱动，OpenAI 兼容）
  gatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  gatewayEnable: () => ipcRenderer.invoke('gateway:enable'),
  gatewayDisable: () => ipcRenderer.invoke('gateway:disable'),
  gatewayRotate: () => ipcRenderer.invoke('gateway:rotate'),
  gatewayApply: () => ipcRenderer.invoke('gateway:apply'),
  gatewayTest: () => ipcRenderer.invoke('gateway:test'),

  // 系统
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  readText: () => ipcRenderer.invoke('clipboard:read'),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});
