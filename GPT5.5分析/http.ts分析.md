# `canvas-agent/src/server/http.ts` 详细分析

## 一句话理解

`http.ts` 是 Canvas Agent 的本地 HTTP 服务入口。

它像一个“本机调度中心”：

```text
浏览器 Web
    ↕ HTTP + SSE
http.ts
    ├── CanvasSession：保存连接、画布快照和运行状态
    ├── Codex：创建会话、发送任务、处理中断和审批
    ├── MCP：接收工具调用，再转交浏览器执行
    ├── SkillStore：管理本地 Skill
    └── 本地文件：读取图片、定位文件
```

它不负责：

- 绘制画布。
- 保存浏览器里的画布项目。
- 直接请求 Web 配置的生图、视频和音频渠道。
- 实现每一种画布节点操作。

这些业务最终由 Web、`CanvasSession` 或 Codex 相关模块完成。`http.ts` 主要负责接收请求、校验请求、调用正确模块并返回结果。

## 文件入口

Canvas Agent 的程序入口在 `canvas-agent/src/index.ts`：

```ts
if (process.argv[2] === "mcp") await startMcpServer();
else startHttpServer();
```

因此：

- `canvas-agent mcp` 启动 MCP 标准输入输出进程。
- 不带 `mcp` 参数时，调用 `http.ts` 中的 `startHttpServer()`。

普通 HTTP 服务默认监听：

```text
http://127.0.0.1:17371
```

`127.0.0.1` 表示只监听当前电脑，不直接向局域网或互联网开放。

## 一、服务启动

入口函数：

```ts
export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT)
        || Number(new URL(config.url).port)
        || DEFAULT_PORT;

    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);
}
```

启动过程包括：

1. 读取 `~/.infinite-canvas/canvas-agent.json`。
2. 优先使用环境变量 `PORT`。
3. 没有环境变量时，使用配置文件中的端口。
4. 仍然没有端口时，使用默认端口。
5. 把最终 URL 保存回配置文件。

然后创建两个核心对象：

```ts
const session = new CanvasSession(initialWorkspace.activeThreadId || "");
const skillStore = new SkillStore(initialWorkspace.workspacePath);
```

### `CanvasSession`

负责管理运行期间的状态：

- 哪些浏览器标签页已经连接。
- 当前活动标签页。
- 最新画布节点和连线快照。
- 当前 Codex `threadId` 和 `turnId`。
- Codex 是否正在运行。
- 等待 Web 返回结果的 MCP Tool。
- SSE 客户端和实时事件。

### `SkillStore`

负责管理项目工作区中的 Agent Skill：

- 查询 Skill。
- 创建 Skill。
- 更新 Skill。
- 删除 Skill。
- 判断 Skill 是否由当前项目管理。

## 二、统一事件出口 `emit()`

Codex 的回答不是一次性返回的，它会持续产生：

- 初始化状态。
- 文本消息。
- 推理过程。
- 工具调用。
- 审批请求。
- 错误。
- 完成事件。

`emit()` 负责统一整理这些事件，再交给 `CanvasSession` 通过 SSE 推送。

```ts
const emit = (type: string, payload: unknown) => {
    // 补充 threadId、turnId 和 sourceClientId
    session.trackCodexEvent(type, data);
    threadId
        ? session.emitThread(type, threadId, data)
        : session.emitAll(type, data);
};
```

三个重要归属字段：

- `threadId`：属于哪一条长期对话。
- `turnId`：属于这条对话中的哪一轮任务。
- `sourceClientId`：任务由哪个浏览器标签页发起。

这样多个页面或多个对话同时存在时，消息不会被发送到错误位置。

## 三、准备 Codex 对话

### 创建新草稿线程

`prepareDraftThread()` 用于提前创建一条空 Codex 对话：

```ts
const prepareDraftThread = (clientId, permission) => {
    if (draftThreadStart) return draftThreadStart;
    // 创建 Codex thread
};
```

`draftThreadStart` 保存当前正在执行的 Promise。

如果多个地方同时请求创建新线程，后续请求会复用这个 Promise，而不是重复创建多个线程。

### 第 77 行的含义

```ts
if (draftThreadStart === prepared) {
    // 记录当前任务的失败状态
}
```

这里是在防止旧异步任务污染新状态。

假设：

```text
任务 A 开始创建线程
任务 B 成为新的准备任务
任务 A 较晚才失败
```

如果不判断 `draftThreadStart === prepared`，任务 A 的失败可能覆盖任务 B 的最新状态。

因此这行代码表达的是：

> 只有这个失败的 Promise 仍然是当前有效的准备任务，才允许它更新失败状态。

`finally` 中也有相同判断：

```ts
if (draftThreadStart === prepared) draftThreadStart = null;
```

旧任务不能清空新任务正在使用的 `draftThreadStart`。

### 恢复已有线程

`prepareExistingThread()` 用于恢复历史 Codex 对话：

1. 标记对话正在准备。
2. 调用 `resumeCodexThread()`。
3. 等待 Codex 和 MCP 清单加载完成。
4. 将会话状态改为可用。

## 四、Express 中间件

中间件可以理解为“每个接口进入前都要经过的公共检查”。

### JSON 请求体

```ts
app.use(express.json({ limit: "30mb" }));
```

允许接口接收 JSON，请求体上限为 `30MB`。这个容量主要用于对话图片附件等数据。

### 请求日志

服务会记录：

- HTTP 方法。
- 请求路径。
- 状态码。
- 执行耗时。

健康检查、画布状态同步等高频成功请求会被忽略，避免日志过多。

### CORS 来源检查

浏览器会携带 `Origin`，例如：

```text
http://localhost:3002
https://canvas.best
```

`setCors()` 判断这个网页是否允许连接本地 Agent。

当一个来源首次携带正确 token 请求时，会被加入：

```json
{
  "origins": [
    "http://localhost:3002"
  ]
}
```

并保存到 `~/.infinite-canvas/canvas-agent.json`。

### token 鉴权

除了 `/health` 和 `/config`，后续接口都要携带 token。

支持两种方式：

```text
?token=连接令牌
```

或者：

```http
x-canvas-agent-token: 连接令牌
```

验证失败返回：

```http
401 Unauthorized
```

## 五、基础接口

### `GET /health`

返回服务健康状态，用于判断 Agent 是否启动。

### `GET /config`

返回：

- Agent 通信协议版本。
- 本地 Agent URL。
- 是否配置了 token。

它不会直接返回真实 token。

### `GET /events`

建立 SSE 长连接。

HTTP 普通请求是：

```text
客户端请求 → 服务端响应 → 连接结束
```

SSE 是：

```text
客户端请求 → 连接保持打开
             服务端持续推送事件
```

Codex 的消息、工具调用和状态变化都通过这个连接发送给 Web。

## 六、画布通信接口

### `POST /canvas/state`

Web 把当前画布快照同步给 Agent，包括：

- 项目 ID。
- 节点。
- 连线。
- 当前选中节点。
- 视口。
- 生成任务状态。

Agent 读取画布时，读取的是这份最新快照。

### `POST /canvas/activate`

将某个浏览器标签页设为当前活动页面。

当多个标签页同时连接时，Agent 需要知道工具操作应该发给哪个页面。

### `POST /canvas/result`

Web 执行完 Tool 后，通过这个接口回传结果。

`requestId` 用于匹配：

```text
哪一次工具请求 → 对应哪一次执行结果
```

找不到等待中的请求时返回 `409`。

### `POST /api/tools`

这是 MCP 调用画布 Tool 的入口：

```ts
await session.callTool(
    req.body?.name,
    req.body?.input || {},
);
```

调用链：

```text
Codex
→ MCP 进程
→ POST /api/tools
→ CanvasSession.callTool()
→ SSE 通知 Web
→ Web 执行画布操作
→ POST /canvas/result
→ 返回 MCP
→ 返回 Codex
```

读取类 Tool 可以直接使用 Agent 缓存的画布快照，修改类 Tool 通常需要 Web 真正执行。

## 七、附件和本地文件接口

### `GET /agent/attachments/:attachmentId`

读取本轮对话中上传的图片附件。

附件在 Agent 中以 Data URL 保存，这里取出 Base64 内容后转换成二进制图片。

### `GET /agent/message-assets/:messageKey/:assetFile`

读取已保存消息关联的图片或其他媒体资源。

### `POST /agent/local-file/reveal`

在系统文件管理器中定位文件：

- macOS 使用 `open -R`。
- Windows 使用 `explorer.exe`。
- Linux 使用 `xdg-open`。

接口要求传入绝对路径。

### `POST /agent/local-image`

读取本地图片并返回给浏览器展示。

它会检查：

- 路径必须是绝对路径。
- 扩展名必须是支持的图片格式。
- 路径必须指向真实文件。

## 八、模型和 Skill 接口

### 模型接口

```text
GET /agent/codex/models
```

查询 Codex 当前支持的模型。

### Skill 接口

```text
GET  /agent/codex/skills
GET  /agent/codex/skills/:name
POST /agent/codex/skills
POST /agent/codex/skills/:name
POST /agent/codex/skills/:name/enabled
POST /agent/codex/skills/:name/delete
POST /agent/codex/skills/draft
```

这些接口用于：

- 查询 Skill。
- 创建和编辑 Skill。
- 启用或停用 Skill。
- 删除 Skill。
- 从当前对话或画布提炼 Skill 草稿。

Skill 发生变化后，服务会通过 SSE 广播：

```text
skills_changed
```

Web 收到后刷新 Skill 列表。

## 九、Codex 线程接口

一条 Codex 对话由两个主要 ID 组成：

```text
threadId：整条长期对话
turnId：对话中的一轮任务
```

相关接口：

```text
GET  /agent/codex/threads
POST /agent/codex/threads/new
POST /agent/codex/threads/reset
GET  /agent/codex/threads/:threadId
POST /agent/codex/threads/:threadId/resume
POST /agent/codex/threads/:threadId/delete
POST /agent/codex/history/ack
```

它们负责：

- 查询历史对话。
- 创建空对话。
- 重置当前对话。
- 读取历史消息。
- 恢复历史对话。
- 归档对话。
- 确认 Web 已经接收历史快照。

## 十、发送一轮 Codex 任务

核心接口：

```http
POST /agent/codex/turn
```

主要请求参数：

- `prompt`：真正发给 Codex 的任务。
- `messageText`：显示在 Web 聊天区的文本。
- `threadId`：当前对话。
- `conversationId`：当前前端会话实例。
- `expectedRevision`：前端认为的会话版本。
- `clientId`：发起任务的浏览器标签页。
- `model`：Codex 模型。
- `effort`：推理强度。
- `permissionMode`：操作权限。
- `skill`：本轮使用的 Skill。
- `attachments`：本轮图片附件。

### 为什么检查会话版本

如果多个页面同时切换对话，某个旧页面可能向已经过期的线程发送消息。

代码会比较：

```text
请求中的 threadId
请求中的 conversationId
请求中的 expectedRevision
服务端当前会话状态
```

不一致时返回：

```text
409 CONVERSATION_STALE
```

这样可以防止消息发进错误的会话。

### 为什么接口很快返回

`runCodexTurn()` 前面使用了：

```ts
void runCodexTurn(...);
```

表示启动异步任务，但不等待整个 Codex 回答完成。

HTTP 接口先返回：

```json
{
  "ok": true,
  "threadId": "..."
}
```

后续消息通过 `/events` 的 SSE 连接持续推送。

### 运行期间的回调

- `onStart`：绑定发起任务的浏览器。
- `onThread`：取得或更新真实 `threadId`。
- `onTurn`：取得本轮 `turnId`。
- `onFinish`：释放浏览器绑定、附件和 busy 状态。

## 十一、并发保护 `codexMutation()`

创建、切换、删除会话属于写操作，不能同时修改同一份状态。

`codexMutation()` 相当于一把锁：

```ts
if (!session.beginCodexMutation()) {
    return res.status(409).json({
        code: "CONVERSATION_BUSY",
    });
}
```

如果已有 Codex 任务或会话切换正在运行，新的写操作会被拒绝。

无论成功还是失败，`finally` 都会释放锁：

```ts
finally {
    session.endCodexMutation();
}
```

## 十二、审批、停止和 Claude

### `POST /agent/codex/approval`

处理 Codex 的权限审批：

- `accept`：本次允许。
- `acceptForSession`：本次会话持续允许。
- `decline`：拒绝。
- `cancel`：取消。

### `POST /agent/codex/interrupt`

停止当前 Codex 任务。

### `POST /agent/claude/turn`

启动 Claude CLI 对话链路。

它和 Codex 链路相互独立，但共用 HTTP 服务的事件转发能力。

## 十三、404 和统一错误处理

没有匹配到接口时：

```json
{
  "ok": false,
  "error": "not found"
}
```

异步接口统一由 `route()` 包装：

```ts
function route(handler) {
    return (req, res, next) =>
        void handler(req, res).catch(next);
}
```

这样异步函数抛出的异常会进入 Express 错误处理中间件，不会变成未处理的 Promise。

错误最终被转换成统一 JSON：

```json
{
  "ok": false,
  "error": "具体错误信息"
}
```

## 十四、完整请求示例

用户在 Web Agent 面板输入：

```text
帮我创建一个标题为“产品方案”的文本节点
```

完整过程：

```text
1. Web 调用 POST /agent/codex/turn
2. http.ts 校验 token、clientId 和会话版本
3. http.ts 调用 runCodexTurn()
4. Codex 判断需要调用 canvas_create_text_node
5. MCP 请求 POST /api/tools
6. http.ts 调用 session.callTool()
7. CanvasSession 通过 SSE 发送 tool_call
8. Web 收到事件并创建文本节点
9. Web 调用 POST /canvas/result
10. CanvasSession 将结果返回 MCP
11. MCP 将结果返回 Codex
12. Codex 继续回答用户
13. 回答通过 SSE 实时显示在 Web
```

## 十五、阅读这个文件时抓住四条主线

### 连接

```text
/health
/config
/events
```

负责发现 Agent 和建立实时连接。

### 画布

```text
/canvas/state
/canvas/activate
/canvas/result
/api/tools
```

负责 MCP 和 Web 画布之间的双向通信。

### 对话

```text
/agent/codex/threads/*
/agent/codex/turn
/agent/codex/approval
/agent/codex/interrupt
```

负责 Codex 对话生命周期。

### 扩展

```text
/agent/codex/skills/*
/agent/attachments/*
/agent/local-*
```

负责 Skill、附件和本地文件能力。

## 总结

`http.ts` 的核心职责可以归纳成五点：

1. 启动只监听本机的 Express 服务。
2. 使用 Origin 和 token 保护本地能力。
3. 通过 HTTP 和 SSE 连接 Web。
4. 管理 Codex 对话、Skill、审批和中断。
5. 把 MCP 工具调用转发给真正持有画布状态的 Web。

它是整个 Canvas Agent 的接口层和调度层，而不是画布业务或 AI 模型实现层。
