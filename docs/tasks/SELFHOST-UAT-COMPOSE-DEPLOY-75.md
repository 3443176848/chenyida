# SELFHOST-UAT-COMPOSE-DEPLOY-75 UAT晋升一次性Compose部署与checkpoint 9回执

> 状态：`DONE / REPOSITORY COMPOSE DEPLOYMENT RECEIPT VERIFIED / DYNAMIC VALIDATION DEFERRED / NO REAL DEPLOYMENT OR DATABASE ACTION / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格起点：`main@52242f826b542456ee22bae55dcc0b83c746dfea` / tree `6a20ec8fe44238a438401bdf15f777b22df6f47b`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人保留真实容器、数据库围栏交接、UAT/生产、凭据、host及部署专项授权

## 1. 背景与目标

TASK74/D-149已闭合checkpoint 8仓库调用链：独立Migration execution授权、数据库围栏、逐文件事务、最终ledger、不可覆盖提交回执及保全恢复均已实现；成功后的active database fence故意保持，避免在新Web/Worker身份尚未建立时重新放行writer。机器审计仍把`COMPOSE_DEPLOYMENT_RECEIPT`列为P0缺口。

本任务只在仓库、fake-root和可注入Docker/Compose adapter中实现checkpoint 9。真实Compose、容器替换、数据库围栏释放、UAT流量、镜像pull、网络和业务写仍需未来专项授权；资源停止线解除前不启动合成Compose，动态验证继续归TASK70。

## 2. 验收标准

- [x] 完整核对release Compose、旧/新Web与Worker身份、Caddy/PostgreSQL非目标边界、checkpoint 8 active fence、runtime/postdeploy合同、回退候选和部分部署恢复责任。
- [x] 新增独立`DEPLOY_UAT_RELEASE`短时一次性Supervisor授权，精确绑定ordinal-8前代、promotion/candidate/runtime/database/snapshot、Migration receipt/result/fence、eligible manifest、Web/Worker digest、Compose project/working directory及三方actor；不得复用任何旧授权SHA。
- [x] deployment intent与精确旧/新容器计划必须在授权消费和任何Docker变化前持久化；production只接受Supervisor派生、内容寻址、单次消费输入，环境变量或root手工Compose不得形成回执。
- [x] 只允许替换精确Web/Worker，PostgreSQL、Caddy、网络、四个受保护Volume及Compose project/working directory必须保持；镜像必须为manifest绑定digest且禁止隐式pull/build。
- [x] 数据库active fence在新容器创建、启动、健康和runtime identity全部独立验证前不得释放；围栏交接必须是显式、可审计的单一阶段，失败保持sealed且不得启动业务writer。
- [x] 生成promotion-bound、不可覆盖的checkpoint 9回执，绑定旧/新容器完整inspect、镜像、启动/健康、Compose集合、数据库围栏交接和执行授权；按history→receipt→current发布。
- [x] 未消费、已消费未变更、只替换一个服务、容器已创建未启动、启动但身份/health未知、回执发布崩溃及cleanup失败均有确定恢复或quarantine；不得猜测重跑、删除未知容器、释放数据库或覆盖事故证据。
- [x] fake-root/断网测试覆盖正向、重放、旧授权复用、source/manifest/container替换、额外Compose成员、digest/label/mount/network/health漂移、hardlink/symlink、三个发布崩溃点及保全恢复。
- [x] 机器审计只在真实生产调用链和负向门完整时把checkpoint 9转为SUPPORTED；最终收据、人工UAT和rollback继续阻断，`assert-ready`仍拒绝。
- [x] 更新项目治理文档、投产授权包、测试/资源/敏感/diff证据并形成独立source→manifest提交链；完成后自动选择下一未阻塞任务。

## 3. 禁止事项

- 不运行真实Docker Compose、pull/build/recreate/start/stop，不连接数据库或修改active fence，不读取容器env、日志、Volume、业务数据、凭据或备份。
- 不把镜像digest、`docker compose config`、进程退出0、单次health或checkpoint 8回执单独当作部署成功。
- 不触碰systemd、网络、防火墙、账号、Swap、Docker daemon、UAT/生产或四个受保护Volume；不删除历史镜像、容器或证据。

## 4. 起点与资源判定

- TASK74最终source`5610a0d`→Supervisor manifest-only`52242f8`形成130文件bundle`17efe85d…aad5`；机器审计10项SUPPORTED、5项阻断（P0=4、P1=1），checkpoint 9仍MISSING且`assert-ready`继续拒绝。
- 当前UAT仍为alpha.42/0040，源码匹配Web/Worker镜像不存在；本任务不得因仓库实现而调用或改变当前运行面。
- available约1.9GiB、Swap879MiB/1GiB、根盘约13GiB，Swap超过80%。只允许仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。

## 5. 实施结果

- 新增`uat-promotion-compose-deployment-contract.mjs`与`uat-promotion-compose-deployment-control.mjs`。部署计划只接受manifest绑定的Web/Worker digest及release Compose声明，production adapter固定使用`create --no-build --pull never --force-recreate --no-deps`，不会把PostgreSQL、Caddy、网络或四个受保护Volume列入变更目标。
- Supervisor新增最长15分钟、三方actor互异的`DEPLOY_UAT_RELEASE`一次性授权；deployment intent与精确旧/新容器计划先于授权消费持久化，消费后只允许同一内容寻址controller执行。active fence interlock只允许精确部署或其精确恢复接管checkpoint 8。
- controller在替换前冻结四服务、网络、mount、labels、镜像和数据库handoff基线；只在新Web/Worker均通过容器身份、digest、启动、health及runtime configuration验证后执行单一数据库交接。结果与`active-fence-transfer`分别不可覆盖发布，再由journal按history→receipt→current提交checkpoint 9。
- 恢复路径对已完成结果只重放发布，不重跑Compose；对malformed/partial/漂移先执行emergency database seal并只停止精确operation+authorization标注的候选，随后保全/quarantine。未知容器、历史容器和事故证据不会被猜测删除。
- 审计把`COMPOSE_DEPLOYMENT_RECEIPT`转为`SUPPORTED`，现为11项SUPPORTED、4项阻断（P0=3、P1=1）；artifact/source-manifest SHA-256为`881ca1cf43aa4fa9c1e14dd2e40c5cca49c7c5077601692513788f93860c7119`/`b6f01c11d547d85a8bfd11da72342e913557475b3525be4fe4f2617851eaa98c`，`assert-ready`继续以`UAT_PROMOTION_EXECUTOR_NOT_READY`拒绝。

## 6. 不可变提交链

- feature source：`d383c105eef1b3f718105faa7a9d1fa6516ebd4e` / tree `d900fd6b849a3c254209cc93865cabe82b72c7af`。
- bundle上限修正source：`c6c4864dc99afb9c2bbb2c4b164e1f1e2beff5ee` / tree `2627d383699005e58c58b4dae6c8880e11fa84e7`；只把生成器/installer固定上限从130同步到132并补对应负测。
- Supervisor manifest-only：`86be6d4b139e6626067a6a1782a3636d076f058a` / tree `006c230976d8dd985394b59a7b0965f90b2e1a51`，是上述source的直接单文件子提交。
- 132文件bundle raw SHA-256为`249d28feec8b9f26a3ccb373f7a6a9790f407467243a55cc48e69246a9753071`；launcher/installer SHA-256为`8b74e37c6977923320cccc3e22839a13c50b59233132284a420386b4f7abbb86`/`51f0f4eb52fe7a8139ddf14bb1d473ea2a758a8db824a6eb0bada14cbb9306a0`，生成器逐字节重放一致。

## 7. 验证、资源与边界

- 受限Node v22.23.2串行通过事务/部署合同35/35、跨岗/manifest/审计合同26/26；audit generate/verify一致，`assert-ready`按预期exit 1；inventory为258 total / 234 required / 24 N/A。
- Python串行通过`test_release_supervisor_uat_promotion`、launcher、browser、installer共50/50；7个相关Python文件内存编译通过，bundle逐字节重放及`git diff --check`通过。
- `check-credentials.mjs`扫描1,751个仓库文件通过；项目负责人未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`始终不读、不改、不提交。
- 收口只读资源为available约1.9GiB、Swap881MiB/1GiB、根盘约13GiB、Load低；宿主`oom_kill=2`，四服务restart0/OOM false。没有创建容器、数据库、网络、Volume或持久临时资源；仅复制Node二进制到任务专用临时目录运行轻量测试并已清理。
- 本任务没有连接数据库、运行Migration、执行真实Compose、pull/build、启动/停止容器、释放真实围栏或访问env/log/Volume/业务数据。当前UAT仍为alpha.42/0040；系统保持`PRODUCTION NO-GO`。

## 8. 后续依赖

只读复核发现checkpoint 10/11虽已有独立postdeploy probe/identity工具并被静态审计标为SUPPORTED，但它们尚未进入promotion journal的逐检查点授权、history/receipt/current及恢复链。下一唯一`DOING`任务为`SELFHOST-UAT-POSTDEPLOY-TRANSACTION-76`，先关闭该前置缺口；checkpoint 13 final receipt、checkpoint 14—15 rollback以及人工跨岗UAT仍保持阻断。TASK70在Swap≤80%且执行器完整前继续BLOCKED。
