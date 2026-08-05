# SELFHOST-UAT-FIX-23 — 补齐 RFQ Mapping 固定确认的资格与冲突证据

## 状态

- 状态：`DONE`
- 开始：2026-08-05
- 完成：2026-08-05
- 负责人：Codex；项目负责人负责既定范围、Web-only 部署和主 UAT 只读授权
- 依赖：SELFHOST-UAT-FIX-22、D-061、D-091、D-094、D-095

## 严格边界

- 保持 `0.1.0-alpha.40` 与 Migration `0001—0039`，不新增或修改 Migration。
- 只实现 RFQ Mapping 固定权威预览、POST 同规则重验和创建凭证措辞修正。
- 预览为认证、purchase 权限和 RFQ 数据域保护的 `REPEATABLE READ READ ONLY` 查询；成功或失败均不得写 Audit、Event、Idempotency 或 Binding。
- 主 UAT 只允许打开预览后取消、关闭或 ESC；不得固定 Mapping、发出 RFQ、录报价或创建 Award/PO。
- 不修改主 UAT RFQ、PRQ、Supplier、Material 或 Mapping。

## 权威合同与验收

- 服务端重新投影 RFQ/PRQ CAS、四条 RFQ Line、两家 Supplier、两家各 4/4 覆盖、八条 Mapping ID/Version/CAS/单位/有效期，以及 Supplier/Material 与 supplier_part_number 两类冲突计数。
- 资格判定与正式 POST 共用同一 Service 规则；预览摘要是并发校验凭证而非锁。POST 必须重新查询，并对 RFQ/PRQ/Mapping/CAS/Binding 漂移失败关闭且生成零 Binding。
- Mapping 缺失/失效、Supplier 或 Material 失效、重复当前 ACTIVE、供应商料号冲突、RFQ 非 DRAFT、已有任意 Binding 均使 `qualification_passed=false`，并返回稳定代码、中文说明和处理建议。
- 历史 RFQ 精确成功 Audit 必须标记为“RFQ 创建成功审计”，明确不是独立 `RFQ_CREATED` 业务 Event；新 RFQ 的 `RFQ_CREATED` Event 独立显示。
- 自动测试、隔离 PostgreSQL、Chromium、适用回归、typecheck、Schema consistency、lint、build、凭据扫描、diff check 与 Python 三项必须严格串行。
- 部署前做 root:root 0600 PostgreSQL custom dump、list 与第二空库恢复；只替换 Web，不运行 Migration、不重建 PostgreSQL/Worker/Caddy。
- 最终主 UAT 必须仍为 RFQ 1 / `RFQ-00000001`、DRAFT v1、Binding 0、ISSUED 0、Quote/Award/PO 0/0/0、八条 Mapping ACTIVE、四行/两 Supplier 不变，且 Session 0。

## 起点证据

- `main@7cd9cd0`，Parent `b339acd`，`origin/main...HEAD` behind 0 / ahead 144，工作区起点 clean。
- `0.1.0-alpha.40`；Migration `0001—0039`；0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- Web image `sha256:58d97778d88d6103ca4d6cc3e0bfe8033bf0921a6c1b7ecbec31254403792651`；PostgreSQL/Web healthy，Worker/Caddy running，RestartCount 0、OOM false。
- 起点保护指纹 `9d4641b1b6324de4e3a1a26e7461ca2e15bd7613cb99a277c11e6bca869ac66e`：RFQ DRAFT v1、4 Line、2 Supplier、8 ACTIVE Mapping、Binding/ISSUED/Quote/Award/PO 0/0/0/0/0，Session 0。

## 开发阶段证据

- 权威预览采用共享 Service 资格加载器；正式固定事务在锁定 RFQ、PRQ、Line、Supplier、Material 与 Mapping 后重新执行同一规则，并核对预览资格摘要。预览摘要不是提交锁。
- 隔离验证：Unit/UI `16/16`、Sourcing/FIX-23 PostgreSQL `19/19`、Migration/FIX-22 `6/6`、Material Requirement `18/18`、Chromium `2/2`；正常隔离固定恰好生成 8 条 Binding，RFQ 仍 DRAFT，下游 0。
- 最终 typecheck、目标 lint 与 build/postbuild 已通过；全量 lint 为 0 error / 11 个既有 warning，凭据扫描覆盖 1,220 个文件，Python 三项通过。
- `db:generate` 在任务树和原始 `7cd9cd0` 独立副本都会提出仅将两个既有 `supplier_mappings` CHECK 表达式表限定化的语义等价 0040。FIX-22 的 schema/snapshot/journal 契约测试仍为 `6/6`；该起点漂移不属于本任务，生成物已丢弃，未新增或修改 Migration/Schema。

## 完成结论

- `RFQ BINDING PREVIEW FIXED — UAT BINDINGS STILL ZERO`
- 最终 Web 为 `sha256:5fe406949d4678d5beb06ba6db4d931f88f5f24989332654b557b8a4f9df6e4b`；只重建 Web，0039、PostgreSQL、Worker、Caddy、Origin、端口和四卷保持。
- 主 UAT purchase-only 只读验收通过：Supplier 1/2 各 `4/4`、两类冲突 0、八条 Mapping、Binding 0，ESC/取消、桌面/390px、业务 POST 0和 Session 0。
- 最终 RFQ 仍 DRAFT v1，RFQ Event/ISSUED/Quote/Award/PO 为 `0/0/0/0/0`，保护指纹不变。
- 详细证据见[完成报告](SELFHOST-UAT-FIX-23-COMPLETION.md)。
