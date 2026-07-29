# SELFHOST-LANDING-TASK05 完成报告

## 结论

- 状态：`DONE / STAGING ONLY / REVIEW REQUIRED`。
- 固定结论：`STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`。
- 本次只访问当前 `chenyida-erp-parallel` PostgreSQL 与一个任务临时数据库；未访问或修改 SQLite、D1、其他服务器或外部数据库。

## 原始文件与解析

- 输入为单个 root-only XLSX，25,014 bytes、mode 0600；SHA-256 `cfd1e290d50472b93377f411111cd2d3a4ea207c5481671abe307c0cc1a749df`。
- 原件解析前后 inode、size、mode、uid/gid、mtime 与 SHA-256 完全一致；未改名、移动、写入、提交或上传。
- 工作簿只有一个可见 Sheet、198 个非空行（1 表头 + 197 数据）、12 列、0 公式、0 外部链接、0 合并单元格。
- 197 个 ERP 编码均存在、格式有效、唯一并连续为 `00001`—`00197`；精确标准字段身份重复组 0，来源追踪完整 197/197。
- 197 行“使用次数”均为合法非负整数，合计 519；该字段只作来源统计，没有被解释为单位、库存数量或 BOM 数量。
- 表格没有显式单位列，也没有产品编码、产品版本、BOM 版本、BOM 行号、BOM 数量、位号或 BOM 单位字段。因此 `materials_ready=0`、`NEEDS_REVIEW=197`，唯一原因是 `EXPLICIT_UNIT_MISSING`；Product/Product Version/BOM/BOM Version/BOM Line 均为 0。

## 拟删除清单与主库保护

- 删除前只读盘点 `public` 210 张表和 `migration_tool` 3 张表，共 213 张；完整逐表计数和拟删除清单位于仓库外 root-only 目录。
- 若 staging 合格，计划清除 208 张业务/导入表的 5,556 条旧记录，其中包括 872 条 `REAL_BOM_MIGRATION` 业务审计；计划保留 34 Migration、`app_meta`、唯一管理员、2 个合法 Session 和 4 条 Identity 审计。
- staging 没有任何 `ELIGIBLE` 行，因此上述清理事务从未执行。主库 213 张表的前后计数 manifest 均为 `f59469aac117074b40d69b8e941581989aa243599de37be1ae784f9f8d82c792`，差异 0。
- 旧业务计数保持：Material/Version `532/532`、Category/Sequence/Unit `22/19/1`、Legacy Mapping `806`、Product/Version `6/6`、BOM/Version/Line `6/6/316`、旧分类/来源链接 `1,113/1,318`、旧业务导入审计 `872`。采购、库存、生产、品质、销售和财务事实仍为 0。

## pre-clean 备份、恢复与 staging

- pre-clean custom dump：`/var/backups/chenyida-erp/bom-v9-preclean-20260728T235231Z.dump`，1,982,039 bytes、root:root 0600，SHA-256 `b21b484bc4dbb11fcc9354af649267a10bff4a125dcf84c8ba639164191916e2`。
- `pg_restore --list` 成功生成 3,065 项清单；dump 恢复到新建空数据库后，213 张表逐表计数与主库完全一致，Migration/checksum manifest、管理员、初始化、Session、身份审计和旧业务计数均一致。
- 恢复库随后作为隔离 staging：首次写入 197 个不可变来源行，`ELIGIBLE=0`、`NEEDS_REVIEW=197`、缺单位 197、唯一编码/来源引用/行摘要均为 197；同一 payload 重放新增 0。
- staging 只在 `migration_tool` 建立任务临时表，不写 `public` 业务表。两个前置失败（生产 Web 镜像无独立 `pg` 包、纳秒 mtime 数值跨语言摘要不一致）均发生在 DDL 前；改用现有 Worker 运行时并把文件元数据保存为字符串后通过，没有半记录。
- 因主库没有清理或导入，post-import 备份不适用，也没有伪造 post-import 恢复结论。

## 系统、资源与清理

- Migration 仍为 34 条、head `0034_supplier_receipt_lot_iqc.sql`，checksum manifest `b2ff69f7b72db5f5bdd02b0fc6cc4e70dd913e52e1140a4abe1a8c3549d13b8b`。
- 唯一管理员保持 active、无需改密，`setup_completed=1`；2 个 Session 与 4 条 Identity 审计原样保留，最终有 1 个有效 Session。未读取密码、Token、Cookie、原 Session digest 或数据库凭据，也未用未知凭据模拟登录。
- PostgreSQL accepting，Web health/root 与 Caddy TLS health 为 200，匿名 Material API 为 401，Worker running；四容器 RestartCount 0、OOMKilled false，内核 OOM 记录 0。
- 起点 07:50 SAR 为 available `2,351,184 KiB`、Swap used `130,592 KiB`、Load `0.06/0.09/0.11`，根盘可用 35 GiB；提交后 available 约 2.2 GiB、Swap 126 MiB、Load `0.08/0.14/0.14`、根盘仍 35 GiB。独立 60 秒观察的 Swap `129300→129300 KiB`、增长 0；内核 OOM 0。
- 任务临时 staging 数据库、两个自动删除 runner 和任务 Python cache 已删除；无任务容器残留。四个 ERP 持久卷全部保留；pre-clean dump/list 与 root-only intake 证据保留。
- root-only 目录 `/var/lib/chenyida-erp/intake/bom-v9-reset-20260728T235056Z` 为 0700，报告/payload/`needs-review.csv` 为 0600。Git 只包含通用显式字段 staging 工具、合成测试和脱敏文档，不包含原 XLSX、逐行 payload/CSV、dump、凭据或真实数据库内容。
- 未 build、Migration 常驻库、restart、deploy、切流、push、PR 或操作 Python 服务；完成后停止。

## 验证

- 新 staging prepare 单元测试 4/4 通过：缺单位 fail closed、显式单位、精确重复不合并、BOM 列无独立契约时拒绝。
- Node staging 脚本语法检查通过；实际 PostgreSQL 首次 197、重放新增 0、逐项 reconciliation 通过。
- 原有 real BOM classifier 4/4、`git diff --check`、凭据/真实数据边界和最终 Git 范围检查通过。
