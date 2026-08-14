# SELFHOST-RELEASE-SNAPSHOT-RESERVATION-60 创建前候选目标所有权闭环

> 状态：`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / RESOURCE STOP LINE ACTIVE / NO HOST OR A2 / PRODUCTION NO-GO`
> 日期：2026-08-14（Asia/Shanghai）
> 严格起点：`main@d7780864eb239cbeadf4aa84e92a3a6bb62016c1` / tree `2a9ecd452ca53cb7691ad58ce0dc3082a7aa4d84`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；智能体团队只读复核；项目负责人保留host、外部、UAT/生产、数据、账号、网络和切换专项授权

## 1. 目标

关闭D-135明确保留的PREPARE target-only所有权歧义：在候选target出现前，以同设备私有staging目录和不可变reservation receipt建立可证明所有权；原子提升后、Git worktree创建前后及崩溃恢复时始终验证同一root inode。任何证据缺失、替换、跨设备、非空、foreign对象或Git未保留inode都失败关闭，不猜测删除或隔离。

## 2. 验收标准

- [x] reservation在target出现前以canonical JSON、root-only `0400`、单硬链接、file+directory fsync和no-clobber发布，绑定repository/source/candidate/bundle/runtime/lifecycle/generation、target/staging路径及root dev/inode/mode。
- [x] staging与target同设备；只允许私有固定根、空普通目录、可信祖先和精确mode。以`renameat2(RENAME_NOREPLACE)`提升同一inode，目标已存在时不覆盖、不重命名、不删除。
- [x] PREPARE在Git动作前后验证reservation摘要和同一inode；若Git不能保留root inode，明确失败关闭并采用经测试的安全创建序列，不通过`--force`、`prune`、共享worktree切换或路径名推断绕过。
- [x] RECOVER覆盖receipt前中断、receipt后未提升、提升后未登记Git、Git target/admin单边、响应丢失及多代状态；只处理reservation可证明对象，foreign target保持原样。
- [x] inode替换、symlink、mount、非空、跨设备、receipt篡改/丢失、generation/audit/quarantine漂移、并发和目标占用负测均在制品变化前失败关闭。
- [x] 正常PREPARE→VERIFY→REMOVE及中断恢复保持TASK59的借用runtime、锁顺序、不可变回执、全代守恒和永久quarantine边界，不降低既有17项和独立攻击断言。
- [x] release inventory、Supervisor bundle、launcher/wrapper和文档按实际调用边界同步；任何Site变化使TASK59 bundle继续失效，最终候选镜像只在全部安全仓库输入收口后重建。
- [x] 适用轻量Python/Git/POSIX/release/supervisor/凭据/静态门通过；Swap高于80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或候选镜像任务。
- [x] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`与授权包，形成独立Git提交并自动进入下一安全任务。

## 3. 禁止事项

- 不读取或修改`.env`、凭据、业务行、日志、备份正文、受保护Volume正文或用户未跟踪状态报告。
- 不安装host Supervisor，不生成A1/A2 authorization，不build/push镜像，不访问外部目标，不执行UAT/生产Migration、deploy、重启、账号/权限、网络、systemd、Swap或Docker daemon动作。
- 不使用`git worktree remove --force`、`git worktree prune`、递归猜删、覆盖回执或自动删除quarantine；不处置无法由reservation证明所有权的target。
- 不把仓库/合成测试写成真实host快照、正式19步PASS、外部锚点、灾备完成或生产批准。

## 4. 起点事实

- TASK59最终source`7b9abec45a50da5655a2e78a0f42647536321290`与manifest-only `89504045e4066bbe5236b19cf1a8bfa09701d508`形成78文件bundle`7927bb24…e5855`；detached snapshot主合同、借用runtime、锁内VERIFY和守恒恢复已通过。
- PREPARE target-only仍返回`SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN`，因为target出现前没有可证明的创建者回执；D-135要求本任务补齐reservation。
- TASK57 Web/Worker镜像已为`STALE / NOT AUTHORIZABLE`，当前没有源码匹配候选；UAT仍alpha.42/0040、共享superuser和环境秘密。
- 起点available约1.9GiB、Swap887MiB/1GiB（超过80%停止线）、根盘13GiB、Load`0.09/0.19/0.47`、`oom_kill=0`；四服务此前restart0/OOM false。当前只允许轻量工作，不修改Swap或服务。
- 工作区除项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`外clean；该文件继续不读、不改、不提交。

## 5. 实施与证据

- D-136固定不可变状态链：prepare intent后在私有`staging/`创建root-owned `0700`空目录，先发布`0400` reservation receipt，再以固定父目录FD执行`renameat2(RENAME_NOREPLACE)`。receipt直接绑定source/candidate/bundle/借用runtime、源状态、lock/admin、可信祖先、mount identity、父目录及root dev/inode/mode/uid/gid，并以previous terminal recovery形成逐代链。
- Git 2.43.7轻量探针和正式fixture均证明标准`worktree add --detach --lock --reason`在预建空目录上保持root inode及`0700`；PREPARE在派发前持有`O_DIRECTORY|O_NOFOLLOW`目录FD，Git后再核对同一inode。未使用`--force`、`--no-checkout`、`prune`、copy fallback或共享worktree切换。
- receipt final前的完整`.publishing`可按canonical bytes、单链接和精确reserved inode完成发布；partial或无receipt的staging保持原样并失败关闭。receipt后未提升、提升后空target、Git完成后响应丢失均幂等续跑；精确reservation target-only只经显式RECOVER永久隔离，foreign inode保持不变。
- 专项从17项增至23项，覆盖正常PREPARE→VERIFY→REMOVE、并发、publication各窗口、NOREPLACE/EEXIST/EXDEV、非空、mode/inode/parent漂移、target/ancestor symlink、mount、receipt缺失/篡改、foreign target-only、admin-only、target-only、多代旧audit和最新receipt/quarantine丢失。六个Supervisor模块为`72/72 PASS`，凭据门为`CREDENTIAL_CHECK_OK (1671 repository files scanned)`，`git diff --check`通过。
- 源码`15501787f5cd304dfe5f8c75fb5df15d4e9a2258`/tree`3718593b8b6d362922bc4e84be6b6cf4adbd00a6`与只改canonical manifest的直接子提交`ffaaa9091cf09afa80918e87664ed6660f0556cf`/tree`9d42de1626ed6f8cf13308c7bbc2e83685f7341e`形成78文件bundle；manifest SHA-256为`17fb9f99af2aae24390d060344114d1d1089c1fb19a87280c83161e277fab5b8`，脚本/测试SHA-256为`296f61ef…fe98d`/`7c191f04…b8344`，生成器逐字节重放一致。release inventory无新增Node测试且保持`4dbf7776…8551a`。
- 收口available约2.0GiB、Swap873MiB/1GiB（仍超过80%）、根盘13GiB、Load约`0.40/0.44/0.40`、`oom_kill=0`；四服务running/restart0/OOM false，Web/PostgreSQL healthy、Worker/Caddy health none。唯一凭据扫描容器自动删除，测试临时目录自动清理，四个受保护Volume只核对名称且未读正文。

## 6. 完成判定

`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。创建前target所有权门已关闭，TASK59 bundle被本任务新链取代；这不构成host、A1—A3、外部锚点、正式19步门、镜像重建、UAT/生产、真实数据、账号或切换授权。当前没有源码匹配镜像，真实员工仍不能使用；下一安全仓库任务转向TASK49监控的内容寻址host delivery包，仍不实际安装或投递。
