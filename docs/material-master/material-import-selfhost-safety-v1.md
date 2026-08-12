# 自托管物料导入安全与恢复合同 V1

> 状态：`SOURCE VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`
> 适用实现：`0.1.0-alpha.44`，PostgreSQL Migration head `0043_material_import_terminal_integrity.sql`
> 决策：D-117；任务：SELFHOST-MATERIAL-IMPORT-SAFETY-43

本文只定义未来权威自托管 Node.js/PostgreSQL fallback。历史 Sites/D1/R2 的[物料导入批次 V1](material-import-batch-v1.md)继续作为历史行为与迁移证据，不是本合同的运行权威。

## 1. 信任边界

- 浏览器只提交交互意图；认证、权限、CSRF、幂等、状态转换、CAS、摘要、文件类型、安全检查和任务可见性均由服务端判断。
- `material_import_batches.id` 是导入聚合稳定内部标识；原始文件名、供应商料号、客户料号和展示名称不得成为业务主键。
- PostgreSQL 管理业务意图与状态，本地文件系统管理字节。两者之间采用可恢复 saga，不宣称跨系统 ACID。
- 原始正文不得进入 Audit、错误响应或 job DTO；响应必须带稳定错误码、中文提示和 request ID，并使用 `private, no-store`。

## 2. 写入协议

### 建批

客户端必须为同一逻辑操作复用精确的 `Idempotency-Key` 和请求正文。服务端把作用域绑定为用户、HTTP 方法、精确路由、key 摘要和规范请求摘要：

- 首次请求原子创建幂等占位、批次、初始事件和 Audit；
- 同 key、同摘要返回已持久化结果；
- 同 key、异摘要返回稳定冲突；
- 事务失败不得留下批次、事件或可重放成功结果的子集。

### 上传

读取 multipart 正文前必须完成认证、权限、must-change、Origin/CSRF、必填 `Idempotency-Key`、`X-Expected-Version`、`X-File-SHA256`、`X-File-Size`、`X-Duplicate-Action`，以及批次 owner、允许状态、CAS 和幂等意图检查。失败时不得创建 staging、正式文件或文件行。

上传必须保留同一 operation/key/payload 处理不确定结果。处于 `RESULT_UNKNOWN` 或 reconciliation 状态时，客户端不得自动生成替代 key、覆盖正文或继续依赖写入。

## 3. 文件生命周期

1. 在配置的导入根目录内创建任务私有 staging；拒绝绝对路径、路径穿越、symlink、非预期 hard-link 或逃逸目标。
2. 有界流式写入并计算实际 SHA-256 与字节数；关闭文件并 `fsync` 后再进入检查阶段。
3. 服务端核对声明摘要/大小、扩展名、MIME 和文件签名。XLSX/CSV 仅在既有 parser/security 合同内接受；XLS CFB、XLM/VBA/宏、加密/结构异常或伪装文件失败关闭。
4. 在数据库中持久化已检查的文件事实与 promotion intent，再以同文件系统、无覆盖 hard-link promotion 发布，并 `fsync` 文件和目录。
5. 最终事务只在文件身份仍匹配且 CAS 有效时把文件与批次发布为可消费状态；失败进入可重放或 `RECONCILIATION_REQUIRED`，不得猜测成功或删除身份不明文件。

正式路径、staging 路径和 operation identity 必须由服务端确定。禁止用客户端文件名拼接路径，禁止覆盖已有文件，禁止把仅凭扩展名推断的结果标记为 `BASIC_CHECK_PASSED`。

## 4. 状态、协调与清理

- 创建、上传、取消和解析均有持久幂等；重试谱系必须显式连接原 operation。
- 批次、文件和后台任务只能按允许状态转换；owner、状态、version 与 lease 在终态发布前重新核验。
- reconciler 只处理有证据的过期/不完整 operation；确定性正式文件存在且摘要匹配时完成发布，不匹配时隔离并标记人工协调，不覆盖或静默删除。
- `DELETE_PENDING`、取消和过期由后台有界清理推进；未知身份文件不属于自动删除范围。
- worker 消费前重新计算文件摘要，并在单一数据库事务中发布 job terminal 与 parse/normalization/review 对应终态；过期或失去 lease 的 worker 不能提交结果。

## 5. 读取与岗位隔离

`GET /api/jobs/:id` 必须先通过 outbox aggregate 解析到导入批次，再验证批次 owner 或 `material.import.read_any`。不存在和不可见统一返回 404。响应只包括允许的 job 身份、类型、状态、进度、时间和有界结果摘要，不返回队列 payload、原始异常、文件路径或其他批次正文。

批次与恢复工作区对 owner 可见；跨创建人读取只授予具有明确 read-any 权限的岗位。UI 隐藏按钮不构成授权。

## 6. 数据库与发布身份

- `0042_material_import_fallback_safety.sql` 创建关系化 fallback 安全模型；其发布内容不可修改。
- `0043_material_import_terminal_integrity.sql` 以 append-only Migration 修正终态完整性约束；`0001`—`0042` 均保持不可变。
- `db/schema.ts`、0042/0043 snapshots、journal、运行查询和 release allowlist 必须一致。
- 源码 head 为 0043 不表示 UAT 已升级。任何运行面 Migration 必须绑定精确 Git/tree、镜像、Migration allowlist、备份恢复锚点及专项授权。

## 7. 运维处置

出现 `RESULT_UNKNOWN`、`RECONCILIATION_REQUIRED` 或长期 `DELETE_PENDING` 时：

1. 停止对同一批次生成新 key 或执行依赖写入，记录 request ID、batch ID、operation ID 和预期版本；不得记录正文或令牌。
2. 只读核对幂等、批次、文件、outbox/job 与协调状态，以及确定性 staging/正式文件是否存在、摘要是否匹配。
3. 优先让内置 reconciler 以同一 operation 恢复；只有证据表明状态机无法自动推进时才进入人工处置。
4. 人工处置前固定数据库与文件快照，按精确对象执行；禁止直接改业务状态、覆盖正式文件或清理身份不明字节。
5. 处置后复核批次/文件/job 终态、Audit、无可消费孤儿文件及资源清理，并把结果纳入任务与变更记录。

当前 alpha.42/0040 UAT 未部署本合同。上线前仍需完整 release gate、0040→0043 隔离升级、同候选 UAT 端到端、故障恢复与岗位验收。
