# 新建隔离UAT L1只读就绪报告

> 结论：`L1 READ-ONLY COMPLETE / SOURCE READY / SAME-HOST L2 NO-GO / NEW UAT NOT CREATED / PRODUCTION NO-GO`
> 核对时间：2026-08-24 01:47—01:55 CST
> 授权：项目负责人明确选择“新建隔离UAT”，并授权L1只读核对

> TASK92后续：BuildKit-only清理已将根盘available恢复到`17,909,628,928` bytes（约16.68 GiB），磁盘停止线阻断已解除；固定宿主控制root和精确镜像阻断仍在，因此总体L2 NO-GO不变。详见[TASK92](../../tasks/SELFHOST-SMALL-TEAM-UAT-ISOLATION-PREREQUISITES-92.md)。

## 1. 直接结论

当前alpha.47/0046源码和空库迁移基线可以作为新UAT的输入，但现在还不能开始试运行，也不能在本机直接启动第二套正式UAT栈。

阻断不是人数或业务容量，而是三个可验证事实：

1. 本机唯一带alpha.47运行标签的Web/Worker镜像绑定旧提交`78d96c6198ab4b7255572186ea580c463b5eeba3`；其后运行代码、Dockerfile和发布合同已改变，当前HEAD没有匹配镜像。
2. Compose项目名能隔离网络和命名Volume，但运行secret、release candidate、release identity、权限operator状态及全局锁使用固定宿主机路径；同机只改项目名不构成完整隔离。
3. TASK91收口时根盘可用`10,782,752,768` bytes，只高于10 GiB硬停止线约43.23 MiB；TASK92后续已清空未使用BuildKit cache并恢复约16.68 GiB可用空间。后续重任务仍须重新通过新鲜资源门。

因此：L1核对通过；L2创建、build、Migration、部署、账号和业务写仍为`NO-GO / NOT AUTHORIZED`。

## 2. 本轮实际核对与未执行事项

已只读核对：

- 根仓库HEAD、`package.json`版本、46个Migration、0046 snapshot/journal和0041—0046摘要。
- `compose.yml`、`compose.release.yml`、非敏感`.env.example`、Dockerfile、运行健康合同和数据库运行身份合同。
- Docker版本、Compose渲染、容器/镜像/网络/Volume名称级metadata、端口、资源和OOM/restart状态。
- 当前UAT仅作容器身份与挂载metadata参照；没有连接其数据库，也没有读取业务行、环境变量值、凭据、日志正文、备份正文或Volume内容。

没有执行：

- 没有创建容器、网络、Volume、数据库、账号、secret、备份或发布材料。
- 没有build、pull、push、deploy、restart、Migration、恢复、清理、业务API或外部消息。
- 没有访问生产、真实业务数据或项目负责人保留的未跟踪状态报告。

## 3. 候选源码与Migration差异

| 项目 | 只读事实 | UAT含义 |
| --- | --- | --- |
| 源码 | 当前HEAD基于`0.1.0-alpha.47` | 下一镜像必须从批准后的精确HEAD重新构建并绑定OCI revision，不能只按版本号复用旧镜像 |
| Migration | `0001`—`0046`共46项，journal顺序一致 | 新UAT应从`EMPTY`顺序应用到`0046_runtime_lock_privilege_boundary.sql`，不复制或升级现有UAT数据库 |
| Snapshot | 0046 snapshot为233张public表；SHA-256 `c8fe259a7838475bc41ffaf0e843ba9ca69a8ca0c5688d42275a81ea8b21f60d` | 与当前Schema基线一致；本轮未运行数据库动态Migration |
| 0041 | 新增AI建议Run/Suggestion/Item/Evidence/Event五表和不可变约束 | 小团队UAT不启用AI；已发布Migration保留但功能保持冻结 |
| 0042 | 新增物料导入upload operation，并扩展文件摘要、大小、类型、安全、幂等、恢复和job关联 | 新空库无历史回填冲突；以后导入虚构文件仍受10 MiB及格式/摘要门限制 |
| 0043 | 收紧导入终态、失败字段、operation/batch绑定，并把幂等响应上界调整为1 MiB | 只修正0042完整性；不得只应用0042而跳过0043 |
| 0044 | Session增加24小时绝对寿命、回填和身份不可变guard | 新空库没有旧Session；员工UAT登录仍会受绝对寿命约束 |
| 0045 | 新增唯一Worker运行租约及版本、提交、Migration身份 | Web health要求同身份Worker持有新鲜租约，不能只启动Web和PostgreSQL |
| 0046 | 新增16个窄锁函数，并固定20个locking trigger的owner安全路径和无PUBLIC EXECUTE | 需要正确的runtime角色/ACL bootstrap与reconcile；共享superuser不是当前源码的合格运行方式 |

0041—0046 SQL SHA-256依次为：

- `676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`
- `c0eeab63bc51f1d1dd96805b43e78c83c5ef5e0a5d5712a08a0308c95b9385bf`
- `0fdb3d4b92d999a5dede5a36a08bd99ea054879ebb6857341e08f0f0e07852d9`
- `a24df94474403c4f235933d4450626ce65b40416264393db400cef08e7fcaa7e`
- `cc4685a08d97d49717e3c65c069131be17e9fc1cddd52b429ef64202c40180fc`
- `ad68aaa4f20d16324fcdc7b234928ac363ecb73313921970d3b4840f4db6d66b`

## 4. 隔离边界

以候选项目名`chenyida-erp-uat-synthetic`做无副作用Compose渲染时，基础服务为PostgreSQL、一次性Migrate、Web和Worker；`tools`与`production`分别控制Admin和Caddy。项目名覆盖生效，网络和基础命名Volume会变为独立前缀：

- `chenyida-erp-uat-synthetic_backend`、`chenyida-erp-uat-synthetic_edge`
- `chenyida-erp-uat-synthetic_erp_postgres`
- `chenyida-erp-uat-synthetic_erp_postgres_tablespaces`
- `chenyida-erp-uat-synthetic_erp_uploads`
- `chenyida-erp-uat-synthetic_erp_attachments`
- `chenyida-erp-uat-synthetic_erp_backup_status`

名称只是本次方案占位，执行前可以由负责人另定；它不是产品硬编码或用户数限制。Web端口可独立绑定loopback；本轮用于渲染的`127.0.0.1:33001`当时无监听，现有UAT使用`127.0.0.1:3000`和公开`18888`。端口未被预留，执行前必须重新核对。

以下宿主机边界不会随Compose项目名变化：

- `/etc/chenyida-erp/runtime-secrets`
- `/var/lib/chenyida-erp/release-candidate`
- `/var/lib/chenyida-erp/release-identity`
- `/var/lib/chenyida-erp/postgresql-runtime-privilege-operator`
- `/run/lock/chenyida-erp-release-gate-v1.lock`
- `/var/backups/chenyida-erp-v2`

仓库没有独立UAT Compose override；现有secret policy和权限operator还强制固定root。因此同机方案至少要先完成受审阅的宿主根隔离设计和合同验证，不能只运行`docker compose --project-name ... up`。

## 5. 最小恢复方式

首轮只允许完全虚构数据，因此推荐把新UAT定义为`DISPOSABLE_SYNTHETIC / RECREATE_FROM_EMPTY`：

1. 不复制现有UAT或生产数据库、uploads、attachments和备份。
2. 失败时停止并保留证据，随后在新的明确删除授权下只处置该UAT的精确项目、网络和Volume。
3. 使用同一已批准源码、镜像digest和46项Migration重新建立空环境，再重放虚构样本。
4. 员工核对结果保存到UAT清单/签字证据，不把一次性数据库当作唯一验收记录。

这足以支持合成业务流程回退，但不等于备份恢复通过。Dashboard不得伪造`RECOVERY_READY`；一旦进入真实样本或生产，必须另做可恢复快照、异机恢复和RTO/RPO验证。

## 6. 推荐执行路径

第一性原则下，优先推荐独立UAT主机/VM，而不是在当前主机继续叠加控制路径：

- 独立主机使固定secret、release identity、operator状态、Docker网络/Volume和资源成为天然独占边界，不需要为不到20人的系统再建设一套同机多租户控制平面。
- 目标仍按2核、约4 GiB内存、1 GiB Swap的低资源规则执行；磁盘必须在每个重任务前保留10 GiB硬线，并按实际构建上界留余量。`20 GiB available`只可作为保守采购/准备参考，不是产品容量限制。
- 当前主机同机方案仅作为备选；TASK92已完成精确BuildKit清理并通过资源门，但仍必须另获“隔离配置改造”授权并完成固定宿主root的失败关闭合同。

## 7. 后续授权包

下一步先做TASK92前置，不直接部署：

### 路径A：独立主机（推荐）

负责人提供或指定独立UAT主机，并授权该主机的L1 metadata核对。核对范围只包括CPU/内存/Swap/磁盘、Docker/Compose版本、端口、空目标状态和固定root是否未占用；不读取其他系统数据。

### 路径B：当前主机同机隔离

负责人明确接受同故障域，并另行授权：

1. 只实现/验证独立宿主root与Compose override，不创建运行资源。
2. TASK92 BuildKit-only清理证据保持有效；任何后续清理必须重新列出精确对象、保护清单和授权，不得删除镜像、容器或Volume。

路径确定并解除资源/隔离阻断后，才可申请L2a：串行构建精确Web/Worker镜像、创建空PostgreSQL和独立文件卷、生成独立secret、bootstrap运行角色、以`EMPTY → 0046`迁移、reconcile ACL、启动Worker/Web并验证loopback health。账号创建、公开HTTPS、虚构业务写、真实样本和生产仍需分别授权。

## 8. 仍待业务输入

- D-171的`SO_REQUIRED / PRE_SALES_EXCEPTION`仍待负责人确认；它不阻止空环境准备，但会阻止对应UAT业务步骤通过。
- 员工实名名单和兼岗关系尚未提供；每职能约2人只作排班估算，不进入账号数、权限、并发或验收硬条件。
- 当前没有真实样本；L3只应使用`CYD-UAT-SYN-001`虚构样本。

## 9. 资源与完整性记录

| 检查 | 起点 01:49 CST | 收口 01:55 CST |
| --- | --- | --- |
| MemAvailable | `2,557,411,328` bytes | `2,545,897,472` bytes |
| Swap used | `179,957,760` bytes | `179,957,760` bytes |
| 根盘available | `10,791,727,104` bytes | `10,782,752,768` bytes |
| 10 GiB硬线余量 | `54,308,864` bytes / 51.79 MiB | `45,334,528` bytes / 43.23 MiB |
| Load | `0.15/0.14/0.11` | `0.18/0.15/0.12` |
| Memory PSI / kernel OOM | 全0 / 0 | 全0 / 0 |
| 常驻ERP | 4个服务；Web/PostgreSQL healthy | 身份不变；4个服务restart 0/OOM false |
| Docker对象 | 6容器、75镜像、277 Volume、174 Build Cache | 数量不变；TASK91容器/网络/Volume/共享内存残留0 |

Build Cache为10.31 GB，其中5.674 GB显示为reclaimable；镜像显示13.81 GB reclaimable。`reclaimable`不等于删除授权，本轮没有清理任何对象。

以上表格是TASK91 L1时点证据。TASK92随后在专项授权下只清理未使用BuildKit cache：Cache由174项降为0，根盘最终available为`17,909,628,928` bytes，容器/镜像/Volume/网络摘要及四服务、四个受保护Volume保持不变。
