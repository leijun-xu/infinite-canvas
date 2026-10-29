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

export type KnowledgeChunk = {
    id: string;
    documentId: string;
    sourceId: string;
    sourceKind: KnowledgeSourceKind;
    title: string;
    content: string;
    reference: string;
    updatedAt: string;
    startLine: number;
    endLine: number;
    contentHash: string;
    embedding?: string;
    metadata?: Record<string, string>;
};

export type EmbeddingProfile = {
    baseUrl: string;
    model: string;
    dimensions: number;
};

export type KnowledgeData = {
    version: 2;
    sources: KnowledgeSource[];
    documents: KnowledgeDocument[];
    chunks: KnowledgeChunk[];
    embeddingProfile?: EmbeddingProfile;
};

export type KnowledgeSearchResult = Pick<KnowledgeDocument, "id" | "sourceId" | "sourceKind" | "title" | "reference" | "updatedAt" | "metadata"> & {
    chunkId: string;
    excerpt: string;
    startLine: number;
    endLine: number;
    score: number;
    retrievalMode: "keyword" | "hybrid";
    rerankStatus?: "success" | "fallback";
    rerankScore?: number;
    keywordRank?: number;
    vectorRank?: number;
};
