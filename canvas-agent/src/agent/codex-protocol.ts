import type { JsonRecord } from "../utils/value.js";

export type CodexThread = JsonRecord & { id: string; cwd: string; turns?: CodexTurn[] };
export type CodexTurn = JsonRecord & { id: string; error?: CodexTurnError | null; durationMs?: number | null };
export type CodexTurnError = JsonRecord & { message: string };
export type CodexItem = JsonRecord & { id: string; type: string; text?: string };
export type CodexPlanStep = { step: string; status: "pending" | "inProgress" | "completed" };
export type CodexPlanUpdate = { threadId: string; turnId: string; explanation?: string | null; plan: CodexPlanStep[]; turnStatus?: string };
export type CodexMcpStartupStatus = { threadId: string | null; name: string; status: "starting" | "ready" | "failed" | "cancelled"; error: string | null; failureReason: "reauthenticationRequired" | null };
export type CodexMcpServerStatus = { name: string; authStatus: "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth" } & JsonRecord;
export type CodexReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type CodexModel = JsonRecord & {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: CodexReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: CodexReasoningEffort; description?: string }>;
    isDefault?: boolean;
};

export type CodexSkillScope = "user" | "repo" | "system" | "admin";
export type CodexSkillInterface = JsonRecord & {
    displayName?: string | null;
    shortDescription?: string | null;
    iconSmall?: string | null;
    iconLarge?: string | null;
    iconSmallUrl?: string | null;
    iconLargeUrl?: string | null;
    brandColor?: string | null;
    defaultPrompt?: string | null;
};
export type CodexSkillMetadata = JsonRecord & {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: CodexSkillInterface | null;
    dependencies?: JsonRecord | null;
    path: string;
    scope: CodexSkillScope;
    enabled: boolean;
};
export type CodexSkillError = { path: string; message: string };
export type CodexSkillsListEntry = { cwd: string; skills: CodexSkillMetadata[]; errors: CodexSkillError[] };
export type CodexSkillSelector = { name: string; path: string };

export type CodexTurnInput =
    | { type: "text"; text: string; text_elements: [] }
    | { type: "localImage"; path: string }
    | ({ type: "skill" } & CodexSkillSelector);

type ThreadOptions = {
    approvalPolicy: "never" | "on-request";
    sandbox: "read-only" | "workspace-write" | "danger-full-access";
    config: JsonRecord;
    cwd?: string;
    developerInstructions?: string;
    ephemeral?: boolean;
};

/** Canvas Agent 发给 Codex app-server 的 JSON-RPC 请求契约，定义每个方法的入参和返回值，并通过子进程 stdin/stdout 传输。 */
type CodexRequestSpec = {
    /** 初始化 JSON-RPC 会话并声明客户端信息与支持的能力。 */
    initialize: {
        params: {
            clientInfo: { name: string; title: string; version: string };
            capabilities: { experimentalApi: boolean; requestAttestation: boolean };
        };
        result: JsonRecord;
    };
    /** 创建新的 Codex 对话线程。 */
    "thread/start": {
        params: ThreadOptions & { threadSource: "user" };
        result: { thread: CodexThread };
    };
    /** 恢复已有的 Codex 对话线程。 */
    "thread/resume": {
        params: ThreadOptions & { threadId: string };
        result: { thread: CodexThread };
    };
    /** 从已有线程派生一个新线程，当前用于生成 Skill 草稿。 */
    "thread/fork": {
        params: ThreadOptions & { threadId: string; threadSource: "user" };
        result: { thread: CodexThread };
    };
    /** 分页查询指定工作目录下的历史线程。 */
    "thread/list": {
        params: {
            limit: number;
            sortKey: "updated_at";
            sortDirection: "desc";
            sourceKinds: Array<"cli" | "vscode" | "appServer" | "exec">;
            cwd: string;
            searchTerm?: string;
        };
        result: { data: CodexThread[]; nextCursor: string | null; backwardsCursor: string | null };
    };
    /** 读取指定线程及其 Turn 历史。 */
    "thread/read": {
        params: { threadId: string; includeTurns: boolean };
        result: { thread: CodexThread };
    };
    /** 归档指定线程，使其不再出现在正常历史列表中。 */
    "thread/archive": {
        params: { threadId: string };
        result: Record<string, never>;
    };
    /** 取消订阅指定线程，释放临时线程相关资源。 */
    "thread/unsubscribe": {
        params: { threadId: string };
        result: { status: "notLoaded" | "notSubscribed" | "unsubscribed" };
    };
    /** 查询当前 Codex 账号可用的模型列表。 */
    "model/list": {
        params: { limit: number; includeHidden: boolean };
        result: { data: CodexModel[]; nextCursor: string | null };
    };
    /** 查询线程关联的 MCP Server、工具和认证状态。 */
    "mcpServerStatus/list": {
        params: { cursor?: string | null; limit?: number | null; detail?: "full" | "toolsAndAuthOnly" | null; threadId?: string | null };
        result: { data: CodexMcpServerStatus[]; nextCursor: string | null };
    };
    /** 查询指定工作目录中可发现的 Skill 列表。 */
    "skills/list": {
        params: { cwds: string[]; forceReload?: boolean };
        result: { data: CodexSkillsListEntry[] };
    };
    /** 修改指定 Skill 的启用状态。 */
    "skills/config/write": {
        params: { path?: string | null; name?: string | null; enabled: boolean };
        result: { effectiveEnabled: boolean };
    };
    /** 在指定线程中启动一轮模型任务。 */
    "turn/start": {
        params: { threadId: string; input: CodexTurnInput[]; approvalPolicy: "never" | "on-request"; sandboxPolicy: { type: "readOnly"; networkAccess: boolean } | { type: "workspaceWrite"; networkAccess: boolean } | { type: "dangerFullAccess" }; model?: string; effort?: CodexReasoningEffort; outputSchema?: JsonRecord };
        result: { turn: CodexTurn };
    };
    /** 中断指定线程中正在运行的 Turn。 */
    "turn/interrupt": {
        params: { threadId: string; turnId: string };
        result: Record<string, never>;
    };
};

export type CodexRequestMethod = keyof CodexRequestSpec;
export type CodexRequestParams<Method extends CodexRequestMethod> = CodexRequestSpec[Method]["params"];
export type CodexRequestResult<Method extends CodexRequestMethod> = CodexRequestSpec[Method]["result"];

type TokenUsageBreakdown = {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
};

/** Codex app-server 推送给 Canvas Agent 的 JSON-RPC 通知契约，用于同步线程、任务、流式内容、MCP 和 Skill 状态，不需要返回响应。 */
type CodexNotificationSpec = {
    /** 新线程创建完成。 */
    "thread/started": { thread: CodexThread };
    /** Turn 开始执行。 */
    "turn/started": { threadId?: string; turn: CodexTurn };
    /** Turn 执行结束。 */
    "turn/completed": { threadId?: string; turn: CodexTurn };
    /** Turn 的任务计划或步骤状态发生变化。 */
    "turn/plan/updated": { threadId?: string; turnId: string; explanation?: string | null; plan: CodexPlanStep[] };
    /** Turn 中的消息、推理或工具等 Item 开始处理。 */
    "item/started": { threadId: string; turnId: string; item: CodexItem };
    /** Turn 中的 Item 处理完成。 */
    "item/completed": { threadId: string; turnId: string; item: CodexItem };
    /** 增量推送模型回复文本。 */
    "item/agentMessage/delta": { threadId: string; turnId: string; itemId: string; delta: string };
    /** 增量推送计划文本。 */
    "item/plan/delta": { threadId: string; turnId: string; itemId: string; delta: string };
    /** 增量推送模型推理摘要文本。 */
    "item/reasoning/summaryTextDelta": { threadId: string; turnId: string; itemId: string; delta: string; summaryIndex: number };
    /** 增量推送命令执行输出。 */
    "item/commandExecution/outputDelta": { threadId: string; turnId: string; itemId: string; delta: string };
    /** 推送线程最新的 Token 使用量。 */
    "thread/tokenUsage/updated": { threadId: string; turnId: string; tokenUsage: { last: TokenUsageBreakdown } };
    /** 推送 MCP Server 的启动进度和认证状态。 */
    "mcpServer/startupStatus/updated": CodexMcpStartupStatus;
    /** 通知 Skill 文件或配置发生变化，需要重新加载列表。 */
    "skills/changed": Record<string, never>;
    /** 推送 Turn 执行错误以及是否会自动重试。 */
    error: { threadId: string; turnId: string; error: CodexTurnError; willRetry: boolean };
};

export type CodexNotificationMethod = keyof CodexNotificationSpec;
export type CodexNotificationParams<Method extends CodexNotificationMethod> = CodexNotificationSpec[Method];
