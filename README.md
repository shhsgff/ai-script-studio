# AI 剧本创作工具 · AI Script Studio

把一份「只有界面、没有功能」的 HTML 原型，做成了一套**真能用的 Windows 桌面软件**：
Electron + 原生 Node，界面沿用原型的暗色玻璃拟态风格，功能全部接通。

> 现在版本 **1.1.3**：多文档标签、章 → 节两级目录、故事大纲浮窗、查找替换、Word/PDF/纯文本导出、
> **本地 dsh 网关（不需要买 Key）**、**DSH 关键词一键生成剧本**、**MCP 反向写入**，
> 并且下次启动会自动回到上次的工作现场。

---

## 特性一览

| 功能 | 说明 |
| --- | --- |
| 多文档标签 | 像浏览器一样开多个剧本，每个标签独立的撤销栈 / 字数 / 脏标记；✕ 关闭（有未保存会问）、右键菜单、双击改名、中键关闭 |
| 章 → 节两级目录 | 章节可折叠，行内 `＋` 加小节、↑↓ 排序、✕ 删除、双击改名；小节带字数，点一下滚动定位到正文那一段 |
| 编辑区 | 纸张式排版、常驻细滚动条、撤销/重做（150 步/章）、查找替换（高亮 + 全部替换）、实时字数与字符统计、字数统计弹窗 |
| 文件 | 新建 / 打开 / 保存 / 另存为、最近文件、导入 txt / md / html 自动识别章节、每次保存的自动备份 |
| 导出 | Word（.docx）、PDF、纯文本 |
| AI 改写 | 选区或整章 → 提示词 + 快捷指令 → **流式**输出 → 采纳 / 重试 / 复制 / 放弃，多轮改写记录 |
| 本地网关 | 软件在本机起一个 **OpenAI 兼容网关**，自动生成 `aisc-local-…` 本地密钥，转发给已登录的 `dsh` —— **不用买 Key** |
| DSH 生成剧本 | 输入关键词 / 设定 → 调本机 `dsh headless` → 自动分章分节，作为新标签打开 |
| MCP 反向写入 | 内置 stdio MCP server，一键注册进任意版本的 DSH；DSH 的 agent 可直接建剧本、加章节、追加正文 |
| 故事大纲浮窗 | 全篇章/节一览，光标所在小节实时高亮，写过亮色、空白灰色；可拖动、位置记忆、点击跳转 |
| 外观 | 暗/亮主题、自定义壁纸（图片或视频，带压暗 / 模糊）、字体 / 字号 / 行距 / 段距 / 首行缩进 |
| 工作现场 | 下次启动自动重新打开上次开着的剧本，并接上未保存的草稿（纯空白草稿会被丢弃） |

---

## 界面一览

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 文件  编辑  设置        剧本标题 *                                  未保存  🌙 │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ 长安夜行录 ✕ ] [ 废土拾荒者 ✕ ]  ＋                          🤖 DSH 生成  🗺️ │
├──────────────┬───────────────────────────────────────────┬───────────────────┤
│ 剧本目录  ＋ │  全篇 334 字 · 本章 187 字                │ AI 智能辅助       │
│ 长安夜行录   │  ┌───────────────────────────────────────┐│ 参考图 / 选中文本 │
│  1 第一章 雨 │  │ 第一章 雨落无名                       ││ 改写要求（提示词）│
│   • 刀在雨里 │  │                                       ││ 润色 扩写 缩写    │
│   • 鞘上三字 │  │ 刀在雨里                              ││ 模型 / 上下文     │
│  2 第二章 灯 │  │                                       ││ 🚀 立即调用 AI    │
│   • 卖酒的人 │  │ 雨，落在长安。已经落了三天三夜。      ││ ── 改写记录 ──    │
├──────────────┴───────────────────────────────────────────┴───────────────────┤
│ 共 2 章 · 6 节 · 334 字    字数:334 字符:415 本章:187 ● 未保存 ● dsh-local     │
└──────────────────────────────────────────────────────────────────────────────┘
```

> 截图没有放进仓库（体积原因）。本地跑起来就能看到实际效果，见 [docs/开发与打包.md](docs/开发与打包.md)。

---

## 快速开始

**环境**：Windows 10/11 + Node.js 20 以上（`node -v` 能出版本即可）。

```bash
git clone https://github.com/shhsgff/ai-script-studio.git
cd ai-script-studio

# 1) 安装依赖（npm 11+ 会拦截 install 脚本，需手动补 Electron 二进制）
npm install --registry=https://registry.npmmirror.com
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js

# 2) 运行
npm start          # 正常启动
npm run dev        # 带 DevTools

# 3) 打包成 exe
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build      # 产物在 dist/
```

> 仓库里**不包含**已经打包好的 exe（单个 100MB+）。想直接拿可执行文件，按上面第 3 步自己打一次即可，
> 也可以把产物挂到自己仓库的 Releases 上。

---

## 三条使用路线

### 1. 直接写（不需要任何 AI 配置）

启动 → 欢迎页点「新建剧本」→ 从空白一章开始写，`＋` 加章节、行内 `＋` 加小节 → `Ctrl+S` 存成 `.aisc`。

### 2. AI 改写（默认走本机 dsh，不用买 Key）

软件启动时在本机 `127.0.0.1:45872` 起一个 OpenAI 兼容网关，自动生成 `aisc-local-…` 本地密钥，
并写进 AI 配置。选中一段 → 填提示词 → `Ctrl+Enter`，结果流式回来，满意就「采纳」。

想看 / 复制 / 重新生成这枚密钥：**设置 → AI 配置 → 本地网关**。
想换外部服务商（DeepSeek 官方 Key、中转站、本地 Ollama）：改下面的「服务接口」即可，软件不会再覆盖你的配置。

### 3. 让 DSH 替你写

- **正向**：右上角「🤖 DSH 生成」（`Ctrl+Shift+G`）→ 输入关键词、章节数、每章字数、文风 → 调本机 `dsh headless` 流式生成 → 自动分章分节成新标签。
- **反向**：设置 → DSH / MCP → 开启 MCP 服务 → 选 profile → **一键注册到 DSH**。
  之后在 DSH 里对话，它就能调用 `create_script / add_chapter / append_text / list_scripts / get_script` 直接往本软件里写。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/使用教程.md](docs/使用教程.md) | 面向使用者：从安装到每个功能、快捷键总表、数据在哪、常见问题 |
| [docs/开发与打包.md](docs/开发与打包.md) | 面向开发者：架构、IPC、自测（205 条断言）、打包、踩坑记录 |

---

## 目录结构

```
electron/
  main.js            主进程：窗口、协议、设置、对话框、导出、AI 流式、MCP 桥、网关接线
  preload.js         contextBridge 安全桥（contextIsolation 开、nodeIntegration 关）
  dsh.js             调用本机 dsh headless（NDJSON 解析）与 MCP HTTP 桥
  dsh-mcp.js         DSH 自动注册：找 DSH_HOME/profile、探测插件名、写 cordis.patch.yml、校验、撤销
  local-gateway.js   本地 OpenAI 兼容网关（/v1/chat/completions、/v1/models）
  mcp-server.js      stdio MCP server（注册给 DSH 用），运行时复制到用户目录
  mock-ai.js         本地 OpenAI 兼容 SSE 模拟服务（测试用）
  smoke.js           --smoke 驱动器 + 主进程侧 MCP / 网关端到端断言
  smoke-renderer.js  渲染进程断言（205 条）
src/
  index.html         界面骨架（欢迎页 / 标签栏 / 两级目录 / 编辑区 / AI 面板 / 浮窗 / 弹窗）
  styles.css         暗/亮主题、玻璃拟态、滚动条、打印样式
  js/utils.js        工具函数、toast、确认框
  js/store.js        设置读写、主题 / 字体 / 壁纸应用
  js/project.js      剧本数据模型（章 / 节 / 统计 / 导出载荷 / 历史）
  js/workspace.js    多文档工作区
  js/tabs.js         标签栏渲染与右键菜单
  js/editor.js       编辑器、撤销栈、选区、小节定位
  js/outline.js      两级目录
  js/outlinefloat.js 故事大纲浮窗
  js/ai.js           AI 改写面板
  js/find.js         查找替换
  js/dshgen.js       DSH 关键词生成弹窗
  js/app.js          主控：菜单、快捷键、设置面板、工作现场、MCP 回调
scripts/
  make-icon.js       纯 Node 生成 512×512 图标（打包前自动执行）
  fake-dsh.js        假的 dsh headless，供自测用
```

---

## 已知限制

- 只针对 **Windows** 打包（NSIS 安装包 + 免安装版）；源码本身是跨平台的，Linux/macOS 需自行配置 builder target。
- PDF 导出没有页码 / 页眉页脚；Word 导出不含目录。
- 小节用正文里的 `<h2 data-section="…">` 锚点表示，不是独立数据结构 —— 所以任何编辑器打开 `.aisc` 都能看懂。
- 大模型生成质量取决于本机 dsh 或你填的外部服务商；软件只负责流程与排版。
- exe 未做代码签名，Windows SmartScreen 首次会提示「更多信息 → 仍要运行」。

---

## License

[MIT](LICENSE)
