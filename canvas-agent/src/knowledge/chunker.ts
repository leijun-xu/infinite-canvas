import crypto from "node:crypto";

import type { KnowledgeChunk, KnowledgeDocument } from "./types.js";

export const CHUNK_MAX_CHARACTERS = 1200;
export const CHUNK_OVERLAP_CHARACTERS = 150;

/** 按段落和换行边界切分文档，并保留少量上下文重叠。 */
export function chunkDocument(document: KnowledgeDocument): KnowledgeChunk[] {
    const content = document.content;
    if (!content.trim()) return [];
    const chunks: KnowledgeChunk[] = [];
    const lineBreaks = collectLineBreaks(content);
    let start = 0;
    while (start < content.length) {
        const end = chunkEnd(content, start);
        const raw = content.slice(start, end);
        const leadingWhitespace = raw.length - raw.trimStart().length;
        const trailingWhitespace = raw.length - raw.trimEnd().length;
        const chunkStart = start + leadingWhitespace;
        const chunkEndOffset = end - trailingWhitespace;
        const chunkContent = content.slice(chunkStart, chunkEndOffset);
        if (chunkContent) {
            const startLine = lineAt(lineBreaks, chunkStart);
            const endLine = lineAt(lineBreaks, Math.max(chunkStart, chunkEndOffset - 1));
            const contentHash = digest(chunkContent);
            chunks.push({
                id: `${document.id}:${startLine}:${endLine}:${contentHash}`,
                documentId: document.id,
                sourceId: document.sourceId,
                sourceKind: document.sourceKind,
                title: document.title,
                content: chunkContent,
                reference: document.reference,
                updatedAt: document.updatedAt,
                startLine,
                endLine,
                contentHash,
                metadata: document.metadata,
            });
        }
        if (end >= content.length) break;
        start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARACTERS);
    }
    return chunks;
}

function chunkEnd(content: string, start: number) {
    const maximum = Math.min(content.length, start + CHUNK_MAX_CHARACTERS);
    if (maximum === content.length) return maximum;
    const minimum = start + Math.floor(CHUNK_MAX_CHARACTERS * 0.6);
    const paragraph = content.lastIndexOf("\n\n", maximum - 2);
    if (paragraph >= minimum) return paragraph + 2;
    const line = content.lastIndexOf("\n", maximum - 1);
    if (line >= minimum) return line + 1;
    return maximum;
}

function collectLineBreaks(content: string) {
    const offsets: number[] = [];
    for (let index = 0; index < content.length; index += 1) {
        if (content.charCodeAt(index) === 10) offsets.push(index);
    }
    return offsets;
}

function lineAt(lineBreaks: number[], offset: number) {
    let low = 0;
    let high = lineBreaks.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (lineBreaks[middle] < offset) low = middle + 1;
        else high = middle;
    }
    return low + 1;
}

function digest(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
}
