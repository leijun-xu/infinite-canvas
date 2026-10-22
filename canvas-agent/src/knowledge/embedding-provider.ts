import { z } from "zod";

import type { KnowledgeEmbeddingConfig } from "../config.js";

export const EMBEDDING_BATCH_SIZE = 16;
export const QUERY_EMBEDDING_TIMEOUT_MS = 15_000;
export const SYNC_EMBEDDING_TIMEOUT_MS = 60_000;

const responseSchema = z.object({
    data: z.array(z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number()),
    })),
});

export function activeEmbeddingConfig(config?: KnowledgeEmbeddingConfig) {
    const baseUrl = String(config?.baseUrl || "").trim();
    const apiKey = String(config?.apiKey || "").trim();
    const model = String(config?.model || "").trim();
    if (!config?.enabled || !baseUrl || !apiKey || !model) return undefined;
    return {
        baseUrl: normalizeBaseUrl(baseUrl),
        apiKey,
        model,
    };
}

/** 通过 OpenAI-compatible embeddings 接口串行处理批次。 */
export async function embedTexts(config: KnowledgeEmbeddingConfig, texts: string[], timeoutMs: number) {
    const active = activeEmbeddingConfig(config);
    if (!active) throw new Error("Embedding 尚未启用或缺少 API Key");
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        const input = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        let body: unknown;
        try {
            response = await fetch(`${active.baseUrl}/embeddings`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${active.apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({ model: active.model, input, encoding_format: "float" }),
                signal: controller.signal,
            });
            body = await response.json().catch((error) => {
                if (controller.signal.aborted) throw error;
                return undefined;
            });
        } catch (error) {
            if (controller.signal.aborted) throw new Error(`Embedding 请求超时（${timeoutMs / 1000} 秒）`);
            throw error;
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) throw new Error(embeddingError(body) || `Embedding 请求失败（HTTP ${response.status}）`);
        const data = responseSchema.parse(body).data.sort((left, right) => left.index - right.index);
        if (data.length !== input.length) throw new Error("Embedding 返回数量与输入不一致");
        vectors.push(...data.map((item) => normalizeVector(item.embedding)));
    }
    const dimensions = vectors[0]?.length || 0;
    if (vectors.some((vector) => !dimensions || vector.length !== dimensions)) throw new Error("Embedding 向量维度不一致");
    return vectors;
}

export function encodeVector(vector: number[]) {
    const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
    vector.forEach((value, index) => buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT));
    return buffer.toString("base64");
}

export function decodeVector(value: string) {
    const buffer = Buffer.from(value, "base64");
    if (buffer.length % Float32Array.BYTES_PER_ELEMENT) throw new Error("Embedding 向量内容无效");
    return Array.from({ length: buffer.length / Float32Array.BYTES_PER_ELEMENT }, (_, index) => buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT));
}

function normalizeVector(vector: number[]) {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!magnitude || !Number.isFinite(magnitude)) throw new Error("Embedding 返回了无效向量");
    return vector.map((value) => value / magnitude);
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function embeddingError(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return "";
    const error = (body as Record<string, unknown>).error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && !Array.isArray(error)) return String((error as Record<string, unknown>).message || "");
    return String((body as Record<string, unknown>).message || "");
}
