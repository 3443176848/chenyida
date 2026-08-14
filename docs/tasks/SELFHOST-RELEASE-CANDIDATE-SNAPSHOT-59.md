# SELFHOST-RELEASE-CANDIDATE-SNAPSHOT-59 A2独立候选快照生命周期闭环

> 状态：`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / A2 STILL BLOCKED / NO HOST INSTALL / PRODUCTION NO-GO`
> 日期：2026-08-14（Asia/Shanghai）
> 严格起点：`main@ad87edc45a32521cfcec36b6214f4d510d750e54` / tree `5831507e94a40641dab9a630ce3a95620c037689`
> 责任：Codex主智能体唯一写入、测试调度、证据集成和Git提交；项目负责人保留host安装、外部push、真实数据、UAT/生产、账号、员工试用和切换的专项授权权力

## 1. 目标

闭合投产专项授权执行包第13节第2项：为A2建立独立、精确、可验证、可清理的detached candidate snapshot生命周期，防止共享主工作区切换、更晚治理提交冒充镜像revision、脏快照进入正式门或清理错误目标。

实现必须在仓库与合成隔离临时Git仓库中完成。当前TASK57本机候选在任何`chenyida_erp_site`变化后立即转为`STALE / NOT AUTHORIZABLE`；本任务不重建镜像，不运行A1/A2/A3，不安装host，不接触UAT/生产或真实数据。

## 2. 初始范围与验收标准

- [x] 完整审计release Supervisor、A2三动作、repository-root、依赖树和现有Git archive边界，先记录可利用原语与缺口。
- [x] 定义版本化snapshot contract，固定source repository、candidate commit/tree、site tree、bundle source/manifest关系、目的根、run ID、确认串和no-clobber语义。
- [x] PREPARE不得切换共享主工作区；只创建目的根外的detached snapshot，验证HEAD/tree、detached、tracked clean、无未知worktree管理漂移及不组/全局写。
- [x] VERIFY在任何正式动作前重新核对candidate、bundle、主仓库/快照身份和receipt，拒绝治理HEAD冒充、branch、dirty、symlink/path replacement、receipt tamper及错误repository。
- [x] REMOVE只清理同一receipt绑定且仍安全的任务快照；dirty、identity drift、未知mount/管理状态时失败关闭，不使用`--force`，保留去敏审计回执。
- [x] 合成隔离测试覆盖正常prepare→verify→remove、主工作区有既有未跟踪文件、并发/no-clobber、错误commit/tree、dirty snapshot、路径替换、receipt篡改、错误清理目标和中断恢复。
- [x] release inventory/Supervisor bundle按实际调用边界纳入新工具和测试；TASK57候选已明确失效，后续只从最终安全仓库链重建。
- [x] 适用Node/Python/POSIX/release/supervisor/凭据/静态门通过，重任务串行且临时资源清零；Swap越过80%后未再启动新重任务。
- [x] 更新`MASTER.md`、`TASKS.md`、`PROJECT_CONTEXT.md`、`CHANGELOG.md`、`STATUS.md`、`PRODUCTION_READINESS.md`与授权包，形成独立提交并自动进入下一安全任务。

## 3. 禁止事项

- 不读取、修改、暂存或提交项目负责人既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`。
- 不读取`.env`、凭据、日志、业务行、备份或受保护Volume正文。
- 不在共享`/opt/erp`执行branch切换、reset、clean、stash或worktree remove，不修改用户未提交内容。
- 不安装Supervisor/systemd，不创建可消费授权，不运行正式A2，不外部push，不build/deploy/Migration，不连接UAT/生产。
- 不使用强制worktree删除、广泛递归清理、prune或删除既有镜像/cache/Volume/备份/制品。

## 4. 只读审计结论

- 原A2只校验任意Git根的HEAD/tree和局部clean，不能证明它是独立detached worktree；launcher还在取得全局锁之前验证候选，存在VERIFY到执行的替换窗口。
- TASK57候选HEAD必须是manifest commit，receipt同时绑定其唯一source parent；只允许`release-supervisor-bundle-v1.json`这一文件构成直接子提交差异。更晚治理HEAD不能冒充候选。
- 纯detached worktree没有被Git跟踪的`node_modules`和`.venv`，不能运行19步门。当前两棵依赖约32,098和2,195项，因此选择receipt绑定的`BORROWED_NEVER_REMOVE`外部test runtime，而不是复制约806MiB依赖或新增bind mount生命周期。
- 多轮安全审计发现并已修补最终路径半写与丢响应、removed tombstone错误成功、target已删恢复丢失source/bundle身份、worktree/admin未知状态、策略解释器与依赖祖先链未绑定、旧恢复audit跨代复用，以及最新quarantine丢失后回退旧audit等P1。命令内部形成target/admin split-brain时返回专用`RECOVERY_REQUIRED`，不得force/prune或猜测清理。
- 显式`recover-prepare`/`recover-remove`只在来源可证明时使用同设备`renameat2(RENAME_NOREPLACE)`把残留对象移入root-only、永久保留且需另行授权处置的quarantine；每代intent/audit绑定lifecycle digest、generation、对象完整身份和固定Git运行时，全代要求连续唯一并逐代复核audit-plan-quarantine守恒。任何证据缺失、旧pending冲突、对象替换或tombstone不一致均失败关闭，不能跳过坏代返回旧成功。
- PREPARE的admin-only残留只有在精确Task59 lock reason存在时才可自动隔离；target-only因创建前没有不可变所有权凭据，固定返回`SNAPSHOT_PREPARE_TARGET_PROVENANCE_UNPROVEN`并保持目标原样，不把任意foreign worktree误隔离。后续若要自动处置该分支，必须先增加同设备私有staging、0400 reservation receipt及root dev/inode/mode全程绑定，不能在本任务内猜测所有权。

## 5. 已实施合同

- 新增`chenyida-erp-release-candidate-snapshot/v1`工具。PREPARE固定状态根和确认串，在全局锁及lifecycle锁内使用`git worktree add --detach --lock --reason`；主工作区只记录状态摘要，不切换、不reset/stash/clean。
- receipt、intent和removal采用同目录临时文件、file fsync、hard-link no-replace发布、directory fsync；中断后可完成双链接发布或精确重建半写临时文件。相同PREPARE丢失响应后完整VERIFY并幂等返回同一receipt/digest。
- PREPARE/REMOVE recovery intent采用按lifecycle和对象身份递增的generation；恢复前遍历并验证全部历史代，审计存在而保留隔离对象缺失、intent与对象同时缺失、已有pending与当前split冲突、generation缺口/重复均拒绝。已发布audit仍须再次验证当前target/admin/registration tombstone，禁止旧成功覆盖新一代残留。
- snapshot身份绑定root、`.git`、admin、lock、完整worktree元数据、index flag、admin allowlist及关键文件inode/digest；拒绝branch、dirty、ignored/untracked、组/全局写、硬链接、特殊文件、未知Git操作状态、path/inode/mount漂移。
- bundle身份绑定manifest digest、全部payload、source commit/tree、manifest commit/tree和唯一直接子提交关系；A2三项授权新增receipt路径/摘要与test runtime root。
- test runtime从候选读取lock/requirements，从借用根读取依赖；receipt绑定从`/`开始的可信目录链、node/venv元数据与内容摘要、策略固定Python解释器的路径/inode/digest，并只允许依赖树内symlink或显式解释器目标。六个消费者在正式gate中拒绝缺失、非canonical runtime root并继续只读挂载。
- launcher顺序改为全局锁→snapshot VERIFY→授权消费；image evidence、release gate、release manifest包装器均在首次制品变化前及最终发布前再次VERIFY。REMOVE复核source/candidate/bundle/runtime及target/admin/registration tombstone，只执行无`--force`的精确`git worktree remove -- <target>`。

## 6. 当前验证证据

- 合成snapshot测试`17/17 PASS`，覆盖正常与幂等生命周期、既有主工作区未跟踪文件、并发、错误commit/tree、branch/dirty、receipt mode/hardlink/content、runtime/interpreter/祖先/mount、path/gitfile/admin/index替换、原子发布、main前进、PREPARE/REMOVE中断、两代恢复隔离、foreign target保留及最新quarantine丢失失败关闭。
- Supervisor Python全套`66/66 PASS`；动态测试核对snapshot verifier的精确argv、清洗环境、继承lock FD及严格canonical响应。
- 九个受影响shell脚本`sh -n 9/9 PASS`，Python AST`4/4 PASS`，`git diff --check`通过。
- 单一受限离线Node容器中release合同`54/54 PASS`；临时容器自动删除。真实依赖只读元数据检查通过：Node 32,098项、Python 2,195项。
- 最终安全复核脚本SHA-256为`71361ac9f2ab8ddb1cfe591fef674340462c552678174cd80ca51893cd9add8a`，三条独立攻击探针及完整17项测试通过，未发现提交阻断。复核窗口available约1.7GiB、Swap 768→769MiB/1GiB、根盘13GiB、Load 0.40→0.57；`oom_kill=0`。UAT Web/PostgreSQL healthy、Worker/Caddy running，四服务未见重启或OOM；没有Node/PostgreSQL UAT、Volume、host安装、部署或真实A2动作，旧Python SQLite偏差另见下文。
- 最终source`7b9abec45a50da5655a2e78a0f42647536321290`/tree`0ae35f87cf2e14279f9e93f581557ce17f8e13a4`与唯一manifest-only直接子提交`89504045e4066bbe5236b19cf1a8bfa09701d508`/tree`13809b3b46f46f375b3af6a0c0874d9af5bff5a7`形成78文件bundle，manifest SHA-256为`7927bb242cad9784a48ebaa8269ac9cc53cf56808c7dffc8f3d148111c7e5855`，生成器逐字节重放一致。release inventory/test runtime policy摘要为`4dbf77767cef5896a5dd0eb2a0db676709e9fa6f4335fac0cf823b901d33c4ed`/`443d6a5a108541485334af3144000b1a5407ec97f63dce8b809fda1e6899561a`。
- 正式提交快照验证通过release inventory 6文件/57项、直接release 54/54、SPECIAL POSIX 7文件/57项、凭据1,670文件、隔离Python self-test/smoke/go-live及Supervisor 66/66；最终绑定增量又通过受影响browser policy 5/5。lint为0 error/28 warning；JSON220、Shell44、Python AST52、Markdown398/本地链接242、source diff和`git diff --check`通过。无UI、Schema/Migration或业务逻辑变化，Browser E2E、PostgreSQL及Node source/typecheck不属于本任务受影响门；Swap超过80%后未为重复全量门冒险启动新重任务。
- 两个诚实失败均已修复且未降低断言：cap-drop sandbox首先暴露合成解释器0555文件篡改夹具依赖root capability，现显式短暂恢复owner-write并复跑通过；正式inventory随后在测试执行前发现release合同文件SHA未同步，已重绑inventory、runtime policy及固定摘要后由官方harness通过。
- 验证偏差：一次直接运行旧Python `go_live_check.py`未使用隔离入口，对`chenyida_erp_app/data/erp.sqlite3`执行了初始化检查并创建`data/backups/erp-backup-20260814-222753.sqlite3`。未读取业务行、未删除或回滚该数据库/备份；因删除备份和改写旧运行数据需要专项授权，二者原样保留。随后全部Python基线改由bubblewrap、`/state`临时SQLite和`--no-backup`入口复跑通过。该偏差不涉及Node/PostgreSQL UAT或四个受保护Volume，但必须保留为运行纪律问题。
- lint窗口Swap从约769MiB升至889MiB/1GiB并越过80%，因此立即停止启动新的typecheck/Node source等重任务；收口available约1.9GiB、根盘13GiB、Load回落至0.41、`oom_kill=0`。四服务running/restart0/OOM false，Web/PostgreSQL healthy、Worker/Caddy health none；任务container和临时目录清零。高Swap仍是下一任务启动重门前的资源阻断，不修改Swap或系统配置。

## 7. 当前判定

`DONE / REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / A2 STILL BLOCKED / PRODUCTION NO-GO`。TASK59已关闭可证明的detached snapshot准备、验证、删除、跨代审计和保留隔离合同；无创建前reservation凭据的PREPARE target-only自动处置仍安全失败关闭，下一仓库任务必须增加不可变reservation后才能解除该操作阻断。TASK57的76文件bundle及本机镜像已因Site变化成为`STALE / NOT AUTHORIZABLE`；A1、A3、host安装、真实A2、外部锚点及UAT/数据动作均未授权。
