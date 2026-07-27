# 晨亿达ERP状态快照

最后更新时间：2026-07-27（Asia/Shanghai）

## SELFHOST-PHASE5-TASK05 IPQC 不合格处置与返工申请交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `1de057a6a248ca3346d7d2b0f201252a3965eced` 严格 Parent `736f14b9510ca52ce39fea7154872dffe7818986`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.29`；`0029` SHA-256/数据库 checksum `6814a728f4d04e4fbceb83c7a288fa214a9ec64317b547cc6cbaebfec456b40c`；0001—0028 未修改，Schema/journal/snapshot 一致 |
| NCR 与数量守恒 | PASS | 只接受 failed>0、FAIL Result+Defect 的结构化 Run Report IPQC；服务端继承稳定来源；`failed = active rework + final scrap + unresolved`，RETURNED/CANCELLED 释放，ACCEPTED 占用，SCRAP 不可逆且不写库存 |
| 实际 HTTP 数量 | PASS | planned/issued 10；REFLOW inspected 10/passed 8/failed 2；AOI available 8、Hold 2；v1 RETURNED、v2 ACCEPTED；active rework 2、final scrap 0、unresolved 0、NCR REWORK_ACCEPTED |
| 请求版本/目标 | PASS | target 为同工单 REFLOW Snapshot Operation；v1/v2 各有不可变提交快照和 64 位 digest；后序/跨工单目标拒绝，SUBMITTED/ACCEPTED 内容不可改，ACCEPTED 不可取消 |
| 权限/职责分离 | PASS | quality 创建/编辑/提交，production RETURN/ACCEPT 且不能接收自己创建的请求，manager/admin SCRAP，engineering 只读；warehouse/sales 等实际 403 |
| 门禁/并发/回滚 | PASS | Idempotency 重放/异正文、CAS、固定锁顺序、并发 draft/submit/accept/SCRAP、直接 SQL、故障零半记录通过；已有处置阻止 Inspection reopen 与来源 Run 冲销 |
| 下游零事实 | PASS | AOI available 保持 8；Rework Run、额外 Run Report、Production Report、Completion、Finished Goods Ledger/Balance、FQC/Shipment/AR/Settlement 均 0 |
| 自动验证 | PASS | 166 项不重复 Node 自动测试：unit/UI 72、PG/API 47、migration 38、npm 3、environment 6；正式 typecheck、Schema consistency、lint、build、955 文件 credentials scan、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | 整体重启后 NCR/v1/v2、2 提交快照、6 请求事件、digest、Audit 44、Idempotency 30 保持；接受态备份 SHA-256 `440fae8efd3427a341d7c8d2d24ebf516de9ef9dfd9acb50b5e841ebf069afbc` 恢复到固定第二新空库并核对完整链 |
| 清理 | PASS | 主库 29 migrations、app_meta 1、唯一启用 admin，其他公共业务/Audit/Idempotency/临时账号 0；uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；TASK05 库/备份/临时容器/辅助镜像删除，resource-guard 保留 |
| Python/SQLite | PASS / PROTECTED | `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 通过；常驻 Python PID `13737` 未重启，真实 SQLite metadata `53827608:1544192:1784999031:1784356951`、mode 600 未变，未读业务正文 |
| 资源观测 | PASS | 起点 available 约 2.4 GiB、Swap 约 111 MiB、磁盘约 21 GiB；最终 available 2.4 GiB、Swap 150 MiB、磁盘 17 GiB、Load `0.18/0.31/0.82`；独立 60 秒 Swap 157,892,608→157,872,128 bytes（正增长 0），全程 RestartCount 0、OOMKilled false |
| 排除事项 | ENFORCED | 未执行 Rework Run/派工/开工/报工/再检、SCRAP 库存过账、补产/补料、批次/设备/产能、FQC/Shipment/AR、真实迁移、Python 服务操作、HTTPS/防火墙、生产部署、push、PR 或 TASK06 |
| 完成结论 | PASS | `IPQC NONCONFORMANCE TO REWORK REQUEST ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK04 工序质量门禁、IPQC 稳定来源与受控放行

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `5379550d0381818ad970518ac4fb8261c4679989` 严格 Parent `f6e5ff2e8344e79a35f56311b02b514613484f59`；聚焦修正 `56f63ca714ed6f359bc51f681b6a532259747f1b`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.28`；`0028` SHA-256/数据库 checksum `a7a55f7c6c81b1c5a80df59a1b3f639187cc2c2ce8658087ceb392b1f2ada912`；0001—0027 未修改，Schema/journal/snapshot 一致 |
| 门禁与稳定来源 | PASS | Routing `NONE/IPQC` 进入 digest 并固化 Snapshot；工序 IPQC 显式引用有效 Run Report，服务端确定同工单/快照/工序/工作中心/物料/单位/数量，与历史 Report IPQC 来源互斥且兼容 |
| 实际 HTTP 数量 | PASS | REFLOW good `4/6` 后 Hold 10、released 0、AOI available 0；IPQC inspected/passed/released=`4/6` 后 Hold `10→6→0`、AOI available `0→4→10`；最终 AOI/Report/Completion/Ledger `4/6`、Balance 10，Work Order `10/10/10/0/10 COMPLETED` |
| 权限/职责分离 | PASS | engineering 配置 DRAFT；production 执行和只读；quality 显式创建/记录/关闭，manager 异人处置；warehouse 实际越权 403。Dashboard 五项指标按权限返回且不创建 Inspection |
| 守恒/并发/更正 | PASS | inspected/released 不超 good/passed；OPEN/HOLD/REWORK/SCRAP 不释放；幂等重放/异正文、CAS、并发 close/reopen/消费、直接 SQL 和故障零半记录通过；存在 IPQC 阻止来源 Run 冲销，下游消费阻止 reopen |
| 自动验证 | PASS | TASK04 专项 15；完整 unit/UI 回归 56、PG/API 40、migration 回归 16、manifest 8、coverage 2、环境 6、npm 3 均通过；正式 typecheck、Schema consistency、lint、Vinext build、credentials scan、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | Compose 整体重启后 8 Run/Report、2 Inspection/Result、6 Quality Event、2 Report/Final Allocation/Completion、2 Ledger、Balance 10 保持；接受态备份 SHA-256 `4da56e4303afae15ac0e5e7e8f550711ec66cbcae669dcac8b4b1f4c8e360a65` 恢复到固定第二新空库并核对 28 migrations 和完整 4/6 链 |
| 清理/资源 | PASS | 主库 28 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；任务库/备份/临时目录/测试镜像/build 产物删除，resource-guard 保留 |
| Python/SQLite | PASS / PROTECTED | 三项基线使用内部/临时 SQLite 通过；常驻 Python PID `13737` 未重启，真实 SQLite metadata `53827608:1544192:1784999031:1784999031`、mode 600 不变，未读写业务正文 |
| 资源观测 | PASS | 起点 available 约 2.4 GiB、Swap 约 86 MiB、磁盘约 21 GiB；最终 available 2.4 GiB、Swap 111 MiB、磁盘 21 GiB、Load `0.49/0.44/0.51`；独立 60 秒 Swap 正增长 0，RestartCount 0、OOMKilled false |
| 排除事项 | ENFORCED | 未自动创建 IPQC/FQC，未执行 FQC/Shipment/AR/财务、返工/返修、failed/scrap 库存、批次/设备/产能、真实迁移、Python 服务操作、HTTPS/防火墙、生产部署、push、PR 或 TASK05 |
| 完成结论 | PASS | `PRODUCTION OPERATION IPQC GATE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK03 末工序产出绑定、正式报工与成品入库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `1dae9661d07f7af7e866a1654804742372b8bc76` 严格基于 `a6448ac42da737e31fee76085fb699e80f3c621b`；聚焦修正 `1a01172f14e9d4b3b51ec10430b188aa79efa96d`、`2eb5120bf98c9d45705cf96e2a25afb37cc154a3`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.27`；`0027` SHA-256/数据库 checksum `b226cc958215400c38f48c925e4b33c4e97723340aaf729d4da75322213b9c76`；0001—0026 未修改，Schema/journal/snapshot 一致 |
| 结构化来源权威 | PASS | 只消费同 Work Order 最后 Snapshot Operation 的有效 Run Report good；稳定 Allocation、numeric、CAS/行锁/幂等和 deferred guard 防超量/跨工单/非末序/伪造/修改，legacy 无 Snapshot 兼容 |
| 实际 HTTP 数量 | PASS | 四工序分批 `4/6`；final output `10→6→0`；有效 Report/Final Allocation/Completion/Completion Allocation 均 `4/6`；Ledger `+4/+6`、Balance 10，Work Order `10/10/10/0/10 COMPLETED` |
| 冲销与下游 | PASS | 无下游 Report 冲销恢复 final output 后重新报工；已有 Completion 阻止 Report 冲销；有效 Report 消费阻止 Run 冲销；IPQC/FQC/Shipment/Sales Source/AR/Settlement 0 |
| 权限/并发/回滚 | PASS | production/warehouse/manager/admin/quality 边界、sales 403、同 Key 重放/异正文冲突、Work Order/WIP/Report CAS、并发唯一消费、Completion 并发守恒、直接 SQL guard 和故障零半记录通过 |
| 自动验证 | PASS | TASK03 专项 12、适用回归 82，共 94 项；正式 typecheck、Schema consistency、lint 0 error/8 个既有 warning、Vinext build、928 文件凭据扫描、`git diff --check` 和 Python 三项通过 |
| 重启/恢复 | PASS | 整体串行停/启后完整事实与 Audit 51/Idempotency 41 保持；接受态停服备份 SHA-256 `16d63e5cbe1f85aa1a70f1414edb5a66d008faefe076b9739e92f9a71976f9f6` 恢复到第二新空库，核对 27 migrations 和完整 4/6 链 |
| 清理/资源 | PASS | 主库 27 migrations、唯一启用管理员、业务/Audit/Idempotency/验收账号/uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；任务测试/恢复库、备份/恢复目录和迁移容器删除，resource-guard 备份保留 |
| Python/SQLite | PASS / PROTECTED | Python PID `13737`、NRestarts 0；真实 SQLite inode `53827608`、size `1544192`、mode `600`、mtime 不变，只核验 metadata，未读写正文或重启服务 |
| 排除事项 | ENFORCED | 未自动创建品质、发货或财务事实；未执行返工/批次/设备/产能、真实迁移、HTTPS/80/443、防火墙、切流、生产部署、push、PR 或 TASK04 |
| 完成结论 | PASS | `STRUCTURED FINAL OUTPUT TO FINISHED GOODS ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-OPS-RESOURCE-GUARD-01 低资源服务器保护

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 严格 Parent `120e1524eaebd9d921cab6a036b3203bf7d39226`；独立提交消息 `ops: add low-resource server safeguards`，实际哈希以 Git log 为准 |
| 事故事实 | ROOT CAUSE UNKNOWN | 2026-07-27 曾发生服务器重启/不可用；没有证据证明 OOM，不做无证据归因 |
| Python 源保护 | PASS | 默认 16 活跃请求线程、1 秒 admission、去敏 503、30 秒 socket timeout，正常/异常可靠释放；专项 2/2 通过 |
| Python 运行保护 | CGROUP ACTIVE / THREAD CAP SOURCE ONLY | 起点 installed unit 已与源一致，实际 CPU 75%/MemoryHigh 512M/MemoryMax 768M/Tasks 256/NOFILE 4096；PID `13737`、restart 0、SQLite metadata 不变。本任务未复制、reload 或重启，16 线程源码须未来获准重启后生效 |
| Compose 配置 | PASS | PostgreSQL 0.75/768M/1G/128；Web 0.75/512M/768M/128；Worker 0.50/512M/768M/128；Migrate 0.75/768M/1G/128；Admin 0.50/512M/768M/128；Caddy 0.25/128M/192M/64 |
| Node/数据库边界 | PASS | Web/Worker heap 384 MiB；Worker 单 Job；每进程 pool max 10、PostgreSQL max 100；`/dev/shm` 64M 使用 9.1M，shared buffers 128MB，26 migrations 正常 |
| 运行更新 | PASS | 已验证 custom dump；不 build，以 `COMPOSE_PARALLEL_LIMIT=1` 逐个重建 Web/Worker，PostgreSQL 原容器保持 |
| Inspect/网络 | PASS | 三容器 NanoCPU/Memory/MemorySwap/PIDs 与目标一致；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口 |
| 数据/卷 | PASS | 26 migrations、唯一启用管理员、Audit/Idempotency/Operation Run 0；四卷名称、driver/scope、创建时间前后一致 |
| 60 秒观察 | PASS | available 约 2.2 GiB，Swap 43,180 KiB、增长 0，磁盘可用 26 GiB，Load 最终 0.05/0.14/0.32；restart 0、OOM false，PostgreSQL/Web healthy、Worker running |
| 验证 | PASS | 专项、self-test、smoke、临时 SQLite go-live、Compose config、systemd verify、受限 TypeScript check、环境守卫、凭据与 Git 检查串行通过 |
| 生产保护 | ENFORCED | 未启动 TASK03、未 push、未迁真实数据、未切流、未生产部署；资源保护不等于上线 |
| 完成结论 | PASS | `LOW RESOURCE SERVER SAFEGUARDS ACTIVE` |

## SELFHOST-PHASE5-TASK02 工序派工、执行事件与线性 WIP 流转

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `77ff520e8dbd4b04fdb96a4281934e2d7f2d8d9c` 严格基于 `d6554fcaea77cfe16320d98afcf9aed9c794bc3f`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.26`；`0026` SHA-256/数据库 checksum `b00e49aa4d4f8279372c5aab291ccfcbd54afc09ab284a6390a50fea9e66aca0`；0001—0025 未修改，Schema/journal/snapshot 一致 |
| Snapshot Operation 权威 | PASS | 执行稳定引用 Work Order Routing Snapshot Operation/Work Center/前后工序/assigned operator；不引用可变 Routing Version Operation，不以 `process_stage` 作为权威 |
| 实际 HTTP 数量 | PASS | 四工序锡膏印刷、SMT贴片、回流焊、AOI 分两批 `4/6` 贯穿；每工序 processed/good/scrap=`10/10/0`，前三工序未转移 WIP 0，末工序 final output available 10 |
| 最终报工边界 | PASS | Work Order `IN_PROGRESS`；Production Report 0、Completion 0、Finished Goods Ledger 0、Balance 0、IPQC/FQC 0；WIP 不写库存 |
| 权限/UI/Dashboard | PASS | production dispatch/execute，manager/admin 管理与 reverse，warehouse/quality 只读，其他写 403；三条原生页面和 READY/IN_PROGRESS/工序间 WIP/末序输出/WAITING 五项指标通过 |
| 并发/幂等/CAS | PASS | 重复/并发派工不超量，重复/并发开工仅一成功；同 Key 重放原结果、异正文冲突、expected version 与稳定锁顺序通过 |
| 守恒/冲销/回滚 | PASS | 前序 good 精确 Allocation，scrap 不流转，processed 不超派工；下游消费阻止冲销，无下游冲销恢复 WIP；事实不可变、直接 SQL guard 和故障零半记录通过 |
| 自动验证 | PASS | TASK02 unit/UI/PG/migration、Phase 4 TASK01—TASK10 PG/API 与 migration upgrade、Phase 5 TASK01、Production/Routing/Inventory/Dashboard、20 组正式 typecheck、Schema consistency、lint/build、916 文件凭证扫描、Python 三项及 `git diff --check` 通过 |
| 重启/恢复 | PASS | 整体重启后 `8|8|24|4|4|10|24` 的 Run/Report/Event/Operation Projection/WIP/final output/Audit 保持；停服备份 `backup-20260726T235722Z-77ff520e8dbd` 校验，新空恢复核对 `26|2|1|4|8|8|24|4|10|0|0|0` |
| 清理/资源 | PASS | 主库 26 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复/测试 SQLite/依赖卷/迁移容器删除 |
| Python/SQLite | PROTECTED / EXTERNAL PID CHANGE RECORDED | 可信起点 PID `277640` 与 SQLite metadata 均匹配；任务未执行 Python 重启或真实 SQLite 读写。并行等待期间外部变更使最终 Python PID 为 `13737`；最终 SQLite metadata 仍为 `64769:53827608:1784999031:1544192` |
| Git/生产保护 | PASS | 起点 clean、behind 0/ahead 40；本任务不 push、不建 PR、不改写历史，三个外部用户修改未纳入提交；未迁真实数据、未切流、未启 HTTPS、未生产部署 |
| 完成结论 | PASS | `PRODUCTION OPERATION EXECUTION AND WIP ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE5-TASK01 工艺路线、工作中心与工单工艺快照

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `8eedfa07573c37e46d93f208162a0842c8d90a48` 严格基于 `7485bb93dc4dad16fa5cfe54651bb8f82306a7d2`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.25`；`0025` SHA-256/数据库 checksum `39b1212df99d392739aa20b95859f3e2789fa287e23061006a34efc342c258f9`；0001—0024 未修改，Schema/journal/snapshot 一致 |
| Work Center | PASS | 实际 HTTP 创建 ACTIVE `SMT-PRINT`、`SMT-MOUNT`、`REFLOW`、`AOI`；code 标准化、唯一、不可改，启停 CAS/幂等/审计，历史引用不受停用影响 |
| Routing | PASS | v1 异人发布后含 10/20/30/40 四工序；v2 修改回流焊标准时间并发布，v1 保留 SUPERSEDED；服务端 digest、职责分离与并发唯一 current 通过 |
| Work Order Snapshot | PASS | 首张 released 工单固化 v1/4 Operations，新工单固化 v2；已发布路线和工单快照不可修改/删除；历史工单不猜测回填并显示 `LEGACY_UNSTRUCTURED` |
| 原子性 | PASS | Work Order RELEASE 同事务完成 BOM Snapshot、Requirement、Reservation=10、Routing Snapshot/Operations、Event/Audit/Idempotency；路线缺失及故障注入零半记录，Material Issue/Report/Completion 0 |
| 权限/UI/Dashboard | PASS | operations、engineering、manager/admin、production、planning 最小分权与越权 403；三条原生页面和四项权限裁剪指标通过，无工序开工/完工/报工按钮 |
| 并发/幂等/CAS/回滚 | PASS | 并发发布唯一 current、职责分离、同 Key 重放/异正文冲突、expected version、数据库 guard 与事务故障回滚通过 |
| 自动验证 | PASS | TASK01 unit/UI/PG/migration、Phase 4 TASK01—TASK10 与关联模块回归、正式 typecheck、Schema consistency、build、902 文件凭证扫描和 Python 三项通过；lint 0 error/6 既有 warning |
| 重启/恢复 | PASS | 整体重启后 4 Work Center、2 Routing、2 Snapshot、8 Snapshot Operations、7 Routing Event、11 Audit 保持；停服备份 `backup-20260726T144314Z-8eedfa07573c` 校验，新空恢复核对 `25|4|2|2|7|0|0|0` |
| 清理/资源 | PASS | 主库 25 migrations、唯一启用管理员、所有合成业务/审计/幂等与 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复/迁移资源删除 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` 未重启；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读取/修改业务正文 |
| 排除事项 | ENFORCED | 未执行派工、开工、完工、工序报工、WIP、返工、批次、设备、库存过账、真实数据迁移、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PRODUCTION ROUTING AND WORK ORDER SNAPSHOT ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK10 客户收款、供应商付款与项目收支追溯

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `23fef6098a88466b94fcac104bba9317ba310d15` 严格基于 `e63c726e0d274a8b7b654819794b4bd1044c6f82`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.24`；`0024` SHA-256/数据库 checksum `cab6f7679e91589cfe2c7fdecf9750b222b9212acbbd3341301c7a67ec2e9624`；0001—0023 未修改，Schema/journal/snapshot 一致 |
| Settlement 权威 | PASS | 复用 Finance Document/Settlement/Reversal；AR→RECEIPT、AP→PAYMENT，部分/多次核销、不可变追加式冲销、单事务 Event/Audit/Idempotency 与余额/version 投影 |
| 项目归属 | PASS | Sales/Purchase Source 行沿稳定外键归属 Project；缺链明确 UNATTRIBUTED；服务端数量×单价、digest、唯一/外键/守恒/直接 SQL guard，不回写历史来源 |
| 实际金额 | PASS | AR `80/120`、AP `48/72`；收款 `30/50/120`、付款 `48/30/42`；来源 `200/120`，AR/AP 未结 `0/0`，交易贡献/净现金 `80/80 CNY`，UNATTRIBUTED 0、冲销 0、银行写入 0 |
| 权限/UI/Dashboard | PASS | finance 写与冲销、manager/admin 项目汇总、sales/purchase 职责只读、engineering 本人项目去敏；越权 403；两条原生页面和六项按币种/权限指标通过 |
| 并发/幂等/CAS/回滚 | PASS | 并发核销不超额、同 Key 重放/异正文冲突、expected version、全额/重复/并发冲销、故障零半记录及 TASK05/TASK09 上游门禁通过 |
| 自动验证 | PASS | TASK10 unit/UI/PG/migration、TASK01—TASK09 PG/API 与 migration upgrade、相关模块回归、十组 Phase 4 typecheck、Schema consistency、build、884 文件凭证扫描和 Python 三项通过；lint 0 error/6 既有 warning |
| 重启/恢复 | PASS | 整体重启后全部 Document/Settlement/Allocation/Event/Audit/项目汇总保持；停服备份 `backup-20260726T133340Z-23fef6098a88` 校验，新空恢复精确核对 24 migrations、200/120 收支和归属 |
| 清理/资源 | PASS | 主库 24 migrations、唯一启用管理员、所有合成业务和 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复/检查资源删除 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` 未重启；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读取/修改业务正文 |
| 排除事项 | ENFORCED | 未连接银行、未迁真实数据，未实现总账/税票/汇率/成本会计/正式利润，未切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PROJECT RECEIPT PAYMENT AND CASHFLOW ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK09 销售发货、成品出库与应收交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `dfda1c5597cc576cd96f495e272e9fc59c851fa4` 严格基于 `d9ebfb4644bb9e0d07bfbf81d168d7babcd4bdea`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.23`；`0023` SHA-256/数据库 checksum `5f07c7aebe9513e040fa0ab2f31f5cd5a51faf64fe78516794cd0fd46309221d`；0001—0022 未修改，Schema/journal/snapshot 一致 |
| 关系与事务 | PASS | 发货指令/行/事件、执行行和 Shipment Line→FQC Release Allocation 关系化；单事务复用 Shipment、Inventory Ledger/Balance、SO 投影、Sales Source、Event/Audit/Idempotency |
| 权限 | PASS | sales 创建/提交/取消，warehouse 接收/退回/执行/受控冲销，finance 显式 AR，quality 只读消费；实际越权 403 通过 |
| 数量与金额 | PASS | Instruction 10；Shipment/FQC `4/6`；库存 `10→6→0`；SO `OPEN→PARTIALLY_SHIPPED→SHIPPED`；Sales Source `80/120`；显式 AR `80/120`；Settlement 0 |
| 并发/幂等/CAS | PASS | 指令/FQC/库存/订单容量、并发同指令与同 FQC、同 Source 并发 AR、同正文重放/异正文冲突、expected version 和稳定锁顺序均通过 |
| 冲销与回滚 | PASS | 无 AR 全额冲销恢复库存/SO/Instruction/FQC 并追加负来源；已有 AR 阻止冲销；审计/库存故障注入均零半记录，TASK08 FQC Reopen 门禁回归通过 |
| UI/Dashboard | PASS | `/sales/delivery`、`/warehouse/shipping`、`/finance/receivables` 实际 HTTP 200；五项权限裁剪指标完成 |
| 自动验证 | PASS | TASK09 unit/UI/PG/migration、TASK01—TASK08 及 Inventory/Finance/Dashboard 回归、28 个相关 unit/UI、17 个正式 typecheck、Schema consistency、build、874 文件凭证扫描和 Python 三项通过；lint 0 error/6 warnings |
| 重启/恢复 | PASS | Compose 整体重启后全事实保持；停服备份 `backup-20260726T105516Z-dfda1c5597cc` 校验，新空库恢复为 `23|7|1|2|10|-10|200|200|0` |
| 清理/资源 | PASS | 主库 23 migrations、唯一启用管理员、所有合成业务及 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时库/备份/恢复目录已删除 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` 未重启；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读取/修改业务正文 |
| 排除事项 | ENFORCED | 未收款、未创建 Settlement、未执行银行/总账/税票/收入确认、真实迁移、HTTPS/80/443、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `FQC RELEASE TO SHIPMENT AND RECEIVABLE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK08 生产过程检验、成品订单归属与 FQC 放行

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `4a638522b7ca295b41d2f35adbc464b23762b007` 严格基于 `7d9c2dbaf62664e46c4f984822bb43903999f5fd`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | 源码和并行环境均为 `0.1.0-alpha.22`；`0022` SHA-256/数据库 checksum `65b31aec91ad30ffd309796f58500a73c47a20bc12f855e010a4b4f17e808155`；0001—0021 未修改，Schema/journal/snapshot 一致 |
| 关系与事务 | PASS | 复用唯一 `quality-selfhost`；Completion Line→Sales Order Line Allocation/Event 为关系化稳定来源，FQC 只接收 Allocation ID，Inspection/Result/Defect/Event、处置、关闭、审计和幂等保持同事务 |
| 权限与职责 | PASS | sales 创建/取消分配，quality 创建/关闭检验，manager/admin 处置/重开，production/warehouse 受限读取；实际 403 和创建人不得最终处置通过 |
| 规则与保护 | PASS | 客户/产品/版本/成品/单位一致、双侧容量、并发锁、CAS、超检、FAIL/Defect 守恒、RELEASE/CONCESSION 上限、REWORK/SCRAP HOLD、已消费放行门禁和故障零半记录通过 |
| UI/Dashboard | PASS | `/sales/finished-goods-allocation`、`/quality/production` 真实 HTTP 200；loading/empty/403/CAS/幂等未知状态契约及五项权限裁剪指标通过 |
| 实际 HTTP | PASS | Report `4/6`、Completion `4/6`、Allocation `4/6`、IPQC `4/6`、FQC `4/6`；FQC inspected/passed/released=`10/10/10`，订单行 available=10 |
| 零副作用 | PASS | IPQC 前后 Work Order version、Completion 数量与库存不变；最终成品库存 10，Shipment、Sales Financial Source、AR 均为 0 |
| 专项与回归 | PASS | TASK08 unit/UI 5/5、PG 12/12、migration 3/3；TASK01—TASK07、Production/Quality/Sales/Inventory/Dashboard 回归、16 组正式 typecheck、Schema consistency、lint 0 error/5 既有 warning、build、858 文件凭证扫描和 Python 三项通过 |
| 重启/恢复 | PASS | Compose 整体重启后 Allocation/Inspection/Result/Event/放行额度/库存/审计持久；停服备份 `backup-20260726T062301Z-4a638522b7ca` 校验并恢复到新空库，精确核对 `22:2:4:4:12:10:10:0:0:0` |
| 清理/资源 | PASS | 主库 22 migrations、唯一启用管理员、业务表与 uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷；临时数据库、备份、恢复目录、容器和镜像已删除 |
| Python/SQLite | PASS / PROTECTED | Python systemd active、PID `277640`、监听 18888；真实 SQLite 只核验 metadata `64769:53827608:1784999031:1544192`，未读取/修改业务正文且未重启 |
| 排除事项 | ENFORCED | 未执行 Shipment、库存扣减、销售金额来源、AR、收款、真实迁移、HTTPS/80/443、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PRODUCTION QUALITY RELEASE ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK07 生产报工 → 分批完工 → 成品入库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `323e85d44a2a4202811944591d0a4f6b96ae6751` 严格基于 `26ccb95782478645720c8284c59b0afadca68649`；独立 ops 验收提交以 Git log 为准 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | 源码和并行环境均为 `0.1.0-alpha.21`；`0021` SHA-256/数据库 checksum `1cf953d98da2d3a7703f3866b852cbe10bdb37b33e1826cb78b24079fc5a11ec`；0001—0020 未修改，Schema/journal/snapshot 一致 |
| 关系与事务 | PASS | 复用既有 Report/Completion/Inventory；Allocation 显式消费 good，Completion 与成品 Ledger/Balance、工单状态、事件、审计和幂等同事务 |
| 规则与保护 | PASS | 领料支持量、good/scrap、Report/工单余量、CAS/并发/幂等/故障回滚、403、scrap 零库存以及 IPQC/FQC/Shipment 冲销门禁均通过隔离测试 |
| UI/Dashboard | PASS | `/production/reporting`、`/warehouse/production-completions`、工单八项进度和四项权限裁剪指标完成；待品质仅为只读提示 |
| 专项与回归 | PASS | TASK07 unit/UI/PG/migration，TASK01—TASK06、Production/Inventory/Quality/Sales/Dashboard、正式 typecheck、Schema consistency、lint/build、凭证扫描和 Python 隔离三项通过 |
| 实际 HTTP | PASS | 完整领料 10 后 Report `4/6`、Completion/Allocation/Ledger `4/6`；reported/good/completed=10、scrap=0、Balance=10、Work Order=`COMPLETED` 且不 `CLOSED` |
| 下游零事实 | PASS | IQC/IPQC/FQC、Shipment、销售金额来源、AR 均为 0；报工/入库未自动创建后续事实 |
| 重启/恢复 | PASS | 整体重启持久；接受态与干净态停服备份均校验并恢复到新空库，分别核对完整 4/6 链与 21 migrations/唯一管理员/业务 0 |
| 清理/资源 | PASS | 主库 21 migrations、唯一启用管理员、业务表合计 0、uploads/attachments 0；仅 PostgreSQL/Web/Worker 三容器和四卷，临时数据库/备份/恢复点/容器/镜像已删除 |
| 排除事项 | ENFORCED | 未创建品质、发货或财务事实；未迁真实数据、启用 HTTPS/80/443、切流、生产部署、push 或 PR |
| 完成结论 | PASS | `PRODUCTION REPORTING AND FINISHED GOODS RECEIPT ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK06 计划 → 生产工单 → 齐套预留 → 仓库领料

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / PARALLEL ACCEPTED | 功能提交 `a8272b7c968e0fdcbce017aa0e41bad281702e50`，严格 Parent `b45616e1115aab7d22d1b9a7e58f792005291524`；独立 ops 提交消息为 `ops: accept production material issue workflow in parallel environment`。PHASE0-TASK03/TASK05 保持历史 DONE |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.20`；仅新增 `0020_production_handoff_reservations.sql`，SHA-256 `1164536d51fbcf2f022c45aeab54b2b1ebc3d20cb2e4caabba9341d63fb4e182`；0001—0019 不修改，Schema/journal/snapshot/并行数据库 checksum 一致 |
| 关系模型 | PASS / ISOLATED | 版本化 Handoff/Item/Event、Handoff Item→Work Order 唯一链接、Reservation/Event；完整稳定外键、numeric/状态/digest 约束、来源 trigger、Service GUC 和不可变 guard |
| 事务复用 | PASS / ISOLATED | 交接调用既有 Production Work Order 事务入口；RELEASE 原子创建既有 BOM Snapshot/Requirement 和新 Reservation 来源事实；Issue/Return 原子复用既有 Inventory Ledger/Balance |
| 权限/API/UI | PASS / HTTP | planning 准备/提交，production 退回/接收/建单/释放，warehouse 领退料，manager/admin 管理；三条原生页面实际 HTTP 200，四项 Dashboard 待办按权限裁剪 |
| 实际主旅程 | PASS / HTTP | ACCEPTED Package 数量 10、BOM `1×10`、采购收货库存 10；v1 RETURNED→新 v2 ACCEPTED→唯一 DRAFT；DRAFT reserved/Issue/Ledger=0；RELEASE required/on-hand/reserved/available=`10/10/10/0`；领 4 后 `6/6/4`，再领 6 后 `0/0/10`、WO IN_PROGRESS、出库 Ledger 合计 -10 |
| 下游零写入 | PASS | Production Report 0、Completion 0、Finished Goods Ledger 0、IQC/IPQC/FQC 0；未触发报工、完工、成品或品质链 |
| 关键保护 | PASS | 缺料零半记录、并发预留、重复工单、超领、幂等重放/冲突、CAS、故障注入、未领取消释放、已领取消阻止、退料恢复和未授权 403 通过 |
| Migration | PASS / ISOLATED | 空库、0019→0020、重复执行、失败回滚通过；Drizzle `check` 通过 |
| 全量回归 | PASS / LOCAL+ISOLATED | TASK01—TASK05、Planning、Inventory、Production、Dashboard、14 组正式 typecheck、lint 0 error、Vinext build、凭证/环境/API coverage、Python 三项与 `git diff --check` 通过 |
| Compose/恢复 | PASS | 0019 前置备份已校验；整栈重启后 Handoff/WO/Reservation/Issue/余额及下游零事实保持；接受态 0020 停服备份恢复到新空库为 `20/2/1/1/2`；最终干净 0020 备份再次恢复为 20 migrations/唯一管理员/业务 0 |
| 清理/最终环境 | PASS | `chenyida-erp-parallel` 最终仅 PostgreSQL/Web/Worker 三容器和四个持久卷；20 migrations、唯一启用管理员、所有业务表 0、uploads/attachments 0；Web 仅 `127.0.0.1:3000`，PostgreSQL 无宿主端口 |
| Python/SQLite | PASS / PROTECTED | Python 三项使用隔离临时库通过；systemd `enabled/active`、PID `277640`、监听 18888；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，Python 代码无差异且未重启 |
| 完成结论 | PASS | `PLANNING TO PRODUCTION MATERIAL ISSUE ACCEPTED IN PARALLEL ENVIRONMENT` |
| 排除事项 | ENFORCED | 报工、完工、成品库存、IQC/IPQC/FQC、发货、付款/银行/总账/税票、真实迁移、HTTPS、切流和生产部署未授权 |

## PHASE0-TASK03 统一发布、迁移与回退追踪基线复核

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-24 原始发布基线保持不变；2026-07-26 按实际代码、Git、运行环境和只读数据库状态追加复核，独立提交消息为 `docs: establish self-hosted release tracking baseline` |
| Git 起点 | PASS | `main` / `3ae79f167a22bd8c5bb8120e2b5e8356f59d89b4`，起始工作区 clean；`git ls-remote` 核验 `origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`，任务开始时本地领先 27 个提交 |
| 发布版本 | PASS / NON-PRODUCTION | 原始自托管发布定义保留为 `0.1.0-alpha.1`/PG `0001`—`0005`；当前 package 与 lock 根包均为 `chenyida-erp-selfhosted@0.1.0-alpha.19`，没有修改 package 或依赖 |
| Migration | PASS / READ-ONLY | PostgreSQL 仓库及并行库均为 `0001`—`0019` 且 19 个 checksum 一致；D1 仓库为 `0000`—`0008`；SQLite 仓库及本机只读记录均为 `0001`—`0004` |
| 运行面 | PASS / READ-ONLY | Python systemd `enabled/active`，PID `277640`、`0.0.0.0:18888`，部署 unit 与仓库源码 SHA-256 一致；并行 Compose PostgreSQL/Web healthy、Worker running，Web 仅 `127.0.0.1:3000`、PostgreSQL 无宿主端口 |
| 业务迁移 | NOT MIGRATED | Node/PostgreSQL 已有完整 ERP API 非生产实现及合成/并行验收，但真实业务数据、账号和文件未迁移；采购、库存、生产、销售、品质、财务的实际业务继续依赖 Python/SQLite |
| Node 验证 | PASS | 一次性 Node 22 容器：lint 0 error/5 个既有 warning；`npm test` 3/3；`typecheck:review`；Vinext build 5/5；凭证扫描 819 个仓库文件。凭证扫描首次因只挂载子目录导致非 Git 工作区而未执行，改为只读挂载完整仓库后通过，未降低断言 |
| Python 验证 | PASS | `/opt/erp/.venv/bin/python`：`server.py --self-test`、`smoke_test.py`、临时 `CYD_ERP_DB` 的 `go_live_check.py --no-backup` 全部通过；临时数据库已清理 |
| 范围检查 | PASS | 仅修改项目/任务/自托管文档；未修改业务代码、Schema、migration、package、依赖或部署配置；`git diff --check` 与最终 diff 范围在提交前复核 |
| 生产影响 | NONE | 未访问公开生产 Site、生产 D1 或生产数据库；未部署、未迁移真实数据、未创建云资源、未修改或重启 systemd、未 push 或创建 PR |
| 下一任务 | HISTORICAL STOP | PHASE0-TASK03 当时已停止；之后 TASK06 由项目负责人单独明确授权。真实迁移、HTTPS、生产备份恢复、容量、安全整改和切流仍须另立任务批准 |

## SELFHOST-PHASE4-TASK05 定标 → 采购订单 → 收货 → 应付交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `859454c97acddbff8c5199d91c41d636a6ca24e0`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.19`；仅新增 `0019_sourcing_purchase_fulfillment.sql`；SHA-256 `6e517f6d2beffc74c94dcd5c5d60c9bcdc5baf9c93711a6add6cec4a08ed989a`；0001—0018 不修改 |
| 关系模型 | PASS | Award Line→PO Line 唯一来源、到货计划/待入库队列、Receipt Line 分配和不可变状态事件；外键、唯一约束、numeric 精度、索引和数据库 guard 完整 |
| 事务复用 | PASS | 编排服务在同一事务调用既有 Procurement/Inventory 权威入口，原子提交 Receipt、PO/Plan、Ledger/Balance、purchase source、Event/Audit/Idempotency；Finance 仍显式创建 AP |
| 权限/API | PASS | purchase 转单/计划、warehouse 收货/按规则冲销、finance 生成 AP，manager/admin 管理；无权限请求 403；CSRF、正文上限、持久幂等、CAS、行锁和稳定错误通过 |
| UI/Dashboard | PASS | `/procurement/fulfillment`、`/warehouse/receiving`、`/finance/payables` 均实际 HTTP 200 且可操作；Dashboard 区分“已收货待生成应付”和“已生成应付” |
| 实际数量金额 | PASS | Award/PO/Plan `10 × 12 CNY`；计划时 Receipt/Ledger/AP=0；首收 4→PARTIAL/库存4/来源48/AP48；次收6→COMPLETED/PO RECEIVED/库存10/来源72/AP72；AP 总额120 |
| 保护/并发 | PASS | 同正文重放、异正文冲突、CAS、并发唯一转单、超收、故障注入零半记录通过；有 PO 阻止 Award 撤销，有 AP 阻止 Receipt 冲销 |
| 专项/共享回归 | PASS | TASK05 unit/UI/PG/migration；TASK01—TASK04、Identity、Master Data、Supplier Mapping、Procurement、Inventory、Finance、Dashboard、FileStorage、环境与 Worker 回归通过 |
| 静态与构建 | PASS | 全部正式 typecheck、Schema consistency、ESLint 0 error/5 既有 warning、Vinext build 5/5、凭证扫描、`git diff --check` |
| 备份/重启/恢复 | PASS | 0018 前置恢复点和干净 0019 恢复点校验；Compose 整体重启后全链持久；停服备份恢复到第二个新空库为 19 migrations/唯一用户，随后恢复当前干净 0019 |
| 清理/最终数据库 | PASS | 19 migrations、唯一启用管理员、0 临时账号；Customer/Product/Material/BOM/Project/Planning/PR/RFQ/Award/PO/Plan/Receipt/Ledger/Balance/Source/AP 均为 0，uploads/attachments 文件为 0 |
| Python/SQLite | PASS / PROTECTED | Python 三项通过；PID `277640`、18888 HTTP 200；真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变且未读业务正文 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running；Web 仅 `127.0.0.1:3000`，PG 无宿主端口；最终三容器约 233.1 MiB，宿主可用内存约 2.12 GiB、磁盘可用约 25 GiB |
| 完成结论 | PASS | `SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`；未启动 TASK06 |

## SELFHOST-PHASE4-TASK04 供应商询价、报价、比价与人工定标

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `4506db2579c07080afe27b33bb2e50623c3d1366`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.18`；expand-only `0018_procurement_sourcing.sql`；SHA-256 `64276e1292c0696ae097a322115662b958156ba6486b1cd16752cf84b6c987c9`；0001—0017 不修改 |
| 模型/比较 | PASS | 十表关系模型；CNY/Unit/Tax/Freight 分组，PostgreSQL numeric 按单价/交期/Supplier ID 排序；过期不排名，浏览器不重算 |
| API/安全 | PASS | 9 组路由、purchase/planning 分权、CSRF、128 KiB、持久幂等、CAS、并发唯一、request_id、Audit/Event 同事务 |
| UI/Dashboard | PASS | `/procurement/sourcing` 与详情页；报价历史、横向比较、MOQ/交期/税费/运费、人工理由/撤销；三项 Dashboard 待办 |
| 专项 | PASS | unit/UI 6/6、PG/API 2/2、migration 3/3、Schema consistency、目标 typecheck；覆盖两供应商、两次修订、过期/口径/MOQ/晚交期、非最低价、SOLE_SOURCE、并发与故障回滚 |
| 共享回归 | PASS | Identity、Supplier Mapping/Master Data、Procurement、Project、Planning、Material Requirement、Dashboard 的 unit/UI/PG/migration 通过；FileStorage 3/3、API coverage 2/2、environment 6/6 |
| 静态与构建 | PASS | 全仓 ESLint 0 error（5 个既有 warning）、Vinext build 5/5、800 文件凭证扫描、`git diff --check` |
| Python/SQLite | PASS / PROTECTED | Python self-test、smoke、临时 SQLite go-live 通过；PID `277640`/18888 保持，真实 SQLite metadata `64769:53827608:1784999031:1544192` 不变，未读业务内容 |
| 下游保护 | PASS | 隔离验收 Award=1 时 PO/Receipt/Inventory Ledger/Finance/Planning Allocation 均为 0，`reserved_qty` 不变 |
| 实际定标 | PASS | A `12.000000`/排名 2/准时，B `10.000000`/排名 1/晚交；以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”人工选择 A；5 个 Sourcing Event、6 个成功采购审计 |
| 并行环境 | PASS | 0017 与干净 0018 root-only 恢复点均校验；真实 HTTP、planning 只读/purchase 写入、UI 200、幂等重放、Compose 整体重启持久通过；随后整体恢复干净 0018 点并删除临时工件 |
| 清理/最终状态 | PASS | 18 migrations/唯一启用管理员；临时账号及 Customer/Supplier/Material/Project/PR/RFQ/Quote/Comparison/Award 全为 0；PO/Receipt/Inventory/Finance/Planning Allocation 全为 0 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running；Web 仅 `127.0.0.1:3000`；三容器约 180.4 MiB，宿主可用内存约 1812 MiB、磁盘可用 27 GiB |
| 完成结论 | PASS | `PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`；TASK05 不启动 |

## SELFHOST-PHASE4-TASK03 计划物料需求 → 采购申请交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `5009b9118901a01af6a5faed194b8444d0c1e969`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.17`；并行 PostgreSQL `0001`—`0017`；`0017` SHA-256 `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28`；0001—0016 未修改 |
| 来源/数量 | PASS | 只读取最新 ACCEPTED Package 固化快照，Material+Unit 聚合；全部数量由 PostgreSQL `numeric(24,6)` 计算与保存 |
| 分配/并发 | PASS | 提交时锁定重算；其他有效计划库存/在途分配扣减，双计划不重复占用；Planning Allocation 不修改 Inventory `reserved_qty` |
| 状态/不可变 | PASS | DRAFT→SUBMITTED→RETURNED；新 v2→SUBMITTED→ACCEPTED；计划行、分配、申请行、事件不可变，退回后旧分配不再有效 |
| API/安全 | PASS | 7 组路由、planning/purchase 分权、manager/admin 全能力、CSRF、持久幂等、稳定冲突、request_id、Audit 和单事务 |
| UI/Dashboard | PASS | 计划需求和采购接收两条原生路由；已接收包、版本、重算结果、分配、事件、待采购接收指标可见 |
| 专项/共享回归 | PASS | TASK03 unit/UI 6/6、PG/API 3/3、migration 3/3；TASK02 12/12、Dashboard PG 2/2、migration tool 8/8、FileStorage 3/3、相关单元 34/34 |
| 静态与构建 | PASS | TASK03 typecheck、全仓 ESLint、Vinext 5/5 build、780 文件凭证扫描、`git diff --check` |
| 实际核算 | PASS | `100.000000 - 55.000000 - 40.000000 = 5.000000`；v1 退回释放，v2 重算重提并接收；`reserved_qty=10.000000` 不变 |
| 下游边界 | PASS | 接收不新增 RFQ/供应商/比价/PO；新增 PO 0、Receipt 0、Work Order 0，不进入生产 |
| 持久/恢复 | PASS | Compose 重启后 v2 Plan/PR ACCEPTED；恢复干净 `0016` 点后重新应用 `0017`，最终 17 migrations/唯一管理员/业务 0 |
| Python/SQLite | PASS / PROTECTED | Python PID `277640` alive、18888 HTTP 200；Python 三项通过，未读取或修改真实 SQLite 业务内容 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running、仅回环 3000；三容器约 293.5 MiB，宿主可用内存约 1749 MiB、磁盘 29 GiB |
| 完成结论 | PASS | `PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`；TASK04 不自动启动 |

## SELFHOST-PHASE4-TASK02 项目 → 计划交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `9236884f6cd96385c9c7050b29f57e7268142208`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.16`；并行 PostgreSQL `0001`—`0016`；`0016` SHA-256 `26d6e4cc609a53403b377d8550fcf5d8fd88f677178681f4cca1692544bb2076`；0001—0015 未修改 |
| 角色/权限 | PASS | planning 正式角色；engineering prepare/submit，planning accept，manager/admin 全部；production 无接收/提交能力 |
| 状态/快照 | PASS | DRAFT→SUBMITTED→RETURNED；新 v2→RESUBMITTED→ACCEPTED；Product/BOM/Material/文件安全快照不可变 |
| API/安全 | PASS | 8 API、CSRF、正文上限、持久幂等、CAS、并发唯一接收、职责分离、单事务 Audit/request_id |
| UI | PASS | engineering 解析/预览/历史/重提，planning 待办/详情/退回/接收/历史，Dashboard 计划部门入口 |
| 专项 | PASS | unit/UI 6/6、PostgreSQL/API 3/3、migration upgrade 3/3；故障注入零半记录、文件路径/正文不披露 |
| 共享回归 | PASS | Identity/Master/Material/Project unit/UI 31/31、PG/API 21/21、migration 10/10；Dashboard 10/10、manifest 8/8、FileStorage 3/3、environment 6/6 |
| 静态与构建 | PASS | Schema consistency、TASK02 typecheck、全仓 lint、Vinext 5/5 build、761 文件凭证扫描、`git diff --check` |
| Python/SQLite | PASS / PROTECTED | 临时 SQLite self-test/smoke/go-live；PID 277640/18888 与真实 SQLite metadata `53827608:1544192:1784963637:600` 不变，未读业务内容 |
| 并行环境 | PASS | 真实 HTTP 完成项目接收、解析、v1 提交/退回、v2 修订重提/最终接收；Compose 重启后数据库、队列 API 与 UI 持久 |
| 清理/最终状态 | PASS | 恢复干净 0016 点；16 migrations、唯一启用管理员；临时账号及 Customer/Product/Material/BOM/Project/Planning/采购/生产记录为 0 |
| Compose/资源 | PASS | PostgreSQL/Web healthy、Worker running；三容器约 133 MiB，宿主可用内存约 1971 MiB、磁盘可用 31 GiB |
| 下游边界 | PASS | 未计算净需求，未创建物料需求、采购申请、采购订单或生产事实；不自动启动 TASK03 |
| 完成结论 | PASS | `PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE4-TASK01 市场 → 项目交接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `6bbec3f490033dcfef0dd00d3c8af179f5674b60`；独立 ops 验收提交 |
| 版本/Migration | PASS / PARALLEL DEPLOYED | `0.1.0-alpha.15`；`0015` SHA-256 `419a80cb1ec3daad614f23b89895c9e8e3679bee40f506b0d0a811aba98a546f`；0001—0014 未修改 |
| 状态机 | PASS | DRAFT→SUBMITTED→ACCEPTED、SUBMITTED→RETURNED→修订→RESUBMITTED→ACCEPTED；需求/事件不可变 |
| API/安全 | PASS | sales/engineering 分权、CSRF、持久幂等/CAS、并发一次接收、职责分离、事务 Audit/request_id、文件安全引用 |
| UI | PASS | 市场/项目两条原生路由、加载/空/错误/权限/刷新恢复、退回原因和安全元数据合同通过 |
| Migration | PASS | 空库 0001→0015、0014 管理员升级、重复执行、失败回滚、约束/索引/服务写守卫 3/3 |
| 专项/共享回归 | PASS | Project unit/UI 7/7、PG/API 3/3；Identity/Master/Sales unit/UI 21/21、PG/API 14/14；manifest 8/8 |
| 静态与构建 | PASS | TASK01 typecheck、全仓 lint、Vinext build 5/5、凭证扫描、`git diff --check` |
| Python/SQLite | PASS / PROTECTED | 临时 SQLite self-test/smoke/go-live 通过；PID 277640/18888 保持；真实 SQLite 只做 metadata stat，未读取或修改 |
| 实际闭环 | PASS | 双账号覆盖直接接收与退回→需求 v2→重提→最终接收；重启后 2 ACCEPTED/3版本/完整事件/9 Audit 持久 |
| 清理/最终状态 | PASS | 恢复 0015 空数据点；15 migrations、唯一管理员；临时账号/Customer/Project/Event=0；Web/PG healthy、Worker running |
| 完成结论 | PASS | `MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT` |

## SELFHOST-PHASE3-TASK05 同机并行 HTTP 验收环境

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、父提交 `7c39ff9b2c50786a225fe788ec5e3b6fb9f91dc2`；独立提交消息 `ops: deploy parallel self-hosted acceptance environment` |
| Compose | PASS / RUNNING | 项目 `chenyida-erp-parallel`；PostgreSQL healthy、migrate exited 0、Web healthy、Worker running，四个持久 Volume 保留 |
| HTTP 安全边界 | PASS | `ERP_ENV=development`；Web 仅 `127.0.0.1:3000`，通过 SSH 隧道验收；PostgreSQL 无宿主端口，Caddy/80/443/DNS/防火墙未变 |
| Migration/版本 | PASS | PostgreSQL 17.10；`0001`—`0014` 共 14 个；版本保持 `0.1.0-alpha.14`，未创建 `0015` |
| 管理员 | PASS | 唯一 `admin`，重复初始化 `SETUP_COMPLETE`；setup token 已轮换；临时密码只存 root-only 0600 文件且未进长期 env/Git |
| HTTP 验收 | PASS | health、根工作台、login/session/logout、空 Dashboard、23/23 legacy GET 均通过；0 个物料、无真实业务数据 |
| Worker 重启韧性 | PASS | 修复 PostgreSQL restart 的 Pool `57P01` 未捕获错误；专项 2/2、typecheck/lint/build、Worker 容器连续性与最终 HTTP 回归通过 |
| 资源 | PASS | 最终可用内存约 2.2GiB、swap 约 441MiB 已用且 20 秒复测未继续增长、磁盘可用 36GB、load `0.63/0.90/0.85`；三常驻容器约 145MiB，未触发停止条件 |
| Python/SQLite | PASS / UNCHANGED | PID `277640`、18888 HTTP 200；SQLite inode `53827608`、mode 0600、size 1544192 bytes、mtime 不变；未读取/迁移/修改真实业务数据 |
| 完成结论 | PASS | `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`；未切流、未启 HTTPS、未生产上线、未 push/PR |

## SELFHOST-PHASE3-TASK04 本机真实 SQLite 只读盘点与脱敏 Dry-run

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、可信起点 `a541360eefe12869c090b2408bbcf07485fc77cb`；独立提交消息 `feat: add authorized readonly migration inventory` |
| 只读快照 | PASS | SQLite online backup；`integrity_check=ok`；29 表、3,619 条、Schema fingerprint 已完成；源 inode/mode/权限不变 |
| 运行面保护 | PASS | Python PID 前后 `277640`；未停止/重启；快照与临时目录已删除、不可恢复 |
| 脱敏 Dry-run | PASS | planned 49、archive-only 3,566、needs-review 4、blocked/model-gap/orphan 0；target `NONE`，materialization/files `DISABLED` |
| Opening 计划 | PASS / NOT MATERIALIZED | Inventory 4 条、on-hand 20,010、frozen 0；Finance 0；创建数均为 0 |
| 报告安全 | PASS | 只保留聚合和 opaque reference 模板；绝对源路径、source ID、PII/业务正文、凭证和逐单金额未入报告 |
| 专项/回归 | PASS | TASK04 3/3、tool 8/8、unit/UI 98/98、npm 3/3、PG/API 73、upgrade 30、backup/restore、全 HTTP journey、8 组 typecheck、lint/build/environment/credentials 与 Python 三项通过 |
| Migration/版本 | PASS / NOT RELEASED | `0.1.0-alpha.14`；保持 0001—0014、未创建 0015，checksum 与 `db/schema.ts` 不变；未发布或部署 |
| 完成结论 | PASS | `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE` |
| 生产准入 | NO-GO | 未执行真实 PostgreSQL 试迁移、D1/文件盘点、附件核对、生产恢复、部署或切换 |

## SELFHOST-PHASE3-TASK03 合成全域业务表物化与 Dashboard 核对

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、可信起点 `8f30798464476b53f435d53022c45ed731804e95`；独立提交消息 `feat: materialize synthetic migration into business tables` |
| Public materializer | PASS | 仅显式 CLI；30 条合成来源形成 18 个 actual public targets、12 个 archive-only；actual ID/source/target digest、request/operation/checkpoint 齐全 |
| Identity/主数据/BOM | PASS | 迁移账号 disabled+must-change 且无旧 hash；稳定 Unit/Category/Material/Party/Product/Version/Mapping/BOM ID；code/引用/有效期冲突 fail closed |
| Opening/文件 | PASS | Inventory on-hand/frozen `112.000000/4.000000`；Opening AR/AP `6.500000/7.250000`；17-byte 文件原子写与 SHA `19ae05a8872e4000652f2efe7e9123cfc5e64aa2d69f9afb5511f80e21d66346` |
| Post-cutover journey | PASS | 正常 Service/API 完成 Procurement、Production、Sales、IQC/IPQC/FQC 和 Finance；不重放来源历史活动 |
| Dashboard/API | PASS | AR/AP `56.500001/27.250000`，Quality CLOSED 4，23/23 legacy GET；角色裁剪通过，`erp_records=0` |
| 恢复/重放 | PASS | backup/verify→第二个新空目标；14 migrations、18 maps、关键业务表和文件 SHA 一致；同 manifest replay 无重复，PG/Web/Worker 整体重启后再核对通过 |
| 专项/回归 | PASS | tool 8/8、materializer PG 3/3、Opening/TASK01 专项、TASK02—TASK10 unit/UI、全部 PG/API 与 migration upgrade、8 组 typecheck、Schema consistency、npm test、lint/build/environment/credentials、Python 三项 |
| Migration/版本 | PASS / NOT RELEASED | `0.1.0-alpha.13`；保持 0001—0014、未创建 0015、旧 checksum 与 `db/schema.ts` 不变；未发布或部署 |
| 合成结论 | PASS | `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION` |
| 生产准入 | NO-GO | 未读取真实 source/账号/历史活动/文件，未验证真实容量、安全、生产恢复或切换；`NO-GO FOR REAL DATA / PRODUCTION` |
| 资源/生产影响 | NONE | TASK03 临时 Compose/数据库/文件/备份最终清理；Python PID `277640` 未重启，未访问生产、部署、push 或 PR |

## SELFHOST-PHASE3-TASK02 库存与财务期初来源及迁移物化边界

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、可信起点 `2c808f7a2ba2c293ff22e5dcc3ca3647a479a91c`；独立提交消息 `feat: add controlled migration opening balances` |
| MG-001 | RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL | 关系化 `OPENING_AR/AP`，不伪造 Shipment/Receipt；主体互斥、CNY、正数六位金额、核销/冲销和 Dashboard 通过 |
| MG-002 | RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL | `MIGRATION_OPENING` Adjustment/Ledger/Balance 同事务；Base Unit、MAIN/空 lot、冻结边界、消费后冲销拒绝通过 |
| Migration | PASS | expand-only `0014_migration_openings.sql`，SHA-256 `61f65ef3d588bfbf178f3dd9ba196886fa18fb3ecca119a151f6a3bc0bc5a99b`；空库/0013升级/重复/失败回滚/零回填通过，旧 checksum 不变 |
| 安全/事务 | PASS | 无 HTTP 写路由；内部 GUC + DB trigger；digest conflict、幂等、并发和注入失败整体回滚通过 |
| 合成核对 | PASS | 4 来源；库存 2 条、Ledger/Balance 均为 on-hand `112.000000` / frozen `4.000000`；AR `6.500000 CNY`、AP `7.250000 CNY` |
| 专项/回归 | PASS | unit 3/3、PG 2/2、migration 3/3、tool 8/8；既有 PG/API 42/42、Material/Mapping/Normalization/Review 20/20、upgrade 30/30；typecheck/build/lint/environment/credentials/Python 三项通过 |
| Compose/恢复 | PASS | PostgreSQL/Web/Worker 构建、健康和重启通过；停服 backup/verify 恢复到全新空库后 14 migrations、来源、Ledger/Balance、AR/AP 全部一致 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.12`；未发布、部署、迁真实数据或批准生产 |
| 生产准入 | NO-GO | 未读取真实源，未验证真实余额/主体/单位/冻结/规模/附件/异故障域；`NO-GO FOR REAL DATA / PRODUCTION` |
| 资源/生产影响 | NONE | 隔离容器/网络/卷/数据库/备份/临时目录已清理；Python PID `277640` 未重启，未访问生产、部署、push 或 PR |

## SELFHOST-PHASE3-TASK01 生产前数据迁移框架与合成试迁移

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `14bc68791a34ece9086b889f23d473e84a761cf0`；独立提交消息 `feat: add synthetic migration readiness tooling` |
| 迁移框架 | PASS | 显式 CLI、SQLite/D1 export、manifest、mapping/ID map、digest checkpoint、dry-run、synthetic commit、reconcile、去敏报告 |
| 安全守卫 | PASS | source read/target connect 前拒绝 production、真实路径、非回环/非测试/非空目标、备份/上传/附件/归档和敏感 manifest 字段 |
| 合成 E2E | PASS | 28 records、45 relations、28 ID maps、0 orphan；库存 `112.000000`、AR/AP `19.000000`；中断恢复和重复执行后 `RECONCILED` |
| Backup/Compose | PASS | 新空目标 restore 后 13 migrations 与合成 staging 一致；PostgreSQL/Web/Worker 重启后健康和数据保持 |
| 专项/回归 | PASS | tool 8/8、PG E2E 1/1、非数据库 87/87、PG/API 67/67、upgrade 27/27、typecheck 8/8、build/lint/credentials 与 Python 三项 |
| PostgreSQL migration | PASS / NO CHANGE | 0001—0013 checksum 不变，head `0013_finance.sql`，未创建 `0014`，业务 schema 未修改 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.11`；非生产、尚未发布、部署、迁真实数据或批准 |
| 生产准入 | NO-GO | staging 未物化真实业务表；真实 source、Dashboard、Finance opening、文件、容量和生产恢复未验证 |
| 资源/生产影响 | NONE | 最终清理隔离 PostgreSQL/Compose/临时目录；未打开真实数据库、重启 Python、访问生产、部署、push 或创建 PR |

## SELFHOST-PHASE2-TASK10 自托管经营与运维工作台

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `06a4413403869f4f41872c7a5cb98c434a44f095`；任务独立提交消息 `feat: add self-hosted operations workbench` |
| Dashboard | PASS | 独立实时只读 Query Service；TASK02—TASK09 权威关系表、权限裁剪、numeric 文本、库存不跨单位聚合、系统审计最小披露 |
| 根工作台/legacy | PASS | 根 `/` 无 iframe；setup/login/must-change/logout 与卡片独立状态通过；`/erp/index.html` 仅显式白名单 tab 深链 |
| API 覆盖 | PASS | Python 64 项最终为 COVERED 52、REPLACED 2、RETIRED 10、未知/404 0；legacy 23 个刷新 GET 在源全域库和恢复目标均逐项运行 200；浏览器备份 create/restore 返回稳定离线操作错误 |
| Backup/restore | PASS | custom dump、文件 tar、manifest、migration/SHA/size 校验；隔离 PostgreSQL 新空目标恢复 13 个 migration 与合成文件逐字节一致；危险/损坏/非空目标拒绝 |
| Compose | PASS | 空卷依次贯穿 TASK02→TASK10；恢复到第二个新空 Compose 后 PostgreSQL/Web/Worker 整体重启，角色裁剪、23 GET、`0013`、跨域事实、Session、文件 SHA 和 backup `VERIFIED` 持久 |
| 专项/回归 | PASS | Dashboard unit/UI/coverage 10/10；全量非数据库 selfhost 87/87、PostgreSQL/API 67/67、migration upgrade 27/27、environment 6/6、TASK03—TASK10 typecheck、build、lint 0 error/1 条既有 warning、623 文件凭证与 Python 三项通过 |
| PostgreSQL migration | PASS / NO CHANGE | 保持 `0001`—`0013`；实时查询不需要 projection/outbox，未创建 `0014` |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.10`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | TASK10 隔离 PostgreSQL/Compose/临时文件在最终核对后清理；未访问生产、迁真实数据、执行生产备份恢复、部署、push 或 PR |

## SELFHOST-PHASE2-TASK09 自托管应收应付与不可变收付款

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `ee3e6585d5f0366187f62ef3f6012c3abaf28150`；0001—0012 checksum 保持不变 |
| 模块/数据边界 | PASS | 独立 `finance-selfhost`；AR=Shipment 金额来源、AP=Receipt 金额来源，稳定 Customer/Supplier/User ID，不写 D1/`erp_records` |
| 金额/状态/不可变 | PASS | PostgreSQL numeric(24,6)；OPEN/PARTIALLY_SETTLED/SETTLED，Document 事实与 Settlement/Event append-only，直接数据库越权写 fail closed |
| 收付款/冲销 | PASS | 每笔核销单一 Document、不超余额、expected version；原 Receipt/Payment 最多一次全额负事实冲销，投影和 Event 同事务恢复 |
| 上游门禁 | PASS | 已形成财务 Document 的 Shipment/Receipt 来源不能再由 Sales/Procurement 直接冲销；未财务过账的既有冲销流程回归通过 |
| 权限与安全 | PASS | post/pay/reverse 与 scoped read 分离；must-change、CSRF、正文上限、持久幂等、限流、CAS、请求编号、中文安全错误和事务审计通过 |
| PostgreSQL migration | PASS | `0013` 空库、0012 存量、重复、失败回滚、约束/索引/guard、legacy 保留通过；SHA-256 `8c52efe69d836fadf4f2841caab6dad140c51d0b78e37612cbcbac46076c45a1` |
| 专项/Compose | PASS | Finance unit/UI 4/4、PG/API 3/3、migration 3/3；Compose 首次及 Web/Worker 重启持久性通过 |
| 适用回归 | PASS | Procurement PG 7/7、Sales 3/3、Quality 8/8、FileStorage 3/3、environment 6/6、lint/typecheck/build/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.9`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | TASK09 Compose 容器/网络/卷、隔离 PostgreSQL 和临时 SQLite 均已清理；未访问生产、迁真实金额、部署、push 或 PR |

## SELFHOST-PHASE2-TASK08 自托管品质闭环与 FQC 发货门禁

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `0ad0687a7b2f2502f68babbef1455df2a983421b`；0001—0011 checksum 保持不变 |
| 模块/数据边界 | PASS | 独立 `quality-selfhost`；IQC=Receipt Line、IPQC=Production Report、FQC=Completion Line+SO Line，稳定 Material/Unit/User ID，不写 D1/`erp_records` |
| 状态与不可变 | PASS | OPEN/PENDING、异人处置、关闭、manager/admin 重开；Result/Defect/Event append-only，Header 仅受控投影，直接数据库越权写 fail closed |
| FQC 联动 | PASS | Shipment 只消费 CLOSED/RELEASED 额度；不足阻断、冲销恢复额度、已消费时禁止重开；与 SO/Inventory 原事务及锁顺序整合 |
| IQC/IPQC 边界 | PASS | 只建立 Receipt Line/Report 品质权威记录，不改已过账采购/生产事实；无批次/隔离库位时不伪造 pooled inventory freeze |
| 权限与安全 | PASS | read/inspect/defect/disposition/close/reopen 分离；职责分离、must-change、CSRF、正文上限、持久幂等、限流、CAS、请求编号和事务审计通过 |
| PostgreSQL migration | PASS | `0012` 空库、0011 存量、重复、失败回滚、约束/索引/guard、legacy 保留通过；SHA-256 `64f065783769c0913af482402199b10f9224a1a81e52c30a3b8a087978bcd5bf` |
| 专项/Compose | PASS | unit/UI 5/5、Quality PG/API 8/8、migration 3/3、Sales PG 3/3；Compose 初始及 Web/Worker 重启持久性通过 |
| 适用回归 | PASS | shared unit/UI 70/70、Identity/Master/Inventory/Procurement/Production PG、FileStorage 3/3、environment 6/6、lint/typecheck/build/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.8`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | TASK08 Compose 容器/网络/卷和隔离测试资源已清理；未访问生产、迁真实检验数据、部署、push 或 PR |

## SELFHOST-PHASE2-TASK07 自托管销售与库存联动

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `97d541ecfb7fe6fff551c750c69f5cf30e3ff5bc`；合法 TASK07 dirty 全部保留并原地续作，0001—0010 无变化 |
| 模块/数据边界 | PASS | 独立 `sales-selfhost`；稳定 Customer/Product Version/Material/Unit/Inventory/User ID，不写 Python、D1 或 `erp_records` |
| 报价/转单 | PASS | DRAFT Version/Line、显式状态事件、只有 ACCEPTED 可原子转换一次；SO/Link/投影/audit/idem 同事务 |
| 发货/冲销原子性 | PASS | Shipment/全额 reversal、SO 投影、TASK04 Ledger/Balance、状态、金额来源、audit、idem 同事务；故障注入和审计失败整体回滚 |
| 金额/约束/并发 | PASS | CNY numeric(24,6) 服务端计算；ACTIVE/STOCKED/基础单位/客户限制、超发/负库存、并发编码/转换/发货和 expected version 均 fail closed |
| 权限与兼容 | PASS | quote/order/ship/reverse/finance source 服务端分离；legacy API/UI 只转换稳定 ID 并委托同一 Service，CSRF/限流/请求编号/中文错误通过 |
| PostgreSQL migration | PASS | `0011` 空库、0010 存量、重复、失败回滚、约束/索引/不可变 guard、旧数据保留通过；SHA-256 `6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`，0001—0010 不变 |
| 专项/Compose | PASS | unit/UI 5/5、PostgreSQL/API 3/3、migration 3/3、Schema consistency；Compose 初始及 PostgreSQL/Web/Worker 重启持久性通过 |
| 全量回归 | PASS | shared unit/UI 65/65、PG 54/54、升级 21/21、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.7`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离 PostgreSQL、Compose、临时 SQLite/文件已清理；未访问生产、迁真实销售数据、部署、push 或 PR |

## SELFHOST-PHASE2-TASK06 自托管生产与库存联动

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、起点 `b4a7d5cde06df0b8982e7f120afd9f72c13af8d2`、clean、本地相对 `origin/main +6/-0`；无嵌套仓库或来源不明修改 |
| 模块/数据边界 | PASS | 独立 `production-selfhost`；稳定 Product/BOM/Material/Unit/Inventory/User ID，不写 Python、D1 或 `erp_records` |
| 工单/快照 | PASS | 固定状态机、并发安全编码、RELEASE 单事务复制不可变 BOM 快照并用 PostgreSQL numeric 计算需求；新 BOM 不影响旧 WO |
| 领退料/完工原子性 | PASS | Production 事实、TASK04 Ledger/Balance、状态、audit、idem 同事务；故障注入与审计失败整体回滚 |
| 约束/并发 | PASS | 客户专用料、ACTIVE/STOCKED/基础单位、超领/超退/错误报工/超产、expected version、并发完工和幂等冲突均 fail closed |
| 权限与兼容 | PASS | plan/issue/report/complete/close 服务端分离；legacy API 只转换 DTO 并委托同一 Service，CSRF/限流/请求编号/中文错误通过 |
| PostgreSQL migration | PASS | `0010` 空库、0009 存量、重复、失败回滚、约束/索引/不可变 guard、旧数据保留通过；SHA-256 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`，0001—0009 不变 |
| 专项/Compose | PASS | unit/UI 4/4、PostgreSQL/API 5/5、migration 3/3、Schema consistency；Compose 初始及 PostgreSQL/Web/Worker 重启持久性通过 |
| 全量回归 | PASS | shared unit/UI 60/60、PG 51/51、升级 18/18、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.6`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离 PostgreSQL、Compose、临时 SQLite/依赖/文件已清理；未访问生产、迁真实生产数据、部署、push 或 PR |

## SELFHOST-PHASE2-TASK05 自托管采购与收货

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 恢复点 | PASS | `main`、HEAD `41b451de04d4bc4b5e3f6fe765ff64fbc19a9121`；合法 TASK05 dirty 全部保留并原地续作，0001—0008 无变化 |
| 模块/数据边界 | PASS | 独立 `procurement-selfhost`；PO/Receipt 使用稳定 Supplier/Material/Unit/Mapping ID，不写 Python、D1 或 `erp_records` |
| 状态与不可变 | PASS | `OPEN -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED`；Receipt/Line/Status/Source/Financial append-only，全额冲销追加反向事实 |
| 收货原子性 | PASS | Receipt、PO 投影、TASK04 Ledger/Balance、状态事件、财务来源、audit、idem 同一事务；故障注入/审计失败整体回滚 |
| 建议与引用 | PASS | RELEASED 当前 BOM + 可用库存 + ACTIVE Material/Supplier/Unit/Mapping + 当前价格；阻断项不自动建 PO，不允许超收或单位换算 |
| 权限与安全 | PASS | 管理/收货/只读/财务来源能力分离；must-change、CSRF、持久幂等、限流、expected version、请求编号和中文安全错误通过 |
| PostgreSQL migration | PASS | `0009` 空库、0008 存量、重复、失败回滚、约束/索引、旧数据保留通过；SHA-256 `351b322f562e39bf0e17cf16cd6da20de6d801ff33f7692300a85c15403874d7`，0001—0008 不变 |
| 专项/Compose | PASS | unit/UI 5/5、PostgreSQL/API 7/7、migration 3/3、Schema consistency；Compose 初始及 PostgreSQL/Web/Worker 重启持久性通过 |
| 全量回归 | PASS | shared unit/UI 56/56、PG 46/46、升级 15/15、Import 53/53、FileStorage/environment、lint/build/typecheck/credentials、Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.5`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离 PostgreSQL、Compose、临时 SQLite/依赖/文件已清理；未访问生产、部署、push 或 PR |

## SELFHOST-PHASE2-TASK04 自托管不可变库存账本

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 起点 | PASS | `main`、HEAD `3565d56f24ca904dd0b8d0c55960c702a8895406`、clean、本地相对 `origin/main +4/-0`；无 submodule/gitlink/嵌套仓库 |
| 模块/数据边界 | PASS | 独立 `inventory-selfhost`；稳定 Material/Unit ID，旧文本库存表仅作迁移来源，不回填/双写/返回，不实现 PO/WO/SO 单据 |
| 不可变与余额 | PASS | Ledger 为权威、Balance 为同事务可核对投影；数据库拒绝直接余额写及已过账 Header/Line/Ledger UPDATE/DELETE |
| 业务与并发 | PASS | RECEIPT/ISSUE/ADJUSTMENT/FREEZE/UNFREEZE/REVERSAL；禁止负库存/负可用量，expected version、稳定多行锁、一次全额冲销和失败回滚通过 |
| API/UI/BOM | PASS | inventory/ledger/reconciliation/adjustment/detail/post/reverse；legacy 写引用稳定 ID；BOM readiness 读取新投影并返回真实 shortage |
| 权限与安全 | PASS | read/adjust/reverse 分离；Session/must-change、CSRF、正文上限、限流、24h 幂等、请求编号、安全错误及成功/失败审计通过 |
| PostgreSQL migration | PASS | `0008` 空库、0007存量、重复、强制失败回滚、约束/索引、旧用户/session/legacy库存保留通过；SHA-256 `49334afa405d03b61568559edcdffa68c232c899251181e3a27ff271aa1da80b`，0001—0007不变 |
| 专项/Compose | PASS | unit 3/3、UI 2/2、PostgreSQL/API 3/3、migration 3/3；Compose 初始与 PostgreSQL/Web/Worker 重启持久性通过，容器/网络/卷清理 |
| 适用回归 | PASS WITH BASELINE DEBT | Identity/Material/Mapping/Normalization/Review/Phase0、build/lint/typecheck/凭证、Python三项通过；旧导入 UI 未改文件的 6 条源码正则断言为起点既有失败，未跨域修补，parser/file-inspector/adaptive 49/49通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.4`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离资源清理；未访问生产、迁移真实库存、部署、重启 Python systemd、push 或 PR |

## SELFHOST-PHASE2-TASK03 自托管主数据与 BOM

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 起点 | PASS | `main`、HEAD `2784a9a064838ebbb76f2bce8c97ebeb1eb8befb`、clean、本地相对 `origin/main +3/-0`；无 submodule/gitlink/嵌套仓库 |
| 模块边界 | PASS | 独立 `master-data-selfhost`、`bom-selfhost`；Node/PostgreSQL 权威，不写 Python/SQLite、D1 或 `erp_records` |
| 数据模型 | PASS | Customer/Supplier/Product/Product Version/BOM Header/Version/Line 与 business code sequence 关系化；Supplier Mapping 扩展稳定 FK、状态/版本/有效期，价格历史只追加 |
| 发布不可变 | PASS | Product/BOM DRAFT→RELEASED；数据库 trigger 拒绝发布版本及 BOM Lines UPDATE/DELETE，修订创建新版本 |
| API 与 legacy 契约 | PASS | items/mappings/products/customers/suppliers/boms/bom-lines/bom-readiness 兼容路径和版本/状态/价格路径通过；ACTIVE Material 投影，readiness 不查库存 |
| 权限与安全 | PASS | sales/purchase/engineering 固定服务端能力；Session/must-change、CSRF、正文上限、60/20 限流、24h 幂等、CAS/锁、请求编号和安全错误通过 |
| 事务与审计 | PASS | 业务、审计、幂等结果同事务；失败回滚不留业务/idempotency，失败审计最小披露；并发 code 唯一、mapping 有效期不重叠 |
| PostgreSQL migration | PASS | `0007` 空库、0006升级、重复、失败回滚、约束/索引、旧用户/session/mapping 保留通过；SHA-256 `0e9cf9327b37673eb09483035117d15789047862f348cd5eb7098476d62fd3a6`，0001—0006不变 |
| 专项测试 | PASS | unit 2/2、UI 2/2、PostgreSQL/API 3/3、migration 3/3；typecheck 与 Schema consistency 通过 |
| Compose | PASS | 空库迁移与 Customer→Product→BOM→Supplier Mapping/Price E2E；PostgreSQL/Web 重启后数据和审计持久，容器/网络/卷已清理 |
| 回归 | PASS | Node 基础、Identity、Material、Mapping、Normalization、Review、Phase0 PostgreSQL/Worker、旧升级、build/lint/typecheck/凭证及 Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.3`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 隔离测试资源清理；未访问生产、迁移真实数据、部署、重启 Python systemd、push 或 PR |

## SELFHOST-PHASE2-TASK02 自托管身份安全边界

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 模块边界 | PASS | 独立 `identity-selfhost` Types/Errors/Password/Permissions/Repository/Service/Handler；`selfhost-api.ts` 只委托并注入可信 actor/全局门禁 |
| API | PASS | setup/login/logout/session 安全重构；本人改密、用户列表/创建/启停/重置及系统审计查询均通过隔离 API 测试 |
| 权限与 must-change | PASS | 十角色只由服务端映射；admin-only 管理/审计；must-change 只允许 session/logout/本人改密，Material 与其他受保护 API 统一 403 |
| 密码与 Cookie | PASS | 12—128、四类至少三类、弱口令/用户名/相同密码拒绝；PBKDF2-SHA256 310k；development HTTP 不强制 Secure，production 内部 HTTP 仍强制 Secure |
| 会话撤销 | PASS | token 只存 SHA-256；停用/重置撤销全部，本人改密保留当前并撤销其他；旧会话立即 `SESSION_REVOKED` |
| 限流/幂等/CAS | PASS | 登录 5/15min；身份写 60 attempts/20 new keys/min；完成重放不计新 Key；四接口持久幂等、异正文冲突、expected version 和失败回滚通过 |
| 并发保护 | PASS | 用户名并发唯一；事务 advisory lock + CAS 使并发停用管理员后仍至少保留一个 active admin；禁止自停用、自重置 |
| 系统审计 | PASS | admin-only、有界分页/筛选、最小 DTO；actor/target/action/result/request/operation/version/error/time 可查，无密码、Token、Cookie、hash 或正文 |
| PostgreSQL migration | PASS | `0006` 空库、0005升级、重复、失败回滚、约束/索引、旧合成用户/session 保留通过；SHA-256 `6e185d01a69c4bd132c577793ae72baceaa075e5beecc738bcdf4310430d7079`，0001—0005不变 |
| 专项测试 | PASS | unit 8/8、UI 4/4、PostgreSQL/API 8/8、migration 4/4 |
| Compose | PASS | setup→admin login→purchase创建/临时登录/must-change/改密/Material读取→停用/撤销→启用/重置/再次must-change→审计；Web/PostgreSQL 重启后 user version、审计与撤销持久 |
| 回归 | PASS | npm基础、Material、Mapping、Normalization、Review、Phase0 PostgreSQL/Worker、旧升级、typecheck、build、lint、凭证及 Python 三项通过 |
| 版本 | PASS / NOT RELEASED | `chenyida-erp-selfhosted@0.1.0-alpha.2`；非生产、尚未发布、部署或批准 |
| 资源/生产影响 | NONE | 一次性 Compose 与 PostgreSQL 资源清理；未访问生产、迁移真实用户、部署、重启 Python systemd、push 或 PR |

## SELFHOST-PHASE2-TASK01 完整 ERP API 盘点与迁移计划

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 起始基线 | PASS | 根仓库 `main`、HEAD `12d3ea30d21cce6918de0c525d81f19af289f5ac`、工作区 clean；本地 `main` 领先 `origin/main` 1 个提交 |
| 运行面结论 | CONFIRMED | Python/SQLite 仍支撑完整 ERP；Node/PostgreSQL 只完成 Material、Import Mapping、Normalization、Review，不得由已存在表推断业务 API 已迁移 |
| Python API | PASS | 共 64 个 HTTP 操作：身份与系统 11、基础主数据/工程/物料治理 22、采购与库存 9、生产 6、销售 7、品质 3、财务 6 |
| 自托管覆盖 | RECORDED | 等价覆盖 4、部分覆盖 9、未覆盖 51；“部分覆盖”不代表 legacy method/path 可用 |
| legacy iframe | BROKEN | 根页面仍加载 `/erp/index.html`；登录后 `refreshAll()` 的 23 个并发业务 GET 均不在 `selfhost-api.ts` 路由中并返回 404，整批刷新失败 |
| 数据与事务 | RECORDED | 稳定 ID、BOM 引用、库存/订单/应收应付联动、不可原地修改的过账记录，以及单事务、幂等、CAS、request id、审计要求均已列明 |
| 迁移顺序 | PROPOSED | 建议 `TASK02`—`TASK10` 依次覆盖身份、主数据、库存、采购、生产、销售、品质、财务、看板/备份/退出 iframe；均待项目负责人逐项授权 |
| 变更边界 | PASS | 仅新增/更新项目文档；未修改业务代码、Schema、migration、依赖或部署配置 |
| 验证 | PASS WITH EXISTING WARNING | lint 0 error/1 个既有 warning；npm test 3/3；review typecheck、Vinext build、凭证扫描、Python self-test/smoke/临时 SQLite go-live 与 diff check 通过 |
| 生产影响 | NONE | 未访问公开生产 Site、生产 D1 或生产数据库；未读取真实业务数据、部署、执行 migration、重启服务、push 或创建 PR |

## PHASE0-TASK03 统一发布、迁移与回退追踪基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Git 基线 | PASS | 任务开始时根仓库 `main`、HEAD `39946f6b854a985b5c19106eaa6c938bddaf9c7c`、工作区 clean；缓存和 `git ls-remote` 均确认 `origin/main` 同一提交；只有根 `.git` |
| TASK04 后续提交 | PASS | SELFHOST Phase 0 与 Phase 1 Task01—04 已由 `39946f6` 汇总提交；TASK04 完成报告保留原任务结束时 dirty/未提交事实并追加后续结果 |
| 发布版本 | PASS | 新自托管包名 `chenyida-erp-selfhosted`，版本 `0.1.0-alpha.1`；明确为非生产、尚未发布、未批准 |
| 运行面 | PASS | Python/SQLite systemd 开发服务 `enabled/active`，监听 `0.0.0.0:18888`；unit 源码与安装文件一致；Node/PostgreSQL 无运行中 Compose 项目 |
| PostgreSQL migration | PASS | `0001`—`0005` 文件及 SHA-256 已建立基线；只在既有隔离 PostgreSQL 17/Compose 验收，未生产执行 |
| D1 migration | PASS | 历史 `0000`—`0008` 文件及 SHA-256 已建立基线；未访问生产 D1，生产实际版本未核验 |
| SQLite migration | PASS | 文件 `0001`—`0004` 及 SHA-256 已建立基线；开发库只读记录四个版本，数据库表本身不保存 checksum |
| 业务迁移范围 | RECORDED | 自托管 API 仅完成 Material/Import/Normalization/Review 关键链路；完整 ERP 尚未迁移，采购、库存、生产、销售、品质、财务仍依赖 Python/SQLite |
| 发布/回退模板 | PASS | `RELEASES.md` 覆盖 Git/version、migration 前后、快照恢复点、四类 migration 验证、测试、安全、HTTPS、备份恢复、容量、批准执行和回退条件 |
| 本任务验证 | PASS WITH RECORDED WARNING | lint 0 error/1既有warning；npm test 3/3；review typecheck；Vinext build 5/5；凭证扫描455文件；项目虚拟环境 Python self-test/smoke/临时库go-live；diff check通过 |
| 生产影响 | NONE | 未访问公开生产 Site、生产 D1 或生产数据库；未部署、迁移真实数据、重启 systemd、创建云资源、push 或 PR |

## SELFHOST-PHASE1-TASK04 人工复核与 Material 安全衔接

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 数据分层 | PASS | Parser raw、Mapping snapshot、Normalization candidates/attributes/lineage/issues保持不可变；人工覆盖独立保存 |
| PostgreSQL migration | PASS | `0005`十一表、42个索引、FK/唯一/大小/互斥/终态trigger；空库、重复runner、0004升级通过，0001～0004未改 |
| Session/版本/CAS | PASS | 固定published run/mapping digest，Review历史和supersedes可读；Session/Row expected_version冲突409 |
| 覆盖和值模型 | PASS | 核心/动态属性SET/CLEAR/REVERT revision历史；effective只按override→candidate，不回退raw |
| Issue | PASS | 原Issue不改；WARNING确认、ERROR排除/对应SET覆盖解决；Worker validation issue稳定key去重 |
| ACTIVE绑定 | PASS | 服务端分页精确选择，Worker最终重查ACTIVE，唯一binding和安全快照；不修改ACTIVE |
| Material Draft | PASS | 调用TASK01 Material Service；结果DRAFT、无code、未submit/approve；稳定link/operation防重 |
| Finalization | PASS | Outbox、100行prepare/50行process、行级事务、lease/heartbeat、部分失败和retry；全部完成才FINALIZED |
| 权限与API | PASS | Session、细粒度权限、CSRF、Idempotency-Key+正文摘要、分页/筛选、稳定400/401/403/404/409/422/500 |
| UI | PASS | 保留七步、view/row/Drawer；增加三层值、覆盖、决定、Issue、ACTIVE、Draft、批量、历史、进度和冲突提示 |
| 专项测试 | PASS | unit7/7、UI3/3、PG3/3，共13/13 |
| 回归 | PASS | 39个unit/UI/environment、25个PG和2个旧migration upgrade，共66个Node test；101行跨chunk和lease接管通过 |
| Build/Lint/安全 | PASS WITH EXISTING WARNING | strict定向TS、Vinext build、454文件凭证扫描、diff check通过；lint 0 error/1任务前warning |
| Compose | PASS | 3行VALID/WARNING/ERROR完成覆盖/排除/绑定/Draft/finalize；整栈重启后2版本、binding和DRAFT保持 |
| 资源清理 | PASS | TASK04 Compose容器、网络和卷已删除；独立PG测试容器在最终检查后删除 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、push或PR |
| 已知限制 | RECORDED | Compose批次仅3行，101行与lease失效接管由PG集成验证；无真实样本容量验收和多租户schema |

## SELFHOST-PHASE1-TASK03 行级 Normalization PostgreSQL 全链路

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 唯一运行数据库 | PASS | 自托管 Normalizer、Review API 与 Worker 只访问 PostgreSQL；D1/Miniflare/Cloudflare 仅保留为迁移参照 |
| PostgreSQL migration | PASS | `0004`、schema、journal、snapshot 对齐；空库0001→0004、重复runner、0003存量升级、约束和不可变trigger通过 |
| 候选与证据 | PASS | 核心字段、动态属性、lineage和稳定ERROR/WARNING issue关系化保存；动态属性使用稳定attribute_code |
| 状态与恢复 | PASS | QUEUED→RUNNING→PUBLISHING→SUCCEEDED/SUPERSEDED，FAILED同run重试、新run重跑和CANCEL_REQUESTED/CANCELLED通过 |
| 原子发布 | PASS | run隔离暂存不可见；lease/CAS、pointer、统计、Event/Audit和Job success同事务；失败/丢lease/取消不发布 |
| API与安全 | PASS | Session、权限、行级可见性、CSRF、强幂等、expected version、分页/筛选边界、稳定错误和请求编号通过 |
| Review UI | PASS | 运行历史、run-specific Rows/Issues、状态/问题筛选、raw/candidates/attributes/lineage及重试/重跑/取消通过 |
| 专项测试 | PASS | unit4/4、UI3/3、PG/API4/4、旧数据升级1/1，共12/12 |
| 回归 | PASS | FileStorage、Phase0 Worker、Material、Mapping和环境保护共41/41；strict定向类型检查和build通过 |
| Lint | PASS WITH WARNING | 0 error；保留任务前 workbook 脚本1个unused warning |
| Compose | PASS | CSV解析→Mapping确认→Normalization v1发布→v2重跑→v3取消；整栈stop/up后3行、2 issues、3次run历史和lineage保持 |
| 资源清理 | PASS | 一次性Compose容器/网络/卷、独立PG测试容器和临时migration目录已删除，核对列表为空 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、push或PR |
| 后续范围 | RECORDED | 人工最终复核、保留/排除、ACTIVE绑定、Draft Commit、真实迁移和生产切换必须独立任务与授权 |

## SELFHOST-PHASE1-TASK02 Import Mapping PostgreSQL 全链路

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 唯一运行数据库 | PASS | 自托管 Mapping、版本、复用和动态 Catalog 只访问 PostgreSQL；不导入 D1/Miniflare/Cloudflare 运行时 |
| PostgreSQL migration | PASS | `0003`、schema、journal、snapshot 对齐；空库、旧数据升级、runner 重复执行、约束和不可变 trigger 通过 |
| Parse 原子发布 | PASS | Worker 同事务发布 parse run、Sheet、Header 建议、不可变 Rows、初始 DRAFT、pointer 和事件；Compose 实际 CSV 3 行 |
| Mapping/Catalog | PASS | ACTIVE 动态属性稳定 code、BASIC/SPECIAL 目标、源结构/metadata/mapping digest、保存/预览/确认通过 |
| 版本不可变 | PASS | CONFIRMED/STALE/SUPERSEDED 内容和 Items 受 DB trigger 保护；重复 digest 拒绝，新确认版本使旧确认版本 SUPERSEDED |
| 复用与失效 | PASS | exact 为 AUTO_RECOMMEND；metadata 漂移需重确认；已用目标类型变化为 STALE；应用复用只生成/更新 DRAFT 且来源不变 |
| 安全与事务 | PASS | Session、权限、行级可见性、CSRF、Idempotency-Key+正文摘要、乐观锁、并发、稳定错误、Event/Audit同事务 |
| 专项测试 | PASS | 规则3/3、UI2/2、PG/API6/6、旧数据升级1/1 |
| 回归 | PASS | Material 6/6+2/2+7/7、FileStorage3/3、PG/Worker5/5、环境6/6、strict定向类型检查、build通过 |
| Lint | PASS WITH WARNING | 0 error；保留任务前 workbook 脚本 1 个 unused warning |
| Compose | PASS | 空卷迁移、登录、上传、Worker解析、DRAFT保存、2行预览、v2确认、版本查询；Web/Worker重启后状态仍为确认 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、push 或 PR |
| 后续范围 | RECORDED | 行级 Normalizer/Review/Draft Commit、真实迁移和生产切换必须独立任务与授权 |

## SELFHOST-PHASE1-TASK01 Material PostgreSQL 全链路

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 唯一运行数据库 | PASS | 自托管 Material Draft/Review/Active 只经 `material-selfhost` Repository访问 PostgreSQL；不导入D1/Miniflare/Cloudflare运行时 |
| PostgreSQL migration | PASS | `0002` 新增编码序列、2个索引和2个状态/编码约束；空库应用、重复执行和Schema/snapshot/journal一致性通过 |
| 草稿与属性 | PASS | 实际页面契约覆盖创建、完整替换编辑、详情、列表/筛选、四级分类和TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM类型化属性 |
| 固定审批 | PASS | DRAFT→PENDING_REVIEW→ACTIVE、驳回→DRAFT；创建人/最后修改人自审403，无审核权限403，第二名授权用户通过 |
| 编码并发 | PASS | PostgreSQL原子分类序列，不使用MAX+1；不同连接并发批准生成不同 `CYD-*` 编码，失败事务无半记录 |
| 安全与一致性 | PASS | Session、细粒度权限、CSRF、Idempotency-Key+正文摘要、重放/冲突、expected_version、行锁、统一安全错误与请求编号通过 |
| 版本/变更/审计 | PASS | 创建、编辑、提交、通过/驳回的主记录、属性、版本、变更、审计和幂等结果均为单事务；新增受权审计历史页面 |
| 单元/UI/PG/API | PASS | 6/6、2/2、7/7；既有Material UI 142/142回归通过 |
| Phase 0回归 | PASS | FileStorage 3/3、PostgreSQL/Worker 5/5、Vinext build通过 |
| Lint | PASS WITH WARNING | 0 error；最小修复既有prefer-const阻断，保留workbook脚本1个任务前unused warning |
| 凭证/差异/依赖扫描 | PASS | 402个文件凭证扫描、`git diff --check`通过；新Material模块无Cloudflare/D1/R2/Queue/Miniflare运行引用 |
| Compose冒烟 | PASS | 真实Web登录、创建/编辑/提交、两类拒绝、第二用户批准、ACTIVE/4版本/8变更/6审计查询；重启PG/Web/Worker后持久 |
| 生产影响 | NONE | 未连接生产、迁移真实数据、部署、提交、推送或创建PR |
| 后续范围 | RECORDED | TASK02移植Import Mapping/版本/复用；行级Normalizer、真实数据迁移与生产切换继续独立授权 |

## SELFHOST-PHASE0-TASK01 自托管基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 运行架构 | PASS | Vinext standalone Node Web + PostgreSQL 17 + 本地持久卷 + 独立 Node Worker；运行入口不依赖 OpenAI Site/Cloudflare |
| PostgreSQL baseline | PASS | 新 `0001` 共 46 表：现有 45 张业务/治理结构加 `background_jobs`；Drizzle PostgreSQL schema/snapshot 对齐，空库和重复执行通过 |
| 管理员与分类 | PASS | 无默认密码；一次性 CLI 初始化 1 个 admin、101 分类、34 属性；登录和会话 cookie/CSRF 通过 |
| Material | PASS (CORE) | 分类 tree/schema、草稿创建/查询、权限与审计链路通过；完整旧 Draft/Review/Query Repository 仍待逐域移植 |
| 文件 | PASS | 随机路径、路径穿越拒绝、SHA-256/大小/MIME/原名、临时文件+fsync+原子 rename、持久卷和非 root 读取通过 |
| Worker | PASS | Outbox、`FOR UPDATE SKIP LOCKED`、租约、心跳、CAS、重试、超时恢复、幂等、原子结果发布和安全停机；CSV 实际解析 3 行，CSV/XLS/XLSX 共用既有有界 Parser，纯 Parser 38/38 |
| 单元测试 | PASS 3/3 | 路径安全、原子写、失败清理 |
| PostgreSQL 集成 | PASS 5/5 | migration/约束、transaction rollback、Outbox 幂等、4 Worker 并发唯一领取、heartbeat/retry/expired recovery |
| Compose 冒烟 | PASS | build、health、admin、login、101 分类、草稿、上传、任务完成；PostgreSQL/Web/Worker 整体重启后 2 Material、2 File、2 SUCCEEDED Job 和 SHA 文件保持 |
| 备份恢复 | PASS | 隔离实例生成 PostgreSQL custom dump、uploads/attachments tar 和 SHA256SUMS；恢复到显式新空库/空目录后 1 User、2 Material、2 SUCCEEDED Job 一致 |
| 生产影响 | NONE | 未连接生产数据库、迁移真实数据、部署公网、修改真实服务器、提交、推送或创建 PR |
| 已知阻断 | RECORDED | 全量 lint 被既有 `xls-parser.ts:170 prefer-const` 阻断；新增自托管文件定向 lint 和 Vinext build 通过；旧 API/完整行级 Normalizer 仍待移植 |

## 自动统计摘要

| 指标 | 当前值 | 统计口径 |
| --- | ---: | --- |
| 总代码量 | 约 56,000 行 | 新增服务器本地 spreadsheet parser、迁移、API/UI 和专项测试；不含依赖、运行数据库、备份和截图 |
| 源码文件 | 150+ | 新增本地 parser、2 份专项测试、版本化 migration、依赖清单和完成报告 |
| 根仓库跟踪项 | Site 自适应 Import + 服务器本地 CSV/XLSX/XLS | 本轮修改本地 Python 运行面和 systemd 源码配置，未修改 Site |
| 主要目录 | 4 类 | `chenyida_erp_app/`、`chenyida_erp_site/`、`物料主数据治理落地包/`、`docs/` |
| 数据库实现 | 3 | 当前开发 SQLite、历史 Cloudflare D1、自托管开发 PostgreSQL |
| 数据表 | 分运行面追踪 | SQLite 29 张；D1/Drizzle 45 张；PostgreSQL `0001` 基线 46 张并有 `0002`—`0006` 增量；不能跨运行面相加冒充同一数据库 |
| 在线 API 路径 | 89 | 开发代码新增 Draft Generation 查询、Normalization Approval 和 Draft Commit；生产公开站点尚未部署 |
| 页面入口 | 14 | 既有 11 个入口加 3 条 Material Import 路由 |
| 测试文件 | 35 | 本轮新增本地 Spreadsheet 和 Migration 两份专项测试 |

## 当前版本与环境

| 项目 | 当前值 |
| --- | --- |
| 根仓库 Branch | `main` |
| 任务开始 HEAD | TASK04 起点 `a541360eefe12869c090b2408bbcf07485fc77cb` |
| 自托管开发版本 | `chenyida-erp-selfhosted@0.1.0-alpha.14`；非生产、尚未发布 |
| 当前实际常驻服务 | Python 3.11.6 / SQLite，systemd `enabled/active`，`0.0.0.0:18888` |
| 自托管部署状态 | Node/PostgreSQL 未生产部署；当前无运行中 Compose 项目 |
| PostgreSQL migration | `0001`—`0014`；TASK02 新增合成受控期初模型，未迁移任何真实数据 |
| SQLite migration | `0001`—`0004` 已记录；数据库不保存 migration checksum |
| 历史 D1 migration | 仓库 `0000`—`0008`；生产实际应用版本未访问、未核验 |
| PM-000 前根提交 | `bbefb2e388323213b51531fec117d67d5a28fe70` |
| Site 开发基线 | `9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9`；已作为普通目录纳入根仓库 |
| 历史 Site | 历史记录 `v3`，源码提交 `2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12`；本任务未访问公网重新确认 |
| 当前主机工具 | Git 2.43.7、Docker 29.5.2、Compose v5.1.4、Python 3.11.6；宿主机无 Node/npm，Node 验收使用 `node:22-bookworm` 一次性容器 |
| 环境配置 | `development` / `test` / `production`；生产地址运行时注入，不在发布记录硬编码 |
| 测试数据库 | Node 基线使用隔离/一次性环境；Python go-live 使用临时 SQLite；不连接生产 |

Node 验收因宿主机无 Node/npm，在一次性 `node:22-bookworm` 容器执行。`npm ci` 报告 12 个既有依赖审计项（1 low、4 moderate、7 high），依照本任务禁止事项未升级依赖。Python 首轮误用系统解释器时 smoke 在导入 `openpyxl` 前停止；改用 systemd 实际使用的项目虚拟环境后，self-test、smoke 和临时 SQLite go-live 全部通过。

## Git 状态

SELFHOST-PHASE2-TASK02 开始时，根仓库 `main` 位于 `e8cb7ebc0fa9d45575aeaffc0732183d2533f577`，工作区 clean，本地分支领先 `origin/main` 2 个提交。TASK02 独立提交和最终 clean 状态以完成报告及 `git show` 为准；未 push 或创建 PR。

SELFHOST-PHASE2-TASK01 开始时，根仓库 `main` 位于 `12d3ea30d21cce6918de0c525d81f19af289f5ac`，工作区 clean，本地分支领先 `origin/main` 1 个提交。本任务只修改 `docs/`；完成提交和最终 clean 状态以任务完成报告及该提交的 `git show` 为准。

PHASE0-TASK03 开始时，根仓库 `main` 位于 `39946f6`，工作区 clean；`origin/main` 的本地跟踪引用和远端只读查询均为同一提交。当前任务只修改项目发布文档以及 `package.json`/`package-lock.json` 的名称和版本；最终提交与工作区状态以本任务完成报告为准。

`PHASE3-MATERIAL-LIBRARY-02` 开始时，根仓库 `main` 位于 `c660cc3` 且工作区干净。功能提交 `b3d26c3` 覆盖本地只读 inspect、治理状态、安全汇总、重复阻断和专项测试；未修改 Schema/Migration、hosting、本地旧版业务代码或生产资源。

`PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT` 功能提交为 `41e293f`，覆盖自适应结构识别、Supplier Profile、多来源 Mapping/规格、Canonical Row、Review/Draft 门禁、`0008` 和专项测试；没有真实供应商样本，没有生产迁移或部署。

`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01` 功能提交为 `cea940a`；只读验证 A118/V700，未跟踪附件或业务行，未连接生产、上传、dry-run、创建 Draft 或部署。

正式规格确认更新开始时，根仓库位于 `c694045`；用户明确回复“规格确认”。本次只更新主规格的 14 项决策状态和项目治理记录，不实施 Review UI。

转换前，`git ls-files --stage -- chenyida_erp_site` 只显示一个 mode `160000` gitlink。转换后，根仓库直接跟踪 Site 的 77 个 mode `100644` 文件，仓库中不再存在 mode `160000`。暂存 Site 子树 hash `541decf5a685a0efc238868ef958d3ae500174e5` 与原 `9f2c2dc` tree 完全一致。

本任务未创建生产版本、未推送、未连接或部署生产 D1/R2/Queue。

实时状态必须使用：

```powershell
git status --short
git -C chenyida_erp_site status --short
```

## PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01 真实 BOM 只读验证

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `cea940a`；脱敏报告、测试与项目记录完成 |
| 文件类型 | PASS WITH WARNING | A118/V700 均为 XLSX 内容、`.csv` 后缀；以内容签名解析并记录 `XLSX_CONTENT_WITH_CSV_EXTENSION` |
| V700 Sheet | PASS | 正确选择 `BOM`，不再误选 `变更记录`；表头 1～2，数据从 3 开始 |
| V700 Mapping | PARTIAL | 规格、型号、数量 EXACT；标准名称、单位未确认，继续 fail closed |
| V700 行估计 | READ-ONLY | 229 DATA；219 有规格、10 空规格、222 有型号 |
| A118 表头/Mapping | PASS (STRUCTURE ONLY) | 第 44 行；名称、规格、厂商料号、用量 EXACT |
| A118 解析 | EXPECTED BLOCK | 第 197～203 行扩展到 XFD；不截断，稳定返回 `IMPORT_PARSE_LIMIT_EXCEEDED` |
| A118 行估计 | DIAGNOSTIC ONLY | 前 9 列只读估计 310 DATA、266 有规格、44 空规格；不是成功 Parse |
| 专项/全量 | PASS | 自适应 11/11、Parser 37/37、Inspector 4/4、Batch API 12/12、Node 593/593 |
| 其他基线 | PASS | build、lint 0 error/1 个既有 warning、隔离 API smoke、凭证扫描、Python self-test/smoke/go-live、`git diff --check` |
| 生产影响 | NONE | 未提交附件、连接生产、上传、dry-run、创建 Draft、迁移或部署 |

## Excel 文件格式兼容增强

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `.xlsx` | 保持 | 继续使用既有有界 OOXML/ZIP 安全检查和解析器 |
| `.xls` | 已接入 | 前端预检、服务端 OLE 安全边界、BIFF Sheet/单元格读取和现有 Raw Row/Mapping 链路 |
| `.csv` | 保持 | 既有编码、分隔符和 CSV 安全检查不变 |
| 兼容策略 | 已记录 | 批次 `source_kind`/文件 `detected_file_type` V1 分类保持 `XLSX`，`.xls` 通过 `filename_extension` 选择独立 BIFF 路径并写入 `XLS_LEGACY_BINARY` 警告 |
| 生产影响 | NONE | 未连接生产资源、未迁移、未上传、未创建 Draft、未部署 |

## 服务器本地 CSV/XLSX/XLS 自适应导入

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 实际运行面 | DEPLOYED / DEVELOPMENT | `chenyida_erp_app` 和 systemd 常驻服务已更新，不再只有 Site 代码支持 Excel |
| 文件类型 | PASS | CSV、OOXML XLSX、OLE/BIFF XLS；按内容签名识别，10 MiB 上限 |
| Sheet/表头 | PASS | 全部 Sheet、前 50 行、1～3 行、合并父级表头、数据起始行 |
| Mapping/规格 | PASS | 集中别名、样本评分、EXACT/HIGH_CONFIDENCE/SUGGESTED/UNMAPPED/CONFLICT、多列规格组合 |
| 原始数据 | PASS | `material_import_batches` + 不可变 `material_import_raw_rows`；清洗行保存来源和置信度 |
| Migration | PASS 3/3 | 空库、已有数据、重复执行、失败回滚和约束；迁移前快照和副本试迁移完整性 `ok` |
| Parser/API | PASS 6/6 | 包含多行 XLSX、真实 BIFF XLS、CSV、错后缀、缺名称阻断和 A118/V700 回归 |
| 本地基线 | PASS | 联合单元 13/13、self-test、含二进制 XLSX 上传的 smoke、go-live |
| 服务 | PASS | `/opt/erp/.venv/bin/python`、systemd `enabled/active`、`0.0.0.0:18888` |
| 真实样本 | SUPERSEDED | 此处记录初始严格拒绝结果；用户确认业务语义后，已由下节的待审核入库方案替代 |

## A118 / V700 正式 BOM 待审核入库

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 用户确认 | ACCEPTED | 两份是正确且需要导入库内的正式表格 |
| A118 | STAGED | `REAL-A118-20260718`，第 44 行表头，314 Cleaning Rows |
| V700 | STAGED | `REAL-V700-20260718`，BOM 第 1～2 行，229 Cleaning Rows |
| 原文件 | PASS | 两份按 SHA 完整归档；A118 XFD 原始内容不丢失 |
| Raw Rows | 766 | A118 457；V700 293+16 |
| Review | 543/543 | 两批次全部 NEEDS_REVIEW |
| 必填门禁 | PASS | 22 空规格、543 空单位；建档接口继续拒绝空值 |
| Material | 4→4 | 没有自动建档、编码或正式物料写入 |
| Migration | PASS | 本地 `0002`、迁移前快照、副本试迁移和完整性检查 |
| 自动测试 | PASS | 联合单元 15/15、self-test、smoke |

## 电容匹配测试基线 1～5

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 用户最终输入 | ACCEPTED | 采用更正后的 5%、10%、20%、10%、5% 五条规格 |
| 备份 | PASS | `erp-backup-20260718-182230.sqlite3`，副本事务试跑通过 |
| 内部物料 | 4→9 | 新增临时编码 1～5，均启用、CAP、PCS |
| Cleaning Rows | 543→0 | 按用户指令清空，事务失败时整体回滚 |
| 原始追溯 | PRESERVED | 2 Batch、766 Raw Rows、两份原文件归档均保留 |
| 匹配 | PASS 5/5 | 输入 1～5 分别自动匹配编码 1～5，置信度均 1.00 |
| 数据库 | PASS | `PRAGMA integrity_check=ok` |
| 服务 | PASS | systemd `enabled/active`，公网首页 HTTP 200 |

## 清洗审核匹配置信度排序

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| API 参数 | PASS | `newest/desc/asc` 固定白名单，未知值回退 newest |
| 全局顺序 | PASS | 服务端排序后再应用 500 条上限 |
| 稳定顺序 | PASS | 同分按 ID 降序 |
| 页面 | PASS | 最新记录、由高到低、由低到高 |
| 单元测试 | PASS 4/4 | 升序、降序、回退、排序后 limit |
| 集成基线 | PASS | smoke、self-test、go-live |
| 真实 V700 | PASS | 229 条、21 个置信度层级；升序 0.00→1.00，降序 1.00→0.00 |
| 开发部署 | PASS | systemd `enabled/active`，公网 HTML/JS 已更新 |

## 清洗审核安全清空

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 权限 | PASS | `system`，仅管理员 |
| 双重确认 | PASS | 浏览器确认 + 固定服务端 confirmation |
| 自动备份 | PASS | 删除前创建 SQLite 备份并返回信息 |
| 事务/审计 | PASS | 删除和审计同事务，记录操作者与数量 |
| 保留边界 | PASS | Batch、Raw、归档、物料、映射不删除 |
| 单元测试 | PASS 3/3 | 删除审计、空队列幂等、权限 |
| 联合/Smoke | PASS | 7/7；拒绝路径不删除，成功路径备份并清空 |
| 真实队列 | PRESERVED | 部署未执行真实清空，V700 229 条保持不变 |

## 1928C / G20-G15G / J587 规格与编号

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 1928C | PASS | 25/25 有规格，工作表及 2～4 行表头正确 |
| G20 | PASS WITH REVIEW | 69/74 有规格；5 条原始 Description 为空 |
| J587 | PASS | 122/122 有规格，描述不再与备注冲突 |
| 三文件隔离导入 | PASS | 3 Batch、316 Raw、221 Cleaning、216 有规格 |
| 名称解耦 | PASS | 名称不参与编号评分 |
| 唯一编号 | PASS | 完整规格唯一一致才自动确认编号；部分唯一候选保持疑似，歧义不随机选码 |
| 等价规格 | PASS | 0.1uF=100nF、5.0V=5V、+5%=5% |
| 当前 1～5 | EXPECTED REVIEW | 无完整唯一匹配；J587 5 条缺误差，对应 1/2/3 歧义 |
| 自动建档 | NONE | 0 个内部物料自动创建 |
| 部署 | PASS | systemd `enabled/active`，公网 HTTP 200 |

## 1928C 分项规格匹配

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 匹配输入 | PASS | raw spec/model/description/MPN 分开取证，不比较整体文字相似度 |
| 截图行 | PASS | CAP、0201、5%、C0G/NP0、50V、10PF、MPN 分项提取 |
| 单项冲突 | PASS | 任一来源关键属性与候选冲突即淘汰 |
| 供应商简写 | PASS | NPO/NP0/COG/C0G、100P/100PF 确定性归一 |
| 数据模型 | PASS | 本地 `0003` 扩展现有 Cleaning，不新建重复导入表 |
| 旧数据 | PRESERVED | 当前 25 条 1928C Cleaning 不回填、不重算 |
| 当前编号 | EXPECTED NEW | 截图 10PF 规格未存在于当前内部测试库，不能伪造编号 |
| 回归 | PASS | 联合单元 37/37、self-test、smoke、go-live |
| 部署 | PASS | 迁移前快照完整；`0003` 已应用，systemd active/enabled，公网 HTTP 200 |

## 清洗审核分项规格对照

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 来源规格 | PASS | 八项分开展示，型号/MPN 不冒充电气规格 |
| 候选规格 | PASS | 从内部物料只读展示同组字段，空值明确“未维护” |
| 人工证据 | PASS | 候选编码、候选名称、来源规格、候选规格同一行核对 |
| 服务端边界 | PASS | 浏览器不计算匹配、不改编号、不自动确认 |
| 置信度 | PASS | 来源介质未覆盖时疑似上限 0.95 |
| 数据影响 | NONE | 无 Schema/Migration、无旧行回填、无业务数据写入 |
| 回归/部署 | PASS | 联合单元 38/38、self-test、smoke、go-live；systemd active/enabled，公网 HTTP 200 |

## 通用规格来源识别与无序参数匹配

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 规格来源 | PASS | 明确规格、多列组合、描述和物料名称按确定性参数丰富度选择，保存完整 raw spec 和来源列 |
| 通用参数 | PASS | 品类、封装、容量、阻值、电感值、电流、电压、功率、频率、百分比/绝对误差、材质和尺寸 |
| 无序匹配 | PASS | 参数以类型和归一值集合比较，前后顺序不影响相似度；同类型冲突排除，缺项降级 |
| 型号边界 | PASS | MPN/品牌独立保存和展示，不进入通用规格相似度；MPN 相同不能替代规格 |
| 审核页面 | PASS | 型号/MPN、完整原始详细规格、规格来源、来源参数和候选内部参数同时可见 |
| 数据模型 | PASS | `0004` 只扩展既有 Cleaning 四个证据列，不新建第二套导入系统 |
| 旧数据 | PRESERVED | 9 Material、444 Cleaning、16 Batch、3037 Raw 均未变化；旧 Cleaning 不重算 |
| 恢复 | PASS | 部署前备份 `erp-backup-20260718-203624.sqlite3`，SHA-256 `04286e386f9a799400c4ec0dc675110419d5f77fdf7dc54e3366cb2287651262`，完整性 `ok` |
| 自动测试 | PASS | 联合单元 48/48、self-test、smoke、go-live |
| 部署 | PASS | systemd active/enabled，本机和公网首页 HTTP 200，`0004` 已应用 |

## 规格匹配精度门禁

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 大类误匹配 | PASS | CATEGORY 不计入鉴别参数；只识别大类的来源返回“规格不足”、无候选、置信度 0 |
| 自动匹配门禁 | PASS | 双方至少三类鉴别参数、包含锚点、集合完整一致、无冲突且候选唯一 |
| 参数扩展 | PASS | 分数功率、范围、频率/阻抗、带宽、dB、嵌入电阻码、长度、针数、间距、铜厚和接口 |
| 上下文消歧 | PASS | Type-C `16P` 识别为针数且不生成电容；电容短写 P 只在电容上下文启用 |
| 来源 Mapping | PASS | 样本值丰富度可定位未知标题规格列；型号不直接冒充规格 |
| 审核页面 | PASS | 显示规格不足、鉴别参数类数、候选内部缺项和歧义候选数 |
| 真实 J587 回归 | PASS | 隔离复算 105 新/5 疑似/12 规格不足；4 条连接器大类错误候选归零 |
| 数据影响 | PRESERVED | 9 Material、122 Cleaning、17 Batch、3176 Raw；旧 Cleaning 不回填、不重算 |
| 恢复 | PASS | `erp-backup-20260719-133841.sqlite3`，SHA-256 `898b3dab3da5b3e4239773789afebca73f1c91428646c2c2c3f476e2d8efc536`，integrity `ok` |
| 自动测试 | PASS | 联合单元 58/58、self-test、smoke、go-live 和 Python 编译检查 |
| 部署 | PASS | systemd active/enabled，`0.0.0.0:18888`，本机与公网健康检查和新版静态资源通过 |

## 服务器本地交付运行面

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 默认应用 | 已切换 | `chenyida_erp_app/server.py` 及启动脚本在公网验证期间使用 `0.0.0.0:18888` |
| 本地基线 | PASS | `server.py --self-test`、`smoke_test.py`、`go_live_check.py --no-backup` 通过 |
| Site 关系 | 已记录 | Site 保留为历史/参考代码，后续新功能不再默认整合到 Site |
| 外部暴露 | DEVELOPMENT ALWAYS-ON | `chenyida-erp.service` 已 `enabled/active`；`43.135.157.211:18888` 健康接口和登录页均返回 200，页面不再预填默认密码 |
| 服务恢复 | PASS | systemd 开机自启、失败自动重启；正式投用迁移到公司服务器前仍需密码轮换、HTTPS、反向代理和访问控制 |

## PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 功能提交 `41e293f`、测试和治理文档完成 |
| 现有链路复用 | PASS | 继续使用 Batch/Parser/Raw Rows/Mapping/Normalization/Review/Validation/Event/Audit/Draft，没有第二套导入系统 |
| Sheet/表头 | PASS (SYNTHETIC) | 全部可见 Sheet、前 50 行、1～3 行与合并父级表头评分；保存范围、置信度和证据 |
| 行分类 | PASS (SYNTHETIC) | DATA/BLANK/说明/重复表头/小计/合计/页脚；原始行保留，非数据行在 Normalization 标记 SKIPPED/REJECTED |
| Mapping | PASS (SYNTHETIC) | 集中别名、样本统计、相邻信息和 Supplier Profile；五级状态及低置信度人工确认 |
| 规格 | PASS (SYNTHETIC) | 独立规格、多来源确定性组合、名称/描述候选；不调用 AI，空规格 ERROR 阻断 Draft |
| Canonical Row | PASS | 进入既有 Normalization payload/队列列，完整原始值仍只存不可变 Raw Row |
| `0008` | PASS | 45 表 Drizzle 基线；空库/已有数据/约束/失败原子性和受保护兼容回退通过，完整结构恢复依赖迁移前快照 |
| 初始真实样本 | INITIAL_BASELINE | 功能首次完成时受控目录无样本；后续 A118/V700 结果见上方真实 BOM 验证 |
| 专项/全量 | PASS | 自适应 9/9、Migration 3/3、运行时闭环 2/2；Vinext build + Node 589/589 |
| 其他隔离基线 | PASS | lint 0 error/1 个既有 warning、API smoke、1k/10k/100k 查询计划、最终文档范围 328 文件凭证扫描、Python self-test/smoke/go-live、`git diff --check` |
| 生产影响 | NONE | 未连接生产 D1/R2/Queue，未迁移、上传真实文件、创建 Draft、Sites 保存或部署 |

## PHASE3-MATERIAL-LIBRARY-02 初始治理（历史 NO_REAL_DATA_MODE）

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 当时任务状态 | HISTORICAL / SAMPLE DELIVERED | 此节记录 `b3d26c3` 当时无真实文件的事实；后续 A118/V700 结果见上方真实 BOM 验证 |
| 当时文件扫描 | COMPLETE | 当时仅扫描 `/opt/erp`、`/home`；20 路径去重为 1 个 10-Sheet XLSX + 9 CSV，全部是已跟踪模板/样例镜像 |
| 本地 inspect | PASS | 只读类型/大小/SHA、Sheet/CSV、行列、编码/分隔符、表头候选和可能字段；不回显业务行、不改源文件 |
| Mapping | VERIFIED / UNCHANGED | 既有关系化 Mapping 可保存、版本 CAS、metadata digest、确认、事件和审计；未硬编码实际映射、未改 Schema |
| 分类治理 | PASS (SYNTHETIC) | code=`EXACT`、唯一名称=`MATCHED`、未命中/冲突=`NEEDS_REVIEW` 并给有界疑似候选；不自动建分类 |
| 单位治理 | PASS (SYNTHETIC) | 标准 code=`EXACT`、alias=`MATCHED`、未命中/冲突=`NEEDS_REVIEW`；不自动建单位 |
| 品牌治理 | PASS (SYNTHETIC) | code/name/alias 分级匹配，空品牌独立标识，未命中作为新候选待审；不自动建品牌 |
| 重复治理 | PASS (SYNTHETIC) | EXACT 阻断；HIGH_CONFIDENCE 阻断并要求人工确认；POSSIBLE 提示；不自动合并 |
| dry-run 汇总 | PASS (SYNTHETIC) | CLI 只输出总数、成功/错误/警告/重复/待审及分类/单位/品牌/重复等级计数，不打印完整物料正文 |
| 真实 dry-run / DRAFT | NOT RUN / 0 | 未把模板冒充真实数据，未上传、批准、commit 或创建 Material DRAFT |
| 专项/全量 | PASS | 治理专项 9/9；Node 575/575；Vinext build；lint 0 error/1 个任务外既有 warning |
| 隔离基线 | PASS | 本机一次性 D1 API smoke、319 文件凭证扫描；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live |
| Schema/生产影响 | NONE | D1/Drizzle 仍为 44 表、最新 `0007`；未连接生产、迁移、部署或创建资源 |

## PHASE3-MATERIAL-LIBRARY-01 Internal Material Library 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 审计、实现、测试、功能提交 `2ff8d9c` 和治理文档完成 |
| 数据库技术 | CONFIRMED | Cloudflare D1 / SQLite 语义，Drizzle schema + SQL migration + snapshot/journal |
| 模型复用 | PASS | 复用 `material_master`、分类、动态属性、别名、供应商映射、版本/审计和既有 Draft/Review；没有第二套 `materials` |
| `0007` | PASS | 新增单位/别名、品牌/别名、Approval、Draft Link、Duplicate Candidate；Material 增加品牌、单位和批次/文件/行外键；受保护 Down/re-up |
| Import 闭环 | PASS | Current Normalization digest 审批后调用既有 Validation/Draft Service；单行原子写来源/候选；结果仅 `DRAFT`、无正式编码 |
| 权限/安全 | PASS | admin/manager `material.import.commit`，owner/read_any、CSRF、版本/摘要、WARNING 明确确认、强幂等、安全错误和审计 |
| 重复检测 | PASS | material/legacy/supplier code、名称、品牌、型号、规格、制造商料号；EXACT/HIGH_CONFIDENCE 阻断、POSSIBLE 提示，均不自动合并 |
| 命令 | PASS | inspect/dry-run/commit/report 复用 API；只允许回环 URL，commit 只允许 test/local/development |
| 迁移/闭环专项 | PASS | Migration 3/3；Import→Draft、权限、CSRF、追溯、请求/行幂等 3/3；既有生命周期 14/14 |
| Site 全量 | PASS | Vinext build；Node 569/569；lint 0 error、1 个任务外既有 warning；Drizzle 44 表无漂移 |
| 隔离基线 | PASS | 一次性 D1 API smoke、314 文件凭证扫描、远程 URL 拒绝、本地临时 SQLite 五项基线通过 |
| 文件/dry-run | NOT RUN | `/opt/erp` 只发现两套相同治理模板/样例，`/home` 无候选；未发现真实首批物料文件，因此未上传或 dry-run |
| 生产影响 | NONE | 未连接生产 D1/R2/Queue，未执行迁移、真实导入、Sites 保存或部署 |

## PHASE3-TASK04 Material Import Normalization Review UI V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 14 项既定 UI 决策按规格实现，未重新设计业务语义 |
| 页面/状态 | PASS | 统一 `/materials/imports/:batchId`、七步 Stepper、`normalize/normalized/issues/confirmed`、Batch/Current/Latest 双轨 |
| 写与轮询 | PASS | 固定 Processor、启动/重试/重跑/取消、独立冻结 Operation、`RESULT_UNKNOWN`、2/5/10 复合轮询、Retry-After、真实行进度 |
| 结果审阅 | PASS | Current 汇总、Rows/Issues 50/100 opaque cursor、Row Drawer、200 Attributes、有界值与 Safe Details、Current Run 失效清理 |
| 局部门禁 | PRESERVED | 无精确完整 Row Issues API；只显示计数、当前单条 Issue 和按来源行筛选，不扫描或伪造完整集合 |
| 计划测试 | PASS | `NUI-RS-001`—`NUI-PF-008` 104/104；矩阵唯一性元检查通过 |
| 直接回归 | PASS | Import Workspace `UI-001`—`UI-100` 100/100；联合 206/206（含两项矩阵元检查） |
| Playwright | PASS | 隔离本地 Mock；50 Rows 801 ms、Drawer 398 ms、100 Issues、204 Candidate、700px Drawer 实宽 700px、0 console warning/error |
| 安全/存储 | PASS | 无详情 N+1、无 Catalog 冒充历史标签、Storage 0、History 正文键 0、权限失效清理与安全归属核验覆盖 |
| Build/Lint | PASS | Vinext build 成功；lint 0 error，仅保留任务外既有 workbook unused warning |
| 范围 | PASS | 无后端 API、Schema、Migration、业务服务、依赖、hosting 或生产环境改动；`.obsidian/` 保持未跟踪且未修改 |

## PHASE3-TASK03 Material Import Normalization Review UI V1 书面设计

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SPECIFICATION CONFIRMED | 项目负责人于 2026-07-17 在设计提交后回复“规格确认”；14 项决定全部 `APPROVED` |
| 正式交付 | COMPLETE | 主规格、37 状态线框、状态矩阵、104 项测试计划共 4 份新文档 |
| 路由/状态 | DESIGNED | 统一 Batch 工作区、七步 Stepper、`batch/current_run/latest_attempt`、合法 View 与 History Marker |
| 写与进度 | DESIGNED | 固定 Processor Version、启动/业务重试/重跑、冻结幂等 Body、`RESULT_UNKNOWN`、2/5/10 轮询、真实行进度、取消竞争 |
| 结果审阅 | DESIGNED | Current Run 汇总、Rows/Issues opaque cursor、Row Drawer、Candidate/Lineage、有界 Safe Details、权限与错误矩阵 |
| 局部门禁 | RECORDED | Drawer 内“该行全部 Issues”缺少精确有界查询；不阻断其他 Review UI 流程，本任务不改 API |
| 全局门禁 | REQUIRED | `PERFORMANCE_AND_ACCESSIBILITY_VALIDATION_REQUIRED`；未来实施后实测，文档阶段未声称通过 |
| 非阻塞限制 | RECORDED | 完整历史、Batch Pointer、Issue Row Status/Sheet 筛选、Rows 候选摘要、Batch List 状态筛选和选中 Issue 刷新恢复 |
| 增量验证 | PASS | 设计提交已通过 104/104 测试编号、37/37 线框、错误矩阵和门禁检查；规格确认更新另核对 14/14 `APPROVED`、ADR、治理状态、`git diff --check` 与 docs-only 范围 |
| 生产影响 | NONE | 未修改或运行前端/API/Schema/Migration/业务服务，未连接生产资源、迁移或部署 |

## PHASE3-TASK02 Material Import Normalization & Staging V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项正式决定全部 `APPROVED`，运行时与隔离实现完成 |
| 状态与运行 | PASS | 批次排队/运行/发布；独立 run、Outbox、租约/心跳、CAS、失败恢复与 SUPERSEDED 历史 |
| 数据契约 | PASS | 每行版本化 JSON payload、完整 lineage、payload hash、独立 issue、关系约束与绑定 trigger |
| 类型/空值 | PASS | MISSING/EMPTY/BLANK_TEXT/NULL_VALUE/PRESENT、受控默认、类型/属性/公式禁用与稳定 issue code |
| Validation | PASS | 只运行 Normalization 规则并输出 Deferred Validation；不调用 Material Validation 或 Draft 写服务 |
| API/权限 | PASS | 5 个路由、opaque cursor、`material.import.normalize`、owner/read_any、404/403、CSRF/幂等/读写限流 |
| `0006` | PASS | Up、三表、batch pointer、events/outbox/batches 重建、索引/trigger、受保护 Down、重升与失败整批回滚 |
| 专项测试 | PASS | 稳定发布、ERROR 行共存、幂等、分页、重跑、取消清理、五 API、安全与 429；一次性 Miniflare D1 |
| Site 全量 | PASS | 正式矩阵 54/54；Normalization/Migration 专项 18/18；`npm test` 458/458；`npm run build` 成功；`npm run lint` 0 error、1 个任务外既有 unused warning |
| API/OpenAPI | PASS | 隔离 `npm run test:api` 通过；6 份 OpenAPI、33 个 operation、533 个本地引用均有效 |
| Drizzle | PASS | 37 tables；生成漂移检查返回 `No schema changes, nothing to migrate` |
| 凭证/本地基线 | PASS | 304 个仓库文件凭证扫描通过；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 全通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、部署、创建 binding/Cron、Draft 或正式物料 |

## PHASE3-TASK01 Material Import Normalization & Staging V1 书面设计

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / WAITING FOR SPEC CONFIRMATION | 正式规格、OpenAPI 草案、数据流/状态图完成；16 项决定全部 `PROPOSED` |
| 状态与运行 | DESIGNED | 批次排队/运行/发布；独立 run、租约、Outbox、CAS、失败恢复与 SUPERSEDED 历史 |
| 数据契约 | DESIGNED | 每行版本化 JSON payload + 常用关系列 + 独立 issue；完整 lineage，不覆盖原始行 |
| 类型/空值 | DESIGNED | MISSING/EMPTY/BLANK_TEXT/NULL_VALUE/PRESENT、受控默认、基础字段/动态属性、公式禁用 |
| Validation | DESIGNED | 只运行 Normalization 规则；完整 Material Validation 延迟到真实 category_id，Draft 写服务不调用 |
| API/权限 | DESIGNED | 5 个路由、opaque cursor、`material.import.normalize`、owner/read_any、404/403、CSRF/幂等/限流 |
| `0006` | DESIGN ONLY | 三个新表、batch current pointer、events/outbox/batches 重建、索引/Down/重升；未创建 Migration 或改 Drizzle |
| 测试计划 | COMPLETE | 54 项最低未来测试及完整 docs-only 基线 |
| 验证 | PASS | OpenAPI 3.1 为 5 个操作/98 个本地引用；16 项决定逐项 11 字段、54 项测试/docs-only 检查通过；lint 0 error/1 个既有 warning；build 与 Node 440/440；隔离 API smoke；Drizzle 34 表无漂移；296 文件凭证扫描；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 均通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、部署或创建 binding/Cron |

## PHASE2-TASK08 Material Import Workspace UI V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项正式决定已批准并实施；Catalog 与性能/可访问性门禁均通过 |
| 页面路由 | PASS | `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`；权限入口与单状态工作区 |
| 文件/SHA/XHR | PASS | 10 MiB 单文件预检；`@noble/hashes@2.2.0` MIT、1 MiB 分块 Worker；单 file part XHR、浏览器 boundary、真实进度 |
| 状态/恢复 | PASS | 服务端状态权威、URL allowlist、独立 Key/不可变载荷、RESULT_UNKNOWN、重复新批次、2/5/10 轮询、Retry-After、取消竞争 |
| Rows/Mapping | PASS | 完整 256 列、20/50 服务端分页、Sheet/Header、动态 Catalog、保存/preview/confirm 新鲜度、confirmed 只读 |
| UI 专项 | PASS | UI-001—UI-100 全部通过；含 10 MiB SHA 分块边界、权限、URL、错误、键盘与焦点 |
| Playwright 门禁 | PASS | Chromium 1366×768：50×256 + 256 Mapping，初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、30,285 DOM、123,423,127 bytes JS heap；末列 IV、sticky、语义、键盘、700 窄屏和 0 console error/warning通过 |
| Site 全量 | PASS | build 成功，Node 440/440；首次并行高负载触发历史迁移 120 秒超时，串行全量通过 |
| lint | PASS | 0 error；1 个任务外既有 `build_material_workbook.mjs` unused warning |
| API/OpenAPI | PASS | 隔离 API smoke；仓库 5 份 OpenAPI 3.1、434 个本地引用、Batch 6 个操作通过 |
| Drizzle | PASS | 34 tables，`No schema changes, nothing to migrate`；未创建 0006 |
| 凭证/本地基线 | PASS | 289 文件凭证扫描；临时 SQLite self-test、smoke、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |
| 已知限制 | RECORDED | page_size=100 未开放；File、unknown 操作与 preview 只在页面内存；远程生产容量/冷启动未验收 |

## PHASE2-TASK07 Mapping Target Catalog V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 12 项正式决定已批准并实施；Catalog 门禁已 `RESOLVED` |
| API | PASS | `GET /api/material-master/import-batches/:batchId/mapping-targets`；仅支持 namespace/q/limit/cursor，DTO/OpenAPI 一致 |
| Registry/Snapshot | PASS | BASIC/SPECIAL 单一 Registry + 运行时 D1 ACTIVE ATTRIBUTE；Catalog、准备、保存、preview、confirm 共享 `material-import-mapping-metadata-v1` |
| digest/cursor | PASS | 业务语义进入 Mapping SHA-256；展示文案不进入 Mapping digest但进入 cursor 搜索摘要；稳定排序、条件绑定和旧 cursor 409 通过 |
| 权限/安全 | PASS | AUTH/read/map/owner/read_any、隐藏 404、可见无 map 403、读取限流、request_id、no-store 和安全审计通过；无 attribute_id/数据库内部信息 |
| Catalog 专项 | PASS | 51/51，覆盖正式 43 项最低契约和共享规则/历史失效/空结果/Repository 失败/日志去敏回归 |
| Site 全量 | PASS | build 成功，Node 339/339；原 288 基线全部保留 |
| lint/凭证 | PASS | lint 0 error/1 个既有 warning；凭证扫描通过 |
| API/OpenAPI | PASS | 一次性隔离 D1 API smoke 通过；OpenAPI 3.1 YAML、路由、参数、DTO、错误和 no-store 契约检查通过 |
| Drizzle | PASS | `db/schema.ts`、`drizzle/`、snapshot/journal 无差异；未创建 0006 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |
| UI 状态 | IMPLEMENTED BY PHASE2-TASK08 | Catalog 门禁已被真实 Workspace 使用；50×256 性能与可访问性门禁通过 |

## PHASE2-TASK06 Mapping Target Catalog V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / CONFIRMED BY TASK07 | 规格、OpenAPI 和 12 项决定已形成；全部决定由 PHASE2-TASK07 批准 |
| 推荐路由 | APPROVED / IMPLEMENTED | 批次作用域 `GET .../:batchId/mapping-targets`；全局路由与混入 Mapping 仅保留比较 |
| 权限/可见性 | DESIGNED | read + map + owner/read_any；隐藏批次 404，`read_any` 不隐含 map |
| Catalog 来源 | DESIGNED | BASIC/SPECIAL 来自共享 Registry；ATTRIBUTE 来自运行时 D1 ACTIVE metadata；禁止 seed/fixture/历史 Mapping |
| target DTO | DESIGNED | 保留现有小写 namespace 与大写 code，返回分组、类型、必填、mapping modes、default/unit/value constraints、enabled/selectable；不返回内部 ID/列名 |
| digest 审计 | RESOLVED BY TASK07 | 已抽共享 Registry + Snapshot，Catalog、准备、保存、preview、confirm 使用同一算法 |
| 搜索/cursor | DESIGNED | 三组统一有界分页；q 最大 64、limit 默认 50/最大 100、稳定排序、cursor 绑定业务与展示搜索快照，旧 cursor 409 |
| 缓存/历史目标 | DESIGNED | `private, no-store`；历史 Mapping code 保留，Catalog miss 由 UI 标失效，不新增 resolver、不自动替换 |
| 测试计划 | COMPLETE | 43 项未来实施测试，含权限、D1 metadata、digest、cursor、限流、审计、OpenAPI、隔离 D1 和 288 项回归 |
| 文档阶段验证 | PASS | 5 份 OpenAPI YAML/本地引用、规格 43 项编号/12 项决定、lint 0 error/1 个既有 warning、build 与 Node 288/288、隔离 API smoke、Drizzle 34 表无漂移、272 文件凭证扫描通过；首次 `npm test` 因 183 秒工具时限被终止并产生 reporter EPIPE，干净重跑 288/288 |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、修改 Metadata、部署或修改 hosting |

## PHASE2-MAINT-01 Protected Down 注释语句测试修复基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 只恢复测试基线，不实施新功能 |
| 根因 | FIXED | 既有 helper 以 breakpoint 分割后仅 `trim().filter(Boolean)`；尾部 `-- End of protected 0005 rollback.` 非空，因而被作为无可执行 SQL 的 D1 statement 提交 |
| 修复层级 | PASS | 新增共享 breakpoint-aware 过滤辅助器；识别空白、行注释、块注释、单/双引号及成对引号转义，原样返回可执行片段；未闭合字符串/块注释 fail-closed 保留给 D1 报错，不支持嵌套块注释 |
| Migration 语义 | UNCHANGED | `0003`、`0004`、`0005` Up/Down、Schema、snapshot、journal 均未修改；0005 尾部保护说明保留 |
| Migration 专项 | PASS | 共享辅助器 10/10，0003/0004/0005 Down 与其他专项合计 20/20 |
| Site 全量基线 | PASS | build 与 Node 288/288、隔离 API smoke、4 份 OpenAPI、Drizzle 34 表无漂移、凭证扫描通过；lint 0 error/1 个既有 warning |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1，未迁移、部署或修改生产配置 |

## PHASE2-TASK05 Material Import Workspace UI V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SPECIFICATION CONFIRMED | 完整规格与 16 项决定已由项目负责人确认；Catalog 门禁已由 PHASE2-TASK07 解除，运行时 UI 实施仍受 50×256 性能与可访问性门禁限制 |
| 正式交付 | COMPLETE | `material-import-ui-v1.md`、wireframes、state matrix 三份独立文档 |
| 路由/恢复 | DESIGNED | 三条路由、单状态工作区 Stepper、view 非权威、allowlist/replaceState、单向 opaque cursor 单批结果导航 |
| 创建/上传 | DESIGNED | 客户端有限预检、Worker 增量 SHA、确认后创建、共享 Client 内 XHR、真实字节进度、独立幂等/RESULT_UNKNOWN、重复文件新批次恢复 |
| 解析/取消 | DESIGNED | parse 前重读与独立 Key、2/5/10 秒轮询、网络/429 退避、粗粒度真实状态、五状态协作式取消与 CAS 竞争 |
| Sheet/Rows/Header | DESIGNED | Sheet 可见性、真实 Rows 分页、稀疏 cell/DATE/FORMULA/ERROR、原始行与 Mapping 样本分离、Sheet/Header 随 Mapping 保存 |
| Mapping | IMPLEMENTED BY PHASE2-TASK08 | 三列编辑、显式保存、已保存版本 preview、当前页面最新 preview 门禁、服务端 confirm 最终裁决、confirmed 只读已实现 |
| Catalog 门禁 | RESOLVED BY PHASE2-TASK07 | 已实现批次作用域动态 Catalog 与共享 Registry/Snapshot/digest；仍禁止 seed、前端硬编码或历史 Mapping 绕过 |
| 表格门禁 | PASSED BY PHASE2-TASK08 | 50×256 的渲染、翻页、横滚、sticky、键盘、DOM、内存、语义、1366/窄屏均有 Playwright 记录 |
| 线框/矩阵/测试设计 | COMPLETE | 覆盖 22 个指定状态、集中主状态/URL/preparation/unknown/dirty/权限/门禁矩阵，100 个唯一未来实施测试编号 |
| 文档检查 | PASS | 100 项编号、16 项决定、22 状态结构、无 TBD/TODO 占位、`git diff --check` 与 docs-only 范围在提交前复核 |
| Site 静态/安全 | PASS | lint 0 error/1 个既有 warning；环境守卫 6/6；4 份 OpenAPI YAML 解析；268 文件凭证扫描；隔离 API smoke 通过 |
| Site 全量基线 | RESTORED BY PHASE2-MAINT-01 | 原 docs-only 任务发现的 0005 comment-only statement 失败已在共享测试辅助层修复；build 与 Node 288/288 通过，Migration 业务语义未变 |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |

## PHASE2-TASK04 Excel/CSV Parser 与字段 Mapping V1 实施基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项决定和非生产范围已批准；实现、测试和文档完成后停止 |
| Parser | PASS | 有界 XLSX/CSV 流式解析；UTF-8/BOM/GB18030、三种分隔符、类型化 cell、公式不执行、1900/1904、隐藏 Sheet、XML/ZIP 安全与组合资源上限 |
| 调度与恢复 | PASS / INJECTABLE | D1 Outbox、可注入 scheduler、Queue adapter、至少一次去重、租约领取/接管/心跳、Sheet 恢复、原子发布和 Mapping 准备独立重试；未创建生产 Queue/binding |
| Shared Strings/行 | PASS | run 级 D1 分块、有界 LRU、稳定 raw row hash、100 行逻辑批次与幂等冲突检测；发布前行不成为 current |
| Mapping/API | PASS | 关系化 Mapping、静态/动态 target allowlist、metadata 摘要、完整替换、100 行预览、确认 CAS、七个精确路由、权限/owner/read_any/CSRF/幂等/审计；不创建 Material Draft |
| `0005` | PASS / NOT APPLIED TO PRODUCTION | Up、Drizzle snapshot/journal、受保护 Down、legacy 行保留回填、批次/current-run 等价引用触发器、失败回滚和重升 4/4 |
| 兼容门禁 | PASS LOCALLY | 固定 `@zip.js/zip.js@2.8.26`、`sax-wasm@3.1.4`、`csv-parse@7.0.1`；Miniflare/WASM/Web Streams/R2 Range 替身/Bundle/64 MiB heap 门禁 3/3 |
| 依赖审计 | KNOWN BASELINE | `npm audit --omit=dev` 报告 Next 内置 PostCSS 的 2 个 moderate；建议的 force fix 会产生破坏性版本变化，未在本任务自动修改。三项新增 Parser 依赖的固定版本与许可证门禁通过 |
| 专项测试 | PASS | Parser 36、集成 11、migration 4、兼容 3，共 54/54 |
| Site 基线 | PASS | `npm test` 构建成功、Node 278/278；独立 build、Parser 类型夹具、隔离 API smoke、OpenAPI YAML、Drizzle 无漂移和 265 文件凭证扫描通过；lint 0 error/1 个任务外既有 warning |
| 全仓 TypeScript | KNOWN BASELINE | `tsc --noEmit` 仍有 10 个任务外既有错误，位于 multipart/service、Material list 与既有 schema 自引用；本任务未降低检查或扩大范围修复 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite go-live 检查通过；临时数据已清理 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1/R2/Queue，未创建 binding/Cron、执行生产 migration、修改 hosting 或部署 |

## PHASE2-TASK03 Excel/CSV Parser 与字段 Mapping V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / CONFIRMED BY TASK04 | 16 项决定已由项目负责人批准并在 PHASE2-TASK04 非生产实现 |
| 正式交付 | COMPLETE | Parser 主规格、OpenAPI 草案、Mapping 规格、Mermaid 流程图和 16 项 `PROPOSED` 决策表 |
| `PARSED` 语义 | DESIGNED | 当前策略允许的可见 Sheet 原始行、元数据和汇总完整核验后，run 状态、旧 run、current pointer、批次版本、事件、审计和幂等在单事务发布 |
| 调度 | PROPOSED | D1 同事务写 Outbox，提交后至少一次发送；Queue `max_batch_size=1` 与低并发仍需压测和基础设施审批，不宣称 D1/Queue 原子 |
| 恢复 | DESIGNED | 七个持久阶段；Sheet 是 V1 真正恢复边界，500 行/约 10 秒检查点只用于观测、预算、心跳和幂等写入 |
| 解析候选 | UNVERIFIED / PROPOSED | `zip.js + sax-wasm + 受限 OOXML`、`csv-parse` browser ESM；尚未通过 Vinext、Miniflare、Workers、WASM、R2 Range、Bundle 或内存矩阵 |
| 原始契约 | DESIGNED | sparse cells + `source_column_count`，区分缺失与 EMPTY；日期保留 source/raw/format/system/解释状态；公式不执行 |
| Shared Strings | PROPOSED | run 级 D1 分块和有界预取为推荐候选，R2 分块索引为备选；禁止逐 cell 查询或默认全量常驻内存 |
| 资源限制 | PROPOSED | 32 Sheet、50k 行、256 列、2m 非空 cell、256 MiB 规范化总量等组合限制；最终值需脱敏样本与容量/并发压测 |
| Mapping | DESIGNED / PROPOSED | Sheet/header suggestion、关系化主从、target allowlist、`category_hint`、版本 CAS、旧 Mapping STALE/SUPERSEDED 和有界预览 |
| API | CONTRACT ONLY | 七个拟议路由，包含权限、owner/read_any、CSRF、幂等、批次/Mapping 版本、metadata 摘要和稳定错误；未实施 |
| `0005` | DESIGN ONLY | 设计新表、状态 CHECK、rows 重建、外键/索引、Up/Down/重升/失败回滚；未创建 SQL、schema 或 snapshot |
| 文档验证 | PASS | OpenAPI YAML 与 115 个本地引用通过；规格约束/16 项决策检查通过；lint 0 error/1 个既有 warning、build 与 Node 224/224、隔离 API smoke、251 文件凭证扫描通过；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理；`git diff --check` 和文档-only 范围核对通过 |
| 生产影响 | NONE | 未连接 production、D1、R2 或 Queue，未迁移、创建资源、修改部署配置或发布 |

## PHASE2-TASK02 Material Import Batch Foundation V1 实施基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 12 项决定已批准；非生产实现、测试和文档完成，停止等待验收或新任务 |
| 正式交付 | COMPLETE | 正式规格、OpenAPI、Mermaid 图、`0004`、运行时模块、集成与测试全部同步 |
| 基础设施现状 | SAFE / LOCAL ONLY | `.openai/hosting.json` 的 `r2` 仍为 `null`；只新增抽象、R2 适配代码和内存替身，没有创建生产资源 |
| 存储与上传 | IMPLEMENTED | 私有对象存储抽象 + D1 元数据；恰好一个 file part、10 MiB 流式计数、增量 SHA、类型探测、条件写入且不公开对象定位信息 |
| Saga 与状态 | PASS | D1 意图、对象存储不可覆盖写入、STORED、安全检查、FILE_READY 分层；对象不一致和提交结果不确定进入 `RECONCILIATION_REQUIRED` |
| 数据模型 | PASS | `0004` 创建四张业务表和专用幂等表；V1 六种批次状态、外键/唯一/CHECK/终态约束及 Down 数据保护均有测试 |
| API/权限 | PASS | 六个精确路由；Session、capability + owner/`read_any`、隐藏 404、CSRF、限流、request_id、CAS、稳定错误码；无下载端点 |
| 幂等/并发 | PASS | multipart 摘要排除 boundary/原始字节/Content-Length；条件写不覆盖；覆盖响应未知、并发单文件、取消/完成 CAS 与 D1 后提交失败 |
| 保留/清理 | IMPLEMENTED / NOT SCHEDULED | 30/1095 天终态字段和两阶段手工清理服务已实现；未创建生产生命周期或 Cron |
| Migration | PASS / NOT APPLIED TO PRODUCTION | 生成 `0004` SQL、Drizzle schema/快照和带数据保护 Down；空库/已有数据/约束/回滚/原子失败 3/3 通过 |
| 文件安全 | PASS | XLSX OOXML/ZIP 边界、宏/加密/路径/压缩风险和 CSV UTF-8/GB18030/NUL/二进制/HTML 伪装均有覆盖；不宣称杀毒能力 |
| Site 基线 | PASS | build、全量 Node 224/224、导入专项 12/12、迁移 3/3、隔离 API smoke 和 247 文件凭证扫描通过；lint 0 error/1 个既有 warning |
| 本地基线 | PASS | 项目 Python 3.12 临时 SQLite `server.py --self-test`、`smoke_test.py` 和 `go_live_check.py --no-backup` 通过；临时数据已清理 |
| 运行时范围 | IMPLEMENTED AS AUTHORIZED | 仅在线生产方向新增基础模块；没有解析业务行、写入 `material_import_rows`、创建 Material Draft 或扩展本地旧版业务逻辑 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1/R2 binding，未迁移真实数据、创建 bucket/密钥或部署 |

## PHASE1-TASK14 Material Review UI 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产前端实现、自动测试、浏览器验收、文档和独立功能提交完成；未自动开始后续任务 |
| 页面路由 | IMPLEMENTED | 新增 `/materials/review`、`/materials/:materialId/review`；入口只由 `material.review.queue` 控制 |
| 队列 | PASS | URL 权威筛选、300ms keyword、四种 allowlist 排序、20/50/100 服务端分页、叶子分类、创建人和提交日期；展示但不筛选 `submitted_by`，服务端 `total` 为权威 |
| 工作台 | PASS | 方案 A；左侧完整只读详情，右侧实测 310px sticky Validation/职责分离/审核操作；基本信息、职责、属性、Validation 和历史展示复用共享组件 |
| 批准与驳回 | PASS | 最终动作前重读统一详情；ERROR 禁止批准，WARNING 明示确认；批准返回正式编码与 ACTIVE，驳回返回 DRAFT 并复读 `last_rejection` |
| 权限与职责 | PASS | queue/approve/reject 独立能力；创建人或最后修改人禁审、提交人本身不禁审；前端无角色名推断，服务端继续最终裁决 |
| 安全与并发 | PASS | 复用 Session/共享 Client/CSRF；approve/reject 独立页面内存 Key 和不可变载荷；RESULT_UNKNOWN 仅原请求安全重试，覆盖版本冲突、状态变化、429、dirty 和离开保护 |
| 状态与可访问性 | PASS | 400/401/403/404/422/429/5xx、request_id、加载/空/无结果、焦点定位、对话框初始焦点/Tab/Escape/恢复和 live region 均有实现或测试 |
| UI 测试 | PASS | Review UI 51/51；只读 UI 回归 37/37；全量 Node 209/209 |
| 浏览器验收 | PASS | 本地 Vinext + Playwright 1366×768；队列 2 行、sticky 右栏 310px、WARNING 复选确认、批准写入模拟与成功返回原队列完整往返通过 |
| Site 基线 | PASS | build、lint 0 error/1 个既有 warning、一次性隔离 D1 API smoke、233 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED | 未修改 API、Schema、migration、索引、Material 业务服务、Legacy SQLite 或部署配置 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移真实数据、部署或修改生产配置 |
| 已知限制 | RECORDED | 队列 API 不支持 `submitted_by` 筛选；公开 Site 仍为旧版本；生产迁移/部署、候选索引及 `PENDING_APPROVAL` 收缩需独立任务 |

## PHASE1-TASK13 Material Review UI 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING SPECIFICATION CONFIRMATION | 五段设计和补充约束已确认；正式规格与低保真线框完成，停止并等待“规格确认” |
| 页面路由 | DESIGNED | `/materials/review`、`/materials/:materialId/review`；队列 URL 保存筛选、排序和分页，`return_to` 仅接受审核队列路径 |
| 推荐布局 | APPROVED | 方案 A：左侧完整只读详情，右侧 sticky Validation、职责分离和审核操作；方案 B 仅作线框比较 |
| 权限与职责 | APPROVED | 能力权限驱动；创建人或最后实质修改人禁审，提交人本身不禁审；前端提示，服务端 403 code 最终裁决 |
| 批准与驳回 | APPROVED | 批准前重读详情并单一最终确认；WARNING 明示确认；驳回原因 1–1000 字；成功返回原队列状态 |
| Validation | APPROVED | 确认绑定 material_id、current_version 和当前规范化摘要；摘要仅用于前端新鲜度，服务端重新校验是唯一安全边界 |
| API 兼容 | RECORDED | 队列无 `submitted_by` 筛选；职责分离使用既有 HTTP 403；不新增 metadata version API，三项均不阻断前端实施 |
| 组件边界 | DESIGNED | 后续实施仅最小提取现有只读详情展示，不复制逻辑、不改变契约、不引入大型依赖；本任务未改代码 |
| 测试设计 | COMPLETE | 分组保留全部 51 项，覆盖 A/B、队列/工作台、两类确认、职责分离、冲突/结果未知、HTTP 错误和 1366×768 |
| 文档阶段验证 | PASS | lint 0 error/1 个既有 warning；构建与 Node 158/158、隔离 API smoke、226 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 运行时范围 | UNCHANGED | 无前端运行时代码、API、Schema、Migration、索引、业务服务、测试业务代码或部署配置变化 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1 binding，未迁移真实数据或部署 |

## PHASE1-TASK12 Material Draft UI 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产前端实现、隔离验证、文档和独立功能提交完成；未自动开始后续任务 |
| 页面路由 | IMPLEMENTED | 新增 `/materials/new`、`/materials/:materialId/edit`；列表与 DRAFT 详情入口由 `user.permissions` 和所有权能力驱动 |
| 布局与表单 | PASS | 布局 C；分类/基础信息并列、动态属性全宽、200px 快速定位与 Validation、sticky 操作区；TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM 和单位由当前 D1 Schema 驱动 |
| 数据语义 | PASS | 严格整数/小数、完整属性聚合、0/false 保留、空可选属性省略、MANUAL 固定来源、source_ref 只读、未知旧属性显式删除保护 |
| 写链路 | PASS | 创建 POST 后进入编辑页；编辑采用 PATCH 完整替换、GET 回读、WARNING 确认和 submit；保存/同步/提交期间禁用输入 |
| 安全与并发 | PASS | 复用 Session/CSRF/同源 Cookie；Material 写请求缺少显式 Key 或 CSRF 时 Client fail-closed；原 Key/原载荷安全重试、RESULT_UNKNOWN、SAVED_UNSYNCED、VERSION_CONFLICT 对照和 429 Retry-After 已覆盖 |
| 状态与可访问性 | PASS | 401/403/404/409/422/429/5xx、request_id、dirty/beforeunload、分类切换、离开确认、焦点定位、Tab/Escape/焦点恢复和 last_rejection 只读展示均有实现或测试 |
| UI 测试 | PASS | Draft UI 54/54；Material 只读 UI 回归 37/37；全量 Node 158/158 |
| 浏览器验收 | PASS | 一次性本地 D1 完成创建、编辑、PATCH/GET/submit 至 PENDING_REVIEW；1366/1280/1024/768 均无横向溢出，三列按断点降为两列/一列，离开保护与成功跳转通过 |
| Site 基线 | PASS | build、lint 0 error/1 个既有 warning、一次性 D1 API smoke、224 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED | 未修改 API、Schema、migration、索引、Material 写服务、Legacy SQLite 或部署配置 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移真实数据、部署或修改生产配置 |
| 已知限制 | RECORDED | 详情契约没有历史 `schema_version`；V1 以当前 Schema、未知 code 保护和服务端 422 重新加载 fail-closed，不自动迁移旧属性 |

## PHASE1-TASK11 Material Detail last_rejection 投影状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产实现、隔离验证、文档和独立功能提交完成；未开始 PHASE1-TASK12 |
| 历史规范来源 | PASS | 单一使用不可变 `material_versions` REJECT 行；当前写事务完整保存版本、原因、审核人和审核时间，不需要关联 change logs |
| 统一 Query Service | IMPLEMENTED | `/materials/:id` 与 `/drafts/:id` 共用 `lastRejection()`；先完成既有行级可见性，隐藏对象仍为 404 |
| 确定性与有界性 | PASS | `version_no DESC, reviewed_at DESC, id DESC LIMIT 1`；不读取最近 5 条推断，不加载全部历史，不影响列表或引入 N+1 |
| 安全与损坏历史 | PASS | reason 作为纯文本原样返回；缺少版本、原因、审核人或有效时间时 fail-closed 为脱敏 `INTERNAL_ERROR` 并保留 request_id |
| 查询计划 | PASS / NO MIGRATION | `SEARCH material_versions USING INDEX material_versions_material_version_uq (material_id=?)`；无全表扫描，未新增索引；极大单物料历史需后续复测 |
| 回归覆盖 | PASS | null、单次/多次驳回、摘要外驳回、重新编辑/提交、最终 ACTIVE、两接口一致、drafts 状态限制、隐藏 404、纯文本、损坏历史和分页/摘要不变 |
| Site 基线 | PASS | build、Node 104/104、lint 0 error/1 个既有 warning、一次性 D1 API smoke、219 文件凭证扫描和 OpenAPI YAML 解析通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED STRUCTURE | 只扩展两个既有详情响应字段；无新路由、Schema、migration、索引、历史修改或写服务变化 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移、部署或修改生产配置 |

## 统计复现方式

1. 使用 `rg --files` 获取两个运行面的源码文件。
2. 排除 `data/`、`node_modules/`、`.next/`、`dist/`、`.wrangler/`、生成物和嵌套仓库中的重复导入目录。
3. 代码扩展名：`.py`、`.ps1`、`.ts`、`.tsx`、`.js`、`.mjs`、`.html`、`.css`、`.sql`。
4. API 统计从在线集中式处理器提取具体 `/api/...` 字符串并去重。
5. 数据表统计来自本地 `server.py` 建表语句及在线 `db/schema.ts`。

## 下次更新触发条件

- 任务状态或 Branch 变化
- 新提交、发布或生产 Site 版本变化
- 数据库迁移或表数量变化
- API、页面、测试或主要目录变化
- 统计口径变化

## PHASE1-TASK10 Material Draft UI 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 五节设计及全部补充约束已确认；只完成规格和线框稿 |
| 页面路由 | DESIGNED / IMPLEMENTED BY TASK12 | `/materials/new`、`/materials/:materialId/edit` 已由后续 PHASE1-TASK12 实施 |
| 布局 | APPROVED | 布局 C；分类/基础信息首屏并列、动态属性全宽、约 200px 快速定位与 Validation、sticky 操作区和窄宽降级 |
| 表单与 Schema | APPROVED | 当前 D1 Schema、完整 PATCH、严格数值、0/false、未知属性保护、分类切换确认和 Schema 漂移 fail-closed |
| 写状态 | APPROVED | POST 后 GET、PATCH/GET/submit、WARNING 确认、Idempotency 状态机、RESULT_UNKNOWN、SAVED_UNSYNCED、dirty 和版本冲突对照 |
| 权限 | APPROVED | `/api/session -> user.permissions`；不硬编码角色；服务端继续最终校验权限、所有权、状态和 expected_version |
| API 兼容 | PREREQUISITE COMPLETE | Session/创建响应/validate-only 未调整；统一详情 `last_rejection` 已由 PHASE1-TASK11 在非生产开发代码实现 |
| 测试设计 | COMPLETE | 单元、组件、集成、原 47 项加 7 项扩展 E2E，以及 1366×768 人工视觉/键盘验收 |
| 文档阶段基线 | PASS | lint 0 error/1 个既有 warning；Node 103/103；隔离 API、凭证扫描、临时 SQLite 五项基线和 `git diff --check` 通过 |
| 代码/API/schema 变化 | NONE IN TASK10 | TASK10 未修改运行时代码；后续 TASK12 仅实施前端与测试，仍未修改 API、Schema、Migration、索引或业务服务 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实物料、未部署或修改生产配置 |

## PHASE1-TASK09 Material 只读管理界面实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 规格已确认，非生产实现、测试和文档完成 |
| 页面路由 | IMPLEMENTED | `/materials`、详情、版本和变更日志四条原生 Vinext 路由；本地开发运行面深链接均返回 200 |
| 布局 | PASS | 高密度企业表格列表；高密度分区卡片详情；独立 URL 历史页签；首屏无统计卡片 |
| URL 与分类 | PASS | URL 权威筛选/排序/分页、300ms keyword debounce、popstate、安全 return_to、叶子 ID/非叶子 path 语义均有测试 |
| 认证与请求 | PASS | 复用现有 Cookie 和根页面登录遮罩；legacy 与 Material 共同委托唯一共享浏览器 Client；未硬编码生产地址或直连 D1 |
| 状态与错误 | PASS | INACTIVE 独立兼容、OBSOLETE/REPLACED 防御映射、unknown fallback；401/403/404/400/500、request_id、加载和空状态均覆盖 |
| UI 测试 | PASS | 37/37，覆盖任务要求的 36 类场景；无写操作、无界请求或客户端行级权限过滤 |
| Site 基线 | PASS | build、全量 Node 103/103、lint 0 error/1 个任务外既有 warning、一次性 D1 smoke 通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时目录已清理 |
| 安全检查 | PASS | 217 个仓库文件凭证扫描通过；`git diff --check` 通过 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实物料、未部署或修改生产配置 |

## PHASE1-TASK08 Reference & Query API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 规格与 metadata 兼容规则已确认，非生产实现和验证完成 |
| 运行时代码 | IMPLEMENTED | 统一 Material Query Service、Reference Service、共享可见性和单位策略已接入；未修改前端或 legacy SQLite |
| 数据库 | UNCHANGED | 未修改 `db/schema.ts`、`drizzle/` 或任何 migration，未增加索引 |
| 统一查询 | PASS | `/materials` 覆盖全部生命周期；`/drafts` 复用统一可见性与详情组装；`/review-queue` 保持独立权限 |
| 行级可见性 | PASS | 正式状态全 read；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue；隐藏详情/历史 404，列表及 total 完全过滤 |
| Reference | PASS | 完整启用分类 tree/flat、无 parent 懒加载；叶子 Schema 只读 D1 metadata；description/label fallback 和强 ETag/304 已验证 |
| 历史 | PASS | 详情每类最多 5 条摘要；版本和变更日志独立分页默认 20、最大 50；损坏 JSON fail-closed |
| 缓存与批量 | PASS | Reference 私有可验证缓存；物料及历史 private/no-store；列表 metadata 查询次数不随页大小增长 |
| 索引证据 | COMPLETE / NO MIGRATION | 1k/10k/100k 计划与采样完成；发现创建人 OR 可见范围等候选方向，只形成报告，未创建 migration |
| 非生产基线 | PASS | Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、201 文件凭证扫描及临时 SQLite 完整基线通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 仅 `db/schema.ts:147`、`:332` 的既有 Drizzle 自引用 TS2740；TASK08 文件未出现类型错误，按授权未修改任务外问题 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK07 草稿生命周期实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 九项方案 A 已确认、实现、验证并记录；等待人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | 生命周期规格和 OpenAPI 明确 PATCH 非 Merge Patch、提交、队列、审核状态及稳定错误 |
| 状态命名 | PASS | 新代码只写/只返回 `PENDING_REVIEW`；通用查询双读旧/新值；历史快照旧文字不改写 |
| 职责字段 | PASS | 新增 `last_modified_by`、`submitted_by`、`submitted_at`；创建人永久禁审，当前版本最后修改人禁审，提交人本身不禁审 |
| API | IMPLEMENTED | PATCH 完整替换、POST 提交、GET 审核队列已实现；approve/reject 只处理 `PENDING_REVIEW` |
| 权限 | PASS | edit-own/edit-any/submit/review-queue 在服务端独立校验；admin/manager 无职责分离例外，purchase/engineering 仅自己的草稿 |
| Migration | PASS | `0003`、Down、snapshot/journal、旧状态可恢复回填、失败预检、子表保全、约束、索引、空库 Down/重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 仅修改在线服务端生命周期、Schema、Migration、测试和文档；未开发页面或下游业务 |
| 非生产基线 | PASS | Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 D1 API smoke、194 文件凭证扫描及本地临时 SQLite 完整基线通过 |
| TypeScript 全量检查 | EXISTING FAILURE | TASK07 新增代码无类型错误；`db/schema.ts` 两组既有 Drizzle 自引用类型诊断仍保留，按范围要求未修复 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK06 Draft/Review API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 项目负责人已确认八项业务/安全选择；实现、测试和项目文档完成，等待功能提交后人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | `docs/material-master/draft-review-api-v1.md` 已记录确认选择和实施结果 |
| 认证边界 | VERIFIED | 复用 `app_users`/`app_sessions` 和服务端会话 actor；未使用未接入 ERP 的 ChatGPT Header 身份；禁止客户端伪造操作者 |
| 授权边界 | PASS | admin/manager 审核，purchase/engineering 创建，其他角色只读；所有角色包括 admin 禁止自审 |
| CSRF | PASS | 登录轮换 host-only 双提交 Token；Material POST 严格验证同源 Origin、Cookie/Header，Session Cookie 继续 HttpOnly |
| 幂等与限流 | PASS | 专用持久表保存 canonical 请求摘要、租约和 24 小时结果；完成/成功审计与业务 batch 原子提交；60 次写/20 个新 Key，测试可降低阈值 |
| Query | PASS | 列表默认 20/最大 100；详情当前 metadata 校验、分类路径、版本和变更日志均有界分页 |
| Migration | PASS | `0002` Up/Down、schema、snapshot/journal、已有数据升级、约束、防重、空状态回滚和重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 新增 5 路由、Material API 五模块、共享 Validation 映射、2 张安全表和审计扩展；未开发页面或下游业务 |
| Site 基线 | PASS | build 成功；Node 58/58；lint 0 error/1 个既有 warning；一次性 D1 登录/CSRF/API smoke 和凭证检查通过 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite `go_live_check --no-backup` 通过 |
| 差异检查 | PASS | `git diff --check` 通过；敏感正文、原始 Key、Session/CSRF Token 不进入 Material 审计或错误响应 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK05 草稿创建与审核写服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-13 完成实现、验证、文档和独立功能提交 |
| 模块边界 | PASS | Types、D1 Repository、Draft Service、Review Service、Code Service 和统一导出保持独立；PHASE1-TASK06 通过受信适配调用，未复制业务规则 |
| 创建草稿 | PASS | Validation 无 ERROR 后原子写 `DRAFT`、类型化属性、`CREATE` 版本和 `CREATE_DRAFT` 审计；正式编码为空 |
| 批准启用 | PASS | 从 D1 重载并重新校验；单一 batch 原子领取序号、转 `ACTIVE`、写编码/批准信息、`APPROVE` 版本及两条审计 |
| 拒绝 | PASS | 保持 `DRAFT`、version + 1、追加 `REJECT` 版本和审计；不读取或消耗编码规则 |
| 属性存储 | PASS | 按 definition 类型列保存 TEXT/ENUM/INTEGER/DECIMAL/BOOLEAN，DECIMAL 精确缩放；保留 unit、source_type、source_ref、created_by/created_at |
| 并发与编码 | PASS | 同草稿双审核一成功一版本冲突；同规则双草稿读取同一旧序列后 CAS 重试并生成不同编码；唯一索引竞争路径跳过占用序号 |
| 规则漂移保护 | PASS | 创建和批准均比较 metadata/属性守卫；校验后品类/属性规则变化时事务冲突回滚 |
| 事务回滚 | PASS | 故障注入使最后一条编码审计失败，规则、物料状态、版本和审计全部保持事务前值 |
| 服务测试 | PASS | 新增 12/12 隔离 D1 场景；完整 Node 52/52 |
| Site 基线 | PASS | build 成功；lint 0 error/1 个既有 warning；隔离 API smoke、176 文件凭证检查和 `git diff --check` 通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍为既有 Drizzle 自引用类型错误 |
| 数据库/API 变化 | NONE | 未修改 schema、migration、API、页面、导入、BOM、采购、库存或生产 |
| 生产影响 | NONE | 未连接生产 D1，未迁移真实数据，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无多角色节点、草稿编辑/重新提交、API 权限/幂等；拒绝状态复用 `DRAFT`；编码规则仍需后续受控初始化 |

## PHASE1-TASK04 物料校验服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-12 完成实现、验证、文档和独立功能提交 |
| 设计审批 | PASS | 采用 Repository + Rules + Service；D1 metadata 是运行时分类和属性规则唯一来源 |
| 接口边界 | PASS | attributes 按稳定大写 attribute code 索引；禁止 attribute_id；保留 source/confidence 扩展字段 |
| 服务实现 | PASS | Types、D1/Memory Repository、Rules、Service 和统一导出已完成；25 个结构化 code 中 24 ERROR、1 WARNING |
| Metadata 变化 | PASS | 隔离 D1 中标准单位、枚举、必填、属性定义/绑定/分类状态变化均在下一次校验生效 |
| 校验测试 | PASS | 新增 22 个顶层测试和 6 个子测试，共 28/28；Memory Repository 与指定 FR4/电阻/锡膏矩阵通过 |
| Site 基线 | PASS | build 成功；Node 40/40；lint 0 错误/1 个既有警告；隔离 API 烟测和凭证检查通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍有 PHASE1-TASK02 已记录的 Drizzle 自引用类型错误 |
| 业务变化 | NONE | 未修改 API、页面、迁移、真实物料或 BOM/采购/库存 |
| 生产影响 | NONE | 未连接生产 D1，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无品牌字典、不做单位数值换算、不支持 DATE、不检测跨物料冲突，source/confidence 暂不参与决策 |

## PHASE1-TASK03 分类与属性模板状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 分类数据 | PASS | 101 个节点、5 个一级分类、39 个四级叶子；父子级别连续 |
| 属性定义 | PASS | 34 个复用定义；覆盖 TEXT、INTEGER（NUMBER 语义）、DECIMAL、BOOLEAN、ENUM 与要求单位 |
| 属性绑定 | PASS | 228 条绑定全部指向四级叶子；叶子 39/39 均有完整模板，不存在父级继承 |
| Seed 幂等 | PASS | 首次写入后第二次 inserted 为 0，记录总数不变并输出 updated 统计 |
| 环境保护 | PASS | 仅接受 test/local；production 和 `--remote` 在数据库访问前拒绝 |
| 数据库影响 | NONE | `0001` migration、schema 和快照未修改；未连接生产 D1 |
| Site 基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 12/12（包含 migration）通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 本任务新增文件无类型错误；`db/schema.ts` 第 129、243 行存在 PHASE1-TASK02 已有的 Drizzle 自引用类型错误 |

## PHASE1-TASK02 Schema 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 目标运行面 | CONFIRMED | 仅在线 Site/D1 schema；本地 SQLite 未修改 |
| 设计审批 | PASS | 已吸收正式编码审核后生成、生命周期、变更日志、供应商五要素时效唯一性和应用层校验调整 |
| 数据库变化 | IMPLEMENTED | 新增 12 张 V2 表的 Drizzle schema、`0001` Up/Down、snapshot 和 journal |
| 业务变化 | NONE | 未修改 BOM、采购、库存、生产、导入、AI、API 或页面 |
| 数据操作 | NONE | 未连接生产 D1，未迁移真实数据，未创建生产表 |
| 隔离迁移 | PASS | 空库 Up、防重、结构/约束、Down、重建通过；临时 D1 已清理 |
| 完整基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 9/9；隔离 API 烟测、本地三项临时基线、凭证扫描和 `git diff --check` 通过 |

## PHASE0-TASK02 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Site 环境守卫 | PASS | Node 6/6；production、公开 URL、非临时 D1 路径和非法环境名均拒绝 |
| 本地环境守卫 | PASS | Python 4/4；production/development 在数据库创建前拒绝 |
| 一次性 D1 API 烟测 | PASS | 完成合成写入、备份、恢复与错误提示验证；测试后数据库目录和进程均清理 |
| production 入口拒绝 | PASS | 退出码 1，未创建新临时目录 |
| 凭证检查 | PASS | `.env` 未跟踪；仓库文件、常见令牌格式和 hosting 键检查通过 |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时 SQLite |
| `smoke_test.py` | PASS | 输出 `SMOKE_TEST_OK`，数据库和备份均位于临时目录 |
| `backup_restore_test.py` | PASS | 创建、恢复、非法名称提示和最终数据清理通过 |
| `go_live_check.py --no-backup` | PASS | 使用临时 SQLite；未写正式数据或备份 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告 |
| `npm test` | PASS | 构建成功，Node 测试 8/8 通过；沙箱缓存写入限制下获准在沙箱外重跑 |
| `npm run build` | PASS | 最终独立构建通过，未连接数据库或网络 |
| 最终仓库检查 | PASS | 149 个仓库文件凭证扫描通过；`git diff --check` 无空白错误；代码中无生产地址硬编码 |

任务没有创建云端 D1、连接生产 D1、修改生产数据、保存 Site 版本或执行部署。

## PHASE0-TASK01-B 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时数据库 |
| `go_live_check.py --no-backup` | PASS | 数据库检查通过；本地服务未启动，不要求在线健康检查 |
| `smoke_test.py` | FAIL（既有环境问题） | 临时测试进行到备份创建时返回 `unable to open database file`；与 PM-000 基线一致，未接触生产数据 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告，位于 Site 中此前合入的治理工具 |
| `npm test` | PASS | 沙箱内首次因 Vite 无权写 `node_modules/.vite-temp` 失败；按环境规则在沙箱外重跑后构建成功，渲染测试 2/2 通过 |
| Site tree 对比 | PASS | 纳管后的暂存子树 hash 与原 `9f2c2dc` tree hash 均为 `541decf5a685a0efc238868ef958d3ae500174e5` |
| Git 索引检查 | PASS | `chenyida_erp_site` 显示 77 个普通文件，仓库无 mode `160000` |
| 新 clone 恢复 | PASS | 使用 `git clone --no-local` 创建全新工作区；Site 为 77 个普通文件、0 个 gitlink，关键源码和文档完整存在，工作区干净 |
| 新 clone 依赖与测试 | PASS | Site 执行 `npm ci --offline` 安装 502 个包且 0 漏洞；`npm test` 构建成功、2/2 通过；本地 ERP `--self-test` 输出 `SELF_TEST_OK` |
| `git diff --check` | FAIL（继承内容） | 报告原 `9f2c2dc` tree 中既有的行尾空白和 EOF 空行；为保持 Site tree 完全一致，本任务未修改这些文件 |
| 在线 `erp-api-smoke.mjs` | NOT RUN | 脚本会写数据且尚无生产地址拒绝，禁止对公开生产 Site 执行 |

测试前后 `chenyida_erp_app/data/erp.sqlite3` 均为 233,472 字节，最后修改时间戳保持不变，本任务未修改正式本地数据库。
