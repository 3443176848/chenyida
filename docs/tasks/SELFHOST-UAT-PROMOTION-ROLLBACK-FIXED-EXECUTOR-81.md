# SELFHOST-UAT-PROMOTION-ROLLBACK-FIXED-EXECUTOR-81 UAT回退固定执行器与激活合同

> 状态：`DOING / FIXED ROLLBACK EXECUTOR AND ACTIVATION CONTRACT / REPOSITORY AND FAKE-ROOT ONLY / REAL ROLLBACK NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@3509a71848d682153c18e139617def56132e4890` / tree `c7d063db001978aea711c9bd29dc2338c72d9c6d`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库、四文件域、host安装/激活、Compose、UAT/生产回退和破坏性动作专项授权

## 1. 背景与目标

TASK80/D-155已建立内容寻址、root受信、无shell的rollback runtime gateway及有界containment，但正式路径仍依赖尚不存在且未激活的固定executor，因此机器审计继续以`BUNDLED_TRUSTED_GATEWAY_EXECUTOR_NOT_IMPLEMENTED_OR_ACTIVATED_FAIL_CLOSED`阻断。

本任务只在仓库与fake-root中实现可被gateway唯一调用的固定executor、版本化activation plan和安装/切换/恢复合同，把九个stage与十三个check映射到已审阅的固定工具和确定性输入输出。不得安装到真实host，不得连接数据库、读取Volume/备份或运行真实restore、Migration、Compose、postdeploy、rollback或业务写。

## 2. 验收标准

- [ ] 固定executor只接受gateway传入的canonical request与descriptor manifest；协议、action、label、operation、deadline、plan/intent/source摘要、activation和tool identity任一不匹配均在外部动作前失败。
- [ ] 九个rollback stage与十三个postverify check逐项映射固定绝对工具、固定argv模板、输入/输出schema、超时、权限、幂等键和unknown/partial处置；不存在任意shell、路径、环境变量或operator参数扩展点。
- [ ] activation采用版本化content-addressed plan、短时一次性授权和PREPARED→COMMITTED回执；安装、升级、回退和崩溃恢复均无覆盖，旧/未知partial只保全并阻断gateway。
- [ ] database、uploads、attachments、backup_status、Web/Worker、runtime configuration和postverify只使用已有受控工具的安全子集；TEST-only工具不得重标为UAT能力，缺失真实前置时正式preflight继续失败。
- [ ] executor在每次动作前后复核打开描述符、固定binary/source、deployment/database/volume/container identity和保护对象；子进程超时、信号、daemon化、输出越界或身份漂移均收敛并留下去敏typed结果。
- [ ] fake-root/断网测试覆盖每个stage/check、activation替换/回退/恢复、descriptor/path swap、重复调用、超时/信号、partial/unknown、containment、保护对象漂移和结果替换；launcher/installer/journal/audit/inventory适用回归通过。
- [ ] 审计只在源码、bundle、activation与executor静态/fixture条件真实闭合时移除对应机器blocker；隔离动态演练与人工UAT仍必须保持阻断。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动选择下一未阻塞任务。

## 3. 禁止事项

- 不安装或激活host executor，不连接UAT/生产数据库，不读取业务行、env、日志、Volume、备份或凭据正文，不运行真实restore、Migration、Compose、postdeploy、rollback或业务写。
- 不创建/修改账号、权限、systemd、网络、防火墙、Swap或Docker daemon；不停止、替换或删除当前容器，不触碰四个受保护持久卷。
- 不把executor源码、fake-root activation、静态SUPPORTED或gateway通过描述为真实UAT回退演练、executor已在host启用或可投产。

## 4. 起点与资源判定

- TASK80 source`dff6793`→manifest-only`3509a71`形成145文件bundle`b3ecdf11…ab7e5`；gateway、完整运行观察和最多三次追加式containment attempt receipt已闭合，但固定executor、真实activation、隔离演练和人工UAT仍缺失。
- 起点末次available约1.3GiB、Swap813MiB/1GiB、根盘约12GiB，内存与Swap余量很窄且本轮曾有受限ESLint V8 heap OOM。只允许仓库静态、受限Node/Python和fake-root轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + FIXED EXECUTOR DYNAMIC VALIDATION`。
