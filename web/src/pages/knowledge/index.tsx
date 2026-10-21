import { BookOpen, FolderSearch, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Empty, Input, Modal, Space, Table, Tag, Tooltip, Typography, type TableProps } from "antd";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { deleteKnowledgeSource, fetchKnowledgeSources, scanWorkspaceKnowledge, searchKnowledge, syncCanvasKnowledge, type CanvasKnowledgeProject, type KnowledgeSearchResult, type KnowledgeSource } from "@/services/api/knowledge";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";

export default function KnowledgePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const connected = useAgentStore((state) => state.connected);
    const openAgent = useAgentStore((state) => state.openPanel);
    const projects = useCanvasStore((state) => state.projects);
    const canvasesHydrated = useCanvasStore((state) => state.hydrated);
    const [sources, setSources] = useState<KnowledgeSource[]>([]);
    const [sourcesLoading, setSourcesLoading] = useState(false);
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

    useEffect(() => {
        void refreshSources();
    }, [refreshSources]);

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
        <main className="min-h-0 flex-1 overflow-y-auto bg-background text-stone-900 dark:text-stone-100">
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
                            <div key={result.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <div className="min-w-0">
                                    <div className="font-medium">{result.title}</div>
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
