# SELFHOST-UAT-PROMOTION-ROLLBACK-CAPABILITY-HANDLERS-82 UAT回退能力处理器与物化边界

> 状态：`DOING / UAT-CAPABLE ROLLBACK HANDLERS / REPOSITORY AND FAKE-ROOT ONLY / HOST ACTIVATION AND REAL ROLLBACK NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-16（Asia/Shanghai）
> 严格代码起点：`main@7a1ef5619c4fd5258f0e3acd40d0979c92217993` / tree `cf81fb7b8f22456f329a2feeae5a60ff8d7b6d37`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库、四文件域、host安装/激活、Compose、UAT/生产回退和破坏性动作专项授权

## 1. 背景与目标

TASK81/D-156已建立固定executor、activation v2、Supervisor v7及bundle切换联锁，但catalog诚实声明数据库、四文件域、前代Web/Worker和postverify所需的UAT-capable handler尚不存在，正式prepare在授权消费前失败。

本任务只在仓库、fake-root和断网fixture中实现每个能力的专用处理器协议、不可变输入物化与结果校验，让固定executor可在全部UAT前置真实存在时封闭分派；不得安装host、连接数据库、读取真实Volume/备份、运行真实restore/Migration/Compose/postdeploy/rollback或业务写。

## 2. 验收标准

- [ ] 为writer containment、PostgreSQL staging restore/switch、uploads/attachments/backup_status新目标恢复、runtime configuration、前代Web/Worker激活及十三项postverify建立逐项专用handler；handler只接受固定FD、固定schema和固定argv，不接受shell、环境扩展或operator路径。
- [ ] PostgreSQL和四文件域只能物化到与active/candidate均不相交的新身份；任何rename/switch前必须绑定签名snapshot、promotion前代、容量、cluster/volume marker、source/target位置和保护对象，TEST-only目标仍不可用于UAT。
- [ ] 前代Web/Worker只接受execution package绑定的完整registry digest和已验证本机content identity；禁止pull、build、latest、任意tag或替换Caddy/PostgreSQL/网络/受保护Volume。
- [ ] handler采用PREPARE/EXECUTE/PROBE/CONTAIN分离协议和逐动作幂等键；intent-only、partial、timeout、signal、daemon、输出越界、source/path/identity漂移只保全、隔离并返回typed UNKNOWN，不自动重跑破坏性阶段。
- [ ] 固定executor在全部能力声明与内容摘要闭合后才把catalog从BLOCKED提升为SUPPORTED；activation publisher、gateway、Supervisor和审计不得以源码存在替代host激活或动态演练。
- [ ] fake-root/断网测试覆盖22项handler、目标冲突、空间/身份漂移、重复调用、每个发布崩溃点、结果替换、containment及保护对象；installer/launcher/journal/audit/inventory适用回归通过。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动选择下一未阻塞任务。

## 3. 禁止事项

- 不安装或激活host handler/executor，不连接UAT/生产数据库，不读取业务行、env、日志、Volume、备份或凭据正文，不运行真实restore、Migration、Compose、postdeploy、rollback或业务写。
- 不创建/修改账号、权限、systemd、网络、防火墙、Swap或Docker daemon；不停止、替换或删除当前容器，不触碰四个受保护持久卷。
- 不把fake-root handler、静态SUPPORTED或合成结果描述为真实UAT回退演练、host已激活或可投产。

## 4. 起点与资源判定

- TASK81 source`57f1f4a`→manifest-only`7a1ef56`形成149文件bundle`bd8cf7c3…3fc1`；固定executor/activation事务边界闭合，但catalog因UAT-capable handler缺失而稳定阻断，隔离动态演练和人工UAT也未完成。
- available约1.4GiB、Swap832MiB/1GiB、根盘约12GiB，Swap仍超过80%。只允许仓库静态、受限Node/Python和fake-root轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + CAPABILITY HANDLER DYNAMIC VALIDATION`。
