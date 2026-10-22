import assert from "node:assert/strict";
import test from "node:test";

import { chunkDocument } from "./chunker.js";
import { encodeVector } from "./embedding-provider.js";
import { KnowledgeSearchIndex } from "./hybrid-search.js";
import type { KnowledgeDocument } from "./types.js";

const document: KnowledgeDocument = {
    id: "document",
    sourceId: "source",
    sourceKind: "workspace",
    title: "architecture.md",
    content: "# 检索架构\n\n关键词索引负责精确召回。\n\n向量索引负责语义召回。",
    reference: "/architecture.md",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

test("未配置 Embedding 时使用 Chunk 级关键词检索", async () => {
    const index = new KnowledgeSearchIndex();
    const chunks = chunkDocument(document);
    index.rebuild(chunks);

    const results = await index.search("关键词索引", [{ id: chunks[0].id }], undefined, undefined);

    assert.equal(results.length, 1);
    assert.equal(results[0].id, document.id);
    assert.equal(results[0].retrievalMode, "keyword");
    assert.equal(results[0].keywordRank, 1);
    assert.ok(results[0].startLine > 0);
    assert.match(results[0].excerpt, /关键词索引/);
});

test("查询 Embedding 失败时降级为关键词结果", async (context) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("network unavailable");
    };
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    const [chunk] = chunkDocument(document);
    const index = new KnowledgeSearchIndex();
    index.rebuild([{ ...chunk, embedding: Buffer.alloc(8).toString("base64") }]);

    const results = await index.search("关键词索引", [{ id: chunk.id }], 20, {
        enabled: true,
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        apiKey: "test-key",
    }, {
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dimensions: 2,
    });

    assert.equal(results[0].retrievalMode, "keyword");
    assert.equal(results[0].keywordRank, 1);
    assert.equal(results[0].vectorRank, undefined);
});

test("查询 Embedding 维度变化时降级为关键词结果", async (context) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        data: [{ index: 0, embedding: [1, 0, 0] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    const [chunk] = chunkDocument(document);
    const index = new KnowledgeSearchIndex();
    index.rebuild([{ ...chunk, embedding: encodeVector([1, 0]) }], 2);

    const results = await index.search("关键词索引", [{ id: chunk.id }], 20, {
        enabled: true,
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        apiKey: "test-key",
    }, {
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dimensions: 2,
    }, () => [{ id: chunk.id, score: 1 }]);

    assert.equal(results[0].retrievalMode, "keyword");
    assert.equal(results[0].keywordRank, 1);
    assert.equal(results[0].vectorRank, undefined);
});

test("查询 Embedding 成功时使用 RRF 融合关键词与向量排名", async (context) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        data: [{ index: 0, embedding: [1, 0] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    const [chunk] = chunkDocument(document);
    const index = new KnowledgeSearchIndex();
    index.rebuild([{ ...chunk, embedding: encodeVector([1, 0]) }], 2);

    const results = await index.search("关键词索引", [{ id: chunk.id }], 20, {
        enabled: true,
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        apiKey: "test-key",
    }, {
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dimensions: 2,
    });

    assert.equal(results[0].retrievalMode, "hybrid");
    assert.equal(results[0].keywordRank, 1);
    assert.equal(results[0].vectorRank, 1);
    assert.equal(results[0].score, 2 / 61);
});

test("优先使用数据库向量候选并保留现有 RRF", async (context) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        data: [{ index: 0, embedding: [1, 0] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    context.after(() => {
        globalThis.fetch = originalFetch;
    });
    const [keywordChunk] = chunkDocument(document);
    const vectorChunk = { ...keywordChunk, id: "vector-chunk", documentId: "vector-document", embedding: encodeVector([0, 1]) };
    const index = new KnowledgeSearchIndex();
    index.rebuild([{ ...keywordChunk, embedding: encodeVector([1, 0]) }, vectorChunk], 2);

    const results = await index.search("关键词索引", [{ id: keywordChunk.id }], 20, {
        enabled: true,
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        apiKey: "test-key",
    }, {
        baseUrl: "https://api.siliconflow.cn/v1",
        model: "BAAI/bge-m3",
        dimensions: 2,
    }, () => [{ id: vectorChunk.id, score: 1 }]);

    assert.equal(results.find((result) => result.chunkId === keywordChunk.id)?.keywordRank, 1);
    assert.equal(results.find((result) => result.chunkId === vectorChunk.id)?.vectorRank, 1);
    assert.ok(results.every((result) => result.retrievalMode === "hybrid"));
});
