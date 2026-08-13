# SELFHOST-EXTERNAL-AUTHORIZATION-READINESS-52 外部资源与专项授权执行包

> 状态：`DONE / AUTHORIZATION CONTROL PLANE COMPLETE / REPOSITORY PREREQUISITES OPEN / NO HOST MUTATION / NO UAT OR PRODUCTION ACTION / PRODUCTION NO-GO`
> 日期：2026-08-13（Asia/Shanghai）
> 严格起点：`main@cbc219490fd88eda4edb6f0e54ad0ba933438ab4` / tree `216e08ee176406d5df01c6976f74c826a6cab5de`
> 责任：Codex 主智能体为唯一写者、事实复核者和 Git 提交者；数据迁移、应用测试、运维安全智能体只读审计；项目负责人对未来每一项 host、外部目标、UAT、真实数据、账号、员工试用和切换动作分别专项授权

## 1. 目标

把当前投产阻断从笼统的“需要授权”转换为按依赖排序、逐项最小、可独立批准或拒绝、可验证和可回滚的执行包。执行包必须让项目负责人无需提供任何密码、Token、私钥或业务数据即可明确判断每项授权的影响。

本任务只核对现有仓库合同和宿主只读 metadata，并编制控制面文档。它不是 host supervisor 安装、正式发布门、外部镜像 push、真实备份/恢复、告警投递、UAT Migration/deploy、账号变化、员工试用或正式切换授权。

## 2. 起点事实

- TASK51 当前候选精确绑定`8084d6c3e38e4246b79791414e84bfe2da4ea8f8`/tree`a54473f6b05cdfaa014f286149a740b90d5067fe`；Web/Worker manifest 为`sha256:249d0ce4…5b7f`/`sha256:0e07fded…8370`，仅在本机 engine 可解析。
- canonical supervisor bundle SHA-256 为`f4481316abb5e3c69e5fd8cb92891f9a2880a2f2375e2611cda3628cf84f5ce6`，source/manifest 两提交关系和 TASK51 运行合同已验证。
- installer SHA-256 为`f7ace18453016f6ea09d2a3060016c7c16a4f2366583315dba1c147cee6a8ba0`，launcher SHA-256 为`3e72a81dc02226792a1d3681ef475d18267ffb3582d41d93d4d4d301b306c4e0`。
- `/usr/local/libexec/chenyida-erp-release-supervisor`、`/usr/local/sbin/chenyida-erp-release-supervisor-v1`及 install authorization/receipt/journal、release authorization 根均不存在；正式镜像证据和19步门因此失败关闭。
- UAT 仍为 alpha.42/0040 和旧可写 rootfs 配置；当前四个持久卷、账号、网络和业务数据均不在本任务范围。

## 3. 允许范围

- 只读核验 Git commit/tree、bundle/installer/launcher 摘要、现有脚本合同、宿主路径是否存在、Docker name/image/status/health/restart/OOM 及资源状态；
- 由三条智能体线分别审计数据恢复、应用验收、运维安全的授权依赖，主智能体复核并保持唯一写者；
- 在`docs/`内编制不含秘密的生产授权执行包、依赖图、影响/停止/验收/回滚矩阵、root-only 凭据文件约定和最小授权请求文本；
- 运行不写生产数据的文档链接、JSON/Markdown、凭据、差异和资源检查；
- 更新项目治理文档并创建独立 Git 提交。

## 4. 禁止范围

- 不创建真实或可消费的一次性授权文件，不生成 nonce，不读取或复制任何现有凭据、`.env`、容器环境、日志、卷/备份正文或业务数据；
- 不写入`/usr/local`、`/var/lib/chenyida-erp`、`/etc`或真实 backup root，不安装 supervisor/monitor/timer，不修改 systemd、账号、权限、网络、防火墙、Swap、内核或 Docker daemon；
- 不 push 外部 registry/Git，不上传真实数据，不运行正式发布门、真实备份/恢复、UAT/生产 Migration/deploy、业务 API、登录式验收或员工试用；
- 不停止、重建或重启现行 UAT，不清理镜像/cache/Volume/备份；四个受保护 Volume 继续禁止删除；
- 用户既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`继续不读、不改、不提交。

## 5. 拟固定的授权梯级

执行包至少把以下动作拆成独立授权，禁止用一次“全部同意”自动跨越后续边界：

1. `A1 HOST_SUPERVISOR_INSTALL`：安装精确 content-addressed bundle；只建立受控入口，不运行正式门、不改 UAT。
2. `A3 EXTERNAL_IMAGE_AND_SOURCE_ANCHOR`：把精确候选和完整私有源码历史锚定到批准的异机目标；不包含业务数据。正式证据必须随后绑定该外部完整digest引用。
3. `A2 FORMAL_LOCAL_RELEASE_EVIDENCE`：在首次晋升gate自锁修复、A1和A3完成后，以一次性 root-only 授权生成正式镜像证据、运行19步门并创建或拒绝 manifest；不部署。
4. `A4a`—`A4e`：把三故障域设计、本机四域备份、加密异机接收、第三域恢复、部署后同身份重验/常态调度分别授权。
5. `A5a`—`A5b`：先建立monitor/timer/notifier并在旧UAT验证真实投递，再于A6/A4e后绑定新runtime/backup身份取得绿色窗口。
6. `A6 UAT_CANDIDATE_PROMOTION`：在升级前可恢复快照和告警能力前提下执行精确 Migration、Web/Worker部署、runtime identity、技术验收和回滚演练；跨岗业务写另行授权。
7. `A7a`—`A7f`：当前源只读盘点、业务处置、真实试迁移、岗位矩阵批准、跨岗UAT写、员工试运行分别授权。
8. `A8 PRODUCTION_CUTOVER`：正式停写、迁移、切换、观察和必要回滚；只有全部前置证据通过后另行专项授权。

## 6. 验收标准

- [x] 三条智能体线完成只读审计，主智能体逐项复核实际仓库和宿主 metadata，不把历史文档当作现场事实。
- [x] 产出单一权威执行包；每项授权有唯一编号、前置依赖、精确影响、明确排除、执行人/观察人、root-only 输入约定、资源停止线、验收证据、失败处置和回滚边界。
- [x] `A1`精确绑定未来重新生成的 source/manifest commit/tree、bundle/installer/launcher SHA、安装路径、会创建的 root-owned 路径、journal/receipt、重试与回退语义；不在 Git 中放入可消费授权或 nonce。TASK51旧摘要只作为审计快照，不得签发。
- [x] `A2`—`A8`明确区分“授权准备”“执行成功”和“后续动作仍未授权”，不得因上游一步通过自动启动下游。
- [x] 对真实数据、外传、账号、UAT/生产、host 配置和正式切换分别给出最小项目负责人确认句；秘密只引用 root-only 文件路径，禁止要求粘贴聊天。
- [x] 列出仍可在仓库内安全推进的缺口，并把首次晋升gate生命周期修复固定为下一项；当前无需向项目负责人索取注定失败的授权。
- [x] 文档链接、凭据、Markdown/JSON、`git diff --check`和资源/UAT只读不变检查通过；没有运行重型测试或触碰受保护数据。
- [x] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，创建独立 Git 提交。

## 7. 当前结论

TASK52已完成授权控制面并释放active slot。当前系统继续`PRODUCTION NO-GO`；完成只消除授权范围和执行责任歧义，不会自行跨越任何专项授权边界。下一项为`SELFHOST-RELEASE-GATE-LIFECYCLE-53`，先修仓库内首次晋升自锁。

## 8. 三线审计与主智能体复核发现

- 应用测试线核对当前机器清单为236/212/24、Pure Node113、PostgreSQL83、Browser6和19个REQUIRED步骤；部分当前手册仍写112/18步。历史任务快照不改写，当前运行文档已对齐机器JSON。
- 运维安全线发现正式gate在所有步骤前要求现行Worker `healthy`，但alpha.42 UAT实际health为`none`，会以`GATE_REQUIRED_RUNTIME_UNHEALTHY`阻断整个门；主智能体逐行复核runner确认属实。A2之前必须先做仓库任务，使legacy运行面只需保持不退化，而新候选health继续由隔离runtime步骤强制。
- 正式image evidence和release manifest绑定完整registry digest引用；TASK51 loopback registry已删除，本机引用不可异机恢复。A3必须先于正式A2，或A3后全部重签；不能把loopback manifest用于A6。
- A1 installer在读取授权前要求install authorization根和`pending`目录已是root:root `0700`；因此A1明确包含最小root bootstrap，但installer仍负责其余bundle/launcher/receipt/journal状态。
- 数据迁移线确认四域V2只证明合成/隔离恢复，真实A4需五个独立检查点；logical dump不含cluster roles/ACL/tablespace。旧数据物化工具又固定0017基线，尚无0017→0045连续升级、重复执行、失败回滚和升级后全量核对证据。
- 应用权限线确认11个固定角色由服务端授权，但岗位负责人未批准矩阵；admin/manager/finance/operations/warehouse当前可读AR+AP，sales只读AR，purchase只读AP，其余普通财务列表为空但engineering有本人项目财务摘要。A7必须拆到岗位批准、跨岗UAT写和员工试运行。
- TASK49没有host installer/unit/timer或真实notifier/ack；A5须先做仓库交付包，再分A5a旧UAT投递能力与A5b新身份绿色窗口。A6后旧备份身份会失配，必须再做A4e。

## 9. 最终验证与保护证据

- 三条智能体线全部完成只读审计；主智能体复核`release-gate-runner.mjs`、镜像/manifest完整引用、supervisor installer、四域V2、迁移工具、监控交付边界、11角色与财务可见域后归并到D-129和执行包。
- 389个已跟踪/本任务新增Markdown文件中的222个本地链接通过；211个已跟踪JSON全部可解析；`git diff --check`通过。
- 凭据检查使用现行Web镜像内Node、断网/只读/无capability容器及显式`COMMITTED_TREE`清单扫描1,591个文件；未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`被明确排除且未读取，结果`CREDENTIAL_CHECK_OK`。
- 文档-only范围经`git diff --name-only`复核；未运行Docker build、全量测试、Migration、备份或恢复。UAT四服务保持原image/status，restart均0、OOM false；Web/PostgreSQL healthy，旧Worker/Caddy health仍为none；四个受保护Volume名称集合不变。
- 收口前资源为available memory约2.0 GiB、Swap约724 MiB/1 GiB、根盘可用16 GiB、Load低于1，内核`oom_kill=0`；TASK52唯一临时凭据扫描容器及`/tmp/task52-credential-scan.*`清单已精确清理，无任务临时资源遗留。

## 10. 完成结论

`DONE / AUTHORIZATION CONTROL PLANE COMPLETE / REPOSITORY PREREQUISITES OPEN / PRODUCTION NO-GO`。权威执行包是[投产专项授权执行包](../self-hosting/production-authorization-packet.md)。当前不需要项目负责人立即授权：A1必须等待TASK53后新的内容寻址bundle，A2还需A1和A3；真实数据、外传、host、UAT、账号、员工试用和切换仍逐项专项授权。
