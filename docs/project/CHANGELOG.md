# 晨亿达ERP变更日志

本文件记录可审计的项目变化。每个任务提交前必须增加一条记录，包含 Git Commit、功能、数据库、API 和文档影响。当前提交无法在自身内容中稳定写入自身哈希，因此使用“任务编号 + 提交消息”作为本条标识，实际哈希以 `git log` 为准。

## 2026-07-12

### PHASE1-TASK03 - `feat: add material category and attribute templates`

- Git Commit：本任务功能独立提交，实际哈希以根仓库 `git log -1` 为准；前置设计提交为 `ebef667`。
- 新增功能：新增 `material-category-v1` TypeScript 声明数据和 test/local 专用 seed 执行器，输出分类、属性、绑定的插入/更新统计。
- 修改功能：无现有业务功能变化；不接入 AI、Excel、真实物料、BOM、采购、库存或生产。
- Bug 修复：无。
- 数据库变化：无 schema 或 migration 变化；seed 可向已迁移的隔离 D1 幂等写入 101 个分类、34 个属性定义和 228 条四级叶子显式绑定，使用本地 D1 原子 batch。
- API 变化：无。
- 文档变化：新增分类标准 V1 与设计规格；D-009 明确模板复制而非父子继承；同步更新项目状态文档。
- 验证：seed 声明、父子层级、关键必填模板、幂等、环境拒绝和原 migration 测试通过；未连接生产 D1。

### PHASE1-TASK02 - `feat: implement material master v2 schema`

- Git Commit：本任务独立提交，实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无业务功能；新增 Material Master V2 数据契约与可回滚迁移框架。
- 修改功能：无；现有 API、页面、BOM、采购、库存和 legacy SQLite 不变。
- Bug 修复：无。
- 数据库变化：新增 12 张在线 D1 V2 表的 Drizzle schema、`0001` Up、Down、快照、约束与索引；正式编码仅允许审核后生命周期，供应商映射唯一身份包含 supplier/code/manufacturer/mpn/revision 与有效期。
- API 变化：无。
- 文档变化：更新设计基线和项目状态，新增 `docs/audits/phase1-task02-schema-report.md`。
- 验证：本机一次性 D1 完成空库 Up、防重、结构/约束、Down 和重建；完整基线结果见审计报告。未连接生产 D1。

## 2026-07-11

### PHASE1-TASK01 设计评审 - `docs: design material master v2 data model`

- Git Commit：设计评审独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无；当前只完成设计。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无；仅设计 11 张在线 D1 V2 关系表、约束、索引和 Up/Down 迁移顺序，未创建数据库对象。
- API 变化：无。
- 文档变化：新增 `docs/material-master/database-model-v2.md`，包含 ER 图、字段说明、`legacy_material_mapping`、来源追踪、迁移/回滚方案、测试矩阵、AI 接入边界和风险；记录在线 D1 唯一目标及动态属性决策。
- 验证：文档占位符、内部一致性、11/11 表级 `created_at` 覆盖和 `git diff --check` 通过；Site lint 0 错误/1 个既有警告、构建与 Node 测试 8/8、凭证检查通过；本地 ERP 自测、烟测和上线检查在一次性临时 SQLite 中通过且目录已清理。等待人工设计审批。

### PHASE0-TASK02 - `security: establish environment isolation baseline`

- Git Commit：本任务独立提交，完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：统一 development/test/production 环境清单；本机一次性 Miniflare D1 烟测运行器；生产/公开 URL/非临时路径拒绝；凭证扫描；本地 SQLite 环境与备份恢复测试。
- 修改功能：仅修改开发与测试配置；Site 本地 Cloudflare 绑定关闭远程资源，烟测数据采用 `TEST-` 标识并自动销毁；本地数据目录支持环境覆盖以隔离测试。
- Bug 修复：本地烟测备份不再写入正式数据目录；在线写入型烟测不能再直接指向任意远程 URL。
- 数据库变化：无 schema 或迁移变化；未创建云端 D1，未连接或修改生产 D1。
- API 变化：无业务 API 新增、删除或行为修改；备份/恢复只在一次性测试数据库验证。
- 文档变化：新增测试环境说明、安全隔离审计和设计规格；更新 README、MASTER、TASKS、PROJECT_CONTEXT、ARCHITECTURE、DECISIONS、STATUS。
- 验证：Site lint、build、Node 测试、一次性 D1 API 烟测、凭证扫描及本地 ERP 自测/烟测/上线检查/备份恢复均通过。

### PHASE0-TASK01-B - `fix: convert site gitlink to tracked source`

- Git Commit：本任务独立合并提交；第一父提交为任务开始时根仓库 `a1a8d6a`，第二父提交为 Site 开发基线 `9f2c2dc`；完成后实际哈希以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：移除无 `.gitmodules`、无可用远端的 Site gitlink；把原 Site tree 的 77 个文件按普通文件纳入根仓库，使新克隆可恢复完整源码。
- 数据库变化：无；未修改 schema、迁移或生产 D1。
- API 变化：无。
- 文档变化：更新根 README、项目总控、状态、任务、架构、上下文和决策记录；新增 `docs/audits/phase0-task01-source-management-report.md`。
- 版本关系：生产 Site `2b4f178`；纳管前开发 Site `9f2c2dc`；两者运行时代码一致，且 `2b4f178` 是 `9f2c2dc` 的祖先。

### PM-000 - `docs: establish project operating system`

- Git Commit：本任务独立提交，完成后以根仓库 `git log -1` 为准。
- 新增功能：无。
- 修改功能：无。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：新增 `docs/project/` 项目管理体系；更新 `AGENTS.md` 的文档驱动开发流程；纳入现有技术审计和物料 V2 准备文档作为上下文基线。

### `bbefb2e` - `feat: add chenyida erp site project files`

- 新增功能：根仓库记录在线 Site 项目入口。
- 修改功能：无本次重新审计的业务行为变化。
- Bug 修复：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：无。
- 已知问题：该入口为无 `.gitmodules` 的 gitlink，新克隆不可恢复完整 Site 源码。

### `3e45f05` - `Document online ERP architecture`

- 新增功能：无。
- 修改功能：无。
- 数据库变化：无。
- API 变化：无。
- 文档变化：记录在线 ERP 架构。

## 历史基线

下列提交已存在于根仓库历史。本次只建立索引，不重新解释未审计的每一行变化：

| Commit | 提交消息 | 主要类别 |
| --- | --- | --- |
| `7654d45` | `Add quotation workflow` | 功能 |
| `42bdd8c` | `Add customer and supplier master data` | 功能 |
| `1255f6f` | `Add inventory count adjustments` | 功能 |
| `a58c20d` | `Add finance settlement module` | 功能 |
| `07562bc` | `Add go-live operations package` | 功能/运维 |
| `8d0138b` | `Add ERP login and operations controls` | 功能/安全 |
| `7748ade` | `Merge remote-tracking branch 'origin/main'` | Git 历史 |
| `f189de9` | `Initial ChenYida ERP system` | 初始系统 |
| `a4b63b3` | `Initial commit` | 初始化 |

## 记录模板

```text
### TASK-ID - `type: commit message`
- Git Commit：提交后以 git log 为准
- 新增功能：
- 修改功能：
- Bug 修复：
- 数据库变化：
- API 变化：
- 文档变化：
```
