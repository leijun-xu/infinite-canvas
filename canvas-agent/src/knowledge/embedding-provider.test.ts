import assert from "node:assert/strict";
import test from "node:test";

import { embedTexts } from "./embedding-provider.js";

const config = {
    enabled: true,
    baseUrl: "https://embedding.example/v1",
    model: "test-model",
    apiKey: "test-key",
};

test("Embedding 请求超过批次时限后中止", async (context) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    context.after(() => {
        globalThis.fetch = originalFetch;
    });

    await assert.rejects(embedTexts(config, ["测试"], 5), /Embedding 请求超时（0.005 秒）/);
});
