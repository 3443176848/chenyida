# SELFHOST-PHASE5-TASK08 完成报告

## 完成结论

`SELFHOST-PHASE5-TASK08 — 成品 Inventory Lot、批次余额与完工入库绑定` 已在 `chenyida-erp-parallel` 回环非生产环境完成并停止。

固定结论：`FINISHED GOODS INVENTORY LOTS ACCEPTED IN PARALLEL ENVIRONMENT`

这是 Finished Goods Inventory Lot，只覆盖 `MANUFACTURING_FINISHED_GOODS`。原材料 Lot、供应商来料/采购 Receipt Lot、生产领料 Lot、Shipment Lot 消费、FQC Lot 放行和序列号仍未实现。

## Git、版本与 Migration

- 起点为 `main` / `809efadd2cafd1a7b55a0824b87c67c70ad2814b`，Parent `dfece35cda381ff31c376aad9ed78242861ada73`，工作区 clean，behind 0/ahead 59。
- 功能提交 `43808f85bc3a662825cc2421d97e9eb631e0c469` 的 Parent 严格为任务起点，消息 `feat: add finished goods inventory lots`。之后只追加聚焦修正：`ec5c284`、`3af4736`、`323aca7`、`3919a7a`、`57a3f0c`、`60223c6`、`88b6b9d`、`ad76c08`、`0d2d8fb`；未 amend、rebase 或改写历史。
- 本报告所在独立验收提交消息为 `ops: accept finished goods lot workflow in parallel environment`；实际 SHA 以最终 `git log -1` 为准。不 push、不创建 PR。
- 版本 `0.1.0-alpha.31` → `0.1.0-alpha.32`；唯一新增 `drizzle-postgres/0032_finished_goods_inventory_lots.sql`，SHA-256/主库 checksum 为 `3a2fc22ff73706d226641119135b68d042d393124c89233a63d774f76aa2d4fa`。`0001`—`0031` 未修改，Schema、journal、`0032_snapshot.json` 和 migration manifest 一致。

## Finished Goods Inventory Lot 权威

- 服务端首次 Batch Completion 创建唯一、标准化且不可修改的 `FGL-########` Lot；同一 Manufacturing Batch 的后续分批 Completion 和冲销后重新 Completion 都复用同一 Lot。Batch 与 Lot 是两个稳定对象，不按名称或 Batch code 文本猜测关联。
- Lot 沿 Batch→Work Order 稳定继承 Product Version、finished material、unit 和制造来源；`inventory_lot_id` 是 Ledger/Balance 权威外键，`lot_code` 只作一致性校验与显示。
- 成品余额唯一维度为 Material + Location + Inventory Lot。查询同时返回每 Lot `on_hand/frozen/reserved/available` 和同单位 Material aggregate；汇总包含 Lot Balance 与历史空 Lot Balance，禁止跨单位求和。
- ORDER 模式历史 Completion 继续写 `inventory_lot_id=null`、`lot_code=''`，不自动猜测或创建 Lot。
- `AVAILABLE/FROZEN/DEPLETED/REVERSED` 是服务端受控投影。warehouse 的 Lot freeze/unfreeze 复用 Inventory Service，追加零 on-hand delta 的 Ledger 事实，不改写历史；正数、上限、CAS、幂等、审计和事务守恒均由服务端及数据库约束。
- Batch Completion/冲销在同一事务锁定 Batch、Report、Completion、Lot、Balance，并原子提交 Allocation、Ledger、Balance、Lot/Batch 投影、Event、Audit 和 Idempotency。冲销向原 Lot 写反向 Ledger；冻结、FQC、Shipment 或无法证明安全的下游一律 fail closed。
- 数据库外键、唯一索引、不可变 trigger、服务写 guard 和 deferred reconciliation 阻止跨 Batch/Material/Unit、错误 lot_code、重复 Lot、Batch Completion 空 Lot，以及 Lot/Completion/Ledger/Balance 不守恒的直接 SQL。

## 实际 HTTP 验收

1. 创建四个 Work Center 和 `NONE/NONE/IPQC/NONE` Routing，创建 planned 10 Work Order 并完整领料；发布 Batch Set，Batch A=4、Batch B=6。
2. 两个 Batch 均完成四工序且 IPQC 全部通过；没有返工或 NCR。Final Output、Production Report、warehouse Completion 分别为 A 4、B 6。
3. 首次 Completion 形成唯一 Lot A `FGL-00000001` 和 Lot B `FGL-00000002`；Ledger `+4/+6` 均带稳定 `inventory_lot_id`，Lot Balance 为 `4/6`，Material aggregate 为 10，空 Lot Balance 为 0/不存在。
4. Lot B freeze 2 后 `on_hand=6/frozen=2/available=4`；unfreeze 2 后 `on_hand=6/frozen=0/available=6`。冻结期间 Completion 冲销返回 409；production freeze 越权返回 403。
5. Lot A 安全冲销追加 `-4` Ledger 到原 Lot，Balance=0、状态 `REVERSED`；重新 Completion 4 追加 `+4`，复用同一 Lot A 并恢复 `AVAILABLE`/Balance 4。
6. 同 Idempotency-Key 的并发 Batch A Completion 只产生一个有效结果和一次重放，不重复建 Lot；跨 Batch/Material、错误 lot_code 和第二个同 Batch Lot 的直接 SQL 均拒绝，故障注入不留空 Lot 或半 Ledger。
7. 实际 ORDER 模式工单完成四工序、Report/Completion 后仍为 null/空 Lot；随后冲销，历史空 Lot Balance 回到 0。
8. 最终接受态为 Lot A 4、Lot B 6、Material 10；Work Order planned/reported/good/scrap/completed=`10/10/10/0/10`、`COMPLETED`；FQC、Shipment、Sales Source、AR、Settlement 均为 0。Genealogy 返回 Lot、Completion、Ledger 和 Balance。

接受态 Ledger on-hand delta 稳定序列为 `+4,+6,0,0,-4,+4`；其中两个 0 是 freeze/unfreeze 追加事实。Lot Balance `4+6=10`，等于 Material aggregate，也等于有效 Completion 净量。

## 权限、安全与自动测试

- warehouse 可读 Lot、执行 Completion 和 freeze/unfreeze；production/quality/engineering 依职责读取相关 Batch/Lot genealogy，不能冻结；planning/purchase/sales/finance 不得执行 Lot 写操作；manager/admin 管理。实际 production freeze 为 403。
- 写接口覆盖 Session/must-change、CSRF、正文上限、限速、Idempotency-Key、CAS/version、固定锁顺序、request_id、中文安全错误、单事务 Audit 与整体回滚。
- 212 项不重复 Node 自动测试通过：unit/UI 93、PostgreSQL/API 72、migration upgrade 38、基础存储 3、environment guard 6。覆盖 Phase 4 TASK07/TASK08、Phase 5 TASK01—TASK07、Production/Batch/Inventory/Quality/Sales/Dashboard、Identity/Permissions、ORDER 兼容、并发/故障和直接 SQL guard。
- 13 组适用正式 typecheck、Drizzle Schema consistency、lint、Web/Worker 分开 build、992 文件 credentials scan 和 `git diff --check` 通过。TASK08 最终 unit 3/3、UI 2/2、PostgreSQL/API 2/2、migration 4/4。
- Python `/opt/erp/.venv/bin/python` 的 `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 全部通过；临时库已删除。

## Compose、备份恢复与清理

- 修改主库前创建停服备份 1,596,445 bytes，SHA-256 `45dfa579e8dcb50e851b6692d2f20b19462c0a9d0c073162f6a6fe52ea359019`；干净 0032 备份 1,637,664 bytes，SHA-256 `beae586736afdfeda36dd55ce86a3f5c3bc0467e8b4a1e2de797a0d8800bde79`。两者均为 0600、非零并通过 `pg_restore --list`。
- 最终镜像下实际 HTTP `verify` 通过后，Web/Worker 使用 Compose 串行 restart；`restart` 再次核对 32 migrations、Lot `4/6`、Material 10、完整 Ledger/冻结/ORDER/genealogy 事实保持。
- 接受态停服备份 1,684,486 bytes，SHA-256 `416541cb78062657640458f6dd104c86a8cf3432332302cb2c58ab683a4b3949`，0600、非零并通过 `pg_restore --list`。恢复到固定第二新空库 `chenyida_erp_task08_restore` 后再次核对 32 migrations、Lot A 4、Lot B 6、Material 10 和完整接受链；恢复库随后删除。
- 主库从已验证 clean-0032 备份恢复，最终只有 `schema_migrations=32`、`app_meta=1`、唯一启用且无需改密的 admin；其他所有公共业务/Audit/Idempotency/临时账号为 0，uploads/attachments 文件为 0。
- TASK08 测试库/角色、临时 SQLite、Drizzle/schema 目录、日志和三份 TASK08 备份均按精确名称删除，删除后不可恢复。resource-guard 备份保留，SHA-256 `ffd176e43192c575a0b5c7e3f2469f93f779605ca445bcfc6218ed8c810b6570`。
- 最终只运行原 PostgreSQL/Web/Worker 三个 ERP 容器；四个 ERP 卷、Trae/MySQL、匿名卷和当前 tagged image 保留。Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口。

## 低资源与 Python/SQLite 保护

- 起点 available memory 约 2.4 GiB、Swap 约 150 MiB、根分区可用约 37 GiB、Build Cache 0B；任务构建峰值 Build Cache 2.627 GB、磁盘可用 35 GiB。
- 确认无构建进程后，只执行一次获授权的 `docker buildx prune --all --force`；Build Cache 2.627 GB→0B，根分区可用 35→37 GiB。未执行其他 prune，未删除 tagged image、运行容器或 Volume。
- 最终 available memory 约 2.4 GiB、Swap 150 MiB、根分区可用 37 GiB、Load `0.04/0.37/0.62`；60 秒 Swap `154432→154428` KiB，正增长 0。三容器 RestartCount 0、OOMKilled false，PostgreSQL/Web healthy、Worker running。
- 全程 `COMPOSE_PARALLEL_LIMIT=1`，Web/Worker 分开构建；Migration、测试、typecheck、备份恢复与重启串行，一次最多一个临时容器/数据库。Node 重任务 heap 1024 MiB，Web/Worker heap 384 MiB；未触发任何停止线。
- 常驻 Python PID `13737` 未停止或重启。真实 SQLite 只核验 metadata：inode `53827608`、size `1544192`、mode 600、mtime `2026-07-26 01:03:51.761827070 +0800`；未读取真实业务正文。

## 明确未执行

未实现供应商批次、原材料 Lot、采购 Receipt Lot、生产领料 Lot、Shipment Lot 消费、FQC Lot 放行、序列号、条码/二维码/标签、Completion 事务外自动 Lot 创建、设备/OEE、外协、产能排程、成本会计或历史数据迁移；未操作 Python 服务，未修改 HTTPS、防火墙、Swap、dockerd、内核或 systemd；未执行生产部署、切流、push、PR 或 `SELFHOST-PHASE5-TASK09`。
