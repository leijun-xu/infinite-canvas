# `canvas-agent` 目录分析

## 一句话理解

`canvas-agent/` 是运行在用户电脑上的“中间人”：一边连接浏览器里的 Infinite Canvas，另一边连接本机的 Codex 或 Claude Code。

它不是网页应用必需的后端。普通的画布和 AI 生成功能可以不启动它；只有需要本地 Agent 对话、MCP 操作画布等能力时才需要。

## 为什么需要它

浏览器页面不能随便启动本机命令，也不能直接控制 Codex CLI。反过来，Codex 也不知道浏览器里当前有哪些画布节点。

Canvas Agent 解决了这两个世界之间的通信问题：

```text
浏览器画布
   ↕ HTTP + SSE
Canvas Agent
   ↕ Codex app-server / Claude CLI
本机 AI 编程 Agent
```

它还提供 MCP 服务：

```text
Codex / Claude
   ↓ MCP 工具调用
canvas-agent mcp
   ↓ HTTP 转发
Canvas Agent HTTP 服务
   ↓ 请求当前网页
浏览器中的画布
```

## 两种启动模式

入口是 `src/index.ts`，逻辑很简单：

- 普通启动：调用 `startHttpServer()`。
- 命令参数为 `mcp`：调用 `startMcpServer()`。

### HTTP 服务模式

```bash
npx -y @basketikun/canvas-agent@latest
```

默认监听：

```text
http://127.0.0.1:17371
```

启动时会生成并显示连接 token。网页需要 URL 和 token 才能连接。

### MCP 模式

```bash
npx -y @basketikun/canvas-agent@latest mcp
```

MCP 模式通过标准输入输出与 Codex / Claude 通信，再把工具调用转发给已经启动的 HTTP 服务。

也就是说，MCP 进程本身不是画布状态的最终持有者，它仍会请求本地 HTTP Agent。

## 根目录文件

### `package.json`

这是一个可以发布到 npm 的独立包：

```text
@basketikun/canvas-agent
```

主要命令：

- `npm run dev`：使用 `tsx` 直接运行 TypeScript。
- `npm run debug`：开启 Debug 模式。
- `npm run test`：运行 Agent 相关测试。
- `npm run build`：使用 TypeScript 编译到 `dist/`。
- `npm run start`：运行编译后的 `dist/index.js`。

它还通过 `bin` 字段注册了 `canvas-agent` 命令。

### `tsconfig.json`

TypeScript 编译配置。与 `web/` 不同，这个包会真正编译并输出到 `dist/`，供 Node.js 和 npm 包执行。

### `README.md`

完整使用说明，包括：

- 启动和 Debug。
- 网页连接方式。
- Codex MCP 安装。
- Codex app 插件。
- Claude Code MCP。
- 可用画布工具。

准备修改 Agent 前应先阅读它。

### `agent-instructions.md`

注入给 Agent 的画布操作说明。

`src/config.ts` 会读取它，并用于：

- MCP Server 的 instructions。
- 初始化 Agent 工作空间中的 `AGENTS.md`。

修改它会影响 Agent 如何理解画布和工具，不只是普通文档变化。

### `codex-server.md`

Codex app-server 相关的开发说明或协议记录，用于理解与 Codex 的底层通信。

## `src/config.ts`：本地配置

默认配置目录：

```text
~/.infinite-canvas/
```

默认配置文件：

```text
~/.infinite-canvas/canvas-agent.json
```

内容主要包括：

- Agent URL。
- 随机连接 token。
- 已允许的网页 Origin。
- Codex 工作空间路径。
- 当前活跃线程。
- 固定线程。

安全措施：

- 配置目录权限设置为 `0700`。
- 配置文件权限设置为 `0600`。
- 默认只监听 `127.0.0.1`。

这意味着其他系统用户不应读取 token，局域网其他机器默认也无法连接。

## `src/server/`：对外通信入口

### `server/http.ts`

这是 Agent 最大的服务入口，基于 Express。

可以按职责拆成几类接口理解。

#### 基础和鉴权

- `/health`：健康检查。
- `/config`：返回协议版本和基本配置。
- token 中间件：除少量公开接口外，请求必须携带正确 token。
- Origin 校验：首次合法网页连接后记录 Origin，防止其他网站复用本地 Agent。

#### 浏览器画布通信

- `/events`：建立 SSE 连接，Agent 持续推送事件给网页。
- `/canvas/state`：网页上报当前画布状态。
- `/canvas/activate`：标记当前活跃网页客户端。
- `/canvas/result`：网页返回工具操作结果。
- `/api/tools`：接收 MCP 工具调用并交给画布 Session。

#### Codex 功能

包括：

- 工作空间查询和修改。
- 模型列表。
- Skills 列表。
- 线程创建、恢复、读取、归档。
- 发起 turn。
- 中断 turn。
- 审批 Codex 操作。
- 从对话或画布生成 Skill 草稿。

#### 本地文件和附件

包括：

- Agent 消息附件读取。
- 本地图片读取。
- 在 Finder 中显示本地文件。

请求体上限目前为 30MB，主要用于网页上传图片附件。这个边界值属于实际行为限制，修改前需要明确评估。

### `server/mcp.ts`

创建 MCP Server，并注册画布工具。

流程：

1. 从 `canvas/schemas.ts` 读取工具名、说明和 Zod schema。
2. 向 MCP SDK 注册工具。
3. 收到调用后校验参数。
4. 请求 HTTP Agent 的 `/api/tools`。
5. 把结果序列化为 MCP 文本响应。

它使用标准输入输出传输，不监听额外网络端口。

## `src/canvas/`：画布协议和会话

### `canvas/schemas.ts`

画布 MCP 工具的参数定义，是工具契约的重要来源。

Zod schema 负责：

- 描述工具输入。
- 在运行时校验 Agent 传来的数据。
- 拒绝不符合结构的操作。

### `canvas/tools.ts`

画布工具辅助逻辑：

- 判断工具名是否合法。
- 校验工具输入。
- 压缩画布快照，避免把超长文本全部塞回 Agent。
- 计算新节点默认放置位置。

### `canvas/operations.ts`

实现画布操作转换，例如：

- 添加节点。
- 更新节点。
- 删除节点。
- 创建或删除连线。
- 选择节点。
- 修改视口。
- 触发生成。

它并不直接修改浏览器 DOM，而是产生网页能够理解的操作，再等待网页执行。

### `canvas/session.ts`

Agent 运行时的核心会话管理器。

它负责维护：

- 当前连接的网页客户端。
- 每个客户端上报的画布快照。
- 当前活跃客户端。
- SSE 事件订阅。
- 待完成的工具调用。
- Codex thread 和 turn 状态。
- 对话状态和 MCP 启动状态。
- 工具结果匹配。

如果出现“工具调用发给了错误页面”“事件归属错误”“网页断开后任务不结束”等问题，应重点检查这里。

### `canvas/types.ts`

Canvas Agent 侧使用的画布数据类型。

这些类型需要与前端公开给 Agent 的快照和操作结构保持一致。

## `src/agent/`：Codex 和 Claude 适配

### `agent/codex.ts`

面向上层 HTTP 服务的 Codex 功能封装。

主要负责：

- 启动和恢复 Codex thread。
- 执行 turn。
- 中断任务。
- 查询模型。
- 读取和整理历史。
- 处理审批。
- 查询和生成 Skill。

### `agent/codex-client.ts`

更底层的 Codex app-server 客户端，处理标准输入输出、请求响应和事件。

### `agent/codex-protocol.ts`

Codex app-server 协议的 TypeScript 类型和数据结构。

### `agent/codex-history.ts`

把 Codex 历史记录转换成网页能够展示的消息结构。

### `agent/codex-event-history.ts`

处理实时事件和历史事件的衔接。

项目规则特别强调：

- 消息必须同时按 `threadId`、`turnId` 和 `itemId` 归属。
- 实时事件只补充尚未物化的 turn。
- 历史快照成为权威后，不能重复合并相同消息。

因此，修改消息合并逻辑时风险较高。

### `agent/message-metadata.ts`

保存消息额外元数据和消息资源，例如附件。

消息存储版本和 Agent 通信协议版本必须独立管理，不能因为协议升级就随意覆盖历史消息。

### `agent/claude.ts`

Claude Code 适配器。

代码当前保留，但网页侧边栏主要开放 Codex。Claude 可以通过单独配置 MCP 操作画布。

### `agent/types.ts`

Agent 通用消息、附件、权限等类型。

## `src/skills/`：Agent Skill 管理

### `skills/store.ts`

负责工作空间内 Skill 的读取、创建和更新。

HTTP 服务通过它支持：

- 查看技能。
- 保存技能。
- 从对话生成技能草稿。
- 从当前画布生成技能草稿。

Skill 是 Agent 可复用的操作说明，不是画布节点插件。两者名称相似，但用途完全不同。

## `src/utils/`：底层工具

- `agent-runtime.ts`：查找和管理 Agent 运行时。
- `logger.ts`：终端和文件日志。
- `date.ts`：日期格式。
- `value.ts`：通用值处理。

Debug 日志默认写到：

```text
~/.infinite-canvas/logs/
```

日志会隐藏 token 和图片 Data URL，避免直接泄漏敏感信息。

## 测试文件

测试和源码放在同一目录，文件名以 `.test.ts` 结尾。

当前覆盖：

- 配置文件和权限。
- 画布 operations。
- Canvas Session。
- Codex Client。
- Codex 历史。
- 消息元数据。
- Skill Store。
- Agent Runtime。

Agent 涉及进程、事件流和并发状态，测试比普通纯函数更重要。

## 一次工具调用如何完成

以 Codex 创建文本节点为例：

```text
1. Codex 决定调用 canvas_create_text_node
2. MCP Server 在 schemas.ts 中校验参数
3. server/mcp.ts 请求本地 HTTP Agent 的 /api/tools
4. CanvasSession 找到当前活跃网页
5. Agent 通过 SSE 或待处理请求通知网页
6. 网页 use-agent-bridge 执行画布操作
7. 网页把结果回传到 /canvas/result
8. CanvasSession 匹配请求并完成 Promise
9. MCP Server 把结果返回给 Codex
```

所以必须同时具备：

- HTTP Agent 正在运行。
- MCP 已注册。
- 网页已经打开并连接。
- 网页中存在可操作的画布。

缺少任意一项，工具都可能提示没有连接画布或超时。

## 常见需求应该去哪里改

| 需求 | 优先查找位置 |
| --- | --- |
| 新增 MCP 工具 | `canvas/schemas.ts`、`canvas/operations.ts`、`server/mcp.ts` |
| 修改网页连接接口 | `server/http.ts` |
| 修改 SSE 和客户端会话 | `canvas/session.ts` |
| 修改 Codex 启动方式 | `agent/codex.ts`、`agent/codex-client.ts` |
| 修改 Codex 事件解析 | `agent/codex-protocol.ts`、历史相关文件 |
| 修改 Claude 调用 | `agent/claude.ts` |
| 修改本地配置 | `config.ts` |
| 修改日志 | `utils/logger.ts` |
| 修改 Skill 管理 | `skills/store.ts` |
| 修改 Agent 提示说明 | `agent-instructions.md` |

## 小白推荐阅读顺序

1. `README.md`：先理解产品使用方式。
2. `package.json`：了解如何启动和构建。
3. `src/index.ts`：理解两种运行模式。
4. `src/config.ts`：理解本地配置和 token。
5. `src/server/mcp.ts`：MCP 入口较短，适合先读。
6. `src/canvas/schemas.ts`：看有哪些工具。
7. `src/canvas/operations.ts`：看工具如何变成画布操作。
8. `src/canvas/session.ts`：理解网页与工具如何关联。
9. `src/server/http.ts`：最后阅读完整 HTTP 服务。
10. 按需求进入 `src/agent/` 的具体适配文件。

## 容易踩坑的地方

- HTTP 模式和 MCP 模式是两个角色，不要误以为只启动 MCP 就能保存画布状态。
- 默认只监听 `127.0.0.1` 是安全设计，不应随意改成公网地址。
- token、Origin 校验和配置文件权限不能随意删除。
- 网页可能有多个标签页，工具调用必须找到正确的活跃客户端。
- Codex 事件既有实时流又有历史快照，合并不当会造成重复消息。
- `threadId`、`turnId`、`itemId` 不能只保留其中一个。
- 图片附件会临时落到本机并传给 Codex，修改流程时要注意清理和隐私。
- Canvas Agent 的 npm 包版本独立于根目录 `VERSION`。
- Claude 适配器存在不代表网页已经完整开放 Claude 入口。

