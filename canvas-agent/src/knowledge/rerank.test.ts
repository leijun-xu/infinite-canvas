import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chunkDocument } from "./chunker.js";
import { encodeVector } from "./embedding-provider.js";
import { KnowledgeSearchIndex } from "./hybrid-search.js";
import { validRerankTimeout } from "./rerank-provider.js";
import { KnowledgeStore } from "./store.js";

const connection = { enabled: true, baseUrl: "https://api.siliconflow.cn/v1", apiKey: "test-key", model: "BAAI/bge-m3" };
const rerank = { enabled: true, model: "Qwen/Qwen3-Reranker-0.6B", timeoutSeconds: 5 };
const chunks = Array.from({ length: 60 }, (_, index) => chunkDocument({
    id: `document-${index}`, sourceId: "source", sourceKind: "workspace", title: `title-${index}`,
    content: `正文 ${index}`, reference: `/document-${index}.md`, updatedAt: "",
})[0]);
const keyword = chunks.slice(0, 30).map((chunk) => ({ id: chunk.id }));

function createIndex(vectors = false) {
    const index = new KnowledgeSearchIndex();
    index.rebuild(chunks.map((chunk) => vectors ? { ...chunk, embedding: encodeVector([1, 0]) } : chunk), 2);
    return index;
}

test("精排覆盖完整融合候选，在截取 Top20 前提升原本未入选的向量结果", async (context) => {
    context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
        if (url.endsWith("/embeddings")) return Response.json({ data: [{ index: 0, embedding: [1, 0] }] });
        assert.equal(url, `${connection.baseUrl}/rerank`);
        const body = JSON.parse(String(init.body));
        assert.equal(body.model, rerank.model);
        assert.equal(body.query, "问题");
        assert.equal(body.documents.length, 60);
        assert.equal(body.top_n, 60);
        assert.equal(body.return_documents, false);
        assert.ok(body.documents.includes("title-59\n\n正文 59"));
        return Response.json({ results: body.documents.map((_: string, index: number) => ({ index, relevance_score: index })) });
    });
    const index = createIndex(true);
    const results = await index.search("问题", keyword, undefined, connection, { baseUrl: connection.baseUrl, model: connection.model, dimensions: 2 },
        () => chunks.slice(30).map((chunk) => ({ id: chunk.id, score: 1 })), rerank);
    assert.equal(results.length, 20);
    assert.equal(results[0].chunkId, chunks[59].id);
    assert.equal(results[0].vectorRank, 30);
    assert.equal(results[0].retrievalMode, "hybrid");
    assert.equal(results[0].rerankStatus, "success");
    assert.equal(results[0].rerankScore, 59);
    assert.equal(results[0].score, 1 / 90);
});

test("关闭 Embedding 仍可对关键词候选精排，保留引用和原始 RRF 分数", async (context) => {
    context.mock.method(globalThis, "fetch", async () => Response.json({
        results: keyword.map((_, index) => ({ index, relevance_score: index })),
    }));
    const results = await createIndex().search("问题", keyword, 1, { ...connection, enabled: false }, undefined, undefined, rerank);
    assert.equal(results[0].chunkId, chunks[29].id);
    assert.equal(results[0].retrievalMode, "keyword");
    assert.equal(results[0].reference, chunks[29].reference);
    assert.equal(results[0].score, 1 / 90);
    assert.equal(results[0].rerankStatus, "success");
});

test("精排关闭、没有候选时不请求第三方接口", async (context) => {
    const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
    const index = createIndex();
    const results = await index.search("问题", keyword, 1, connection, undefined, undefined, { ...rerank, enabled: false });
    assert.equal(results[0].rerankStatus, undefined);
    assert.deepEqual(await index.search("问题", [], undefined, connection, undefined, undefined, rerank), []);
    assert.equal(fetch.mock.callCount(), 0);
});

for (const [name, response] of [
    ["HTTP 失败", () => new Response("", { status: 503 })],
    ["非法 JSON", () => new Response("invalid")],
    ["漏候选", () => Response.json({ results: [{ index: 0, relevance_score: 1 }] })],
    ["重复索引", () => Response.json({ results: keyword.map(() => ({ index: 0, relevance_score: 1 })) })],
    ["越界索引", () => Response.json({ results: keyword.map((_, index) => ({ index: index + 1, relevance_score: 1 })) })],
    ["无效分数", () => Response.json({ results: keyword.map((_, index) => ({ index, relevance_score: null })) })],
    ["网络失败", () => { throw new Error("network failure"); }],
] as const) {
    test(`${name}保留原始顺序与结果数`, async (context) => {
        context.mock.method(globalThis, "fetch", async () => response());
        const results = await createIndex().search("问题", keyword, undefined, connection, undefined, undefined, rerank);
        assert.deepEqual(results.map((item) => item.chunkId), keyword.slice(0, 20).map((item) => item.id));
        assert.ok(results.every((item) => item.rerankStatus === "fallback" && item.rerankScore === undefined));
    });
}

test("响应正文读取超时也中止精排并保留原排序", async (context) => {
    context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => ({
        ok: true,
        json: () => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    } as Response));
    const results = await createIndex().search("问题", keyword, 2, connection, undefined, undefined, { ...rerank, timeoutSeconds: 0.001 });
    assert.equal(results[0].chunkId, chunks[0].id);
    assert.equal(results.length, 2);
    assert.equal(results[0].rerankStatus, "fallback");
});

test("缺少 API Key 或超时配置时不发送请求，定时器溢出值被拒绝", async (context) => {
    const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
    const index = createIndex();
    for (const [config, savedConnection] of [[{ ...rerank, timeoutSeconds: undefined }, connection], [rerank, { ...connection, apiKey: "" }]] as const) {
        const results = await index.search("问题", keyword, 1, savedConnection, undefined, undefined, config);
        assert.equal(results[0].rerankStatus, "fallback");
    }
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(validRerankTimeout(Infinity), false);
    assert.equal(validRerankTimeout(0), false);
    assert.equal(validRerankTimeout(2_147_483.648), false);
    assert.equal(validRerankTimeout(1), true);
});

test("KnowledgeStore 检索实时读取精排配置，并在清除共用 Key 后回退", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-rerank-"));
    let enabled = false;
    let apiKey = connection.apiKey;
    const store = new KnowledgeStore(workspace, () => ({ ...connection, enabled: false, apiKey }), undefined, () => ({ ...rerank, enabled }));
    context.after(async () => {
        store.close();
        await fs.rm(workspace, { recursive: true, force: true });
    });
    const fetch = context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        return Response.json({ results: body.documents.map((_: string, index: number) => ({ index, relevance_score: index })) });
    });
    await store.initialize();
    await store.syncCanvases([{ id: "canvas", title: "canvas", updatedAt: "", documents: [
        { id: "first", title: "first", content: "知识检索资料", reference: "/canvas/first" },
        { id: "second", title: "second", content: "知识检索资料", reference: "/canvas/second" },
    ] }]);
    const original = await store.search("知识", 2);
    assert.equal(original.length, 2);
    enabled = true;
    const reranked = await store.search("知识", 1);
    assert.equal(reranked[0].chunkId, original[1].chunkId);
    assert.equal(reranked[0].rerankStatus, "success");
    apiKey = "";
    const fallback = await store.search("知识", 1);
    assert.equal(fallback[0].chunkId, original[0].chunkId);
    assert.equal(fallback[0].rerankStatus, "fallback");
    assert.equal(fetch.mock.callCount(), 1);
});
