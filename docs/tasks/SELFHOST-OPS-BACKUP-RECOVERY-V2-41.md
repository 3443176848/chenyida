# SELFHOST-OPS-BACKUP-RECOVERY-V2-41 备份恢复契约 V2 与隔离故障测试

> 状态：`DOING / SYNTHETIC-ISOLATED ONLY / NO CURRENT VOLUME ACCESS`
> 日期：2026-08-12（Asia/Shanghai）
> 起点：`main@9156c9e5dea93bc1666b8c75d087a3950a3422e1`
> 责任：Codex 主智能体为唯一写者、测试执行者和提交者；项目负责人负责未来异机目标、真实快照、真实恢复和生产动作专项授权

## 1. 目标

落实投产基线 PR-001/PR-002 的首个安全阶段：在不读取当前 PostgreSQL 或四个受保护卷、不连接外部目标的前提下，把备份、校验、恢复和 Dashboard 状态升级为版本化 V2 契约，并通过合成文件、伪造故障和隔离 PostgreSQL 证明失败关闭与可清理性。

## 2. 严格起点

- 源码 alpha.44/0041，UAT alpha.42/0040；本任务不 build、部署或迁移 UAT。
- 既有`backup-selfhost.sh`只覆盖 PostgreSQL、uploads、attachments；数据库 URL 进入 argv；生产拒绝依赖环境/URL文本；服务静止只信任参数。
- 既有`restore-selfhost.sh`数据库恢复后依次移动两个目录，最终核验失败可能留下部分目标。
- Dashboard schema v1 的`VERIFIED`只表示三个本机 artifact 校验，不区分本地、异机、恢复或过期。
- 四个受保护卷及`/var/backups/chenyida-erp`只允许元数据保护检查，不读取正文、不用于本任务测试。
- 用户未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 3. 允许范围

- 修改自托管 backup/verify/restore 脚本及其独立合同 helper；
- 修改 Dashboard backup status 类型/解析和直接相关测试；
- 新增只使用临时目录、合成文件、假命令或一个串行隔离 PostgreSQL 的故障测试；
- 更新 backup/restore、operations runbook、项目状态文档和独立 Git 提交；
- 运行适用低资源测试、lint和静态安全检查。

## 4. 禁止范围

- 不读取当前 UAT 数据库业务行、uploads、attachments、backup-status 或真实备份正文；
- 不生成当前环境快照、不上传外部目标、不执行真实恢复；
- 不 build 镜像、不运行 Migration、不部署、不重启/停止现有服务；
- 不修改数据库 Schema/Migration、业务流程、账号、权限、网络、systemd、Swap、内核或 Docker daemon；
- 不删除容器、镜像、Volume、备份或业务文件，不执行 prune；
- 不把凭据、连接串、Token或密钥写入 Git、日志、manifest、receipt或聊天。

## 5. 验收标准

- [ ] V2 manifest绑定deployment identity、应用版本、Git SHA、镜像digest、精确Migration head/manifest和PostgreSQL、uploads、attachments、backup-status四类artifact。
- [ ] 数据库认证只通过权限受限的libpq service文件或等价安全机制，秘密不进入argv、stdout、manifest或receipt；未知/宽松权限目标失败关闭。
- [ ] 备份工具自行核验writer静止证据或采用经测试的一致性边界，不只信任`YES`参数。
- [ ] verifier严格拒绝缺失/额外artifact、摘要/大小漂移、过期、路径穿越、链接、Migration/revision/digest不匹配和不完整传输。
- [ ] receipt明确区分`LOCAL_VERIFIED`、`OFFHOST_VERIFIED`、`RESTORE_VERIFIED`；Dashboard对v2状态和RPO过期失败关闭，旧v1不冒充生产可恢复。
- [ ] restore仅允许明确TEST部署和`_restore_test`新空数据库/新空文件目标；所有artifact先staging，任一注入失败后数据库与文件目标回到空状态。
- [ ] 覆盖重复执行、第二阶段晋升/最终核验失败、凭据泄漏、危险路径和清理；测试不读取当前卷。
- [ ] 串行运行适用单元、脚本故障、隔离PostgreSQL、Python基线、lint、链接、敏感信息和`git diff --check`。
- [ ] 记录任务前后内存、Swap、磁盘、Load、OOM/restart和临时资源清理。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`并创建独立提交。

## 6. 明确排除的后续阶段

异机目标、RPO/RTO、加密接收方、root-only真实凭据、当前四卷快照、真实传输和真实隔离恢复仍需项目负责人专项授权。本任务通过只表示工具契约和隔离故障边界可进入下一阶段，不表示异机数据锚点已经建立或系统可投产。
