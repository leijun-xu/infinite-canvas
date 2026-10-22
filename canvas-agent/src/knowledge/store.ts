import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { CONFIG_DIR, type KnowledgeEmbeddingConfig } from "../config.js";
import { chunkDocument } from "./chunker.js";
import { activeEmbeddingConfig, embedTexts, encodeVector, SYNC_EMBEDDING_TIMEOUT_MS } from "./embedding-provider.js";
import { KnowledgeSearchIndex } from "./hybrid-search.js";
import type { EmbeddingProfile, KnowledgeData, KnowledgeDocument, KnowledgeSource, KnowledgeSourceKind } from "./types.js";

export type { KnowledgeDocument, KnowledgeSearchResult, KnowledgeSource, KnowledgeSourceKind } from "./types.js";

const sourceKindSchema = z.enum(["workspace", "canvas"]);
const sourceSchema = z.object({
    id: z.string(),
    kind: sourceKindSchema,
    title: z.string(),
    reference: z.string(),
    documentCount: z.number(),
    updatedAt: z.string(),
});
const documentSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    sourceKind: sourceKindSchema,
    title: z.string(),
    content: z.string(),
    reference: z.string(),
    updatedAt: z.string(),
    metadata: z.record(z.string()).optional(),
});
const chunkSchema = z.object({
    id: z.string(),
    documentId: z.string(),
    sourceId: z.string(),
    sourceKind: sourceKindSchema,
    title: z.string(),
    content: z.string(),
    reference: z.string(),
    updatedAt: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    contentHash: z.string(),
    embedding: z.string().optional(),
    metadata: z.record(z.string()).optional(),
});
const knowledgeDataSchema = z.object({
    version: z.literal(2),
    sources: z.array(sourceSchema),
    documents: z.array(documentSchema),
    chunks: z.array(chunkSchema),
    embeddingProfile: z.object({ baseUrl: z.string(), model: z.string(), dimensions: z.number().int().positive() }).optional(),
});
export const canvasKnowledgeInputSchema = z.array(
    z.object({
        id: z.string().min(1),
        title: z.string(),
        updatedAt: z.string(),
        documents: z.array(z.object({ id: z.string().min(1), title: z.string(), content: z.string(), reference: z.string(), metadata: z.record(z.string()).optional() })),
    }),
);
type CanvasKnowledgeInput = z.infer<typeof canvasKnowledgeInputSchema>[number];

const KNOWLEDGE_FILE = path.join(CONFIG_DIR, "knowledge-v2.json");
const ignoredDirectories = new Set([".agents", ".git", ".infinite-canvas", ".next", "build", "coverage", "dist", "node_modules"]);
const indexedExtensions = new Set([".css", ".html", ".js", ".jsx", ".less", ".md", ".mdx", ".ts", ".tsx", ".txt"]);

/** 管理 Canvas Agent 的本地知识文档、Chunk 与混合检索索引。 */
export class KnowledgeStore {
    private data: KnowledgeData = { version: 2, sources: [], documents: [], chunks: [] };
    private documents = new Map<string, KnowledgeDocument>();
    private index = new KnowledgeSearchIndex();
    private initializationError: Error | null = null;
    private mutation = Promise.resolve();

    constructor(
        private readonly embeddingConfig: () => KnowledgeEmbeddingConfig | undefined = () => undefined,
        private readonly knowledgeFile = KNOWLEDGE_FILE,
    ) {}

    async initialize() {
        try {
            const raw = await fs.readFile(this.knowledgeFile, "utf8");
            this.data = knowledgeDataSchema.parse(JSON.parse(raw));
            this.rebuild();
        } catch (error) {
            if (isMissingFile(error)) return;
            this.initializationError = error instanceof Error ? error : new Error(String(error));
        }
    }

    listSources() {
        this.assertHealthy();
        return this.data.sources;
    }

    getDocument(id: string) {
        this.assertHealthy();
        const document = this.documents.get(id);
        if (!document) throw new Error("知识文档不存在");
        return document;
    }

    search(query: string, limit?: number) {
        this.assertHealthy();
        return this.index.search(query, limit, this.embeddingConfig(), this.data.embeddingProfile);
    }

    async scanWorkspace(workspacePath: string) {
        this.assertHealthy();
        const root = path.join(path.resolve(workspacePath), "knowledge");
        await fs.mkdir(root, { recursive: true });
        const files = await collectKnowledgeFiles(root);
        const sourceId = `workspace:${digest(root)}`;
        const documents = await Promise.all(
            files.map(async (filePath) => {
                const relativePath = path.relative(root, filePath);
                const [content, file] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
                return {
                    id: documentId(sourceId, relativePath),
                    sourceId,
                    sourceKind: "workspace" as const,
                    title: relativePath,
                    content,
                    reference: filePath,
                    updatedAt: file.mtime.toISOString(),
                    metadata: { relativePath },
                };
            }),
        );
        const source = { id: sourceId, kind: "workspace" as const, title: path.basename(root) || root, reference: root, documentCount: documents.length, updatedAt: new Date().toISOString() };
        await this.replaceSources("workspace", [source], documents);
        return source;
    }

    async syncCanvases(projects: CanvasKnowledgeInput[]) {
        this.assertHealthy();
        const sources = projects.map((project) => ({
            id: `canvas:${project.id}`,
            kind: "canvas" as const,
            title: project.title,
            reference: `/canvas/${project.id}`,
            documentCount: project.documents.length,
            updatedAt: project.updatedAt,
        }));
        const documents = projects.flatMap((project) => {
            const sourceId = `canvas:${project.id}`;
            return project.documents.map((document) => ({
                ...document,
                id: documentId(sourceId, document.id),
                sourceId,
                sourceKind: "canvas" as const,
                updatedAt: project.updatedAt,
            }));
        });
        await this.replaceSources("canvas", sources, documents);
        return { sources: sources.length, documents: documents.length };
    }

    async removeSource(id: string) {
        this.assertHealthy();
        await this.mutate((data) => ({
            ...data,
            sources: data.sources.filter((source) => source.id !== id),
            documents: data.documents.filter((document) => document.sourceId !== id),
        }), false);
    }

    private async replaceSources(kind: KnowledgeSourceKind, sources: KnowledgeSource[], documents: KnowledgeDocument[]) {
        await this.mutate((data) => ({
            ...data,
            sources: [...data.sources.filter((source) => source.kind !== kind), ...sources],
            documents: [...data.documents.filter((document) => document.sourceKind !== kind), ...documents],
        }), true);
    }

    private mutate(update: (data: KnowledgeData) => KnowledgeData, createEmbeddings: boolean) {
        const task = this.mutation.then(async () => {
            const next = update(this.data);
            const data = await this.buildData(next, createEmbeddings);
            await this.persist(data);
            this.data = data;
            this.rebuild();
        });
        this.mutation = task.catch(() => undefined);
        return task;
    }

    private async buildData(data: KnowledgeData, createEmbeddings: boolean): Promise<KnowledgeData> {
        const previousChunks = new Map(this.data.chunks.map((chunk) => [chunk.id, chunk]));
        const chunks = data.documents.flatMap(chunkDocument).map((chunk) => {
            const previous = previousChunks.get(chunk.id);
            return previous?.contentHash === chunk.contentHash && previous.embedding ? { ...chunk, embedding: previous.embedding } : chunk;
        });
        const config = this.embeddingConfig();
        const active = activeEmbeddingConfig(config);
        if (!createEmbeddings || !config || !active || !chunks.length) return { ...data, chunks, embeddingProfile: this.data.embeddingProfile };
        const profileMatches = this.data.embeddingProfile?.baseUrl === active.baseUrl && this.data.embeddingProfile.model === active.model;
        const pending = profileMatches ? chunks.filter((chunk) => !chunk.embedding) : chunks;
        const vectors = pending.length ? await embedTexts(config, pending.map((chunk) => chunk.content), SYNC_EMBEDDING_TIMEOUT_MS) : [];
        const embeddings = new Map(pending.map((chunk, index) => [chunk.id, encodeVector(vectors[index])]));
        const dimensions = vectors[0]?.length || this.data.embeddingProfile?.dimensions;
        if (!dimensions) throw new Error("无法确定 Embedding 向量维度");
        const embeddingProfile: EmbeddingProfile = { baseUrl: active.baseUrl, model: active.model, dimensions };
        return {
            ...data,
            chunks: chunks.map((chunk) => ({ ...chunk, embedding: embeddings.get(chunk.id) || (profileMatches ? chunk.embedding : undefined) })),
            embeddingProfile,
        };
    }

    private rebuild() {
        this.documents = new Map(this.data.documents.map((document) => [document.id, document]));
        this.index.rebuild(this.data.chunks, this.data.embeddingProfile?.dimensions);
    }

    private async persist(data: KnowledgeData) {
        const directory = path.dirname(this.knowledgeFile);
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const temporaryFile = `${this.knowledgeFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(temporaryFile, JSON.stringify(data), { mode: 0o600 });
        await fs.chmod(temporaryFile, 0o600);
        await fs.rename(temporaryFile, this.knowledgeFile);
    }

    private assertHealthy() {
        if (this.initializationError) throw new Error(`无法读取本地知识索引：${this.initializationError.message}`);
    }
}

async function collectKnowledgeFiles(root: string) {
    const files: string[] = [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    await Promise.all(
        entries.map(async (entry) => {
            if (entry.isSymbolicLink()) return;
            const filePath = path.join(root, entry.name);
            if (entry.isDirectory()) {
                if (!ignoredDirectories.has(entry.name)) files.push(...(await collectKnowledgeFiles(filePath)));
                return;
            }
            if (entry.isFile() && indexedExtensions.has(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith(".min.js")) files.push(filePath);
        }),
    );
    return files;
}

function documentId(sourceId: string, reference: string) {
    return `${sourceId}:${digest(reference)}`;
}

function digest(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
