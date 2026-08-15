# SELFHOST-UAT-CROSS-ROLE-TRANSACTION-77 UAT晋升跨岗验收checkpoint 12事务化

> 状态：`DONE / REPOSITORY CROSS-ROLE CHECKPOINT 12 TRANSACTION VERIFIED / HUMAN EXECUTION NOT PERFORMED / RESOURCE STOP LINE ACTIVE / PRODUCTION NO-GO`
> 日期：2026-08-15（Asia/Shanghai）
> 严格代码起点：`main@694f485cad3a6e9fbdc499c10cc801f0de77cafe` / tree `45007b67fb606bd423043d769efefd12acc67ab7`
> 责任：Codex主智能体唯一写入、轻量测试串行、证据集成和Git提交；项目负责人及业务负责人保留真实账号、员工、UAT业务写、数据库、凭据、host和生产专项授权

## 1. 背景与目标

TASK76/D-151已把checkpoint 10/11接入独立授权、不可变journal、发布前control binding和保全恢复。promotion仍停在`IN_PROGRESS`，因为checkpoint 12必须证明经批准的真实岗位、范围、窗口、逐步请求/数据库增量/冲销证据及三方签字；TASK67只定义合成合同，不能冒充员工已执行。

本任务只实现checkpoint 12的Supervisor事务适配器、内容寻址证据摄取、严格验证、恢复与拒绝门，并用fake-root合成证据验证。不得创建员工账号、访问真实UAT/数据库、执行业务写、伪造签字、发布checkpoint 13 final receipt或运行rollback。

## 2. 验收标准

- [x] 完整核对TASK67跨岗合同、TASK66授权矩阵、checkpoint 11回执、promotion journal、真实员工执行边界及最终回执依赖，记录不可复用和需扩展边界。
- [x] checkpoint 12使用独立短时一次性Supervisor授权；验收intent先于消费落盘，并绑定同一promotion、checkpoint 11 current/receipt、全部authorization摘要链、candidate/runtime/database/deployment/postdeploy身份和三方actor。
- [x] 只接受内容寻址、root-owned、单硬链接、无symlink、未过期的外部cross-role result；结果绑定已批准的账号映射、岗位矩阵、测试范围、窗口、执行人/观察人/业务批准人，以及TASK67的4链/32步骤/6冲销分支。受信内部副本落盘后，恢复不再依赖可清理的外部staging。
- [x] 每一步具备去敏request ID、预期/实际状态、数据库增量摘要、审计摘要、拒绝/幂等/CAS/零半记录证据；有冲销要求的步骤证明追加式反向记录，不得原地改写。
- [x] 三方签字由不同actor形成非空不可变证据；每份签字绑定排除签字自身的精确全局`evidence_subject_sha256`，最终`result_sha256`再封装全部签字与workflow摘要并由checkpoint 12发布。synthetic、空白、占位、过期、跨窗口、角色冲突、缺步骤或缺冲销证据均不得发布。
- [x] journal按history→receipt→current无覆盖发布checkpoint 12并保持`IN_PROGRESS`；没有越过checkpoint 13 final receipt，实际人工UAT未执行时机器审计继续`BLOCKED`。
- [x] 未消费、已消费未执行、result已落盘但journal未发布、source替换、binding漂移和四个发布崩溃点均有确定恢复或quarantine；未知结果不重跑员工业务动作或伪造成功。
- [x] fake-root/断网测试覆盖正向合成fixture、授权重放、身份/步骤/签字/窗口/数据库增量漂移、partial发布、恢复和quarantine；promotion、cross-role、audit、launcher、installer及inventory适用回归通过。
- [x] 更新MASTER、TASKS、CHANGELOG、STATUS、DECISIONS、当前任务文档和授权包，完成资源、敏感信息和diff检查，形成独立source→manifest提交链并自动进入下一未阻塞任务。

## 3. 禁止事项

- 不创建或修改账号、岗位、权限、会话、凭据；不访问真实UAT/生产、数据库、日志、env、Volume、备份或业务数据。
- 不执行真实员工业务流程，不采集个人信息，不把合成fixture、operator声明或空签字描述为人工验收。
- 不运行Docker/Compose、build、Migration、backup/restore、部署、final receipt、rollback或正式切换；不修改Swap、systemd、网络、防火墙或Docker daemon。

## 4. 起点与资源判定

- TASK76当前source`8c7d51c`→binding fix`2309927`→Supervisor`694f485`形成134文件bundle`ccb0e462…f03d`；checkpoint 10/11仓库事务闭合，机器审计仍为11项SUPPORTED、4项阻断。
- checkpoint 12真实执行依赖业务负责人确认账号映射、范围、窗口、职责分离、冲销责任和三方签字；这些外部输入未提供，因此本任务只关闭可安全实现的adapter，不声称actual UAT完成。
- available约1.9GiB、Swap889MiB/1GiB、根盘约13GiB，Swap超过80%。只允许运行仓库静态、Python和受限Node轻量验证；TASK70继续`BLOCKED / RESOURCE STOP LINE + EXECUTOR DEPENDENCIES`。

## 5. 实施结果

- 新增`chenyida-erp-uat-promotion-cross-role-result/v1`严格结果合同。4条workflow共32步骤、32控制和6条追加式冲销证据全部采用精确字段、模板摘要、请求/响应/数据库/audit/幂等结构验证；批准ID中的placeholder/test占位串、账号或人员复用、职责冲突、步骤重叠、状态/增量/控制漂移均失败关闭。
- 采用双层摘要解决签字循环：`evidence_subject_sha256`是全部执行证据完成后的精确预签名主题；所有执行人、观察人和业务验收人只能在全局`execution_completed_at`之后签该主题；`result_sha256`再封装签字、workflow摘要及完成时间。checkpoint 12发布最终result摘要，二者不得混用。
- 新增独立`VERIFY_UAT_CROSS_ROLE_EXECUTION`一次性Supervisor入口、精确bundle/result/checkpoint 11/source/actor验证、授权消费前intent和全局pending-intent联锁。任何未完成cross-role intent只允许其精确原操作或精确恢复继续。
- journal以内部只读result→history→receipt→current顺序发布ordinal 12，保持`IN_PROGRESS`。四个failpoint均可恢复；内部result一旦持久化，外部staging被删除、替换或证据窗口过期仍只续写journal，内部副本不存在时才重新验证外部源。
- 回滚审计把checkpoint 12标为仓库`SUPPORTED`，并持续审计Supervisor全局联锁、内部result恢复和双摘要合同。审计仍为`BLOCKED`，只剩checkpoint 13与rollback 14/15三个P0技术阻断；人工UAT状态仍为`HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED`。

## 6. 证据与提交链

- feature source：`018586d8e2ecf36bbe773f8bb7e1e8754c9f620b` / tree `e7da71065ab1effdded1fbf74b5a72a27d68b25e`。
- manifest-only直接子提交：`2798862ebdd7df85748a0a69d6b3ddeea765d808` / tree `2c74e6b0e110d28e345588c79060d8ff29ab9c1e`。
- 138文件Supervisor manifest raw SHA-256：`d5398d78854fcec0d9a8339a7eb4be7a0e5d722904e530b5afed0a55d1cb2ce2`；source commit/tree、文件集合、mode、bytes和逐文件SHA均确定性重放。
- promotion policy raw/semantic SHA-256：`a78d551ffe8496d31ef3cfb6c961c464748ec0b6badf733951bf57194a4b2bae` / `5ade8772ad9dd4961c128c8eca1bdeec7b4909f79a5b275b6be14ab4961caf37`。
- cross-role静态合同artifact SHA-256：`66794339f406878a35884e045a4f44ad486f8d31ec82952ac1c2786b0356689f`；promotion rollback audit artifact SHA-256：`253db855373342fe86b245aad11a17a6423957cb42c70ddf2fc2809429e2eb3f`。
- release inventory raw SHA-256：`2d5e16e8ca5dac4b960179caa40900e8e60f9138d6482b15ca79d1bf2753ba22`，共259项、235 REQUIRED、24 NOT_APPLICABLE；runtime policy raw SHA-256为`a119aec661b3322742d3f9d3c0a55c934a3f74b38863d9e24170d4c504b82655`。

## 7. 验证结果

- Node合同组合62/62通过：结果合同14、静态跨岗合同9、回滚审计10，以及release gate/manifest 29。
- journal cross-role事务4/4通过，覆盖正向、授权分离、root/link/source替换和四个崩溃点；其中内部result落盘后的external remove/replace/expiry恢复已回归。
- Python `test_release_supervisor_uat_promotion` 29/29通过；launcher/installer 31/31通过；manifest拓扑/逐字节/容量定向4/4通过。
- generator verify、inventory 259/235/24、3个Python AST、6个JSON parse、Node syntax、`git diff --check`和已暂存敏感模式扫描通过。未跳过或降低断言。

## 8. 资源、安全和未验证范围

- 收口快照：available约1.9GiB，Swap887MiB/1GiB（仍超过80%停止线），根盘可用约13GiB，Load`0.08/0.21/0.21`；宿主`oom_kill=2`与起点相同。四个UAT容器均running、restart 0、OOM false；未读取env、日志、业务行、备份或Volume正文。
- 未运行Docker build、Compose、全量测试、typecheck、PostgreSQL、Migration、backup/restore、镜像、部署、业务写、真实UAT或回滚。无Schema/Migration/API业务行为变化；仅扩展仓库Supervisor、证据合同、promotion journal及机器审计。
- 真实员工账号映射、岗位批准、测试窗口、三方签字与员工执行仍未提供；本任务的合成fixture不能冒充人工验收。系统仍不可投入使用。

## 9. 后续

自动启动`SELFHOST-UAT-PROMOTION-FINAL-RECEIPT-78`，以独立授权和单调终态回执关闭checkpoint 13；TASK70继续等待Swap停止线解除及完整rollback执行器。之后仍须实现rollback 14/15、隔离动态演练和全部外部授权/真实验证。
