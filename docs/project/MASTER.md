# 晨亿达ERP项目总控

> 最高优先级：任何新的 Codex 对话必须先阅读本文件，再继续当前任务。

## 项目名称

晨亿达ERP（Chenyida ERP）

## 项目目标

打造适用于 PCB、FPC、SMT 行业的 ERP，以统一内部编码连接物料、产品、BOM、采购、库存、生产、销售、财务和品质。

长期目标是建立 AI 物料主数据中心（Material Master），最终实现：

- AI 物料治理
- AI 采购
- AI 报价
- AI 生产辅助
- 行业物料知识库

AI 只提供建议、证据和辅助决策，不得未经审核直接创建、合并或覆盖正式物料数据。

## 文档权威顺序

1. `AGENTS.md`：全仓库不可放宽的工程、安全和生产保护规则。
2. 本文件：项目目标、当前结论、当前任务和下一任务。
3. `TASKS.md`：任务状态、依赖和责任人。
4. `PROJECT_CONTEXT.md`：新对话恢复上下文的事实基线。
5. `DECISIONS.md`：已确认决策及仍待确认事项。
6. 当前任务文档：本次工作范围和验收标准。

实际代码和生产状态与文档冲突时，必须先核验并更新文档，不得凭聊天记忆继续开发。

## 当前状态

快照时间：2026-08-10（Asia/Shanghai）

| 项目 | 当前值 |
| --- | --- |
| 当前版本 | AI Suggestion/Evidence源码候选为`0.1.0-alpha.44`，源码Migration为41/head `0041_ai_governance_suggestion_evidence.sql`；并行非生产UAT Web仍为`0.1.0-alpha.42`原镜像`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`，运行source revision仍为`569aa954d764309e239d1f6c174e582596d33a24`，UAT PostgreSQL仍为40/head `0040_warehouse_receipt_readiness.sql`。alpha.44/0041未build、未部署或应用到UAT；当前运行面仍是受控非生产UAT，不是生产发布、真实公司数据迁移或切流 |
| 当前 Branch | 根仓库 `main` |
| 当前根仓库功能基线提交 | `SELFHOST-UAT-FIX-38`收货预检提交`401e16b04e3b8cb70ddfd3508661353ff758fdec`保持；运行时版本/health提交`13f72b5f7aa51905af597733356420cc7b017b74`及Docker metadata提交`61f0b56788ef68b9b7aa6d34583d2ddc3bde3f66`使`package.json.version`成为单一权威、health失败关闭并让最终Web `/app/package.json`保留最小`name/version/private/type`。当前运行镜像从固定`569aa954d764309e239d1f6c174e582596d33a24`的Git tree构建，没有新增或运行UAT Migration |
| 当前根仓库运维基线 | `SELFHOST-UAT-FIX-38`已把通过候选Web-only部署到并行非生产UAT；本地/公开alpha.42 health、Caddy安全头、匿名保护、未来日期422、合法日期4次预览、四种返回修改、390×844和安全退出通过。唯一warehouse登录/退出各1，Business mutation及Receipt POST0；最终Session0、收货及全部下游0。独立收口提交消息为`ops: deploy warehouse receipt date guard`，实际SHA以Git log为准 |
| Git 同步与工作区 | D-108的`GIT PRIVATE RECOVERY ANCHOR ESTABLISHED`保持。PHASE4-TASK03第二阶段严格起点为唯一worktree、clean `main@0d6b5961b2ed280ca80b15678ac42665aad1b45e`、Parent`df254a6f8018292708f60c712c451368484deac7`；起点`recovery-private/main`与HEAD相同且behind0/ahead0，公开`origin/main=39946f6b854a985b5c19106eaa6c938bddaf9c7c`且public behind0/ahead195。持久层提交`8b839a64…6105`、服务提交`218ef1b4…0eb1`，文档以独立`docs: record AI suggestion source readiness`收口；全部验证后只普通fast-forward push到private main，公开origin禁止接收内部历史 |
| 镜像恢复锚点 | D-109的private GHCR镜像恢复锚点已建立：唯一目标/tag为`ghcr.io/3443176848/chenyida-erp-web:0.1.0-alpha.42-fix38-569aa954d764309e239d1f6c174e582596d33a24`，一次push返回、认证registry与唯一tag package version三方digest均为`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`。package为PRIVATE、无repository association、无`latest`/额外tag；linux/amd64 child、attestation、config和9层均匹配预检，一次按digest pull完全匹配，匿名读取返回401。一次性本机凭据已logout并清理；项目负责人证明已通过GitHub网页撤销一次性PAT，本项目未读取或技术验证PAT正文/远端状态 |
| PM-000 基线父提交 | `bbefb2e`，`feat: add chenyida erp site project files` |
| 历史 Sites 版本 | 历史记录为 `v3` / `2b4f178`；本任务未访问公开 Site，未重新确认在线状态；Sites/D1 不是未来生产权威方向 |
| 历史 Site 源码版本 | 历史发布对应提交 `2b4f178`；纳入根仓库前的开发提交为 `9f2c2dc`；根仓库直接跟踪其完整源码 |
| 历史 Site 地址 | 文档保留原地址仅作历史追踪；本任务禁止且未访问 |
| 当前数据库 | 源码为`0001`—`0041`，41/head`0041_ai_governance_suggestion_evidence.sql`且SHA-256为`676626b9dcb78f31643612e5662cf5c36e06259c72ff922287bb913394071bf2`；并行UAT PostgreSQL仍为`0001`—`0040`，0040 SHA-256`b6781c94da3f52a8f719ce57cdf13acbb4e3fe1c66f2a0480bdb6a9ff10a5a93`，0035/0040及更早Migration未修改。0041只在隔离数据库验证，没有连接或应用到UAT；既有UAT业务事实沿用FIX38只读基线且本任务未访问业务数据库 |
| 当前运行状态 | `https://43.135.148.43.nip.io:18888`经原Caddy到新Web；运行Web及`latest`均为alpha.42的`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`（88,679,975 bytes），容器`f0066fe6fb07bd2542caf39f8409571125b0b8009592d7dfd3b754c91981a35f`。旧alpha.41完整镜像`sha256:0cf98937…d5f19`保留在`0.1.0-alpha.41-fix38-rollback`；失败候选`sha256:81126136…278e`仍为`REJECTED — DO NOT DEPLOY`。PostgreSQL、Worker、Caddy身份不变，四服务restart0/OOM false及四个受保护Volume完整 |
| 当前开发环境 | 当前alpha.42镜像的最小`/app/package.json`精确为`name/version/private/type`且version为`0.1.0-alpha.42`；OCI version/revision/task与固定HEAD一致，本地/公开health返回原字段加alpha.42 version。公开Caddy安全头、匿名保护、未来日期422、NORMAL实际模式、四种返回修改和390×844通过；Worker、Compose、Caddy、Receipt POST、0040、Python/SQLite及历史Sites/D1未改 |
| 当前阶段 | `PHASE4-TASK03 AI SUGGESTION/EVIDENCE SOURCE READY — HOLDOUT REVALIDATION REQUIRED / NOT BUILT / NOT DEPLOYED`。D-112五表、确定性四能力、受保护生成/读取API、事务幂等/CAS/Audit及只读有效性已在alpha.44/0041源码实现并通过隔离验证；外部AI继续禁用，人工审核、真实数据和试点未开始 |
| 当前任务 | `PHASE4-TASK03`是唯一`DOING`，状态为`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。`PHASE4-TASK01`、`TASK02`保持DONE，D-110/D-111原样继承；source ready不表示D-111重验、构建、部署或发布完成 |
| 下一任务 | 在任何构建、部署、UAT Migration或TASK04前，必须对alpha.44完整身份执行独立正式holdout重验并取得发布授权。`PHASE4-TASK04`、`TASK05`继续`TODO`；任何外部模型、真实数据、试点、数据锚点、真实Receipt、部署或切流同样须独立授权 |

## 当前完成模块

以下模块已有可运行代码或已完成治理交付，但“已实现/已完成”不代表已达到 V2、审计或生产成熟度标准：

- PHASE4-TASK03已完成D-112第二阶段源码实施：[五表合同](../material-master/ai-suggestion-evidence-relational-v1.md)以alpha.44/0041、Schema/snapshot/journal和独立`LOCAL_DETERMINISTIC`模块落地，四能力安全`ABSTAIN`、稳定摘要、单事务候选/Audit/幂等、版本/SUPERSEDED、服务端过期/漂移及受保护POST/GET通过隔离测试。任务保持`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`；正式holdout、build、部署、UAT Migration、人工审核、模型和试点均未开始

- PHASE4-TASK02已交付独立离线Evaluator、`synthetic-material-governance-v1@1.0.0`、calibration/holdout各32条、四项确定性基线和机器报告；功能提交`d69f6dff…194ec`后只运行一次正式all-splits测量，result digest `f1b5b6b9…ac316`。关键安全违规0、失败sample_id为空，coverage为calibration 18/32、holdout 19/32。D-111批准当前确定性身份的正确性/证据/复现100%、安全和错误候选0以及总体50%、分类75%、属性记录/字段75%、Match/Mapping各25%的最低coverage，现有结果为治理层PASS；机器报告历史字段不回写，release仍未授权，TASK03不得降低或重解释该阈值，外部AI、真实数据和运行面均未接入

- PHASE4-TASK01已完成D-110与AI治理评估/审批V1合同：AI仅生成候选和证据，确定性门禁与既有服务端权限/事务/CAS/幂等/审核/审计优先，异常失败关闭；采购、工程、品质和主数据管理员继续承担人工责任。该历史结论继续作为TASK02的治理前提，不因离线测量而授权模型、阈值、候选层或试点

- SELFHOST-OPS-RECOVERY-FOUNDATION-39已按项目负责人范围决定行政收口：D-108 private Git锚点保持，D-109唯一alpha.42 Web镜像以完整revision tag一次push到private GHCR；push、registry和package version digest三方为`sha256:e7761e2c…f94964`，按digest回拉匹配且匿名401。本机临时凭据已清理，项目负责人证明已通过GitHub网页撤销一次性PAT；PostgreSQL与三个文件卷异机锚点未建立并被主动延期，因此状态为`DONE / OWNER-CLOSED AFTER GIT AND IMAGE ANCHORS / DATA ANCHOR DEFERRED`，单机数据恢复风险仍开放且不构成生产就绪

- SELFHOST-UAT-FIX-38完成：alpha.42收货preview把`evidence_document_date`交给PostgreSQL Asia/Shanghai只读事务门禁，未来日期以稳定422/code/message/request ID失败关闭；NORMAL只投影当前普通Receipt/`RECEIPT`/available后果，返回修改/关闭/ESC/背景清理确认状态并保留本地草稿。Web-only部署为`sha256:e7761e2c…f94964`，唯一warehouse登录/退出各1、未来422一次、合法preview/确认窗各4、桌面/390×844与匿名历史保护通过；Business mutation及Receipt POST0，最终Session0、PO/Line/Plan/queue及全部下游不变。PostgreSQL/Worker/Caddy未重建，Migration未运行

- SELFHOST-UAT-FIX-37完成：warehouse最小权限DTO展示PO创建凭证、四Line/Plan/queue与下游计数；两阶段GET预览/显式最终POST、服务端实际时间、关系化提前到货证据、CAS/幂等/并发/故障回滚及IQC职责隔离已实现。alpha.41/0040通过空库、0039升级、重放、约束/回滚和第二新库恢复，仅替换Web为`0cf98937…`。主UAT只预览并覆盖桌面/390×844五类取消路径，business POST0、Session0，PO/Line/Plan/queue保持`1/4/4/4`且全部收货下游为0

- SELFHOST-UAT-FIX-36完成：`PO_HISTORY_TRACEABILITY_V1`在purchase数据域内只读投影PO、完整上游谱系、四条Line、四条Plan/queue、成功Event/Audit/Idempotency摘要、独立未绑定失败请求与下游零计数；桌面/390×844、刷新、重开、隔离服务重启和主UAT通过。正式dump/list/第二新库恢复后只替换Web为`664e0ac6…`；主UAT business POST0、Session0、状态/历史/浏览器指纹不变，产品不引用D-105或声称授权已验证，全部下游保持0

- SELFHOST-UAT-DECISION-35完成：D-105 `Controlled retention of unauthorized UAT PO-00000001`正式记录受控保留。现有`PO-00000001`及Line/Plan/queue `1/4/4/4`、Event/Audit/Idempotency证据原样保留；Award→PO不再重试。本控制事件是前向授权并执行“不追溯性授权”，只允许以后把该PO作为固定起点进行只读追溯验收，不授权warehouse/quality/finance或任何Receipt/IQC/Ledger/AP/生产写入

- SELFHOST-UAT-AUDIT-34完成：只读事务确认`PO-00000001`由唯一request `773c23b6-0923-4ab5-a451-bb80aa4bdf9d`、actor `uat_20260729_purchase`于2026-08-08 14:11:45创建；PO/Line/Plan/queue精确`1/4/4/4`，四条Award→Candidate→Quote Line→Binding→Mapping→Material谱系、Event/Audit/Idempotency闭合，下游全0。但FIX33零POST收口后不存在新的仓库任务授权链，故按分支B保留数据并封锁履约；只读浏览器桌面/390×844、business POST0、Session0和指纹不变通过

- SELFHOST-UAT-FIX-33完成：采用分支A，证明四条固定Supplier A Mapping权威有效；根因为GET只投影粗布尔值而POST忽略Binding动态重查并错误要求legacy Material非空`base_unit_id`。共享资格loader/DTO、固定fact谱系、锁后漂移保护和四行桌面/移动凭证已通过隔离`1/4/4/4`及失败全0，并完成正式备份恢复、Web-only部署与主UAT取消验收；`preview_get=1`、`business_post=0`、Session0、PO/计划0

- SELFHOST-UAT-FIX-32完成：Award→PO首击改为权威GET预览和完整确认窗口，最终确认才POST；取消/关闭/ESC/背景关闭零业务请求，默认焦点取消，按钮同步禁用且失败不重试。服务端同连接事务重验CAS/摘要/完整Line/Supplier/Mapping/PO0并创建PO/Line/Link/Plan/Queue/Event/Audit/幂等结果。隔离结果`1/4/4`，主UAT只打开、核验、填写备注并取消，`preview_get=1`、`business_post=0`、Session0、PO/计划0

- SELFHOST-UAT-FIX-31完成：Award ID1无独立业务编号、有v1/AWARDED；四条稳定Line ID1—4闭合到Comparison/Candidate/Quote Line，Supplier A合计480.00 CNY、Supplier B零行。持久化`award_digest`与非持久化`AWARD_DECISION_V1`摘要分开；唯一Award Event不伪造CAS，同request_id Audit独立证明v6→v7。Comparison仍CURRENT但不可再次定标，`po_convertible_now=true`。正式备份恢复、Web-only部署和purchase-only桌面/390×844只读UAT通过，business POST0、Session0、PO0

- SELFHOST-UAT-FIX-30补齐两份固定Quote ID/version/Supplier/外部引用/金额/交期，一次不可变Award操作与恰好四条Award Line，上游逐项不可变、PO/Delivery Plan/Receipt/Ledger/AP/Work Order/生产/财务逐项零自动创建和独立转PO阶段说明。隔离双击结果恰为Award1/Line4/PO0；正式备份恢复、Web-only部署及purchase-only桌面/390×844取消验收通过，主UAT business POST0、Session0、Award/Award Line/PO0/0/0

- SELFHOST-UAT-FIX-29修复RFQ Line bigint字符串与旧Quote Line数字严格比较导致的空候选；Comparison DTO以Candidate稳定字符串ID贯通四组逐Line候选、非最低价交期优先、服务端CURRENT/Quote/CAS/摘要/完整行集重验和正式确认窗口。隔离Award恰为1/4/PO0；备份恢复、Web-only部署及purchase-only桌面/390×844取消验收通过，主UAT business POST0、Session0、Award/Award Line/PO0/0/0

- SELFHOST-UAT-FIX-28复用逐行Comparison关系模型形成RFQ/Round/Version/逐行basis复合身份，投影CURRENT/SUPERSEDED/INPUT_DRIFT，确定性重算八条输出摘要、Supplier总额/交期和Material对比；四条真实Line Event只在UI分成一个操作凭证。隔离回归、备份恢复、Web-only部署和purchase-only桌面/390×844只读验收通过；主UAT business POST0、Session0、Award/PO0/0

- SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06 已把 `943c7fa` 状态中文化 Web-only部署到18888非生产UAT；新Web `89e76775…`、旧Web `f45d734b…`精确回退tag、root-only dump/list/第二新库恢复、匿名HTTPS/在线资产SHA/401和连续60秒稳定性通过。0039、Session/Audit、业务指纹和RFQ/Quote事实保持，无登录、业务POST、Migration或其他服务替换

- SELFHOST-UI-STATUS-LOCALIZATION-05 建立共享状态/角色中文词典，贯通原生 React 与 legacy 兼容台的状态徽标、详情/列表、审核/执行结果、启停状态和角色显示；未知枚举保留原值，API/数据库枚举、业务逻辑、alpha.40/0039不变。38个UI测试文件、10组typecheck、lint/build、npm/Python/credentials通过；源码任务自身未部署，后续 DEPLOY-06 已上线

- SELFHOST-DASHBOARD-ROLE-HUB-DEPLOY-04 已把 `4767c3d` 八角色工作台 Web-only部署到18888非生产UAT；新Web `f45d734b…`、旧Web `f139257b…`回退tag、root-only dump/list/第二新库恢复、匿名HTTPS/八角色资产/private-no-store/401和60秒稳定性均通过。0039、Session/Audit、保护指纹和RFQ/Quote事实不变，无登录、业务POST、Migration或其他服务替换

- SELFHOST-UI-REFRESH-DEPLOY-02 已把 `aac6f34` 企业级 UI Web-only部署到18888非生产UAT；新Web `f139257b…`、旧Web `20b41bd…`精确回退tag、root-only dump/list/第二新库恢复、匿名HTTPS/新资产/private-no-store/401和60秒稳定性均通过。0039、Session/Audit与保护指纹不变，无登录、业务POST、Migration或其他服务替换

- SELFHOST-UI-REFRESH-01 参考用友 YonSuite 官方展示中的一体化门户、角色工作台和紧凑企业信息布局，统一晨亿达自有登录、经营工作台、原生业务壳及 legacy 兼容台；新增企业 UI 合同，72/72 静态 UI、五组 typecheck、build/postbuild、lint、npm/Python 和 credentials 通过。API/认证/权限/业务/Schema/版本不变，未登录、写入、构建镜像、重启或部署当前 UAT

- SELFHOST-UAT-FIX-27采用分支A：RFQ Version确认为询价聚合CAS，Supplier A报价导致`v3→v4`及`INVITED→RESPONDED`均为预期；范围漂移改为固定Binding/Supplier-Line/Mapping事实/摘要判定。现有Quote ID 1无独立业务编号、SUBMITTED v1、四行各120.00/总额480.00、提前10天及唯一`QUOTE_SUBMITTED`无版本转换事实已准确展示；Supplier B仍INVITED，仅在隔离环境成功报价。无0040，仅替换Web，主UAT business POST 0、Session 0、Quote/Award/PO 1/0/0

- SELFHOST-UAT-FIX-26 核验0039确有独立 `binding_status` 并分栏显示“Binding状态：ACTIVE”“Mapping状态：ACTIVE”“邀请状态：INVITED”；确认窗口最终写按钮固定为“确认发出”，完整逐项列出 Quote/Award/PO/Delivery Plan/Receipt/Ledger/AP/Work Order/生产/财务零自动创建或修改保护。主表按 Binding ID 1—8展示权威外键关系，历史摘要输入顺序退出身份主字段并明确只服务摘要计算；canonical摘要保持 `9765f8fd…4848d`。隔离发出、备份恢复、Web-only部署和purchase-only桌面/390×844取消通过；主 RFQ仍DRAFT v2、Binding/Event 8/1、ISSUED/Quote/Award/PO 0、业务POST 0、Session 0

- SELFHOST-UAT-FIX-25 采用分支 B：限定只读事务证明八条 Binding 的 RFQ Supplier、RFQ Line/Material、Mapping fact/version/UUID、part、Unit、1:1和状态全部一致，现有 `canonicalDigest` 重算固定摘要完全匹配。根因是把 FIX-24 的 UI显示顺序 `3,4,1,2,7,8,5,6` 与 RFQ Line/Material 顺序位置 zip；只更正文档基线，不改代码/数据库/Migration，不登录、备份恢复或部署。主 RFQ仍 DRAFT v2、Binding/Event 8/1、ISSUED/Quote/Award/PO 0

- SELFHOST-UAT-FIX-24 采用分支 A，直接公开 0039 的 `id bigserial PRIMARY KEY`，以文本 DTO贯通 Repository/Service/Handler/UI；详情、独立固定凭证和发出窗口完整显示八个真实 ID及 Mapping Event。隔离测试、备份恢复、Web-only 部署和 purchase-only 桌面/390px只读取消通过；主 RFQ 最终仍 DRAFT v2、Binding 8、ISSUED/Quote/Award/PO 0、业务 POST 0、Session 0，保护指纹不变

- SELFHOST-UAT-FIX-23 保持 alpha.40/0039，以共享 Service 规则交付零写权威 Mapping 固定预览和 POST 事务重验：主 RFQ 两家各 4/4、缺失/两类冲突 0、八条 Mapping逐项证据与不可变 Binding 后果完整，历史创建成功 Audit 与独立 Event 分列。隔离固定恰好 8、备份恢复、Web-only 部署和主 UAT purchase-only 只读 ESC/取消通过；主 RFQ 最终仍 DRAFT v1、Binding/Event/Quote/Award/PO 0、业务 POST 0、Session 0

- SELFHOST-UAT-FIX-22 采用分支 B 交付 alpha.40/0039：新 RFQ 创建事务固定逐 Supplier×Line Mapping 并写不可变创建 Event；历史草稿不回填，精确成功 Audit 与当前资格分开投影。发出确认、服务端/数据库双重重验、ISSUED凭证、隔离发出、备份恢复和主 UAT purchase-only 只读取消验收通过；主 RFQ 最终仍 DRAFT v1、Binding 0、Quote/Award/PO 0、业务 POST 0、Session 0，必须另获授权先固定 Mapping再考虑发出

- SELFHOST-UAT-FIX-21 采用分支 A：APPROVED Event.reason 保存独立批准意见，Mapping/Event/Audit 投影持久凭证，旧空意见如实显示；服务端零写预览与确认时二次 CAS/冲突核验、完整 operations 列表筛选和 390px 模态框已部署。隔离 PostgreSQL/Chromium、备份恢复及 operations-only 主 UAT 只读验收通过；保护指纹不变，最终仍为 1 ACTIVE / 7 PENDING、下游 0、Session 0

- SELFHOST-OPS-OPERATIONS-BROWSER-VERIFICATION-14 将 operations targeted browser verifier 对齐 Identity 权威登录合同：成功必须为 HTTP 200 JSON、`ok=true`、结构化 `user`、精确 username/role，返回 active/must-change 时分别必须 true/false，且必须进入经营工作台；完全拒绝仅有 `authenticated=true` 的伪成功。唯一实际 Chromium 已通过登录、工作台当前用户标签/角色及 must-change=0，安全 logout 后有效 Session 0；但退出导航释放 response body 导致 verifier 在匿名页与 back/forward/refresh 断言前中止。后续离线修复不再重读 body，改由 transport+匿名页+Session+history 作为持久证据；遵守一次流程上限未重跑，当前仍不放行 Mapping

- SELFHOST-OPS-TARGETED-OPERATIONS-IDENTITY-RECOVERY-13 新增只允许 operations 的 root-only targeted offline finalization，绑定精确 role/active/version/run-id/确认短语、非生产数据库/0038/停写/镜像守卫、匿名密码管道、两项 Canonical 候选差异、单事务账号/Session/审计/marker 与保留候选补偿。正式 run-id `e0fec2fb-3894-4a19-93af-79eb85d9dfd4` 已使 operations must-change=false/version 7，Canonical/数据库一致、其他身份与业务指纹不变、最终 Session 0；Chromium LOGIN/LOGOUT success，但 verifier 响应合同断言导致完整页面/历史验收未完成，当前不放行 Mapping

- SELFHOST-OPS-CANONICAL-SCHEMA-RECONCILIATION-12 新增 root-only、固定路径且不建立数据库连接的脱敏 `--diagnose-schema`，证明旧验证器仅把 engineering/planning/purchase 的当前 boolean must-change 状态误当恢复初始 const。长期 v2 Schema 现接受严格 boolean，恢复 writer/Stage/提升/最终化仍强制初始全 true；正式 Canonical 10 账号/0 错误/PASS且字节不变，无登录、API、PostgreSQL、身份或业务写

- SELFHOST-UAT-FIX-20 复用 `supplier_mappings` 单一权威，交付 alpha.39/0038、purchase 草稿/提交、operations 只读异人审核、稳定 Mapping ID/不可变版本与 Event、Supplier part/有效期唯一约束，以及 RFQ create/issue 共用的当前有效 1:1 coverage。隔离八 Mapping 与两家 4/4/RFQ DRAFT 通过；主 UAT purchase 只读为 0/4×2、业务 POST 0，operations 因 Canonical must-change 未验证，主 Mapping 和全部下游仍为 0

- SELFHOST-UAT-FIX-19 已消除 PostgreSQL bigint 字符串 ID 与前端 Number 严格比较导致 request 丢失的根因；Purchase Request/Supplier option 只提交稳定 ID，请求边界一次规范、Supplier 去重排序，Handler/Service 幂等摘要绑定规范 DTO。隔离 RFQ 四行/双 Supplier 创建、重放、并发与故障回滚通过；Web-only 部署及主 UAT 未提交选择验收通过，业务 POST 0、RFQ/Quote/Award/全部下游 0

- SELFHOST-UAT-FIX-18 已从当前 Plan+PRQ 的不可变 Purchase 决策 Event 投影 action/type/actor/上海时间/request_id/SUCCESS 与独立 1/0 计数；已处理和即时凭证均失败关闭且不使用 Session/队列/Audit 补值。Plan 属于分支 A，页面明确为采购交接状态并说明 v1 计算快照不变。备份恢复、Web-only 部署和 purchase-only 主 UAT 只读验收通过；保护指纹不变、业务 POST 0、全部下游 0

- SELFHOST-UAT-FIX-17 已在 purchase 对象范围内精确投影 Package ACCEPT、Plan GENERATE、PRQ SUBMIT 和真实 Purchase ACCEPT/RETURN 计数；确认打开前重新读取四个 Material 的完整九项供应，缺任一关键字段前后端均失败关闭。自动/隔离 Chromium、备份恢复和 Web-only 部署通过；主 UAT 唯一一次打开确认窗后 runner 定位二义安全中止，未重跑或执行业务决定，PRQ/Inventory/Allocation/全部下游不变，故最终为 `MAIN UAT NOT VERIFIED`
- SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16 已在 purchase 对象范围内以单一只读快照实时汇总 MAIN 全部 Inventory 位置、Inventory 正式预留/冻结、有效计划库存分配、有效 PO/Delivery Plan 剩余量和有效在途分配；快照、当前值和差异明确分区，模型未记录项诚实标注。接收确认打开前重新查询，四个 Material 分别展示当前摘要；主 UAT 仅登录 purchase、打开详情及确认后取消，四条当前供应九项均为 0，PRQ 仍待接收且库存、Allocation、Purchase ACCEPT/RETURN 和全部下游不变
- SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15 已补齐 purchase 对象范围内 Package ACCEPT→Plan→PRQ SUBMIT 的关系化谱系、提交时库存/在途分配快照与当前供应分栏、PRQ 非独立版本和两类说明未采集的诚实空状态；接收/退回确认具备默认取消、ESC/关闭零业务请求、同步双击保护、服务端权限/CSRF/Origin/CAS/幂等/状态门禁和 390px 卡片布局。主 UAT 仅登录 purchase、打开 `PRQ-00000001` 详情及接收确认并取消，PRQ 仍待采购接收，Purchase ACCEPT/RETURN 与全部下游为 0
- SELFHOST-OPS-UAT-PLANNING-HANDOFF-CONFIRMATIONS-FIX-14 已补齐 Planning ACCEPT 和 Engineering RESUBMIT 的完整谱系、固定快照、后果与下一阶段确认；安全默认焦点、取消/ESC/关闭零请求、同步双击保护、稳定 Package ID、成功凭证、焦点约束和 390px 固定操作区通过。既有服务端权限、CSRF、Origin、CAS、幂等和状态门禁未放宽；主 UAT 只登录 planning、打开 v2 确认并取消，Package 2/v2 仍 SUBMITTED、ACCEPT 0，下游计划/采购需求 0
- SELFHOST-OPS-UAT-PLANNING-DECISION-HISTORY-FIX-12 已补齐 Planning 待接收/已处理双视图、RETURNED/ACCEPTED 历史重开、Package 范围 CREATE/SUBMIT/RESUBMIT/RETURN/ACCEPT 证据、决策确认、服务端完成凭证与 390px；Product/BOM、Unit Resolution、Material 终态快照继续只读，权限/版本/Migration 不变。主 UAT 只登录 planning 并只读确认 1/v1/RETURNED、RETURN 1、ACCEPT 0、v2 0 后退出；数据库 ASCII 原因与全角预期仅两处标点差异，NFKC PASS、LOW、历史未修改
- SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07 已按 D-086 交付 alpha.37/0036：Unit Resolution Version 只追加、Head 按 Requirement Item 独立 CAS、Package Item 固定精确 resolution provenance；enabled Unit、权限、Origin/CSRF、幂等、审计与事务回滚均由服务端保护。隔离写旅程和迁移/恢复门禁通过后已部署并行非生产 UAT；该任务完成时主 UAT Requirement Unit 仍 pending、Resolution/Package 均为 0，后续 FIX-08 当前事实以本文件顶部为准
- SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-FIX-06 只完成 Schema 缺口诊断并以 BLOCKED 收口：当前需求行 `unit_id=NULL/unit_pending=true`，0034 Product/BOM Resolution 不保存单位，快照 INNER JOIN 排除该行后误报统一错误；源需求不可变，禁止写回或从 BOM 猜 PCS。proposed D-086 定义 0036 Unit Resolution 版本事实、独立 CAS Head 和 Package provenance；未改代码/Migration/主库/部署，Package 保持 0
- SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05 修复 Planning 路由未被共享客户端识别而丢失 `X-CSRF-Token`/调用方幂等键的根因；发送时读当前 CSRF Cookie，页内键绑定当前 Token+正文并在会话变更时清空。RELEASED BOM 只显示四行事实，POST/PATCH/DELETE 皆由服务端以 `BOM_RELEASED_IMMUTABLE` 拒绝；BOM 首页空选择且搜索有界。alpha.34/0034 Web `sha256:7e0a3040acd1...` 已部署，主库 UAT Handoff 未创建
- SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 将兼容 BOM 页从旧字段/全量长下拉改为服务端有界 code-first 候选，显示 `正式编码 · 名称 · 单位` 并只提交稳定 material_id/unit_id；保存和发布事务重新校验 ACTIVE、正式编码、enabled 主单位与重复物料。Product Version、BOM Version、状态及“BOM 属于产品版本；项目在计划交接关联”已明确，复用真实发布服务。该 FIX-04 验收时部署 alpha.34/0034 Web `sha256:cb6a5c1...`，四码浏览器各唯一命中，且当时 UAT BOM/Planning 均为 0
- SELFHOST-OPS-PUBLIC-IP-CUTOVER-07 根据项目负责人明确“切换”授权，把 Caddy `ERP_DOMAIN` 与 Web 单值 `ERP_PUBLIC_ORIGIN` 从旧 IP 名称同步更新为 `43.135.148.43.nip.io`；原镜像串行重建 Web/Caddy，新 Let's Encrypt 证书、外部 18888、HTTP 308、HTTPS 200、匿名 401、安全头和旧 SNI 退役通过。PostgreSQL/Worker、0034、核心聚合和四卷未由本任务改变
- SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY 在不扩大 operations 权限的前提下补齐原生审核详情的提交人/时间/说明、范围、决策后果和 BOM 下一步，Dashboard 以 `PENDING_REVIEW` 精确显示 4 项并链接原生队列；经营、Material 和 legacy 页面在 pagehide/pageshow/back_forward 下 fail closed，受保护响应统一 private/no-store。alpha.34/0034 最小 Web hotfix 已部署，真实 Chromium 双入口 logout/back/forward/refresh 通过，533—536 未改变
- SELFHOST-LANDING-TASK09 在现有 PostgreSQL 供应商导入 Parse/Mapping 之上增加服务端 `CYD-MATERIAL-13C-v1` 确定性投影、分页预览和受会话保护的 UTF-8 CSV；模板精确命中时直通，其他来源只采用明确表头、当前 Mapping 和可证明标题/替代标记，未知留空。解析准备完成后页面默认进入“标准整理”，高级 Mapping、Normalization 和 Review 继续保留；alpha.36 源码未部署、未写业务数据
- SELFHOST-LANDING-TASK08 发布大批量物料分批标准化 SOP V1：固定 `CYD-MATERIAL-13C-v1`、规则包、默认批次上限、一批一任务/一对话、结构指纹映射档案、私有总索引/批次卡/manifest、人工批准门禁、临时/批准两级汇总和跨对话指令；仅流程设计，通用执行器与新资料批次尚未开始
- SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02 只为 operations 增加人工审核 queue/approve/reject 三项能力；队列、详情和按钮使用同一 PENDING_REVIEW 权威口径，工程创建人继续不可自审，正文不可代编辑。legacy 清洗入口明确退役，Dashboard 标注全局 DRAFT+PENDING_REVIEW。alpha.34/0034 最小 Web hotfix 已部署，Chromium 只读确认 533—536，未执行审核动作
- SELFHOST-LANDING-TASK07 以 `moban.xlsx` 的 `原BOM -> Sheet1` 为真实行组转换示例，对全部来源分别输出同一 13 列标准页并合并为 591 行 `全部物料汇总`。模板 53/53 行证据与用量通过，591 行可追溯，94 条差异/缺项单列；57 行用量和 21 行板型不猜测，未写数据库、审核编码或部署
- SELFHOST-LANDING-TASK06 以 `moban.xlsx` 第二张 `Sheet1` 为唯一整理标准，对 8 份来源的既有 root-only 分类证据生成 `内部物料库.xlsx`。532 个既有正式编码原样沿用；147 个来源候选、45 个模板候选和 1 个版本冲突保持待确认。953 条非归档来源及 53 条模板逐行可追溯；未写数据库、审核物料或部署
- SELFHOST-OPS-UAT-BLOCKER-FIX 以显式 UAT deployment class 和严格双端 loopback 判断兼容 SSH/浏览器转发，生产继续只接受精确可信 HTTPS Origin；经营/兼容工作台统一安全 POST logout、失败可见。隔离回归、alpha.34 API smoke、备份恢复及真实 Chromium 创建临时 manager、双入口 Session 撤销/成功审计/重新登录/页面停用均通过，未运行 Migration 或开始角色试用
- SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 根据项目负责人明确授权，仅为 `admin2` 清除 must-change 并以 CAS 把 version 2→3；密码二次指纹与合法 Session 不变，新增唯一专用 Identity Audit，重放 no-op。D-045 全局新建/重置用户强制首次改密策略和 API 均未修改
- SELFHOST-OPS-TRUSTED-ORIGIN-05 用规范化、单值 `ERP_PUBLIC_ORIGIN` 修复 TLS 终止后浏览器 HTTPS Origin 与 Web 内部 HTTP URL 不一致的误拦截；不信任任意转发头，Cookie/Header CSRF 双提交、Session、幂等和审计保持。基于 alpha.34 的最小 Web hotfix 已部署，0035 未应用
- SELFHOST-OPS-ADMIN-ACCOUNT-04 通过现有 Identity Service 新增第二 active admin `admin2`；首次弱密码被原子拒绝，合规临时密码创建成功。创建时摘要误入工具输出后立即经正式 reset 生成新盐并失效；最终 version 2、首次改密，既有管理员/Session/业务/Migration/部署不变
- SELFHOST-LANDING-TASK05 对单个 V9 XLSX 完成 SHA 绑定只读解析、显式字段门禁、pre-clean custom dump/list/213 表恢复、隔离 staging 与重放。197 个编码/来源有效但显式单位 0、BOM 结构 0，因此 197 条全部 review，拟删除 5,556 条计划未执行，主库逐表计数完全不变
- SELFHOST-PHASE6-TASK01 新增 `bom-material-governance-v1`、精确十进制量纲、RES/CAP/IND/型号敏感/CON 严格规格身份、0035 九张治理表、候选与异常报告、受控 `BIND_EXISTING/CREATE_DRAFT/EXCLUDE` API；归并只发生在完整身份严格相同时，替代项只是候选。该任务交付时仅源码/Schema/隔离测试；0035 后由 IMPLEMENT-07 作为 0036 前置 migration 应用到并行非生产 UAT，仍未处理真实 BOM 治理数据
- SELFHOST-LANDING-TASK04 已删除兼容业务台 CSV-only/已退役的一步导入入口，将“供应商导入”直达 `/materials/imports/new`；入口统一版本化且响应含 `private, no-store`/`Pragma: no-cache`。Dashboard 12/12、Import UI 102/102、Parser 38/38 与镜像/在线静态合同通过；公网 HTML/JS SHA 与源码一致。未做 Excel→PostgreSQL E2E；其 legacy 壳的框架冗余 public cache 头已由 MATERIAL-REVIEW-BLOCKERS-03-RETRY 精确消除
- SELFHOST-PHASE5-TASK10 已在同一并行环境交付 `0.1.0-alpha.34`/`0034`，把 IQC 管理的 Purchase Receipt Line 稳定绑定 Supplier Receipt Inventory Lot。主链 `10×12 CNY` 收货即 `on-hand/frozen/available=10/10/0`，IQC `10/8/2` 后 RELEASE 8/Close 为 `10/2/8`，Source 120、AP/Production Issue 0；独立 3 件支线沿原 Lot 全额冲销为 REVERSED，已有 IQC 的主链冲销 409。真实 HTTP、重启、接受态第二库恢复、最终 clean-0034 恢复和缓存清理通过；未启动后续任务
- SELFHOST-PHASE5-TASK09 已在同一并行环境交付 `0.1.0-alpha.33`/`0033`，把 BATCH Completion→Allocation→FQC→Shipment/FQC Consumption/Inventory Ledger 全部绑定同一稳定 Inventory Lot。实际 Lot A/B `4/6`、冻结 B 2 后拒发 6 零半记录、解冻后发 B 6、冲销 A 4 并从同一 A 再发 4，最终有效 Shipment/FQC `4/6`、Source 200、AR/Settlement 0；ORDER null Lot、整栈重启、接受态第二库恢复、最终 clean-0033 恢复和资源清理通过。后续 TASK10 已在独立授权下完成
- SELFHOST-OPS-PARALLEL-DB-CREDENTIAL-ROTATION-03 已在不重启 PostgreSQL、不修改 Schema/Migration/业务代码的前提下轮换并行非生产数据库角色密码与 `/etc/chenyida-erp/parallel.env`，串行恢复 Web/Worker；新密码 `SELECT 1` 成功、旧密码 SCRAM 认证 `28P01`，唯一合法 LOGIN 审计和 ACTIVE session 保持 1/1。该任务建立的 baseline-delta 规则已由后续 TASK09 遵守
- SELFHOST-PHASE5-TASK08 已在同一并行环境交付 `0.1.0-alpha.32`/`0032`、唯一 Finished Goods Inventory Lot、稳定 Batch 一对一映射、Lot Ledger/Balance/Material Aggregate、freeze/unfreeze 和 Completion 原 Lot 冲销恢复；实际 Batch A 4 / Batch B 6、Material 10、ORDER 空 Lot 兼容、重启、停服备份/固定第二库恢复、Build Cache 回到 0B 和最终清理通过。Shipment/FQC Lot 是该任务结束时的明确排除，已由后续 TASK09 在不扩大原材料/供应商/Receipt/领料 Lot 范围下扩展
- SELFHOST-OPS-DOCKER-CACHE-CLEANUP-02 在默认 `default*` builder 无构建任务时执行受控 `docker buildx prune --all --force`，清理 25.11 GB BuildKit cache，并逐个核验后删除唯一无引用 dangling image `sha256:ccce71ed69856b11e1980148ad4ed6aa5183012cab1a7a68dd121719413f6612`；镜像空间 27.45→6.511 GB、根分区可用 14→37 GiB。三 ERP 容器、四卷、Trae/MySQL、匿名卷、tagged image、备份、Python/SQLite 与数据库均保持，未启动 TASK08
- SELFHOST-OPS-RESOURCE-GUARD-01 完成低资源永久规则、Python 16 活跃请求线程上限/有界 503、Compose 六服务 CPU/Memory/Swap/PID 限额、Web/Worker 384 MiB Node heap 和 systemd 源限额；PostgreSQL 备份校验、串行原镜像更新、60 秒 OOM/restart/Swap 观察和四卷保持通过。Python 当前 PID 未重启，资源保护不等于生产上线
- SELFHOST-PHASE2-TASK01 完成 docs-only 盘点：Python 共 64 个 HTTP 操作（GET 34、POST 30），自托管等价覆盖 4、部分覆盖 9、未覆盖 51；根 legacy iframe 登录后并发的 23 个业务 GET 在 Node/PostgreSQL 均返回 404。已提出 TASK02—TASK10 依赖顺序，全部仍待逐项授权；没有业务域因此完成迁移
- SELFHOST-PHASE2-TASK02 完成自托管身份安全边界：独立 Identity Repository/Service/Handler，用户创建/列表/启停/重置、本人改密、会话撤销、must-change 全局门禁、登录与身份写限流、持久幂等、CAS/最后管理员保护、有界系统审计和生产强制 Secure Cookie；`0006`、隔离 PostgreSQL 17、Compose 生命周期/重启与指定回归通过，未发布或部署
- SELFHOST-PHASE2-TASK03 完成自托管主数据与 BOM：`0007`、关系化 Customer/Supplier/Product/Product Version/BOM Header/Version/Line、稳定 Supplier Mapping/价格历史、发布不可变、结构 readiness、服务端能力/CSRF/幂等/CAS/限流/审计；隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.3`，未迁真实数据、部署或访问生产
- SELFHOST-PHASE2-TASK04 完成自托管通用库存账本：`0008`、稳定 Material/Unit ID、不可变 Ledger、事务余额投影、入/出/盘点、冻结/解冻、全额冲销、负库存/CAS/行锁/幂等/审计；隔离 migration、PostgreSQL/API、Compose 重启和适用回归通过，版本 `0.1.0-alpha.4`，未回填真实库存或实现下游业务单据
- SELFHOST-PHASE2-TASK05 完成自托管采购链路：`0009`、关系化 PO/Receipt/状态事件/财务来源、BOM 缺料建议、部分/全部收货和全额冲销；收货原子复用 TASK04 Ledger/Balance，隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.5`，未迁真实 PO/在途或创建应付/付款
- SELFHOST-PHASE2-TASK06 完成自托管生产链路：`0010`、关系化 WO/BOM 快照/需求/领退料/报工/完工；领退料和完工原子复用 TASK04 Ledger/Balance，隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.6`，未迁真实生产数据或创建品质/财务过账
- SELFHOST-PHASE2-TASK07 完成自托管销售链路：`0011`、关系化 Quote Version/Line/状态事件、ACCEPTED 原子转 SO、Shipment/全额冲销和稳定金额来源；发货/冲销原子复用 TASK04 Ledger/Balance，隔离 migration、PostgreSQL/API、Compose 重启和全回归通过，版本 `0.1.0-alpha.7`，未迁真实销售数据或创建应收/收款/品质过账
- SELFHOST-PHASE2-TASK08 完成自托管品质闭环：`0012`、关系化 IQC/IPQC/FQC、Result/Defect/Event、异人处置/关闭/重开及 FQC 发货门禁；隔离 migration、PostgreSQL/API、Compose 重启和适用回归通过，版本 `0.1.0-alpha.8`，未迁真实检验数据或伪造 IQC 库存隔离
- SELFHOST-PHASE2-TASK09 完成自托管财务闭环：`0013`、稳定 Shipment/Receipt 金额来源 AR/AP、不可变 Receipt/Payment/Reversal/Event、余额/状态/version 投影及上游冲销门禁；隔离 migration、PostgreSQL/API、Compose 重启和适用回归通过，版本 `0.1.0-alpha.9`，未迁真实金额或实现银行/税务/发票/汇率/总账
- SELFHOST-PHASE2-TASK10 完成自托管经营与运维工作台：实时只读 Dashboard 按权限聚合 TASK02—TASK09 权威关系表，原生根退出 iframe，legacy 工作区改为显式白名单深链；离线 backup/verify/新空目标 restore、去敏只读状态、隔离恢复与 Compose 重启通过，版本 `0.1.0-alpha.10`，未新增 `0014`、未执行生产动作
- SELFHOST-PHASE3-TASK01 完成显式迁移 CLI、SQLite/D1 export adapter、PostgreSQL 隔离 staging、manifest、稳定 ID map、checkpoint、合成 dry-run/commit/reconcile、拒绝守卫和跨域恢复证据；版本 `0.1.0-alpha.11`，0001—0013 不变，真实数据与生产保持 NO-GO
- SELFHOST-PHASE3-TASK02 完成 `0014` 关系化 Migration Opening Source、库存期初 Ledger/Balance、财务 `OPENING_AR/AP`、一次全额冲销、内部事务入口及 Dashboard 汇总；MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`，版本 `0.1.0-alpha.12`，真实数据与生产保持 NO-GO
- SELFHOST-PHASE3-TASK03 完成受控 public materializer、actual target ID/provenance、合成文件、snapshot/archive 分类、正常全域 API/Dashboard、backup→新空目标 restore、同 manifest 重放与整栈重启；版本 `0.1.0-alpha.13`，migration 保持 `0001`—`0014`，结论仅为 `PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`，真实数据与生产保持 NO-GO
- SELFHOST-PHASE3-TASK04 完成获准本机 SQLite online backup、integrity/Schema fingerprint、29 表 3,619 条脱敏聚合、无 PostgreSQL 目标 planner 和人工处置模板；源与 Python PID 不变，临时快照已删除，版本 `0.1.0-alpha.14`，migration 保持 `0001`—`0014`，结论仅为 `REAL LOCAL SQLITE READONLY INVENTORY COMPLETE`
- SELFHOST-PHASE3-TASK05 以 `chenyida-erp-parallel` 在同机启动 PostgreSQL 17/Web/Worker，Web 仅 `127.0.0.1:3000`、数据库无宿主端口；14 个 migration、管理员、空 Dashboard、23 GET、重启持久性和资源门禁通过，并修复 Worker 在 PostgreSQL 重启时的空闲连接未捕获错误。Python PID/18888/SQLite 元数据不变；仅为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`
- SELFHOST-PHASE4-TASK01 已在 `chenyida-erp-parallel` 交付 `0015`、独立 Project Service/API、市场/项目原生页面、不可变需求修订与交接事件；双账号直接接收和退回修订重提、重启持久、清理恢复及全回归通过。测试业务已清空，Schema/唯一管理员保留；不启动 TASK02
- SELFHOST-PHASE4-TASK02 已在 `chenyida-erp-parallel` 交付 `0.1.0-alpha.16`/`0016`、正式 planning 角色、显式 Requirement Resolution、不可变版本交接包/BOM/文件快照、独立 API 和 engineering/planning 原生页面；实际 v1 退回→修订 v2→重提→接收、重启持久与恢复清理通过，最终仅保留 Schema/唯一管理员，不启动 TASK03
- SELFHOST-PHASE4-TASK03 已在 `chenyida-erp-parallel` 交付 `0.1.0-alpha.17`/`0017`、固化包 Material+Unit 聚合、提交时 PostgreSQL numeric 锁定重算、独立库存/在途 Planning Allocation、不可变需求计划/采购申请、planning/purchase 原生页面与 Dashboard 待办；实际 v1 退回释放→v2 重算重提→采购接收、重启持久和恢复清理通过，正式 `reserved_qty` 不变且未创建新 PO/收货/工单，最终仅保留 Schema/唯一管理员
- SELFHOST-PHASE4-TASK04 已在 `chenyida-erp-parallel` 交付 `0.1.0-alpha.18`/`0018`、RFQ Round、不可变报价版本、服务端确定性比较、人工 Sourcing Award/撤销、独立 API/原生页面和 Dashboard 三项待办；A 高价准时、B 低价晚交的人工交期优先定标、重启持久和恢复清理通过，最终仅保留 18 migrations/唯一管理员，不创建 PO/收货/库存/应付，不启动 TASK05
- SELFHOST-PHASE4-TASK05 已在同一并行环境交付 `0.1.0-alpha.19`/`0019`、Award Line→PO Line、到货计划/待入库、Receipt 分配关系、分批收货、库存与财务来源、显式 AP 和三条原生页面；实际 `10×12` 分两批 `4/6`，来源/AP 为 `48/72`，重启与新空库恢复通过，最终仅保留 19 migrations/唯一管理员，未启动生产或品质
- SELFHOST-PHASE4-TASK06 已在同一并行环境交付 `0.1.0-alpha.20`/`0020`、版本化 Production Handoff、唯一工单链接和生产库存 Reservation/Event；实际 v1 退回→v2 接收、释放预留 10、分批领料 4/6、整栈重启、停服备份/新空库恢复和最终清理通过，报工/完工/成品/品质事实均为 0
- SELFHOST-PHASE4-TASK07 已在同一并行环境交付 `0.1.0-alpha.21`/`0021`、Report→Completion Allocation、基于净领料的报工支持量、分批成品入库和 Report/Completion 追加式全额冲销；实际 Report `4/6`、Completion/Allocation/Ledger `4/6`、成品 10、工单 COMPLETED，下游 0，整栈重启、双备份/新空库恢复和最终清理通过
- SELFHOST-PHASE4-TASK08 已在同一并行环境交付 `0.1.0-alpha.22`/`0022`，复用既有 Quality 权威建立 Completion Line→Sales Order Line 稳定 Allocation、IPQC/FQC 稳定来源、处置关闭和订单行放行额度；实际 Report/Completion/Allocation/IPQC/FQC 均为 `4/6`，FQC inspected/passed/released=10、available=10、成品库存保持 10，Shipment/销售金额来源/AR=0；整栈重启、停服备份/新空恢复和最终清理通过
- SELFHOST-PHASE4-TASK09 已在同一并行环境交付 `0.1.0-alpha.23`/`0023`，复用 Sales/Quality/Inventory/Finance 权威建立发货指令、Shipment Line→FQC Release 精确分配和显式 AR 交接；实际 Shipment/FQC `4/6`、成品库存 `10→6→0`、Sales Source/AR `80/120`、Settlement 0，整栈重启、停服备份/新空恢复和最终清理通过
- SELFHOST-PHASE4-TASK10 已在同一并行环境交付 `0.1.0-alpha.24`/`0024`，复用 Finance Settlement/Reversal 并沿稳定 Sales/Purchase Source 归属 Project/Currency；实际 AR `80/120`、AP `48/72`、收款 `30/50/120`、付款 `48/30/42`、来源 `200/120`、未结 0、净现金 80、UNATTRIBUTED 0，整栈重启、停服备份/新空恢复和最终清理通过，不宣称会计利润
- SELFHOST-PHASE5-TASK01 已在同一并行环境交付 `0.1.0-alpha.25`/`0025`、稳定 Work Center、Product Version Routing 审核发布与 Work Order Release 不可变 Routing Snapshot；实际四工作中心、v1→v2、两张工单分别固化 v1/v2、BOM/Reservation/Route Snapshot 原子，整栈重启、停服备份/新空恢复与清理通过，未执行工序或库存过账
- SELFHOST-PHASE5-TASK02 已在同一并行环境交付 `0.1.0-alpha.26`/`0026`、Snapshot Operation 权威派工、Run/Event/Report/Reversal 不可变事实和线性 WIP 投影；实际四工序以 `4/6` 两批贯穿，每工序 processed/good/scrap=`10/10/0`，工序间剩余 WIP 0、末工序待最终报工 10，Work Order 仍 IN_PROGRESS，Production Report/Completion/成品库存/IPQC/FQC 均为 0；重启、停服备份/新空恢复和最终清理通过
- SELFHOST-PHASE5-TASK03 已在同一并行环境交付 `0.1.0-alpha.27`/`0027`，以稳定 `production_report_operation_allocations` 消费末工序 Run Report good，复用既有 Production Report、Report Receipt Projection、warehouse Completion、Report→Completion Allocation 和 Inventory Ledger/Balance；实际 `4/6` 正式报工与 `4/6` 成品入库使 Work Order 达到 `10/10/10/0/10 COMPLETED`，IPQC/FQC/Shipment/Sales Source/AR 均为 0，冲销/并发/幂等/CAS/权限/故障门禁、重启、停服备份/新空恢复与最终清理通过
- SELFHOST-PHASE5-TASK04 已在同一并行环境交付 `0.1.0-alpha.28`/`0028`，Routing Operation 的 `NONE/IPQC` 随发布 digest 和 Work Order Snapshot 固化；显式稳定 Run Report 来源 IPQC 经 Result/Disposition/Close 后形成下游额度。实际 REFLOW good `4/6` 先 Hold 10、AOI available 0，再按 `4/6` 检验放行为 Hold `10→6→0`、AOI available `0→4→10`，最后复用 TASK03 Report/Completion/Ledger `4/6`、Balance 10、Work Order `COMPLETED`；重启、恢复和最终清理通过
- SELFHOST-PHASE5-TASK05 已在同一并行环境交付 `0.1.0-alpha.29`/`0029`，稳定 IPQC failed 形成唯一 NCR，quality 以不可变提交快照准备返工申请，production 接收/退回，manager/admin 可追加不写库存的最终工序 SCRAP。实际 inspected 10/passed 8/failed 2、AOI available 8、Hold 2、v1 RETURNED、v2 ACCEPTED、accepted rework 2、unresolved 0；未创建返工 Run、额外报工、成品库存或下游销售/财务事实，重启、恢复和最终清理通过
- SELFHOST-PHASE5-TASK06 已在同一并行环境交付 `0.1.0-alpha.30`/`0030`，复用既有 Operation Run/Report、Quality、WIP、Production Report、Completion 和 Inventory 权威执行显式返工。实际原检 `10/8/2/8`、REFLOW REWORK `2/2/0`、复检 `2/2/0/2`、AOI `8/2`、Ledger `+8/+2`、Balance 10，Execution COMPLETED、NCR RESOLVED；正常 REFLOW 加工次数 10+2 而净产品仍为 10，重启、固定第二库恢复和最终清理通过
- SELFHOST-PHASE5-TASK07 已在同一并行环境交付 `0.1.0-alpha.31`/`0031`，建立 Manufacturing Batch Set/Batch 身份、发布 digest、按 Batch 的 NORMAL/REWORK、WIP/Quality/NCR/Rework/Report/Completion/Inventory 关联和稳定 genealogy。实际 Batch A 4、Batch B 6；B 原检 `6/4/2/4`、同批返工 `2/2/0`、复检 `2/2/0/2`，REFLOW 加工次数 8 而净 Batch 量 6；两笔 Ledger `+4/+6` 的 `lot_code` 仍为空、MAIN Balance 10。生产批次谱系已建立，但仓库批次库存尚未启用；重启、固定第二库恢复和最终清理通过
- 多用户登录、会话、角色权限、密码修改、账号管理和操作审计
- 物料、供应商映射、CSV 导入、清洗队列和新物料建档基础流程
- 客户、供应商、产品、BOM 和 BOM 齐套分析
- 采购建议、采购订单、收货、库存余额和库存调整
- 工单、领料、完工和生产报工
- 询价、报价、销售订单和发货
- 品质检验、缺陷记录、财务单据、收付款和经营看板
- 本地备份/恢复入口及在线同库快照入口
- 根仓库可直接恢复 `chenyida_erp_site/` 完整源码；生产 `2b4f178` 与开发基线 `9f2c2dc` 的提交关系已保留
- development/test/production 统一环境清单、本机一次性 Miniflare D1、生产 URL 拒绝、测试数据销毁和凭证扫描基线
- Material Master V2 数据契约与迁移框架：12 张关系表、Drizzle schema、`0001` Up/Down、快照和隔离迁移测试；未接入业务或生产
- Material Master V2 行业基础：`material-category-v1` 提供 101 个四级分类节点、34 个属性定义、39 个叶子模板和 228 条显式绑定；只允许 test/local 初始化
- Material Master V2 独立物料校验：Repository + Rules + Service 三层按 D1 metadata 校验基础字段、四级叶子、必填、类型、单位和枚举；25 个结构化 code、28 个校验测试；已由草稿/审核写服务调用并通过 Draft/Review API 间接开放
- Material Master V2 草稿/审核写服务：六模块封装类型化属性、`DRAFT -> ACTIVE`、拒绝历史、版本/审计、编码序列 CAS、乐观锁及 metadata/属性守卫；12 个隔离 D1 服务测试通过，已由 Draft/Review API 调用，尚未接生产
- Material Master V2 Draft/Review/Lifecycle API：八个精确路由复用现有会话，支持完整替换编辑、提交/重新提交、审核队列、批准和驳回；实施细粒度权限、创建人/最后修改人职责分离、Origin/CSRF、24 小时持久幂等、60/20 限流、乐观锁、1095 天 API 审计及 `0002`/`0003` 隔离迁移；未接生产
- Material Master V2 Reference & Query API：方案 A 已实现统一 `/materials`、收紧 `/drafts` 行级可见性并保留独立 `/review-queue`；完整启用分类 tree/flat、四级叶子 Schema、内容摘要 ETag、有界详情摘要、独立历史分页、批量 metadata 与稳定错误均通过隔离测试；未接生产
- Material Detail 最近驳回投影：`/materials/:materialId` 与 `/drafts/:materialId` 复用统一 Query Service，从完整不可变 `material_versions` REJECT 历史按版本、审核时间和事件 ID 确定性 `LIMIT 1` 投影；无记录为 null，损坏历史 fail-closed；未改 Schema、migration、索引或写服务
- Material Master 只读管理界面 V1：四条原生 Vinext 路由实现高密度列表、分区详情、独立历史页签、URL 状态、安全返回、状态/属性/Validation 展示和完整加载/空/错误状态；legacy 与新页面共用浏览器请求边界和现有登录流程；未接生产
- Material Draft 创建、编辑与提交审核界面 V1：实现 `/materials/new`、`/materials/:materialId/edit`、布局 C、Schema 驱动五类属性与完整 PATCH、PATCH/GET/submit、权限入口、页面内存幂等安全重试、VERSION_CONFLICT 对照、Schema 漂移/未知属性/dirty/驳回信息保护；54 项 UI 验收与隔离浏览器链路通过，未改 API、Schema、Migration 或业务服务，未接生产
- Material Review Queue 与审核工作台 V1：实现 `/materials/review`、`/materials/:materialId/review`、服务端分页 URL 队列、方案 A 完整只读工作台、共享详情展示、批准/驳回、Validation 新鲜度确认、职责分离、页面内存幂等/结果未知/并发/离开保护及 51 项 UI 验收；未改 API、Schema、Migration、索引或业务服务，未接生产
- 自托管 Material Draft/Review/Active PostgreSQL 全链路：新增 `0002` 编码序列、状态/编码约束和历史/队列索引，独立 Repository/Service/API，固定审批状态机、类型化属性、职责分离、CSRF、24小时持久幂等、乐观锁、原子编码、版本/变更/审计及真实页面审计入口；隔离单元 6/6、UI契约 2/2、PostgreSQL/API 7/7、既有Material UI 142/142、Compose双用户审批和重启持久性通过；已随 `39946f6` 提交，未接生产
- 自托管 Import Mapping/版本/复用 PostgreSQL 全链路：新增 `0003`、parse run绑定、动态Catalog、源结构/metadata/mapping摘要、不可变确认快照、同批次版本/SUPERSEDED、跨批次复用/STALE、事务幂等与Event/Audit；Worker原子发布初始DRAFT，现有工作区显示版本历史和显式复用。专项规则3/3、UI2/2、PG/API6/6、旧数据升级1/1、Compose解析→v2确认与重启持久性通过；已随 `39946f6` 提交，未接生产
- 自托管行级 Normalizer 与 Normalization Review PostgreSQL 全链路：新增 `0004`，关系化保存核心字段候选、动态属性候选、lineage 和稳定 issue；独立 Repository/Service/API/Worker 支持 run history、同 run 重试、新版本重跑、取消、100 行分块暂存和 Job/业务结果同事务原子发布，现有 Review UI 支持历史切换和证据查看。专项 12/12、既有回归 41/41、空库/升级迁移、Compose v1→v2→取消及整栈重启持久性通过；已随 `39946f6` 提交，未创建 Draft、迁移真实数据或接生产
- 自托管 Material Import 人工复核 PostgreSQL 闭环：新增 `0005` 十一张关系表，分离 raw/candidate/manual effective，支持 Session/version、字段和动态属性 SET/CLEAR/REVERT 历史、Issue resolution、保留/排除、ACTIVE 精确绑定、Material Draft 人工选择、sealed finalization、100/50 行 Worker 分块、CAS/幂等/租约和失败恢复；调用 TASK01 Material Service 创建未编码 DRAFT，ACTIVE 不被修改。专项 13/13、101 行跨 chunk、既有回归、Compose 端到端及整栈重启持久性通过；已随 `39946f6` 提交，未迁移真实数据、接生产或部署
- Material Import Batch Foundation V1：12 项决定已批准；新增 `0004` 五表数据契约、Drizzle schema/快照/Down、可注入对象存储与 R2/内存适配器、10 MiB 流式 multipart、XLSX/CSV 文件级安全检查、六个 API、专用幂等、可恢复 Saga、权限/行级可见性、重复策略、取消和手工清理服务；未创建生产资源、Cron、迁移或部署
- Material Import Parser 与 Mapping V1：16 项决定已批准并完成非生产实现；新增 `0005` Up/受保护 Down、parse run/Sheet/Shared Strings/Outbox/Mapping 关系模型、有界 XLSX/CSV Parser、可注入调度与租约恢复、原子发布、Mapping 准备及七个 API；54 项专项与全量 Node 278/278 通过，未创建生产资源、执行生产迁移或部署
- Material Import Workspace UI V1：完成三条路由、状态驱动 Stepper、opaque cursor、文件预检、增量 SHA Worker、受控 multipart XHR、解析轮询/取消、Sheet/Rows/Header、三列 Mapping 保存/预览/确认和 confirmed 只读；UI-001—UI-100、50×256 Playwright 门禁与 Node 440/440 通过，未接生产
- Material Import Mapping Target Catalog V1：12 项决定已批准；实现批次作用域 `GET .../:batchId/mapping-targets`、BASIC/ATTRIBUTE/SPECIAL DTO、运行时 D1 ACTIVE 属性、共享 Target Registry 与 Metadata Snapshot/digest、有界搜索/cursor、read+map/行级可见性、no-store、读取限流和安全审计；51 项专项与全量 Node 339/339 通过，未改 Schema/Migration/前端或生产环境
- Material Import Normalization & Staging V1：16 项决定已批准；实现独立 normalization run、版本化 JSON 行快照、独立 issue、Mapping/Metadata 绑定、确定性类型与空值语义、Outbox/租约/心跳、原子 pointer 发布、不同 processor 版本重跑、取消清理、五个 API、权限/限流、`0006` Up/受保护 Down/Drizzle 快照及隔离测试；未创建 Draft/正式物料，未接生产
- Material Import Normalization Review UI V1：统一 Batch 工作区、七步 Stepper、`current_run/latest_attempt` 双轨状态、启动/重试/重跑/取消、Rows/Issues opaque cursor、批次作用域 Row Drawer、安全有界值、权限清理和 104 项测试已完成；50 Rows、100 Issues、200 Attributes、1366/700px 本地门禁通过，未改变 API/Schema/Migration/生产环境
- Internal Material Library V1：复用既有 `material_master` 而非创建第二套；`0007` 新增标准单位/别名、品牌/别名、Normalization Approval、Import Row→Draft 关联和重复候选，并为 Material 增加结构化单位、品牌及批次/文件/行来源外键；Approved Normalization 可经既有 Validation/Draft Service 创建无正式编码的 `DRAFT`，后续仍由既有人工提交/审核生成 `ACTIVE` 和正式编码；inspect/dry-run/commit/report、权限、CSRF、幂等、EXACT/HIGH_CONFIDENCE/POSSIBLE 候选及隔离测试已完成，未导入真实文件或接生产
- Material Import 真实数据治理增强：新增本地只读 `.xlsx/.csv` inspect，输出文件 SHA/大小、Sheet/CSV 行列、编码/分隔符、表头候选和可能标准字段且不回显业务行；Draft dry-run 显式返回分类/单位/品牌 `EXACT/MATCHED/NEEDS_REVIEW`，EXACT 重复直接阻断、HIGH_CONFIDENCE 保持待人工确认阻断，CLI 只输出整批安全计数汇总；未改 Schema/Migration 或导入任何真实/模板数据
- Material Import 多供应商自适应识别 V1：`0008` 在既有 Parser/Mapping/Normalization 上增加全部可见 Sheet、前 50 行、1～3 行及合并表头评分、集中别名、样本/Profile 加权、多来源规格、Canonical Row、可解释非数据行分类和空规格 Draft 阻断；后续 A118/V700 真实 BOM 促成错后缀告警兼容、BOM/变更记录分流和字段限定修正，全量 Node 593/593，未接生产
- A118/V700 真实 BOM 验证：V700 已高置信度选择 BOM 并识别规格/型号/数量；A118 已找到第 44 行表头和名称/规格/厂商料号/用量，但第 197～203 行延伸到 XFD，继续按 256 列门禁阻断且不静默截断；未提交样本、上传、dry-run 或创建 Draft
- 服务器本地 Excel/CSV 自适应导入：公网 Python 运行面接受 `.csv/.xlsx/.xls` 原始二进制，按内容签名解析全部 Sheet、前 50 行和 1～3 行合并表头，集中 Mapping 并确定性组合规格；本地 `0001` 保存批次、不可变原始行和 Canonical 来源/置信度，systemd 已使用项目虚拟环境部署
- A118/V700 正式 BOM 待审核入库：用户确认两份为正确表格后，`0002` 保存完整原文件归档和 warning；A118 314 行、V700 229 行进入清洗审核，543 行全部 `NEEDS_REVIEW`，内部物料数未变化
- 电容匹配测试基线：按项目负责人最终规格建立临时内部编码 1～5，结构化保存容量、误差、电压、封装和 PCS；清空旧 Cleaning Rows 后五条本地匹配均为对应编码、自动匹配 1.00
- 清洗审核匹配置信度排序：`/api/cleaning` 以白名单执行 newest/desc/asc 服务端排序，页面可切换高到低或低到高，同分按新记录优先
- 清洗审核安全清空：仅管理员可见和调用；双重确认后自动备份，在同一事务删除 Cleaning Rows 并写审计，保留 Batch/Raw/归档/物料/映射
- 规格唯一编号匹配：Description/物料型号进入 raw spec；名称不再参与编号评分，容量/阻值、误差、电压、封装等硬匹配，完整唯一才自动确认编号，部分唯一候选保持疑似，歧义不随机选码
- 1928C 分项规格匹配：原始规格、型号、描述、MPN 不先压成整体相似度文本；分别提取品类、封装、容量/阻值、耐压、误差、介质和 MPN，逐项硬比较并保存结构化 Cleaning 字段
- 清洗审核分项规格对照：来源与候选内部物料按同一组八项属性并排展示，未维护字段明确标识；厂商型号不再冒充规格，页面不承担匹配或确认规则
- 通用规格参数匹配：从规格/组合列/描述/名称中选择详细规格来源，保存完整 raw spec 和来源列；品类、封装、电气量、误差、材质和尺寸按类型化集合无序比较，MPN/品牌独立取证
- 规格精度门禁：大类不再构成编号证据；少于两类鉴别参数明确为“规格不足”，自动匹配要求双方至少三类参数、锚点、完整一致且候选唯一；扩展分数功率、范围、频率/阻抗、针数、间距、铜厚和接口等确定性参数

## 当前未完成模块

- PostgreSQL dump与uploads、attachments、backup-status文件卷的异机数据恢复锚点没有建立；TASK39已由项目负责人主动延期并行政关闭，单机数据恢复风险继续`OPEN`，未来必须重新立项和授权
- 大批量流程的通用批次执行器、来源档案注册表、init/resume/validate/consolidate 命令和代表性试点尚未实现；当前 TASK07 脚本只能作为已知 8 份来源的参考，不得直接宣称支持所有公司资料
- LANDING-TASK07 工作簿仍有 57 行单机用量和 21 行板型待人工补充，A200 4 处模板/旧版差异与 J587 标题版本冲突待业务确认；正式去重、内部编码、审核、数据库导入和下游 BOM 引用均未执行
- `PENDING_APPROVAL` 兼容值的破坏性收缩尚未实施；必须在旧值计数为零、旧实例全部退出且取得生产授权后另建任务
- break-glass 紧急审批、多节点会签和自动生产审计归档/清理调度尚未设计或实现
- 在线导入中心的真实样本 Sheet/表头/字段召回率、规格提取误判率、逐行冲突人工处置和大规模查询容量验收
- 新物料多角色审核节点、冻结/停用状态机和其他待确认职责分离规则
- 动态属性、单位换算、替代料及客户专用料的下游拦截
- SQLite、在线 D1 和治理模板之间的受控迁移与核对
- 独立生产备份、生产恢复演练、远程 Test D1 和完整应用安全测试
- AI治理、离线Evaluator、冻结合成评估集和当前确定性阈值档案已完成，但AI模型/API、Suggestion/Evidence候选层、AI建议人工审核工作台、非生产试点、AI采购/报价/生产辅助及行业知识库均未实现；外部AI保持禁用
- Material Master 只读页面尚未在生产 Site 发布；当前公开版本仍不具备本任务的新路由和查询 API
- Material Draft 页面尚未在生产 Site 发布；当前公开版本不具备创建、编辑或提交审核界面
- Material Review Queue 与审核工作台尚未在生产 Site 发布；当前公开版本不具备审核队列、批准或驳回工作台
- Material Import 已完成非生产 Normalization→Approval→Draft 闭环和本地文件 inspect；不自动分类、不自动建品牌、不自动合并。当前没有真实文件，HIGH_CONFIDENCE 候选只有阻断、尚无已审计的逐行解除流程；真实 dry-run、人工冲突处置、生产 Queue/binding、生产迁移和部署仍需独立授权
- 自托管人工复核、ACTIVE 绑定和 Material Draft Commit 已迁入 PostgreSQL；尚未进行脱敏真实供应商文件容量/冲突验收、旧数据试迁移、生产备份恢复或部署，Mapping 确认仍不会自动启动后续阶段
- Material Import Workspace 尚未在生产 Site 部署；生产公开版本不具备本任务三条路由。真实远程 R2/Queue、生产配额/冷启动、page_size=100 和低端终端容量仍未验收
- alpha.35 治理引擎对 `MECH/OTHER` 只能稳定分类为 `UNSUPPORTED`；历史 ACTIVE/FROZEN/INACTIVE 若缺 CAP 介质、IND 额定电流、CON 结构，或品牌/结构化属性冲突，只生成兼容检测与 fail-closed 阻断。本版本没有 ACTIVE 属性修订 API、治理 UI、正式替代料审批、真实回填或生产部署

## 当前风险

- Git与private GHCR镜像锚点已建立，但PostgreSQL dump及uploads、attachments、backup-status异机锚点仍不存在；TASK39的行政关闭不消除该单机数据恢复风险，也不代表production ready
- D-110关闭AI治理规格缺口，D-111只批准当前冻结本地确定性基线阈值，D-112只接受AI Suggestion/Evidence关系化合同；三者都不代表外部模型质量、供应商、隐私、地域、合同、凭据、真实数据、实现或试点获批。外部AI及候选层实现继续禁用，TASK03实施阶段与TASK04—TASK05仍须独立授权和验收
- UAT 临时 manager 已通过页面停用且未用于业务试用。首次浏览器验收脚本在停用后的刷新检查处提前结束，遗留一个已丢失令牌、等待正常 8 小时 TTL 的会话；按不可变审计和禁止直接 SQL 删除边界保留。两个目标 logout 与完整复验的旧 Session 均已立即撤销，不得把该脚本残留误述为 logout 失败。
- V9 表格 197 行虽有唯一连续 ERP 编码和完整来源追踪，但没有单位列，也没有产品版本、BOM 版本、BOM 行数量/位号结构；`使用次数` 不能作为数量。未经逐行显式单位与独立 BOM 契约，不得清空现有主库或导入这些行

1. 历史 Site 记录为 `v3` / `2b4f178`，但本任务未访问公开 Site，不能据旧文档声称当前在线状态；该运行面只保留为迁移与行为证据。
2. 本地 SQLite 与在线 D1 存在两套数据模型和两套物料编号行为，尚未确认唯一权威源。
3. 在线业务数据大量保存在 `erp_records.data_json`，关系约束、查询能力和迁移能力有限。
4. 本地数据库已从 Excel 导入任务开始建立版本化迁移历史，但既有 26 张表仍是历史运行时建表基线；默认账号、弱口令和公网 HTTP 仍是开发服务器高风险项。
5. 历史在线导入实现把导入行直接归为新物料，没有执行供应商映射或候选匹配；该行为只作迁移风险证据。
6. 历史在线备份位于同一 D1 故障域，不能替代外部灾备。
7. 历史 D1 测试基线只覆盖本机一次性 D1；没有远程 Test D1 权限、配额和网络验收，自托管测试已转向隔离 PostgreSQL。
8. 历史 D1 V2 草稿/审核写服务具备认证授权、持久幂等和隔离测试，但从未据此取得生产迁移或部署结论；供应商历史有效期重叠和其他生命周期仍需应用层保证。
9. V1 分类模板已覆盖首批行业范围，但尚未经过真实物料样本试配；扩展必须新增 seed 版本，不得直接改写已发布版本或引入隐式继承。
10. 历史 D1 Material API 开发代码使用专用强幂等、CSRF、细粒度权限、职责分离和审计边界，但历史 Site 未部署对应 `0002`/`0003`；本任务未访问公开网址确认状态。V1 仍无多节点会签、break-glass 或自动审计归档调度。
11. `0003` 过渡约束仍接受 `PENDING_APPROVAL`，应用只写/只返回 `PENDING_REVIEW`，通用查询双读旧/新值；移除旧值必须另建收缩 migration，不能修改 `0003`。
12. TASK08 行级最小披露已在历史 D1 开发代码和隔离测试实现，但未部署到历史 Site；公开站点不能视为具备新查询 API 或收紧后的 `/drafts`。
13. 开发代码已增加真正的 `/materials/...` 页面路由，但未部署到历史 Site；公开网址不能视为具备这些页面。
14. legacy 与 Material 页面共用 `public/erp/api-client.js`；TASK10 后根页面已退出 iframe，`public/erp/` 仍是显式 legacy 工作区而不是全部业务已重写为原生 React 的证据。
15. `last_rejection` 与 Draft UI 已在非生产开发代码中完成，但未部署到历史 Site；不得把隔离实现与本地验收表述为公开站点能力。
16. 当前查询计划使用 `(material_id, version_no)` 唯一索引搜索单物料历史，没有专用 `event_type=REJECT` 索引；现阶段有界详情查询无需 migration，若单物料版本规模显著增长，需另建任务复测并审批索引。
17. 当前审核队列 API 可展示 `submitted_by`，但只支持 `creator` 筛选，不支持 `submitted_by` 筛选；V1 不提供该控件、不在前端全量筛选，后续可另立只读 API 候选任务。
18. Review UI 已在非生产开发代码完成并通过本机浏览器与隔离 D1 API 验证，但未部署到历史 Site；公开网址不能视为具备审核页面。
19. Material Import Batch Foundation 已在本地/隔离环境实现，但历史 `.openai/hosting.json` 的 `r2` 为 `null`，没有生产 R2 binding、bucket、生命周期或 Cron；历史 Site 未执行 `0004` 或部署本代码。10 MiB 是获批应用上限，不是容量结论。
20. Parser 栈 `@zip.js/zip.js@2.8.26 + sax-wasm@3.1.4 + 受限 OOXML` 与 `csv-parse@7.0.1` 已通过本机 Vinext、Miniflare、WASM、Web Streams、R2 Range 替身、Bundle 和内存门禁；这些是隔离验证，不等于真实生产 Queue/R2、远程配额、并发容量或冷启动已经验收。
21. 独立只读 Catalog 与 Import Workspace 已在非生产代码实现；50×256 本地 Chromium 门禁已通过，但这不是远程网络、并发、低端设备或冷启动容量结论，历史 Site 未部署。
22. Normalization 的 50,000 行、256 KiB/行、256 MiB/批、20 issue/行和 200,000 issue/批是 V1 应用保护上限，不是生产容量结论；自托管 PostgreSQL 的真实容量仍需独立压测和授权。
23. Normalization Review UI 已完成非生产前端与本地门禁，但 Issue API 仍无 `normalized_row_id`/Sheet 精确筛选，Drawer 内完整行 Issue 集合继续属于局部门禁；完整 Run 历史、Batch Current Pointer、部分筛选和列表候选摘要也未暴露。前端已明确降级且未推断；本地 1366×768、700px、50 Rows、100 Issues、200 Attributes 与有界 Payload 结果不等于远程生产容量结论。
24. 历史 D1 `0007` 和 Import→Draft 只在一次性 Miniflare 验证；品牌正式数据尚未初始化，仓库内只发现治理模板/样例。候选扫描上限 500、输出 20；HIGH_CONFIDENCE 逐行人工确认解除、真实召回率和规模容量尚未验收。
25. A118/V700 的 543 条旧 Cleaning Rows 已按项目负责人指令清空；2 个 Batch、766 条 Raw Rows 和完整原文件仍保留。重新导入会建立新清洗结果，且缺单位/空规格门禁仍然有效。
26. 内部编码 1～5 是开发匹配测试编号，不是正式编码规则；正式投用前必须迁移到批准的 `CYD-*` 编码或记录保留决定。
27. 三份新 BOM 共 221 条清洗候选，216 条有规格；当前 1～5 内部库未覆盖这些完整规格。J587 有 5 条缺误差，只能定位到编号 1/2/3 候选集合，不能唯一给号。
28. 1928C 当前网页导入的 25 条 Cleaning 产生于旧进程，不会由 Migration 静默重算；必须清空后重导才使用分项规格机制。截图中的 10PF 完整规格不在当前内部测试库，仍需人工建档生成编号。
29. 当前 25 条 1928C Cleaning 的分项字段可直接展示，但旧行保存的 raw spec/匹配置信度不会静默重算；重新导入后才使用“型号与规格分离”和缺失介质时最高 0.95 的新结果。
30. 任意未来供应商可能使用当前词法尚未定义的规格语法，不能承诺未知输入 100% 自动识别；系统通过证据门禁保证不确定时不返回候选编号，新增真实反例必须进入回归夹具后再扩展确定性解析。
31. 自托管 Material Draft/Review/Active 已通过一次性 PostgreSQL 17 和 Compose 隔离验证，但尚未迁移真实 D1/SQLite 数据、执行生产容量测试或生产恢复演练；旧 D1/Miniflare 代码只作历史参照，不能重新接入运行依赖。
32. TASK02—TASK10 已完成 Node/PostgreSQL 自托管非生产链路、实时 Dashboard 与离线备份恢复治理；真实数据仍在 Python/SQLite 开发运行面，尚未试迁移、容量验收或生产恢复演练，因此不能描述为业务已切换或已投产。
33. 根自托管页面已退出 legacy iframe；`public/erp/` 仍保留为显式业务工作区和回滚证据。64 个盘点操作及 23 个 legacy 刷新 GET 已有自托管覆盖或明确退役合同，但这不等于全部 UI 已重写为原生 React。
34. TASK01 staging、TASK02 Opening 与 TASK03 public materialization 仍只在合成 `_migration_test` 验证；TASK04 已完成获准真实快照的 Schema/聚合质量与无目标 planner，但没有连接目标、物化、逐行业务处置、附件核对或容量验收，不能据此宣布真实迁移或生产 Go-Live。
35. TASK05 环境使用 development Cookie 和明文 HTTP，因此严格只绑定回环并通过 SSH 隧道验收；它没有 HTTPS、域名、真实数据、生产恢复或流量切换批准。管理员首次登录后必须改密并删除 root-only 临时凭据文件。
36. LANDING-TASK04 部署时兼容入口虽有 `no-store`，仍并列框架默认 `public, max-age=3600`；MATERIAL-REVIEW-BLOCKERS-03-RETRY 已用动态只读 legacy route 精确消除该矛盾响应头。列表实际 `{items,next_cursor}` 与页面期望 `{data,total,page}` 失配且 cursor 被忽略，解析重试耗尽终态、创建/上传幂等及版本/SHA/重复/安全检查语义仍存在只读审计缺口。Excel→PostgreSQL E2E 未执行，不能由 CSV/XLS/XLSX 文件选择器推断为已验收。
37. 0035 提升了治理相关 metadata 的精度和必填边界，但不猜测回填已有正式物料。任一同治理大类、无法安全重建完整身份的旧正式行都会阻止新建稿/批准；这是防止一物多码的安全门禁，不是旧数据已修复。必须另立受控修订与重新治理任务，不得放宽或绕过。
38. Caddy TLS 终止后的写请求必须以显式 `ERP_PUBLIC_ORIGIN` 校验浏览器 Origin，不能直接拿代理后的内部 HTTP `Request.url` 比较，也不能信任客户端可伪造的 `Forwarded`/`X-Forwarded-*`。当前只允许 `https://43.135.148.43.nip.io:18888`；切换公司域名或公网 IP 时必须同步受控更新 Caddy 名称与该单值配置。
39. `admin2` 的首次改密要求已按项目负责人明确指令作单账号豁免，当前密码继续有效。该例外不改变 D-045，也不提供通用豁免能力；其他新建/重置用户仍必须首次改密。当前凭据应继续按管理员秘密保管，未来如需轮换必须使用独立受控任务。
40. LANDING-TASK07 的 591 行是按来源/BOM 上下文保留的离线明细，不是 591 个唯一正式物料；同一物料可跨板型重复出现，57 行用量和 21 行板型仍空白。不得跳过人工复核、稳定内部标识、单位/重复/替代关系和导入事务设计直接写库。
41. 人工物料审核的权威集合固定为 `material_master.material_status='PENDING_REVIEW'`。operations 只有 queue/approve/reject 三项精确增量，不因此获得草稿代编辑、身份管理、系统审计或其他业务写权限；legacy 清洗队列不得复活或冒充人工审核。
42. LANDING-TASK08 只定义流程，尚无通用执行器。新文件只有结构指纹命中已批准来源档案时才能直接套模板；未知布局必须先建立映射档案。临时汇总含待确认批次且不能入库，正式汇总也不等于已完成跨批去重、编码、单位、替代关系或数据库事务设计。
43. LANDING-TASK09 的标准整理是绑定当前已发布 Parse 与当前 Mapping 的只读投影，不是新的业务事实表或入库确认态。`PROFILE_PENDING` 仍可预览/导出但必须人工核对；CSV 下载、Mapping 确认和 Normalization 均不等于正式物料已创建、审核或编码。
44. SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY 不增加审核数据字段：当前版本既有 `SUBMIT.change_reason` 是工程说明事实，空值必须明确显示“未保存”，不得猜测名称、外部编号、供应商或价格。operations Dashboard 的可处理数只取 `PENDING_REVIEW`，legacy 全局统计必须继续标注 `DRAFT + PENDING_REVIEW`；退出后历史恢复必须重新校验 Session 并在校验前隐藏受保护内容。
45. SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 继续以 `products/product_versions/bom_headers/bom_versions/bom_lines` 和 Planning 关系表为唯一权威；候选显示文本不能作为业务键。选择器只返回 ACTIVE 正式物料并以 material_id/unit_id 提交，保存和发布事务均重验主单位；Product Version 与 BOM Version 分轴，BOM 属于 Product Version，Project 只在 Planning Handoff 关联。
46. Planning 写路由必须由共享安全客户端在发送时读当前 CSRF Cookie，不得依赖页面初始会话快照；缺失、错误、旧 Session Token 和非可信 Origin 继续 fail closed。RELEASED BOM 的前端只读不替代服务端/DB 不可变边界；BOM 管理页默认不得自动载入历史明细。
47. D-086 已由 alpha.37/0036 在并行非生产 UAT 落地：源 Requirement Item 继续不可变且可保持 NULL/pending；工程单位确认写入追加式 Unit Resolution Version，并以每 Requirement Item 独立 CAS Head 指向当前版本。新 Package Item 固定引用生成时的精确 `unit_resolution_id`，后续 Head 变化或 Unit 停用不改历史包；BOM Line Unit 不能推断 Requirement Unit。
48. FIX-08 的 Package 范围只读追溯功能已部署且没有历史数据缺口，但其主 UAT 浏览器核验曾因 UAT 角色凭据事件停止。ROLE-CREDENTIAL-ROTATION-09/CREDENTIAL-RECONCILIATION-10 的历史 PARTIAL/BLOCKED 记录继续保留，不得改写为当时已完成。
49. OFFLINE-IDENTITY-RECOVERY-11 已按 D-087 解除上述身份恢复风险：11 个目标账号单事务恢复、目标旧 Session 撤销、Canonical 双文件激活、1+10 身份页验证和最终零有效目标 Session 通过。该完成不构成 Planning 核验授权，不能自动进入 Package 接收/退回。
50. FIX-12 已以新的明确 planning-only 授权完成主 UAT 历史回看，不能反向改写 FIX-08/TASK09/TASK10 的历史结论。退回原因的数据库 ASCII 标点与预期全角标点仅在 NFKC 后等价，登记为 LOW；数据库原文仍是权威历史值，未来不得以体验优化为由静默修复 Package 或 RETURN Event。
51. D-088 已由 alpha.38/0037 在并行非生产 UAT 落地：工程修订回复采用追加式 Version 与 RETURN 事件专属 CAS Head，v2 固定引用源 v1、精确 RETURN、精确回复版本及 Product/BOM/Unit Resolution/物料快照；同 RETURN 只允许一个直接后继，摘要、事务、幂等、审计和数据库 guard 共同保护谱系。主 UAT 只读验收后仍为 v1 RETURNED、RETURN 1、Response 0、v2 0，未填写回复、未生成或提交 v2、未登录 planning；工程 v2 黑盒试用必须等待新的明确授权。

## 当前任务与下一任务

- `PHASE4-TASK03`是唯一`DOING`，D-112五表及确定性候选Service/API已在alpha.44/0041源码实现并通过隔离验证，状态为`DOING / SOURCE_READY / HOLDOUT_REVALIDATION_REQUIRED / RELEASE_NOT_AUTHORIZED`。`PHASE4-TASK01`已按D-110完成治理基线，`PHASE4-TASK02`已由D-111收口为`DONE / DETERMINISTIC_THRESHOLDS_APPROVED / RELEASE_NOT_AUTHORIZED`；外部AI禁用，正式holdout未重跑，源码未build/deploy，UAT仍alpha.42/0040，`PHASE4-TASK04`—`TASK05`保持`TODO`且不得自动开始。
- `SELFHOST-UAT-FIX-37`已完成：功能提交`a6fc8b33af73d5ffd0da03566ef1f28d4207722b`及语义修正`20a9123741862d81ac18af9e6bdee896674fe95c`；alpha.41/0040关系化收货证据、最小权限谱系、权威GET预览、最终POST事务门禁、提前到货保护和按inspection mode分流已Web-only部署为`sha256:0cf98937…5f19`。正式备份/第二库恢复/0039→0040及warehouse-only桌面/390×844取消UAT通过；business POST0、Session0，PO/Line/Plan/queue `1/4/4/4`，Receipt/Evidence/Lot/IQC/Ledger/AP/付款/生产全0。这是FIX38前置历史；真实收货及后续部门动作均须另获授权。
- `SELFHOST-UAT-FIX-36`已完成：功能提交`bdb4fd07e76e405f418833aeaf5b0c9c4b5e5ae7`；通用受限读模型、数据域403、PO聚合及完整上游谱系、四Line、四Plan/queue、Event/Audit/Idempotency最小投影和响应式只读详情已Web-only部署为`sha256:664e0ac6…a4ec89`。正式备份恢复、purchase-only桌面/390×844刷新重开和Session失效通过；business POST0，PO/Line/Plan/queue `1/4/4/4`及下游全0。这是FIX37的前置历史，不是当前执行指令。
- `SELFHOST-UAT-DECISION-35`已完成：D-105将未经事前授权的`PO-00000001`置于受控保留状态；它是控制事件，只提供前向授权并明确“不追溯性授权”。PO/Line/Plan/queue `1/4/4/4`及Event/Audit/Idempotency证据不得改动，Award→PO不再重试；FIX36只读验收不改变该判断或授权边界。
- `SELFHOST-UAT-AUDIT-34`已完成：唯一成功PO request、actor、时间、结构、谱系和下游零计数已由限定只读取证确认；结论是数据结构完整但来源授权不可证明。审计没有删除、修改、补偿或继续任何下游，D-105现已对其作出前向受控保留决定。
- 阅读边界：以下FIX-33/FIX-32等条目中的PO为0及“另获转换授权”只记录各自任务收口时点，不是当前执行指令；当前路线以D-105为准，现有PO受控保留且Award→PO不再重试。
- `SELFHOST-UAT-FIX-33`已完成：功能提交`1f205af0bf81379345a09353d9d32ab5c7545971`，采用分支A且不新增0040；统一Supplier Mapping资格服务、固定Binding→Mapping fact谱系、legacy Unit兼容、逐行错误、事务锁和桌面/390×844凭证已Web-only部署为`sha256:83c1bff3…20664`。正式备份/第二库恢复和purchase-only预览后取消通过；主UAT`business_post=0`、Session0，四条Mapping、失败请求、Award/RFQ不变，PO/Line/Plan/queue全0。当前无`DOING`；正式转换须新的明确授权和当时事实重验。
- `SELFHOST-UAT-FIX-32`已完成：功能提交`a4ffb8ee022234ea25add4ce636050366ac6887a`，保持alpha.40/0039且没有0040；两阶段预览/最终确认、完整转换合同、同连接单事务重验、隔离`1 PO / 4 PO Line / 4 Delivery Plan`已Web-only部署。正式备份/第二库恢复和purchase-only桌面/390×844打开后取消通过；主UAT`business_post=0`、Session0，RFQ CLOSED v7、Award/Line/Event/PO/Plan `1/4/1/0/0`。真正转换仍须新授权并重新核验当前事实。
- `SELFHOST-UAT-FIX-30`已完成：功能提交`22aa4dc053c9e0a8dc523956afe7742cf5d66fbc`，保持alpha.40/0039且没有0040；两份固定Quote、一次Award操作/四条Line精确语义、上游不可变、八类下游零自动创建和独立转PO阶段已Web-only部署。正式备份/第二库恢复、隔离双击Award1/Line4/PO0及purchase-only桌面/390×844打开后取消通过；主UAT business POST0、Session0，RFQ ISSUED v6、Award/Award Line/PO0/0/0。当前无`DOING`；真正人工定标或转PO必须新授权并重验当前事实。
- `SELFHOST-UAT-FIX-29`已完成：功能提交`99a5e6bfe255cb46a0384106eb8ec0a08ec96832`，保持alpha.40/0039且没有0040；Candidate DTO/稳定字符串ID、四组逐Comparison Line两候选、Candidate绑定Award DTO、非最低价`DELIVERY_PRIORITY`与服务端CURRENT/Quote/CAS/摘要/完整行集重验已Web-only部署。正式备份/第二库恢复、隔离Award 1/Line4/PO0及purchase-only桌面/390×844确认后取消通过；主UAT business POST0、Session0，RFQ ISSUED v6、Award/Award Line/PO0/0/0。当前无`DOING`；真正人工定标或PO必须新授权并重验当前事实。
- `SELFHOST-UAT-FIX-28`已完成：功能提交`80e1ad60fa1272017545e150721c8b71f7c68828`，保持alpha.40/0039且没有0040；Comparison Line稳定ID、RFQ/Round/Version/逐行basis复合身份、CURRENT/SUPERSEDED/INPUT_DRIFT投影、固定Quote输入、确定性输出摘要、Supplier/Material汇总和四Line Event单操作凭证已Web-only部署。正式备份/第二库恢复、隔离回归及purchase-only桌面/390×844只读验收通过；business POST0、Session0，RFQ ISSUED v6、Binding8、Quote2、Comparison4/8/4、Award/PO0/0。当前无`DOING`；人工定标或PO必须另获明确授权。
- `SELFHOST-UI-STATUS-LOCALIZATION-05` 已完成：共享 `statusLabel/statusPairLabel/roleLabel` 统一原生与legacy可见业务状态、角色、审核/执行结果和启停显示；未知枚举原样回退，原始值继续服务API、筛选、状态机、样式和审计。38个UI测试文件、10组typecheck、lint/build、npm/Python/credentials通过，版本仍alpha.40、Migration仍0039。当前无`DOING`；公开UAT保持既有Web镜像，部署或登录式浏览器验收须新授权。
- `SELFHOST-UAT-FIX-27`已完成：功能提交`1be492e68f6635bc00ea3fb8ce461eac0617d8e7`，保持alpha.40/0039且没有0040；RFQ aggregate CAS/RESPONDED权威语义、固定范围漂移和Quote稳定ID/Event/金额/交期追溯已Web-only部署。正式备份/第二库恢复、隔离Supplier B报价及purchase-only桌面/390×844只读验收通过；business POST 0、Session 0，RFQ ISSUED v4、Binding 8、摘要不变、Supplier A Quote ID 1保留、Supplier B Quote 0、Quote/Award/PO 1/0/0。当前无`DOING`；任何后续报价、修订、比价、定标或PO必须另获明确授权。
- `SELFHOST-UAT-FIX-26` 已完成：功能提交`f6f7d2a`，保持alpha.40/0039且没有0040；0039独立Binding状态、最终“确认发出”按钮、完整下游保护、Binding ID 1—8主展示和摘要顺序消歧已Web-only部署。正式备份/第二库恢复、隔离发出和purchase-only桌面/390×844只读取消均通过；业务POST 0、Session 0，RFQ仍DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO及全部下游0。当前无`DOING`；正式发出必须另立任务并重新获得明确授权。
- `SELFHOST-UAT-FIX-25` 已完成：采用分支 B，八条 PostgreSQL 外键关联和固定摘要均正确，页面直接使用同一 DTO 行的 `binding.id`；旧错误基线来自把显示顺序 `3,4,1,2,7,8,5,6` 与 Material 533—536按位置 zip。现以逐行权威表替代该基线；没有代码/数据/Migration/部署变化或 UAT登录，业务 POST 0，RFQ仍 DRAFT v2、Binding 8、Mapping Event 1、ISSUED/Quote/Award/PO 0。当前无 `DOING`；正式发出必须另获明确授权。
- `SELFHOST-UAT-FIX-24` 已完成：功能提交 `e329931`，保持 alpha.40/0039且没有 0040；真实 bigint Binding ID、独立 `RFQ_MAPPING_CONFIRMED` 凭证和发出前完整检查已部署。当次页面显示顺序为 `3,4,1,2,7,8,5,6`，它不是身份配对表；逐行关联已由 FIX-25 明确。purchase-only 桌面/390px只打开详情/凭证/发出窗口后取消，业务 POST 0、Session 0，RFQ 仍 DRAFT v2、Binding 8、ISSUED/Quote/Award/PO 0。
- `SELFHOST-UAT-FIX-22` 已完成：功能提交 `b339acd97f08e4cc09451173b48580015817d9f8`，部署、Asia/Shanghai 日期投影修复、最终 UAT 与文档由独立 `ops: deploy rfq issuance safeguards` 提交收口。alpha.40/0039 已部署，新 RFQ 创建时固定精确 Mapping；主 `RFQ-00000001` 仍为 generation 1 / DRAFT v1、Binding 0，页面八条 Mapping 仅是当前资格和拟绑定。purchase-only 桌面/390px只打开发出确认并取消，业务 POST 0、下游 0、Session 0。当前无 `DOING`；不能直接发出，下一任务必须先另获授权显式确认并固定当前 Mapping，实际发出仍须再次明确授权。
- `SELFHOST-OPS-UAT-PURCHASE-SUPPLY-BREAKDOWN-FIX-16` 已完成：功能提交 `ce3f14a0c989875e7527e42136967f9efe6ee548`；alpha.38/0037 的当前库存/正式预留/冻结/有效计划分配及有效在途分解、快照/当前/差异分区、接收确认刷新、范围授权和零查询写入已通过定向/跨域 PostgreSQL、390px 隔离 Chromium、备份恢复与 Web-only 部署。主 UAT 只登录 purchase，分别核对 Material 533—536 的九项当前供应 0 PCS，打开刷新后的接收确认并取消；最终 PRQ/Plan 仍 SUBMITTED、Package 2/v2 仍 ACCEPTED、ACCEPT/RETURN/Allocation/全部下游 0。当前立即停止，不接收或退回 PRQ，不创建 RFQ。
- `SELFHOST-OPS-UAT-PURCHASE-REQUEST-TRACEABILITY-FIX-15` 已完成：功能提交 `22ea9a282ef4d7a7e58e84b9db73061a0ef6e109`；Package→Plan→PRQ 关系化详情、提交快照、对象范围授权、确认界面与 390px 已通过隔离测试、备份恢复、Web-only 部署及 purchase-only 主 UAT 打开后取消。该任务历史结论保持，当前供应细分缺口已由后续 FIX-16 解除。
- `SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13` 已完成：功能提交 `58e011db0c8d9045c3919c36c2c64f1655f050b6`；alpha.38/0037 的追加式工程回复、RETURN CAS Head、固定 v1→RETURN→Response→v2 谱系、不可变 guard、正式 API 和 390px UI 已通过隔离升级、真实 0036 备份恢复升级、专项/回归和完整 Chromium 旅程。正式 root-only 0600 备份、第二新空库恢复和主 UAT 前后指纹通过后，只替换 Web 并串行应用 0037；Worker/PostgreSQL/Caddy 与四卷未重建。主 UAT 最终仍为 v1 RETURNED、RETURN 1、Response 0、v2 0，engineering 已退出且 planning 未登录；当前立即停止，等待独立的 engineering v2 黑盒试用授权。
- `SELFHOST-OPS-UAT-PLANNING-DECISION-HISTORY-FIX-12` 已完成：功能提交 `180f6b58b583bd2dba350f017504be916db9673d`；待接收/已处理、终态历史重开、完整事件、确认窗口、完成凭证和 390px 均通过隔离 PostgreSQL/Chromium、备份恢复、Web-only 部署与 planning-only 主 UAT。Package ID 1/v1 最终 RETURNED、RETURN 1、ACCEPT 0、v2 0；数据库原因 NFKC PASS 且历史未改，planning 已退出、有效 Session 0。当前停止，不自动登录 engineering 或创建 v2。
- `SELFHOST-OPS-OFFLINE-IDENTITY-RECOVERY-11` 已完成：正式 run-id `3b03aaab-11ef-4dfe-963b-001a6ece660f`，11 个目标账号/12 条目标旧 Session/11 条恢复审计在单事务完成；两份 Canonical Schema/owner/mode、admin 与十 UAT 的登录/强制改密门禁/退出、最终零有效目标 Session、业务指纹、备份恢复和资源清理全部通过。工具提交 `a48dcc8a290b96da1ea6e426aaa2c6d73416c2fc`，完成记录由独立 ops 提交收口。
- `SELFHOST-OPS-UAT-ROLE-CREDENTIAL-ROTATION-09` 与 `SELFHOST-OPS-UAT-CREDENTIAL-RECONCILIATION-10` 保持历史 PARTIAL/BLOCKED 结论；其未完成的身份风险已由后续 TASK11 正式解除，不回写或美化当时结果。
- `SELFHOST-OPS-UAT-PLANNING-REVIEW-TRACEABILITY-FIX-08` 保持其历史 BLOCKED 结论：当时主 UAT 未执行。其功能与身份阻断已分别由后续 TASK11 和 FIX-12 解除；FIX-12 的新授权和验收不能反向美化 FIX-08 当时结果。
- `SELFHOST-OPS-UAT-PLANNING-UNIT-RESOLUTION-IMPLEMENT-07` 已完成：功能提交 `91c0fd29d534246c55ddd669e894cdde9b774e52`，alpha.37/0036 的版本事实、CAS Head、稳定 Unit FK、Package provenance、正式 API 和 390px UI 已通过隔离迁移/恢复/回退、专项/回归与真实 Chromium。正式 root-only 0600 备份和第二新空库恢复通过后，并行非生产 UAT 已从 0034 串行升级到 0035/0036，只替换 Web；Worker/Caddy 不变。该任务完成时主 UAT 为 Requirement NULL/pending、Unit Resolution 0、Package/Item/Event 0；这是历史验收状态，不是当前 UAT 基线。
- `SELFHOST-OPS-UAT-PLANNING-CSRF-BOM-IMMUTABILITY-FIX-05` 已完成：Planning 当前 Cookie/Header 双提交、Session+正文幂等、RELEASED BOM 前后端不可变与默认空选择均通过隔离测试。alpha.34/0034 兼容 Web `sha256:7e0a3040acd1...` 已仅替换 Web；该任务完成时主库只读 Chromium 只产生一次 engineering 登录/退出，`PRJ-00000001`、Product 7/A0、BOM 7/V1/四行 533—536 不变，Planning Package 为 0；这是历史验收状态，不再作为当前续测授权。
- `SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04` 已完成：功能提交 `b66e742`，alpha.34/0034 兼容 Web `sha256:cb6a5c1fae896...` 已只替换 Web。四个正式编码各唯一命中并显示名称/PCS，稳定 material_id 为 533—536；Product A0 与 BOM V1、产品/BOM 状态和现有发布流程已明确。该任务结束时 UAT BOM/Planning 仍为 0；后续新建的 UAT RELEASED BOM 已作为 FIX-05 严格保护起点，不反向改写旧记录。
- `SELFHOST-OPS-PUBLIC-IP-CUTOVER-07` 已完成：当前公网入口为 `https://43.135.148.43.nip.io:18888`，Caddy 名称和 Web 唯一可信 Origin 同步切换，新证书、外部读取、200/308/401、安全头与旧 SNI 退役通过。只用原镜像重建 Web/Caddy；PostgreSQL/Worker、0034、核心业务聚合和四卷保持。
- `SELFHOST-OPS-UAT-MATERIAL-REVIEW-BLOCKERS-03-RETRY` 已完成并部署 alpha.34/0034 最小兼容 hotfix。审核详情、范围、批准/退回后果与工程 BOM 下一步已补齐；Dashboard 与原生队列均为 4；经营和 legacy 的 logout→back/forward/refresh 真实 Chromium 验收通过。工程说明实际为空时诚实显示未保存，没有新增 0036、运行 0035、部署 alpha.36 或扩大权限。
- `SELFHOST-LANDING-TASK09` 已完成 alpha.36/0035 非生产源码：供应商导入解析准备完成后默认展示固定 13 列、问题统计和安全 CSV，公式不执行，数量用十进制文本计算，替代料只按显式标记折叠；读取使用 owner/`read_any`、repeatable-read 快照、5,000 行/32 MiB 门禁和 `private, no-store`。未处理新真实文件、写业务数据、运行 Migration、build/restart/deploy。
- `SELFHOST-LANDING-TASK08` 已完成：大批量资料以后按 `CYD-MAT-YYYYMMDD-NNN/Rxxx` 一批一任务/一对话执行，以私有总索引和批次卡恢复，Codex 只推进到 `REVIEW_REQUIRED`，项目负责人批准后才进入已批准汇总。下一步不自动开始；通用执行器和 5—10 份代表性试点须分别授权。
- `SELFHOST-OPS-UAT-MATERIAL-REVIEW-FIX-02` 已完成。功能提交 `54f6480` 精确增加 operations 审核三权限；alpha.34/0034 兼容 hotfix `sha256:f31199de3b8...` 只替换 Web。隔离 PostgreSQL、全套适用回归、备份恢复、候选 smoke 和真实 Chromium 只读验收通过；533—536 仍是 PENDING_REVIEW/V2/MANUAL/PCS/空编码，APPROVE/REJECT 三类证据计数为 0。
- `SELFHOST-LANDING-TASK07` 已完成：模板 53/53 行组和用量核对通过，8 张来源标准页合并为 591 行总表并提供 591 行追溯、94 条异常和 GPT 下载副本。当前停止在离线人工审阅；数据库导入、编码/审核、0035 部署或任何生产动作均需独立授权。
- `SELFHOST-OPS-UAT-BLOCKER-FIX` 已完成。真实浏览器回环 Origin 以前与唯一公网 Origin 不匹配，两个前端又吞掉 logout 403；现只有显式 UAT 类别可使用严格双端 loopback，生产仍精确 HTTPS，两个页面复用服务端撤销型 POST logout 并显示失败。临时 manager 已创建、验证并页面停用，两个旧 Session 均为 `REVOKED`，成功审计和重新登录通过。
- `SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06` 已在单一 serializable 事务中完成 `admin2` must-change `true→false`、version `2→3` 与专用 Identity Audit；密码二次指纹、Session `3/1`、权限和全局策略不变，同任务重放为 no-op。
- `SELFHOST-OPS-TRUSTED-ORIGIN-05` 已部署 alpha.34 最小 Web hotfix。合法公网 HTTPS Origin 的无凭据 `/api/me/password` 验收进入 `AUTH_REQUIRED`，不再返回来源校验失败；错误/缺失 Origin、错误 CSRF Token 和内部 HTTP Origin 在单元/隔离 PostgreSQL 测试中继续 fail closed。
- `SELFHOST-OPS-ADMIN-ACCOUNT-04` 已通过正式 Identity Service 创建第二 active admin `admin2`，最终 version 2、首次改密；用户/admin `1/1→2/2`，Session/有效 `2/0` 不变。弱密码门禁、摘要输出事件、正式重置补救、4 条 Identity Audit、3 条幂等和资源/健康/清理均已记录。
- `SELFHOST-LANDING-TASK05` 已完成 V9 staging。pre-clean dump 恢复 213 表一致；staging 首次 197、重放新增 0。197 行全部因 `EXPLICIT_UNIT_MISSING` 待确认，主库前后计数 manifest 一致，固定结论 `STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`。
- `SELFHOST-PHASE6-TASK01` 已交付 alpha.35/0035 的 BOM 物料规格标准化与主数据治理源码。严格身份、可解释归并、原始行追溯、异常与替代候选、人工受控绑定/建稿已通过隔离 PostgreSQL 验收；正式替代关系仍不自动写入。
- `SELFHOST-UI-STATUS-LOCALIZATION-DEPLOY-06`完成时，18888 Web为状态中文化alpha.40 `sha256:89e7677538751f2c0a049a113f3d24372a18edaf752bf837038580ac951bd153`（88,572,838 bytes）；这是历史部署时点，当前Web以本文件顶部FIX37运行状态为准。PostgreSQL当时为39/head0039，当前已由FIX37受控升级为40/head0040；PUBLIC-IP-CUTOVER-07的Origin/端口和Caddy保持，Worker镜像未替换，PostgreSQL/Caddy容器与四个受保护卷均未重建。该运行面只属于并行非生产UAT，不等于生产发布。
- `SELFHOST-LANDING-TASK04` 已把兼容业务台的 CSV-only 页面收敛到 `/materials/imports/new`；旧 `/api/import` 继续在 PostgreSQL 运行面明确退役。功能提交 `cda8c7e` 已经用户单独授权部署到当前 18888 Web，公网 HTML/JS SHA 与源码一致。
- `SELFHOST-LANDING-TASK03` 根据用户明确授权把公网 `18888` 从旧 Python 切到新 PostgreSQL ERP：可信 TLS、80→HTTPS 跳转、生产 Cookie、匿名 401 和安全响应头通过；旧 Python 仅回环保留。该任务的原入口 `43.135.157.211.nip.io` 已由 PUBLIC-IP-CUTOVER-07 受控替换，当前入口为 `https://43.135.148.43.nip.io:18888`。
- `SELFHOST-LANDING-TASK02` 经用户澄清“不依赖逐行人工分类”后连续执行：离线确定性规则按来源编码/MPN/严格规格组合、类别、位号和可数件单位完成 532 Material、6 Product、6 个 DRAFT BOM 与 316 行主库导入；438 条真正歧义来源隔离。migration_tool 来源链接承载逐行 provenance，0034 不变，同批次重放新增 0，结论 `PARTIAL REAL BOM IMPORT COMPLETED — REVIEW REQUIRED`。
- 后续必须为 197 行提供显式单位；若需要 BOM，还必须另提供产品编码/版本、BOM 版本、行数量、位号和单位契约。完成前不得执行已生成的拟删除计划。本轮停止；LANDING-TASK01 的 offhost copy 仍是独立未完成用户动作。

- 当前源码候选为`0.1.0-alpha.44`/head 0041且未build/deploy；并行非生产UAT Web仍为原`0.1.0-alpha.42`镜像，UAT PostgreSQL保持`0001`—`0040`。生产版本仍不存在，不得把源码候选、隔离测试或并行UAT写成D-111正式重验、生产发布或真实数据迁移。
- LANDING-TASK04 部署前后只读核对均为 Audit 876 条、Session 2 条（ACTIVE 1 条）；不可变审计和合法会话不得为追求“零记录”而删除。
- TASK09 已以保存的非敏感基线摘要执行 delta 验收，并在清理后返回完全相同的合法 Audit/Session 记录集与计数；未来任务仍须遵守相同规则。
- 2026-07-27 服务器重启/不可用的根因保持 `UNKNOWN`，不得无证据归因 OOM；资源保护不等于生产上线。
- `SELFHOST-PHASE5-TASK06` 已完成原检 10/8/2/8、返工 2、复检 2/2/0/2、AOI 8/2、正式报工/完工/成品 8/2；Execution COMPLETED、NCR RESOLVED，FQC/Shipment/AR/Settlement 保持 0。
- `PHASE0-TASK03`、`SELFHOST-PHASE4-TASK05`—`TASK10` 保持历史 `DONE`；PHASE5 TASK10 功能提交 `a10264020738d5ff281db9a6f7b6774df8cbb61b` 严格基于授权起点 `55f8fe9693ebc0f630920e92eca1f74584d852af`。
- PUBLIC-IP-CUTOVER-07 预检发现 533—536 已在其任务开始前经正式接口成为 ACTIVE/version 3/有编码；BOM-SELECTOR-FIX-04 只读确认并用于检索，没有改写。当前 Product Version 7/A0 与 BOM Version 7/V1/四行 533—536 仍是 RELEASED 保护事实；0035/0036 已由 IMPLEMENT-07、0037 已由 REVISION-RESPONSE-13 仅在并行非生产 UAT 受控应用。Product/BOM 修订、Planning Handoff 业务续测、凭据轮换、真实 BOM 治理及任何生产动作仍须独立授权。
- 已完成：`SELFHOST-PHASE4-TASK05`，并行环境 `0.1.0-alpha.19`/`0019` 完成 Award→PO→到货计划→两批 Receipt `4/6`→库存 `10`→采购来源 `48/72`→显式 AP `48/72`，权限、幂等、CAS、超收、冲销阻断、重启、备份恢复与清理通过；结论 `SOURCING TO PAYABLE HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。
- 已完成：`SELFHOST-PHASE4-TASK04`，并行环境 `0.1.0-alpha.18`/`0018` 完成两供应商 RFQ、报价、服务端比较和人工非最低价定标；A `12.000000`/准时/排名 2，B `10.000000`/晚交/排名 1，以 `DELIVERY_PRIORITY` 和“交期优先，避免项目延期”选择 A。Award=1 时全部下游写入为 0，重启持久和清理恢复通过；结论 `PROCUREMENT SOURCING AWARD ACCEPTED IN PARALLEL ENVIRONMENT`。
- 已完成：`SELFHOST-PHASE4-TASK03`，并行环境 `0.1.0-alpha.17`/`0017` 的固化包聚合、库存/在途独立分配、不可变需求计划与采购申请、v1 退回释放→v2 重算重提→最终接收、重启持久和清理恢复通过；结论 `PLANNING MATERIAL REQUIREMENT TO PURCHASE REQUEST ACCEPTED IN PARALLEL ENVIRONMENT`。现在停止，不自动启动 TASK04。
- 已完成：`SELFHOST-PHASE4-TASK02`，并行环境 `0.1.0-alpha.16`/`0016` 的 planning 角色、显式 Requirement Resolution、不可变计划交接包、v1 退回→修订 v2→重提→接收、重启持久和清理恢复通过；结论 `PROJECT TO PLANNING HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`。TASK03 后续已由独立授权和模型完成，不改写 TASK02 事实。
- 已完成：`SELFHOST-PHASE4-TASK01`，并行环境 `0.1.0-alpha.15`/`0015` 的市场→项目闭环、重启持久和清理恢复通过；结论 `MARKET TO PROJECT HANDOFF ACCEPTED IN PARALLEL ENVIRONMENT`，既有事实不由 TASK02 改写。
- 已完成：`SELFHOST-PHASE3-TASK05`，在保留 Python/SQLite 的同时以 `chenyida-erp-parallel` 运行 PostgreSQL 17、Web 和 Worker；`127.0.0.1:3000`、14 migrations、空环境管理员、23 GET、重启与资源验收通过。版本保持 `0.1.0-alpha.14`，未创建 `0015`；结论仅为 `PARALLEL HTTP ACCEPTANCE ENVIRONMENT RUNNING`，不自动开始真实数据迁移、HTTPS 或切流。
- 已完成：`SELFHOST-PHASE3-TASK04`，对唯一获准的本机 SQLite 执行一次一致性只读快照、脱敏聚合盘点和无目标 Dry-run；快照已删除，源与 Python PID 不变，未读文件正文或写 PostgreSQL。版本 `0.1.0-alpha.14`，migration 保持 `0001`—`0014`；不自动开始真实试迁移或生产任务。
- 已完成：`SELFHOST-PHASE3-TASK02`，新增 PostgreSQL `0014` 与受控 Inventory/Finance Opening，合成物化、冲销、幂等、并发、Dashboard、Compose 重启和备份恢复通过。MG-001/MG-002 为 `RESOLVED IN SYNTHETIC NON-PRODUCTION MODEL`，版本 `0.1.0-alpha.12`；不自动开始下一任务，真实数据与生产仍为 `NO-GO FOR REAL DATA / PRODUCTION`。
- 已完成：`SELFHOST-PHASE3-TASK01`，建立只允许临时合成源和回环 `_migration_test` PostgreSQL 的迁移准备工具；中断恢复、重复执行、摘要失效、backup/restore、整栈重启及全回归通过。版本为非生产 `0.1.0-alpha.11`，业务 migration 仍为 `0001`—`0013`。不自动开始真实数据或生产任务。
- 已完成：`SELFHOST-PHASE2-TASK10`，新增实时权限裁剪 Dashboard、原生根工作台、显式 legacy 深链和离线 backup/verify/新空目标 restore；隔离 PostgreSQL 恢复、Compose 重启及适用全回归通过，版本为非生产 `0.1.0-alpha.10`，migration 仍为 `0001`—`0013`。不自动开始下一任务；真实数据与生产动作须另立任务授权。
- 已完成：`SELFHOST-PHASE2-TASK09`，新增 PostgreSQL `0013`、稳定 Shipment/Receipt 来源 AR/AP、不可变 Settlement/Reversal/Event 和受控余额投影；财务过账后上游来源冲销 fail closed，版本为非生产 `0.1.0-alpha.9`，未迁真实金额、实现银行/税务/发票/汇率/总账、部署或访问生产。下一任务从 clean 工作区进入 TASK10。
- 已完成：`SELFHOST-PHASE2-TASK08`，新增 PostgreSQL `0012`、关系化 IQC/IPQC/FQC、Result/Defect/Event；异人处置/关闭/重开与 FQC 发货额度门禁由服务端和数据库共同约束，版本为非生产 `0.1.0-alpha.8`，未迁真实检验数据、实现 IQC 库存批次隔离、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK07`，新增 PostgreSQL `0011`、关系化 Quote/SO/Shipment/Financial Source；ACCEPTED 转单及发货/冲销与 TASK04 Ledger/Balance、状态、审计、幂等同事务，版本为非生产 `0.1.0-alpha.7`，未迁真实销售数据、创建应收/收款/品质过账、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK05`，新增 PostgreSQL `0009`、关系化 PO/Receipt/状态事件/财务来源、缺料建议、部分/全部收货和全额冲销；收货与 TASK04 Ledger/Balance、审计、幂等同事务，版本为非生产 `0.1.0-alpha.5`，未迁真实 PO/在途、创建 AP、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK04`，新增 PostgreSQL `0008`、不可变库存 Ledger、事务余额投影、通用调整/冻结/冲销和真实 BOM shortage 投影；版本更新为非生产 `0.1.0-alpha.4`，专项、migration、Compose 重启和适用回归通过，未回填真实库存、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK03`，新增 PostgreSQL `0007`、关系化 Customer/Supplier/Product/BOM 与 Supplier Mapping/价格历史，发布版本不可变，readiness 在 TASK04 前只做结构检查；版本更新为非生产 `0.1.0-alpha.3`，专项、migration、Compose 重启和回归通过，未迁移真实数据、部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK02`，补齐自托管身份、用户、密码、会话撤销、限流、持久幂等和系统审计；版本更新为非生产 `0.1.0-alpha.2`，未迁移真实用户、未部署或访问生产。
- 已完成：`SELFHOST-PHASE2-TASK01`，只读盘点 Python 64 个 HTTP 操作、页面调用、权限、表、事务、审计、过账风险与自托管覆盖，确认 legacy iframe 登录后 23 个业务 GET 全部 404，并提出 TASK02—TASK10 建议顺序；仅文档，未实施 API、Schema、migration、依赖、部署或生产动作。
- 已完成：`PHASE0-TASK03`，2026-07-24 建立 `RELEASES.md`、三套 migration SHA-256、`0.1.0-alpha.1` 原始非生产版本、发布验收和回退模板；2026-07-26 追加复核当前 `0.1.0-alpha.19`/PostgreSQL `0001`—`0019`、本地 Git 领先远端 27 个提交、双开发运行面和真实业务仍依赖 Python/SQLite，未访问或修改生产。
- 已完成：`SELFHOST-PHASE1-TASK04`，把独立人工覆盖、Issue 处置、ACTIVE 精确绑定、Material Service 建 DRAFT 和可恢复 finalization 移植到 PostgreSQL；专项、回归、migration 与 Compose 验收通过，后续已随 `39946f6` 提交，未连接生产、迁移真实数据或部署。
- 已完成：`SELFHOST-PHASE1-TASK01`，把 Material Draft/Review/Active 完整移植到 PostgreSQL Repository、自托管 API 和现有页面；编码并发、职责分离、幂等/乐观锁/CSRF、版本/变更/审计及 Compose 重启持久性通过，后续已随 `39946f6` 提交，未连接生产或部署。
- 已完成：`SELFHOST-PHASE1-TASK02`，把 Import Mapping、动态目标目录、确认快照、版本/SUPERSEDED、跨批次复用/STALE、Worker准备和现有页面移植到 PostgreSQL 自托管链路；专项、回归、迁移和 Compose 重启持久性通过，后续已随 `39946f6` 提交，未连接生产或部署。
- 已完成：`SELFHOST-PHASE1-TASK03`，把行级 Normalizer、核心/动态属性候选、lineage、稳定 issues、重试/重跑/取消、原子发布和 Review UI 移植到 PostgreSQL 自托管链路；专项 12/12、回归 41/41、迁移和 Compose 重启持久性通过，后续已随 `39946f6` 提交，未创建 Draft、迁移真实数据、连接生产或部署。
- 已完成：`PHASE0-TASK01-B`，把 Site gitlink 转为根仓库直接跟踪的普通目录，保留生产版本、开发基线和提交历史关系；未修改业务代码或生产环境。
- 已完成：`PHASE0-TASK02`，以本机一次性 Miniflare D1 建立生产地址拒绝、测试数据销毁、去敏失败日志、凭证扫描和临时 SQLite 备份恢复验证；未创建云端资源、未连接或修改生产 D1。
- 已完成：`PHASE1-TASK01`，数据模型及正式编码、生命周期、变更日志、供应商映射时效唯一性调整已获批准。
- 已完成：`PHASE1-TASK02`，新增关系化 schema、版本化 Up/Down、Drizzle 快照和隔离迁移测试；未改 API、未迁移数据、未连接生产 D1。
- 已完成：`PHASE1-TASK03`，新增版本化行业分类、属性定义、显式叶子绑定、本地事务 seed 与幂等测试；未改 migration、API 或下游业务，未连接生产 D1。
- 已完成：`PHASE1-TASK04`，新增 Repository + Rules + Service 三层物料校验模块、Memory Repository、隔离 D1 metadata 变化测试和 25 个结构化 code；未接 API、未写真实物料、未连接生产 D1。
- 已完成：`PHASE1-TASK05`，新增 Material Master Draft/Review/Code 服务，以 D1 batch 原子创建草稿、批准启用、拒绝、生成编码、保存类型化属性、版本和审计，并用乐观锁、规则 CAS 及 metadata/属性守卫处理并发；未接 API、未改 migration、未连接生产 D1。
- 已完成：`PHASE1-TASK06`，项目负责人确认审核角色、自审、单步审核、24 小时幂等、60/20 限流、1095 天审计和 MANUAL 来源边界；五个 API、`0002`、只读 Query、事务伴随幂等/审计及隔离测试已完成，全量 Node 58/58 和本机 API smoke 通过，未接生产。
- 已完成：`PHASE1-TASK07`，九项方案 A 已记录并实现；草稿完整替换、提交/驳回/再编辑/重新提交、`PENDING_REVIEW`、审核队列、职责分离、并发/幂等、版本审计和 `0003` 隔离迁移测试通过。
- 已完成：`PHASE1-TASK08` 规格确认及非生产实施；统一查询、Reference、drafts 兼容、行级可见性、缓存、历史分页、稳定错误和批量 metadata 通过测试，1k/10k/100k 查询计划报告完成，未创建索引 migration。
- 已完成：`PHASE1-TASK09` 规格确认及非生产实施；四条原生页面路由、高密度列表、分区详情、独立历史页签、URL 状态、安全 return_to、共享请求边界和现有登录回跳通过测试；未修改 API、schema、migration、索引或业务服务。
- 已完成：`PHASE1-TASK10` 书面规格与低保真线框设计；确认布局 C、动态 Schema、完整替换、PATCH/GET/submit、权限、Validation、Schema 漂移、幂等、并发、dirty 和测试边界；未实施前端、API、schema、migration 或业务服务。
- 已完成：`PHASE1-TASK11` 非生产实现；统一详情从完整 REJECT 版本历史确定性返回 `last_rejection`，materials/drafts 共享查询，隔离测试和查询计划通过；未改 schema/migration/索引/写服务，未接生产。
- 已完成：`PHASE1-TASK12` 非生产实现；Material Draft 创建、编辑和提交审核页面、动态 Schema、权限入口、完整替换、写状态机、Validation、冲突/dirty/未知属性保护与 54 项 UI 验收通过；未改 API/schema/migration/业务服务，未接生产。
- 已完成：`PHASE1-TASK13` 书面规格与低保真线框设计；确认布局 A、队列恢复、能力权限、职责分离、批准/驳回、Validation 确认新鲜度、错误和 51 项实施测试边界；未实施前端、API、schema、migration、索引或部署配置。
- 已完成：`PHASE1-TASK14` 非生产实现；审核队列、方案 A 单条工作台、共享只读详情、批准/驳回、Validation 确认、职责分离、页面内存幂等/并发/离开保护和 51 项 UI 验收通过；未改 API/schema/migration/索引/业务服务，未接生产。
- 已完成：`PHASE3-MATERIAL-LIBRARY-01` 审计与非生产实现；复用既有 Material Master/Import/Normalization/Review，新增 `0007` 标准单位、品牌、来源关联和重复候选，接通 Approval→Draft；全量 Node 569/569、build、隔离 API smoke、Drizzle、凭证和临时 SQLite 基线通过；真实文件 dry-run、生产迁移和部署未执行。
- 已完成：`PHASE3-MATERIAL-LIBRARY-SUPPLIER-ADAPTIVE-IMPORT` 非生产实现；功能提交 `41e293f` 复用既有导入链路，新增 `0008`、Sheet/多行合并表头评分、集中 Mapping、Supplier Profile、多列规格、Canonical Row、非数据行排除和空规格阻断；Node 589/589 及完整隔离基线通过，未连接生产。
- 已完成：`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-01`；功能提交 `cea940a` 只读验证 A118/V700，修正错后缀 XLSX、BOM/变更记录 Sheet 评分、厂商料号限定、“用量”和安全错误；Node 593/593，未提交真实附件或连接生产。
- 已完成并部署开发服务器：`PHASE3-MATERIAL-LIBRARY-EXCEL-COMPAT`；实际 Python 网页支持 CSV/XLSX/XLS，保存批次、不可变 Raw Rows、Mapping/规格置信度和 Review 状态；专项 9/9、联合单元 13/13、self-test、smoke、go-live 和公网静态资源检查通过。
- 已完成并受控入库：`PHASE3-MATERIAL-LIBRARY-REAL-SAMPLE-IMPORT-02`；A118/V700 完整原文件归档，543 条清洗行全部待审核，内部物料未自动增加。
- 已完成开发匹配基线：`PHASE3-MATERIAL-LIBRARY-MATCH-SEED-01`；备份后清空 543 条旧 Cleaning Rows，建立内部编码 1～5 的五条电容，匹配均为 1.00；原始归档未删除。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-CONFIDENCE-SORT-01`；清洗列表支持匹配置信度升降序，服务端先排序后限制，页面切换只刷新清洗数据。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-CLEANING-CLEAR-01`；管理员可在自动备份和双重确认后清空 Cleaning Rows，真实 229 条在部署时未被自动删除。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-SPEC-MATCH-01`；三份新 BOM 可进入规格清洗，名称与编号匹配解耦，完整唯一规格才自动确认内部编号，部分唯一候选保持疑似。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-STRUCTURED-SPEC-MATCH-01`；1928C 从型号、描述等独立来源逐项提取规格，单项冲突淘汰候选，缺少内部规格时不假装匹配。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-REVIEW-SPEC-DISPLAY-01`；清洗审核写出来源与候选两侧分项规格，型号/MPN 与规格分离，人工可直接核对缺项。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-GENERAL-SPEC-MATCH-01`；通用参数提取覆盖电容/电阻/电感及常见工程量，参数顺序不影响相似度，规格来源和逐项证据保存于既有 Cleaning。
- 已完成并部署：`PHASE3-MATERIAL-LIBRARY-SPEC-PRECISION-GATE-01`；规格大类不再单独产生候选，证据不足明确拦截，自动匹配要求完整唯一规格；J587 隔离回归中的 4 条连接器大类误候选已消除。
- 已完成：旧式 Excel 兼容增强；网页预检、上传安全、inspect 和现有 Parser Worker 支持 `.xls`，通过有界 OLE/BIFF 读取器转换为现有 Raw Row 契约；`.xlsx` 仍走 OOXML，未新增导入系统、表或生产部署。
- 方向变更：根据 D-028，后续默认交付运行面改为服务器本地 `chenyida_erp_app`；根据 D-029，本次公网验证绑定 `0.0.0.0:18888`，目标地址为 `http://43.135.157.211:18888`。`chenyida_erp_site` 不再作为后续新功能的默认整合和部署目标。
- 常驻状态：根据 D-030，开发服务器由 systemd `chenyida-erp.service` 托管，当前 `enabled/active`，支持开机自启和失败重启；正式投用时再迁移到公司服务器。
- 当前受阻：`PHASE3-MATERIAL-LIBRARY-02` 已从无数据模式进入真实样本审阅；A118 需重新导出以移除 XFD 异常块，V700 需人工确认标准名称和单位来源，故仍未执行真实 dry-run 或创建 DRAFT。
- 已完成：`PHASE2-TASK01` 正式书面规格、OpenAPI 草案、数据流图与 12 项 `PROPOSED` 决策表；定义存储/安全分离、批次级协调、原始行契约、权限、幂等、保留、清理和 Migration 设计；仅文档，停止等待“规格确认”。
- 已完成：`PHASE2-TASK02` 非生产实现；`0004`、对象存储抽象、R2/内存适配器、流式上传、安全检查、六个 API、专用幂等、Saga、取消和清理服务通过 Node 224/224 与隔离 D1/R2 替身测试；未创建或访问生产资源。
- 已完成：`PHASE2-TASK03` 正式书面规格、OpenAPI 草案、流程图、Mapping 规格和 16 项决定；定义 Outbox、Sheet 级恢复、原子发布、Shared Strings/总字节预算、Mapping 准备恢复与 `0005` 设计。
- 已完成：`PHASE2-TASK04` 非生产实现；`0005`、Parser、Outbox/调度抽象、租约恢复、Shared Strings 分块、原始行发布、Mapping 准备与七个 API 已通过 54 项专项和全量 Node 278/278；未创建或连接生产 Queue/R2/D1，未部署，也未创建 Material Draft 或正式物料。
- 已完成：`PHASE2-TASK05` Material Import Workspace UI V1 正式规格、22 状态线框、状态矩阵、100 项未来实施测试和 16 项决定；完整规格与决定已确认，仅文档，未修改运行时、API、Schema、Migration 或生产配置。
- 已完成：`PHASE2-MAINT-01` 在共享 breakpoint-aware 测试辅助层忽略空白及纯注释 SQL 片段，同时原样保留可执行片段；`0003`、`0004`、`0005` Down 和全量 Node 288/288 通过，未改变 Migration 业务语义。
- 已完成：`PHASE2-TASK06` Mapping Target Catalog V1 正式规格与 OpenAPI；比较批次/全局/混入 Mapping 三种路由，推荐批次作用域，定义共享 Registry/digest、BASIC/ATTRIBUTE/SPECIAL DTO、统一 cursor、权限/缓存/失效目标边界和 43 项未来测试；设计提交时 12 项决定为 `PROPOSED`，现已由 TASK07 批准。
- 已完成：`PHASE2-TASK07` 批准 12 项 Catalog 决定并完成非生产实现；共享 Registry/Snapshot/digest 被 Mapping 准备、保存、preview、confirm 与 Catalog 共用，51 项专项和全量 Node 339/339 通过，Catalog UI 门禁标记 `RESOLVED`；未改 Schema/Migration/前端或生产环境。
- 已完成：`PHASE2-TASK08` 非生产 Import Workspace UI；三条路由、SHA Worker、共享 XHR、轮询/取消、Rows/Header、Catalog/Mapping、UI-001—UI-100 与 50×256 Playwright 门禁通过；全量 Node 440/440，未改后端 API、Schema/Migration、Metadata 或生产环境。
- 已完成：`PHASE3-TASK01` Material Import Normalization & Staging V1 正式规格、OpenAPI 草案和数据流/状态图；16 项决定保持 `PROPOSED`，仅文档，未实施代码、Schema、Migration、API、前端或生产资源。
- 已完成：`PHASE3-TASK02` 批准全部 16 项决定并完成非生产 Normalization 服务、`0006`、五个 API、权限/限流/取消、隔离迁移与集成测试；未创建 Draft/正式物料，未迁移或部署生产。
- 已完成：`PHASE3-TASK03` Material Import Normalization Review UI V1 docs-only 设计与正式规格确认；四份正式文档覆盖统一路由、七步 Stepper、启动/轮询/取消、Current/Latest、Rows/Drawer/Issues、37 个线框、104 项测试、局部门禁和性能门禁，14 项决定均为 `APPROVED`；未实施运行时代码或改变生产环境。
- 已完成：`PHASE3-TASK04` Material Import Normalization Review UI V1 非生产实施；统一工作区、七步 Stepper、Current/Latest、冻结幂等与 `RESULT_UNKNOWN`、2/5/10 轮询、取消、汇总、Rows/Issues cursor、Row Drawer、安全有界渲染和权限清理均已落地；104/104 计划测试、100/100 Import UI 回归及本地 Playwright 性能/可访问性门禁通过，未改 API/Schema/Migration/业务服务或生产环境。
- 下一：只允许另立PO历史追溯页面修复/验收任务，并在UAT仅执行只读PO追溯验收；不得重试Award→PO，也不得开始仓库收货、IQC、入库、库存、AP、付款或生产。warehouse、quality及finance试用仍须各自独立明确授权。

## 更新规则

每个任务完成前必须更新本文件中的当前提交、阶段、任务、下一任务、完成模块、未完成模块和风险。只写已从代码、Git、数据库只读检查或平台状态确认的事实；计划和建议必须明确标注为计划或待确认。
- SELFHOST-LANDING-TASK01 已封存 `0.1.0-alpha.34` 完整 main 历史、clean-0034 PostgreSQL custom dump 和 uploads/attachments/backup-status 三个文件卷；Git Bundle clone、固定新空库恢复、文件卷 root-only 恢复与 SHA256SUMS 均实际验证。工件只位于 `/var/backups/chenyida-erp/landing-alpha34-20260728T042820Z`，含敏感身份数据，尚未异机复制、未 push 或上传
- SELFHOST-LANDING-TASK02 已对指定 8 个真实表格完成离线强校验、确定性分类、clean-0034 staging/重放、主库导入和 post-import 恢复；532 Material、6 Product、6 个 DRAFT BOM、316 行及 1,318 来源链接落库，438 条隔离，详细逐行证据只存仓库外 root-only 目录
- SELFHOST-LANDING-TASK03 已将公网 18888 受控切换到新 PostgreSQL ERP：Caddy 可信 TLS、生产 Cookie、匿名认证门禁和 60 秒资源观察通过；旧 Python 在回环 18889 保留，未改业务数据、Schema/Migration 或四个 ERP 持久卷
- SELFHOST-LANDING-TASK04 已在源码删除兼容业务台 CSV-only/退役导入表单并直达原生 CSV/XLS/XLSX 批次工作区，功能提交 `cda8c7e` 已部署到当前 18888 Web；Dashboard 12/12、Import UI 102/102、Parser 38/38、build、镜像静态合同及在线 SHA/路由/健康验收通过。未做 Excel→PG E2E，未执行 Migration 或写业务数据
- SELFHOST-LANDING-TASK05 已对单个 V9 XLSX 完成 root-only 显式字段 staging、pre-clean dump/list/恢复和重放；197 行全部缺显式单位且无 BOM 结构，主库未清理或导入，详细逐行证据只在仓库外 root-only 目录
- SELFHOST-OPS-UAT-PLANNING-REVISION-RESPONSE-13 已部署 alpha.38/0037：追加式 Revision Response Version、每 RETURN 独立 CAS Head、v1/RETURN/Response/v2 复合外键谱系、唯一后继/单次消费、不可变 SQL guard、固定 Product/BOM/Unit/Material/Document 快照和摘要绑定。67 次自动执行与 Python 三项基线通过；备份恢复与 engineering-only 主 UAT 只读验收后 v1/RETURN/Response/v2 仍 `1/1/0/0`
