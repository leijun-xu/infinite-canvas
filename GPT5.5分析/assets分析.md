# `assets` 目录分析

## 一句话理解

根目录的 `assets/` 是仓库说明文档使用的图片资源目录，目前主要保存 README 中赞助商和合作方的 Logo。

它不是主前端 `web/` 的公共资源目录，也不是文档站 `docs/` 的公共资源目录。

## 当前文件

```text
assets/
├── 88api.png
├── apimart.png
├── atlascloud.svg
├── heyroute.svg
├── infistar.png
├── metaso.jpg
└── packycode.png
```

这些文件当前都被根目录 `README.md` 的赞助商表格引用。

## 它与其他资源目录的区别

项目中存在多个看起来相似的资源目录：

| 目录 | 用途 |
| --- | --- |
| 根目录 `assets/` | 根 README、仓库页面等使用 |
| `web/public/` | 主应用可通过 URL 直接访问的静态文件 |
| `docs/public/` | 文档站可通过 URL 直接访问的静态文件 |
| `plugins/infinite-canvas/assets/` | Codex / ZCode 插件资源 |

它们不会自动互相共享。

例如：

```markdown
![Logo](assets/apimart.png)
```

在根 README 中可以工作，因为路径相对于 README。

但在主应用代码中访问：

```text
/assets/apimart.png
```

通常不会自动指向仓库根目录的这个文件。主应用运行时的静态资源应放在 `web/public/` 或通过源码 import。

## 为什么有多种图片格式

当前包含：

- PNG：适合带透明背景的 Logo 或位图。
- JPG：适合照片或不需要透明背景的图片。
- SVG：矢量图，缩放时保持清晰，适合 Logo。

选择原则：

- 能拿到可信 SVG 时，Logo 优先使用 SVG。
- 只有位图源文件时使用 PNG/JPG。
- 不要为了统一格式反复转码，转码可能增加体积或降低质量。

## README 如何使用这些资源

根 `README.md` 使用 HTML 表格和 `<img>` 标签控制尺寸，例如：

```html
<img src="assets/apimart.png" width="163" alt="APIMart">
```

相比普通 Markdown 图片语法，HTML 可以控制：

- 宽度或高度。
- 表格对齐。
- 链接。
- `alt` 文本。

## 修改资源时要同步检查什么

### 替换同名文件

如果文件名不变，README 通常不需要修改，但要检查：

- 新图是否有透明背景。
- 宽高比例是否变化。
- README 中固定宽度或高度是否仍合适。
- GitHub 是否能正确显示 SVG。

### 修改文件名

必须同步搜索引用：

```bash
rg "assets/旧文件名" .
```

否则 README 会出现破图。

### 删除文件

删除前先确认没有任何 Markdown、HTML、文档或配置引用。

### 新增赞助商资源

通常需要同时：

1. 添加图片文件。
2. 在根 README 赞助商表格中新增一行。
3. 设置明确的 `alt` 文本。
4. 检查图片尺寸是否与其他 Logo 协调。

## 文件命名建议

当前文件以品牌英文名命名，适合继续沿用：

- 使用小写。
- 多个单词使用短横线。
- 保留正确扩展名。
- 不使用空格。
- 不使用“图片1”“新logo”等无意义名称。

例如：

```text
example-cloud.svg
example-api.png
```

## 图片体积

README 图片会在用户打开 GitHub 仓库首页时加载。

资源过大会导致：

- README 加载慢。
- 移动网络流量增加。
- 仓库体积持续膨胀。

新增或替换图片时应：

- 使用接近实际展示尺寸的位图。
- 在不明显损失质量的前提下压缩 PNG/JPG。
- 清理 SVG 中无用编辑器元数据。
- 避免提交几 MB 的原始设计稿。

## 安全注意事项

SVG 本质上是 XML 文档，理论上可以包含脚本、外链或复杂嵌入内容。

引入第三方 SVG 前应检查：

- 是否包含 `<script>`。
- 是否引用未知外部资源。
- 是否有不必要的 `foreignObject`。
- 是否包含大段隐藏内容或追踪代码。

不要把来源不明的 SVG 直接加入仓库。

## 这个目录是否参与构建

当前根 `Dockerfile` 只复制：

- `web/`
- 根目录 `VERSION`
- 根目录 `CHANGELOG.md`

它不会把根 `assets/` 复制进主应用镜像。

因此这个目录当前主要服务仓库文档，而不是 Docker 中运行的网站。

## 常见需求应该去哪里改

| 需求 | 处理方式 |
| --- | --- |
| 替换 README 赞助商 Logo | 替换对应文件并检查 README 尺寸 |
| 新增 README 图片 | 添加文件并在根 README 中引用 |
| 给主应用增加静态图 | 使用 `web/public/`，不要放这里 |
| 给文档站增加静态图 | 使用 `docs/public/` 或文档内容约定目录 |
| 给 Codex 插件换图标 | 修改 `plugins/infinite-canvas/assets/` |

## 小白推荐检查方法

修改后可以直接在 IDE 中预览 README，重点看：

- 图片是否能显示。
- Logo 是否被拉伸。
- 表格是否对齐。
- 深色 GitHub 主题下是否看得清。
- `alt` 是否准确。

项目规则说明普通代码修改后不需要执行构建；这个目录也不需要单独构建。

## 容易踩坑的地方

- 不要认为根 `assets/` 会自动发布到主应用。
- 不要只改文件名而忘记改 README 引用。
- 不要提交体积很大的原图。
- 不要把不可信 SVG 直接放进仓库。
- 不要删除看似“代码没引用”的图片而忽略 Markdown 和 HTML 引用。
- 图片比例变化后，要重新检查 README 中固定的 `width` 或 `height`。

