import type { KnowledgeEmbeddingConfig } from "../config.js";
import { activeEmbeddingConfig, decodeVector, embedTexts, QUERY_EMBEDDING_TIMEOUT_MS } from "./embedding-provider.js";
import { tokenizeText } from "./tokenizer.js";
import type { EmbeddingProfile, KnowledgeChunk, KnowledgeSearchResult } from "./types.js";

export const KEYWORD_CANDIDATE_LIMIT = 30;
export const VECTOR_CANDIDATE_LIMIT = 30;
export const RRF_CONSTANT = 60;
export const DEFAULT_SEARCH_LIMIT = 20;

type VectorCandidate = { id: string; score: number };
type VectorSearch = (vector: number[]) => VectorCandidate[] | undefined;

/** 在内存中维护 Chunk 与向量，合并数据库关键词候选和向量候选。 */
export class KnowledgeSearchIndex {
    private chunks = new Map<string, KnowledgeChunk>();
    private vectors = new Map<string, number[]>();

    rebuild(chunks: KnowledgeChunk[], dimensions?: number) {
        this.chunks = new Map(chunks.map((chunk) => [chunk.id, chunk]));
        this.vectors = new Map(chunks.flatMap((chunk) => {
            if (!chunk.embedding) return [];
            const vector = decodeVector(chunk.embedding);
            return !dimensions || vector.length === dimensions ? [[chunk.id, vector] as const] : [];
        }));
    }

    async search(query: string, keyword: Array<{ id: string }>, limit: number | undefined, config: KnowledgeEmbeddingConfig | undefined, profile?: EmbeddingProfile, searchVectors?: VectorSearch) {
        const text = query.trim();
        if (!text) return [];
        let vector: VectorCandidate[] = [];
        const active = activeEmbeddingConfig(config);
        if (config && active && profile && active.baseUrl === profile.baseUrl && active.model === profile.model && this.vectors.size) {
            try {
                const [queryVector] = await embedTexts(config, [text], QUERY_EMBEDDING_TIMEOUT_MS);
                if (queryVector.length !== profile.dimensions) throw new Error("查询向量维度与知识库不一致");
                vector = searchVectors?.(queryVector) ?? [...this.vectors]
                    .flatMap(([id, embedding]) => {
                        const score = dotProduct(queryVector, embedding);
                        return Number.isFinite(score) ? [{ id, score }] : [];
                    })
                    .sort((left, right) => right.score - left.score)
                    .slice(0, VECTOR_CANDIDATE_LIMIT);
                vector = vector.filter((item) => Number.isFinite(item.score));
            } catch {
                vector = [];
            }
        }
        const ranks = new Map<string, { keywordRank?: number; vectorRank?: number; score: number }>();
        keyword.forEach((item, index) => addRank(ranks, String(item.id), "keywordRank", index + 1));
        vector.forEach((item, index) => addRank(ranks, item.id, "vectorRank", index + 1));
        const retrievalMode = vector.length ? "hybrid" as const : "keyword" as const;
        return [...ranks].sort((left, right) => right[1].score - left[1].score)
            .slice(0, limit || DEFAULT_SEARCH_LIMIT)
            .flatMap<KnowledgeSearchResult>(([chunkId, rank]) => {
                const chunk = this.chunks.get(chunkId);
                if (!chunk) return [];
                return [{
                    id: chunk.documentId,
                    chunkId,
                    sourceId: chunk.sourceId,
                    sourceKind: chunk.sourceKind,
                    title: chunk.title,
                    reference: chunk.reference,
                    updatedAt: chunk.updatedAt,
                    metadata: chunk.metadata,
                    excerpt: matchingExcerpt(chunk.content, text),
                    startLine: chunk.startLine,
                    endLine: chunk.endLine,
                    score: rank.score,
                    retrievalMode,
                    keywordRank: rank.keywordRank,
                    vectorRank: rank.vectorRank,
                }];
            });
    }
}

function addRank(ranks: Map<string, { keywordRank?: number; vectorRank?: number; score: number }>, id: string, key: "keywordRank" | "vectorRank", rank: number) {
    const current = ranks.get(id) || { score: 0 };
    current[key] = rank;
    current.score += 1 / (RRF_CONSTANT + rank);
    ranks.set(id, current);
}

function dotProduct(left: number[], right: number[]) {
    if (left.length !== right.length) return Number.NEGATIVE_INFINITY;
    let score = 0;
    for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
    return score;
}

function matchingExcerpt(content: string, query: string) {
    const terms = tokenizeText(query);
    const lines = content.split(/\r?\n/);
    const index = lines.findIndex((line) => terms.some((term) => line.toLocaleLowerCase().includes(term)));
    if (index < 0) return content.slice(0, 280).trim();
    return lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).join("\n").trim();
}
