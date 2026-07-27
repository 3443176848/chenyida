# SELFHOST-PHASE5-TASK10 完成报告

## 结论

- 状态：`DONE / PARALLEL ACCEPTED`
- 固定结论：`SUPPLIER RECEIPT LOT AND IQC RELEASE ACCEPTED IN PARALLEL ENVIRONMENT`
- 仅完成回环非生产 `chenyida-erp-parallel`；未访问或修改生产，未迁真实数据，未 push、未建 PR，未启动后续任务。

## Git、版本与 Migration

- 严格起点：`main` / `55f8fe9693ebc0f630920e92eca1f74584d852af`，工作区 clean，behind 0/ahead 73，`0.1.0-alpha.33`，migration `0001—0033`。
- 功能提交：`a10264020738d5ff281db9a6f7b6774df8cbb61b`，Parent 严格为上述起点，消息 `feat: add supplier receipt lot iqc flow`。
- Compose/历史回归修正：`b4f3f5f5de30259e44d5b00a5587dee29331539f`，消息 `test: accept supplier receipt lot iqc flow`。
- 最终独立 ops 验收提交消息为 `ops: accept supplier receipt lot iqc in parallel environment`，SHA 以 Git log 为准。
- 版本为 `0.1.0-alpha.34`；唯一新增 `0034_supplier_receipt_lot_iqc.sql`，SHA-256 `29b380050d7d7003df82df981aea061e7287845dde773f181caf918a49d47b2d`。`0001—0033` 未修改；Schema、0034 snapshot、journal、manifest 和数据库 checksum 一致。

## 实现边界

- `inventory_lots` 保持 `MANUFACTURING_FINISHED_GOODS`，并增加严格互斥的 `SUPPLIER_RECEIPT`。RML 内部 code 由服务端生成；Receipt Line、Supplier、Material、Unit 和 received time 沿稳定关系确定；Supplier Lot 标准化且不可变。
- IQC 管理的 ACTIVE/STOCKED 内部物料收货，在一个事务写 Receipt/Line、Delivery Allocation、PO/Plan 投影、Lot、Inventory Adjustment/Ledger、Lot/Material Balance、Purchase Financial Source、Lot/Procurement Event、Audit 和 Idempotency。on-hand 与 frozen 同时增加，available 不会短暂暴露。
- IQC 沿 Receipt Line→Lot 解析来源。RELEASE 锁定 Inspection→Lot→Balance，追加 UNFREEZE Ledger，只放行 passed 范围；failed/HOLD 保持 frozen。已有 release 的 IQC 不允许不安全 reopen。
- 无 IQC、AP、生产领用、其他调整或下游，且余额/账本完整时，整单 Receipt 冲销沿原 Lot 追加反向 Ledger并置 REVERSED；不创建替代 Lot。部分冲销未实现。
- 页面 `/warehouse/receiving`、`/quality/incoming`、`/warehouse/inventory-lots`、`/procurement/fulfillment` 和 Dashboard 已接入 Node/PostgreSQL 权威。
- 未实施生产领料 Lot、FIFO/FEFO、效期/库龄、序列号/条码/标签、自动退货/报废、MRB/让步/返工、AP/付款、成本/总账或生产部署。

## 真实 HTTP 验收

- 通过真实 Session/CSRF/权限/Idempotency HTTP 建立两条 Project create/submit/engineering accept→Requirement Resolution→Planning Package submit/accept→Material Requirement Plan submit→Purchase Request accept→Sourcing RFQ/Quote/Comparison/Award→PO→Delivery Plan→Receipt 完整业务链。SQL 只写 Customer/Supplier/Material/Product/BOM/Mapping 等稳定主数据 fixture，不预写业务状态。
- 主链：Supplier A、Material 10、单价 12 CNY、Supplier Lot `SUP-A-20260727`。warehouse 收货后唯一 RML Lot 为 `on-hand/frozen/available=10/10/0`，Purchase Source 120，IQC/AP 0。
- quality 创建 IQC `inspected/passed/failed=10/8/2`，创建人自行处置被职责分离阻止，RELEASE 9 被拒；另一 quality 角色 RELEASE 8，创建人 Close。最终 Lot `10/2/8`、released 8、hold 2、Material sum 10、Source 120、AP 0、Production Issue 0。
- 支线：另一 Award/PO/Delivery Plan 数量 3，warehouse 收货形成独立 RML Lot；未创建 IQC 即全额冲销，原 Lot `0/0/0`、REVERSED，正反 Ledger 均保留、Source net 0、PO/Plan 投影恢复，只存在一个原 Lot。
- 对主链已有 IQC 的 Receipt 冲销返回 409 `RECEIPT_REVERSAL_BLOCKED_BY_IQC`，事实不变。purchase 收货、warehouse IQC、quality 收货实际返回 403；四个页面实际 HTTP 200。
- Web、Worker 串行重启后再次登录 sales、engineering、planning、purchase、warehouse、quality 双人、production、finance 共九个临时角色（加原 admin 共十个账号）并核对：34 migrations、Project/Accepted Planning Package/Accepted Purchase Request/Award/PO/正常 Receipt/Lot=`2/2/2/2/2/2/2`、IQC 1、AP/Production Issue 0；Lot 仍为 `10/2/8` 与 `REVERSED 0/0/0`。
- 验收脚本调试期间发现并修正只读断言/API 路径以及完整 HTTP 链路中的实际 CAS 版本取值；每次均从 clean-0034 恢复后从零重跑。业务事务没有半记录，最终完整初始与重启阶段通过。

## 自动验证

- TASK10：unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration upgrade 3/3、Compose initial/restart 通过。
- Procurement PostgreSQL 7/7；Quality PostgreSQL 12/12；共享 Procurement/Inventory/Quality/Finance/Dashboard/TASK08/TASK09 unit/UI 42/42。
- TASK08 Finished Goods Lot PostgreSQL 2/2、migration 4/4；TASK09 FQC/Shipment Lot PostgreSQL 2/2、migration 3/3。历史 journal 断言改为精确查找不可变 tag，snapshot/checksum/失败回滚断言不变。
- `typecheck:phase5-task10` 通过；Drizzle schema consistency 通过；lint 0 error、8 个既有 warning；`npm test` file storage 3/3；Web/Worker 串行 build 通过。
- Web image `sha256:1c07cb1b57083b5afa0cf8749c5cbb63dac1a458474bee298c05a1351b3304b9`；Worker image `sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`。
- `npm run security:credentials` 通过（1,015 个仓库文件）；最终 `git diff --check` 通过。
- Python 项目虚拟环境 `/opt/erp/.venv/bin/python`：`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 全部通过。首次误用系统 Python 时 self-test 通过，smoke 在导入阶段因缺 `openpyxl` 停止；未进入测试、未改代码，改用项目既有虚拟环境后复验通过。Python systemd 未重启。

## 备份、恢复与最终数据

- clean-0033：`/var/backups/chenyida-erp/task10-clean-0033-20260727.dump`，1,659,329 bytes，0600 root:root，SHA `9eaf3ed717d1258a6553aed2608157b580a535a2ec97cbb96ef5a1125485dc0a`，restore list 通过。
- clean-0034：`/var/backups/chenyida-erp/task10-final-clean-0034-20260728.dump`，1,677,933 bytes，0600 root:root，SHA `44e064442eac5af0df56abf54989dd75a9fe6d39a030427439cf4996c9889c25`，restore list 通过。
- 最终完整 HTTP 接受态：`/var/backups/chenyida-erp/task10-final-acceptance-0034-20260728.dump`，1,706,164 bytes，0600 root:root，SHA `e4548ed8b264b078a34c7856c1338d5fb6ce712158d0453dc018945b5e27b791`，restore list 通过。
- 接受态恢复到固定第二数据库后核对 `34|2 Awards|2 PO|2 Receipt|2 Lot|1 IQC|0 AP|0 Production Issue`，Lot 分别 `FROZEN 10/2/8` 与 `REVERSED 0/0/0`，Source main/branch net `120/0`；随后删除第二数据库。
- 主库从 clean-0034 恢复。最终为 34 migrations、`app_meta setup_completed=1`、唯一启用 admin、唯一原 `IDENTITY/LOGIN/success` Audit 和对应唯一 Session；原 Audit ID/Request/时间保持。除这些治理/身份基线外 205 个业务表、Idempotency 和文件元数据全部为 0；没有读取 token/session digest、Cookie、CSRF、密码哈希或数据库凭据。
- 三份 TASK10 备份在完成恢复验证并记录尺寸/SHA 后按精确路径删除；固定第二数据库、测试库、临时 SQLite、临时容器和任务依赖镜像均已清理。`resource-guard-20260727-0824.dump` 保持 1,383,645 bytes、0600 root:root。

## 资源与运行保护

- 起点约 available 2.4 GiB、Swap 135 MiB、根盘可用 36 GiB；所有 migration、数据库回归、build、备份恢复、Compose 停启均串行，临时测试库逐个创建并删除。
- 构建后 Build Cache 为 2.569 GB；完成所有验收后执行一次且仅一次 `docker buildx prune --all --force`，清理 2.569 GB 并回到 0B。只删除本任务创建的 `chenyida-task10-dependencies` 镜像；保留 alpha.34 tagged Web/Worker 镜像。
- 四个受保护卷全部保留；未执行 `docker system prune -a`、`docker volume prune`，未修改 Swap、dockerd、内核、防火墙或 systemd。
- 最终 available 2.3 GiB、Swap 139 MiB，60 秒 Swap `142452→142372 KiB`、增长 -80 KiB；根盘可用 36 GiB，Load `0.03/0.11/0.21`。PostgreSQL/Web/Worker 为 healthy/healthy/running、Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口、RestartCount 0、OOM false。Python PID `13737`、NRestarts 0。
- 起点一次 Compose `start` 因 one-shot migrate 依赖未存在而拒绝，随后只启动原 Web/Worker 容器恢复，未重建 PostgreSQL、未造成 restart/OOM 或数据变化；此后停止/启动均按容器和服务逐项串行。

## 停止点

任务停在 clean `0034` 并行非生产基线。任何生产领料 Lot、后续阶段、真实迁移、HTTPS、生产部署或切流都必须重新明确授权。
