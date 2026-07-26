# SELFHOST-PHASE4-TASK08 完成报告

## 结论

`PRODUCTION QUALITY RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`

- 日期：2026-07-26（Asia/Shanghai）
- 功能提交：`4a638522b7ca295b41d2f35adbc464b23762b007`
- 功能 Parent：`7d9c2dbaf62664e46c4f984822bb43903999f5fd`
- 功能消息：`feat: add production quality release workflow`
- 验收消息：`ops: accept production quality workflow in parallel environment`
- 版本：`0.1.0-alpha.22`
- Migration：`0022_production_quality_release.sql`
- SHA-256：`65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155`

## 实际 HTTP 验收

只在 `chenyida-erp-parallel` 回环非生产环境中使用 production、warehouse、sales、quality、manager 真实隔离账号与 Session/CSRF/Idempotency：

1. Work Order planned/completed=`10/10`；两份 Report `4/6`、两份 Completion Line `4/6`，成品库存 10。
2. sales 创建 OPEN Sales Order Line 10，并把两个 Completion Line 稳定分配为 `4/6`；分配不修改 `reserved_qty`。
3. quality 对两份 Report 创建 IPQC `4/4 passed`、`6/6 passed`；manager 执行 RELEASE，quality 关闭。IPQC 前后 Work Order version、Completion 数量和成品库存完全一致。
4. quality 对两个 Allocation 创建 FQC `4/4 passed`、`6/6 passed`；manager RELEASE，quality 关闭。
5. FQC inspected/passed/released=`10/10/10`，Sales Order Line FQC available=10；成品库存仍为 10。
6. Shipment、Sales Financial Source、AR 均为 0；没有创建收款或其他财务事实。
7. 实际 HTTP 另验证 production 创建分配 403、quality 最终处置 403、同正文幂等重放和陈旧 CAS 拒绝；两个原生页面均为 HTTP 200。

## 模型、权限与自动验证

- 仅新增 Completion Line→Sales Order Line Allocation/Event；FQC 浏览器和 API 只能提交稳定 Allocation ID，没有第二套品质检验或放行逻辑。
- 数据库与服务端共同校验 Customer/Product/Product Version/Finished Material/Unit、当前订单版本/状态、Completion 未冲销、双侧累计数量、唯一对、取消/FQC 门禁和 Completion reversal 门禁。
- IPQC/FQC 均执行 inspected 守恒、FAIL/Defect 守恒、职责分离、RELEASE/CONCESSION 上限、REWORK/SCRAP HOLD、关闭前处置和已发货消费后的重开门禁。
- sales 创建/取消分配；quality 创建 Result/Defect/Inspection 并 Close；manager/admin Disposition/Reopen；production/warehouse 受控读取。其他角色写入 403。
- TASK08 unit/UI 5/5、PostgreSQL/API 12/12、migration 3/3；TASK01—TASK07、Production、Quality、Sales、Inventory、Dashboard 的 unit/UI/PostgreSQL/migration 回归全部通过。
- 覆盖并发分配、超分配/超检、职责分离、幂等重放/异正文冲突、CAS、故障注入零半记录、取消/冲销、Defect/处置、Shipment 消费和 TASK07 Completion reversal 回归。
- 16 组正式 typecheck、Drizzle Schema consistency、ESLint 0 error/5 个既有 warning、Vinext build 5/5、858 文件凭证扫描、`git diff --check` 通过。
- Python `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；真实 SQLite 未打开业务正文或修改。

## Compose、备份恢复与清理

- 只更新 `chenyida-erp-parallel`；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口，未启用 Caddy/HTTPS/80/443。
- PostgreSQL/Web/Worker 整体重启后 22 migrations、2 Allocation/2 Event、4 Inspection/4 Result/12 Event、released 10、库存 10 和 14 个关键成功审计保持。
- 接受态停服备份 `backup-20260726T062301Z-4a638522b7ca` 通过 checksum、大小、迁移清单和归档安全校验；恢复到新空库精确为 `22:2:4:4:12:10:10:0:0:0`。
- 验收后主库受控清理为 22 migrations、唯一启用管理员、所有合成业务 0、uploads/attachments 0；恢复库、23 个隔离测试库、备份/恢复目录、退出的 migrate 容器和临时 Alpine 镜像均已删除，临时备份不可恢复。
- 最终只保留 PostgreSQL/Web/Worker 三容器和 `erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status` 四个卷；内存约 123.2/34.56/56.21 MiB，宿主可用内存约 1950 MiB、磁盘约 19 GiB。

## 生产保护与 Git

- Python systemd 保持 active、PID `277640`、监听 18888；SQLite metadata 保持 `64769:53827608:1784999031:1544192`。
- 未读取或迁移真实 SQLite 数据，未重启 Python，未访问/修改生产 D1，未 push、未建 PR、未切流、未生产部署。
- 未执行 Shipment、成品库存扣减、销售金额来源、AR、收款、IQC 库存隔离、批次/序列、返工或报废过账；TASK08 完成后停止。
