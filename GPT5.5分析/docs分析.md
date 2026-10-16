# `docs` 目录分析

## 一句话理解

`docs/` 是 Infinite Canvas 的独立文档网站，不是主应用 `web/` 中的一个普通页面。

它使用 Next.js 和 Fumadocs，把 `content/docs/` 中的 MDX 文档转换成带导航、搜索和多语言能力的网站。

## 为什么文档站独立

主应用和文档站目标不同：

| 项目 | `web/` | `docs/` |
| --- | --- | --- |
| 目标 | 提供实际创作工具 | 提供说明和教程 |
| 框架 | Vite + React Router | Next.js App Router |
| 主要内容 | 画布、素材、生成 | MDX 文档 |
| 构建结果 | 静态前端 | 独立 Next.js 服务 |
| 运行时 API | 默认没有项目后端 | 有搜索、LLM 文本等 Route Handler |

独立后，文档站可以使用服务端生成、动态搜索接口和 Fumadocs 内容系统，而不会把这些依赖加入主应用。

## 根目录文件

### `package.json`

主要依赖：

- Next.js。
- React。
- Fumadocs Core。
- Fumadocs UI。
- Fumadocs MDX。
- Orama 搜索。
- Tailwind CSS。

主要命令：

```bash
bun run dev
bun run build
bun run start
bun run types:check
```

- `dev`：启动 Next.js 开发服务器。
- `build`：构建文档站。
- `start`：运行生产构建。
- `types:check`：生成 MDX 和 Next 类型，再执行 TypeScript 检查。

### `README.md`

说明文档站的启动方式、主要目录和路由。

它明确指出这是一个 server-backed Next.js 文档站，搜索和 LLM 文本路由在运行时仍然可用。

### `next.config.mjs`

Next.js 配置。

重点：

- `output: "standalone"`：生成可独立部署的服务端产物。
- 开启 React Strict Mode。
- `/` 重写到 `/en`。
- `/docs/*` 重写到 `/en/docs/*`。
- 使用 Fumadocs MDX 插件。

这说明英文是默认语言路径，URL 会通过 rewrite 兼容不带语言前缀的入口。

### `source.config.ts`

定义 MDX 内容集合。

它告诉 Fumadocs：

- 文档位于 `content/docs`。
- 页面 frontmatter 使用 Fumadocs 的 `pageSchema`。
- 目录元数据使用 `metaSchema`。
- 构建时保留处理后的 Markdown，供 LLM 文本接口使用。

### `tsconfig.json`

文档站 TypeScript 配置。

### `postcss.config.mjs`

Tailwind / PostCSS 配置。

### `Dockerfile`

构建并运行独立的 Next.js 文档服务。

### `docker-compose.yml`

运行已发布的文档镜像。

### `docker-compose.local.yml`

从本地源码构建文档镜像并运行。

### `vercel.json`

文档站的 Vercel 部署配置。

### `index.md` 和 `index.zh-CN.md`

给 AI 使用的文档索引。

项目规则明确要求它们留在 `docs/` 根目录，不要移动到 `content/docs/`。

它们列出文档入口，帮助 Agent 快速定位：

- 快速开始。
- 功能介绍。
- 画布手册。
- 开发文档。
- 项目进度。

## `content/docs/`：真正的文档内容

这里的 `.mdx` 文件是用户最终阅读的正文。

MDX 可以理解为“支持 React 组件的 Markdown”。普通说明仍按 Markdown 写，必要时可以嵌入定制组件。

### 多语言文件命名

通常存在两份：

```text
quick-start.mdx
quick-start.zh-CN.mdx
```

- 不带语言后缀的文件：默认英文。
- `.zh-CN.mdx`：中文。

同一个主题的中英文文件应保持结构和事实一致。

### `meta.json` 和 `meta.zh-CN.json`

控制目录导航、页面排序和本地化标题。

新增文档时，只创建 MDX 文件可能不会按预期显示在导航中，还需要检查对应 meta 文件。

## 文档内容分区

### `content/docs/overview/`

面向普通用户的产品总览：

- 快速开始。
- 功能介绍。
- Docker 部署。
- Render 部署。
- 第三方提示词仓库。
- Codex app 插件。

详细功能说明应该写在这里的 `features.mdx`，而不是不断扩充根 README。

### `content/docs/canvas/`

画布使用文档：

- 节点操作手册。
- 画布快捷键。

修改画布交互、节点操作或快捷键后，应检查这里是否需要同步。

### `content/docs/development/`

开发者文档：

- 本地开发。
- 画布数据结构。
- 本地 Codex Canvas 接入。

这里适合写协议、数据结构和二次开发说明。

### `content/docs/business/`

商业和许可证相关文档。

### `content/docs/support/`

支持、安全和赞助说明。

### `content/docs/progress/`

项目进度文档：

- `todo.mdx`：后续待办。
- `pending-test.mdx`：已经实现、等待用户测试确认的事项。
- 各类方案和计划文档。

项目规则要求：

1. 完成 todo 后，先移入 `pending-test.mdx`。
2. 用户确认测试通过后，再写入正式功能说明。
3. `CHANGELOG.md` 的 `Unreleased` 只做版本级归纳，不逐条复制实现细节。

## `src/app/`：Next.js 路由

Next.js App Router 根据文件夹自动生成路由。

### `src/app/[lang]/`

`[lang]` 是动态语言参数，例如：

```text
/en/docs/...
/zh-CN/docs/...
```

### `src/app/[lang]/layout.tsx`

语言级根布局，负责对应语言环境下的公共 HTML 结构。

### `src/app/[lang]/(home)/`

括号目录是 Route Group，不会出现在 URL 中。

它承载文档站首页：

- `layout.tsx`：首页布局。
- `page.tsx`：首页内容。

### `src/app/[lang]/docs/`

文档页面：

- `layout.tsx`：文档侧栏和页面布局。
- `page.tsx`：文档首页。
- `[...slug]/page.tsx`：匹配任意层级文档路径。

例如：

```text
/zh-CN/docs/overview/quick-start
```

会由 `[...slug]/page.tsx` 根据 slug 找到对应 MDX。

### `src/app/[lang]/docs/progress/changelog/page.tsx`

单独展示项目 Changelog 的页面。

它不是普通 MDX，而是根据根仓库的更新日志数据生成。

## 文档站 API 路由

### `src/app/api/search/route.ts`

提供文档搜索接口，使用 Orama / Fumadocs 的搜索能力。

搜索不是纯浏览器静态文件，因此部署时需要保留 Next.js 服务。

### `src/app/llms.txt/route.ts`

输出适合大语言模型读取的简要文档文本。

### `src/app/llms-full.txt/route.ts`

输出更完整的文档集合。

### `src/app/llms.mdx/docs/[[...slug]]/route.ts`

按具体文档路径输出处理后的 Markdown / MDX 内容。

这些路由使 AI 工具能直接获取干净的文档，而不必解析网页导航和样式。

## `src/lib/`：文档数据层

### `source.ts`

使用 Fumadocs `loader` 加载 `content/docs/`。

它提供：

- 按 slug 查找页面。
- 获取页面树。
- 处理语言。
- 生成页面 Markdown URL。
- 读取构建时处理后的正文，生成 LLM 文本。

可以把它理解为“MDX 文件和页面路由之间的数据桥梁”。

### `i18n.ts`

文档站的语言配置。

### `shared.ts`

共享路径常量，例如文档 URL 和内容 URL。

### `doc-page.tsx`

文档页面渲染相关的共用逻辑。

### `layout.shared.tsx`

文档布局共用配置，例如导航栏、链接和仓库入口。

### `search-tokenizer.ts`

搜索分词逻辑。中文搜索效果相关问题可重点检查这里。

### `cn.ts`

合并 CSS className 的工具。

## `src/components/`：文档站组件

- `provider.tsx`：Fumadocs / 主题等 Provider。
- `search.tsx`：搜索 UI。
- `docs-top-tabs.tsx`：文档顶部标签。
- `mdx.tsx`：MDX 组件映射。

如果希望 Markdown 中的标题、代码块或自定义组件以统一方式渲染，通常从 `mdx.tsx` 入手。

## `src/proxy.ts`

请求代理或语言路由相关逻辑，用于在 Next.js 请求阶段处理访问路径。

不要把它与根目录 `canvas-proxy/` 混淆：

- `docs/src/proxy.ts` 服务文档站路由。
- `canvas-proxy/` 转发 AI HTTP 请求。

## `public/`

文档站公开静态文件：

- `logo.svg`
- `github.svg`
- `qq.svg`

它们通过固定 URL 在文档站中使用。

根目录的 `assets/` 不会自动成为文档站 public 资源。需要在文档站直接访问的资源应放在 `docs/public/`，或明确通过其他路径引入。

## 内容如何变成网页

以中文快速开始为例：

```text
content/docs/overview/quick-start.zh-CN.mdx
    ↓ fumadocs-mdx 构建内容集合
src/lib/source.ts 加载
    ↓
[lang]/docs/[...slug]/page.tsx 根据 URL 查找
    ↓
src/components/mdx.tsx 映射组件
    ↓
浏览器显示文档页面
```

## 常见需求应该去哪里改

| 需求 | 优先查找位置 |
| --- | --- |
| 修改快速开始 | `content/docs/overview/quick-start*.mdx` |
| 修改功能介绍 | `content/docs/overview/features*.mdx` |
| 修改画布手册 | `content/docs/canvas/` |
| 修改开发说明 | `content/docs/development/` |
| 修改 TODO | `content/docs/progress/todo*.mdx` |
| 记录待测试功能 | `content/docs/progress/pending-test*.mdx` |
| 新增文档导航项 | 对应目录的 `meta*.json` |
| 修改文档页面布局 | `src/app/[lang]/docs/layout.tsx` |
| 修改 MDX 组件 | `src/components/mdx.tsx` |
| 修改搜索 | `src/app/api/search/route.ts`、`src/lib/search-tokenizer.ts` |
| 修改多语言配置 | `src/lib/i18n.ts` |
| 修改 LLM 文本输出 | `src/app/llms*`、`src/lib/source.ts` |

## 小白推荐阅读顺序

1. `README.md`：了解如何运行。
2. `package.json`：认识依赖和命令。
3. `content/docs/overview/quick-start.zh-CN.mdx`：先看一篇真实文档。
4. `content/docs/overview/meta.zh-CN.json`：理解导航排序。
5. `source.config.ts`：理解内容从哪里来。
6. `src/lib/source.ts`：理解内容加载。
7. `src/app/[lang]/docs/[...slug]/page.tsx`：理解路由渲染。
8. `src/components/mdx.tsx`：理解 MDX 展示。
9. 最后看搜索和 llms 路由。

## 容易踩坑的地方

- `docs/` 是独立 Next.js 应用，不要按 Vite 项目方式修改。
- 新增文档后要检查中英文版本和 meta 导航。
- `docs/index.md` 是 AI 索引，按项目规则保留在根目录。
- README 应保持简洁，详细功能应写进文档站。
- 已完成但未确认的功能先写 `pending-test.mdx`，不要直接当正式功能发布。
- 文档不要误写成默认云同步；当前数据主要保存在浏览器本地，WebDAV 需要用户配置。
- 安全说明必须写清楚 API Key 存在浏览器本地并由前端直连模型接口。
- 文档站包含运行时 Route Handler，不应简单当成完全静态 HTML 部署。
- 英文是当前默认路由语言，rewrite 和 `[lang]` 路由要一起理解。

