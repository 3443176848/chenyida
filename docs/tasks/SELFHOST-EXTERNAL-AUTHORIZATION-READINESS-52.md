# SELFHOST-EXTERNAL-AUTHORIZATION-READINESS-52 外部资源与专项授权执行包

> 状态：`DOING / READ-ONLY CONTROL PLANE / NO HOST MUTATION / NO UAT OR PRODUCTION ACTION / PRODUCTION NO-GO`
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
2. `A2 FORMAL_LOCAL_RELEASE_EVIDENCE`：以一次性 root-only 授权为当前候选生成正式镜像证据、运行19步门并创建或拒绝 manifest；不部署。
3. `A3 EXTERNAL_IMAGE_AND_SOURCE_ANCHOR`：把精确候选和完整私有源码历史锚定到批准的异机目标；不包含业务数据。
4. `A4 ACTUAL_OFFHOST_BACKUP_RESTORE`：对批准的数据源建立四域异机备份并在第三故障域隔离恢复；需要目标、加密、RPO/RTO、保留、责任人和真实数据专项授权。
5. `A5 HOST_MONITORING_DELIVERY`：安装监控、配置真实通知渠道与值班升级责任；与应用发布分离。
6. `A6 UAT_CANDIDATE_PROMOTION`：在可恢复快照前提下执行精确 Migration、Web/Worker部署、runtime identity、只读/登录式验收和回滚演练；每个写阶段继续受检查点约束。
7. `A7 DATA_ROLE_PILOT`：旧数据试迁移/核对、岗位权限批准、受控员工试运行及问题处置；真实数据、账号和员工业务写分别授权。
8. `A8 PRODUCTION_CUTOVER`：正式停写、迁移、切换、观察和必要回滚；只有全部前置证据通过后另行专项授权。

## 6. 验收标准

- [ ] 三条智能体线完成只读审计，主智能体逐项复核实际仓库和宿主 metadata，不把历史文档当作现场事实。
- [ ] 产出单一权威执行包；每项授权有唯一编号、前置依赖、精确影响、明确排除、执行人/观察人、root-only 输入约定、资源停止线、验收证据、失败处置和回滚边界。
- [ ] `A1`精确绑定 source/manifest commit/tree、bundle/installer/launcher SHA、安装路径、会创建的 root-owned 路径、journal/receipt、重试与回退语义；不在 Git 中放入可消费授权或 nonce。
- [ ] `A2`—`A8`明确区分“授权准备”“执行成功”和“后续动作仍未授权”，不得因上游一步通过自动启动下游。
- [ ] 对真实数据、外传、账号、UAT/生产、host 配置和正式切换分别给出最小项目负责人确认句；秘密只引用 root-only 文件路径，禁止要求粘贴聊天。
- [ ] 列出仍可在仓库内安全推进的缺口；若没有，则记录最小首个授权问题和未授权时可继续保持的安全状态。
- [ ] 文档链接、凭据、Markdown/JSON、`git diff --check`和资源/UAT只读不变检查通过；不运行重型测试或触碰受保护数据。
- [ ] 同步`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`和`PRODUCTION_READINESS.md`，创建独立 Git 提交。

## 7. 当前结论

TASK52 已启动且是唯一`DOING`。当前系统继续`PRODUCTION NO-GO`；本任务只消除授权范围和执行责任歧义，不会自行跨越任何专项授权边界。
