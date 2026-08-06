# SELFHOST-UAT-FIX-28 — RFQ Comparison聚合读模型与摘要修复完成报告

最终状态：`RFQ COMPARISON AGGREGATE READ MODEL FIXED — UAT AWARD NOT CREATED`

## 范围、起点与Schema结论

- 从唯一worktree、clean `main@0d4e28842130a3289bea24c4eb9762c250de9809`、Parent `943c7fa5da44182617fa8a4f1d75b49b6d6c3795`、behind 0/ahead 159、`0.1.0-alpha.40`、Migration `0001—0039`起步；0039 SHA-256保持`3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`。
- 采用现有关系模型，不建立第二套Comparison Header/Version，不复制Quote JSON快照，不修改0039、不新增0040。Schema已具备稳定逐行Comparison、不可变Candidate/Quote Line、版本、持久化basis、排名、金额、日期和Event身份，足以确定性形成聚合读模型。
- 功能提交为`80e1ad60fa1272017545e150721c8b71f7c68828`（`feat: add RFQ comparison aggregate read model`）；部署/UAT/清理及项目文档由独立`ops: deploy RFQ comparison aggregate read model`提交收口，实际SHA以`git log`为准。未push、未PR、未改写历史。

## Comparison身份、状态与摘要

- `procurement_quote_comparisons.id`是每条Comparison Line的稳定数据库ID；主UAT四条ID为`1,2,3,4`。没有独立Comparison Header ID，页面精确显示：“未设置独立Comparison Header ID；版本身份由RFQ、Round、Comparison Version及basis_digest共同确定。”
- Comparison Version权威身份为RFQ ID `1`、Round `1`、Comparison Version `1`和按RFQ Line稳定排列的全部持久化`basis_digest`：
  - Line 1：`cb3449655288f13e6b87b465fe78e085654c53bccb21838231e4df994857912d`
  - Line 2：`b567977c2e703b9a23399d1367a74b99d5c23b904ca5abb4b8570943889871f7`
  - Line 3：`cc4a9f9eef31ebfd900f678fd7798cdf8678d4b78cae0c983ead6e6f6232bfcd`
  - Line 4：`022971ffeb9cd977ee4d4f81d56ff5cf90df9022e433d669c308772f5c5a992f`
- Schema没有独立Comparison状态列。服务端把最新且固定Quote输入仍为当前可定标版本投影为`CURRENT / 当前比价版本`；存在更新Version的旧版本投影为`SUPERSEDED / 历史比价版本`；最新输入漂移时投影`INPUT_DRIFT`并关闭定标。页面明确说明“状态为服务端读模型投影，不是独立数据库状态列。”Award仍由服务端/数据库重验最新Version，页面标签不具授权力。
- 输入摘要就是上述逐行持久化`basis_digest`。输出摘要按Material ID、Supplier ID、Comparison Line ID、Comparison Candidate ID稳定排序，由八条已保存Candidate及不可变Quote Line重算；纳入Version、固定Quote Line、Material、Supplier、数量、单价、行金额、排名、承诺日期、ON_TIME/LATE和提前/延期天数。主UAT确定性输出摘要为`79554d88ccdb643a860c0c69e77222abce80eb4d3d8314d88135d3966fb619ec`，页面明确说明其是读模型重算值，不是历史持久化字段。

## 固定输入与正式汇总

- 固定输入完整追溯到RFQ `1 / RFQ-00000001 / Round 1`、生成时RFQ CAS v5、生成后v6、Quote ID `1/v1`与`2/v1`、外部参考、八条固定Quote Line ID、Material ID/正式编码和完整basis；当前两份Quote均仍为`SUBMITTED v1`，无输入漂移。
- 四个Material为：`533 / CYD-RB_PCB-000016`、`534 / CYD-RB_SENSOR-000003`、`535 / CYD-RB_CONN-000075`、`536 / CYD-RB_METAL-000015`；每行`10 PCS`、需求日期`2026-10-30`。
- Supplier A固定Quote ID `1/v1`、外部参考`UAT-Q-A-042576`：每行单价`12.00 CNY`、行金额`120.00 CNY`、四行总额`480.00 CNY`、承诺`2026-10-20`、`ON_TIME / 提前10天`。
- Supplier B固定Quote ID `2/v1`、外部参考`UAT-Q-B-042576`：每行单价`10.00 CNY`、行金额`100.00 CNY`、四行总额`400.00 CNY`、承诺`2026-11-05`、`LATE / 延期6天`。
- 聚合差异为A比B高`80.00 CNY`、以B为基准高`20%`、A早`16天`；最低价格Supplier B，满足需求日期Supplier A，Supplier B存在延期风险。页面显示“比价不等于定标；不自动产生Award。”
- 两份Quote有效期均为`2026-09-30`，付款条件均为“纯虚拟UAT付款条件，仅用于表单验收。”，口径均为未税、不含运费；这些字段与金额/交期均由服务端DTO提供，浏览器只格式化展示。

## Event操作凭证与生成治理

- 数据库真实存在四条`COMPARISON_GENERATED/SUCCESS` Line级Event，不是join重复。它们共享actor `uat_20260729_purchase`、时间`2026-08-06 17:35:19.942600 Asia/Shanghai`、request_id `69b1b561-c460-4e98-9560-26dfea17b30f`和结果；唯一成功Audit证明RFQ CAS `v5→v6`。
- DTO继续独立查询Event，UI按actor、时间、request_id、result分为一个“Comparison生成操作凭证”，显示Event数量4并逐条关联Comparison Line/Material；明确不是四次用户点击或四个Comparison Version。没有删除、合并、回填或改写历史Event。
- 当前Quote输入与已保存basis一致时，服务端读模型返回`CURRENT_INPUT_ALREADY_GENERATED`，按钮显示“当前Quote输入已生成最新比价”并禁用，刷新后保持。隔离测试证明同输入POST幂等返回现有v1，不新增Comparison/Candidate/Event或RFQ CAS；Quote修订后才允许生成完整v2，v1不可变，并发同输入只形成一个新Version。

## 自动测试与隔离验收

- Comparison Unit `10/10`、UI合同`18/18`、隔离PostgreSQL `3/3`通过；覆盖复合身份、CURRENT/SUPERSEDED/INPUT_DRIFT、固定Quote Header/Version/Line、完整basis、确定性输出、总额/80元/20%/16天、交期、单Event/四Event fixture、无join扇出、同输入幂等、Quote修订v2/v1不可变、历史Version Award拒绝、权限/CSRF/Origin/CAS、并发和故障回滚。
- 0039现有回归`6/6`通过；Schema generator在隔离overlay验证Comparison无结构差异，仅重现两处既有Supplier Mapping CHECK限定名差异，临时输出已删，仓库无0040。TypeScript专项typecheck通过。
- 隔离Chromium Comparison `1/1`和完整RFQ套件`4/4`通过；桌面与390×844无页面级横向溢出，Supplier/Material卡片、可折叠追溯、长digest/request_id复制和可见但未点击的定标入口均通过，浏览器业务写为0。
- Vinext production build/postbuild和最终Docker Web build通过；lint为0 error/11个既有warning，`npm test 3/3`、environment guard `6/6`、Python `server.py --self-test`/`smoke_test.py`/临时SQLite `go_live_check.py --no-backup`、1,254文件credentials扫描和`git diff --check`均通过。

## 正式备份、恢复与Web-only部署

- 正式备份：`/var/backups/chenyida-erp/rfq-comparison-aggregate-fix28-predeploy-20260806T134904Z.dump`，root:root、0600、单硬链接、2,291,624 bytes，SHA-256`8e8589838c31f044c7741df9958556369b3eba4746d42c98b82dbb2d8bffa`。
- `pg_restore --list`为3,359行。第二新库`rfq_comparison_aggregate_restore_20260806`恢复为39/head 0039、226张public表，完整保护指纹仍为`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`；恢复库随后精确删除，正式dump保留。
- 最终Web镜像为`sha256:0dfcc0a8639e09e6ca0380292d979a2f73510a76cdcd23d46001bfb9c145273d`。仅以`--no-deps --no-build --force-recreate web`替换Web；旧Web`sha256:89e7677538751f2c0a049a113f3d24372a18edaf752bf837038580ac951bd153`保留为`rollback-rfq-comparison-aggregate-fix28-predeploy-20260806T135036Z`。没有运行Migration，没有重建PostgreSQL、Worker或Caddy，没有修改四个受保护Volume。

## 主UAT只读验收与最终数据

- purchase-only实际登录并只读打开现有Comparison；桌面和390×844核对复合身份、Line ID、CURRENT投影、两份固定Quote及八条Quote Line、basis/output digest、Supplier/Material汇总和一个四Event操作凭证。生成按钮禁用；定标入口只确认可见，未打开；未点击生成、定标、Award或转PO。
- 主UAT runner只允许login/logout POST，业务POST为0；安全退出后purchase有效Session为0。保护指纹在部署前、恢复库、部署前复核、主UAT后始终为`16d70f1865e3a2e3b0e840f289d13b340e4f6b87800b1c79d98865112d0cf5bc`。
- 前后均为RFQ `ISSUED v6`、Binding 8、Quote 2（均SUBMITTED v1）、Comparison Line/Candidate/Event `4/8/4`、Award 0、PO 0。没有创建、修改或打开Award/PO流程。

## 资源、清理与独立定标条件

- 重任务全部串行，任一时刻最多一个临时容器。起点与构建/备份/部署门禁约为available 2.2 GiB、Swap 275 MiB、根盘18 GiB、低Load；最终为available 1.9 GiB、Swap 269 MiB、根盘18 GiB、Load `0.11/0.26/0.44`。任务窗口内核OOM 0，Web/PostgreSQL/Worker/Caddy均restart 0、OOM false。
- 第二恢复库和任务创建的隔离库已删除；起点即存在的`procurement_sourcing_test_fix22_20260805`已恢复为空public Schema；Playwright runtime、临时SQLite、Schema输出和临时容器均清零。未执行prune；正式备份、当前/候选/rollback镜像和四个受保护Volume保留。
- 当前读模型为`CURRENT`、固定Quote输入仍当前、无漂移、四条RFQ Line均有可定标Candidate，`awardable_now=true`，因此具备发起“独立人工定标任务”的技术前置条件。这不等于已经定标或获得业务批准；Award仍须新的明确授权、重新读取当前CAS/Comparison Version/Quote资格，并由服务端事务门禁执行。本任务已停止于Award 0、PO 0。
