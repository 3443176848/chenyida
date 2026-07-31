# SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-FIX-06

## 任务状态

`SCHEMA CHANGE REQUIRED — UAT PACKAGE UNCHANGED`

- 日期：2026-07-31（Asia/Shanghai）
- 执行分支：B
- 起点：`main` / `525ad2907287d736ecd40d3df24b77c6c5be8ff4`
- 范围：只诊断 Planning Handoff 的需求单位解析缺口并形成正式 0036 方案；不实现、不部署、不创建真实 Planning Package、不继续角色试用。

## 严格起点门禁

| 项目 | 结果 |
| --- | --- |
| Git | `main`；HEAD `525ad2907287d736ecd40d3df24b77c6c5be8ff4`；`origin/main...HEAD` 为 behind 0 / ahead 106；tracked/untracked clean |
| 源码 | `0.1.0-alpha.36`；migration 文件 35 个，head `0035_bom_material_governance.sql` |
| 常驻运行面 | 数据库 migration 34 个，head `0034_supplier_receipt_lot_iqc.sql`；Web 镜像 `sha256:7e0a3040acd17277db49fc1b7541c072c566e95e12b70bce9170dd39165a6bde` |
| 公网入口 | `https://43.135.148.43.nip.io:18888`；匿名 HEAD 为 200，既有 TLS/安全缓存头保持 |
| 并发与资源 | 只有常驻 Web/PostgreSQL/Worker/Caddy，无未知 build/test/migration 容器；四服务 RestartCount 0、OOM false；门禁时 available memory 约 2.3 GiB、Swap 约 223 MiB、根盘可用约 28 GiB，未触发停止阈值 |
| 工作边界 | 未读取或修改 `shujvbiao/`；未输出 env、连接串、密码、Cookie、Token、Session 摘要或凭据文件内容 |

开始前已完整阅读根 `AGENTS.md`、`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`，以及 Project、Planning Handoff、Product/BOM 和最近 UAT 修复的任务、完成报告、交接规格与 D-058/D-059 等相关决定。

## 主 UAT 只读事实

以下事实只通过只读查询核验，本任务没有写入：

| 对象 | 当前事实 |
| --- | --- |
| Project | `PRJ-00000001`，ACCEPTED，当前需求版本 1，项目 version 3 |
| Requirement Item | 稳定 ID 1，line 1，数量 `10.000000`，`unit_id=NULL`，`unit_pending=true` |
| enabled Unit | 稳定 ID 1，代码 `PCS`，中文名 `件`，enabled=true；它只是可选候选，本任务没有把它提交到主 UAT |
| Product Resolution | `project_requirement_resolutions.id=1`，稳定引用 Product/Product Version/BOM Header/BOM Version `7/7/7/7` |
| Product/BOM | `UAT-BB-PROD-042576` / A0 / RELEASED；`BOM-UAT-BB-PROD-042576-V1` / V1 / RELEASED |
| BOM Lines | 533/PCB、534/SENSOR、535/CONN、536/METAL；每行 `1.000000 PCS`，loss rate 0 |
| Planning | Resolution/Package/Package Item/Handoff Event 为 `1/0/0/0`；待接收为 0。这里的 1 只是 Product/BOM Resolution，不含需求单位 |
| 失败证据 | 请求号 `66aa0cb1-da24-42c5-9453-a3a1a0e65929`、`1bb77ba4-55ea-4cce-b36c-639282c7748b`、`b429d73c-c8b1-423c-8cbb-0499ebafca6e` 均保持 failed / `REQUIREMENT_ITEMS_UNRESOLVED` |
| 保护指纹 | 诊断前后综合指纹均为 `b239c62091cf51de8fa5b3ff6fb6521a`；范围含当前需求、Product/BOM Resolution、已发布 Product/BOM 与四行、Planning Package/Item/Event 和三条指定失败记录 |

## 精确根因

1. `0015_market_project_handoff.sql` 和 `db/schema.ts` 允许 Requirement Item 二选一：`unit_pending=true` 时 `unit_id` 必须为 NULL，`unit_pending=false` 时 `unit_id` 必须非 NULL。当前 UAT 行正处于前一种合法但未解析状态。
2. 同一 0015 migration 给 `project_requirement_versions` 和 `project_requirement_items` 安装了只允许 INSERT 的不可变触发器。已提交的销售需求版本正文不能原地更新；直接把 `unit_id=1`、`unit_pending=false` 写回源行会破坏既有不可变边界。
3. 0016/0034 的 `project_requirement_resolutions` 只有 Product、Product Version、BOM Header、BOM Version 及操作者/请求号，没有 `unit_id`、单位 Resolution 版本或独立 CAS 字段。当前“保存解析”的 DTO、白名单和 upsert 因此只保存 Product/BOM 稳定 ID。
4. 快照生成先统计当前需求行，再用 `project_requirement_items.unit_id` 对 enabled `units` 做 INNER JOIN。`unit_id=NULL` 的行被查询静默排除；结果数少于需求数后统一抛出 `REQUIREMENT_ITEMS_UNRESOLVED`，错误消息又只指向 Product/BOM，掩盖了真正缺失的单位。
5. `project_planning_package_items.unit_id` 是必填稳定外键，当前生成代码只能从源 `project_requirement_items.unit_id` 复制。0034 没有另一个合规来源可供快照引用。
6. 当前 Planning UI 对 pending 单位只显示“单位待确认”，没有 enabled Unit 候选或单位提交字段；保存按钮只提交 Product/BOM，生成按钮也没有按单位/Product/BOM 分项展示并阻止未完成集合。
7. 现有 PostgreSQL Planning 测试夹具把需求行固定为 `unit_pending=false` + PCS，因而没有覆盖 pending 单位路径。

这不是 PCS 候选缺失，也不是 Product/BOM Resolution 丢失；它是“销售需求单位事实不可变”与“工程单位解析没有独立持久化模型”之间的数据边界缺口。

## 分支 B 判定

0034 没有合规持久化位置，而补全源需求行会违反已提交需求版本不可变性。因此：

- 不修改 0035，也不创建 0036 文件。
- 不修改服务端、UI 或测试来伪装兼容热修。
- 不更新 `project_requirement_items`，不把 PCS 写入任何主 UAT 业务表。
- 不从 BOM 行、名称、产品类型或历史数据推断需求单位。
- 不用 JSON、备注、名称映射或隐藏字段保存单位。
- 不放宽生成快照的完整性门禁，不替换统一错误码后声称问题已修复。
- 不 build、backup、restore、deploy、restart 或升级数据库；常驻 Web/PostgreSQL/Worker/Caddy 保持原样。

## 建议的 0036 关系模型

0036 必须作为后续独立授权任务，以扩展、回填、切换、收缩四步法实施；本任务只记录方案，不创建 migration。

### 1. 追加式 Unit Resolution 版本事实

建议新增 `project_requirement_unit_resolution_versions`：

| 字段 | 约束/语义 |
| --- | --- |
| `id` | bigserial PK；稳定 Unit Resolution ID |
| `project_id` | NOT NULL FK → `business_projects.id` |
| `requirement_version_id` | NOT NULL FK → `project_requirement_versions.id` |
| `requirement_item_id` | NOT NULL FK → `project_requirement_items.id` |
| `resolution_version_no` | integer > 0；同一 Requirement Item 单调递增 |
| `unit_id` | NOT NULL FK → `units.id`；只保存稳定 Unit ID |
| `supersedes_resolution_id` | nullable self FK；新版本明确指向被替代版本 |
| `resolved_by` | NOT NULL FK → `app_users.username` |
| `resolved_at` | NOT NULL timestamptz，默认当前时间 |
| `request_id` | NOT NULL uuid；关联请求与审计 |
| `content_digest` | 64 位十六进制摘要；覆盖项目、需求版本/行、单位、版本和前序 Resolution |

约束和索引至少包括：

- `UNIQUE(requirement_item_id, resolution_version_no)`。
- `UNIQUE(project_id, requirement_version_id, requirement_item_id, resolution_version_no)`。
- `(project_id, requirement_version_id, requirement_item_id)` 查询索引、`unit_id` 索引、`request_id` 索引。
- 为 `project_requirement_versions(id, project_id)` 与 `project_requirement_items(id, requirement_version_id)` 建立可引用唯一键，并用复合外键证明 Resolution 的 project/version/item 属于同一链，不能只靠四个彼此独立的 FK。
- 版本事实只允许 Service Guard 下 INSERT；UPDATE/DELETE 一律拒绝，保留历史审计链。

### 2. 独立 CAS Head

建议新增 `project_requirement_unit_resolution_heads`：

| 字段 | 约束/语义 |
| --- | --- |
| `requirement_item_id` | PK，且与 project/version 形成复合归属校验 |
| `project_id` / `requirement_version_id` | NOT NULL，复合 FK 保证同一需求链 |
| `current_resolution_id` | NOT NULL UNIQUE FK → 版本事实，且必须属于同一 Requirement Item |
| `version` | integer > 0；独立于 `business_projects.version` 的真实 CAS 版本 |
| `updated_at` | NOT NULL timestamptz |

保存时锁定 Requirement Item、当前 Head 和候选 Unit，以 `WHERE version = expected_unit_resolution_version` 更新 Head 并递增版本。首次确认用显式 expected version 0/不存在语义竞争创建；并发只允许一个事务成功，另一个返回 `REQUIREMENT_UNIT_RESOLUTION_VERSION_CONFLICT`。不能继续复用当前“检查 project.version 但不递增”的伪 CAS。

### 3. Unit 有效性与生命周期

- 保存和生成快照时都必须在事务中锁定并校验 `units.id` 存在且 `enabled=true`。
- 空值返回 `REQUIREMENT_UNIT_UNRESOLVED`；未知 ID 返回 `REQUIREMENT_UNIT_INVALID`；停用 Unit 返回 `REQUIREMENT_UNIT_DISABLED`。
- Unit 后续停用不能删除历史 Resolution；它应使新的保存/快照 fail closed，历史事实仍可审计。
- 不允许把 BOM Line 的 Unit 当作 Requirement Unit。BOM Line Unit 表示组件耗用单位，Requirement Unit 表示客户/项目需求数量单位，语义不同。

### 4. Product/BOM Resolution 与原子保存

现有 `project_requirement_resolutions.id=1` 继续作为 Product/BOM Resolution 的稳定 ID，不回填或推断单位。后续 API 可以扩展当前保存命令，但一个 Requirement Item 的提交正文必须同时携带：

- `requirement_item_id`
- `unit_id`
- `expected_unit_resolution_version`
- `product_id`
- `product_version_id`
- `bom_header_id`
- `bom_version_id`

服务端应只允许保存完整解析集合，或为每条缺失字段返回明确清单；Unit Resolution 版本/Head、Product/BOM Resolution、幂等结果和审计必须在同一事务提交。任一点故障都应回滚到零半记录。

### 5. 快照来源与可追溯性

- 新生成的 `project_planning_package_items.unit_id` 必须来自当前 Unit Resolution 版本的 `unit_id`，而不是源需求行或 BOM。
- 建议 0036 对 `project_planning_package_items` 扩展 nullable `unit_resolution_id` FK，以记录本次快照使用的稳定解析事实；对 0036 后新包由服务端强制非 NULL。
- 既有 Package Item 不能通过猜测回填。若全库已有历史包，扩展阶段保持 nullable，并以审阅过的真实来源决定是否另行回填；本 UAT 项目 Package 为 0。
- package digest/source digest 必须纳入 `unit_resolution_id` 和 Unit ID，保证修订后生成新 Package 版本而非改写旧快照。

## API、安全和审计边界

后续实现至少必须满足：

- 只有 engineering/project owner 且具备 `planning.prepare` 的服务端身份可确认单位；planning、sales 和无关角色返回 403。
- 写请求必须 POST、严格可信 Origin、Cookie/Header CSRF 双提交、显式 `Idempotency-Key`、canonical body digest 和 `expected_unit_resolution_version`。
- 幂等键同正文重放返回同一结果；异正文返回稳定冲突；幂等记录、Unit Resolution、Head CAS、Product/BOM Resolution 与 Audit 同事务。
- Audit 记录操作者、动作、Requirement Item/Unit Resolution 稳定 ID、old/new version、结果和 request_id，不记录 Token、Cookie 或敏感正文。
- 未生成包时可解析；已有非 RETURNED Package 后禁止改写该版本所依据的解析。RETURNED 后以新 Unit Resolution 版本和新 Package 版本修订，旧事实不可变。
- 服务端异常保持中文稳定错误和 request_id；SQL、堆栈、连接信息不返回浏览器。

## UI 与错误合同（后续 0036 实现验收）

- `unit_pending=true` 且没有 Unit Resolution 时显示 enabled Unit 选择器，选项为“中文名称（代码）”，值只用 Unit ID。
- 每条需求分别显示单位完成状态、Product/BOM 完成状态和当前缺失项；多行不能用全局含糊状态替代。
- 未完整时“保存解析”列明缺失字段或保持禁用；“生成交接包”必须禁用。
- 保存并刷新后显示来自 Unit Resolution 的 `件（PCS）`，源 `unit_pending=true` 仍是不可变历史事实，不应伪装成已被修改。
- 约 390px 视口不得出现页面级横向溢出。
- 生成接口至少拆分 `REQUIREMENT_UNIT_UNRESOLVED` 与 `REQUIREMENT_PRODUCT_BOM_UNRESOLVED`，并返回具体 Requirement Item/line；无效与停用 Unit 使用上述独立稳定码。

## 0034 → 0035 → 0036 独立升级风险

1. 源码 head 已是 0035，常驻数据库仍是 0034。未来只能按 0034→0035→0036 顺序在隔离副本验证，不能跳号、修改已提交 0035 或把 0036 偷塞进 alpha.34 hotfix。
2. 0035 包含 BOM Material Governance 新表和约束；其资源、锁时长、恢复与应用责任必须与 0036 一起做真实 0034 快照的只读试迁移，但两者的业务切换和验收应能独立定位失败。
3. 不自动为现有 `unit_pending=true` 行创建 PCS Resolution。迁移后这些行仍未解析，必须由 engineering 人工选择。
4. 不修改既有 Product/BOM Resolution，也不改变 RELEASED Product/BOM/Line。新关系通过稳定 ID 与现有 Resolution 并存。
5. 全库既有 Planning Package 的 Unit provenance 可能缺失；扩展列必须先 nullable，不能按 BOM/名称/产品类型回填。
6. 迁移必须覆盖空库 0001→0036、已有 0034→0035→0036、重复执行、事务失败回滚、FK/唯一/索引/触发器、行数/孤儿/摘要核对以及新迁移前后现有包不变。

## 后续独立任务的必测矩阵

以下均为 `REQUIRED / NOT RUN IN THIS BRANCH-B DIAGNOSIS`，不得把本轮静态核验写成通过：

- pending Unit 不能生成包；显式 enabled PCS 后可保存；空、未知、停用 Unit 拒绝；绝不从 BOM 推断。
- 多需求全部完成；Product/BOM 与 Unit Resolution 稳定 ID/归属一致。
- 幂等重放、异正文冲突、Unit Head CAS 冲突；并发确认只产生一个有效 Head/版本。
- Unit Resolution、Product/BOM Resolution、幂等和 Audit 的故障注入零半记录。
- planning、sales、无关角色 403；CSRF、未知/缺失 Origin 拒绝。
- 保存刷新后状态持久；390px 无页面级横向溢出。
- 合成完整旅程按需求 10 PCS × BOM 每行 1 PCS 生成 533—536 各 10 PCS 快照。
- 生成、提交、退回、修订、重提、planning 接收回归；RELEASED BOM 前后端仍完全不可修改。

所有写测试必须使用隔离 PostgreSQL 和合成数据。实现前不能在主 UAT 项目验证 PCS 保存或 Package 生成。

## 本轮执行与禁止事项结果

- 业务代码、Schema、migration、测试断言、部署配置修改：0。
- 主 UAT 数据写、engineering 单位提交、Planning Package、planning 登录/接收：0。
- Product/BOM/Material 修改或删除：0。
- 新建 0036、运行 0035/0036、数据库升级：0。
- build、备份、恢复、容器重建/重启：0；Branch B 不得制作部署前备份并借此暗示可部署。
- 本轮只允许形成这份诊断、项目索引更新和 proposed D-086；Planning 功能测试与隔离 PostgreSQL 写测试数量为 0，完整矩阵留给获授权的 0036 实现任务。

## 本轮非写验证与资源终态

- Python 文档基线：`server.py --self-test`、`smoke_test.py`、隔离临时 SQLite 的 `go_live_check.py --no-backup` 均通过；临时目录已精确删除。
- Planning Node unit/UI 合同：宿主没有 Node；使用当前 Web 镜像的断网、只读、384 MiB/1 CPU 临时容器尝试加载，但 Docker 侧不可见执行沙箱源码挂载，三次均在发现测试文件前退出，执行断言 0。临时容器均自动删除；不把环境失败写成通过，也不因此扩大到 build/安装依赖。
- PostgreSQL：没有启动隔离写测试库，数量 0；只读 UAT 综合指纹复核为 `b239c62091cf51de8fa5b3ff6fb6521a`，与起点一致。
- 文档与范围：`git diff --check` 通过；最终提交前仅七份项目/任务 Markdown 发生变化，业务代码、migration、部署配置为 0。
- 资源终态：available memory 约 2.3 GiB，Swap 约 222 MiB，根盘可用 28 GiB，Load `0.09/0.11/0.09`；Web/PostgreSQL healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false。
- 清理：任务 SQLite 目录和所有 `chenyida-planning-unit-schema-doccheck` 临时容器均不存在；四个受保护 ERP Volume 全部存在且未删除。

## 解除阻断条件

项目负责人需另行授权一个 Schema 任务，确认 D-086 的版本化 Unit Resolution/Head 方向及 package provenance 策略；随后才能创建 0036、实现服务/UI、运行隔离 PostgreSQL/浏览器验收、做 0034→0035→0036 备份恢复并决定部署。此前不具备重新开始 engineering 黑盒交接的条件。

最终状态：`SCHEMA CHANGE REQUIRED — UAT PACKAGE UNCHANGED`
