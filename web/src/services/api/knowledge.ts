import { fetchAgentJson } from "@/services/api/canvas-agent";

export type KnowledgeSource = {
    id: string;
    kind: "workspace" | "canvas";
    title: string;
    reference: string;
    documentCount: number;
    updatedAt: string;
};
export type KnowledgeSearchResult = {
    id: string;
    chunkId: string;
    sourceId: string;
    sourceKind: KnowledgeSource["kind"];
    title: string;
    reference: string;
    updatedAt: string;
    excerpt: string;
    startLine: number;
    endLine: number;
    score: number;
    retrievalMode: "keyword" | "hybrid";
    keywordRank?: number;
    vectorRank?: number;
    metadata?: Record<string, string>;
};
export type KnowledgeEmbeddingConfig = {
    enabled: boolean;
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
};
export type KnowledgeEmbeddingInput = Pick<KnowledgeEmbeddingConfig, "enabled" | "baseUrl" | "model"> & { apiKey?: string };
export type CanvasKnowledgeProject = {
    id: string;
    title: string;
    updatedAt: string;
    documents: Array<{ id: string; title: string; content: string; reference: string; metadata?: Record<string, string> }>;
};

export function fetchKnowledgeSources(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; data: KnowledgeSource[] }>(endpoint, token, "/agent/knowledge/sources");
}

export function fetchKnowledgeEmbedding(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; data: KnowledgeEmbeddingConfig }>(endpoint, token, "/agent/knowledge/embedding");
}

export function saveKnowledgeEmbedding(endpoint: string, token: string, input: KnowledgeEmbeddingInput) {
    return fetchAgentJson<{ ok?: boolean; data: KnowledgeEmbeddingConfig }>(endpoint, token, "/agent/knowledge/embedding", jsonPost(input));
}

export function scanWorkspaceKnowledge(endpoint: string, token: string) {
    return fetchAgentJson<{ ok?: boolean; data: KnowledgeSource }>(endpoint, token, "/agent/knowledge/workspace/scan", jsonPost({}));
}

export function syncCanvasKnowledge(endpoint: string, token: string, projects: CanvasKnowledgeProject[]) {
    return fetchAgentJson<{ ok?: boolean; data: { sources: number; documents: number } }>(endpoint, token, "/agent/knowledge/canvases/sync", jsonPost({ projects }));
}

export function searchKnowledge(endpoint: string, token: string, query: string) {
    return fetchAgentJson<{ ok?: boolean; data: KnowledgeSearchResult[] }>(endpoint, token, "/agent/knowledge/search", jsonPost({ query }));
}

export function deleteKnowledgeSource(endpoint: string, token: string, sourceId: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/knowledge/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
