import assert from "node:assert/strict";
import test from "node:test";

import { CHUNK_MAX_CHARACTERS, CHUNK_OVERLAP_CHARACTERS, chunkDocument } from "./chunker.js";
import type { KnowledgeDocument } from "./types.js";

test("长文档按段落切片并保留重叠上下文", () => {
    const content = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行：${"内容".repeat(12)}`).join("\n\n");
    const document: KnowledgeDocument = {
        id: "document",
        sourceId: "source",
        sourceKind: "workspace",
        title: "demo.md",
        content,
        reference: "/demo.md",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const chunks = chunkDocument(document);

    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.content.length <= CHUNK_MAX_CHARACTERS));
    assert.ok(chunks.every((chunk) => chunk.startLine > 0 && chunk.endLine >= chunk.startLine));
    assert.ok(chunks[0].content.slice(-CHUNK_OVERLAP_CHARACTERS / 2).split(/\s+/).some((term) => chunks[1].content.includes(term)));
    assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
});

test("空文档不生成切片", () => {
    const document: KnowledgeDocument = {
        id: "empty",
        sourceId: "source",
        sourceKind: "canvas",
        title: "空文档",
        content: " \n ",
        reference: "/canvas/demo",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    assert.deepEqual(chunkDocument(document), []);
});
