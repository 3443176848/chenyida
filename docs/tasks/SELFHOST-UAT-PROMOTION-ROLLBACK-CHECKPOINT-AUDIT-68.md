# SELFHOST-UAT-PROMOTION-ROLLBACK-CHECKPOINT-AUDIT-68 UAT晋升与快照回滚逐检查点失败关闭审计

> 状态：`DONE / SOURCE-BOUND STATIC AUDIT VERIFIED / EXECUTOR BLOCKED FAIL-CLOSED / DYNAMIC VALIDATION SPLIT TO TASK70 / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@186e117cdebf2076619c75379edf4e36a1f7394a` / tree `c36d57a969afc720cf12ed032ffb025933617b50`
> 责任：Codex主智能体唯一写入、轻量测试调度、证据集成和Git提交；项目负责人保留Compose/PostgreSQL重任务、UAT/生产、备份恢复、部署和回滚专项授权

## 1. 背景与目标

TASK53、TASK59—TASK60及TASK67已经分别固定发布生命周期、独立candidate snapshot/reservation和跨岗位UAT证据合同，但尚未从“同一候选晋升、逐检查点验证、失败停止、快照回退、回退后再核对”的端到端视角证明执行器不存在绕过、半完成、陈旧证据复用或错误恢复缺口。

本任务先对仓库现有release gate、candidate snapshot/reservation、postdeploy/runtime identity、backup/recovery和UAT合同做只读/静态审计，形成逐检查点状态机与缺口清单；只对确认的失败关闭缺口实施仓库代码及轻量合成测试。当前Swap超过80%，不得启动Compose/PostgreSQL、build、Migration、镜像或部署；相关隔离动态验证已拆为TASK70受阻验收项，不以静态测试替代。

## 2. 验收标准

- [x] 枚举从prepared candidate、预部署稳定性、快照/备份、Migration、部署、postdeploy严格验证到业务UAT及回退后复核的全部权威入口、状态、receipt和锁边界。
- [x] 建立可机读逐检查点合同，固定前置证据、成功输出、允许重试/恢复、停止条件和回退触发器；候选、源码、镜像、Migration、数据库、授权、时间窗或receipt跨代/漂移必须失败关闭。
- [x] 证明任一检查点失败不会把后续步骤或整体标成成功，不会覆盖前代证据，也不会在缺失已验快照时声称可回退；未知/partial状态必须保全并要求显式恢复。
- [x] 核对快照回滚只处理精确受控对象，数据库已过账事实不以直接删表/改账清理；业务冲销与环境级快照恢复边界明确分离。
- [x] 对发现的仓库缺口补充机器审计、`assert-ready`失败关闭及负向测试，并纳入release inventory/runtime policy；缺失执行器未被文档冒充为已实现。
- [x] 停止线仍有效，合成Compose/隔离PostgreSQL动态验收未执行并已显式拆分为`SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70`的`BLOCKED`验收项；未连接或部署UAT/生产。
- [x] 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS和投产授权包；通过适用测试、敏感信息及diff检查后创建独立提交，并自动选择下一项。

## 3. 禁止事项

- 不连接UAT/生产数据库，不读取业务行、日志、环境秘密、备份或Volume正文，不执行Migration、部署、回滚、Compose重建或真实API写。
- 不创建、修改或登录账号，不授予A1—A8，不安装host Supervisor，不修改systemd、网络、Swap、Docker daemon或持久卷。
- 不把静态状态机、合成fixture或历史回执描述为真实UAT晋升、真实恢复或正式回滚已通过。

## 4. 起点与当前判定

- TASK67最终链为source`ac4f294d`→monitor`c70b6bfc`→Supervisor`186e117c`，30/126文件manifest逐字节重放，完整Supervisor Python105/105通过；该链是本任务唯一严格审计起点。
- UAT运行面仍为alpha.42/0040，源码为alpha.47/0046，当前没有源码匹配镜像、正式A1/A3、19步PASS、真实快照/恢复或A7e授权。
- `DONE / SOURCE-BOUND STATIC AUDIT VERIFIED / EXECUTOR BLOCKED FAIL-CLOSED / DYNAMIC VALIDATION SPLIT TO TASK70 / PRODUCTION NO-GO`。仓库证据图和拒绝门已完成；缺失执行器转TASK69，动态隔离验收转TASK70，任何真实运行面动作继续等待专项授权。

## 5. 完成结果

- 机器policy固定15个有序检查点和15个源码输入；artifact SHA-256为`c0a5a5619835bf82d478494ed63d2e2d68c54542634495aae93986090ad6f24d`，source manifest SHA-256为`eab97c64078d00ff75e0da55710e3c9b9b2b7780d996c35e5e6a7a093f9de093`。
- 当前仅5项`SUPPORTED`，10项阻断（P0=9、P1=1）；19个Supervisor操作中，7个必需晋升/回滚操作实现0个。restore仍为`TEST_ONLY`，Migration仍依赖可重复环境确认，Compose digest override仍无晋升回执，TASK67人工UAT仍`BLOCKED`。
- `uat:promotion-audit:assert-ready`稳定退出1并返回`UAT_PROMOTION_EXECUTOR_NOT_READY`；不得用手工root命令、旧回执或最终health绕过。
- 发布inventory更新为256/232/24，专项审计8/8、release合同29/29、Supervisor Python105/105、inventory verify与credentials 1,734文件通过。首次完整Supervisor复跑诚实发现旧runtime-policy摘要锚点1/105失败；精确更新后同一105项全部通过。
- 最终canonical链为source`79e4e80412fc1d2ba7a4ae19e9902f98313594e7`/tree`a756b1b05ec5027ecc7c1f9184629d601e042bd7`→monitor`84a2c78e3e664033ce1bd08d6e30de49418e0025`/tree`4de5f2472d2989694a9d7bfda4e28e25cfbbb22f`→Supervisor`1c70602282902c79066452d14fd836f868e94efb`/tree`46ec0e9a827b11d6d5d346b87f2eafab9f53ea96`；30/126文件manifest SHA-256为`9c1e9052d74bf309f03a6d64e03978982a74d4bcb0cdf5b55706c1a609e5ac39`/`56009eb7927ec6b6d352788c5067b45e5d2cef74c5894f3d278a8d6446bd12b5`。
- 收口资源为available约1.9GiB、Swap865MiB/1GiB、根盘13GiB、Load`0.34/0.33/0.22`；四服务restart0/OOM false，Web/PostgreSQL healthy，Worker/Caddy无health合同，任务临时容器为0。未运行build、Compose/PostgreSQL测试、Migration、镜像、快照、恢复、部署或业务写。

## 6. 移交

- D-144接受“先建立内容寻址promotion transaction journal，再逐项接入snapshot/quiesce/Migration/deploy/rollback adapter”的顺序。
- 唯一后续`DOING`为`SELFHOST-UAT-PROMOTION-TRANSACTION-JOURNAL-69`；动态隔离验收由TASK70保持`BLOCKED`，直到资源停止线解除且执行器前置完成。
