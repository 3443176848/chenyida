# PostgreSQL 运行权限受控 Operator 手册

> 版本：`postgresql-runtime-privilege-operator-v1`
> 状态：`REPOSITORY AND SYNTHETIC-ISOLATED VERIFIED / NOT INSTALLED / NOT AUTHORIZED / PRODUCTION NO-GO`
> 适用任务：`SELFHOST-OPS-POSTGRES-RUNTIME-PRIVILEGE-56`
> 权威决策：[D-133](../project/DECISIONS.md#d-133-postgresql-运行权限采用独立登录nologin-权限组文件秘密与离线控制面)、[D-134](../project/DECISIONS.md#d-134-postgresql-运行权限变更采用直接消费者凭据全局锁与崩溃可恢复日志)

## 目的与授权边界

本手册说明如何由安装后的 content-addressed Release Supervisor 创建、核对或恢复 PostgreSQL 运行角色与 ACL。它不是当前 UAT/生产执行指令，也不授权安装 Supervisor、创建真实角色/口令、修改 ACL、挂载 Volume、运行 Migration、部署或恢复数据。

实际执行前必须取得项目负责人针对准确环境、bundle、操作、时间窗和回退边界的专项授权。凭据只能由获准运维人员在目标主机以 root-only 文件交付，不得粘贴到聊天、命令行、环境变量、JSON、工单正文或日志。

以下行为一律禁止：

- 直接运行仓库中的 runner、reconciler 或 SQL；
- 绕过 `/usr/local/sbin/chenyida-erp-release-supervisor-v1`；
- 使用浮动镜像、旧 bundle、旧 authorization 或调用者自行声明的运行摘要；
- 在存在 backup fence、未知 intent、quarantine、目标身份漂移或资源停止条件时继续；
- 为了恢复可用性手工猜测 `GRANT`、`ALTER ROLE`、删除 journal 或重用旧口令。

## 固定控制面

| 对象 | 固定位置或合同 | 约束 |
| --- | --- | --- |
| Supervisor launcher | `/usr/local/sbin/chenyida-erp-release-supervisor-v1` | root-owned安装制品；只接受精确bundle摘要和pending authorization |
| Bundle根 | `/usr/local/libexec/chenyida-erp-release-supervisor/bundles/<sha256>` | 内容寻址、逐文件模式和摘要复核 |
| 全局锁 | `/run/lock/chenyida-erp-release-gate-v1.lock` | 发布、备份和权限operator共享；整个准备、授权消费、事务、核验和回执期间持有 |
| Authorization | `/var/lib/chenyida-erp/release-authorizations/{pending,consumed}` | v3、root-only、一次性；先持久准备intent，再原子消费 |
| Operator状态 | `/var/lib/chenyida-erp/postgresql-runtime-privilege-operator` | marker、`preparing/active/completed/quarantine/receipts`精确集合；append-only并逐记录fsync |
| Runtime secrets | `/etc/chenyida-erp/runtime-secrets` | 六个直接消费者文件；operator不生成、不汇总、不复制 |
| Backup凭据根 | authorization指定的独立root-only目录 | 必须带`.chenyida-erp-credential-root-v2`，capture口令只来自独立libpq service文件 |
| Backup根 | `/var/backups/chenyida-erp-v2` | 固定目标；`.backup-fence-v2.json`与active operator intent互斥 |

仓库policy本身固定`deployment_authorized=false`。只有同一bundle的受信launcher验证一次性authorization后，操作才可能进入实际控制路径。

## 直接消费者凭据

Operator不拥有“总口令文件”或provisioner。它读取并验证真实消费者将要使用的七个值，五个数据库LOGIN口令在一个 PostgreSQL 事务内设置：

| 消费者 | 文件或来源 | 数据库角色用途 |
| --- | --- | --- |
| Admin数据库工具 | `admin-database-password` | `chenyida_erp_admin` |
| Admin应用首次口令 | `admin-password` | 非数据库角色；只参与七值不复用检查 |
| Migration | `migration-database-password` | `chenyida_erp_owner` |
| PostgreSQL bootstrap | `postgres-bootstrap-password` | 非受管运行角色；只参与七值不复用检查 |
| Web | `web-database-password` | `chenyida_erp_web` |
| Worker | `worker-database-password` | `chenyida_erp_worker` |
| Backup capture | 独立libpq service中的`password=` | `chenyida_erp_backup` |

七个值都必须是无padding的规范base64url，精确43字节并解码为32字节，至少16个不同字符，且两两不同。runtime文件和backup service的root、owner、mode、link count、no-follow、打开前后inode/metadata以及替换都由既有secret policy和operator再次核对。公开intent、journal和receipt只绑定路径与稳定metadata的非秘密identity，不保存口令摘要、SCRAM verifier或完整服务文件摘要。

Backup service只接受一个固定section以及`host/dbname/user/password`和受限的`port/connect_timeout/sslmode`字段；重复、未知、外部`passfile`、错误用户或错误数据库均失败关闭。解析失败后已分配的口令buffer立即清零。

## 三种操作

| Supervisor操作 | 语义 | 运行守卫 | 适用时点 |
| --- | --- | --- | --- |
| `BOOTSTRAP_POSTGRESQL_RUNTIME_PRIVILEGES` | 创建缺失的9角色并精确收敛owner、membership、ACL、default privileges和五LOGIN口令 | `PRE_DEPLOY_POSTGRESQL_BOOTSTRAP_BOUND` | 服务切换前；目标PostgreSQL容器和数据库身份已固定，但新Web/Worker尚未作为current runtime |
| `RECONCILE_POSTGRESQL_RUNTIME_PRIVILEGES` | 对已存在角色精确收敛结构并无条件重置、核验五LOGIN口令 | `POST_DEPLOY_CURRENT_RUNTIME_STRICT` | 严格postdeploy runtime probe已发布且与同一manifest/configuration完全匹配 |
| `RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT` | 对一次已消费authorization、但未完成公开回执的精确原操作作恢复判断和续跑 | 与原`BOOTSTRAP`或`RECONCILE`一致 | 只在active/preparing证据要求恢复时；不能作为新变更入口 |

`BOOTSTRAP`不伪造postdeploy四服务回执，而是由固定目标、manifest和`runtime_configuration_sha256`生成确定性的predeploy binding。`RECONCILE`必须消费同一bundle验证过的`POST_DEPLOY_CURRENT_RUNTIME_STRICT` probe receipt。结构已经完全一致的`RECONCILE`仍会在一个事务内重置全部五个LOGIN口令并逐一执行正确/错误口令探针；它不是跳过凭据轮换的no-op。

## Authorization字段边界

实际文件必须使用`chenyida-erp-release-supervisor-authorization/v3`，放入pending根，owner/mode/单硬链接/规范JSON和有效期由launcher核对。基础参数精确包括：

- deployment：`deployment_class`、固定`deployment_id=chenyida-erp`、`compose_project_root`；
- PostgreSQL目标：精确container name/ID、database、OID、system identifier和`chenyida-erp-deployment/v2:<class>:chenyida-erp` marker；
- release：manifest路径/摘要、runtime policy摘要和`runtime_configuration_sha256`；
- credentials：generation ID、backup credential root、capture service文件和section；
- interlock：固定backup root和与操作一致的runtime guard mode。

`RECONCILE`还必须精确绑定runtime probe receipt路径/摘要。`RECOVER`还必须绑定原operation、原operation ID、原authorization摘要和active intent摘要。字段缺失、额外、错路径、错摘要、错container、错数据库、错marker或guard错代次都在任何数据库mutation前失败。

Authorization正文不得包含密码、DSN、token、service正文或环境变量转储。生成与审阅authorization必须按[投产专项授权执行包](production-authorization-packet.md)执行；本文不提供可直接消费的授权样例。

## 执行前检查

每次操作都必须逐项记录事实，任何一项不满足即停止：

1. 专项授权明确到环境、operation、bundle SHA、authorization ID、窗口、负责人和回退边界；上游授权不自动覆盖本操作。
2. Git source/tree、canonical bundle、release manifest、镜像、Migration head和runtime policy属于同一获准候选；旧TASK51、TASK55和TASK56中间bundle不可复用。
3. installed Supervisor的bundle逐文件验证通过；pending/consumed、operator state、runtime probe、release artifact和backup根的marker、owner和mode精确。
4. 目标container name/ID、PostgreSQL 17版本、database/OID/system identifier/marker与authorization一致；不读取业务行、日志或容器环境证明这些事实。
5. 七个直接消费者凭据已经由受控root流程写入各自最终位置；文件间inode和值均不复用，backup凭据根与runtime secret根物理分离。
6. 全局锁没有竞争者，operator没有未知`preparing/active/quarantine`证据，backup fence不存在；若存在，只能进入精确`RECOVER`或人工隔离判断。
7. `free -h`、`df -h /`、`uptime`、`docker stats --no-stream`、四服务状态和宿主OOM/restart计数低于项目停止线。一次只执行一个operator、测试、build、Migration、备份或恢复任务。
8. 对`RECONCILE`，严格postdeploy probe receipt仍新鲜并绑定同一container/runtime configuration；对`BOOTSTRAP`，现有服务切换尚未开始且旧运行面保持可回退。

## 唯一执行入口

在完成专项授权和上述检查后，只允许root以精确绝对路径执行：

```text
/usr/local/sbin/chenyida-erp-release-supervisor-v1 \
  --bundle-sha256 <reviewed-64-hex-bundle-sha256> \
  --authorization-file /var/lib/chenyida-erp/release-authorizations/pending/<reviewed-authorization>.json
```

不要把命令包装到会记录参数、环境或标准输入的通用调试器。launcher先取得全局锁和验证bundle/secret/target，runner再fsync `PREPARED` intent；只有准备成功后authorization才从pending原子移动到consumed。数据库变更与五个口令在单一事务内完成，口令只经受控Node进程内buffer和`psql` stdin传递；服务端语句/时长日志在事务内关闭，buffer使用后清零。

成功stdout只允许规范去敏JSON：`VERIFIED`、operation ID、intent摘要和receipt摘要。stderr必须为空。任何非零退出、额外输出或非规范响应都视为失败；不得重复投递同一authorization猜测结果。

## 崩溃恢复与隔离

状态链固定为：

```text
PREPARED
  -> AUTHORIZATION_CONSUMED
  -> TRANSACTION_DISPATCHED
  -> POSTCOMMIT_CAPTURED
  -> VERIFIED
  -> COMMITTED
```

每条记录和父目录都fsync，pending写入采用内容寻址名称；中断的准备文件只能在稳定operation identity完全匹配时重建。receipt与postcommit capture的双写中断可根据已持久的同内容记录补齐，不覆盖冲突文件。

原进程非零、断连、被SIGKILL或响应不确定后：

1. 停止发布、备份、Migration、部署和下一次权限操作；不要删除state文件或手工改库。
2. 只读核对全局锁已释放、backup fence、`preparing/active/quarantine`集合以及原authorization是否已进入consumed；不读取journal以外的秘密或业务数据。
3. 使用新的一次性`RECOVER_POSTGRESQL_RUNTIME_PRIVILEGE_INTENT` authorization，精确绑定原operation ID、原authorization SHA和active intent SHA。
4. Supervisor可能决定`RESUME_AUTHORIZATION`、`DISPATCH_TRANSACTION`、`RETRY_TRANSACTION`、`CAPTURE_AND_VERIFY`、`FINISH_PUBLICATION`、`ARCHIVE_COMMITTED`或`QUARANTINE`；操作员不得自行替换决定。
5. `QUARANTINED`、backup fence并存、结构不等价、凭据证据不匹配或第三种数据库状态都保持NO-GO，交由新审阅和专项授权处理。

恢复允许在原精确release artifact过期后读取它来解释已经发生的操作，但仍要求artifact内容和来源满足原始资格；过期不是换用新bundle、新policy或新凭据继续旧intent的理由。

## 验收、停止与回退

一次操作只有同时满足下列证据才算成功：

- 去敏结果为`VERIFIED`，journal归档到`completed`且全局receipt与最终state摘要一致；
- 目标结构独立重捕获后与v2 policy exact-set一致，没有未知角色、membership、LOGIN直授、grant option、对象/列/参数ACL、危险setting、large object或tablespace漂移；
- 五个正确口令分别能以预期`session_user=current_user`连接，五个错误口令全部失败；
- Web、Worker、Admin、Backup和Migration的允许/拒绝canary通过，应用身份不能DDL、SET ROLE owner或取得危险能力；
- release/backup interlock恢复为无active intent，四服务、资源、restart和OOM未退化；
- 回执、测试和运行记录不含口令、SCRAM verifier、DSN、service正文或敏感路径正文。

`BOOTSTRAP`失败且事务未提交时，旧运行服务与数据应保持不变；不得为了“完成切换”继续部署。事务可能已经提交但回执未完成时必须走`RECOVER`，不能反向猜写ACL。`RECONCILE`失败也先恢复精确intent；只有事前批准的旧候选、旧消费者凭据和ACL快照均可验证时，才可另行提出回退授权。任何持久数据、角色、ACL、secret、Volume、服务或部署回退都不由本手册自动授权。

## 当前仓库证据与剩余阻断

仓库实现已在固定PostgreSQL 17隔离环境完成真实system adapter演练：应用46个Migration，以真实事务写入角色/ACL/五口令，在事务成功后立即SIGKILL执行进程，再从durable journal执行`CAPTURE_AND_VERIFY`，随后用结构no-op `RECONCILE`重置并核验五口令。外层扫描确认七个精确测试口令和完整SCRAM verifier未进入stdout/stderr或PostgreSQL日志；临时container和目录已清理。

该证据只证明代码和恢复路径，不证明当前UAT已加固。当前仍未安装本bundle、创建真实consumer files、改变真实角色/ACL或取得实际执行授权；UAT继续使用共享superuser和环境变量秘密。实际激活、运行复核、真实异机恢复、源码匹配候选、员工试用和正式切换完成前，系统保持`PRODUCTION NO-GO`。
