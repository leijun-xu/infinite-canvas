# `plugins` 目录分析

## 一句话理解

`plugins/` 放了两套用途完全不同的扩展：

1. `plugins/canvas/`：给网页画布增加新节点类型。
2. `plugins/infinite-canvas/`：让 Codex 或 ZCode 认识并操作 Infinite Canvas。

虽然它们都叫插件，但安装位置、运行环境和开发方式都不同。

## 先看整体结构

```text
plugins/
├── canvas/                 # 画布节点插件生态
│   ├── sdk/                # 插件开发 SDK
│   ├── template/           # 新插件模板
│   ├── registry/           # 官方插件集中构建
│   ├── markdown/           # Markdown 节点
│   ├── svg/                # SVG 节点
│   ├── html/               # HTML 节点
│   ├── panorama/           # 3D 全景节点
│   └── sticky-note/        # 便利贴节点
└── infinite-canvas/        # Codex / ZCode 应用插件
    ├── .codex-plugin/
    ├── .zcode-plugin/
    ├── skills/
    ├── assets/
    └── marketplace.json
```

## 两类插件的区别

| 对比项 | 画布节点插件 | Codex / ZCode 插件 |
| --- | --- | --- |
| 所在目录 | `plugins/canvas/` | `plugins/infinite-canvas/` |
| 运行位置 | 浏览器网页内 | Codex / ZCode 插件系统 |
| 主要用途 | 增加 Markdown、SVG 等节点 | 注册 MCP、提供操作说明、打开画布 |
| 开发语言 | TypeScript / TSX | JSON、Markdown、Skill |
| 构建产物 | ESM JavaScript | 通常直接读取配置和 Skill |
| 安装方式 | 画布插件管理器加载 JS URL | Codex / ZCode 插件市场 |
| 主要风险 | 能访问网页中的本地数据和 API Key | 能启动 MCP 并引导 Agent 操作画布 |

## `plugins/canvas/`：画布节点插件

### 为什么需要节点插件

核心前端只内置通用节点，例如：

- 文本。
- 图片。
- 视频。
- 音频。
- 生成配置。
- 分组。

Markdown、SVG、HTML、3D 全景和便利贴并非写死在主应用中，而是通过插件扩展。

这样做的好处：

- 新节点不必全部塞进主前端。
- 每个插件可以独立开发和发布。
- 用户可以按需启用。
- 第三方作者可以扩展自己的节点。

### 插件如何进入网页

插件最终是一个 ESM JavaScript 文件。

网页插件加载流程大致是：

```text
插件源码 src/index.tsx
    ↓ build.mjs
dist/<插件名>.js
    ↓ 发布到 CDN 或同步到 web/public/plugins
画布插件管理器加载 URL
    ↓
web 中的 plugin-loader / plugin-runtime 执行
    ↓
节点注册到 node-registry
    ↓
创建菜单可以使用新节点
```

## `canvas/sdk/`：插件开发工具箱

包名：

```text
@infinite-canvas/plugin-sdk
```

它解决三个核心问题。

### 1. 提供类型

包括：

- `CanvasPlugin`
- `CanvasNodeDefinition`
- `CanvasNodeContext`
- `CanvasAgentOp`
- `CanvasTheme`
- `CanvasNodeData`

插件作者编写 TSX 时能获得类型提示。

### 2. 复用宿主 React

插件不能自己打包另一份 React，否则可能出现 hooks 失效、上下文不一致等问题。

SDK 的 JSX runtime 和 hooks 会读取：

```text
globalThis.InfiniteCanvasRuntime.React
```

因此插件和主应用共享同一份 React。

### 3. 统一构建

SDK 导出 `buildPlugin(...)`。每个插件的 `build.mjs` 通常只需调用它，不必重复维护复杂 esbuild 配置。

### SDK 关键文件

- `src/types.ts`：插件公开类型，是前端 `web/src/types/canvas-plugin.ts` 的镜像。
- `src/runtime.ts`：访问宿主运行时。
- `src/jsx-runtime.ts`：automatic JSX runtime。
- `src/jsx-dev-runtime.ts`：开发模式 JSX runtime。
- `src/define-plugin.ts`：插件定义辅助函数。
- `src/index.ts`：统一导出。
- `build.mjs`：插件构建工具。

前端插件契约变化时，必须同步检查 SDK 类型，否则插件作者看到的类型会与真实运行时不一致。

## `canvas/template/`：新插件模板

这是复制新插件的起点。

通常流程：

```bash
cp -r plugins/canvas/template plugins/canvas/my-plugin
cd plugins/canvas/my-plugin
npm install
npm run dev
```

复制后至少要修改：

- 目录名。
- `package.json` 的包名。
- 插件 `id`。
- 节点 `type`。
- 节点名称、图标和默认尺寸。

节点类型最好使用：

```text
<pluginId>:<nodeName>
```

例如：

```text
my-plugin:counter
```

这样可以避免不同插件声明相同节点类型。

## 一个节点插件包含什么

每个示例插件基本有相同结构：

```text
插件目录/
├── src/index.tsx
├── package.json
├── package-lock.json
├── tsconfig.json
├── build.mjs
└── README.md
```

### `src/index.tsx`

插件源码，通常默认导出：

```ts
definePlugin({
    id: "插件 ID",
    name: "插件名称",
    version: "1.0.0",
    nodes: [],
});
```

`nodes` 中每个节点定义可以提供：

- 节点类型。
- 标题和描述。
- 图标。
- 默认尺寸。
- 默认 metadata。
- 内容组件。
- 设置面板。
- Hover 工具栏。
- 上游资源输出。
- 双击行为。
- 是否保持宽高比。

### `build.mjs`

调用 SDK 的统一构建逻辑。

构建后：

- 产物写入插件自身的 `dist/`。
- 同时同步到 `web/public/plugins/`，方便本地开发。

### `tsconfig.json`

关键配置是：

- React automatic JSX。
- `jsxImportSource` 指向插件 SDK。
- bundler 模块解析。

### `package.json`

通常提供：

- `build`
- `dev`
- `typecheck`

插件把 SDK 作为本地开发依赖引用：

```text
file:../sdk
```

## 官方示例插件

### `markdown/`

把 Markdown 文本渲染成格式化内容。

它包含独立 CSS，并可能通过运行时动态导入 Markdown 解析依赖，避免把重依赖打进插件包。

适合学习：

- 插件 CSS。
- 文本内容编辑。
- 动态依赖。

### `svg/`

展示 SVG 内容。

适合学习：

- 代码内容渲染。
- SVG 预览。
- 节点尺寸和内容区域处理。

### `html/`

渲染 HTML 字符串。

出于隔离考虑，HTML 内容放入 sandbox iframe 的 `srcDoc`，而不是直接插入宿主 DOM。

适合学习：

- iframe sandbox。
- HTML 内容预览。
- 节点内交互隔离。

### `panorama/`

3D 全景节点。

它会动态加载 Three.js 等较重依赖，避免主插件 bundle 过大。

适合学习：

- 运行时加载外部库。
- 复杂资源生命周期。
- WebGL / 3D 节点。

### `sticky-note/`

便利贴节点。

适合学习：

- 自定义 metadata。
- 节点编辑。
- 插件私有字段。
- 简单交互控件。

## 插件节点的 `ctx`

插件的内容组件、设置面板和工具栏会收到节点上下文 `ctx`。

常用能力：

- `ctx.node`：读取当前节点。
- `ctx.theme`：读取画布主题。
- `ctx.scale`：读取当前缩放。
- `ctx.updateMetadata`：修改节点业务内容。
- `ctx.updateNode`：修改标题、宽高等。
- `ctx.getNodes`：读取所有节点。
- `ctx.getConnections`：读取所有连线。
- `ctx.getUpstream`：读取上游节点。
- `ctx.getDownstream`：读取下游节点。
- `ctx.applyOps`：执行标准画布操作。
- `ctx.emit` / `ctx.on`：插件事件。
- `ctx.storage`：插件私有存储。

标准操作包括增删节点、连接节点、选择节点、设置视口和触发生成。

## 插件交互注意事项

画布本身会监听鼠标按下和滚轮来拖动、选择和缩放。

如果插件节点内有按钮、输入框或滚动区，需要阻止事件冒泡，例如：

- 控件 `onMouseDown` 中执行 `stopPropagation()`。
- 滚动区域阻止 `wheel` 冒泡。
- 添加 `data-canvas-no-zoom`。

否则用户点击按钮时可能拖动整个节点，滚动内容时可能缩放画布。

## `canvas/registry/`：官方插件注册表

这个目录只放集中构建脚本，不提交插件构建产物。

发布流程：

```text
打版本 tag 或手动触发 CI
    ↓
registry/build.mjs 构建所有官方插件
    ↓
生成各插件 JS 和 official-plugins.json
    ↓
强推到 plugins-dist 孤儿分支
    ↓
前端通过 jsDelivr 读取清单
```

默认清单地址可通过 `VITE_PLUGIN_REGISTRY_URL` 覆盖。

新增官方插件时，不仅要创建插件目录，还要在 registry 的 `OFFICIAL` 配置中登记。

## 本地插件开发方式

### 自动发现

插件执行 `npm run dev` 后，产物同步到：

```text
web/public/plugins/<name>.js
```

Vite 的本地插件清单会发现它。插件管理器中会显示，但默认关闭，需要用户启用。

### `VITE_DEV_PLUGINS`

也可以在 `web/.env.local` 中配置：

```env
VITE_DEV_PLUGINS=/plugins/markdown.js,/plugins/svg.js
```

这些插件每次刷新都会重新加载并自动启用，不缓存、不落库，适合开发。

## 画布插件的安全风险

插件 JS 直接在网页上下文中执行，可以访问：

- 页面 DOM。
- 浏览器存储。
- 画布和素材。
- 用户配置的 AI API Key。
- 网页能够访问的网络资源。

因此：

- 只安装可信插件。
- 第三方 URL 不是安全沙箱。
- 插件管理器中的安全提示不能省略。
- HTML 节点自己的 iframe 隔离不代表整个插件 JS 被隔离。

## `plugins/infinite-canvas/`：Codex / ZCode 插件

这套插件不增加画布节点，而是让 Agent 平台知道：

- Infinite Canvas 是什么。
- 如何启动本地 Canvas Agent。
- 如何注册 MCP。
- 如何打开并连接网页。
- 如何使用画布工具。

### `.codex-plugin/plugin.json`

Codex 插件元数据。

包含：

- 插件名称、版本和作者。
- 首页和仓库地址。
- Skills 目录。
- MCP 配置路径。
- 显示名称、描述、分类和图标。
- 推荐提示语。

### `.zcode-plugin/plugin.json`

ZCode 插件元数据。

它直接声明 MCP Server：

```text
npx -y @basketikun/canvas-agent@latest mcp
```

安装插件后，ZCode 可以启动这个 MCP。

### `.mcp.json`

Codex 使用的 MCP Server 配置，指向 Canvas Agent 的 MCP 命令。

### `marketplace.json`

本地插件市场清单，帮助 Codex / ZCode 从当前仓库发现 `infinite-canvas` 插件。

### `skills/open-canvas/`

告诉 Agent 如何：

- 启动或定位 Canvas Agent。
- 读取 URL 和 token。
- 打开线上或本地画布。
- 通过 URL 参数自动连接。

### `skills/canvas/`

告诉 Agent如何理解和操作画布，包括工具使用和操作约束。

### `assets/icon.png`

Codex / ZCode 插件界面展示的图标。

## 两个 marketplace 文件不要混淆

项目里有：

- 根级 `.agents/plugins/marketplace.json`
- `plugins/infinite-canvas/marketplace.json`

它们服务的发现入口和插件系统可能不同。修改前要先确认目标平台，不要因为名字相同就合并或删除其中一个。

## 常见需求应该去哪里改

| 需求 | 位置 |
| --- | --- |
| 新建画布节点插件 | 复制 `canvas/template/` |
| 修改插件公开类型 | `canvas/sdk/src/types.ts`，并同步 Web 类型 |
| 修改插件构建 | `canvas/sdk/build.mjs` |
| 修改 Markdown 节点 | `canvas/markdown/src/` |
| 修改 HTML 隔离 | `canvas/html/src/` |
| 修改官方插件列表 | `canvas/registry/build.mjs` |
| 修改 Codex 插件信息 | `infinite-canvas/.codex-plugin/plugin.json` |
| 修改 ZCode MCP | `infinite-canvas/.zcode-plugin/plugin.json` |
| 修改打开画布流程 | `infinite-canvas/skills/open-canvas/SKILL.md` |
| 修改 Agent 画布操作说明 | `infinite-canvas/skills/canvas/SKILL.md` |

## 小白推荐阅读顺序

### 想开发画布节点

1. `canvas/README.md`
2. `canvas/template/README.md`
3. `canvas/template/src/index.tsx`
4. `canvas/sdk/README.md`
5. `canvas/sticky-note/src/index.tsx`
6. 再看更复杂的 Markdown、HTML 或 Panorama。

### 想理解 Codex / ZCode 接入

1. `infinite-canvas/README.md`
2. `.codex-plugin/plugin.json`
3. `.zcode-plugin/plugin.json`
4. `.mcp.json`
5. `skills/open-canvas/SKILL.md`
6. `skills/canvas/SKILL.md`

## 容易踩坑的地方

- 不要把画布节点插件和 Agent 应用插件当成同一种插件。
- 插件不要打包第二份 React。
- 重依赖应按现有模式动态加载，不要让插件 bundle 过大。
- 插件类型契约改变时要同步宿主前端和 SDK。
- 插件内控件要阻止画布拖拽和缩放事件。
- 插件自定义 metadata 类型默认是 `unknown`，读取时要做类型判断或断言。
- 官方插件源码在 `main`，构建产物在 `plugins-dist`，不要把 `dist/` 提交进源码分支。
- 第三方插件直接在网页执行，必须明确安全风险。
- 修改 Codex/ZCode 配置时要验证两个平台的格式，不要默认完全相同。

