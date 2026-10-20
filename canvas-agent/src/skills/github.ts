import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type GitHubSkillOrigin = {
    type: "github";
    repository: string;
    source: string;
    url: string;
    ref: string;
    path: string;
    commit: string;
};

export type GitHubSkillRecord = GitHubSkillOrigin & {
    manifest: Record<string, string>;
};

export type GitHubSkillSources = Record<string, GitHubSkillRecord>;

export type StagedGitHubSkill = {
    name: string;
    directory: string;
    origin: GitHubSkillOrigin;
    manifest: Record<string, string>;
};

type ParsedSource = {
    owner: string;
    repositoryName: string;
    ref?: string;
    sourcePath?: string;
    source: string;
};

type GitHubTreeEntry = {
    path?: string;
    mode?: string;
    type?: string;
};

type GitHubRepository = {
    default_branch?: string;
};

type GitHubCommit = {
    sha?: string;
    commit?: { tree?: { sha?: string } };
};

type GitHubTree = {
    truncated?: boolean;
    tree?: GitHubTreeEntry[];
};

export class GitHubSkillError extends Error {
    override name = "GitHubSkillError";
    constructor(message: string, readonly statusCode: 400 | 404 | 409 | 500) {
        super(message);
    }
}

/** 下载 GitHub 中唯一的 Skill 目录到临时位置，不执行其中任何文件。 */
export async function stageGitHubSkill(sourceValue: unknown, stagingParent: string): Promise<StagedGitHubSkill> {
    const source = parseGitHubSource(sourceValue);
    const repository = `${source.owner}/${source.repositoryName}`;
    const repositoryData = await githubJson<GitHubRepository>(`/repos/${source.owner}/${source.repositoryName}`);
    const ref = source.ref || repositoryData.default_branch;
    if (!ref) throw new GitHubSkillError("无法确定 GitHub 仓库默认分支", 409);
    const commitData = await githubJson<GitHubCommit>(`/repos/${source.owner}/${source.repositoryName}/commits/${encodeURIComponent(ref)}`);
    const commit = commitData.sha;
    const treeSha = commitData.commit?.tree?.sha;
    if (!commit || !treeSha) throw new GitHubSkillError("无法读取 GitHub 仓库版本", 409);
    const treeData = await githubJson<GitHubTree>(`/repos/${source.owner}/${source.repositoryName}/git/trees/${treeSha}?recursive=1`);
    if (treeData.truncated) throw new GitHubSkillError("GitHub 仓库目录过大，请提供具体的 Skill 目录链接", 409);
    const entries = treeData.tree || [];
    const sourcePath = normalizeSourcePath(source.sourcePath);
    const skillFile = selectSkillFile(entries, sourcePath);
    const skillRoot = path.posix.dirname(skillFile) === "." ? "" : path.posix.dirname(skillFile);
    const selectedEntries = entries.filter((entry) => entry.path && insidePosix(skillRoot, entry.path));
    for (const entry of selectedEntries) {
        if (entry.mode === "120000") throw new GitHubSkillError("Skill 目录包含符号链接，无法安全导入", 400);
        if (entry.type === "commit" || entry.mode === "160000") throw new GitHubSkillError("Skill 目录包含 Git 子模块，无法安全导入", 400);
    }

    await fs.mkdir(stagingParent, { recursive: true });
    const stagingRoot = await fs.mkdtemp(path.join(stagingParent, ".github-skill-"));
    const sourceDirectory = path.join(stagingRoot, "source");
    await fs.mkdir(sourceDirectory);
    try {
        const blobs = selectedEntries.filter((entry) => entry.type === "blob" && entry.path);
        const downloads = await Promise.allSettled(blobs.map(async (entry) => {
            const repositoryPath = entry.path || "";
            const relativePath = relativeRepositoryPath(skillRoot, repositoryPath);
            const target = path.join(sourceDirectory, ...relativePath.split("/"));
            const content = await githubRaw(source.owner, source.repositoryName, commit, repositoryPath);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, content, { flag: "wx", mode: entry.mode === "100755" ? 0o755 : 0o644 });
        }));
        const failed = downloads.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) throw failed.reason;
        const skillText = await fs.readFile(path.join(sourceDirectory, "SKILL.md"), "utf8");
        const name = validateSkillDocument(skillText);
        const directory = path.join(stagingRoot, name);
        await fs.rename(sourceDirectory, directory);
        const manifest = await createFileManifest(directory);
        return {
            name,
            directory,
            manifest,
            origin: {
                type: "github",
                repository,
                source: source.source,
                url: `https://github.com/${repository}/tree/${encodeURIComponent(ref)}${skillRoot ? `/${skillRoot.split("/").map(encodeURIComponent).join("/")}` : ""}`,
                ref,
                path: skillRoot,
                commit,
            },
        };
    } catch (error) {
        await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}

export async function readGitHubSkillSources(filePath: string): Promise<GitHubSkillSources> {
    let raw: string;
    try {
        const entry = await fs.lstat(filePath);
        if (entry.isSymbolicLink() || !entry.isFile()) throw new GitHubSkillError("Skill 来源清单路径不安全", 409);
        raw = await fs.readFile(filePath, "utf8");
    } catch (error) {
        if (nodeErrorCode(error) === "ENOENT") return {};
        throw error;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid sources");
        const sources = parsed as Record<string, unknown>;
        if (Object.entries(sources).some(([name, record]) => !validSourceRecord(name, record))) throw new Error("invalid sources");
        return sources as GitHubSkillSources;
    } catch {
        throw new GitHubSkillError("Skill 来源清单已损坏，请检查本地文件", 409);
    }
}

export async function writeGitHubSkillSources(filePath: string, sources: GitHubSkillSources) {
    try {
        const entry = await fs.lstat(filePath);
        if (entry.isSymbolicLink() || !entry.isFile()) throw new GitHubSkillError("Skill 来源清单路径不安全", 409);
    } catch (error) {
        if (nodeErrorCode(error) !== "ENOENT") throw error;
    }
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, `${JSON.stringify(sources, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await fs.rename(temporary, filePath);
    } finally {
        await fs.unlink(temporary).catch((error) => {
            if (nodeErrorCode(error) !== "ENOENT") throw error;
        });
    }
}

export async function createFileManifest(directory: string) {
    const manifest: Record<string, string> = {};
    await collectManifest(directory, "", manifest);
    return manifest;
}

export function manifestRevision(manifest: Record<string, string>) {
    const hash = crypto.createHash("sha256");
    for (const [file, digest] of Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))) hash.update(file).update("\0").update(digest).update("\0");
    return hash.digest("hex");
}

function parseGitHubSource(value: unknown): ParsedSource {
    const input = typeof value === "string" ? value.trim() : "";
    if (!input) throw new GitHubSkillError("请输入 GitHub 仓库或 Skill 目录地址", 400);
    const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(input);
    if (shorthand) return parsedSource(shorthand[1], shorthand[2], input);
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new GitHubSkillError("GitHub 地址格式无效", 400);
    }
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) throw new GitHubSkillError("仅支持 github.com 的 HTTPS 地址", 400);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment);
    const [owner, repositoryValue, kind, ref, ...rest] = segments;
    const repositoryName = repositoryValue?.replace(/\.git$/, "");
    if (!owner || !repositoryName) throw new GitHubSkillError("GitHub 地址缺少仓库信息", 400);
    if (!kind) return parsedSource(owner, repositoryName, input);
    if ((kind !== "tree" && kind !== "blob") || !ref) throw new GitHubSkillError("请使用 GitHub 仓库或 Skill 目录链接", 400);
    const sourcePath = kind === "blob" && rest.at(-1)?.toLowerCase() === "skill.md" ? rest.slice(0, -1).join("/") : rest.join("/");
    return parsedSource(owner, repositoryName, input, ref, sourcePath);
}

function parsedSource(owner: string, repositoryName: string, source: string, ref?: string, sourcePath?: string): ParsedSource {
    if (![owner, repositoryName].every((value) => /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..")) throw new GitHubSkillError("GitHub 仓库信息无效", 400);
    return { owner, repositoryName, source, ...(ref ? { ref } : {}), ...(sourcePath ? { sourcePath } : {}) };
}

function normalizeSourcePath(value?: string) {
    if (!value) return "";
    const normalized = value.replace(/^\/+|\/+$/g, "");
    assertSafeRelativePath(normalized);
    return normalized;
}

function isSkillFile(value: string | undefined, sourcePath: string) {
    if (!value || path.posix.basename(value) !== "SKILL.md") return false;
    return !sourcePath || insidePosix(sourcePath, value);
}

function selectSkillFile(entries: GitHubTreeEntry[], sourcePath: string) {
    const directSkill = sourcePath ? `${sourcePath}/SKILL.md` : "SKILL.md";
    const skillFiles = entries.filter((entry) => entry.type === "blob" && isSkillFile(entry.path, sourcePath));
    if (skillFiles.some((entry) => entry.path === directSkill)) return directSkill;
    if (!skillFiles.length) throw new GitHubSkillError("指定位置没有找到 SKILL.md", 404);
    if (skillFiles.length > 1) throw new GitHubSkillError("指定位置包含多个 Skill，请提供具体的 Skill 目录链接", 409);
    return skillFiles[0].path || "";
}

function insidePosix(parent: string, child: string) {
    return !parent || child === parent || child.startsWith(`${parent}/`);
}

function relativeRepositoryPath(root: string, file: string) {
    const relative = root ? path.posix.relative(root, file) : file;
    assertSafeRelativePath(relative);
    return relative;
}

function assertSafeRelativePath(value: string) {
    if (!value || value.startsWith("/") || value.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")) {
        throw new GitHubSkillError("GitHub Skill 中包含不安全的文件路径", 400);
    }
}

function validateSkillDocument(raw: string) {
    let parsed: matter.GrayMatterFile<string>;
    try {
        parsed = matter(raw);
    } catch {
        throw new GitHubSkillError("SKILL.md frontmatter 格式无效", 409);
    }
    const name = typeof parsed.data?.name === "string" ? parsed.data.name : "";
    const description = typeof parsed.data?.description === "string" ? parsed.data.description.trim() : "";
    if (!name || name.length > 64 || !NAME_PATTERN.test(name)) throw new GitHubSkillError("SKILL.md 中的 name 无效", 409);
    if (!description) throw new GitHubSkillError("SKILL.md 缺少 description", 409);
    if (!parsed.content.trim()) throw new GitHubSkillError("SKILL.md 正文不能为空", 409);
    return name;
}

function validSourceRecord(name: string, value: unknown): value is GitHubSkillRecord {
    if (!NAME_PATTERN.test(name) || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (record.type !== "github" || !["repository", "source", "url", "ref", "path", "commit"].every((key) => typeof record[key] === "string")) return false;
    if (!record.manifest || typeof record.manifest !== "object" || Array.isArray(record.manifest)) return false;
    return Object.entries(record.manifest as Record<string, unknown>).every(([file, hash]) => {
        try {
            assertSafeRelativePath(file);
            return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash);
        } catch {
            return false;
        }
    });
}

async function collectManifest(directory: string, relativeDirectory: string, manifest: Record<string, string>): Promise<void> {
    const entries = await fs.readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        const filePath = path.join(directory, ...relativePath.split("/"));
        const metadata = await fs.lstat(filePath);
        if (metadata.isSymbolicLink()) throw new GitHubSkillError("Skill 目录包含符号链接，无法安全处理", 400);
        if (metadata.isDirectory()) await collectManifest(directory, relativePath, manifest);
        else if (metadata.isFile()) manifest[relativePath] = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
        else throw new GitHubSkillError("Skill 目录包含不支持的文件类型", 400);
    }
}

async function githubJson<T>(apiPath: string): Promise<T> {
    const response = await fetch(`https://api.github.com${apiPath}`, { headers: { accept: "application/vnd.github+json", "user-agent": "infinite-canvas-agent" } });
    if (!response.ok) throw githubResponseError(response.status);
    return await response.json() as T;
}

async function githubRaw(owner: string, repository: string, commit: string, filePath: string) {
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${commit}/${encodedPath}`);
    if (!response.ok) throw githubResponseError(response.status);
    return Buffer.from(await response.arrayBuffer());
}

function githubResponseError(status: number) {
    if (status === 404) return new GitHubSkillError("找不到 GitHub 仓库、分支或目录", 404);
    if (status === 403 || status === 429) return new GitHubSkillError("GitHub 请求受限，请稍后重试", 409);
    return new GitHubSkillError(`读取 GitHub 失败（${status}）`, 409);
}

function decodeSegment(value: string) {
    try {
        return decodeURIComponent(value);
    } catch {
        throw new GitHubSkillError("GitHub 地址格式无效", 400);
    }
}

function nodeErrorCode(error: unknown) {
    return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}
