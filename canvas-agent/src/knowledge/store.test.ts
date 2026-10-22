import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { KnowledgeEmbeddingConfig } from "../config.js";
import { KnowledgeStore } from "./store.js";
import type { KnowledgeData } from "./types.js";

function project(documents: Array<{ id: string; content: string }>) {
    return [{
        id: "project",
        title: "测试画布",
        updatedAt: "2026-01-01T00:00:00.000Z",
        documents: documents.map((document) => ({
            ...document,
            title: `${document.id}.md`,
            reference: `/canvas/project/${document.id}`,
        })),
    }];
}

test("只扫描工作空间的 knowledge 目录并在缺失时创建", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-workspace-"));
    const knowledgeFile = path.join(workspace, ".index", "knowledge-v2.json");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    await fs.writeFile(path.join(workspace, "outside.md"), "不应进入知识库");
    const store = new KnowledgeStore(() => undefined, knowledgeFile);

    const emptySource = await store.scanWorkspace(workspace);
    assert.equal(emptySource.reference, path.join(workspace, "knowledge"));
    assert.equal(emptySource.documentCount, 0);
    assert.ok((await fs.stat(emptySource.reference)).isDirectory());

    await fs.mkdir(path.join(workspace, "knowledge", "guides"));
    await fs.writeFile(path.join(workspace, "knowledge", "guides", "intro.md"), "知识目录正文");
    const source = await store.scanWorkspace(workspace);
    assert.equal(source.title, "knowledge");
    assert.equal(source.documentCount, 1);

    const persisted = JSON.parse(await fs.readFile(knowledgeFile, "utf8")) as KnowledgeData;
    assert.deepEqual(persisted.documents.map((document) => document.title), [path.join("guides", "intro.md")]);
    assert.equal(persisted.documents[0].content, "知识目录正文");
});

test("向量持久化后同模型增量复用，切换模型时全量重建", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const knowledgeFile = path.join(directory, "knowledge-v2.json");
    const originalFetch = globalThis.fetch;
    const requests: Array<{ model: string; input: string[] }> = [];
    let config: KnowledgeEmbeddingConfig = {
        enabled: true,
        baseUrl: "https://embedding.example/v1",
        model: "model-a",
        apiKey: "test-key",
    };
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string; input: string[] };
        requests.push(body);
        return new Response(JSON.stringify({
            data: body.input.map((_text, index) => ({ index, embedding: [1, index + 1] })),
        }), { status: 200, headers: { "content-type": "application/json" } });
    };
    context.after(async () => {
        globalThis.fetch = originalFetch;
        await fs.rm(directory, { recursive: true, force: true });
    });
    const store = new KnowledgeStore(() => config, knowledgeFile);

    await store.syncCanvases(project([{ id: "one", content: "第一份文档" }]));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input.length, 1);

    await store.syncCanvases(project([{ id: "one", content: "第一份文档" }]));
    assert.equal(requests.length, 1);

    await store.syncCanvases(project([
        { id: "one", content: "第一份文档" },
        { id: "two", content: "第二份文档" },
    ]));
    assert.equal(requests.length, 2);
    assert.equal(requests[1].input.length, 1);

    config = { ...config, model: "model-b" };
    await store.syncCanvases(project([
        { id: "one", content: "第一份文档" },
        { id: "two", content: "第二份文档" },
    ]));
    assert.equal(requests.length, 3);
    assert.equal(requests[2].input.length, 2);

    const persisted = JSON.parse(await fs.readFile(knowledgeFile, "utf8")) as KnowledgeData;
    assert.equal(persisted.embeddingProfile?.model, "model-b");
    assert.ok(persisted.chunks.every((chunk) => chunk.embedding));

    const restored = new KnowledgeStore(() => config, knowledgeFile);
    await restored.initialize();
    assert.equal(restored.listSources()[0].documentCount, 2);
});

test("Embedding 同步失败时保留旧索引文件", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const knowledgeFile = path.join(directory, "knowledge-v2.json");
    const originalFetch = globalThis.fetch;
    const config: KnowledgeEmbeddingConfig = {
        enabled: true,
        baseUrl: "https://embedding.example/v1",
        model: "model-a",
        apiKey: "test-key",
    };
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return new Response(JSON.stringify({
            data: body.input.map((_text, index) => ({ index, embedding: [1, 1] })),
        }), { status: 200, headers: { "content-type": "application/json" } });
    };
    context.after(async () => {
        globalThis.fetch = originalFetch;
        await fs.rm(directory, { recursive: true, force: true });
    });
    const store = new KnowledgeStore(() => config, knowledgeFile);
    await store.syncCanvases(project([{ id: "one", content: "原始内容" }]));
    const previous = await fs.readFile(knowledgeFile, "utf8");

    globalThis.fetch = async () => {
        throw new Error("network unavailable");
    };
    await assert.rejects(store.syncCanvases(project([{ id: "one", content: "更新内容" }])), /network unavailable/);
    assert.equal(await fs.readFile(knowledgeFile, "utf8"), previous);
});
