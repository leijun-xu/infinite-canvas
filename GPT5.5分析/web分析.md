# `web` 目录分析

## 一句话理解

`web/` 是 Infinite Canvas 真正给用户使用的网页应用。你在浏览器里看到的首页、画布、图片生成、视频生成、素材库、提示词库和配置页面，都来自这个目录。

即使不启动 `canvas-agent/` 和 `canvas-proxy/`，只要模型接口允许浏览器直接访问，`web/` 也可以独立运行。

## 先理解几个基础概念

如果你刚接触前端，可以先把这些技术理解成：

- **Vite**：开发服务器和打包工具。负责把源码变成浏览器可以运行的文件。
- **React**：用组件的方式编写页面。
- **React Router**：根据 URL 决定显示哪个页面。
- **TypeScript**：带类型检查的 JavaScript。
- **Ant Design**：提供按钮、弹窗、表单等成熟 UI 组件。
- **Tailwind CSS**：通过 `className` 快速编写样式。
- **Zustand**：保存多个组件需要共享的数据。
- **localforage**：把画布、素材和媒体文件保存到浏览器的 IndexedDB。
- **React Query**：管理异步请求状态，本项目在全局 Provider 中初始化。

## 它在整个项目中的位置

一次普通的使用流程大致是：

```text
用户打开网页
    ↓
web/src/main.tsx 启动 React
    ↓
web/src/router.tsx 选择页面
    ↓
页面读取 Zustand 状态
    ↓
services/api 请求 AI 接口
    ↓
生成结果保存到浏览器本地
    ↓
页面重新渲染结果
```

需要注意：这个项目默认没有业务后端。AI API Key、画布和素材主要保存在用户浏览器中，请求也由浏览器直接发往用户配置的模型服务。

## 根目录文件

### `package.json`

定义项目依赖和常用命令。

主要命令：

```bash
bun run dev
bun run build
bun run typecheck
bun run test
bun run start
```

- `dev`：启动本地开发服务器，默认地址是 `http://localhost:3000`。
- `build`：生成生产环境静态文件到 `dist/`。
- `typecheck`：执行 TypeScript 类型检查。
- `test`：执行 Bun 测试。
- `start`：预览已经构建好的生产文件。

### `vite.config.ts`

Vite 的核心配置。

它主要做四件事：

1. 注册 React 插件。
2. 把 `@/` 映射到 `web/src/`，所以源码可以写 `@/stores/...`。
3. 从根目录读取 `VERSION` 和 `CHANGELOG.md`，注入前端版本信息。
4. 扫描 `web/public/plugins/`，生成本地插件清单 `/plugins/index.json`。

因此，插件开发时产生的 JS 文件只要放进 `public/plugins/`，前端就能发现它。

### `tsconfig.json`

TypeScript 配置。

重点：

- 开启严格类型检查。
- 使用 React JSX。
- 使用 bundler 模块解析。
- 配置 `@/*` 路径别名。
- 只检查源码，不直接输出 JS，真正构建由 Vite 完成。

### `index.html`

浏览器最先加载的 HTML 壳。React 最终会挂载到其中的根节点。

### `docker-entrypoint.sh`

Docker 容器启动时执行，读取统计相关环境变量，动态生成 `config.js`。

它目前处理：

- Google Analytics 4 ID。
- 百度统计 ID。

这不是 AI 模型配置。模型 Base URL 和 API Key 仍由用户在浏览器页面中配置。

### 锁文件

目录中同时存在：

- `bun.lock`
- `package-lock.json`
- `pnpm-lock.yaml`

它们分别属于 Bun、npm 和 pnpm。README 当前推荐使用 Bun。修改依赖时应使用项目约定的包管理器，避免同时无意义地改动多个锁文件。

## `public/`：原样公开的静态文件

`public/` 中的文件不会经过 React 编译，构建时会原样复制到网站根路径。

当前主要内容：

- `logo.svg`：项目 Logo。
- `config.js`：默认运行时配置。
- `icons/`：图标资源。
- `plugins/`：本地插件构建产物，开发时可能动态出现。

适合放：

- 不需要 import 的固定静态资源。
- 必须保持固定访问路径的文件。
- 动态加载的画布插件 JS。

不适合放普通 React 源码。

## `src/main.tsx`：前端总入口

它是阅读前端代码的第一个入口。

主要工作：

1. 引入 Ant Design、Streamdown 和全局样式。
2. 初始化国际化。
3. 初始化统计。
4. 设置全局字体。
5. 创建 React 根节点。
6. 用 `AppProviders` 包住整个路由。

可以把它理解成“接通电源”，但具体业务不写在这里。

## `src/router.tsx`：页面地图

这个文件决定 URL 和页面之间的对应关系。

| URL | 页面目录 | 用途 |
| --- | --- | --- |
| `/` | `pages/home/` | 首页 |
| `/image` | `pages/image/` | 图片生成工作台 |
| `/video` | `pages/video/` | 视频生成工作台 |
| `/assets` | `pages/assets/` | 我的素材 |
| `/prompts` | `pages/prompts/` | 提示词库 |
| `/canvas` | `pages/canvas/index.tsx` | 画布项目列表 |
| `/canvas/:id` | `pages/canvas/project.tsx` | 某个具体画布 |
| `/config` | `pages/config/` | 配置页 |

`UserLayout` 是这些页面共同使用的外层布局。

## `src/pages/`：路由页面

页面负责组合组件和业务流程。

### `pages/home/`

应用首页，给用户提供主要功能入口。

### `pages/image/`

独立图片生成工作台。

它和画布内的图片节点都会调用图片服务，但交互场景不同：

- 图片工作台强调直接生成和查看记录。
- 画布强调节点之间的引用、连接和继续加工。

### `pages/video/`

视频生成工作台，负责创建任务、轮询任务状态和展示生成结果。

### `pages/assets/`

“我的素材”页面。

素材元数据保存在 Zustand/localforage，真实图片或媒体 Blob 保存在浏览器 IndexedDB。

### `pages/prompts/`

提示词库页面。支持内置来源和用户配置的 JSON 来源，并缓存到浏览器。

### `pages/config/`

配置页面。

主要管理：

- 模型渠道。
- Base URL 和 API Key。
- 模型能力分类。
- 本地代理。
- 用户偏好。
- 提示词来源。
- WebDAV 配置。
- 本地存储信息。

### `pages/canvas/index.tsx`

画布项目列表。

负责：

- 创建画布。
- 打开画布。
- 删除画布。
- 导入 ZIP。
- 导出选中项目。
- 处理 Agent 通过 URL 请求“新建、最近、选择画布”。

### `pages/canvas/project.tsx`

整个前端最核心、体量最大的业务文件。

它像一个画布总指挥，协调：

- 项目加载和保存。
- 节点、连线和视口。
- 节点拖动、选择、框选、复制、粘贴。
- 撤销和重做。
- 图片、视频、音频生成。
- 裁剪、拆图、蒙版、放大等图片编辑。
- 节点分组。
- 素材插入。
- 插件节点。
- Agent 连接和画布操作。

初学者不要尝试一次读完。建议先搜索某个具体动作，例如 `requestGeneration`、`updateProject` 或 `setSelectedNodeIds`，沿着一条链路阅读。

### `pages/canvas/hooks/`

画布页面私有 hook：

- `use-agent-bridge.ts`：把当前画布状态暴露给本地 Agent，并接收 Agent 操作。
- `use-plugin-host.tsx`：加载和初始化画布插件。

这些 hook 只服务画布页面，所以放在页面目录内，而不是全局 `src/hooks/`。

## `src/components/`：可复用 UI

### `components/canvas/`

画布相关组件。

可以按功能分组理解：

#### 画布基础

- `infinite-canvas.tsx`：平移、缩放、背景网格。
- `canvas-node.tsx`：单个节点外壳。
- `canvas-connections.tsx`：节点连线。
- `canvas-mini-map.tsx`：小地图。

#### 工具栏和菜单

- `canvas-toolbar.tsx`
- `canvas-top-bar.tsx`
- `canvas-selection-toolbar.tsx`
- `canvas-node-hover-toolbar.tsx`
- `canvas-context-menu.tsx`
- `canvas-create-menus.tsx`

#### 节点设置和编辑

- 图片、视频、音频、文本设置 Popover。
- 裁剪、蒙版、拆分、放大、角度等 Dialog。
- 节点提示词面板。
- 节点引用栏。

#### 插件与资源

- `canvas-plugin-manager-modal.tsx`：插件安装和管理。
- `asset-picker-modal.tsx`：从素材库选择资源。
- `nodes/builtin-nodes.tsx`：注册内置节点。

### `components/agent/`

本地 Agent 侧边栏的全部 UI，包括：

- 连接设置。
- 对话消息。
- 输入框和附件。
- 画布节点引用。
- 历史线程。
- Skills。
- 日志和状态。
- 工具调用确认。

这里主要负责显示和交互，真正的 Agent 连接状态在 `stores/use-agent-store.ts`，请求封装在 `services/api/canvas-agent.ts`。

### `components/layout/`

应用级公共组件。

最重要的是 `app-providers.tsx`，它统一提供：

- Ant Design 主题。
- Ant Design 国际化。
- Pro Components 配置。
- React Query。
- 根级初始化。

其他文件负责顶栏、移动导航、配置弹窗、渠道编辑、模型选择和版本提示。

### `components/prompts/`

提示词卡片、选择弹窗和提示词列表 hook。

### `components/ui/`

少量通用 UI 组件，例如主题切换和 Select。

## `src/stores/`：共享状态

可以把 store 理解成“页面之外的共享内存”。

### `stores/canvas/use-canvas-store.ts`

保存画布项目核心数据：

- 项目基本信息。
- 节点。
- 连线。
- 画布助手会话。
- 背景模式。
- 视口位置。

它使用 Zustand `persist` 和 localforage，把业务数据写入 IndexedDB，并做了延迟保存，避免每次拖动节点都立刻写磁盘。

### `stores/canvas/use-canvas-ui-store.ts`

画布列表或画布 UI 状态，例如选中的项目和待删除项目。此类状态通常不属于画布业务数据本身。

### `stores/canvas/use-plugin-store.ts`

保存插件安装、启用和注册状态。

### `stores/use-config-store.ts`

保存 AI 和应用配置：

- 模型渠道。
- API Key。
- Base URL。
- OpenAI / Gemini 协议类型。
- 图片、视频、文本、音频默认模型。
- 生成参数。
- 本地代理设置。
- WebDAV 设置。
- 用户偏好。

配置中的 API Key 保存在浏览器本地，前端会直接使用它请求模型服务。

### `stores/use-agent-store.ts`

保存本地 Agent 的连接和界面状态：

- Agent URL 和 token。
- 是否连接。
- SSE 事件。
- 对话消息。
- 当前 thread / turn。
- 模型和推理等级。
- 权限与审批。
- Agent 面板状态。

### 其他 store

- `use-asset-store.ts`：素材。
- `use-prompt-source-store.ts`：提示词来源。
- `use-theme-store.ts`：浅色/深色主题。
- `use-user-store.ts`：用户相关状态。
- `use-workbench-agent-store.ts`：工作台 Agent 状态。

## `src/services/`：数据与外部通信

### `services/api/`

所有外部服务请求集中在这里。

- `image.ts`：图片生成、编辑、图片问答。
- `video.ts`：创建视频任务、查询状态、保存结果。
- `audio.ts`：音频生成。
- `canvas-agent.ts`：访问本地 Agent。
- `local-proxy.ts`：检测本地代理。
- `model-plugin.ts`：执行用户配置的模型调用脚本。
- `prompts.ts`：提示词请求。
- `prompt-source-*`：提示词来源。
- `request.ts`：通用查询参数工具。

修改某种 AI 请求格式时，应先从这里找，而不是把请求代码写进组件。

### 本地存储服务

- `image-storage.ts`：图片 Blob、预览和 URL。
- `file-storage.ts`：视频、音频和普通媒体 Blob。
- `local-storage-usage.ts`：统计本地占用。

浏览器不能直接长期保存临时 `blob:` URL，所以项目保存的是 `storageKey` 和 Blob，需要显示时再创建 Object URL。

### 同步与配置

- `app-sync.ts`：组织画布、素材、图片记录和视频记录的 WebDAV 同步。
- `webdav-sync.ts`：处理 WebDAV 文件请求。
- `config-file.ts`：配置导入导出。

WebDAV 是用户主动配置的同步能力，不等于项目默认支持云端账户同步。

## `src/lib/`：纯逻辑和工具

### `lib/canvas/`

画布核心工具：

- 节点创建。
- 节点尺寸和几何计算。
- 分组和连接。
- 导入导出。
- 图片数据处理。
- 资源引用。
- 视频帧提取。
- Agent 操作协议。
- 插件加载、注册和运行时。

当一段逻辑不直接负责渲染 UI，又只服务画布时，通常应该在这里。

### 其他重要文件

- `app-theme.ts`：Ant Design 全局主题。
- `canvas-theme.ts`：画布主题 token。
- `analytics.ts`：统计。
- `image-utils.ts`：图片工具。
- `media-size.ts`：媒体尺寸。
- `zip.ts`：ZIP 处理。
- `release.ts`：版本和更新日志解析。
- `agent/`：Agent URL 启动和站点工具。

## 其他源码目录

### `src/types/`

集中声明 TypeScript 类型：

- 画布节点和连线。
- 图片和媒体。
- 插件公开协议。
- 画布导出格式。

修改数据结构时，应同步检查这里、store、导入导出和插件 SDK。

### `src/i18n/`

国际化配置和中英文文案。

新增页面文案时，不应直接在组件中散落硬编码文本，应按项目现有方式补充语言包。

### `src/constant/`

保存画布默认值、环境常量、导航工具和运行时配置。

### `src/hooks/`

多个页面可以复用的全局 hook，例如复制提示、版本检查、提示词来源调度。

### `src/layouts/`

路由页面的整体布局，目前核心是 `user-layout.tsx`。

### `src/styles/`

全局 CSS。页面私有样式不应大量堆到这里。

### `src/types/`

业务数据契约。阅读节点结构时优先看 `types/canvas.ts`。

## `tests/`

当前包含少量聚焦测试：

- 画布聚焦视口。
- 图片缩略图。
- 模型选择。

测试数量并不覆盖全部画布交互。修改大型画布流程时，不能只根据现有测试判断没有回归。

## 常见需求应该去哪里改

| 需求 | 优先查找位置 |
| --- | --- |
| 新增路由页面 | `src/pages/`、`src/router.tsx` |
| 修改顶部导航 | `src/components/layout/` |
| 修改画布交互 | `src/pages/canvas/project.tsx` |
| 修改平移缩放 | `src/components/canvas/infinite-canvas.tsx` |
| 新增内置节点 | `components/canvas/nodes/`、`types/canvas.ts`、`constant/canvas.ts` |
| 修改生图请求 | `src/services/api/image.ts` |
| 修改模型配置 | `src/stores/use-config-store.ts`、配置页面组件 |
| 修改本地持久化 | 对应 store、`services/*-storage.ts` |
| 修改 Agent UI | `src/components/agent/` |
| 修改 Agent 连接 | `src/stores/use-agent-store.ts`、`services/api/canvas-agent.ts` |
| 修改插件加载 | `src/lib/canvas/plugin-*` |
| 修改全局主题 | `src/lib/app-theme.ts`、`src/lib/canvas-theme.ts` |

## 小白推荐阅读顺序

1. `package.json`：知道如何启动。
2. `src/main.tsx`：知道应用如何挂载。
3. `src/router.tsx`：知道有哪些页面。
4. `src/layouts/user-layout.tsx`：看公共页面框架。
5. 任选一个简单页面，例如 `pages/home/index.tsx`。
6. `stores/use-config-store.ts`：理解共享状态。
7. `services/api/request.ts`：看简单服务工具。
8. `pages/canvas/index.tsx`：理解项目列表。
9. `stores/canvas/use-canvas-store.ts`：理解画布数据。
10. 最后分功能阅读 `pages/canvas/project.tsx`。

## 容易踩坑的地方

- 不要假设存在项目后端，外部请求由浏览器发起。
- 不要把大 JSON、图片或生成记录写入 `localStorage`，应使用 localforage。
- `blob:` URL 不是永久地址，持久化应保存 storageKey 和 Blob。
- `project.tsx` 状态很多，修改时要注意撤销重做、自动保存、Agent 和插件是否同时受影响。
- 画布颜色应使用 `canvasThemes` 或全局主题，不要只适配浅色模式。
- 插件运行在当前网页中，加载第三方插件涉及本地数据和 API Key 安全。
- Docker 只是托管静态前端，不会替用户保管模型密钥或代理 AI 请求。

