# SELFHOST-UAT-PROMOTION-ROLLBACK-FIXED-EXECUTOR-81 UAT回退固定执行器与激活合同

> 状态：`DONE / FIXED ROLLBACK EXECUTOR BOUNDARY AND ACTIVATION V2 VERIFIED / UAT-CAPABLE HANDLERS ABSENT / REAL ROLLBACK NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-16（Asia/Shanghai）
> 严格代码起点：`main@3509a71848d682153c18e139617def56132e4890` / tree `c7d063db001978aea711c9bd29dc2338c72d9c6d`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库、四文件域、host安装/激活、Compose、UAT/生产回退和破坏性动作专项授权

## 1. 背景与目标

TASK80/D-155已建立内容寻址、root受信、无shell的rollback runtime gateway及有界containment，但正式路径仍依赖尚不存在且未激活的固定executor，因此机器审计继续以`BUNDLED_TRUSTED_GATEWAY_EXECUTOR_NOT_IMPLEMENTED_OR_ACTIVATED_FAIL_CLOSED`阻断。

本任务只在仓库与fake-root中实现可被gateway唯一调用的固定executor、版本化activation plan和安装/切换/恢复合同，把九个stage与十三个check映射到已审阅的固定工具和确定性输入输出。不得安装到真实host，不得连接数据库、读取Volume/备份或运行真实restore、Migration、Compose、postdeploy、rollback或业务写。

## 2. 验收标准

- [x] 固定executor只接受gateway传入的canonical request与descriptor manifest；协议、action、label、operation、deadline、plan/intent/source摘要、activation和tool identity任一不匹配均在外部动作前失败。
- [x] 九个rollback stage与十三个postverify check逐项映射固定绝对工具、固定argv模板、输入/输出schema、超时、权限、幂等键和unknown/partial处置；不存在任意shell、路径、环境变量或operator参数扩展点。
- [x] activation采用版本化content-addressed plan、短时一次性授权和PREPARED→COMMITTED回执；安装、升级、回退和崩溃恢复均无覆盖，旧/未知partial只保全并阻断gateway。
- [x] database、uploads、attachments、backup_status、Web/Worker、runtime configuration和postverify只使用已有受控工具的安全子集；TEST-only工具不得重标为UAT能力，缺失真实前置时正式preflight继续失败。
- [x] executor在每次动作前后复核打开描述符、固定binary/source、deployment/database/volume/container identity和保护对象；子进程超时、信号、daemon化、输出越界或身份漂移均收敛并留下去敏typed结果。
- [x] fake-root/断网测试覆盖固定catalog、activation安装/升级/回退/七个崩溃点、descriptor/path swap、重复调用、超时/信号、partial/unknown、containment、保护对象漂移和结果替换；launcher/installer/journal/audit/inventory适用回归通过。
- [x] 审计只在源码、bundle、activation与executor静态/fixture条件真实闭合时更新对应机器blocker；隔离动态演练、缺失UAT-capable handler及人工UAT继续保持阻断。
- [x] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动选择下一未阻塞任务。

## 3. 禁止事项

- 不安装或激活host executor，不连接UAT/生产数据库，不读取业务行、env、日志、Volume、备份或凭据正文，不运行真实restore、Migration、Compose、postdeploy、rollback或业务写。
- 不创建/修改账号、权限、systemd、网络、防火墙、Swap或Docker daemon；不停止、替换或删除当前容器，不触碰四个受保护持久卷。
- 不把executor源码、fake-root activation、静态SUPPORTED或gateway通过描述为真实UAT回退演练、executor已在host启用或可投产。

## 4. 起点与资源判定

- TASK80 source`dff6793`→manifest-only`3509a71`形成145文件bundle`b3ecdf11…ab7e5`；gateway、完整运行观察和最多三次追加式containment attempt receipt已闭合，但固定executor、真实activation、隔离演练和人工UAT仍缺失。
- 起点末次available约1.3GiB、Swap813MiB/1GiB、根盘约12GiB，内存与Swap余量很窄且本轮曾有受限ESLint V8 heap OOM。只允许仓库静态、受限Node/Python和fake-root轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + FIXED EXECUTOR DYNAMIC VALIDATION`。

## 5. 完成证据

- D-156固定九阶段/十三检查closed catalog、trusted-FD manifest v2及无shell固定executor边界。catalog明确声明`BLOCKED_MISSING_UAT_CAPABLE_HANDLERS`；executor完成全部输入/身份复核后稳定返回`ROLLBACK_FIXED_EXECUTOR_UAT_CAPABILITY_UNAVAILABLE`，没有把TEST-only restore或Compose工具重标为UAT能力，也没有产生外部动作。
- activation v2使用content-addressed intent/executor/plan/history/receipt/current/alias/recovery；install、upgrade、rollback和七个已知发布崩溃点均通过fresh authorization无覆盖收敛。正式prepare在能力缺失时先返回`BLOCKED_CAPABILITY_UNAVAILABLE`且不创建activation state。
- gateway改用trusted-FD manifest v2，Supervisor v7新增ACTIVATE/ROLLBACK/RECOVER三项精确bundle-bound授权；能力阻断发生在授权消费前。installer新增activation generation、plan/executor identity、history/receipt/current/alias/recovery全链联锁，partial或额外字段均阻断bundle切换。
- feature source`57f1f4aa78b80d7fd4d1bcbd16916340a29a65d4`/tree`ea4a53b08e68d84eed9386b57ac00d9777429e5f`→manifest-only`7a1ef5619c4fd5258f0e3acd40d0979c92217993`/tree`cf81fb7b8f22456f329a2feeae5a60ff8d7b6d37`形成149文件canonical bundle，manifest raw SHA-256为`bd8cf7c381f3581f649161980e163920e3a04054bebf81ff28a43fc21d903fc1`且生成器重放一致。
- 固定executor合同SHA-256为`fc2bdbcb…de97ca`，executor为`0cbdd508…574c03`，activation publisher为`0efff23a…80f74`；inventory为262/238/24，SHA-256`a5fa5cfd…c69b3`。跨岗/审计self-digest为`47eff0cc…78a8`/`6c3cdceb…29b5`，审计仍为`BLOCKED`且保留能力/host activation、隔离演练和人工UAT三项阻断。
- Node合同组合80/80、transaction journal71/71、Python installer/launcher/adapter56/56、manifest9/9及installer21/21通过；inventory、cross-role、audit生成物逐字节verify，Node syntax、Python AST、凭据扫描1770文件和diff门通过。
- 收口available约1.4GiB、Swap832/1024MiB、根盘约12GiB、Load`0.64/0.58/0.37`；四服务running/healthy、restart0/OOM false，宿主`oom_kill=2`无任务内增量。未运行build、数据库、Compose、Migration、backup/restore、镜像、部署、真实UAT或回退；没有任务临时容器或manifest临时文件残留，受保护Volume未触碰。
