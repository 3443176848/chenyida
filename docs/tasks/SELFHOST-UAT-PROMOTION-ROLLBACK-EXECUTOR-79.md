# SELFHOST-UAT-PROMOTION-ROLLBACK-EXECUTOR-79 UAT晋升checkpoint 14/15精确前代回退

> 状态：`DOING / ROLLBACK CHECKPOINT 14/15 EXECUTOR / ACTUAL ROLLBACK NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@1baa01a829e9475f21ed01493d4bbbde2a318955` / tree `e3e6b435703fcdc16466444b6cbb91fe1c840698`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实快照、数据库、凭据、host、Compose、UAT/生产回退和破坏性动作专项授权

## 1. 背景与目标

TASK78/D-153已让checkpoint 13以完整checkpoint 4—12链和独立授权形成`COMMITTED`晋升终态，但审计仍缺checkpoint 14 `ROLLBACK_TO_UAT_EXECUTOR`与checkpoint 15 `ROLLBACK_POSTVERIFY_AND_FINAL_RECEIPT`。现有恢复工具明确只允许标记的可丢弃TEST目标，不能被文档或root手工命令冒充为UAT回退能力。

本任务只在仓库、fake-root和可注入无副作用adapter中建立精确前代回退事务、独立授权、分阶段执行结果、回退后严格核验、终态回执、恢复和失败关闭联锁。不得执行真实数据库/文件域恢复、Compose替换、UAT/生产回退或删除任何数据。

## 2. 验收标准

- [ ] 完整核对checkpoint 13、升级前四域可恢复快照、前代Web/Worker镜像与运行配置、Migration结果/数据库围栏、postdeploy identity和现有TEST-only restore边界，固定可回退对象与不得自动处理的业务冲销边界。
- [ ] `ROLLBACK_UAT_RELEASE`使用独立短时一次性授权；rollback intent和精确计划必须先于授权消费持久化，绑定同promotion/generation、checkpoint 13、目标前代、四域快照、镜像、Compose、数据库和三方actor。
- [ ] checkpoint 14只从Supervisor派生参数调用受控adapter；数据库及uploads/attachments/backup_status恢复、前代Web/Worker恢复和运行配置恢复均须产生内容寻址分阶段结果，未知或partial不得猜测重跑、删除证据或发布成功。
- [ ] 明确已过账业务事实与环境级快照恢复边界；不以直接删表、改账或down SQL代替精确快照恢复，不自动执行未授权业务冲销。
- [ ] checkpoint 15在精确rollback result后重新验证数据库/四文件域摘要、Migration head、四服务身份、runtime configuration、strict identity、health及保护对象，发布`ROLLED_BACK`终态回执；不得复用晋升finalization授权或旧postdeploy回执。
- [ ] history→receipt→current无覆盖发布、所有外部动作前后binding复核、崩溃点恢复、全局pending-intent和bundle-switch联锁闭合；已完成只接受精确同一rollback结果，冲突只保全/quarantine。
- [ ] fake-root/断网测试覆盖正向合成结果、授权复用、目标代际/快照/镜像/数据库/服务漂移、外部失败、partial发布、恢复和quarantine；audit/launcher/installer/inventory适用回归通过。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动进入下一安全任务。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、env、日志、Volume、备份或凭据正文，不运行真实restore、Migration、Compose、postdeploy、rollback或业务写。
- 不创建/修改账号、权限、systemd、网络、防火墙、Swap或Docker daemon；不停止、替换或删除当前容器，不触碰四个受保护持久卷。
- 不把fake-root结果、TEST-only恢复器、静态SUPPORTED或checkpoint 13仓库回执描述为真实UAT可恢复、真实回滚已通过或可投产。

## 4. 起点与资源判定

- TASK78 source`c39caad`→manifest-only`1baa01a`形成138文件bundle`7dd7a83c…591c3`；checkpoint 13仓库事务闭合，机器审计为13项SUPPORTED、2项P0阻断，实际人工UAT和回滚均未执行。
- available约1.8GiB、Swap858MiB/1GiB、根盘约13GiB，Swap超过80%。只允许运行仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
