# SELFHOST-UAT-PROMOTION-ROLLBACK-RUNTIME-ADAPTER-80 受信UAT回退运行时适配器

> 状态：`DOING / TRUSTED ROLLBACK RUNTIME ADAPTER / REPOSITORY AND FAKE-ROOT ONLY / REAL ROLLBACK NOT AUTHORIZED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@cd9c9dee3bcf6aa859f177c699b754a129e2c54f` / tree `e6f035b180ab4be8f1613268b3f5e745ced05cac`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实数据库、四文件域、host、Compose、UAT/生产回退和破坏性动作专项授权

## 1. 背景与目标

TASK79/D-154已闭合checkpoint 14/15控制平面，但生产入口刻意依赖不存在的`uat-promotion-rollback-runtime-adapter.py`，因此会在授权消费前失败。当前最高机器P0是把九个回退阶段和十三个postverify检查映射到受信、最小权限、无shell、内容寻址且可恢复的runtime adapter，同时保持真实环境动作未授权、未演练时绝不宣称READY。

本任务先核对现有cluster recovery、四域restore、Compose deployment、postdeploy probe与identity工具的真实边界；只实现仓库/fake-root可验证的受信适配器、固定命令协议和失败关闭门。不运行真实数据库/文件域恢复、Compose替换、UAT回退或数据删除。

## 2. 验收标准

- [ ] 逐项核对九个rollback stage、十三个postverify check及所有现有恢复/部署/probe工具，记录可复用边界、权限、输入、输出、幂等性和unknown/partial处置；TEST-only能力不得被重标为UAT能力。
- [ ] runtime adapter只接受Supervisor生成的canonical execution package、stage/check intent与精确摘要，固定绝对binary/argv、净化环境、超时/process-group和输出上限；禁止shell、任意命令、任意路径或operator自由参数。
- [ ] preflight在授权消费前验证root、installed bundle/source、固定工具、UAT deployment identity、staging目标和所有保护对象；任何依赖缺失或策略未获批准均失败且不产生外部动作。
- [ ] 每个外部阶段支持显式PREPARE/EXECUTE/CONTAIN/PROBE协议；未知或partial只允许保全、隔离和只读探测，不得自动重跑restore、rename、volume switch或Compose替换。
- [ ] 数据库只允许经审阅的staging恢复与受控切换策略，文件域只允许新命名目标和精确挂载切换，Web/Worker只允许固定前代digest；不得down migration、直接改账、删表或自动业务冲销。
- [ ] postverify逐项绑定恢复结果、数据库/四域摘要、Migration head、四服务identity、runtime configuration、strict identity、health和保护对象；任何一项失败不得提交checkpoint 15。
- [ ] fake-root/断网测试覆盖参数漂移、工具替换、授权前preflight、超时/信号、partial/unknown、重复调用、containment、保护对象和结果替换；launcher/installer/journal/audit/inventory适用回归通过。
- [ ] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动进入下一安全任务。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、env、日志、Volume、备份或凭据正文，不运行真实restore、Migration、Compose、postdeploy、rollback或业务写。
- 不创建/修改账号、权限、systemd、网络、防火墙、Swap或Docker daemon；不停止、替换或删除当前容器，不触碰四个受保护持久卷。
- 不把runtime adapter源码存在、fake-root结果或15/15静态SUPPORTED描述为真实UAT回退演练通过、执行器READY或可投产。

## 4. 起点与资源判定

- TASK79 source`1015b53`→manifest-only`cd9c9de`形成141文件bundle`e635792d…4645d`；checkpoint 4—15仓库控制链闭合，机器审计为15项SUPPORTED，但仍有2项P0、1项P1动态阻断。
- available约1.6GiB、Swap870MiB/1GiB、根盘约12GiB，Swap超过80%；本轮还发生一次受限ESLint V8 heap OOM但内核`oom_kill`未增加。只允许仓库静态、Python、受限Node及fake-root轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + RUNTIME ADAPTER DYNAMIC VALIDATION`。
