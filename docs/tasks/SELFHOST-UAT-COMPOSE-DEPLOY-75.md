# SELFHOST-UAT-COMPOSE-DEPLOY-75 UAT晋升一次性Compose部署与checkpoint 9回执

> 状态：`DOING / REPOSITORY COMPOSE DEPLOYMENT RECEIPT / RESOURCE STOP LINE ACTIVE / NO REAL DEPLOYMENT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@52242f826b542456ee22bae55dcc0b83c746dfea` / tree `6a20ec8fe44238a438401bdf15f777b22df6f47b`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实容器、数据库围栏交接、UAT/生产、凭据、host及部署专项授权

## 1. 背景与目标

TASK74/D-149已闭合checkpoint 8仓库调用链：独立Migration execution授权、数据库围栏、逐文件事务、最终ledger、不可覆盖提交回执及保全恢复均已实现；成功后的active database fence故意保持，避免在新Web/Worker身份尚未建立时重新放行writer。机器审计仍把`COMPOSE_DEPLOYMENT_RECEIPT`列为P0缺口。

本任务只在仓库、fake-root和可注入Docker/Compose adapter中实现checkpoint 9。真实Compose、容器替换、数据库围栏释放、UAT流量、镜像pull、网络和业务写仍需未来专项授权；资源停止线解除前不启动合成Compose，动态验证继续归TASK70。

## 2. 验收标准

- [ ] 完整核对release Compose、旧/新Web与Worker身份、Caddy/PostgreSQL非目标边界、checkpoint 8 active fence、runtime/postdeploy合同、回退候选和部分部署恢复责任。
- [ ] 新增独立`DEPLOY_UAT_RELEASE`短时一次性Supervisor授权，精确绑定ordinal-8前代、promotion/candidate/runtime/database/snapshot、Migration receipt/result/fence、eligible manifest、Web/Worker digest、Compose project/working directory及三方actor；不得复用任何旧授权SHA。
- [ ] deployment intent与精确旧/新容器计划必须在授权消费和任何Docker变化前持久化；production只接受Supervisor派生、内容寻址、单次消费输入，环境变量或root手工Compose不得形成回执。
- [ ] 只允许替换精确Web/Worker，PostgreSQL、Caddy、网络、四个受保护Volume及Compose project/working directory必须保持；镜像必须为manifest绑定digest且禁止隐式pull/build。
- [ ] 数据库active fence在新容器创建、启动、健康和runtime identity全部独立验证前不得释放；围栏交接必须是显式、可审计的单一阶段，失败保持sealed且不得启动业务writer。
- [ ] 生成promotion-bound、不可覆盖的checkpoint 9回执，绑定旧/新容器完整inspect、镜像、启动/健康、Compose集合、数据库围栏交接和执行授权；按history→receipt→current发布。
- [ ] 未消费、已消费未变更、只替换一个服务、容器已创建未启动、启动但身份/health未知、回执发布崩溃及cleanup失败均有确定恢复或quarantine；不得猜测重跑、删除未知容器、释放数据库或覆盖事故证据。
- [ ] fake-root/断网测试覆盖正向、重放、旧授权复用、source/manifest/container替换、额外Compose成员、digest/label/mount/network/health漂移、hardlink/symlink、三个发布崩溃点及保全恢复。
- [ ] 机器审计只在真实生产调用链和负向门完整时把checkpoint 9转为SUPPORTED；最终收据、人工UAT和rollback继续阻断，`assert-ready`仍拒绝。
- [ ] 更新项目治理文档、投产授权包、测试/资源/敏感/diff证据并形成独立source→manifest提交链；完成后自动选择下一未阻塞任务。

## 3. 禁止事项

- 不运行真实Docker Compose、pull/build/recreate/start/stop，不连接数据库或修改active fence，不读取容器env、日志、Volume、业务数据、凭据或备份。
- 不把镜像digest、`docker compose config`、进程退出0、单次health或checkpoint 8回执单独当作部署成功。
- 不触碰systemd、网络、防火墙、账号、Swap、Docker daemon、UAT/生产或四个受保护Volume；不删除历史镜像、容器或证据。

## 4. 起点与资源判定

- TASK74最终source`5610a0d`→Supervisor manifest-only`52242f8`形成130文件bundle`17efe85d…aad5`；机器审计10项SUPPORTED、5项阻断（P0=4、P1=1），checkpoint 9仍MISSING且`assert-ready`继续拒绝。
- 当前UAT仍为alpha.42/0040，源码匹配Web/Worker镜像不存在；本任务不得因仓库实现而调用或改变当前运行面。
- available约1.9GiB、Swap879MiB/1GiB、根盘约13GiB，Swap超过80%。只允许仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。
