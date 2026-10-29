import { useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Switch } from "antd";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fetchKnowledgeRerank, saveKnowledgeRerank, type KnowledgeRerankConfig } from "@/services/api/knowledge";
import { useAgentStore } from "@/stores/use-agent-store";

export function RerankConfig() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const connected = useAgentStore((state) => state.connected);
    const [form] = Form.useForm<KnowledgeRerankConfig>();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!connected || !token) return;
        let active = true;
        setLoading(true);
        void fetchKnowledgeRerank(endpoint, token)
            .then((response) => {
                if (active) form.setFieldsValue({ ...response.data, timeoutSeconds: response.data.timeoutSeconds });
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : t("knowledge.loadFailed"));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [connected, endpoint, form, message, t, token]);

    const save = async (values: KnowledgeRerankConfig) => {
        setSaving(true);
        try {
            await saveKnowledgeRerank(endpoint, token, values);
            message.success(t("knowledge.rerankSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.rerankSaveFailed"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="border-t border-stone-200 py-7 dark:border-stone-800">
            <div className="mb-4">
                <h2 className="text-base font-medium">{t("knowledge.rerank")}</h2>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("knowledge.rerankDescription")}</p>
            </div>
            <Form form={form} layout="vertical" initialValues={{ enabled: false, model: "Qwen/Qwen3-Reranker-0.6B" }} disabled={!connected || loading || saving} onFinish={(values) => void save(values)}>
                <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item name="model" label={t("knowledge.embeddingModel")} rules={[{ required: true, whitespace: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="timeoutSeconds" label={t("knowledge.rerankTimeout")} extra={t("knowledge.rerankTimeoutDescription")} dependencies={["enabled"]} rules={[({ getFieldValue }) => ({
                        validator: (_, value) => (value == null && !getFieldValue("enabled")) || (typeof value === "number" && Number.isFinite(value) && value * 1000 >= 1 && value * 1000 <= 2_147_483_647)
                            ? Promise.resolve()
                            : Promise.reject(new Error(t("knowledge.rerankTimeoutRequired"))),
                    })]}>
                        <InputNumber className="w-full" />
                    </Form.Item>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm">
                        <span>{t("knowledge.rerankEnabled")}</span>
                        <Form.Item name="enabled" valuePropName="checked" noStyle><Switch /></Form.Item>
                    </div>
                    <Button htmlType="submit" icon={<Save className="size-4" />} loading={saving}>{t("knowledge.saveConfig")}</Button>
                </div>
            </Form>
        </section>
    );
}
