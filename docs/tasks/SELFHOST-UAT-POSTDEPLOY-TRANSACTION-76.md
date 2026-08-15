# SELFHOST-UAT-POSTDEPLOY-TRANSACTION-76 UAT晋升postdeploy checkpoint 10/11事务化

> 状态：`DOING / POSTDEPLOY TRANSACTION INTEGRATION / RESOURCE STOP LINE ACTIVE / NO REAL DEPLOYMENT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@86be6d4b139e6626067a6a1782a3636d076f058a` / tree `006c230976d8dd985394b59a7b0965f90b2e1a51`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实容器、数据库、UAT/生产、凭据、host、账号及部署专项授权

## 1. 背景与目标

TASK75/D-150已完成checkpoint 9仓库适配器，并把checkpoint 8 active migration fence以内容寻址transfer交给精确Compose部署结果。机器审计把既有`postdeploy-runtime-configuration-probe`和`postdeploy-release-verifier`静态来源分别视为checkpoint 10/11 SUPPORTED，但promotion journal当前只能由Supervisor推进至checkpoint 9；两个独立工具的成功回执尚未绑定同一promotion、checkpoint 9 receipt、deployment result/fence transfer及逐检查点授权链。

本任务先把checkpoint 10 `POST_DEPLOY_RUNTIME_CONFIGURATION`与checkpoint 11 `POST_DEPLOY_IDENTITY`纳入同一promotion transaction和保全恢复，作为checkpoint 13 final receipt的必要前置。人工跨岗UAT、最终提交、rollback、真实Compose/PostgreSQL及动态TASK70均不在本任务执行范围。

## 2. 验收标准

- [ ] 完整核对现有postdeploy probe、严格四服务runtime验证、identity发布、checkpoint 9 result/transfer、active fence interlock及失败后containment责任，记录不可复用与需扩展边界。
- [ ] checkpoint 10和11各使用不同的短时一次性Supervisor授权；intent必须先于消费落盘，并精确绑定同一promotion、ordinal前代、checkpoint 9 receipt、deployment result/fence transfer、release manifest、Compose project/working directory、四服务身份、runtime policy及三方actor。
- [ ] checkpoint 10只接受新部署之后生成、未过期、root-owned、单硬链接、内容寻址的runtime configuration probe receipt；旧probe、predeploy runtime、路径名、operator声明或单次health不得形成回执。
- [ ] checkpoint 11只接受与checkpoint 10、manifest和checkpoint 9完全一致的postdeploy receipt及发布后runtime identity；identity必须复核Web/Worker digest、四服务runtime policy、Migration head、deployment、runtime configuration和不可变证据。
- [ ] 两个检查点均按history→receipt→current发布，保持既有snapshot/quiesce/migration/deployment binding与不同authorization SHA链；checkpoint 11完成后journal仍为IN_PROGRESS，不得越过未执行的人工cross-role checkpoint 12。
- [ ] 未消费、已消费未运行、probe/identity已落盘但journal未发布、source替换、过期、hardlink/symlink、跨promotion、跨deployment、runtime漂移及三个发布崩溃点均有确定恢复或quarantine；未知结果不得伪造成功。
- [ ] 失败路径继续保全checkpoint 9 deployment/result/transfer和事故证据，并调用精确、受测的containment边界；不得猜测回滚、删除容器、释放/改写数据库状态或覆盖postdeploy证据。
- [ ] fake-root/断网测试覆盖正向、重放、授权复用、所有绑定漂移、发布崩溃、恢复和quarantine；现有postdeploy、promotion、launcher、installer、audit及inventory适用回归通过。
- [ ] 机器审计继续`BLOCKED`，不得因checkpoint 10/11事务化而把人工UAT、final receipt或rollback标为完成；`assert-ready`仍拒绝。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和投产授权包，完成资源/敏感/diff检查并形成独立source→manifest提交链；随后自动选择下一未阻塞任务。

## 3. 禁止事项

- 不运行真实Docker/Compose、pull/build/recreate/start/stop，不连接数据库或读取/修改active fence，不访问env、日志、Volume、备份或业务数据。
- 不把现有静态审计`SUPPORTED`、checkpoint 9 fake result、旧postdeploy receipt或runtime identity单独当作promotion checkpoint 10/11 actual证据。
- 不实现或执行人工跨岗UAT、final receipt、rollback，不触碰账号、systemd、网络、防火墙、Swap、Docker daemon、UAT/生产或四个受保护Volume。

## 4. 起点与资源判定

- TASK75最终source`d383c10`→cap fix`c6c4864`→Supervisor manifest-only`86be6d4`形成132文件bundle`249d28fe…3071`；机器审计11项SUPPORTED、4项阻断（P0=3、P1=1），`assert-ready`继续拒绝。
- 当前UAT仍为alpha.42/0040；源码匹配Web/Worker镜像、actual checkpoint 8/9、postdeploy回执和真实恢复证据均不存在，本任务不得调用当前运行面。
- available约1.9GiB、Swap881MiB/1GiB、根盘约13GiB，Swap超过80%。只允许仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
