# SELFHOST-MATERIAL-IMPORT-SAFETY-43 物料导入 fallback 幂等、文件原子性与任务所有权加固

> 状态：`DOING / IMPLEMENTATION IN PROGRESS / REPOSITORY AND ISOLATED TESTS ONLY / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@70bfb8b1f2791442912db392ee386103d02cab69`
> 责任：Codex 主智能体为唯一写者、测试执行者、文档维护者和提交者；数据迁移、应用测试、运维安全智能体提供既有只读审计证据；项目负责人负责未来 UAT/生产 Migration、部署、真实数据和员工试用专项授权

## 1. 目标

推进投产路线 G4，关闭 `PR-004`：让自托管 Node.js/PostgreSQL 的物料导入 fallback 在服务端具备持久幂等、所有权与状态/CAS 校验、文件 staging 与同文件系统原子提升、真实文件类型和基础安全检查、跨数据库/文件系统故障后的可恢复协调，以及后台任务按导入批次所有权隔离。

本任务只修改仓库源码、扩展式 Migration、自动化测试和文档，并只使用合成文件与隔离 PostgreSQL。不得连接或改变当前非生产 UAT、生产数据、当前 uploads/attachments/backup-status/PostgreSQL、运行容器、镜像或部署身份。

## 2. 已核验缺口

- 建批路由虽然客户端发送 `Idempotency-Key`，fallback 服务端没有持久幂等占位、请求摘要或成功重放，重试会重复建批。
- 上传路由先解析 multipart 并把文件写入永久目录，之后才在数据库中核验批次所有者；越权、状态冲突或数据库失败可能留下孤儿文件。
- 上传没有消费现有客户端发送的 `X-Expected-Version`、`X-File-SHA256`、`X-File-Size` 与 `X-Duplicate-Action`，没有状态守卫、CAS、同 key 异请求冲突或并发唯一性。
- `fileDto`按扩展名推断类型并无条件返回 `BASIC_CHECK_PASSED`，没有服务端实际签名、摘要、大小和基础安全检查事实。
- `/api/jobs/:id`只按 UUID 查询 `background_jobs`，没有把任务关联到批次后复核 owner/`material.import.read_any`，并直接暴露持久结果字段。

## 3. 决策与实现边界

- 采用 D-117 的数据库意图 + 私有 staging + 服务端检查 + 同根原子提升 + 最终发布 saga；跨 PostgreSQL 与文件系统不宣称虚假 ACID。
- 建批和上传均使用既有 `material_import_idempotency`，作用域绑定用户、方法、精确路由、key 摘要和规范请求摘要；同请求重放原响应，异请求冲突，处理中返回稳定可恢复状态。
- 上传在读取大请求体前完成认证、权限、CSRF、必填头、批次 owner、允许状态、CAS 和幂等意图检查；文件只进入任务私有 staging，不直接成为可消费正式文件。
- 服务端独立核对实际 SHA-256/大小、扩展名/MIME/文件签名和基础安全规则；只有事实一致且检查通过才可原子提升并把批次发布为 `FILE_READY`。
- 数据库或进程在任一步失败时不得猜测成功或删除身份不明文件；确定性操作标识、文件状态和协调流程必须可在重试/重启后安全完成或转为 `RECONCILIATION_REQUIRED`。
- job 读取必须通过 outbox aggregate 与导入批次 owner/`material.import.read_any`关联；不存在和不可见统一返回 404，只返回允许字段。
- 只扩展 0042，不修改或重排 0001—0041；Schema、snapshot、journal 与运行查询保持一致。

## 4. 验收标准

- [ ] 建批持久幂等覆盖首次成功、同 key 同请求重放、同 key 异请求 409、并发双请求只有一个批次、事务失败零残留。
- [ ] 上传在请求体落盘前完成 owner/状态/CAS/幂等意图校验；越权或不可见返回 404，过期版本/非法状态/缺头/异请求不创建 staging、正式文件或文件行。
- [ ] 文件采用同文件系统私有 staging、受限路径和确定性 operation identity；服务端实际摘要/大小、类型签名、扩展名/MIME 和基础安全检查全部持久化，错误不再虚报通过。
- [ ] 通过检查后以无覆盖、可 fsync 的原子提升发布；重复文件策略、单批次单文件、并发上传和 CAS 均由数据库约束与服务端事务守卫。
- [ ] 故障注入覆盖 staging 写失败、检查失败、准备事务失败、原子提升前后进程/数据库失败、最终发布失败和重启协调；任何结果都只能是完整成功、可安全重放、明确失败或有证据的 `RECONCILIATION_REQUIRED`，不得出现可消费孤儿文件。
- [ ] `/api/jobs/:id`对 owner、`material.import.read_any`和无权限身份完成岗位矩阵；不可见任务统一 404，响应不泄露 payload、原始异常或其他批次结果。
- [ ] 0042覆盖空库升级、0041已有数据升级、重复执行、约束、失败回滚、snapshot/journal/schema一致性；不改历史 Migration。
- [ ] 前端既有创建/上传重试合同与服务端对齐；API/DTO继续返回稳定错误码、中文提示和 request ID，响应为 `private, no-store`或等价安全缓存边界。
- [ ] 专项 unit、handler、隔离 PostgreSQL、文件故障、Migration、相关 Node 回归、lint、适用 typecheck、release inventory、敏感信息和 `git diff --check`全部通过；重任务串行并记录资源/OOM/restart/清理。
- [ ] 更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`、`ROADMAP.md`及相关导入/运维文档，创建聚焦实现、迁移/测试和治理独立提交。

## 5. 禁止范围

- 不 build/pull/push 镜像，不修改或运行当前 Compose，不停止、重启或替换任何服务。
- 不连接 UAT/生产数据库，不运行 UAT/生产 Migration，不读取当前业务行或四个受保护 Volume。
- 不上传真实供应商/客户文件，不使用真实备份，不调用外部模型或网络服务。
- 不修改账号权限、凭据、网络、防火墙、systemd、Swap、内核或 Docker daemon，不删除镜像、Volume、备份或业务数据。
- 不修改 0001—0041，不把历史 D1 重新变成新业务权威，不把浏览器校验当服务端安全结论。
- 用户未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 6. 起点资源与运行面证据

- Git：`main@70bfb8b1f2791442912db392ee386103d02cab69`，相对 public origin ahead 232；唯一既有未跟踪文件为受保护状态报告。
- 源码：`0.1.0-alpha.44`、Migration 41/head `0041_ai_governance_suggestion_evidence.sql`；UAT 身份沿用文档只读基线 `0.1.0-alpha.42`/0040，本任务不连接复核。
- 主机：available 约 2.2 GiB，Swap 425 MiB/1 GiB，根盘可用 31 GiB，Load `0.04/0.21/0.57`。
- 运行面：Web/PostgreSQL healthy，Worker/Caddy running；四容器 restart 0、OOM false。状态只读检查未读取 `.env`、容器秘密或业务数据。
