# SELFHOST-UAT-FIX-24 — 展示 RFQ Binding 稳定 ID 及发出前固定凭证

## 状态

- 状态：`DONE`
- 开始：2026-08-05
- 完成：2026-08-06
- 负责人：Codex；项目负责人负责既定展示、Web-only 部署和主 UAT purchase-only 只读验收授权
- 依赖：SELFHOST-UAT-FIX-22、SELFHOST-UAT-FIX-23、D-061、D-091、D-094、D-095

## 严格起点

- `main@3bea653`，Parent `f919890`，`origin/main...HEAD` behind 0 / ahead 146，工作区起点 clean。
- `0.1.0-alpha.40`；Migration `0001—0039`；0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- Web image `sha256:5fe406949d4678d5beb06ba6db4d931f88f5f24989332654b557b8a4f9df6e4b`；PostgreSQL/Web healthy，Worker/Caddy running。
- 主 UAT 为 RFQ ID 1 / `RFQ-00000001`、Round 1、DRAFT v2、Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 0、Quote/Award/PO 0/0/0；固定范围摘要 `9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`，固定 request_id `52ed7a96-3a78-46e2-8ed8-2a1b4076a6e7`。

## 模型诊断

- 0039 表 `procurement_rfq_supplier_line_mapping_bindings` 已有独立 `id bigserial PRIMARY KEY NOT NULL`；它是 PostgreSQL 持久、唯一、可独立引用的权威 Binding ID。
- 采用分支 A：不新增 Migration，不修改 `0001—0039`，保持 `0.1.0-alpha.40` / 0039。
- 服务查询已能偶然读到通用 `id`，但 Repository、显式 DTO、Handler 合同和 UI 尚未把它作为 `binding_id` 贯通；本任务只补齐该可追溯展示和凭证校验。

## 实施与保护边界

- Repository 必须显式投影真实 `b.id::text AS binding_id`，避免 JavaScript `bigint` 精度丢失；Service DTO、Handler 和 UI 使用同一字段，不得以数组序号、组合索引、哈希截断或临时拼接替代。
- 八条 Binding 按 Supplier、Material 和稳定 ID 确定性排序；详情明确区分 Binding ID、Mapping ID、RFQ Line ID 和 Material ID，并展示固定/当前状态、版本漂移及固定范围摘要归属。
- 详情新增可重新打开的独立 Mapping 固定凭证，来自唯一成功 lifecycle Event；发出确认同时展示创建 Audit、Mapping 固定 Event、八条 Binding ID、Mapping ID/Version、四 Material、两 Supplier、截止日/币种与不可变后果。
- 缺少、重复、跨 RFQ Binding ID，或固定 Event/摘要/范围无法验证时，UI 禁用发出且正式 POST 以稳定错误代码失败关闭。详情和发出预览保持零业务写入，purchase 权限、RFQ 数据域、CAS、幂等、并发、漂移和事务保护不得放宽。
- 不再次固定 Mapping，不发出 RFQ，不修改或删除 Binding、RFQ、Supplier、Mapping、PRQ或截止日，不创建 Quote、Award 或 PO。

## 验收与部署

- 严格串行完成 Unit/UI、隔离 PostgreSQL、Chromium、适用回归、typecheck、Schema consistency、lint、build、凭据扫描、diff check 和 Python 三项。
- 部署前建立覆盖 RFQ、八条 Binding、Event、Quote/Award/PO 及全部下游的保护指纹，并创建 root:root 0600 PostgreSQL custom dump；记录大小和 SHA-256，`pg_restore --list` 与第二空库恢复通过。
- 本任务无 Migration，只允许替换 Web；不得重建 PostgreSQL、Worker、Caddy 或更换 Volume。
- 主 UAT 仅以 purchase 登录，读取详情和八个真实 Binding ID、打开 Mapping 固定凭证、打开发出确认后取消，并做桌面/390×844检查与安全退出。最终必须保持业务 POST 0、DRAFT v2、Binding 8、ISSUED 0、Quote/Award/PO 0/0/0、保护指纹不变、Session 0。

## 完成结果

- 采用分支 A，真实主键为 `id bigserial PRIMARY KEY NOT NULL`；没有 0040，保持 alpha.40/0039。
- 功能提交 `e329931`；最终 Web `sha256:315f0b7945a7b3eb27841ffaae8a444fba45dd94791519dc856173a95d830635` 已 Web-only 部署。
- 主 UAT八个 Binding ID 为 `3,4,1,2,7,8,5,6`；完整固定凭证和桌面/390px发出窗口通过，只取消，业务 POST 0、Session 0。
- 最终结论：`RFQ BINDING IDENTIFIERS DEPLOYED — UAT RFQ STILL DRAFT`。详见[完成报告](SELFHOST-UAT-FIX-24-COMPLETION.md)。
