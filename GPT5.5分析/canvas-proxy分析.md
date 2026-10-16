# `canvas-proxy` 目录分析

## 一句话理解

`canvas-proxy/` 是一个非常小的本地 HTTP 转发器，专门帮助浏览器绕过第三方 AI 接口的 CORS 限制。

它不是模型服务，也不是项目后端，更不会生成图片。它只负责把浏览器请求原样转交给真正的模型接口，再把响应传回来。

## 什么是 CORS

浏览器有一条安全规则：网页不能随意请求其他域名，除非对方明确允许。

例如 Infinite Canvas 运行在：

```text
http://localhost:3000
```

用户配置的模型接口是：

```text
https://api.example.com/v1/images/generations
```

如果 `api.example.com` 没有返回允许跨域访问的响应头，浏览器就会拦截请求。即使接口本身可用，页面也拿不到结果。

Canvas Proxy 的解决方式是：

```text
浏览器
  ↓ 请求本机，不受第三方跨域限制
http://127.0.0.1:23210/https://api.example.com/...
  ↓ Canvas Proxy 转发
https://api.example.com/...
```

代理返回响应时会补充宽松的 CORS 响应头，因此浏览器可以读取结果。

## 它与其他目录的区别

| 目录 | 作用 |
| --- | --- |
| `web/` | 用户实际操作的网页 |
| `canvas-agent/` | 连接网页和 Codex / Claude |
| `canvas-proxy/` | 转发 AI HTTP 请求，解决跨域 |

三者可以独立理解：

- 模型接口支持 CORS：不需要启动 Proxy。
- 不使用本地 Agent：不需要启动 Canvas Agent。
- 只要使用产品界面：需要运行或访问 Web。

## 目录为什么这么小

这个包只有三个主要文件：

```text
canvas-proxy/
├── index.js
├── package.json
└── README.md
```

这是刻意保持简单的结果。它没有 Express，也没有复杂配置，直接使用 Node.js 内置 HTTP Server 和 `fetch`。

## `package.json`

包名：

```text
@basketikun/canvas-proxy
```

它通过 `bin` 字段注册 `canvas-proxy` 命令，所以用户可以执行：

```bash
npx @basketikun/canvas-proxy@latest
```

主要配置：

- 运行时要求 Node.js 18 或更高。
- `type: module` 表示使用 ESM。
- `main` 和命令入口都是 `index.js`。
- 没有第三方运行依赖。

这个包可以独立发布到 npm，不依赖整个仓库一起运行。

## `README.md`

面向用户的使用说明。

它说明了：

- 如何启动代理。
- 默认地址和端口。
- 如何在 Infinite Canvas 配置页中填写代理地址。
- 请求 URL 如何拼接。
- 日志格式。
- 安全注意事项。

修改命令参数、默认端口或转发行为后，需要同步更新这里。

## `index.js` 整体流程

一次请求会经过：

```text
1. Node HTTP Server 收到请求
2. 从路径中解析完整目标 URL
3. 读取请求头和请求体
4. 使用 fetch 请求目标地址
5. 复制上游状态码和响应头
6. 补充 CORS 响应头
7. 把响应体以流的方式传回浏览器
8. 在终端打印一行日志
```

## 关键代码模块

### `CORS_HEADERS`

统一定义代理返回给浏览器的跨域头：

- 允许任意来源。
- 允许任意请求方法。
- 允许任意请求头。
- 暴露响应头。

这些设置适合只监听本机的开发代理，但不适合直接暴露到公网。

### `SKIP_REQUEST_HEADERS`

转发请求时需要删除部分请求头，例如：

- `host`
- `connection`
- `content-length`
- `origin`
- `referer`
- `sec-fetch-*`

这些头描述的是“浏览器到本地代理”这一跳，不应原样带给目标模型服务。

`content-length` 由 `fetch` 根据真正发送的请求体重新计算。

### `SKIP_RESPONSE_HEADERS`

响应经过 Node `fetch` 后可能已经解压或重新分帧，因此不能继续照搬：

- `content-encoding`
- `content-length`
- `transfer-encoding`
- `connection`
- `keep-alive`

否则浏览器可能根据错误长度或编码解析响应。

### `readArg`

读取命令行参数：

```bash
--port 23210
--host 127.0.0.1
```

如果命令行没有提供，则读取 `PORT` 和 `HOST` 环境变量，最后使用默认值。

### `readBody`

把 Node HTTP 请求体的多个数据块收集成一个 Buffer。

GET 和 HEAD 请求不会读取并转发请求体，其他方法会读取。

### `readTarget`

从代理 URL 的路径中解析真实目标地址。

例如：

```text
/https://api.openai.com/v1/models
```

会解析为：

```text
https://api.openai.com/v1/models
```

它还处理：

- 浏览器对路径进行的 URI 转义。
- 某些客户端把 `https://` 中多个斜杠折叠的情况。
- 非 HTTP/HTTPS 地址直接判定为无效。

### `requestHeaders`

复制浏览器请求头，同时删除不应该转发的逐跳或浏览器来源请求头。

`Authorization` 不在删除列表中，因此 API Key 会被转发到真正的模型接口。

代理不会保存这个 Key，但它会经过代理进程内存。

### `responseHeaders`

复制上游响应头，同时：

- 删除已经失效的传输头。
- 避免复制上游自身的 CORS 头。
- 使用代理统一的宽松 CORS 头。

### `forward`

实际执行转发：

1. 根据请求方法读取 body。
2. 调用 Node `fetch`。
3. 将上游状态码和响应头写给浏览器。
4. 把上游 `ReadableStream` 转成 Node Stream。
5. 使用 `pipe` 流式返回。

流式传输很重要，因为文本生成和 Agent 接口可能使用 SSE。如果等待全部响应结束再返回，网页就无法实时显示内容。

### `createProxyServer`

创建 HTTP Server。

它处理三类请求：

#### OPTIONS

直接返回 `204` 和 CORS 头，用于浏览器预检。

#### 根路径或无效目标

返回代理名称、版本和使用方式。前端可以利用这个接口检查代理是否在线。

#### 有效目标 URL

调用 `forward`。成功打印状态码，失败返回 `502`。

### 命令行启动部分

支持：

```bash
--help
-h
--port
--host
```

默认：

```text
host = 127.0.0.1
port = 23210
```

## 请求示例

直接请求：

```text
https://api.openai.com/v1/models
```

通过代理：

```text
http://127.0.0.1:23210/https://api.openai.com/v1/models
```

请求方法、Authorization、Content-Type 和请求体会继续转发。

## 日志说明

每次转发会打印：

```text
时间 方法 目标地址 -> 状态码 耗时
```

例如：

```text
4:05:42 PM GET https://api.openai.com/v1/models -> 200 0.9s
```

日志特点：

- 只打印到终端。
- 不写文件。
- 不打印请求头。
- 不打印请求体。
- SSE 请求收到响应头后就会打印，不等待整个流结束。

完整目标 URL 会被打印。如果用户把敏感信息放在 URL 查询参数中，仍可能出现在终端日志中，因此密钥应放在 Authorization 请求头，不应拼进 URL。

## 安全边界

### 为什么默认只监听 `127.0.0.1`

代理可以请求任意 HTTP/HTTPS 地址，并且会转发调用者提供的请求头。

如果监听 `0.0.0.0` 并暴露到局域网或公网，其他人可能利用它：

- 访问原本不能跨域访问的服务。
- 探测当前机器或内网地址。
- 滥用网络带宽。
- 借代理发起带凭证的请求。

所以 README 明确不建议使用：

```bash
--host 0.0.0.0
```

### 它没有身份验证

Canvas Proxy 没有 token 或账号系统。安全性主要依赖只监听本机地址。

### 它不会保护 API Key

API Key 仍由浏览器保存并随请求发送。Proxy 只是中转，不会加密、托管或替换 Key。

## 常见问题

### 启动代理后仍然请求失败

依次检查：

1. 浏览器配置中的代理开关是否打开。
2. 代理地址是否是 `http://127.0.0.1:23210`。
3. 终端是否出现请求日志。
4. 日志中的上游状态码是否是 401、403、404 或 500。
5. 模型 Base URL 是否正确。
6. API Key 是否有效。

CORS 只是其中一种失败原因。代理能解决跨域，但不能解决 Key 错误、余额不足、模型名错误或上游服务故障。

### 根路径返回 JSON 是不是错误

不是。访问：

```text
http://127.0.0.1:23210/
```

本来就会返回版本和用法，用于健康检查。

### 为什么响应头少了一些

代理主动删除了压缩、长度和连接相关头，因为 Node `fetch` 已经处理了这些传输细节。

### 为什么没有数据库和配置文件

这个代理不保存状态。端口和 host 由命令参数或环境变量提供，不需要数据库。

## 常见需求应该去哪里改

这个目录只有一个实现文件，需求基本都在 `index.js`：

| 需求 | 位置 |
| --- | --- |
| 修改默认端口 | 文件底部的 port 默认值、README |
| 修改监听地址 | 文件底部的 host 默认值、README |
| 修改 URL 解析 | `readTarget` |
| 修改转发请求头 | `SKIP_REQUEST_HEADERS`、`requestHeaders` |
| 修改响应头 | `SKIP_RESPONSE_HEADERS`、`responseHeaders` |
| 修改日志 | `logForward` |
| 修改错误响应 | `sendJson`、`createProxyServer` |
| 修改流式转发 | `forward` |

## 小白推荐阅读顺序

1. `README.md`：先理解使用场景。
2. `package.json`：了解它没有第三方依赖。
3. `index.js` 底部：看服务如何启动。
4. `createProxyServer`：看请求分支。
5. `forward`：看真正的转发。
6. 最后看请求头、响应头和 URL 解析辅助函数。

## 修改时的注意事项

- 不要为了方便默认监听 `0.0.0.0`。
- 不要记录 Authorization、请求体或图片 Base64。
- 不要破坏 SSE 流式转发。
- 不要把上游 `content-length` 原样返回。
- 不要把 `host` 和浏览器的 `origin` 原样转发。
- 增加请求大小、超时、重试等行为边界前，需要先说明默认值和失败处理并取得确认。
- 修改使用方式后同步更新 `README.md` 和前端本地代理配置逻辑。

