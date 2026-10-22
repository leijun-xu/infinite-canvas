import { BookOpen, FolderSearch, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Empty, Form, Input, Modal, Space, Switch, Table, Tag, Tooltip, Typography, type TableProps } from "antd";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { deleteKnowledgeSource, fetchKnowledgeEmbedding, fetchKnowledgeSources, saveKnowledgeEmbedding, scanWorkspaceKnowledge, searchKnowledge, syncCanvasKnowledge, type CanvasKnowledgeProject, type KnowledgeSearchResult, type KnowledgeSource } from "@/services/api/knowledge";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

type EmbeddingFormValues = { enabled: boolean; baseUrl: string; model: string; apiKey?: string };

export default function KnowledgePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const connected = useAgentStore((state) => state.connected);
    const openAgent = useAgentStore((state) => state.openPanel);
    const projects = useCanvasStore((state) => state.projects);
    const canvasesHydrated = useCanvasStore((state) => state.hydrated);
    const [embeddingForm] = Form.useForm<EmbeddingFormValues>();
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [sourcesLoading, setSourcesLoading] = useState(false);
    const [embeddingLoading, setEmbeddingLoading] = useState(false);
    const [embeddingSaving, setEmbeddingSaving] = useState(false);
    const [hasEmbeddingApiKey, setHasEmbeddingApiKey] = useState(false);
    const [action, setAction] = useState<"workspace" | "canvas" | "">("");
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<KnowledgeSearchResult[]>([]);

    const refreshSources = useCallback(async () => {
        if (!connected || !token) {
            setSources([]);
            setResults([]);
            return;
        }
        setSourcesLoading(true);
        try {
            const response = await fetchKnowledgeSources(endpoint, token);
            setSources(response.data);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.loadFailed"));
        } finally {
            setSourcesLoading(false);
        }
    }, [connected, endpoint, message, t, token]);

    const refreshEmbedding = useCallback(async () => {
        if (!connected || !token) {
            setHasEmbeddingApiKey(false);
            return;
        }
        setEmbeddingLoading(true);
        try {
            const response = await fetchKnowledgeEmbedding(endpoint, token);
            setHasEmbeddingApiKey(response.data.hasApiKey);
            embeddingForm.setFieldsValue({ enabled: response.data.enabled, baseUrl: response.data.baseUrl, model: response.data.model, apiKey: "" });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.loadFailed"));
        } finally {
            setEmbeddingLoading(false);
        }
    }, [connected, embeddingForm, endpoint, message, t, token]);

    useEffect(() => {
        void Promise.all([refreshSources(), refreshEmbedding()]);
    }, [refreshEmbedding, refreshSources]);

    const saveEmbedding = async (values: EmbeddingFormValues) => {
        setEmbeddingSaving(true);
        try {
            const apiKey = values.apiKey?.trim();
            const response = await saveKnowledgeEmbedding(endpoint, token, { enabled: values.enabled, baseUrl: values.baseUrl, model: values.model, ...(apiKey ? { apiKey } : {}) });
            setHasEmbeddingApiKey(response.data.hasApiKey);
            embeddingForm.setFieldValue("apiKey", "");
            message.success(t("knowledge.embeddingSaved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.embeddingSaveFailed"));
        } finally {
            setEmbeddingSaving(false);
        }
    };

    const clearEmbeddingApiKey = () => {
        Modal.confirm({
            title: t("knowledge.clearEmbeddingApiKeyTitle"),
            content: t("knowledge.clearEmbeddingApiKeyDescription"),
            okText: t("knowledge.clearEmbeddingApiKey"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                setEmbeddingSaving(true);
                try {
                    const values = embeddingForm.getFieldsValue();
                    const response = await saveKnowledgeEmbedding(endpoint, token, {
                        enabled: false,
                        baseUrl: values.baseUrl,
                        model: values.model,
                        apiKey: "",
                    });
                    setHasEmbeddingApiKey(response.data.hasApiKey);
                    embeddingForm.setFieldsValue({ enabled: false, apiKey: "" });
                    message.success(t("knowledge.embeddingApiKeyCleared"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("knowledge.embeddingSaveFailed"));
                    throw error;
                } finally {
                    setEmbeddingSaving(false);
                }
            },
        });
    };

    const scanWorkspace = async () => {
        setAction("workspace");
        try {
            const response = await scanWorkspaceKnowledge(endpoint, token);
            await refreshSources();
            setResults([]);
            message.success(t("knowledge.workspaceSynced", { count: response.data.documentCount }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.syncFailed"));
        } finally {
            setAction("");
        }
    };

    const syncCanvases = async () => {
        if (!canvasesHydrated) return;
        setAction("canvas");
        try {
            const response = await syncCanvasKnowledge(endpoint, token, projects.map(toKnowledgeProject));
            await refreshSources();
            setResults([]);
            message.success(t("knowledge.canvasesSynced", response.data));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.syncFailed"));
        } finally {
            setAction("");
        }
    };

    const runSearch = async (value = query) => {
        const nextQuery = value.trim();
        if (!nextQuery) return setResults([]);
        setSearching(true);
        try {
            const response = await searchKnowledge(endpoint, token, nextQuery);
            setResults(response.data);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("knowledge.searchFailed"));
        } finally {
            setSearching(false);
        }
    };

    const removeSource = useCallback((source: KnowledgeSource) => {
        Modal.confirm({
            title: t("knowledge.deleteTitle"),
            content: t("knowledge.deleteDescription", { title: source.title }),
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                try {
                    await deleteKnowledgeSource(endpoint, token, source.id);
                    await refreshSources();
                    setResults((current) => current.filter((result) => result.sourceId !== source.id));
                    message.success(t("knowledge.deleted"));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("knowledge.deleteFailed"));
                    throw error;
                }
            },
        });
    }, [endpoint, message, refreshSources, t, token]);

    const columns = useMemo<TableProps<KnowledgeSource>["columns"]>(
        () => [
            {
                title: t("knowledge.source"),
                key: "source",
                render: (_, source) => (
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-stone-900 dark:text-stone-100">{source.title}</span>
                            <Tag className="m-0 shrink-0">{t(`knowledge.kinds.${source.kind}`)}</Tag>
                        </div>
                        <Typography.Text type="secondary" className="block max-w-xl truncate text-xs!" title={source.reference}>
                            {source.reference}
                        </Typography.Text>
                    </div>
                ),
            },
            { title: t("knowledge.documents"), dataIndex: "documentCount", width: 110 },
            { title: t("knowledge.updated"), dataIndex: "updatedAt", width: 180, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
            {
                title: "",
                key: "actions",
                width: 56,
                align: "right",
                render: (_, source) => (
                    <Tooltip title={t("common.delete")}>
                        <Button type="text" danger shape="circle" icon={<Trash2 className="size-4" />} aria-label={t("common.delete")} onClick={() => removeSource(source)} />
                    </Tooltip>
                ),
            },
        ],
        [removeSource, t],
    );

    return (
        <main className="thin-scrollbar h-full overflow-y-auto bg-background text-stone-900 dark:text-stone-100">
            <div className="mx-auto w-full max-w-6xl px-6 py-8">
                <div className="flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-stone-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <BookOpen className="size-5 text-stone-500" />
                            <h1 className="text-2xl font-semibold">{t("knowledge.title")}</h1>
                        </div>
                        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{t("knowledge.description")}</p>
                    </div>
                    <Space wrap>
                        <Button icon={<FolderSearch className="size-4" />} loading={action === "workspace"} disabled={!connected || Boolean(action)} onClick={() => void scanWorkspace()}>
                            {t("knowledge.scanWorkspace")}
                        </Button>
                        <Button icon={<RefreshCw className="size-4" />} loading={action === "canvas"} disabled={!connected || !canvasesHydrated || Boolean(action)} onClick={() => void syncCanvases()}>
                            {t("knowledge.syncCanvases")}
                        </Button>
                    </Space>
                </div>

                {!connected ? (
                    <Alert className="mt-6" type="warning" showIcon title={t("knowledge.agentRequired")} action={<Button size="small" onClick={openAgent}>{t("knowledge.openAgent")}</Button>} />
                ) : null}

                <section className="py-7">
                    <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-base font-medium">{t("knowledge.embedding")}</h2>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("knowledge.embeddingDescription")}</p>
                        </div>
                        <Tag color={hasEmbeddingApiKey ? "success" : "default"} className="m-0 shrink-0">
                            {t(hasEmbeddingApiKey ? "knowledge.configured" : "knowledge.notConfigured")}
                        </Tag>
                    </div>
                    <Form<EmbeddingFormValues>
                        form={embeddingForm}
                        layout="vertical"
                        initialValues={{ enabled: false, baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3", apiKey: "" }}
                        disabled={!connected || embeddingLoading}
                        onFinish={(values) => void saveEmbedding(values)}
                    >
                        <div className="grid gap-x-4 sm:grid-cols-2">
                            <Form.Item name="baseUrl" label={t("knowledge.embeddingBaseUrl")} rules={[{ required: true }, { type: "url" }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="model" label={t("knowledge.embeddingModel")} rules={[{ required: true }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item
                                name="apiKey"
                                label={t("knowledge.embeddingApiKey")}
                                dependencies={["enabled"]}
                                rules={[({ getFieldValue }) => ({
                                    validator: (_, value) => getFieldValue("enabled") && !hasEmbeddingApiKey && !String(value || "").trim()
                                        ? Promise.reject(new Error(t("knowledge.embeddingApiKeyRequired")))
                                        : Promise.resolve(),
                                })]}
                            >
                                <Input.Password autoComplete="new-password" placeholder={hasEmbeddingApiKey ? t("knowledge.embeddingApiKeyPlaceholder") : undefined} />
                            </Form.Item>
                            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 sm:col-span-2">
                                <div className="flex items-center gap-2 text-sm">
                                    <span>{t("knowledge.embeddingEnabled")}</span>
                                    <Form.Item name="enabled" valuePropName="checked" noStyle>
                                        <Switch />
                                    </Form.Item>
                                </div>
                                <Space size="small">
                                    {hasEmbeddingApiKey ? (
                                        <Button danger type="text" icon={<Trash2 className="size-4" />} onClick={clearEmbeddingApiKey}>
                                            {t("knowledge.clearEmbeddingApiKey")}
                                        </Button>
                                    ) : null}
                                    <Button htmlType="submit" icon={<Save className="size-4" />} loading={embeddingSaving}>
                                        {t("knowledge.saveConfig")}
                                    </Button>
                                </Space>
                            </div>
                        </div>
                    </Form>
                </section>

                <section className="border-t border-stone-200 py-7 dark:border-stone-800">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-base font-medium">{t("knowledge.sources")}</h2>
                        <span className="text-xs text-stone-500">{t("knowledge.sourceCount", { count: sources.length })}</span>
                    </div>
                    <Table rowKey="id" size="middle" columns={columns} dataSource={sources} loading={sourcesLoading} pagination={false} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("knowledge.emptySources")} /> }} />
                </section>

                <section className="border-t border-stone-200 py-7 dark:border-stone-800">
                    <div className="mb-3">
                        <h2 className="text-base font-medium">{t("knowledge.testSearch")}</h2>
                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("knowledge.testSearchDescription")}</p>
                    </div>
                    <Input.Search
                        allowClear
                        size="large"
                        prefix={<Search className="size-4 text-stone-400" />}
                        value={query}
                        loading={searching}
                        disabled={!connected}
                        placeholder={t("knowledge.searchPlaceholder")}
                        enterButton={t("knowledge.search")}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            if (!event.target.value.trim()) setResults([]);
                        }}
                        onSearch={(value) => void runSearch(value)}
                    />
                    <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                        {results.map((result) => (
                            <div key={result.chunkId} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{result.title}</span>
                                        <Tag className="m-0">{t(`knowledge.retrievalModes.${result.retrievalMode}`)}</Tag>
                                        <span className="text-xs text-stone-500">{t("knowledge.lines", { start: result.startLine, end: result.endLine })}</span>
                                    </div>
                                    <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-300">{result.excerpt || t("knowledge.noExcerpt")}</p>
                                    <Typography.Text type="secondary" className="mt-1 block truncate text-xs!" title={result.reference}>
                                        {result.reference}
                                    </Typography.Text>
                                </div>
                                {result.sourceKind === "canvas" && result.metadata?.projectId ? <Link className="self-start text-sm" to={`/canvas/${result.metadata.projectId}`}>{t("knowledge.openCanvas")}</Link> : null}
                            </div>
                        ))}
                    </div>
                    {!searching && query.trim() && !results.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("knowledge.emptySearch")} className="py-12" /> : null}
                </section>
            </div>
        </main>
    );
}

function toKnowledgeProject(project: ReturnType<typeof useCanvasStore.getState>["projects"][number]): CanvasKnowledgeProject {
    return {
        id: project.id,
        title: project.title,
        updatedAt: project.updatedAt,
        documents: project.nodes.flatMap((node) => {
            const content = nodeText(node);
            if (!content) return [];
            return [{
                id: node.id,
                title: node.title,
                content,
                reference: `/canvas/${project.id}#node=${node.id}`,
                metadata: { projectId: project.id, nodeId: node.id, nodeType: node.type },
            }];
        }),
    };
}

function nodeText(node: ReturnType<typeof useCanvasStore.getState>["projects"][number]["nodes"][number]) {
    const metadata = node.metadata;
    const values = [
        node.type === CanvasNodeType.Text ? metadata?.content : "",
        metadata?.composerContent,
        metadata?.prompt,
        ...(metadata?.texts?.map((item) => item.content) || []),
    ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    return [...new Set(values)].join("\n\n");
}
