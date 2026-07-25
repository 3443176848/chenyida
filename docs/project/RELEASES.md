# 晨亿达 ERP 发布、迁移与回退追踪

最后核验：2026-07-25（Asia/Shanghai）
适用任务：`SELFHOST-PHASE2-TASK08`

## 1. 使用规则

1. 本文件同时追踪历史运行面、当前开发运行面和未来自托管发布，不能用“测试通过”替代“已部署”或“已批准”。
2. Git 提交、包版本、数据库 migration、测试、部署、数据迁移和批准状态必须分别记录；任一项未知时写 `UNKNOWN`，不得推断。
3. 生产发布必须新增一条不可改写的发布记录。更正历史记录时追加说明，不覆盖原始结论。
4. 发布提交不能在自身内容中稳定记录自身哈希；记录使用功能基线提交，并通过 `git log -1 -- docs/project/RELEASES.md` 解析发布记录提交。
5. 本文件不授权生产访问、migration、部署、数据迁移或流量切换。

状态词：`HISTORICAL`（历史记录）、`DEVELOPMENT`（开发运行）、`NOT_RELEASED`（尚未发布）、`DEPLOYED`（已部署）、`MIGRATED`（真实数据已迁移）、`APPROVED`（已批准）。

## 2. 当前运行面与版本定义

| 运行面 | 版本/标识 | Git 基线 | 数据库基线 | 测试状态 | 部署状态 | 真实数据迁移 | 回退基线 | 批准状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 历史 OpenAI Sites / Cloudflare D1 | 历史记录 `v3` | `2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12`；后续纳管来源 `9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9` | 仓库 D1/Drizzle `0000`—`0008`；生产实际已应用版本本任务未访问、未核验 | 仅保留历史验收记录；本任务未访问公开 Site | `HISTORICAL`；文档曾记录为公开 `v3`，本任务不重新确认在线状态；不是未来生产权威方向 | 未向 PostgreSQL 迁移 | 历史提交 `2b4f178` 和 D1 migration/快照仅作迁移与行为证据；不是已验证的当前回退方案 | 历史状态；无新的部署批准 |
| 当前 Python / SQLite 开发运行面 | `legacy-development`，尚无统一 SemVer | 当前仓库包含源代码的功能基线 `39946f6b854a985b5c19106eaa6c938bddaf9c7c`；常驻进程未记录启动 commit，不能反推为该提交 | 本地 SQLite 历史 26 表 + migration `0001`—`0004`；开发库只读核验已记录四个版本 | 本任务按发布基线重新执行 Python self-test、smoke 和临时库 go-live；结果见第 6 节 | `DEVELOPMENT`；systemd `enabled/active`，源码与已安装 unit 一致，Python 监听 `0.0.0.0:18888`；不是正式生产投用 | 不适用；该 SQLite 是旧数据来源和当前开发运行数据 | Git 源码 + 执行前 SQLite 可恢复快照；正式回退点尚未建立 | 仅开发常驻；未获生产批准 |
| Node.js / PostgreSQL 自托管开发基线 | `0.1.0-alpha.8`；包名 `chenyida-erp-selfhosted` | TASK08 起始基线 `0ad0687a7b2f2502f68babbef1455df2a983421b`；功能提交通过 `git log -1 -- docs/tasks/SELFHOST-PHASE2-TASK08-completion.md` 解析 | PostgreSQL migration `0001`—`0012` | TASK08 unit/UI/PostgreSQL/migration/Compose restart 与适用 Identity/Master Data/Inventory/Procurement/Production/Sales/Phase0/Python 回归通过 | `NOT_RELEASED`；没有运行中的 Compose 项目，未生产部署 | SQLite/D1 真实数据、真实用户、主数据、库存、采购、生产、销售和品质数据均未迁入 PostgreSQL | 未部署版本无线上回退动作；未来部署前必须以现运行面、Git commit、数据库快照和文件快照建立恢复点 | 非生产开发版本，未获发布批准 |
| 自托管生产版本 | 尚不存在 | `N/A` | `N/A` | `N/A` | `NOT_RELEASED` | `NOT_MIGRATED` | `NOT_ESTABLISHED` | `NOT_APPROVED` |

`0.1.0-alpha.8` 只表示加入非生产 IQC/IPQC/FQC、缺陷、受控生命周期及 FQC 发货门禁的自托管开发基线，不表示生产候选、生产上线、真实数据迁移完成或完整业务迁移完成。当前自托管 API 已覆盖身份/用户/系统审计、Material/Import、主数据/BOM、通用库存、采购、生产、销售和品质；完整财务以及相关旧业务流程仍依赖 Python/SQLite 运行面。

## 3. Migration 文件与 SHA-256 基线

### PostgreSQL 自托管

| 版本 | 文件 | SHA-256 |
| --- | --- | --- |
| `0001` | `0001_selfhost_baseline.sql` | `c1cd71803b0f504594a41234a82eb13ce8e6713f5d346f3e49247b4921ff1702` |
| `0002` | `0002_material_master_workflow.sql` | `2d8d4facf54c950fa19d1346705aa0f549669544da1a87c2fc584c1fe8b7eb80` |
| `0003` | `0003_material_import_mapping.sql` | `8ce859551198a8a5a334665f68eee503590fa5472f3a6396f44670d2110dddbf` |
| `0004` | `0004_material_import_normalization.sql` | `1bb0eb9b7b3ddbe6c6058a75a04a4bbc69a088e201856f258a4c75728f64aa39` |
| `0005` | `0005_material_import_review.sql` | `e4f2dc62afb8908c7d5a1a0202639809c9dd3f3be3fc09f0ad469224e46ecdcc` |
| `0006` | `0006_identity_security.sql` | `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079` |
| `0007` | `0007_master_data_bom.sql` | `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6` |
| `0008` | `0008_inventory_ledger.sql` | `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b` |
| `0009` | `0009_procurement.sql` | `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7` |
| `0010` | `0010_production.sql` | `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35` |
| `0011` | `0011_sales.sql` | `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b` |
| `0012` | `0012_quality.sql` | `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf` |

当前 PostgreSQL 基线是空库 `0001 -> 0012`。它只在隔离 PostgreSQL/Compose 中执行过；没有生产 PostgreSQL 部署，也没有真实数据迁移。

### 历史 Cloudflare D1 / Drizzle

| 版本 | 文件 | SHA-256 |
| --- | --- | --- |
| `0000` | `0000_far_nightmare.sql` | `450a8d0885b502d702a89fcbac4ec2e69a2c49ebeaf8ba9aa4012c92231687e9` |
| `0001` | `0001_material_master_v2.sql` | `a3e39a14a5db0b0b5c5571edb403ac6b8922b17c3e4ec3d0b36fb2ca5694adf5` |
| `0002` | `0002_material_draft_review_api.sql` | `4f791e50494cf728e57e9dbc7cdfadef0b783505d233b02c87a9a5a37cacd453` |
| `0003` | `0003_material_draft_lifecycle.sql` | `6b3f4b9a7ed96cf94a068f0eeaa6fba00e5b6898b03920353422a7a014f49f70` |
| `0004` | `0004_material_import_batch_foundation.sql` | `94c35749e5d891be97087b079214f1663c03e0c5fabf1517227e7a29235146f5` |
| `0005` | `0005_material_import_parser_mapping.sql` | `461de1f8a93e92de34f2c373d941295cdaf9819adba2de6db172021debc33608` |
| `0006` | `0006_material_import_normalization.sql` | `59c1b8af56cecd0cbae588d4391b36f8f6d92143f6ca686c3768b15d8a36a8bb` |
| `0007` | `0007_material_library.sql` | `f03f7f6d42dd0655f5f92563e116ae0fce65586d4375b46e41f46b1df2427651` |
| `0008` | `0008_supplier_adaptive_import.sql` | `48c4668465462221622c6c16790d4a1618e16a53296c798c7cd1bc38f0fc96a5` |

这些是仓库文件校验和，不代表生产 D1 已应用。生产 D1 本任务未访问。

### Python / SQLite 本地增量

| 版本 | 文件 | SHA-256 | 当前开发库只读记录 |
| --- | --- | --- | --- |
| `0001` | `0001_material_import_source_lineage.sql` | `e6d0de8ff17b84d340912900028f80b2fda1004886f2b9a09e4648cc0e632b6f` | 已记录 |
| `0002` | `0002_material_import_file_archive.sql` | `f0c326b71e339b92a0a41b07bc19e67f11c12db82fda4bf6f70ed7d5cd9999c7` | 已记录 |
| `0003` | `0003_cleaning_structured_specification.sql` | `fc4ca25ba134d0c283bc95a667295c46a03d9cb8cc151963cd883d3ab02a49ff` | 已记录 |
| `0004` | `0004_cleaning_general_spec_tokens.sql` | `1eaee7cc6142c7139ea7d63578be34880d922b9ee21fb48f19ac66e13d0bc930` | 已记录 |

SQLite 的 `local_schema_migrations` 只保存版本和应用时间，不保存 checksum；上表 SHA-256 是本任务建立的仓库文件基线，不能冒充数据库内校验记录。历史 26 表仍缺少完整版本化建库迁移。

## 4. 发布验收模板

复制本节建立新发布记录，所有项必须填写 `PASS`、`FAIL`、`N/A` 或 `NOT_RUN`，并附证据位置。

### 发布身份

| 项目 | 结果 |
| --- | --- |
| 发布版本 |  |
| Git commit / tag |  |
| 包名与 package version |  |
| 目标运行面与环境 |  |
| 变更范围 / 排除范围 |  |
| 数据库 migration 前版本 |  |
| 数据库 migration 后版本 |  |
| Migration 文件 SHA-256 已核对 |  |

### 快照、迁移与数据核对

| 验收项 | 结果 | 证据/说明 |
| --- | --- | --- |
| PostgreSQL 快照、uploads、attachments 恢复点已创建并异地保存 |  |  |
| 现运行 SQLite/D1 的只读快照或受控导出已创建 |  |  |
| 空库 migration |  |  |
| 已有数据升级 |  |  |
| Migration 重复执行 |  |  |
| Migration 失败回滚 |  |  |
| 真实数据试迁移 |  |  |
| 用户/分类/物料/版本/重复/孤儿引用核对 |  |  |
| BOM/采购/库存/生产/销售/品质/财务数量与金额核对 |  |  |
| 文件数量、大小、SHA-256 与数据库引用核对 |  |  |
| 正式迁移逐行结果、异常和人工处置已归档 |  |  |

### 应用、运维与人工验收

| 验收项 | 结果 | 证据/说明 |
| --- | --- | --- |
| lint |  |  |
| build |  |  |
| 单元测试 |  |  |
| 集成测试 |  |  |
| Compose 空卷启动 |  |  |
| Compose 重启持久性 |  |  |
| 人工业务验收 |  |  |
| 权限矩阵与职责分离 |  |  |
| CSRF、幂等、并发、限流和审计 |  |  |
| 默认/弱口令检查与凭证扫描 |  |  |
| HTTPS、Cookie、反向代理和防火墙 |  |  |
| 备份生成与异故障域复制 |  |  |
| 空目标恢复演练与 RPO/RTO |  |  |
| 容量、并发、磁盘、内存和队列积压 |  |  |
| 监控、日志轮转和告警 |  |  |

### 批准与执行

| 项目 | 记录 |
| --- | --- |
| 部署批准人 |  |
| 数据迁移批准人 |  |
| 执行人 |  |
| 计划开始/结束时间 |  |
| 实际开始/结束时间 |  |
| 维护窗口和用户通知 |  |
| 放量/流量切换方式 |  |
| 回退观察窗口 |  |
| 最终批准状态 |  |

## 5. 回退模板

| 项目 | 记录 |
| --- | --- |
| 回退目标 Git commit / 镜像摘要 |  |
| 回退前数据库 migration |  |
| 回退后数据库 migration |  |
| 数据库恢复点与 checksum |  |
| uploads/attachments 恢复点与 checksum |  |
| 旧运行面保留方式与可用性证据 |  |
| 触发条件：健康检查/错误率/数据核对/容量/安全 |  |
| 最晚决策时间 |  |
| 回退批准人 / 执行人 |  |
| 停止写入和隔离失败版本步骤 |  |
| 数据库恢复或前向修复步骤 |  |
| 文件恢复与引用核对步骤 |  |
| 恢复旧 Web/Worker/定时任务步骤 |  |
| 回退后 smoke、人工业务和数据核对 |  |
| 用户通知、审计和事故记录 |  |

数据库回退默认使用“恢复到新空目标并切换”，不得对已过账业务原地逆向改写。Migration Down 只有在明确证明无业务数据、约束允许且有批准时才可使用；否则使用快照恢复或新增前向修复 migration。

## 6. PHASE0-TASK03 验收记录

| 项目 | 结果 |
| --- | --- |
| 核验时功能基线 | `39946f6b854a985b5c19106eaa6c938bddaf9c7c`，`main` 与远端 `origin/main` 均指向该提交 |
| 初始工作区 | clean；仓库中只有根 `.git`，不存在嵌套仓库 |
| 运行面 | Python/SQLite systemd 开发服务 `enabled/active`，`0.0.0.0:18888`；无运行中 Compose 项目 |
| PostgreSQL migration | `0001`—`0005`，SHA-256 与第 3 节一致 |
| D1 migration | 历史 `0000`—`0008`，仅核验仓库文件；未访问生产 D1 |
| SQLite migration | `0001`—`0004`；本地开发库只读记录四个版本，runner 不保存 checksum |
| 测试 | PASS：lint 0 error/1 既有 warning；`npm test` 3/3；review typecheck；Vinext build 5/5；凭证扫描 455 文件；Python self-test、smoke、临时 SQLite go-live；`git diff --check` |
| 部署/生产访问 | 未部署、未重启服务、未迁移真实数据、未访问公开生产 Site 或生产数据库 |

补充说明：宿主机没有 Node/npm，Node 命令在一次性 `node:22-bookworm` 容器中执行。Python 首轮误用系统解释器时 self-test 通过、smoke 在导入 `openpyxl` 前因环境缺依赖停止；改用常驻服务实际使用的 `/opt/erp/.venv/bin/python` 后三项全部通过，没有降低断言。`npm ci` 报告 12 个既有依赖审计项（1 low、4 moderate、7 high），本任务按范围不升级依赖，留待独立安全任务。

## 7. `0.1.0-alpha.8` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK08` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.8` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `0ad0687a7b2f2502f68babbef1455df2a983421b`；`main`，TASK07 已提交且工作区 clean |
| PostgreSQL | 新增 expand-only `0012_quality.sql`；SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf`；`0001`—`0011` checksum 保持不变 |
| 功能 | 独立 Quality Repository/Service/Handler；稳定 IQC/IPQC/FQC 来源、不可变 Result/Defect/Event、异人处置/关闭/重开及 FQC 发货额度门禁 |
| 验收 | unit/UI 5/5、Quality PostgreSQL/API 8/8、migration 3/3、Sales 3/3、Compose 初始/重启及全部适用回归通过 |
| 排除 | 真实检验/库存/生产/销售数据、批次/隔离库位、AQL/SPC、实验室仪器、自动退供/报废、返工工艺、完整财务、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK09 必须从本任务独立提交和 clean 工作区开始。

## 8. `0.1.0-alpha.7` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK07` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.7` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`；`main`，恢复的 dirty 全部为合法 TASK07 成果 |
| PostgreSQL | 新增 expand-only `0011_sales.sql`；SHA-256 `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`；`0001`—`0010` checksum 保持不变 |
| 功能 | 独立 Sales Repository/Service/Handler；报价版本/状态、ACCEPTED 原子转单、SO、Shipment/全额冲销、金额来源及 TASK04 库存同事务复用 |
| 验收 | unit/UI 5/5、PostgreSQL/API 3/3、migration 3/3、Schema consistency、Compose 初始/重启及全量适用回归通过 |
| 排除 | 真实 Quote/SO/Shipment/库存/金额、税/折扣/汇率、销售审批、退货/换货/部分冲销、FQC、完整 AR/收款/GL、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK08 必须从本任务独立提交和 clean 工作区开始。

## 9. `0.1.0-alpha.6` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK06` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.6` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`；`main`，工作区 clean，本地领先 `origin/main` 6 个提交 |
| PostgreSQL | 新增 expand-only `0010_production.sql`；SHA-256 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`；`0001`—`0009` checksum 保持不变 |
| 功能 | 独立 Production Repository/Service/Handler；WO/BOM 快照/需求、领退料、报工、完工及 TASK04 库存同事务复用 |
| 验收 | unit/UI 4/4、PostgreSQL/API 5/5、migration 3/3、Schema consistency、Compose 初始/重启及全量适用回归通过 |
| 排除 | 真实生产数据、MRP/排程、设备/工时/成本、WIP/批次/单位换算、品质/财务过账、销售、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK07 必须从本任务独立提交和 clean 工作区开始。

## 10. `0.1.0-alpha.5` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK05` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.5` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`；`main`，恢复的 dirty 全部为合法 TASK05 成果 |
| PostgreSQL | 新增 expand-only `0009_procurement.sql`；SHA-256 `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7`；`0001`—`0008` checksum 保持不变 |
| 功能 | 独立 Procurement Repository/Service/Handler；PO/Receipt/状态事件/财务来源、缺料建议、部分/全部收货、全额冲销及 TASK04 库存同事务复用 |
| 验收 | unit/UI 5/5、PostgreSQL/API 7/7、migration 3/3、Schema consistency、Compose 初始/重启及全量适用回归通过 |
| 排除 | 真实 PO/在途/库存、审批/取消、部分冲销、超收、单位换算、完整 AP/付款/GL、生产、销售、品质、Dashboard、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK06 必须从本任务独立提交和 clean 工作区开始。

## 11. `0.1.0-alpha.4` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK04` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.4` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `3565d56f24ca904dd0b8d0c55960c702a8895406`；`main`，工作区 clean，本地领先 `origin/main` 4 个提交 |
| PostgreSQL | 新增 expand-only `0008_inventory_ledger.sql`；SHA-256 `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`；`0001`—`0007` checksum 保持不变 |
| 功能 | 独立 Inventory Repository/Service/Handler；稳定 ID、不可变 Ledger、余额投影、通用入/出/盘点、冻结/解冻、全额冲销与 reconciliation |
| 验收 | unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3、Compose 初始/重启及适用回归通过；旧导入 UI 未改文件 6 条起点既有源码正则断言单列为债务 |
| 排除 | PO/收货、WO/领料/完工、SO/发货、品质/财务、旧库存回填、真实数据、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK05 必须从本任务独立提交和 clean 工作区开始。

## 12. `0.1.0-alpha.3` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK03` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.3` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`；`main`，工作区 clean，本地领先 `origin/main` 3 个提交 |
| PostgreSQL | 新增 expand-only `0007_master_data_bom.sql`；SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`；`0001`—`0006` checksum 保持不变 |
| 功能 | 独立 Master Data/BOM Repository/Service/Handler；关系化 Customer/Supplier/Product/Version/BOM Header/Version/Line、Supplier Mapping/价格历史、发布不可变、结构 readiness 与 ACTIVE Material 投影 |
| 验收 | TASK03 unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration 3/3；Compose 空库 E2E 与 Web/PostgreSQL 重启通过；Identity/Material/Mapping/Normalization/Review、Phase0、build/lint/typecheck/凭证和 Python 回归通过 |
| 排除 | 库存、采购、生产、销售、品质、财务、Dashboard、备份、真实主数据迁移、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL/SQLite 或真实业务数据；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。TASK04 必须从本任务独立提交和 clean 工作区开始。

## 13. `0.1.0-alpha.2` 非生产开发记录

| 项目 | 记录 |
| --- | --- |
| 任务 | `SELFHOST-PHASE2-TASK02` |
| 包版本 | `chenyida-erp-selfhosted@0.1.0-alpha.2` |
| 状态 | `NOT_RELEASED` / `NOT_DEPLOYED` / `NOT_MIGRATED` / `NOT_APPROVED_FOR_PRODUCTION` |
| 起始 Git | `e8cb7ebc0fa9d45575aeaffc0732183d2533f577`；`main`，工作区 clean，本地领先 `origin/main` 2 个提交 |
| PostgreSQL | 新增 expand-only `0006_identity_security.sql`；SHA-256 `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`；`0001`—`0005` checksum 保持不变 |
| 功能 | 独立 Identity Repository/Service/Handler；setup/login/logout/session 安全重构；本人改密、用户列表/创建/启停/重置、会话撤销、must-change、限流、持久幂等、CAS 和系统审计 |
| 验收 | Identity 单元 8/8、UI 4/4、PostgreSQL/API 8/8、migration 4/4；Compose 初始生命周期与 Web/PostgreSQL 重启阶段通过；指定 Material/Mapping/Normalization/Review、Phase0、build/lint/typecheck/凭证和 Python 回归通过 |
| 排除 | 客户、供应商、产品、BOM、库存、采购、生产、销售、品质、财务、Dashboard、备份、真实身份迁移、生产 migration、部署和切换 |
| 生产访问 | 未访问公开生产 Site、生产 D1、生产 PostgreSQL 或其他生产数据库；未修改或重启 Python systemd |

这是一条开发版本记录，不是发布公告。未来任何部署、真实用户迁移或生产批准必须新增不可改写的独立记录。
