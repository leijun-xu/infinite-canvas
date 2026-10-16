import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Input, Modal, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { lastCanvasTarget, useSendToCanvas } from "@/hooks/use-send-to-canvas";
import type { CanvasNodeDraft } from "@/lib/canvas/send-to-canvas";

export type { CanvasNodeDraft } from "@/lib/canvas/send-to-canvas";
const NEW_CANVAS = "__new__";

export function SendToCanvasDialog({ drafts, onClose }: { drafts: CanvasNodeDraft[] | null; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const sendToCanvas = useSendToCanvas();
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [targetId, setTargetId] = useState(NEW_CANVAS);
    const [newTitle, setNewTitle] = useState("");
    const [includeFlow, setIncludeFlow] = useState(false);
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    const open = Boolean(drafts?.length);

    useEffect(() => {
        if (!open || !hydrated) return;
        const currentProjects = useCanvasStore.getState().projects;
        const savedId = lastCanvasTarget();
        setTargetId(currentProjects.find((project) => project.id === savedId)?.id || currentProjects[0]?.id || NEW_CANVAS);
        setNewTitle(t("canvas.defaultTitle", { count: currentProjects.length + 1 }));
        setIncludeFlow(false);
    }, [open, hydrated, t]);

    const send = async (openAfter: boolean) => {
        if (!drafts?.length || sendingRef.current) return;
        sendingRef.current = true;
        setSending(true);
        try {
            await sendToCanvas(drafts, targetId === NEW_CANVAS ? null : targetId, newTitle, includeFlow, openAfter);
            onClose();
        } catch {
            message.error(t("canvas.sendResult.failed"));
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    return (
        <Modal title={t("canvas.sendResult.title")} open={open} onCancel={() => !sending && onClose()} closable={!sending} footer={[
            <Button key="cancel" disabled={sending} onClick={onClose}>{t("common.cancel")}</Button>,
            <Button key="send" disabled={!hydrated} loading={sending} onClick={() => void send(false)}>{t("canvas.sendResult.send")}</Button>,
            <Button key="open" type="primary" disabled={!hydrated} loading={sending} onClick={() => void send(true)}>{t("canvas.sendResult.sendAndOpen")}</Button>,
        ]}>
            <div className="space-y-4 py-2">
                <label className="block">
                    <span className="mb-2 block text-sm font-medium">{t("canvas.sendResult.target")}</span>
                    <Select className="w-full" value={targetId} onChange={setTargetId} disabled={sending} options={[
                        ...projects.map((project) => ({ value: project.id, label: project.title })),
                        { value: NEW_CANVAS, label: t("canvas.sendResult.newCanvas") },
                    ]} />
                </label>
                {targetId === NEW_CANVAS ? <label className="block"><span className="mb-2 block text-sm font-medium">{t("canvas.sendResult.canvasName")}</span><Input value={newTitle} disabled={sending} onChange={(event) => setNewTitle(event.target.value)} /></label> : null}
                <Checkbox checked={includeFlow} disabled={sending} onChange={(event) => setIncludeFlow(event.target.checked)}>{t("canvas.sendResult.includeFlow")}</Checkbox>
                <Typography.Paragraph type="secondary" className="mb-0 text-xs leading-5">{t("canvas.sendResult.description", { count: drafts?.length || 0 })}</Typography.Paragraph>
            </div>
        </Modal>
    );
}
