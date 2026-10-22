import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { load as loadSqliteVec } from "sqlite-vec";

import type { KnowledgeEmbeddingConfig } from "../config.js";
import { KnowledgeDatabase } from "./database.js";
import { encodeVector } from "./embedding-provider.js";
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
    const databaseFile = path.join(workspace, ".index", "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    await fs.writeFile(path.join(workspace, "outside.md"), "不应进入知识库");
    const store = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await store.initialize();

    const emptySource = await store.scanWorkspace();
    assert.equal(emptySource.reference, path.join(workspace, "knowledge"));
    assert.equal(emptySource.documentCount, 0);
    assert.ok((await fs.stat(emptySource.reference)).isDirectory());

    await fs.mkdir(path.join(workspace, "knowledge", "guides"));
    await fs.writeFile(path.join(workspace, "knowledge", "guides", "intro.md"), "知识目录正文");
    const source = await store.scanWorkspace();
    assert.equal(source.title, "knowledge");
    assert.equal(source.documentCount, 1);

    store.close();
    if (process.platform !== "win32") {
        assert.equal((await fs.stat(path.dirname(databaseFile))).mode & 0o777, 0o700);
        assert.equal((await fs.stat(databaseFile)).mode & 0o777, 0o600);
    }
    const rawDatabase = new DatabaseSync(databaseFile);
    assert.equal((rawDatabase.prepare("SELECT reference FROM sources").get() as { reference: string }).reference, "knowledge");
    assert.equal((rawDatabase.prepare("SELECT reference FROM documents").get() as { reference: string }).reference, "knowledge/guides/intro.md");
    rawDatabase.close();
    const database = new KnowledgeDatabase(databaseFile, workspace);
    const persisted = database.read();
    database.close();
    assert.deepEqual(persisted.documents.map((document) => document.title), [path.join("guides", "intro.md")]);
    assert.equal(persisted.documents[0].content, "知识目录正文");
});

test("FTS5 支持中英文前缀、AND 查询并安全处理特殊字符", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await store.initialize();
    await store.syncCanvases(project([
        { id: "one", content: "关键词 索引 retrieval architecture" },
        { id: "two", content: "关键词 vector retrieval" },
    ]));

    assert.deepEqual((await store.search("关键词 索引")).map((result) => result.id), ["canvas:project:" + createHash("one")]);
    assert.deepEqual((await store.search("retr arch")).map((result) => result.id), ["canvas:project:" + createHash("one")]);
    assert.deepEqual((await store.search("retr:\"(arch)*\"")).map((result) => result.id), ["canvas:project:" + createHash("one")]);
    assert.deepEqual(await store.search("\"()*:-"), []);
    store.close();

    const restored = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await restored.initialize();
    assert.equal((await restored.search("关键词 索引"))[0].retrievalMode, "keyword");
    const database = new DatabaseSync(databaseFile);
    assert.equal((database.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get() as { value: string }).value, "3");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM chunks_fts").get() as { count: number }).count, 2);
    database.close();
    restored.close();
});

test("schema v1 数据库启动时依次迁移至 v3 并回填 FTS5", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await store.initialize();
    await store.syncCanvases(project([{ id: "legacy", content: "旧版 数据库 检索" }]));
    store.close();

    const oldDatabase = new DatabaseSync(databaseFile);
    oldDatabase.exec("DROP TABLE chunks_fts; UPDATE schema_metadata SET value = '1' WHERE key = 'schema_version';");
    oldDatabase.close();

    const migrated = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await migrated.initialize();
    assert.equal((await migrated.search("旧版 数据"))[0].id, "canvas:project:" + createHash("legacy"));
    const database = new DatabaseSync(databaseFile);
    assert.equal((database.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get() as { value: string }).value, "3");
    database.close();
    migrated.close();
});

test("schema v2 数据库启动时迁移至 v3", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const original = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await original.initialize();
    await original.syncCanvases(project([{ id: "legacy", content: "第二版 数据库" }]));
    original.close();
    const oldDatabase = new DatabaseSync(databaseFile);
    oldDatabase.exec("UPDATE schema_metadata SET value = '2' WHERE key = 'schema_version';");
    oldDatabase.close();

    const migrated = new KnowledgeStore(workspace, () => undefined, databaseFile);
    await migrated.initialize();
    assert.equal((await migrated.search("第二版"))[0].id, "canvas:project:" + createHash("legacy"));
    const database = new DatabaseSync(databaseFile);
    assert.equal((database.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get() as { value: string }).value, "3");
    database.close();
    migrated.close();
});

test("sqlite-vec 返回向量 Top 30 并在维度变化时重建", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const database = new KnowledgeDatabase(databaseFile, workspace);
    const vectors = Array.from({ length: 31 }, (_, index) => [Math.cos(index / 100), Math.sin(index / 100)]);
    database.write(vectorData(vectors));

    const candidates = database.searchVectors([1, 0], 30);
    assert.equal(candidates?.length, 30);
    assert.equal(candidates?.[0].id, "chunk-0");
    assert.ok(!candidates?.some((candidate) => candidate.id === "chunk-30"));

    database.write(vectorData([[0, 1, 0], [1, 0, 0]]));
    assert.equal(database.searchVectors([1, 0, 0], 30)?.[0].id, "chunk-1");
    database.close();
});

test("启动时恢复 dirty 向量索引并复用 clean 索引", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const database = new KnowledgeDatabase(databaseFile, workspace);
    database.write(vectorData([[1, 0]]));
    database.close();

    const dirtyDatabase = openVectorDatabase(databaseFile);
    dirtyDatabase.exec("DELETE FROM vec_chunks; UPDATE schema_metadata SET value = 'dirty' WHERE key = 'vector_index_state';");
    dirtyDatabase.close();

    const restored = new KnowledgeDatabase(databaseFile, workspace);
    restored.read();
    assert.equal(restored.searchVectors([1, 0], 30)?.[0].id, "chunk-0");
    restored.close();

    const cleanDatabase = openVectorDatabase(databaseFile);
    assert.equal((cleanDatabase.prepare("SELECT value FROM schema_metadata WHERE key = 'vector_index_state'").get() as { value: string }).value, "clean");
    cleanDatabase.prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)").run("sentinel", Buffer.from(encodeVector([0, 1]), "base64"));
    cleanDatabase.close();

    const reopened = new KnowledgeDatabase(databaseFile, workspace);
    reopened.read();
    reopened.close();
    const verification = openVectorDatabase(databaseFile);
    assert.equal((verification.prepare("SELECT COUNT(*) AS count FROM vec_chunks WHERE chunk_id = 'sentinel'").get() as { count: number }).count, 1);
    verification.close();
});

test("sqlite-vec 加载失败时保留 BLOB 与 FTS5 并禁用 SQL 向量查询", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const database = new KnowledgeDatabase(databaseFile, workspace, () => {
        throw new Error("native extension unavailable");
    });
    const data = vectorData([[1, 0]]);
    database.write(data);

    assert.equal(database.searchVectors([1, 0], 30), undefined);
    assert.equal(database.searchKeywords("向量内容", 30)[0].id, "chunk-0");
    assert.deepEqual(database.read(), data);
    database.close();
});

test("向量持久化后同模型增量复用，切换模型时全量重建", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(directory, "knowledge.sqlite");
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
    const store = new KnowledgeStore(directory, () => config, databaseFile);
    await store.initialize();

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

    store.close();
    const database = new KnowledgeDatabase(databaseFile, directory);
    const persisted = database.read();
    database.close();
    assert.equal(persisted.embeddingProfile?.model, "model-b");
    assert.ok(persisted.chunks.every((chunk) => chunk.embedding));

    const restored = new KnowledgeStore(directory, () => config, databaseFile);
    await restored.initialize();
    assert.equal(restored.listSources()[0].documentCount, 2);
    restored.close();
});

function createHash(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

test("Embedding 同步失败时保留旧数据库内容", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(directory, "knowledge.sqlite");
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
    const store = new KnowledgeStore(directory, () => config, databaseFile);
    await store.initialize();
    await store.syncCanvases(project([{ id: "one", content: "原始内容" }]));
    const reader = new KnowledgeDatabase(databaseFile, directory);
    const previous = reader.read();
    reader.close();

    globalThis.fetch = async () => {
        throw new Error("network unavailable");
    };
    await assert.rejects(store.syncCanvases(project([{ id: "one", content: "更新内容" }])), /network unavailable/);
    store.close();
    const restored = new KnowledgeDatabase(databaseFile, directory);
    assert.deepEqual(restored.read(), previous);
    restored.close();
});

test("不迁移旧 JSON 索引", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const oldFile = path.join(workspace, "knowledge-v2.json");
    const oldContent = JSON.stringify({ version: 2, sources: [{ id: "legacy" }] });
    await fs.writeFile(oldFile, oldContent);
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new KnowledgeStore(workspace, () => undefined, path.join(workspace, "knowledge.sqlite"));

    await store.initialize();
    assert.deepEqual(store.listSources(), []);
    assert.equal(await fs.readFile(oldFile, "utf8"), oldContent);
    store.close();
});

test("未知数据库结构拒绝读取和覆盖", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    const database = new DatabaseSync(databaseFile);
    database.exec("CREATE TABLE unknown_data (value TEXT); INSERT INTO unknown_data VALUES ('keep');");
    database.close();
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const store = new KnowledgeStore(workspace, () => undefined, databaseFile);

    await store.initialize();
    assert.throws(() => store.listSources(), /知识数据库缺少版本信息/);
    const verify = new DatabaseSync(databaseFile);
    assert.equal((verify.prepare("SELECT value FROM unknown_data").get() as { value: string }).value, "keep");
    verify.close();
});

test("SQLite 写入失败时回滚完整快照", async (context) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-knowledge-"));
    const databaseFile = path.join(workspace, "knowledge.sqlite");
    context.after(() => fs.rm(workspace, { recursive: true, force: true }));
    const database = new KnowledgeDatabase(databaseFile, workspace);
    const source = { id: "canvas:one", kind: "canvas" as const, title: "画布", reference: "/canvas/one", documentCount: 0, updatedAt: "2026-01-01T00:00:00.000Z" };
    const initial: KnowledgeData = { version: 2, sources: [source], documents: [], chunks: [], embeddingProfile: undefined };
    database.write(initial);

    assert.throws(() => database.write({ ...initial, sources: [source, source] }), /UNIQUE/);
    assert.deepEqual(database.read(), initial);
    database.close();
});

function vectorData(vectors: number[][]): KnowledgeData {
    const source = { id: "canvas:one", kind: "canvas" as const, title: "画布", reference: "/canvas/one", documentCount: 1, updatedAt: "2026-01-01T00:00:00.000Z" };
    const document = { id: "document", sourceId: source.id, sourceKind: source.kind, title: "vectors.md", content: "向量内容", reference: "/canvas/one/vectors", updatedAt: source.updatedAt };
    return {
        version: 2,
        sources: [source],
        documents: [document],
        chunks: vectors.map((vector, index) => ({
            id: `chunk-${index}`,
            documentId: document.id,
            sourceId: source.id,
            sourceKind: source.kind,
            title: document.title,
            content: `向量内容 ${index}`,
            reference: document.reference,
            updatedAt: document.updatedAt,
            startLine: index + 1,
            endLine: index + 1,
            contentHash: `hash-${index}`,
            embedding: encodeVector(vector),
        })),
        embeddingProfile: { baseUrl: "https://embedding.example/v1", model: "model", dimensions: vectors[0].length },
    };
}

function openVectorDatabase(filePath: string) {
    const database = new DatabaseSync(filePath, { allowExtension: true });
    loadSqliteVec(database);
    database.enableLoadExtension(false);
    return database;
}
