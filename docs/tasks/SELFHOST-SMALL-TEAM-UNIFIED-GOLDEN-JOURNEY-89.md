# SELFHOST-SMALL-TEAM-UNIFIED-GOLDEN-JOURNEY-89 现代接口同库黄金旅程

> 状态：`DONE / TEST-HARNESS CLOSED / MODERN GOLDEN JOURNEY PASS / PRODUCTION NO-GO`
> 日期：2026-08-23（Asia/Shanghai）
> 依赖：TASK88、D-168、D-169、低资源服务器保护规则
> 责任：Codex更新隔离测试旅程；项目负责人后续授权真实样本与员工UAT

## 1. 目标

在同一个全新隔离PostgreSQL数据库中，用当前现代服务/API连续证明主数据、Supplier Mapping治理、市场→工程→计划→需求、采购寻源、生产/品质、销售/财务的最小黄金旅程，替代仍调用退役`POST /api/mappings`的历史全ERP smoke。

## 2. 允许范围

- 更新或新增隔离黄金旅程测试、必要的合成fixture和测试说明。
- 复用当前正式服务/API、稳定内部ID、现代Supplier Mapping草稿→提交→异人审核及现有冲销路径。
- 仅在测试实际复现且可保持最小边界时修正测试工具；若发现新的产品P0，停止扩展并登记独立修复任务。
- 必要治理文档和独立Git提交。

## 3. 禁止范围

- 不恢复退役Mapping直写，不放宽审核、权限、事务、幂等、CAS、审计或失败关闭。
- 不新增Schema、Migration、角色、页面、模块、微服务或基础设施，不为测试制造假业务状态。
- 不连接UAT/生产、真实数据、账号、凭据、备份或受保护Volume；不build、不deploy、不重启现有Compose。
- 不把每职能2人或总人数写入测试、权限、Schema或容量硬条件。

## 4. 验收标准

- 一个全新0046隔离数据库连续运行现代Supplier Mapping及核心跨域链，所有正式引用使用稳定ID，关键交接和数量/金额守恒有明确断言。
- 同一旅程包含至少一个授权拒绝、一个并发/幂等边界及一个合法冲销或反向记录验证；测试失败不得降低断言或恢复退役接口。
- 结果必须区分产品失败、测试工具缺口和未授权真实环境，不以局部Service套件替代统一旅程。
- 适用Unit/PG合同、`git diff --check`、敏感信息及资源/OOM/restart/临时资源清理全部通过。

## 5. 启动条件

TASK89启动前必须重新通过低资源门；数据库、Migration和测试串行，一次最多一个任务临时容器。根盘可用低于10 GiB或其他停止线触发时保持`TODO`并停止启动重任务。

## 6. 执行记录

- 2026-08-23 22:40 CST：项目负责人要求“下一步”，TASK89由`TODO → DOING`成为唯一执行中任务。启动门为available memory约2.4 GiB、Swap 171 MiB/1 GiB、根盘可用10,771,357,696 bytes（仅高于10 GiB硬线约33.9 MiB）、Load 0.05/0.07/0.11、`oom_kill=0`；四个既有服务均restart 0/OOM false，Web/PostgreSQL healthy，零`cyd-task89-*`残留。Compose渲染因未加载受控`ERP_DEPLOYMENT_CLASS`而按预期失败，未读取env或凭据；容器只读状态已独立核验。
- 新增`tests/selfhost-small-team-unified-golden-journey-postgres.test.mjs`，并把`test:small-team:golden-journey:postgres`及历史兼容入口`test:full-erp:compose`统一指向该现代测试。历史脚本继续保留为审计证据，但不再被包脚本选中；产品代码、Schema、Migration、API和权限均未修改。
- 测试强制精确数据库名、独立确认短语、46项Migration/head `0046_runtime_lock_privilege_boundary.sql`、空业务库和最大2连接；每个相关角色只创建一个合成账号用于职责交接，不构成人数、席位或组织结构约束。
- 同一数据库完成物料审核、正式产品/BOM、Supplier Mapping草稿→提交→异人审核、市场项目→工程接收→计划包、净需求10、RFQ/报价/中选、PO与到货、生产领料/报工/完工、销售订单、成品放行/出货、应收结算与追加式冲销。原料稳定ID贯穿Mapping、BOM、计划、需求、RFQ、PO和生产；采购/领料/完工/出货数量均为10，采购金额120、销售金额200。
- 旅程显式验证旧`POST /api/mappings`继续返回409、无权仓库用户创建项目返回403、物料与工单幂等重放、当前版本CAS、品质异人放行，以及财务不原地改写的追加式结算冲销。未降低断言、恢复退役直写或直接写造假业务状态。
- 首次隔离运行在PRQ采购接收后继续假定版本1，RFQ创建正确返回`409 VERSION_CONFLICT`；核验当前服务行为后将测试改为读取交接后的实际版本2。这是测试工具CAS假设，不是产品P0。随后两次从空库重新应用全部46项Migration，统一旅程均`1/1 PASS`。
- 13组相关轻量Unit合同串行`PASS`：Material、Supplier Mapping、Project、Planning Handoff、Material Requirement、Sourcing、Fulfillment、Production Handoff、Operation、Final Output、Quality、Sales和Finance。宿主没有Node，直接复用既有Web容器根文件系统中的只读Node 22.23.2；npm CLI因宿主路径重解析无法启动，但包脚本中的精确Node命令已原样`1/1 PASS`，JSON解析和语法检查通过。

## 7. 统一旅程结果

```json
{"ok":true,"schema":"0046","project_id":1,"raw_material_id":1,"product_id":1,"purchase_order_id":1,"work_order_id":1,"sales_order_id":1,"quantities":{"purchased":"10","issued":"10","completed":"10","shipped":"10"},"amounts":{"purchase":"120","sales":"200"},"payment_reversed":true}
```

- `PASS`只证明当前源码在合成、隔离、全新0046数据库中的现代最小整链和守恒合同。
- 未连接或修改UAT alpha.42/0040；未使用真实账号、业务数据、凭据、备份或受保护Volume，未build、deploy或重启常驻Compose。
- 真实样本试迁移、实名员工UAT、恢复演练、源码/UAT版本收敛和上线授权仍未完成，系统继续`PRODUCTION NO-GO`。

## 8. 资源与清理

- 重任务前复核约2.4 GiB available、171 MiB Swap、根盘10,773,078,016 bytes、Load 0.07/0.11/0.09、`oom_kill=0`及四服务restart 0/OOM false。
- 全程只有一个`cyd-task89-postgres`临时容器，限制1 CPU、512 MiB memory/swap，数据库数据使用384 MiB tmpfs；Migration、统一旅程和合同测试全部串行。
- 清理后约2.4 GiB available、171 MiB Swap、根盘10,755,850,240 bytes（仍高于10 GiB停止线）、Load 0.22/0.45/0.29；最终静态门后复核为约2.4 GiB、171 MiB、10,811,756,544 bytes、Load 0.18/0.22/0.22。四服务healthy/restart 0/OOM false、宿主`oom_kill=0`；任务容器、数据库、端口、网络、Volume及`/dev/shm`残留均为0。

## 9. 收口与下一门

- TASK89由`DOING → DONE`，D-170固定现代同库黄金旅程为当前合成基线；历史全ERP脚本不再是正式入口。
- 下一任务登记为`SELFHOST-SMALL-TEAM-REAL-SAMPLE-UAT-PLAN-90`，仅准备真实样本、实名岗位验收和试迁移/回退授权包。没有项目负责人提供并批准样本、人员和目标环境前保持`TODO`，不得自动访问真实数据、创建账号、迁移或部署。
