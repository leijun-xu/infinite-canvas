import { z } from "zod";

import type { KnowledgeEmbeddingConfig, KnowledgeRerankConfig } from "../config.js";

const responseSchema = z.object({
    results: z.array(z.object({ index: z.number().int().nonnegative(), relevance_score: z.number().finite() })),
});

/** 校验 Node 定时器可表达的时长；不为用户预设业务超时。 */
export function validRerankTimeout(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value * 1000 >= 1 && value * 1000 <= 2_147_483_647;
}

/** 使用已保存的 Embedding 连接，向 rerank 接口发送完整候选切片。 */
export async function rerankTexts(config: KnowledgeRerankConfig, connection: KnowledgeEmbeddingConfig | undefined, query: string, documents: string[]) {
    const baseUrl = connection?.baseUrl.trim().replace(/\/+$/, "");
    const apiKey = connection?.apiKey.trim();
    if (!config.enabled || !config.model.trim() || !baseUrl || !apiKey || !validRerankTimeout(config.timeoutSeconds)) throw new Error("Rerank 配置不完整");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);
    try {
        const response = await fetch(`${baseUrl}/rerank`, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ model: config.model.trim(), query, documents, top_n: documents.length, return_documents: false }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Rerank 请求失败（HTTP ${response.status}）`);
        const results = responseSchema.parse(await response.json()).results;
        if (results.length !== documents.length || new Set(results.map((item) => item.index)).size !== documents.length || results.some((item) => item.index >= documents.length)) {
            throw new Error("Rerank 返回的候选索引无效");
        }
        return results.sort((left, right) => right.relevance_score - left.relevance_score || left.index - right.index);
    } finally {
        clearTimeout(timer);
    }
}
