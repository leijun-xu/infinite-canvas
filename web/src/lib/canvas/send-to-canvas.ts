import { nanoid } from "nanoid";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { deleteStoredImages, getImageBlob, uploadImage } from "@/services/image-storage";
import { deleteStoredMedia, getMediaBlob, setMediaBlob } from "@/services/file-storage";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId } from "@/types/canvas";

export type CanvasNodeDraft = {
    type: CanvasNodeTypeId;
    title: string;
    width: number;
    height: number;
    metadata: CanvasNodeMetadata;
    generationId: string;
    references: ReferenceImage[];
};

export async function prepareCanvasResults(drafts: CanvasNodeDraft[], includeFlow: boolean) {
    const imageKeys: string[] = [];
    const mediaKeys: string[] = [];
    const references = new Map<string, CanvasNodeData>();
    const groups = new Map<string, CanvasNodeDraft[]>();
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const connect = (from: CanvasNodeData, to: CanvasNodeData) => connections.push({ id: nanoid(), fromNodeId: from.id, toNodeId: to.id });
    const copyImage = async (storageKey?: string, content = "") => {
        const input = storageKey ? await getImageBlob(storageKey) : content;
        if (!input) throw new Error("Missing image file");
        const stored = await uploadImage(input);
        if (!stored.storageKey) throw new Error("Image could not be saved locally");
        imageKeys.push(stored.storageKey);
        return imageMetadata(stored);
    };
    try {
        for (const draft of drafts) {
            const referenceNodes: CanvasNodeData[] = [];
            for (const reference of draft.references) {
                const key = reference.storageKey || reference.url || reference.dataUrl;
                let node = references.get(key);
                if (!node) {
                    const metadata = await copyImage(reference.storageKey, reference.dataUrl || reference.url);
                    node = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { ...metadata, status: "success" });
                    node.title = reference.name;
                    references.set(key, node);
                }
                referenceNodes.push(node);
            }
            let media: CanvasNodeMetadata;
            if (draft.type === CanvasNodeType.Video) {
                const blob = draft.metadata.storageKey ? await getMediaBlob(draft.metadata.storageKey) : null;
                if (!blob) throw new Error("Missing video file");
                const storageKey = `video:${nanoid()}`;
                mediaKeys.push(storageKey);
                media = { storageKey, content: await setMediaBlob(storageKey, blob) };
            } else {
                media = await copyImage(draft.metadata.storageKey, draft.metadata.content);
            }
            const copied = { ...draft, metadata: { ...draft.metadata, ...media, references: referenceNodes.map((node) => node.metadata!.storageKey!) } };
            const key = `${draft.type}:${draft.generationId}`;
            groups.set(key, [...(groups.get(key) || []), copied]);
        }
        let rowY = 0;
        for (const group of groups.values()) {
            const draft = group[0];
            const metadata = { ...draft.metadata, count: group.length };
            if (draft.type === CanvasNodeType.Image && group.length > 1) {
                metadata.images = group.map((item) => ({
                    id: nanoid(), status: "success", content: item.metadata.content!, storageKey: item.metadata.storageKey,
                    naturalWidth: item.metadata.naturalWidth!, naturalHeight: item.metadata.naturalHeight!,
                    bytes: item.metadata.bytes!, mimeType: item.metadata.mimeType!,
                }));
                metadata.primaryImageId = metadata.images[0].id;
            }
            const result: CanvasNodeData = { id: nanoid(), type: draft.type, title: draft.title, width: draft.width, height: draft.height, position: { x: includeFlow ? 800 : 0, y: rowY }, metadata };
            let rowHeight = result.height;
            if (includeFlow) {
                const text = createCanvasNode(CanvasNodeType.Text, { x: 170, y: rowY + 120 }, { content: metadata.prompt, status: "success" });
                const config = createCanvasNode(CanvasNodeType.Config, { x: 570, y: rowY + 120 }, {
                    generationMode: draft.type === CanvasNodeType.Video ? "video" : "image", model: metadata.model,
                    size: metadata.size, quality: metadata.quality, background: metadata.background, count: group.length,
                    seconds: metadata.seconds, vquality: metadata.vquality, generateAudio: metadata.generateAudio,
                    watermark: metadata.watermark, videoMode: metadata.videoMode,
                    composerContent: `@[node:${text.id}]`,
                });
                nodes.push(text, config);
                connect(text, config);
                let referenceY = rowY + text.height + 40;
                for (const key of metadata.references || []) {
                    const source = [...references.values()].find((node) => node.metadata?.storageKey === key)!;
                    const reference = { ...source, id: nanoid(), position: { x: 0, y: referenceY }, ...fitNodeSize(source.metadata?.naturalWidth || 340, source.metadata?.naturalHeight || 240, 340, 240) };
                    nodes.push(reference);
                    connect(reference, config);
                    config.metadata!.composerContent += ` @[node:${reference.id}]`;
                    referenceY += reference.height + 40;
                }
                connect(config, result);
                rowHeight = Math.max(rowHeight, 240, referenceY - rowY - 40);
            }
            nodes.push(result);
            rowY += rowHeight + 64;
        }
        return { nodes, connections, rollback: () => Promise.all([deleteStoredImages(imageKeys), deleteStoredMedia(mediaKeys)]) };
    } catch (error) {
        await Promise.all([deleteStoredImages(imageKeys), deleteStoredMedia(mediaKeys)]);
        throw error;
    }
}

export function placeCanvasResults(project: CanvasProject, nodes: CanvasNodeData[]) {
    const viewport = project.viewport;
    const x = project.nodes.length ? Math.max(...project.nodes.map((node) => node.position.x + node.width)) + 64 : (120 - viewport.x) / viewport.k;
    const y = (100 - viewport.y) / viewport.k;
    return nodes.map((node) => ({ ...node, position: { x: x + node.position.x, y: y + node.position.y } }));
}
