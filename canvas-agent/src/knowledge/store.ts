import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import MiniSearch from "minisearch";
import { z } from "zod";

import { CONFIG_DIR } from "../config.js";

export type KnowledgeSourceKind = "workspace" | "canvas";
export type KnowledgeSource = {
    id: string;
    kind: KnowledgeSourceKind;
    title: string;
    reference: string;
    documentCount: number;
    updatedAt: string;
};
export type KnowledgeDocument = {
    id: string;
    sourceId: string;
    sourceKind: KnowledgeSourceKind;
    title: string;
    content: string;
    reference: string;
    updatedAt: string;
    metadata?: Record<string, string>;
};
export type KnowledgeSearchResult = Pick<KnowledgeDocument, "id" | "sourceId" | "sourceKind" | "title" | "reference" | "updatedAt" | "metadata"> & {
    excerpt: string;
    score: number;
};

type KnowledgeData = { version: 1; sources: KnowledgeSource[]; documents: KnowledgeDocument[] };
const sourceKindSchema = z.enum(["workspace", "canvas"]);
const knowledgeDataSchema = z.object({
    version: z.literal(1),
    sources: z.array(z.object({ id: z.string(), kind: sourceKindSchema, title: z.string(), reference: z.string(), documentCount: z.number(), updatedAt: z.string() })),
    documents: z.array(z.object({ id: z.string(), sourceId: z.string(), sourceKind: sourceKindSchema, title: z.string(), content: z.string(), reference: z.string(), updatedAt: z.string(), metadata: z.record(z.string()).optional() })),
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

const KNOWLEDGE_FILE = path.join(CONFIG_DIR, "knowledge.json");
const ignoredDirectories = new Set([".git", ".next", "build", "coverage", "dist", "node_modules"]);
const indexedExtensions = new Set([".css", ".html", ".js", ".jsx", ".less", ".md", ".mdx", ".ts", ".tsx", ".txt"]);
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** 管理 Canvas Agent 的本地知识文档，并在内存中维护全文索引。 */
export class KnowledgeStore {
    private data: KnowledgeData = { version: 1, sources: [], documents: [] };
    private documents = new Map<string, KnowledgeDocument>();
    private index = createIndex();
    private initializationError: Error | null = null;
    private mutation = Promise.resolve();

    async initialize() {
        try {
            const raw = await fs.readFile(KNOWLEDGE_FILE, "utf8");
            const parsed = knowledgeDataSchema.parse(JSON.parse(raw));
            this.data = parsed;
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
        const text = query.trim();
        if (!text) return [];
        const results = this.index.search(text, { combineWith: "AND", prefix: true });
        return (limit ? results.slice(0, limit) : results).flatMap<KnowledgeSearchResult>((result) => {
            const document = this.documents.get(String(result.id));
            if (!document) return [];
            const { content, ...summary } = document;
            return [{ ...summary, excerpt: matchingLine(content, text), score: result.score }];
        });
    }

    async scanWorkspace(workspacePath: string) {
        this.assertHealthy();
        const root = path.resolve(workspacePath);
        const files = await collectWorkspaceFiles(root);
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
        }));
    }

    private async replaceSources(kind: KnowledgeSourceKind, sources: KnowledgeSource[], documents: KnowledgeDocument[]) {
        await this.mutate((data) => ({
            ...data,
            sources: [...data.sources.filter((source) => source.kind !== kind), ...sources],
            documents: [...data.documents.filter((document) => document.sourceKind !== kind), ...documents],
        }));
    }

    private mutate(update: (data: KnowledgeData) => KnowledgeData) {
        const task = this.mutation.then(async () => {
            const data = update(this.data);
            await this.persist(data);
            this.data = data;
            this.rebuild();
        });
        this.mutation = task.catch(() => undefined);
        return task;
    }

    private rebuild() {
        this.documents = new Map(this.data.documents.map((document) => [document.id, document]));
        this.index = createIndex();
        this.index.addAll(this.data.documents);
    }

    private async persist(data: KnowledgeData) {
        await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
        const temporaryFile = `${KNOWLEDGE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(temporaryFile, JSON.stringify(data), { mode: 0o600 });
        await fs.chmod(temporaryFile, 0o600);
        await fs.rename(temporaryFile, KNOWLEDGE_FILE);
    }

    private assertHealthy() {
        if (this.initializationError) throw new Error(`无法读取本地知识索引：${this.initializationError.message}`);
    }
}

function createIndex() {
    return new MiniSearch<KnowledgeDocument>({
        fields: ["title", "content", "reference"],
        tokenize: tokenizeText,
    });
}

function tokenizeText(text: string) {
    return [...segmenter.segment(text)].filter((item) => item.isWordLike).map((item) => item.segment.toLocaleLowerCase());
}

async function collectWorkspaceFiles(root: string) {
    const files: string[] = [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    await Promise.all(
        entries.map(async (entry) => {
            if (entry.isSymbolicLink()) return;
            const filePath = path.join(root, entry.name);
            if (entry.isDirectory()) {
                if (!ignoredDirectories.has(entry.name)) files.push(...(await collectWorkspaceFiles(filePath)));
                return;
            }
            if (entry.isFile() && indexedExtensions.has(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith(".min.js")) files.push(filePath);
        }),
    );
    return files;
}

function matchingLine(content: string, query: string) {
    const terms = tokenizeText(query);
    return content.split(/\r?\n/).find((line) => terms.some((term) => line.toLocaleLowerCase().includes(term)))?.trim() || "";
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
