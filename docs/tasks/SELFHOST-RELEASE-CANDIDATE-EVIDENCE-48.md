# SELFHOST-RELEASE-CANDIDATE-EVIDENCE-48 隔离候选镜像与安全证据闭环

> 状态：`DOING / ISOLATED CANDIDATE EVIDENCE / NO DEPLOYMENT / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@d554a150a2f9cb4b672dc49785ed63bf3e0edfc8`
> 责任：Codex 主智能体为唯一写者、重任务调度者、证据集成者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人负责未来 host supervisor 安装、UAT/生产 Migration/deploy、真实数据、账号权限、员工试用和正式切换专项授权

## 1. 目标

关闭 D-116/PR-003/PR-005 中尚可在隔离环境安全推进的候选证据缺口：从一个精确已提交 Git commit/tree 串行构建 Web 与 Worker，固定 OCI 与 baked runtime 身份，取得可供严格合同消费的 registry digest 引用，使用固定 Trivy 0.70.0 与不超过 72 小时的漏洞数据库生成两镜像 CycloneDX SBOM 和零已知漏洞证据，并在不绕过 root supervisor 的前提下尝试同候选 18 步发布门。

项目负责人本轮明确授权“隔离环境中的测试、构建和迁移演练”。因此本任务允许本机隔离候选 build、只从公共源下载固定工具/漏洞数据库及使用临时 loopback registry；不允许向外部 registry 推送候选、不部署或重启 UAT/生产、不访问真实业务数据或受保护四卷。host supervisor 的持久安装仍属于宿主高权限发布能力启用，未获专项授权时不得执行或用环境变量旁路。

## 2. 已核验起点

- Git：唯一 worktree，`main@d554a150a2f9cb4b672dc49785ed63bf3e0edfc8`，相对 `origin/main` 为 behind 0/ahead 268；唯一既有未跟踪文件为 `docs/ERP_CURRENT_STATUS_REPORT.md`，继续不读、不改、不提交。
- 源码：`0.1.0-alpha.46`、45/head `0045_runtime_worker_readiness.sql`，0045 SHA-256 为 `cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`。
- UAT：只读事务确认 40/head `0040_warehouse_receipt_readiness.sql`、227 张 public 表；运行 Web image ID 仍为 `sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。本任务不得使其变化。
- 发布工具：18 步计划、镜像证据 producer、严格 manifest 及 content-addressed supervisor bundle 已存在；固定 Node 工具镜像在本机，固定 Trivy 镜像和新鲜数据库尚不存在。host supervisor 未安装，相关 launcher/bundle/authorization 路径均不存在。
- 资源：available memory 约 2.4 GiB，Swap 744 MiB/1.0 GiB（约 72.7%），根分区可用 27 GiB，Load `0.05/0.49/0.88`，内核 `oom_kill=0`；四服务 restart 0/OOM false，BuildKit cache 0B。

## 3. 验收标准

- [ ] 候选构建只使用精确已提交、tracked-clean 的 Git commit/tree；Web 与 Worker 均从该身份构建，版本为 `0.1.0-alpha.46`，OCI version/revision 与 baked runtime env 精确一致且两镜像 config digest 不同。
- [ ] 构建、临时 loopback registry、工具拉取、漏洞数据库准备、扫描和全门测试严格串行；任一时刻最多一个本任务临时容器，绝不挂载 UAT/生产数据库或四个受保护 Volume。
- [ ] 候选只推送到任务专用 loopback registry 以取得 registry digest，随后按 digest 回拉并核验；不得登录或推送任何外部 registry，不得创建 `latest` 或模糊候选 tag。
- [ ] 固定 Trivy 0.70.0 镜像的完整 digest/config/platform/binary身份；漏洞数据库 metadata 与 payload tree digest 在扫描前后相同且数据库年龄不超过 72 小时。
- [ ] Web/Worker 分别生成镜像级 CycloneDX SBOM 和漏洞报告；`CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN` 任一发现均拒绝候选，不使用 ignore、severity 降级、过期数据库或 lockfile 清单冒充 PASS。
- [ ] 证据文件位于仓库外任务专用 root-owned 目录，采用无覆盖、只读、单硬链接合同；不提交大制品、扫描数据库、镜像、日志、凭据或潜在敏感输出。
- [ ] 仅通过 D-116 的 installed content-addressed supervisor 与一次性授权执行正式镜像证据/18 步门；若 host supervisor 仍未获授权，则证明失败关闭并不得直接设置 supervisor 环境变量或把等价脚本运行写成正式 PASS。
- [ ] 官方门对现行`chenyida-erp-parallel`四服务只允许读取Docker容器名称、状态、restart、OOM和health元数据并核对前后一致；不得连接容器网络/API/数据库、读取日志或卷正文，也不得启动、停止、重建或修改服务。若运行面元数据发生变化，候选门失败关闭。
- [ ] 在可安全执行范围内完成全部仓库/隔离验证；任何测试失败须修复或诚实拒绝候选，不降低断言、不跳过 REQUIRED 步骤。
- [ ] 每项重任务前后记录 memory、Swap、disk、Load、OOM/restart与临时资源；Swap 超过 80%等停止线触发时立即暂停新重任务。
- [ ] 更新`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md`、`PROJECT_CONTEXT.md`、`PRODUCTION_READINESS.md`及相关发布/运维文档，并形成独立聚焦提交。

## 4. 执行阶段

1. 只读审计候选构建、registry digest、Trivy DB、证据 producer、supervisor 与 18 步门的实际前置和清理路径。
2. 对发现的仓库合同缺口做最小修复并运行轻量/定向测试；形成精确候选源码提交。
3. 串行构建 Web、Worker，建立仅 loopback 可达的临时 registry digest 身份并清理 registry。
4. 拉取/核验固定 Trivy，生成新鲜数据库与两镜像 SBOM/漏洞结果；零发现才继续。
5. 在不越过 host supervisor 授权边界下尝试正式镜像证据与 18 步门；若外部授权阻塞，则冻结已完成证据、记录最小解除条件并转入其他安全任务。
6. 复核运行面未变、资源/临时资源、凭据/范围/`git diff --check`，更新治理资料并独立提交。

## 5. 禁止范围

- 除官方发布门所需的四服务Docker状态/restart/OOM/health元数据只读基线外，不连接、读取或修改 UAT/生产运行面；不访问业务API/数据库/日志，不运行 UAT/生产 Migration，不挂载或读取 `chenyida-erp-parallel_erp_postgres`、`chenyida-erp-parallel_erp_uploads`、`chenyida-erp-parallel_erp_attachments`、`chenyida-erp-parallel_erp_backup_status` 正文。
- 不向 GHCR 或其他外部 registry 推送候选，不发布 runtime identity，不创建 `ELIGIBLE` production release，不部署、重启或替换当前服务。
- 不安装 host supervisor，不创建长期 host authorization，不修改 systemd、Swap、网络、防火墙、内核或 Docker daemon；除非项目负责人另行给出专项明确授权。
- 不 prune，不删除既有镜像、备份、数据库、Volume 或用户文件；只清理本任务精确名称/路径的临时资源。
- 不读取、修改或提交 `docs/ERP_CURRENT_STATUS_REPORT.md`、`.env`、凭据文件、备份正文或 `shujvbiao/`。

## 6. 失败关闭与后续边界

本任务即使生成本地候选镜像和零漏洞证据，也不等于 UAT 或生产候选已晋升。只有正式 18 步同候选报告、不可变 release manifest、UAT 对齐与后续验收全部完成后，PR-003/PR-005 才能解除。host supervisor 安装、UAT Migration/deploy、真实异机恢复、岗位矩阵、真实迁移、员工试用和正式切换继续分别需要外部资源、业务批准或专项授权。
