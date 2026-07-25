# SELFHOST-PHASE4-TASK04：建立供应商询价、报价、比价与人工定标闭环

状态：`DOING`

开始日期：2026-07-26（Asia/Shanghai）

负责人：Codex（关系模型、服务端询比价与人工定标、原生界面、隔离测试、并行环境验收、文档与独立提交）；项目负责人（固定业务决定与并行部署验收授权）

## 可信起点

- Branch `main`，HEAD `5cf525a1b2733954a9d658c2582565e364770b23`，工作区 clean，相对 `origin/main` ahead 23 / behind 0。
- 自托管版本 `0.1.0-alpha.17`；PostgreSQL migration `0001`—`0017`，`0017` SHA-256 为 `33cb162e5e32aeaca015a9d6e25a33f048166c7c895ebbc242819f6bbe2b6b28`。
- Compose 项目 `chenyida-erp-parallel`，Web 仅 `127.0.0.1:3000`；旧 Python PID `277640` 继续监听 `18888`。
- 真实 SQLite 不读取、不修改；不迁移真实数据、不双写、不切流。

## 唯一范围

只在 Node.js/PostgreSQL 自托管运行面建立采购部门从最新 `ACCEPTED` 采购申请选择 ACTIVE 候选供应商、发出 RFQ、代录不可变版本报价、按 CNY/基础单位或既有 1:1 采购单位口径生成确定性比较、人工定标及可审计撤销闭环。定标只产生 Sourcing Award。

## 固定业务规则

1. 只有最新 `ACCEPTED` 采购申请可创建 RFQ；每个候选供应商均须 `ACTIVE`，并为每条申请物料具备当前有效 Supplier Mapping。
2. 首期只支持 CNY、Material 基础单位及既有 1:1 采购单位映射，不做币种或单位换算。
3. RFQ 发出后范围和行不可原地修改；重新询价创建新 Round，同一采购申请同时只有一个有效 Round。
4. 报价必须记录供应商、版本、有效期、MOQ、单价、交期、含税/运费口径和条款；已提交报价不可改，改价创建新版本。
5. 比较仅由服务端使用 PostgreSQL numeric 完成；按 currency/unit/tax/freight 分组，再按 unit_price、promised_delivery_date、supplier_id 确定性排序；浏览器不重算排名，也不自动审批。
6. 过期报价不可定标；每条申请行只允许一个中标供应商。单一有效报价必须 `SOLE_SOURCE`，非最低价必须说明原因，晚于需求日必须记录 `LATE_DELIVERY_ACCEPTED`，超申请数量必须说明超量原因。
7. 定标必须引用当前有效报价和每行最新比较版本；定标后不可修改或删除，更正只能撤销并创建新 RFQ Round。
8. purchase 拥有完整询比价能力，planning 只读采购进度，manager/admin 拥有全部能力；其他固定角色不获得采购询比价写权限。
9. 全部写接口执行 Session/must-change、服务端权限、CSRF、Idempotency-Key、expected_version/CAS、有界正文、稳定 request_id/中文错误，并在单一事务写业务、事件、Audit 和 Idempotency。
10. 本任务不创建采购订单、收货、库存、应付、生产记录，不修改 TASK03 Planning Allocation 或 Inventory `reserved_qty`。

## 交付内容

1. 新增 expand-only `0018_procurement_sourcing.sql`，同步 Drizzle schema/journal/snapshot/manifest/checksum，不修改 `0001`—`0017`。
2. 新增独立 `procurement-sourcing-selfhost` Repository/Service/Handler/Validation/Error/Types 边界，覆盖 RFQ 队列/详情、发出、报价/修订、比较、定标和撤销 API。
3. 关系化保存 RFQ/行/候选供应商、报价版本/行、比较版本/行、定标/行和不可变事件；数据库 guard 禁止已发 RFQ、已提交报价和定标历史被直接改写或删除。
4. 新增 `/procurement/sourcing` 与 `/procurement/sourcing/:rfqId` 原生页面；Dashboard 增加待询价、待报价、待定标，不显示“创建采购订单”。
5. 覆盖专项 19 项验收、migration 空库/0017 升级/重复/失败回滚、权限/幂等/CAS/并发/故障回滚、TASK01—TASK03 与共享领域回归、typecheck/lint/build/凭据扫描和 Python 临时 SQLite 三项。
6. 版本目标 `0.1.0-alpha.18`；先创建功能提交 `feat: add procurement sourcing workflow`，再仅在 `chenyida-erp-parallel` 执行实际两供应商询价、报价、比较、人工非最低价定标、重启持久与恢复清理，最后创建独立 ops 提交。

## 明确排除

- 不创建采购订单、到货计划、收货、库存 Ledger/Balance、应付或其他财务事实。
- 不进入生产、品质、完工或发货；不启动 TASK05。
- 不读取或迁移真实 SQLite/D1/附件正文，不执行生产 migration、生产部署、HTTPS、公网开放、切流、push 或 PR。
- 不重新启用历史 Sites/D1 作为业务权威，不修改 Python 常驻进程或真实 SQLite metadata。

## 完成判定

唯一允许结论：`PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`。

完成报告目标：`docs/tasks/SELFHOST-PHASE4-TASK04-completion.md`。该结论不表示采购订单、收货、库存入账、应付、真实迁移、HTTPS、切流或生产上线完成；TASK04 完成后停止。
