# SELFHOST-OPS-TARGETED-OPERATIONS-IDENTITY-RECOVERY-13

## 状态

- 当前状态：`DONE`
- 最终结论：`OPERATIONS IDENTITY RECOVERED — BROWSER VERIFICATION INCOMPLETE`
- 开始/完成时间：2026-08-04
- 负责人：Codex（定向 CLI、安全守卫、隔离测试、备份恢复、正式离线恢复、Canonical 同步、浏览器验证与清理）
- 授权人：项目负责人（明确授权仅恢复 `uat_20260729_operations`）
- 依赖：`SELFHOST-OPS-OFFLINE-IDENTITY-RECOVERY-11`、`SELFHOST-OPS-CANONICAL-SCHEMA-RECONCILIATION-12`、`SELFHOST-UAT-FIX-20`

## 最终边界

本任务只在当前非生产并行 UAT 对 `uat_20260729_operations` 执行了一次离线身份最终化：设置新的独立强随机最终密码、把 `must_change_password` 从 `true` 改为 `false`、把用户 version 从 6 推进到 7、撤销目标账号全部既有 Session、写入一条不可变 `OFFLINE_IDENTITY_RECOVERY` 审计，并把同一密码原子同步到十账号 Canonical。

没有修改用户名、角色、active、其他账号、版本、Migration、镜像或业务数据；没有通过首次改密页面写入，没有登录 purchase，没有创建、提交或审核 Supplier Mapping。全过程没有输出旧密码、新密码、密码哈希、Token、Cookie、Session 摘要、Canonical 正文或连接字符串。

## 严格起点

- Git：clean `main@b7221a94375487a9656fff84f46dbabb95a5a26a`，behind/ahead `0/135`。
- 源码/数据库：`0.1.0-alpha.39`，Migration `0001`—`0038`，38/head `0038_supplier_mapping_governance.sql`，0038 SHA-256 `2da259364151af098641795da55604dc3012b6adf92aec67038c0554e0592941`。
- 运行面：Web `sha256:c1576bd22a209fb6f524e304bcf12cc38af4d67a35c76f37fa8dc1311c2922c8`、Worker `sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`；四服务 RestartCount 0、OOM false。
- Canonical：`chenyida-erp-uat-credentials-v2`，验证器 `offline-identity-recovery-uat-validator-v2.1`，写入器 v2；10 账号、0 错误、`SCHEMA_PASS`，`root:root 0600`；operations 唯一、role=operations、must-change=true。
- PostgreSQL：operations 唯一、role=operations、active=true、must-change=true、version=6；有效 operations Session 0。
- 业务保护：FIX-20 起点指纹 `8ad0c2e19863808ed9fed62b0da8f5ef4e78bbaf586fe1be146a286bcf3f0ce0`；Mapping/RFQ/Quote/Award `0/0/0/0`；`PRQ-00000001=ACCEPTED`，Supplier 1/2 ACTIVE，Material 533—536 与全部下游符合既定基线。

任一严格起点不符即停止的门禁全部通过。

## 定向恢复能力

既有 CLI 只支持 0036 下固定十一账号全量恢复，不能满足本次单账号最终化，因此新增独立 targeted mode：

- 只接受精确用户名 `uat_20260729_operations`、预期 role/active/version、UUID v4 run-id 和绑定全部参数的显式确认短语。
- 禁止通配符、列表、重复参数、隐式全账号或其他用户名；root、非生产数据库身份、Migration head 0038、Web/Worker 停写、正式镜像和独立 run-id 全部失败关闭。
- 密码只从 CSPRNG 生成，经匿名管道进入 CLI，并在受控进程内同时用于强哈希与 Canonical 候选；不进入参数、环境变量、日志或终端。
- 候选与正式 Canonical 同目录，必须 root:root 0600、单硬链接、固定十账号、v2/v2.1 校验通过，且语义差异恰好为 operations password 与 `must_change_password true→false`。
- 单一 SERIALIZABLE 事务锁定账号和 Migration，原子更新目标、推进 version、撤销 Session、写恢复审计和永久 run-id marker；事务内比较其他账号非敏感/秘密指纹、其他 Session 和业务指纹。
- 数据库成功但 Canonical 提升失败时保留唯一候选并停写；只允许同 run-id 受控补偿提升，禁止生成第二个密码。
- 浏览器失败清理只允许 attempt 1/2，离线撤销目标验证 Session并写独立 cleanup 审计，不修改密码或账号状态。

功能提交：`7b95b13cd1e6c64d0f7fd4536e3456ca2a9d25db`（`feat: add targeted offline identity recovery`）。

## 自动测试与失败关闭

- targeted unit `5/5`；legacy recovery unit `9/9`；targeted TypeScript 检查与定向 ESLint 通过。
- 隔离 PostgreSQL `4/4`：十一受控身份中只改变 operations；其他十账号的非敏感与秘密指纹、全部其他账号、其他 Session 和业务表保持；新密码强哈希验证、must-change=false、目标 Session 全撤销、恢复审计恰好一条。
- 覆盖重复 run-id、错误用户名/角色/version/数据库/Migration/服务状态、候选失败、事务失败、提交确认不确定、Canonical 提升失败和保留候选补偿；全部失败关闭且故障零半记录。
- 正式 runner 在 Web/Worker 运行时的 dry-run 以 `TARGETED_WRITERS_STILL_ACTIVE` 拒绝。
- 仓库 credentials scan 通过（1,202 个仓库文件）；适用 lint/typecheck、`npm test` 和 `git diff --check` 通过。隔离数据库与任务容器均串行执行并清理。
- 最终复跑曾因只读测试容器未提供 `/run` tmpfs、legacy 测试未挂载到其固定 `/app` 路径、应用镜像不含 Git 而在环境准备阶段失败；分别补齐 tmpfs/正式路径并改用本地已有且含 Git 的 Node 镜像后，targeted `5/5`、legacy `9/9`、credentials 1,202 文件全部通过。上述失败未连接或修改 UAT。

## 正式备份与恢复验证

- 保留备份：`/var/backups/chenyida-erp/operations-identity-recovery13-prewrite-20260804T134222Z.dump`
- 元数据：root:root 0600、单硬链接、2,212,808 bytes。
- SHA-256：`9b18cb329dfe8775b03f5288a900b31f0ebb7d5d6599c91d1a40a6a8605269cd`。
- `pg_restore --list` 通过（3,321 项）；恢复到第二个新空数据库后为 38/head 0038、225 张 public 表，Migration checksum、身份非敏感计数、有效 Session 0、FIX-20 指纹 `8ad0c2e19863808ed9fed62b0da8f5ef4e78bbaf586fe1be146a286bcf3f0ce0` 和业务零事实均与主库一致。
- 恢复数据库核验后精确删除；正式备份保留。

## 正式恢复结果

- run-id：`e0fec2fb-3894-4a19-93af-79eb85d9dfd4`
- Web/Worker 受控停写，PostgreSQL 保持 healthy；执行期间应用数据库连接为 0。
- 候选：10 账号、0 错误、`SCHEMA_PASS`、差异恰好 2；数据库事务、目标账号、其他账号、其他 Session、业务保护和 Canonical 提升均由正式 runner 返回 PASS。

| 目标非敏感状态 | 前 | 后 |
| --- | --- | --- |
| username 唯一数 | 1 | 1 |
| role | operations | operations |
| active | true | true |
| must_change_password | true | false |
| version | 6 | 7 |

- 其他身份：事务内其他十个受控账号的非敏感与秘密指纹、全部其他账号指纹及其他 Session 指纹前后相同；正式后检仍有精确十个其他受控账号且全部 active。Canonical 其他九个 UAT 账号的所有字段和密码由两项差异检查证明保持。
- Session：正式事务开始前目标有效 Session 0，事务撤销 0，提交后 0。浏览器 attempt-2 新建 1 条验证 Session，并由安全 logout 撤销；两次失败补偿清理各撤销 0。最终目标未撤销/有效 Session 为 `0/0`。
- 审计：正式 run-id 下 `OFFLINE_IDENTITY_RECOVERY` 恰好 1 条，old/new version 为 `6/7`，事务 Session 撤销数 0；两条浏览器失败 cleanup 审计与正常 LOGIN/LOGOUT 审计是独立动作，不增加恢复审计数量。
- Canonical/数据库秘密一致性：受控进程从正式 Canonical 内存读取目标凭据并与数据库强哈希验证，结果 PASS；浏览器也以正式 Canonical 凭据形成成功 LOGIN。未输出任何秘密。
- 正式 Canonical：v2、validator v2.1、writer v2，10 账号、0 错误、`SCHEMA_PASS`；operations must-change=false；root:root 0600、单硬链接、1,978 bytes；候选消失。

## 浏览器验证

只使用单一 Chromium runner，网络白名单仅允许匿名根页、静态资产和 `/api/login`、`/api/session`、`/api/logout`；没有进入业务页面，也没有请求或执行 Mapping 业务。

1. attempt-1 在登录前因临时 Playwright 模块树尚未预置而 fail closed；没有读取凭据或创建 Session。随后停写执行 attempt-1 清理，撤销 0、最终 0。
2. 以固定浏览器镜像和 Playwright 1.51.1 在 root-only 临时目录完成断网导入/Chromium 启停自检后，只执行一次全新的 attempt-2。
3. attempt-2 已通过匿名登录页与匿名 Session 检查，并以正式 Canonical 凭据产生服务端 `LOGIN success`；验证器随后把 `/api/login` 响应错误要求为含 `authenticated=true`，而实际身份合同返回 `{ok,user,...}`，因此报 `TARGETED_BROWSER_LOGIN_FAILED`。失败处理通过 `/api/session` 识别当前认证 Session并产生 `LOGOUT success`，该 Session 已撤销。
4. 因第二次机会已用完，没有修复后重跑、没有再次修改密码。数据库/Canonical 的 must-change=false 与角色已独立验证；但浏览器内“无强制改密页”、用户名/角色页面呈现及 logout 后 back/forward/refresh 断言未走到完成点，故浏览器验收按要求记为不完整。

最终浏览器相关有效 operations Session 为 0；两次 attempt 的证据文件、网络、容器、Profile/tmpfs 和模块目录均已清理。

## 业务与运行保护

- 身份/系统表排除后的全业务指纹在正式事务 marker 前后及浏览器后均为 `c55aff391533a1c508fdfdaa42fa3ebc4d0868a25b7585ccdeefaf14b3554b36`（217 张表、203 个序列）。
- FIX-20 业务事实：Supplier Mapping/RFQ/Quote/Award `0/0/0/0`；`PRQ-00000001=ACCEPTED`，Purchase ACCEPT/RETURN `1/0`；Supplier 1/2 两条均精确 ACTIVE；Material 533—536 四条编码、ACTIVE、PCS 和既有 NULL base_unit_id 精确匹配；PO/Delivery Plan/Receipt/Ledger/AP/Work Order 均为 0。
- FIX-20 历史指纹 `8ad0c2e1…` 包含 must-change 身份计数，只用于恢复前备份基线；本任务按授权改变该身份字段，因此最终业务保护采用排除身份/系统表的上述稳定指纹，并对 FIX-20 业务对象逐项核对。
- Web/Worker 均恢复到原容器与原镜像；Web/PostgreSQL healthy，Worker/Caddy running，四服务 RestartCount 0、OOM false，HTTP health 200。
- 资源起点约 available memory 2.2 GiB、Swap 257 MiB、根盘 20 GiB、Load `0.03/0.16/0.22`；终点为 available memory 2.2 GiB、Swap 256 MiB、根盘 20 GiB、Load `0.45/0.61/0.36`。任务期内核 OOM 0、Docker OOM/restart event 0；所有重任务串行，一次一个临时容器。

## 清理、Git 与后续

- 定向测试库、正式恢复库、runner 容器、浏览器网络/Profile、Playwright 临时模块、正式候选、attestation 与浏览器证据均精确清理；没有遗留 `cyd_toir_*` / `cyd_oir_*` 数据库。
- 正式备份保留；ERP 镜像与 `chenyida-erp-parallel_erp_postgres`、`erp_uploads`、`erp_attachments`、`erp_backup_status` 四个受保护 Volume 保留，未 prune。
- 源码版本仍为 alpha.39，Migration 仍为 0001—0038；不 push、不创建 PR。
- 独立功能提交为 `feat: add targeted offline identity recovery`；文档与运维收口提交为 `ops: activate operations UAT identity safely`，实际 SHA 以 `git log` 为准。
- 本任务没有开始 Mapping。由于浏览器完整验收未完成，当前**不放行** purchase 创建并提交八条 Mapping；应先在新的明确授权任务中修复验证器登录响应合同并完成只读登录/退出历史验证，之后仍需独立 Mapping 业务授权。
