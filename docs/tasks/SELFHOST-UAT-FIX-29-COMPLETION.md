# SELFHOST-UAT-FIX-29 — RFQ Award Candidate Selection Fix 完成报告

最终状态：`RFQ AWARD CANDIDATE SELECTION FIXED — UAT AWARD NOT CREATED`

## 范围、起点与Schema结论

- 从唯一worktree、clean `main@8665f21577f2b5f5ab2b9e5ac442487dd6c2335d`、Parent `80e1ad60fa1272017545e150721c8b71f7c68828`、behind 0/ahead 161、`0.1.0-alpha.40`、Migration `0001—0039`起步；0039 SHA-256保持`3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- 现有0018/0039已提供稳定Candidate PK、Candidate→Comparison Line、Candidate→Quote Line及Award Line的Comparison/Quote Line约束，关系无歧义。没有修改0039、没有新增0040、没有改变Candidate ID或历史Comparison数据。
- 功能提交为`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`（`fix: bind RFQ awards to comparison candidates`）；部署/UAT/清理与项目文档由独立`ops: deploy RFQ award candidate selection fix`提交收口，实际SHA以Git log为准。未push、未PR、未改写历史。

## 根因、DTO与关联规则

- 精确根因是详情RFQ Line的PostgreSQL `bigint`经`pg`返回字符串，而旧Quote Line查询曾把`rfq_line_id`投影为数字；前端又把RFQ Line声明为`number`并严格比较，导致四行Candidate过滤全部为空。旧UI还从Quote数组重建候选，以Quote Line ID作为option/submission值，未使用Comparison Candidate权威关系。
- 修复后Comparison Version/Line/Candidate DTO显式提供Comparison Candidate ID、Comparison Line ID、Quote ID/version、Quote Line ID、Supplier、数量、币种、价格、金额、日期、交期、排名、`COMPARABLE`、`awardable`与固定Quote是否当前。Candidate、Comparison、Quote、Quote Line、RFQ Line等稳定bigint ID在JSON和浏览器中均为规范十进制字符串。
- UI关联规则唯一为`candidate.comparison_line_id === material.comparison_line_id`，再由Material summary绑定RFQ Line；不使用数组位置、Supplier名称、标签、价格或排名。option value和Award提交值均为稳定Candidate ID。
- Award提交DTO逐行携带`rfq_line_id`、`comparison_line_id`、`comparison_basis_digest`、`selected_candidate_id`及期望Quote ID/version，并在顶层绑定RFQ编号/Round/CAS、Comparison Version、output digest、原因码和理由。服务端从Candidate重新解析固定Quote/价格事实，不信任浏览器显示值。

## 四行Candidate与Quote固定引用

| Comparison Line | Material | Supplier B Candidate | Supplier A Candidate |
| ---: | --- | --- | --- |
| 1 | `533 / CYD-RB_PCB-000016` | Candidate `1` / Quote Line `5` / Quote `2 v1` | Candidate `2` / Quote Line `1` / Quote `1 v1` |
| 2 | `534 / CYD-RB_SENSOR-000003` | Candidate `3` / Quote Line `6` / Quote `2 v1` | Candidate `4` / Quote Line `2` / Quote `1 v1` |
| 3 | `535 / CYD-RB_CONN-000075` | Candidate `5` / Quote Line `7` / Quote `2 v1` | Candidate `6` / Quote Line `3` / Quote `1 v1` |
| 4 | `536 / CYD-RB_METAL-000015` | Candidate `7` / Quote Line `8` / Quote `2 v1` | Candidate `8` / Quote Line `4` / Quote `1 v1` |

- Supplier A为ID `1 / SUP-000001`：每行`12.00 CNY`、行金额`120.00 CNY`、承诺`2026-10-20`、`ON_TIME / 提前10天`、rank 2；四行总额`480.00 CNY`。
- Supplier B为ID `2 / SUP-000002`：每行`10.00 CNY`、行金额`100.00 CNY`、承诺`2026-11-05`、`LATE / 延期6天`、rank 1；四行最低总额`400.00 CNY`。
- 四个选择框初始均为“请选择”，各只有上述两个Supplier选项；A/B均可选择，不因Supplier已`RESPONDED`、A为rank 2或B为延期而从候选列表删除。最低价不等于自动获选。
- 每个option标签显示Supplier编码/名称、Candidate ID、Quote ID/version、单价/行金额、承诺日期、ON_TIME/LATE、提前/延期天数和价格排名；value只使用稳定Candidate ID，四行互不混入其他Material候选。

## 服务端安全与确认窗口

- 服务端在单事务中先锁RFQ，再重验RFQ编号/Round/CAS、全部RFQ Line、同一最新Comparison Version、`CURRENT`投影、固定Quote输入、逐行basis、确定性output digest、Candidate/Comparison Line/Quote/Quote Version/Quote Line/Supplier/Material/Unit/数量/币种/价格/交期及可定标状态。
- 明确拒绝：数字型Candidate ID、跨Line Candidate、历史Version Candidate、错Quote引用、缺行、重复行、额外行、过期CAS、basis/output漂移、Quote输入漂移、非CURRENT/不可定标Candidate、数量/MOQ不足、晚交期无逐行接受理由，以及非最低价使用`LOWEST_PRICE`或`LATE_DELIVERY_ACCEPTED`等不适用原因。
- rank 2只接受服务端认可的非最低价原因语义；本次正式合同为`DELIVERY_PRIORITY / 交期优先`及完整理由。Origin、CSRF、purchase权限、幂等重放/异正文冲突、并发单胜、审计和故障全回滚未放宽；Quote Revision与Award统一为RFQ先锁的顺序。
- 正式理由原文为：`交期优先，避免项目延期；供应商A承诺2026-10-20交付，满足2026-10-30需求日期，供应商B承诺2026-11-05交付，已晚于需求日期。`
- 确认窗口完整显示RFQ ID/编号/Round/CAS、Comparison v1/CURRENT、四个basis与output digest、四行Material/Candidate/Quote/Supplier、A总额480、B最低价400、价差80/20%、A提前10天/B延期6天/A早16天、原因码与完整理由；明确只新增Award/Award Line，不自动创建PO、到货计划、收货、库存、应付或其他下游。默认焦点为取消，取消/ESC/遮罩关闭零业务POST。

## 自动测试与隔离Award

- Unit/UI `11/11 + 22/22`，隔离Sourcing PostgreSQL `9/9`，既有Binding/Quote/0039 PostgreSQL回归`18/18`，0039 migration upgrade`6/6`，Origin/CSRF/身份安全`20/20`，专项typecheck、lint 0 error/11个既有warning和Docker production build通过。
- 覆盖Candidate字符串超过`Number.MAX_SAFE_INTEGER`、精确四组/Quote引用、默认空选、A/B四行选择、rank 2+理由、所有服务端拒绝、幂等重放、异正文冲突、并发单胜及`after_award_saved`时Header/4 Line/RFQ/Event/Audit/Idempotency完整回滚。
- 隔离Chromium桌面与390×844通过：取消路径`business POST 0`；正式路径只POST一次并选择Candidate`2,4,6,8`，结果恰为Award 1、Award Line 4、PO 0、Session 0，无页面级横向溢出。
- `npm test 3/3`、environment guard`6/6`、Python `server.py --self-test`/`smoke_test.py`/临时SQLite `go_live_check.py --no-backup`、功能阶段1,260文件及完成报告加入后最终1,261文件credentials和`git diff --check`通过。首次0039/环境/凭据/Python调用分别因测试容器漏挂当前DB或`/config`、通用镜像无Git、系统Python缺`openpyxl`而在对应验证前失败；均按既有只读挂载/项目venv复验通过，没有降低断言或改产品代码。

## 正式备份、恢复与Web-only部署

- 正式备份：`/var/backups/chenyida-erp/rfq-award-candidate-fix29-predeploy-20260807T062238Z.dump`，root:root、0600、单硬链接、2,291,936 bytes，SHA-256`151910bc0ee6a993ed71bfded7e790bd50dc23a3070649524f041fdf60e2e712`；`pg_restore --list`为3,359行。
- 第二新库`rfq_comparison_aggregate_restore_20260807`从空库单事务恢复，得到39/head 0039、226张public表、Award/Award Line/PO`0/0/0`和相同保护指纹`16d70f18…cf5bc`；验证后在连接数0时精确删除。
- 最终Web为`sha256:f239ffe3059cfbd5cbb26a45d0960249450ec61989a8f91fb4e17dff3e26e4c1`、88,599,819 bytes；旧Web`sha256:0dfcc0a8639e09e6ca0380292d979a2f73510a76cdcd23d46001bfb9c145273d`保留为`rollback-rfq-award-candidate-fix29-predeploy-20260807T062238Z`。
- 仅执行`up -d --no-deps --no-build --force-recreate web`。PostgreSQL、Worker、Caddy Container ID和镜像保持，四个受保护Volume与env/Compose/0039哈希保持；migrate容器部署前后均不存在，没有运行Migration。
- 一致性备份短停原Web/Worker后，Compose `start`因历史migrate容器不存在而拒绝依赖检查；随即只对已核验的原Container ID执行串行`docker start`，两者恢复健康且restart/OOM仍为0。此过程未创建或替换Worker/PostgreSQL/Caddy，也未改变数据库。

## 主UAT取消验收与最终数据

- 唯一实际浏览器只登录`uat_20260729_purchase`。桌面与390×844均核对四个选择框各两候选，四行本地选择Supplier A Candidate`2,4,6,8`，选择`DELIVERY_PRIORITY`并填写完整理由，打开正式确认窗口后点击取消、清空未提交表单并安全退出。
- runner在页面网络层先阻断除login/logout外的所有写请求，直连helper也拒绝非认证POST；本次`business_post=0`。最终purchase有效Session为0，退出后受保护内容不可见。
- UAT前后完全相同：RFQ `1 / RFQ-00000001 / ISSUED / v6 / Round 1`、Binding 8、Quote 2、Comparison Version 1/CURRENT、Comparison Line 4、Candidate 8、Award/Award Line/PO `0/0/0`，output digest`79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec`，保护指纹`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`。
- 没有创建主UAT Award、PO、到货计划或其他下游，没有修改Quote、Comparison、Candidate、RFQ、Binding，也没有重新生成Comparison或直接SQL修复。

## 资源、清理、Git与正式定标条件

- 重任务全部串行且一次最多一个临时容器。任务起点约available 2.1 GiB、Swap 272 MiB、根盘18 GiB、低Load；文档与最终只读复核后为available 2.1 GiB、Swap 250 MiB、根盘18 GiB、Load`0.04/0.10/0.16`。任务窗口内核OOM 0，Web/PostgreSQL/Worker/Caddy均restart 0、OOM false。
- 恢复库、隔离库、Playwright runtime、临时SQLite、临时容器与FIX29临时目录均清零；起点既有`procurement_sourcing_test_fix22_20260805`保持空public Schema。任务误拉取且未使用的`alpine:3.20`标签/镜像已删除，可按需重新拉取；未执行prune。正式dump、current/candidate/rollback Web镜像和四个受保护Volume保留。
- 两个聚焦提交为功能`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`与收口消息`ops: deploy RFQ award candidate selection fix`；最终SHA/ahead以Git log为准。未push/PR/amend/rebase/reset/stash/restore，秘密、连接信息、Cookie、Token、Session或备份正文未进入Git。
- 当前`CURRENT`/`awardable_now=true`、固定Quote输入无漂移、四行Candidate完整，已具备重新执行正式人工定标的技术条件；这不是业务批准。真正点击“最终确认并创建 Award”仍须新的明确授权，并重新读取RFQ CAS、Comparison Version/basis/output digest、Quote有效性和Candidate资格。当前停止在主UAT Award/Award Line/PO `0/0/0`。
