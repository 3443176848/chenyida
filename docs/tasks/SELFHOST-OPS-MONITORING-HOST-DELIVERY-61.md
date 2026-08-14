# SELFHOST-OPS-MONITORING-HOST-DELIVERY-61 监控宿主交付与通知权限边界

> 状态：`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT DESIGN / RESOURCE STOP LINE ACTIVE / NO HOST INSTALL OR DELIVERY / PRODUCTION NO-GO`
> 日期：2026-08-14（Asia/Shanghai）
> 严格起点：`main@08483c04231961ba5ac25757391793bfe208f926` / tree `c18d4f49d5ca9b491529c64ecd3f715ab9e53688`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；数据迁移、应用测试、运维安全智能体只读审计；项目负责人保留host安装、账号、systemd、真实渠道/凭据、UAT/生产、网络和数据专项授权

## 1. 目标

把TASK49/D-126的仓库监控工具整理为内容寻址、可审阅、崩溃安全且可回退的host delivery包：root采集边界只产出去敏观察，评估与通知使用非特权身份；固定systemd service/timer、root-only配置schema、pending投递与ack回执、安装/升级/惰性回退/卸载事务及隔离测试。任务只构建仓库制品，不实际安装host、创建账号、写systemd或发送通知。

## 2. 验收标准

- [ ] 建立独立、确定性、内容寻址的monitor delivery manifest/bundle，固定TASK49监控源码、策略、Node运行时要求、unit/timer、installer、notifier和全部测试输入；未知/缺失/摘要漂移在安装前失败关闭。
- [ ] installer只接受短时root-only一次性授权；安装根、配置根、状态根、锁、PREPARED/COMMITTED journal与receipt均有精确owner/mode/link/path合同，no-clobber、file/directory fsync、崩溃恢复和同版本幂等可验证。
- [ ] 固定root collector与非特权evaluator/notifier边界；Docker socket、`/proc`和root-only源证据不得授予应用或通知身份，跨边界只传严格去敏observation/event；不得读取容器环境、日志、网络、数据库、业务行、备份/Volume正文或秘密正文。
- [ ] 固定systemd service/timer及hardening、60秒采样/90秒最大间隔、单飞、超时、资源限额、重启持续和失败可见性；模板不能隐式创建真实账号、修改网络或把失败解释为健康。
- [ ] root-only配置schema只引用批准target、值班/升级元数据和凭据文件路径/摘要，不在argv/env/Git/事件中承载秘密；测试adapter与真实adapter明确分离，未得到远端可验证ack不得记录`DELIVERED`。
- [ ] notifier以有界pending队列、稳定event/dedup id、claim/attempt/ack回执和至少一次语义工作；重复、超时、响应歧义、进程崩溃、配置/凭据轮换、队列满和损坏状态均失败关闭且不丢事件或伪造恢复。
- [ ] 升级只切换到完整已验内容，保留前一版本与状态/pending；失败惰性回退到已验版本。卸载/物理清理必须单独授权，默认只停用精确版本并保全receipt/journal/state/pending，不递归删除未知对象。
- [ ] 合成fake-root/fake-systemd/fake-channel测试覆盖首次安装、幂等、升级、崩溃各相位、并发、路径/symlink/hardlink/owner/mode/hash漂移、通知重放/ack和回退；不连接真实systemd、Docker socket、外部网络、UAT/生产或数据。
- [ ] release inventory/Supervisor bundle按实际消费边界同步；TASK60 bundle和任何旧候选在Site变化后标记`STALE / NOT AUTHORIZABLE`，最终镜像仍在全部安全仓库输入收口后统一重建。
- [ ] 适用轻量测试、凭据、Markdown链接、静态检查与`git diff --check`通过；Swap高于80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或镜像任务。
- [ ] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`、授权包、运行手册和必要ADR，形成独立Git提交并自动进入下一安全任务。

## 3. 禁止事项

- 不读取或修改`.env`、凭据正文、业务行、日志、备份正文、受保护Volume正文或用户未跟踪状态报告。
- 不实际安装monitor/notifier，不创建/修改账号、组、权限、systemd/cron、网络、防火墙、Swap、内核或Docker daemon；不发送真实测试或业务通知。
- 不连接UAT/生产API或数据库，不执行Migration、backup、restore、build、deploy、restart、外部push或业务写。
- 不自动删除安装根、状态、pending、journal、receipt、旧版本或未知对象；不把仓库/合成fixture写成A5a完成、真实告警送达或生产批准。

## 4. 起点事实

- TASK49/D-126已有严格observation、统一资源阈值、四服务/应用/release/Migration/backup恢复评估、FIRING/REMINDER/ESCALATED/RECOVERED及原子hash-chain状态；没有内容寻址host installer、unit/timer、非特权notifier、配置schema或真实delivery ack。
- TASK60已形成source`15501787`→manifest-only`ffaaa909`的78文件bundle`17fb9f99…b5b8`，但TASK61后续Site变化会使其成为历史输入；当前没有源码匹配Web/Worker镜像、installed Supervisor、A1/A3或正式A2。
- UAT仍alpha.42/0040、共享superuser和环境秘密；Web/PostgreSQL healthy，Worker/Caddy health none。旧UAT应在未来A5a如实保持CRITICAL，不得为“绿色”弱化监控合同。
- 起点available约2.0GiB、Swap873MiB/1GiB（超过80%停止线）、根盘13GiB、Load`0.19/0.16/0.20`、`oom_kill=0`；四服务restart0/OOM false。当前先做文档、只读审计和轻量源码/fixture，不修改Swap或服务。
- 工作区除项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`外clean；该文件继续不读、不改、不提交。

## 5. 当前判定

`DOING / READ-ONLY AUDIT AND LIGHTWEIGHT DESIGN / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。本任务关闭A5a前的仓库交付缺口，不构成host、账号、systemd、渠道、A1—A8、外部、UAT/生产或数据授权；系统仍不能供真实员工使用。
