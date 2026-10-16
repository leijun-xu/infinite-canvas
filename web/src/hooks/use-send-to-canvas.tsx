import { App, Button } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";
import { prepareCanvasResults, placeCanvasResults, type CanvasNodeDraft } from "@/lib/canvas/send-to-canvas";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentStore } from "@/stores/use-agent-store";

const LAST_TARGET_KEY = "infinite-canvas:last_send_canvas";

export function lastCanvasTarget() {
    try {
        return localStorage.getItem(LAST_TARGET_KEY);
    } catch {
        return null;
    }
}

export function useSendToCanvas() {
    const { notification, message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();

    return async (drafts: CanvasNodeDraft[], targetId: string | null, title: string, includeFlow: boolean, openAfter: boolean) => {
        if (targetId && !useCanvasStore.getState().openProject(targetId)) throw new Error("Canvas no longer exists");
        const prepared = await prepareCanvasResults(drafts, includeFlow);
        const store = useCanvasStore.getState();
        const projectId = targetId || store.createProject(title.trim() || undefined);
        const project = store.openProject(projectId);
        if (!project) {
            await prepared.rollback();
            throw new Error("Canvas no longer exists");
        }
        const nodes = placeCanvasResults(project, prepared.nodes);
        store.updateProject(projectId, { nodes: [...project.nodes, ...nodes], connections: [...project.connections, ...prepared.connections] });
        try {
            localStorage.setItem(LAST_TARGET_KEY, projectId);
        } catch {
            // Sending remains available when preference storage is disabled.
        }
        const notificationKey = `canvas-send:${nanoid()}`;
        const openCanvas = () => {
            const current = useCanvasStore.getState().openProject(projectId);
            if (!current) {
                message.error(t("canvas.sendResult.targetMissing"));
                return;
            }
            const first = nodes[0];
            const viewport = { x: 120 - first.position.x, y: 100 - first.position.y, k: 1 };
            const context = useAgentStore.getState().canvasContext;
            if (context?.snapshot.projectId === projectId && context.snapshot.nodes.length) context.applyOps([{ type: "set_viewport", viewport }]);
            else useCanvasStore.getState().updateProject(projectId, { viewport });
            navigate(`/canvas/${projectId}`);
        };
        let undone = false;
        const undo = () => {
            if (undone) return;
            undone = true;
            const ids = new Set(nodes.map((node) => node.id));
            const context = useAgentStore.getState().canvasContext;
            const current = useCanvasStore.getState().openProject(projectId);
            if (current) useCanvasStore.getState().updateProject(projectId, {
                nodes: current.nodes.filter((node) => !ids.has(node.id)),
                connections: current.connections.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId)),
            });
            if (context?.snapshot.projectId === projectId && context.snapshot.nodes.some((node) => ids.has(node.id))) {
                context.applyOps([{ type: "delete_node", ids: [...ids] }]);
            }
            notification.destroy(notificationKey);
            message.success(t("canvas.sendResult.undone"));
        };
        notification.success({
            key: notificationKey,
            title: t("canvas.sendResult.sent", { name: project.title }),
            duration: 0,
            actions: <div className="flex gap-2"><Button type="text" size="small" onClick={openCanvas}>{t("canvas.sendResult.openCanvas")}</Button><Button type="text" size="small" onClick={undo}>{t("canvas.sendResult.undo")}</Button></div>,
        });
        if (openAfter) openCanvas();
    };
}
