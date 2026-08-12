# SELFHOST-MATERIAL-IMPORT-SAFETY-43 物料导入 fallback 幂等、文件原子性与任务所有权加固

> 状态：`DONE / REPOSITORY AND ISOLATED TESTS VERIFIED / RUNTIME NOT DEPLOYED / PRODUCTION NO-GO`
> 日期：2026-08-12（Asia/Shanghai）
> 严格起点：`main@70bfb8b1f2791442912db392ee386103d02cab69`
> 源码提交：`5767c92e51e4f25ba49fa4431299f265ef4cb7aa` / tree `bb4ef005cc9d9eb858e553d6a1825298845352bb`
> manifest-only 提交：`dad7468`；bundle SHA-256 `b948e08861e5114660650e21faa9374cef879b354cb59c6c0d0bdb62960228e9`
> 责任：Codex 主智能体为唯一写者、测试执行者、文档维护者和提交者；项目负责人负责未来 UAT/生产 Migration、部署、真实数据和员工试用专项授权

## 1. 目标与结论

本任务推进投产路线 G4 并在仓库层关闭 `PR-004`：自托管 Node.js/PostgreSQL 的物料导入 fallback 已具备持久幂等、所有权与状态/CAS 校验、私有 staging、同文件系统无覆盖原子提升、真实文件类型与安全检查、跨数据库/文件系统失败后的可恢复协调，以及后台任务按导入批次隔离。

结论只适用于源码提交 `5767c92…` 及其直接子提交 `dad7468` 所绑定的证据包。当前非生产 UAT 仍为 `0.1.0-alpha.42`/0040，本任务没有 build、Migration、部署或运行面验收，因此运行环境仍保留旧实现，系统继续 `PRODUCTION NO-GO`。

## 2. 已完成实现

- 建批和上传均使用持久 `material_import_idempotency`，作用域绑定用户、方法、精确路由、key 摘要与规范请求摘要；同请求重放原结果，异请求冲突，事务失败不留半成品。
- 上传在读取正文前完成认证、权限、CSRF、必填头、批次可见性、状态、CAS 与幂等意图检查；文件仅进入私有任务 staging，并以受限确定性路径、`fsync` 和无覆盖 hard-link promotion 发布。
- 服务端重新计算 SHA-256、大小、类型签名、扩展名与 MIME，并拒绝 XLS CFB、XLM/VBA/宏及不安全输入；前端不能把声明值当安全事实。
- 重复策略、单批单文件、重试谱系、取消、过期、delete-pending 和 reconciliation 均持久化；响应不确定时保留同一 operation/key/payload 并锁定替换或依赖写入。
- worker 在消费前重新哈希文件，并在一个事务中发布 job terminal 与 parse/normalization/review 终态；过期或失去 lease 的 worker 不能终态化任务。
- `/api/jobs/:id` 经 outbox aggregate 关联批次并复核 owner 或 `material.import.read_any`；不可见统一 404，仅返回有界 DTO。
- `0042_material_import_fallback_safety.sql` 为初始扩展，发布后保持不可变；追加 `0043_material_import_terminal_integrity.sql` 修正终态约束。`0001`—`0042` 均未回写，Schema、snapshot、journal 和运行查询已对齐。

## 3. 验收结果

- [x] 建批持久幂等覆盖首次成功、同 key 同请求重放、同 key 异请求 409、并发双请求单批次及事务失败零残留。
- [x] 上传在正文落盘前完成 owner/状态/CAS/幂等意图校验；越权、非法状态、过期版本、缺头或异请求不产生可消费文件。
- [x] 私有 staging、受限路径、确定性 operation identity、实际摘要/大小/签名/MIME 与基础安全检查持久化，错误不再虚报通过。
- [x] 同根无覆盖原子提升、`fsync`、重复策略、单批单文件、并发上传和 CAS 均由数据库约束与服务端守卫覆盖。
- [x] 故障注入覆盖 staging、检查、准备事务、提升、最终发布和重启协调；结果限定为完整成功、可重放、明确失败或有证据的 `RECONCILIATION_REQUIRED`。
- [x] job owner、`material.import.read_any` 和无权限身份矩阵通过；不可见任务统一 404，DTO 不泄露 payload、原始异常或其他批次结果。
- [x] 0042→0043 覆盖空库/已有数据升级、重复执行、约束、失败回滚及 Schema/snapshot/journal 一致性；历史 Migration 不可变。
- [x] 前端恢复合同与服务端一致；错误码、中文提示、request ID 与 `private, no-store` 边界保持。
- [x] 专项单元、handler、隔离 PostgreSQL、文件故障、Migration、相关回归、lint、适用 typecheck、release inventory、敏感信息及 `git diff --check` 通过。
- [x] 项目总控、任务台账、上下文、变更、状态、投产基线、路线、决策、导入合同及运维/测试手册同步收口，并形成独立提交链。

## 4. 验证证据

- fallback unit/handler `20/20`、worker resilience `8/8`、UI contract `107/107`、Migration contract `4/4`、parser/API client `45/45`。
- 隔离 PostgreSQL：fallback `17/17`，真实 XLSX worker 集成 `1/1`；0042→0043 升级、重复执行、失败回滚与 allowlist 演练通过。
- TASK43 typecheck 通过；lint 退出 0，保留 11 条既有无关 warning；相关组合回归 `176/176`。
- release contract `44/44`、supervisor Python `15/15`；release inventory 验证为总计 230、必需 206、N/A 24，其中 Node 109、PostgreSQL 81、Browser 6、历史 D1 22、PG alias 2、release contract 6、POSIX 4。
- inventory digest `88d67a1119340ec39e75c04228e8d12da8c84eb11bfd176c060eb46f85ac4282`；runtime policy digest `d8cb15dc2c8d27cb0b0edcea70e19057c2bde7fc735a6cd0b4021f11671db14f`。
- 0041/0042/0043 SHA-256 依次为 `676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`、`c0eeab63bc51f1d1dd96805b43e78c83c5ef5e0a5d5712a08a0308c95b9385bf`、`0fdb3d4b92d999a5dede5a36a08bd99ea054879ebb6857341e08f0f0e07852d9`。
- 全仓凭据扫描在源码阶段通过 1,538 个文件、文档收口阶段通过 1,539 个文件；源码提交 stage 为 43 个文件，任务从严格起点累计 61 个路径，全部在 Task Packet 白名单。源码与 manifest-only stage 均按精确 Git blob 复核，`git diff --check` 通过。

完整官方 Node-source gate、6 文件 Browser 门、完整多 tsconfig、候选镜像/SBOM/新鲜漏洞扫描和 18 步真实候选门未运行，不得由上述定向验证外推为 release `ELIGIBLE`。

## 5. 资源、安全与清理

- 起点 available 约 2.2 GiB、Swap 425 MiB/1 GiB、根盘 31 GiB；收口约 2.0 GiB available、Swap 439 MiB/1 GiB、根盘 31 GiB，Load1 低于 4。
- 既有 Web/PostgreSQL healthy，Worker/Caddy running；四服务 restart 0、OOM false。重任务串行，临时 PostgreSQL 容器、测试数据库和临时目录已清零。
- 未读取 `.env`、凭据、业务行、当前 PostgreSQL 或四个受保护 Volume；未 build/pull/push 镜像，未执行 Compose 变更、UAT/生产 Migration、部署、账号/网络/系统变更或真实数据操作。
- 用户未跟踪 `docs/ERP_CURRENT_STATUS_REPORT.md` 保持不读、不改、不提交。

## 6. 后续门禁

TASK43 完成只消除源码层 PR-004。进入 UAT 前仍须固定候选提交/镜像、通过完整 release gate、获得专项 Migration/deploy 授权，并在隔离恢复锚点就绪后执行 0040→0043 升级与物料导入端到端验收。真实数据、员工试用和正式切换继续分别需要专项明确授权。
