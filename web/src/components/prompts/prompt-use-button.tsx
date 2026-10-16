import { ImageIcon, Sparkles, Video } from "lucide-react";
import { App, Button, Dropdown } from "antd";
import { nanoid } from "nanoid";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";

export function PromptUseButton({ prompt, referenceImageUrls = [], onUsed }: { prompt: string; referenceImageUrls?: string[]; onUsed?: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const dispatchImage = useWorkbenchAgentStore((state) => state.dispatchImage);
    const dispatchVideo = useWorkbenchAgentStore((state) => state.dispatchVideo);

    const usePrompt = (kind: "image" | "video") => {
        const references = [...new Set(referenceImageUrls)].map((url, index) => ({ id: nanoid(), name: t("imageReferences.label", { index: index + 1 }), type: "", dataUrl: url, url }));
        if (kind === "image") dispatchImage({ prompt, references, run: false });
        else {
            if (references.length > 7) message.info(t("prompts.videoReferenceLimit"));
            dispatchVideo({ prompt, references: references.slice(0, 7), run: false });
        }
        onUsed?.();
        navigate(kind === "image" ? "/image" : "/video");
    };

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: [
                    { key: "image", icon: <ImageIcon className="size-4" />, label: t("prompts.useForImage") },
                    { key: "video", icon: <Video className="size-4" />, label: t("prompts.useForVideo") },
                ],
                onClick: ({ key }) => usePrompt(key as "image" | "video"),
            }}
        >
            <Button type="primary" size="small" icon={<Sparkles className="size-3.5" />}>
                {t("prompts.use")}
            </Button>
        </Dropdown>
    );
}
