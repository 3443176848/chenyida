# SELFHOST-RELEASE-SNAPSHOT-RESERVATION-60 创建前候选目标所有权闭环

> 状态：`DOING / DESIGN AND LIGHTWEIGHT IMPLEMENTATION / RESOURCE STOP LINE ACTIVE / NO HOST OR A2 / PRODUCTION NO-GO`
> 日期：2026-08-14（Asia/Shanghai）
> 严格起点：`main@d7780864eb239cbeadf4aa84e92a3a6bb62016c1` / tree `2a9ecd452ca53cb7691ad58ce0dc3082a7aa4d84`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；智能体团队只读复核；项目负责人保留host、外部、UAT/生产、数据、账号、网络和切换专项授权

## 1. 目标

关闭D-135明确保留的PREPARE target-only所有权歧义：在候选target出现前，以同设备私有staging目录和不可变reservation receipt建立可证明所有权；原子提升后、Git worktree创建前后及崩溃恢复时始终验证同一root inode。任何证据缺失、替换、跨设备、非空、foreign对象或Git未保留inode都失败关闭，不猜测删除或隔离。

## 2. 验收标准

- [ ] reservation在target出现前以canonical JSON、root-only `0400`、单硬链接、file+directory fsync和no-clobber发布，绑定repository/source/candidate/bundle/runtime/lifecycle/generation、target/staging路径及root dev/inode/mode。
- [ ] staging与target同设备；只允许私有固定根、空普通目录、可信祖先和精确mode。以`renameat2(RENAME_NOREPLACE)`提升同一inode，目标已存在时不覆盖、不重命名、不删除。
- [ ] PREPARE在Git动作前后验证reservation摘要和同一inode；若Git不能保留root inode，明确失败关闭并采用经测试的安全创建序列，不通过`--force`、`prune`、共享worktree切换或路径名推断绕过。
- [ ] RECOVER覆盖receipt前中断、receipt后未提升、提升后未登记Git、Git target/admin单边、响应丢失及多代状态；只处理reservation可证明对象，foreign target保持原样。
- [ ] inode替换、symlink、mount、非空、跨设备、receipt篡改/丢失、generation/audit/quarantine漂移、并发和目标占用负测均在制品变化前失败关闭。
- [ ] 正常PREPARE→VERIFY→REMOVE及中断恢复保持TASK59的借用runtime、锁顺序、不可变回执、全代守恒和永久quarantine边界，不降低既有17项和独立攻击断言。
- [ ] release inventory、Supervisor bundle、launcher/wrapper和文档按实际调用边界同步；任何Site变化使TASK59 bundle继续失效，最终候选镜像只在全部安全仓库输入收口后重建。
- [ ] 适用轻量Python/Git/POSIX/release/supervisor/凭据/静态门通过；Swap高于80%期间不启动build、全量Node/PostgreSQL、Docker数据库、typecheck或候选镜像任务。
- [ ] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`与授权包，形成独立Git提交并自动进入下一安全任务。

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

## 5. 当前判定

`DOING / DESIGN AND LIGHTWEIGHT IMPLEMENTATION / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`。本任务是A2前的仓库所有权门，不构成A1—A3授权；系统仍不能供真实员工使用。
