# SELFHOST-OPS-CANONICAL-SCHEMA-RECONCILIATION-12 完成报告

## 结论

`CANONICAL VALIDATOR FIXED — FILE UNCHANGED`

- 根因唯一归类为 **A：验证器 / Schema 落后于权威 Canonical 当前状态写入语义**。
- `chenyida-erp-uat-credentials-v2` 的旧恢复验证器把“离线恢复完成时十个 UAT 账号必须首次改密”的初始状态，错误建模成了 Canonical 文件生命周期内永久不变的 `const: true`。
- 正式文件是有效 JSON，十个账号的数量、顺序、用户名、角色、密码策略、密码唯一性、字段集合、run-id 与顶层格式均通过；旧验证器只对三个已经完成首次改密的非秘密状态字段产生误报。
- 修复只区分“长期 Canonical v2 Schema”和“离线恢复初始状态强门禁”：Canonical 仍要求严格 boolean；恢复写入、Stage、提升和最终化仍要求十个 UAT 初始状态全部为 `true`。密码策略、账号唯一性、固定角色、固定顺序、字段完整性和恢复事务门禁均未降低。
- 正式 `/etc/chenyida-erp/uat-role-accounts.txt` 全程只读且字节未变；未创建候选、旧副本或普通明文副本，没有身份或业务变化。

## 严格起点

| 项目 | 结果 |
| --- | --- |
| Git | `main@2f2a62b81622afd708538da5f9cfd9afc835dda6`；Parent `1e9221d90db621becc2badf40b3e0ed3017b73e6`；`origin/main...HEAD` behind 0 / ahead 134；tracked clean |
| 版本 / Migration | `0.1.0-alpha.39`；`0001`—`0038` 共 38 个迁移；0038 为 `0038_supplier_mapping_governance.sql` |
| 0038 checksum | `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`，与 Supplier Mapping 完成报告全文一致 |
| Web | `sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`，与 Supplier Mapping 完成报告一致 |
| 服务 | PostgreSQL/Web healthy；Worker/Caddy running；起点四服务 RestartCount 0、OOM false |
| 资源 | 起点 available memory 约 2.2 GiB、Swap 258 MiB、根盘可用 20 GiB、Load `0.01/0.23/0.28`；内核任务时段 OOM 0 |
| Canonical 元数据 | 单硬链接普通文件，`root:root 0600`；size 1,944 bytes、inode 193179676、mtime `2026-08-03 09:27:59 +0800`；起点无隐藏候选 |

## 脱敏诊断与根因分类

修复前的受守卫诊断只输出下列非秘密错误；不输出 Canonical 正文、密码、密码长度、密码策略细节、注释、摘要、Token、Cookie 或完整账号对象：

| JSON Pointer | Schema 关键字 | 预期类型 | 实际类型 | 账号 / 角色 |
| --- | --- | --- | --- | --- |
| `/accounts/2/must_change_password` | `const` | `boolean` | `boolean` | `uat_20260729_engineering` / `engineering` |
| `/accounts/3/must_change_password` | `const` | `boolean` | `boolean` | `uat_20260729_planning` / `planning` |
| `/accounts/4/must_change_password` | `const` | `boolean` | `boolean` | `uat_20260729_purchase` / `purchase` |

错误总数为 3、账号数为 10，没有 `required`、`type`、`enum`、`additionalProperties`、`minItems/maxItems`、`uniqueItems`、密码策略、顶层版本或 JSON 解析错误。后续受控 UAT 完成报告已分别证明 engineering、planning、purchase 的 Canonical 当前凭据和账号状态一致；后续只读 runner 也把这三个角色的 `must_change_password=false` 作为当前正式状态，而 operations 继续保持 `true`。因此这不是账号值异常（C），也不是来源不明或需猜测的文件漂移（D），唯一分类为 A。

## Schema、解析器、验证器与写入器

| 组件 | 版本 / 行为 |
| --- | --- |
| Canonical Schema | `chenyida-erp-uat-credentials-v2`；`must_change_password` 为必需且严格的 boolean，其他约束不变 |
| 解析器 / 验证器 | `offline-identity-recovery-uat-validator-v2.1`；新增受守卫 `--diagnose-schema`，固定正式/演练路径、root-only 文件句柄读取、`O_NOFOLLOW`、大小上限和脱敏结构化输出；该模式在创建 PostgreSQL Pool 前返回 |
| 恢复写入器 | `offline-identity-recovery-credential-writer-v2`；仍用 CSPRNG 写十个初始 `must_change_password=true` 的 UAT 账号，并通过独立 `assertRecoveryCredentialDocuments` 强校验 |
| 恢复 Stage / 提升 / 最终化 | 继续使用恢复初始状态强校验；任何 false 值都以 `RECOVERY_UAT_INITIAL_STATE_INVALID` fail closed，不能借长期 Schema 绕过恢复门禁 |

诊断错误只允许固定 Schema 版本、脱敏 Pointer、关键字、预期/实际类型、受白名单限制的用户名/角色、账号数和错误数。任何密码、秘密、Token、Cookie、摘要、注释类字段名均固定显示为 `<redacted>`；实际字段值从不进入格式化结果。

## 正式文件与语义保持

| 项目 | 结果 |
| --- | --- |
| 正式文件是否改变 | **否**；任务没有以可写方式挂载或打开正式文件，终检 size/inode/mtime/owner/mode/nlink 与起点一致 |
| 密码 | 字节保持；未读取到输出、未修改、未比较长度、未重置 |
| 用户名 / 角色 / 顺序 | 字节保持；十个预期账号仍唯一且顺序、角色明确 |
| must-change / enabled / 注释 / 其他字段 | 字节保持；本任务没有身份、状态或正文写入 |
| 最终 Schema | `SCHEMA_PASS`，账号 10、错误 0 |
| owner / mode | `root:root 0600`，单硬链接普通文件 |
| 候选 | 未创建；正式目录、`/tmp`、`/run` 和任务目录均无本任务 Canonical 候选或副本 |

## 合成测试与安全验证

- 离线身份恢复 unit `9/9`：覆盖缺失字段、错误类型、多余字段、重复用户名、非法角色、密码字段错误、must-change 错误、顶层版本错误、错误 run-id、恶意注释字段和 malformed JSON；全部失败输出不含合成秘密或数据库环境哨兵。
- 明确证明长期 Canonical validator 接受严格 boolean 的当前状态，同时恢复写入/Stage 门禁继续拒绝非初始状态。
- 正式诊断使用断网、只读文件系统、无数据库配置、固定文件只读挂载和输出白名单保护；最终为 `SCHEMA_PASS`。
- `npm test` `3/3`；完整 lint `0 error / 10 existing warnings`；Python compile、`server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` 全部通过并清理。
- 仓库 credentials scan 通过，扫描 1,194 个 tracked/untracked（排除受保护资料树）文件；`git diff --check` 通过。
- PostgreSQL 离线恢复集成测试未运行：本任务的绝对边界禁止访问任何 PostgreSQL；本次变化由无数据库 unit、CLI 子进程和正式只读文件诊断覆盖。没有连接主库或测试 PostgreSQL。

## 运行面、业务与资源保护

- 没有启动 Chromium，没有登录账号，没有发送正式 Identity 或业务 API 请求，没有访问 PostgreSQL。
- 没有修改密码、must-change、角色、enabled、Session、Identity Audit、业务数据、Migration、镜像、Compose、环境变量、服务或四个受保护 Volume。
- 因任务不存在数据库/API/服务写入路径，既有 Supplier Mapping `0`、RFQ/Quote/Award `0/0/0`、`PRQ-00000001=ACCEPTED` 和全部账号/Session 语义保持。
- Web/PostgreSQL/Worker/Caddy 未重启、未替换；终点四服务 RestartCount 0、OOM false，四个受保护 Volume 均存在。
- 所有测试容器使用 `--rm`、断网、只读文件系统和内存/CPU/PID 上限串行运行；Python 临时目录和容器 tmpfs 已删除，没有 prune 或扩大清理。
- 终点 available memory 约 2.2 GiB、Swap 258 MiB、根盘可用 20 GiB、Load `0.45/0.46/0.47`；任务时段内核 OOM 0，未触发低资源停止阈值。

## Git 与后续

- 独立提交消息：`fix: diagnose canonical credential schema safely`；实际完整 SHA 以 `git log` 为准。
- 未提交 Canonical、候选、秘密输出、诊断原文、数据库、日志或临时文件；未 push、PR、amend、rebase、reset、stash 或 restore。
- operations 首次改密的 **Schema 技术阻断已解除，可以在新的明确授权 Identity 任务中重新执行**。本任务不授权也未执行该改密；完成后立即停止，不登录 operations，不开始 Mapping 业务。
