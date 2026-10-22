import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { load as loadSqliteVec } from "sqlite-vec";

import { tokenizeText } from "./tokenizer.js";
import type { KnowledgeData } from "./types.js";

const SCHEMA_VERSION = "3";
const FTS_SCHEMA_VERSION = "2";
const INITIAL_SCHEMA_VERSION = "1";
const VECTOR_INDEX_STATE_KEY = "vector_index_state";
const VECTOR_INDEX_DIRTY = "dirty";
const VECTOR_INDEX_CLEAN = "clean";

type Row = Record<string, unknown>;
type VectorExtensionLoader = (database: DatabaseSync) => void;

export function knowledgeDatabasePath(workspacePath: string) {
    return path.join(path.resolve(workspacePath), ".infinite-canvas", "knowledge.sqlite");
}

/** 持久化完整知识快照，并通过 SQLite 事务保证替换过程原子化。 */
export class KnowledgeDatabase {
    private readonly database: DatabaseSync;
    private readonly workspacePath: string;
    private vectorExtensionLoaded = false;
    private vectorAvailable = false;

    constructor(readonly filePath: string, workspacePath: string, loadVectorExtension: VectorExtensionLoader = loadSqliteVec) {
        this.workspacePath = path.resolve(workspacePath);
        const directory = path.dirname(filePath);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
        this.database = new DatabaseSync(filePath, { allowExtension: true });
        try {
            this.initializeSchema();
            this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
            this.initializeVectorSearch(loadVectorExtension);
            if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
        } catch (error) {
            this.database.close();
            throw error;
        }
    }

    read(): KnowledgeData {
        const sources = (this.database.prepare("SELECT * FROM sources ORDER BY rowid").all() as Row[]).map((row) => ({
            id: String(row.id),
            kind: String(row.kind) as "workspace" | "canvas",
            title: String(row.title),
            reference: restoreReference(this.workspacePath, String(row.kind), String(row.reference)),
            documentCount: Number(row.document_count),
            updatedAt: String(row.updated_at),
        }));
        const documents = (this.database.prepare("SELECT * FROM documents ORDER BY rowid").all() as Row[]).map((row) => ({
            id: String(row.id),
            sourceId: String(row.source_id),
            sourceKind: String(row.source_kind) as "workspace" | "canvas",
            title: String(row.title),
            content: String(row.content),
            reference: restoreReference(this.workspacePath, String(row.source_kind), String(row.reference)),
            updatedAt: String(row.updated_at),
            metadata: parseMetadata(row.metadata_json),
        }));
        const chunks = (this.database.prepare("SELECT * FROM chunks ORDER BY rowid").all() as Row[]).map((row) => ({
            id: String(row.id),
            documentId: String(row.document_id),
            sourceId: String(row.source_id),
            sourceKind: String(row.source_kind) as "workspace" | "canvas",
            title: String(row.title),
            content: String(row.content),
            reference: restoreReference(this.workspacePath, String(row.source_kind), String(row.reference)),
            updatedAt: String(row.updated_at),
            startLine: Number(row.start_line),
            endLine: Number(row.end_line),
            contentHash: String(row.content_hash),
            embedding: readEmbedding(row.embedding),
            metadata: parseMetadata(row.metadata_json),
        }));
        const profile = this.database.prepare("SELECT base_url, model, dimensions FROM embedding_profile WHERE id = 1").get() as Row | undefined;
        const data: KnowledgeData = {
            version: 2,
            sources,
            documents,
            chunks,
            embeddingProfile: profile ? { baseUrl: String(profile.base_url), model: String(profile.model), dimensions: Number(profile.dimensions) } : undefined,
        };
        if (this.vectorExtensionLoaded && this.vectorIndexState() !== VECTOR_INDEX_CLEAN) this.refreshVectorIndex(data);
        return data;
    }

    write(data: KnowledgeData) {
        const insertSource = this.database.prepare("INSERT INTO sources (id, kind, title, reference, document_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
        const insertDocument = this.database.prepare("INSERT INTO documents (id, source_id, source_kind, title, content, reference, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        const insertChunk = this.database.prepare("INSERT INTO chunks (id, document_id, source_id, source_kind, title, content, reference, updated_at, start_line, end_line, content_hash, embedding, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        const insertSearchChunk = this.database.prepare("INSERT INTO chunks_fts (chunk_id, title_terms, content_terms, reference_terms) VALUES (?, ?, ?, ?)");
        const insertProfile = this.database.prepare("INSERT INTO embedding_profile (id, base_url, model, dimensions) VALUES (1, ?, ?, ?)");
        this.database.exec("BEGIN IMMEDIATE");
        try {
            this.database.exec("DELETE FROM chunks_fts; DELETE FROM chunks; DELETE FROM documents; DELETE FROM sources; DELETE FROM embedding_profile;");
            data.sources.forEach((source) => insertSource.run(source.id, source.kind, source.title, storedReference(this.workspacePath, source.kind, source.reference), source.documentCount, source.updatedAt));
            data.documents.forEach((document) => insertDocument.run(document.id, document.sourceId, document.sourceKind, document.title, document.content, storedReference(this.workspacePath, document.sourceKind, document.reference), document.updatedAt, serializeMetadata(document.metadata)));
            data.chunks.forEach((chunk) => {
                const reference = storedReference(this.workspacePath, chunk.sourceKind, chunk.reference);
                insertChunk.run(chunk.id, chunk.documentId, chunk.sourceId, chunk.sourceKind, chunk.title, chunk.content, reference, chunk.updatedAt, chunk.startLine, chunk.endLine, chunk.contentHash, chunk.embedding ? Buffer.from(chunk.embedding, "base64") : null, serializeMetadata(chunk.metadata));
                insertSearchChunk.run(chunk.id, searchTerms(chunk.title), searchTerms(chunk.content), searchTerms(reference));
            });
            if (data.embeddingProfile) insertProfile.run(data.embeddingProfile.baseUrl, data.embeddingProfile.model, data.embeddingProfile.dimensions);
            this.setVectorIndexState(VECTOR_INDEX_DIRTY);
            this.database.exec("COMMIT");
        } catch (error) {
            this.database.exec("ROLLBACK");
            throw error;
        }
        this.refreshVectorIndex(data);
    }

    searchKeywords(query: string, limit: number) {
        const expression = ftsQuery(query);
        if (!expression) return [];
        return (this.database.prepare(`
            SELECT chunk_id AS id, bm25(chunks_fts, 0, 3.0, 1.0, 0.5) AS score
            FROM chunks_fts
            WHERE chunks_fts MATCH ?
            ORDER BY score, rowid
            LIMIT ?
        `).all(expression, limit) as Row[]).map((row) => ({ id: String(row.id), score: Number(row.score) }));
    }

    searchVectors(vector: number[], limit: number) {
        if (!this.vectorAvailable) return undefined;
        try {
            return (this.database.prepare(`
                SELECT chunk_id AS id, distance
                FROM vec_chunks
                WHERE embedding MATCH ? AND k = ?
                ORDER BY distance
            `).all(vectorBuffer(vector), limit) as Row[]).map((row) => ({ id: String(row.id), score: 1 - Number(row.distance) }));
        } catch {
            this.vectorAvailable = false;
            try {
                this.setVectorIndexState(VECTOR_INDEX_DIRTY);
            } catch {
                // 查询失败仍需优先回退内存向量。
            }
            return undefined;
        }
    }

    close() {
        this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        this.database.close();
    }

    private initializeSchema() {
        const metadataTable = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_metadata'").get();
        if (metadataTable) {
            const row = this.database.prepare("SELECT value FROM schema_metadata WHERE key = 'schema_version'").get() as Row | undefined;
            const version = String(row?.value || "");
            if (version === INITIAL_SCHEMA_VERSION) {
                this.migrateVersionOne();
                this.migrateVersionTwo();
            } else if (version === FTS_SCHEMA_VERSION) {
                this.migrateVersionTwo();
            } else if (version !== SCHEMA_VERSION) {
                throw new Error("知识数据库版本不受支持");
            }
            this.database.prepare("INSERT OR IGNORE INTO schema_metadata (key, value) VALUES (?, ?)").run(VECTOR_INDEX_STATE_KEY, VECTOR_INDEX_DIRTY);
            return;
        }
        const existing = this.database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as Row;
        if (Number(existing.count)) throw new Error("知识数据库缺少版本信息");
        this.database.exec(`
            BEGIN IMMEDIATE;
            CREATE TABLE schema_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            INSERT INTO schema_metadata (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
            INSERT INTO schema_metadata (key, value) VALUES ('${VECTOR_INDEX_STATE_KEY}', '${VECTOR_INDEX_DIRTY}');
            CREATE TABLE sources (
                id TEXT PRIMARY KEY NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('workspace', 'canvas')),
                title TEXT NOT NULL,
                reference TEXT NOT NULL,
                document_count INTEGER NOT NULL CHECK (document_count >= 0),
                updated_at TEXT NOT NULL
            );
            CREATE TABLE documents (
                id TEXT PRIMARY KEY NOT NULL,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                source_kind TEXT NOT NULL CHECK (source_kind IN ('workspace', 'canvas')),
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                reference TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                metadata_json TEXT
            );
            CREATE TABLE chunks (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                source_kind TEXT NOT NULL CHECK (source_kind IN ('workspace', 'canvas')),
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                reference TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                start_line INTEGER NOT NULL CHECK (start_line > 0),
                end_line INTEGER NOT NULL CHECK (end_line >= start_line),
                content_hash TEXT NOT NULL,
                embedding BLOB,
                metadata_json TEXT
            );
            CREATE TABLE embedding_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                dimensions INTEGER NOT NULL CHECK (dimensions > 0)
            );
            ${createFtsTableSql()}
            COMMIT;
        `);
    }

    private migrateVersionOne() {
        this.database.exec("BEGIN IMMEDIATE");
        try {
            this.database.exec(createFtsTableSql());
            const insert = this.database.prepare("INSERT INTO chunks_fts (chunk_id, title_terms, content_terms, reference_terms) VALUES (?, ?, ?, ?)");
            const chunks = this.database.prepare("SELECT id, title, content, reference FROM chunks ORDER BY rowid").all() as Row[];
            chunks.forEach((chunk) => insert.run(String(chunk.id), searchTerms(String(chunk.title)), searchTerms(String(chunk.content)), searchTerms(String(chunk.reference))));
            this.database.prepare("UPDATE schema_metadata SET value = ? WHERE key = 'schema_version'").run(FTS_SCHEMA_VERSION);
            this.database.exec("COMMIT");
        } catch (error) {
            this.database.exec("ROLLBACK");
            throw error;
        }
    }

    private migrateVersionTwo() {
        this.database.exec("BEGIN IMMEDIATE");
        try {
            this.database.prepare("UPDATE schema_metadata SET value = ? WHERE key = 'schema_version'").run(SCHEMA_VERSION);
            this.database.prepare("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)").run(VECTOR_INDEX_STATE_KEY, VECTOR_INDEX_DIRTY);
            this.database.exec("COMMIT");
        } catch (error) {
            this.database.exec("ROLLBACK");
            throw error;
        }
    }

    private initializeVectorSearch(loadVectorExtension: VectorExtensionLoader) {
        try {
            loadVectorExtension(this.database);
            this.vectorExtensionLoaded = true;
        } catch {
            return;
        } finally {
            this.database.enableLoadExtension(false);
        }
        const profile = this.database.prepare("SELECT 1 FROM embedding_profile WHERE id = 1").get();
        const vectorTable = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vec_chunks'").get();
        if (this.vectorIndexState() === VECTOR_INDEX_CLEAN && Boolean(profile) === Boolean(vectorTable)) {
            this.vectorAvailable = Boolean(profile);
            return;
        }
        this.setVectorIndexState(VECTOR_INDEX_DIRTY);
    }

    private refreshVectorIndex(data: KnowledgeData) {
        if (!this.vectorExtensionLoaded) {
            this.vectorAvailable = false;
            return;
        }
        try {
            if (!data.embeddingProfile) {
                this.database.exec("BEGIN IMMEDIATE");
                try {
                    this.database.exec("DROP TABLE IF EXISTS vec_chunks");
                    this.setVectorIndexState(VECTOR_INDEX_CLEAN);
                    this.database.exec("COMMIT");
                } catch (error) {
                    this.database.exec("ROLLBACK");
                    throw error;
                }
                this.vectorAvailable = false;
                return;
            }
            const dimensions = data.embeddingProfile.dimensions;
            if (!Number.isSafeInteger(dimensions) || dimensions <= 0) throw new Error("Embedding 向量维度无效");
            const insert = () => this.database.prepare("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)");
            this.database.exec("BEGIN IMMEDIATE");
            try {
                this.database.exec(`DROP TABLE IF EXISTS vec_chunks; CREATE VIRTUAL TABLE vec_chunks USING vec0(
                    chunk_id TEXT PRIMARY KEY,
                    embedding FLOAT[${dimensions}] DISTANCE_METRIC = cosine
                );`);
                const statement = insert();
                data.chunks.forEach((chunk) => {
                    if (!chunk.embedding) return;
                    const embedding = Buffer.from(chunk.embedding, "base64");
                    if (embedding.byteLength === dimensions * Float32Array.BYTES_PER_ELEMENT) statement.run(chunk.id, embedding);
                });
                this.setVectorIndexState(VECTOR_INDEX_CLEAN);
                this.database.exec("COMMIT");
                this.vectorAvailable = true;
            } catch (error) {
                this.database.exec("ROLLBACK");
                throw error;
            }
        } catch {
            this.vectorAvailable = false;
        }
    }

    private vectorIndexState() {
        const row = this.database.prepare("SELECT value FROM schema_metadata WHERE key = ?").get(VECTOR_INDEX_STATE_KEY) as Row | undefined;
        return String(row?.value || VECTOR_INDEX_DIRTY);
    }

    private setVectorIndexState(state: typeof VECTOR_INDEX_DIRTY | typeof VECTOR_INDEX_CLEAN) {
        this.database.prepare("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)").run(VECTOR_INDEX_STATE_KEY, state);
    }
}

function createFtsTableSql() {
    return `
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
            chunk_id UNINDEXED,
            title_terms,
            content_terms,
            reference_terms,
            tokenize = 'unicode61'
        );
    `;
}

function searchTerms(value: string) {
    return tokenizeText(value).join(" ");
}

function ftsQuery(value: string) {
    return tokenizeText(value).map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
}

function serializeMetadata(metadata?: Record<string, string>) {
    return metadata ? JSON.stringify(metadata) : null;
}

function parseMetadata(value: unknown) {
    return value === null ? undefined : JSON.parse(String(value)) as Record<string, string>;
}

function readEmbedding(value: unknown) {
    if (value === null) return undefined;
    if (!(value instanceof Uint8Array)) throw new Error("Embedding 向量内容无效");
    return Buffer.from(value).toString("base64");
}

function vectorBuffer(vector: number[]) {
    const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
    vector.forEach((value, index) => buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT));
    return buffer;
}

function storedReference(workspacePath: string, kind: string, reference: string) {
    if (kind !== "workspace") return reference;
    const relative = path.relative(workspacePath, reference);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("知识文档路径不在当前工作空间内");
    return relative.split(path.sep).join("/");
}

function restoreReference(workspacePath: string, kind: string, reference: string) {
    if (kind !== "workspace") return reference;
    if (path.isAbsolute(reference)) throw new Error("知识数据库包含不可移植的绝对路径");
    const resolved = path.resolve(workspacePath, ...reference.split("/"));
    const relative = path.relative(workspacePath, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("知识文档路径不在当前工作空间内");
    return resolved;
}
