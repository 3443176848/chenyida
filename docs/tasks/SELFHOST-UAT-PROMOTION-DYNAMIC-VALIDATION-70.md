# SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70 UAT晋升与回滚隔离动态验证

> 状态：`DOING / DV70-PG-SWITCH-01 VERIFIED PARTIAL / DV70-PG-GUARDED-SWITCH-02 D-165 SOURCE COMMITTED AND PRIVATE-ANCHORED / PG17 REFRESH AND DYNAMIC RETRY RESOURCE-BLOCKED / ISOLATED SYNTHETIC ONLY / PRODUCTION NO-GO`
> 日期：2026-08-21（Asia/Shanghai）
> 责任：Codex主智能体串行调度；项目负责人保留任何UAT/生产、真实数据、host和凭据动作的专项授权

## 1. 目标

在TASK69—TASK82的晋升/回滚仓库执行器、适配器和固定handler完成后，以合成Compose、隔离PostgreSQL和可丢弃文件域验证逐检查点失败、崩溃恢复、Migration提交、部署、postdeploy、触发式快照回退及回退后全量核对。该任务只允许隔离合成数据，不授权访问或修改UAT/生产。

## 2. 当前准入事实

- TASK82及全部执行器依赖已经完成；仓库catalog仍须由本任务动态证据决定，不能因源码存在直接提升。
- TASK84已按D-158仅执行一次授权的24小时BuildKit cache清理，Docker对象保护和清理后60秒资源门通过；TASK70可从`TODO`正式转换为唯一`DOING`。
- TASK84清理后的历史最低可用约10.39GiB；D-165提交后门禁根盘精确可用10,724,749,312 bytes，仍低于10GiB硬线10,737,418,240 bytes。真实PG17、Docker和正式producer重任务全部停止；TASK84一次性命令不得重复，只有自然释放或新的精确专项授权才能解除该阻断。

## 3. 执行与验收边界

- 只使用新建可丢弃TEST目标、合成数据、独立网络和临时文件域；禁止连接UAT/生产数据库、读取受保护Volume/备份正文或使用真实凭据。
- Docker、PostgreSQL、Migration和测试严格串行，任一时刻至多一个任务临时容器；每个重任务前后执行完整资源门并记录对象/服务保护结果。
- 覆盖空库/已有数据升级、重复执行、逐崩溃点、失败回滚、unknown/partial恢复、快照内容核对、库存/金额守恒和最终零临时资源。
- 结果必须形成机器可审计的阶段/故障矩阵、逐项PASS/FAIL、持久回执、资源证据和精确清理收据；测试失败不得以降低断言或跳过替代。
- 通过不构成A6、A7或生产授权；真实UAT、host activation、员工签字、部署和切换仍需项目负责人专项明确批准。

## 4. 首个安全切片

先只读核对现有九阶段/十三检查runner与隔离PostgreSQL harness，补齐TASK70专用动态矩阵、资源/对象前置和清理合同；在确认单切片最坏磁盘占用不会跌破10GiB后，再串行运行最小隔离PostgreSQL事务/故障注入验证。不得以静态测试、旧TEST恢复回执、手工Compose或旧postdeploy证据冒充本任务动态结果。

## 5. 当前执行切片与验收

TASK70于2026-08-21正式启动为唯一`DOING`。首个提交先完成版本化动态证据合同、失败关闭verifier与机器审计状态拆分；必须把“仓库handler已实现但dormant”“隔离动态证明缺失”“host activation缺失”“真实UAT回退未执行”作为四个独立事实，任何隔离合成回执都不得关闭后三项。

首个动态case固定为`DV70-PG-SWITCH-01`，只证明当前executor生成的`PG_RB_ATOMIC_SWITCH_V1`在单一隔离PostgreSQL 17中的原子切换、事务失败和结果未知只读判定。该case通过后仍不证明dump/Migration/ACL、文件域、Compose、host activation、真实UAT或整体回退就绪，TASK70保持`DOING`并继续失败关闭。

## 6. 动态证据合同切片验收结果

2026-08-21首个仓库切片已通过，TASK70本身仍为`DOING`：

- 新增`uat-promotion-dynamic-validation-policy-v2.json`与失败关闭verifier，固定`ISOLATED_SYNTHETIC_ONLY`、`TEST`、`PARTIAL_ONLY`、唯一case、PG17镜像摘要、单容器限制、精确tmpfs、64MiB宿主磁盘增量上界、资源硬门、对象指纹、零残留和六项明确非声明。
- 证据读取使用`O_NOFOLLOW`、普通文件/单硬链接/大小/权限门和读取前后inode/mtime/ctime复核；版本号与Migration head绑定真实`package.json`及`0046_runtime_lock_privilege_boundary.sql`，资源字段类型、端点、计数和峰值必须交叉一致。
- 晋升审计已把`HANDLERS_IMPLEMENTED_DORMANT`、隔离动态证据、host activation、真实UAT回退及人工UAT分别表达；当前固定为4项阻断（P0=3、P1=1），`PARTIAL_ONLY`回执不能移除任何一项。
- 断网、只读rootfs、受限Node镜像容器中，两份生成器重放、Python24/24、Node动态审计20/20、release29/29及inventory262/238/24通过；动态artifact缺失和`assert-ready`分别稳定返回`TASK70_DYNAMIC_ARTIFACT_NOT_EXECUTED`与`UAT_PROMOTION_EXECUTOR_NOT_READY`。
- 运行前后全局容器、镜像、Volume与四服务集合摘要完全相同；无任务容器、网络、Volume、临时目录或进程残留。available约1.8GiB、Swap 48MiB/1GiB、根盘约10.74GiB、Load1 0.61，四服务稳定且无restart/OOM变化。

## 7. `DV70-PG-SWITCH-01`验收结果

2026-08-21该case在最终source`c793cdd07d2d9b5fedd63055558aed3ac90723cf`、tree`c7453b28db2db46c4bc7483a4176354195131478`上通过，范围仍严格为隔离合成：

1. 最终运行`dv70-f2tu2jie`只使用本机已存在的固定摘要PostgreSQL 17.10镜像；`network=none`、只读rootfs、全部data/socket/tmp为有界tmpfs，无bind、Volume、build或pull。
2. 生产executor生成的`PG_RB_ATOMIC_SWITCH_V1`按原始SQL执行；`EXACT_SUCCESS`、`REPEAT_FAIL_CLOSED`、`PRECONDITION_DRIFT_REJECTED`、`FIRST_RENAME_FAULT_ROLLBACK`和`CALLER_RESULT_DISCARDED_AFTER_EXACT_COMMAND_COMPLETION_READ_ONLY_OBSERVATION`五个场景通过。九项断言覆盖生产SQL摘要、NEW_SEALED、OID保持、重复失败关闭、漂移拒绝、首rename故障事务回滚、调用方丢弃结果后的只读观察、无稳定混合布局及既有运行面/保护卷不变。
3. 最终artifact为`root:root 0400`、单硬链接、359,133 bytes；语义SHA-256`867f3a7c2ee0b1c3ff6dc70bd167d55e76aa55ccf5969a0b6ad2923420272f56`、raw SHA-256`8e7b9c6576fe369f9264445947ece3cc94ac79832871311fa2e59296c3260f91`，独立Node/Git复算PASS。audit SHA-256`a9d2e03132e387dd19cde9f312f9dc05c5202e231742183c5884fe2df75ddd1d`仍为4 blockers、`may_start=false`。
4. 资源证据含37样本/180秒及60秒前检：最低available 1,900,601,344 bytes、最大Swap 6.704%且rolling增长0、根盘最低11,386,380,288 bytes、峰值磁盘增量4,890,624/67,108,864 bytes、Load1最高0.23、restart/OOM增量0。cleanup receipt`68ee1d2002ed0b3c1514c7fb15cc44a38939739d51ffe5e9f428b6ad9350a700`，任务容器/网络/Volume/tmp根/进程均为0。
5. 首次真实运行按设计暴露psql advisory-lock在错误前输出精确`\n`，以`422a26f`修复并补测试；有效旧证据因当前状态断言需改为双状态而主动失效，以`2dcc011`修复。下一次运行又由独立Node门拦截Python `2.0`/Node `2`的顶层及resource双摘要分歧，以`c793cdd`加入递归数值规范化、safe integer拒绝和Python/Node共享golden vector。两份失效artifact均在精确核验身份/摘要后删除重跑，所有失败路径零残留。
6. 适用测试为Python24/24、Node20/20、release29/29、inventory262/238/24、官方凭据扫描1,785文件、生成物重放和diff门。该结果仅为`PASS_PARTIAL / VERIFIED_PARTIAL_ONLY`，明确不证明传输层COMMIT响应丢失、dump/Migration/ACL、文件域、Compose、host activation、真实UAT、人工UAT或生产就绪。
7. 证据提交`526fd4af306441a65090f33c66cfdefc7ecfcf74`在敏感信息检查后从private main `3e30dc36a63461ed7bebe39d0b46fd8742b5dd66`普通fast-forward送达`recovery-private/main`；本条治理提交按同一授权继续普通快进。未force、未推送公开origin，且未扩大任何运行或数据权限。

## 8. `DV70-PG-GUARDED-SWITCH-02`源码切片

只读映射证明“dump/卷恢复”与“生产固定executor在完整Migration/权限状态上的切换与一次性恢复”是两个不同信任边界。为先关闭可由现有固定生产opcode精确复用、且不需要读取任何备份正文的最高风险缺口，D-160将原计划`DV70-PG-RESTORE-02`拆分：当前先执行`DV70-PG-GUARDED-SWITCH-02`；dump和文件Volume恢复继续明确未证明，不能从本case推断。

初始源码、owner ACL、历史source时态、D-163 typed/bounded SQL归一化及D-164 guarded SQL `COALESCE`语法修复均已提交并private同步；最新clean隔离运行继续安全失败关闭，当前D-165 psql失败关闭修复已通过非PG适用验证，真实PG17刷新和正式重跑受根盘硬门阻断：

1. policy v3固定唯一case、46个不可变Migration、9个受管角色、4项membership、完整content report、runtime privilege来源、`PG_RB_GUARDED_SWITCH_V3`生产SQL及V2 policy/artifact逐字节冻结；证据仍只能是`PARTIAL_ONLY`。
2. 生产fixed executor仅在本隔离runner注入完成态observer；默认路径不计算额外stdin摘要、不回调。observer在子进程EOF、退出码和无遗留daemon均确定后，为9次精确生产调用记录argv、固定环境、stdin、timeout/output上界、原始stdout/stderr、退出码、side-effect状态和自摘要；任何回调异常在副作用后转为typed UNKNOWN。
3. 十个场景覆盖精确成功、重复失败关闭、内容/Migration/security漂移、ordinary role拒绝、首rename故障事务回滚、OLD布局一次恢复、恢复attempt unknown不二次重放，以及调用方丢弃已完成结果后NEW_SEALED不重放。证据明确不声称进程终止/新进程恢复或传输层PostgreSQL COMMIT响应丢失。
4. Python与Node独立重建固定executor SQL/argv/env/序列/限制和原始输出；setup/reset/drift SQL也各自绑定精确执行receipt。SQL证据只接受单一mtime=0 canonical gzip member，artifact读取要求稳定root-owned `0400`单硬链接，整件篡改harness会级联重算合法上层摘要再验证语义拒绝。
5. 资源门把monotonic elapsed与wall clock逐样本绑定，漂移不得超过1.5秒；容器创建必须晚于至少60秒前检，总窗口至少180秒。仍只允许一个本机既有固定摘要PG17容器、断网、只读rootfs、全有界tmpfs、无bind/Volume/build/pull。
6. artifact发布使用本次创建inode和精确路径验证；若hardlink后unlink、目录fsync或metadata失败，只删除与该inode匹配的本任务路径并同步目录，保证安全重试且不误删外来文件。
7. 初始源码验收已通过：Python V3 16/16、fixed executor 129/129、Node V3 13/13、受影响合同108/108、release 29/29、inventory 263/239/24及两份Node语法门；两条只读终审均无P0/P1。首次108项组合因全量drop capabilities不能覆盖夹具中的`0440`文件并chown reader GID而产生35个同源EACCES，使用离线临时容器仅补`DAC_OVERRIDE`/`CHOWN`后108/108通过，未修改断言。当前owner ACL修复后的Python V3 16/16、fixed executor 129/129、Node V3 13/13、release 29/29及inventory 263/239/24已通过；受影响合同108项必须在clean source上重新串行确认。
8. 历史V2五个文件的SHA-256保持`888e8da9…6308`、`a62db066…2c3`、`43de9dc9…5b01`、`fe9932e2…c6b8`、`8e7b9c65…f91`。D-165后V3 policy raw/canonical SHA-256分别为`e8c642ec…cdcd`/`30b81e06…0e9`，reconciliation/production normalized SHA-256为`067255c7…339`/`56700c1f…abb`；release inventory/runtime policy分别为`97e599da…51e6`/`1b0637e2…efc8`。
9. 源码提交`d1d8ae8`经1,791文件敏感信息检查后普通快进到`recovery-private/main`。首次动态run`dv70-3tbcp9x1`通过60秒前检并启动隔离PG17.10，但在baseline content capture执行前由`TASK70_V3_PSQL_INPUT_INVALID`失败关闭：producer包装器只允许32MiB输出，而fixed executor内容报告合同固定为64MiB。任务容器/tmp/artifact均为0、`oom_kill`保持0；修复改为直接复用`POSTGRES_CONTENT_REPORT_MAX_BYTES`并测试精确64MiB接受、+1拒绝，必须形成新提交和private fast-forward后重跑。
10. 输出上限修复提交`cb731df`经敏感信息检查后普通快进到`recovery-private/main`。第二次动态run`dv70-aazofvib`通过60秒前检、启动隔离PG17.10并完成baseline物化，但在守卫切换前由`ROLLBACK_FIXED_EXECUTOR_POSTGRES_SECURITY_STATE_INVALID`失败关闭；只读诊断run`dv70-mz485olk`把首个差异固定为`$.object_acl_storage[0].acl_item_count actual=4 expected=5`。两次run均无artifact、任务容器、tmp根或进程残留，未访问UAT/生产或受保护Volume。
11. 根因为fixed executor先撤销owner/`CURRENT_USER`/`pg_database_owner`显式ACL，随后只恢复4个service group，遗漏canonical Node reconciler和状态合同要求的owner ACL。修复在REVOKE后、service grants前恢复database/schema/all tables/all sequences、394个routine和6个standalone type的owner权限，共404条`GRANT ALL PRIVILEGES`；继续禁止executor对cluster-global tablespace执行GRANT/REVOKE。fresh synthetic cluster单独为`pg_default`/`pg_global`物化owner ACL，并由Python/Node相同setup bytes`2538`及SHA-256`919ec372…626`绑定。两条独立只读复核一致确认该边界；当前仍没有V3动态artifact。
12. owner ACL修复提交`d7ce5f6`经1,791文件committed-tree敏感门普通快进到private main。随后clean-source组合首次运行110项得到106/110：四个失败均为当前audit把c793绑定的历史V2 artifact与当前inventory/runtime/fixed-executor源码混验，生成物因此过期；不是ACL或环境失败。D-162使当前audit仅对精确repository artifact SHA使用其14个ancestor Git blobs，固定`/usr/bin/git cat-file blob`、无shell/replace/lazy fetch/prompt、2MiB/5秒/fatal UTF-8门，随后仍由冻结V2 verifier重算SHA-256、Git blob、commit/tree/ancestor；synthetic/tamper fixture继续使用caller bodies。当前audit manifest/能力检查仍读取当前源码。重新生成的audit semantic/raw/Markdown/source-manifest SHA-256分别为`6aa3f2bf…a4a3`/`de3a5b49…57d6`/`53418ec4…2bbb`/`758044cf…fbf2`，仍为4 blockers、`may_start=false`。专项audit20/20、clean-source110/110、V3 13/13、release29/29、inventory263/239/24、audit verify及预期assert-ready阻断通过；两条独立复核P0=0/P1=0，五个V2冻结文件继续逐字节不变。修复提交`63c301f`已在敏感门后普通快进到private main。
13. `63c301f`同步后clean run`dv70-nc3x52ls`通过60秒资源门和隔离PG17启动，在artifact发布前由`TASK70_V3_SQL_NORMALIZATION_INVALID`失败关闭且零残留。诊断证明旧无界64位hex规则把完整448行content report中的长relation/sequence identity误认成139个摘要片段，重复空行摘要又把234条路径展开到约2.9MiB；旧production `058a924…c0a`只来自2行小夹具。D-163按严格report类型保护SQL单双引号content hex，只在exact-one system/candidate/restored槽位归一动态值，用`PATH_SET_<count>_SHA256_<digest>`有界绑定重复路径，并对raw/normalized/gzip/gunzip固定1MiB上界。Python/Node共享向量摘要`9d3eea6b…713b`，完整production golden为`b4e0c24f…a140`；release inventory变更经固定生成器重放audit为semantic/raw/Markdown/source-manifest `072cf6a2…8cbe`/`688179d8…aa7`/`40f807be…dd5a`/`78990c03…d80e`且仍有4 blockers。提交前完整受影响组合110/110、Python18/18、fixed129/129、Node14/14、audit/rollback34/34、release29/29、扩展release76/76、inventory263/239/24及独立终审通过。修复提交`4dbe266`随后完成候选/committed-tree敏感门、private普通快进及clean-source精确110/110。
14. `4dbe266`同步后的首个producer`dv70-9cvw_3r_`在确认精确门清单时于PG创建前主动中止且零残留；正式run`dv70-6kvqa_9c`通过60秒前检并启动单一隔离PG17.10，第二条生产调用后以`SIDE_EFFECT_OUTCOME_UNKNOWN`失败关闭。诊断`dv70-mqr7yjwr`证明首条reconciliation调用rc=0、stderr空、observer PASS；`dv70-q51u17a0`把第二条guarded switch调用rc=3和PostgreSQL `function pg_catalog.coalesce(numeric, integer) does not exist`固定下来。D-164只将四个聚合分片、extension inventory及Migration inventory共六处非法schema-qualified构造改为`coalesce(...)`；内容、Migration、ACL、事务及UNKNOWN/no-replay守卫不变。完整production golden更新为`fd129b85…e39e24`，audit重放为semantic/raw/Markdown/source-manifest `9ee02ef4…f22b`/`f0a8a64c…630d`/`ab4d4197…d1f7`/`ed3974f7…ce80`且仍有4 blockers。提交前Node完整并集195/195、Python V3+fixed147/147、inventory263/239/24、policy PASS、audit verify PASS/BLOCKED及`assert-ready`预期exit 1/错误码拒绝通过；首次组合包装器误期望exit 3后已按源码合同纠正重跑。全部正式/诊断run零artifact与零任务残留。修复提交`28128de0ca03453234f760f5b5b3fa8b0562319c`随后完成1,791文件committed-tree敏感门和private普通快进。
15. `28128de`同步后的clean正式run`dv70-g2g36ygu`通过资源前检并进入PG17.10 guarded-failure场景，但由`TASK70_V3_GUARDED_FAILURE_EXECUTION_INVALID`在artifact发布前拒绝且零残留；诊断`dv70-1bzn9rfk`固定旧调用为rc=0、stdout guard marker、stderr `\quit: extra argument "3" ignored`。D-165确认psql 17的`\quit`不接受状态，将cluster/runtime/state/operator/reconciler/fixed-executor全部生产可达分支改为server-side `RAISE EXCEPTION`+`ON_ERROR_STOP`，事务路径先ROLLBACK再抛错；Node/Python verifier固定rc=3、stdout单换行和精确ERROR stderr，security drift再绑定失败前后状态字节及相等摘要。静态门扫描八类源码后缀禁止带参quit；PG17 integration源码新增缺参、非法target、reconciler/operator强制锁失败及零副作用负测。非PG适用回归Node68/68+35/35、Python19/19+130/130+46/46、audit20/20、inventory263/239/24及直接门通过，五个V2文件与历史Supervisor V1 bundle不变；D-132 cluster catalog源码哈希只按安全修复更新且不改写历史证据。源码提交`e192f1d7bb63bfafcd39d77a3d543d604364c9c6`再次通过1,791文件committed-tree敏感门并由private main从`28128de`普通快进接收，远端回读精确一致。根盘低于10GiB，故真实PG17 refresh/test和正式producer尚未执行；空间门恢复后再串行续跑。最终接受仍必须由成功artifact、Node verifier和整件篡改harness共同证明。

## 9. 当前动态执行验收标准

源码提交并完成敏感信息检查、普通fast-forward推送到`recovery-private/main`后，立即在clean source上串行运行该case；这是source binding的必要条件，不是等待额外业务授权：

1. 运行前后重新执行完整资源、Docker对象、四服务和四保护卷门；不得重复TASK84命令，不得删除镜像、既有容器或Volume。
2. 只允许producer创建并清理一个有精确label/ID的临时PostgreSQL容器和本case临时目录；禁止UAT/生产数据库、真实备份、业务数据、凭据、host activation、Migration部署或现有运行面写入。
3. 最终artifact必须由Node verifier和独立整件篡改harness通过，且对象、服务、V2字节和源提交绑定保持；任何失败先保全事实、只清理经身份核验的本任务资源，再修复源码并独立提交重跑。
4. 即使全部通过，结论仍只能是`DV70-PG-GUARDED-SWITCH-02 VERIFIED PARTIAL`。dump/Volume恢复、完整fixed-handler request/result commit边界、fresh-process恢复、host activation、真实UAT回退、人工UAT和生产授权继续阻断，TASK70不得仅凭本case转`DONE`。
