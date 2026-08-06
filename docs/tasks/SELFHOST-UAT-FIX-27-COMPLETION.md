# SELFHOST-UAT-FIX-27 完成报告

## 最终状态

`RFQ QUOTE VERSION SEMANTICS FIXED — SUPPLIER A RETAINED`

采用诊断分支 A。RFQ Version 是整个询价聚合的 CAS，Supplier 首版报价是聚合内的一次事务性响应，因此 Supplier A成功提交时 `ISSUED v3→ISSUED v4` 与邀请 `INVITED→RESPONDED` 都是0039权威模型的正常推进，不是 Mapping 或固定范围漂移。错误漂移判断和Quote追溯展示已修复并仅替换Web；Supplier A Quote ID 1完整保留，主UAT未创建Supplier B Quote、Award、PO或其他下游。

## 严格起点与保护边界

- 起点为clean `main@119dd04f724fccb0ef2b849b974d3e93c5c55008`、Parent `f6f7d2ac492ca6d278c99dc991b20f26d882f682`、behind 0/ahead151；版本`0.1.0-alpha.40`，Migration `0001—0039`，0039 SHA-256 `3cbf573844a9b7cb0227d3aa56d1dd40aaa48075f44d64f8c4cc1149478e3f37`，没有0040。
- 起点Web为`sha256:c8c3fdd52236b84e3ceb67f7b81ca2e5530bfaba964a92ebd22dab9f7da19989`。Web/PostgreSQL healthy，Worker/Caddy running；四服务RestartCount 0、OOMKilled false。
- 主UAT仅在repeatable-read/read-only事务中读取RFQ ID 1、Supplier 1/2、Binding 1—8、Supplier A Quote/Event及Quote/Award/PO计数。部署前固定保护指纹为`597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`。
- 起点与最终均为RFQ `ISSUED v4`、Binding 8、`RFQ_MAPPING_CONFIRMED` 1、`RFQ_ISSUED` 1、Supplier A Quote 1、Supplier B Quote 0、Quote/Award/PO `1/0/0`。未删除、撤销、修订、重建或重提Supplier A Quote，未回退RFQ CAS，未改Binding/Mapping/RFQ范围/历史Event。

## 权威语义诊断

1. **RFQ CAS保护整个询价聚合。** `recordQuote`先锁定RFQ并校验`expected_version`，再在同一Repository事务内插入Quote Header/Lines、更新对应邀请、推进RFQ Version、写Quote Event、Audit和幂等结果；任一步失败均回滚。
2. **`v3→v4`是预期CAS推进。** 0039明确允许`ISSUED→ISSUED`且要求Version恰好`old+1`，用于报价、比价等询价聚合内动作。RFQ Head CAS变化不表示冻结范围变化。
3. **`INVITED→RESPONDED`是正式成功状态。** 0039邀请状态保护只允许`INVITED→RESPONDED|DECLINED`；Supplier A为RESPONDED。Supplier B拥有独立邀请行，仍为INVITED。
4. **固定范围未变化。** Binding 1—8、Supplier/Line集合、Mapping ID/Version/Row CAS/content digest、Mapping ACTIVE/唯一有效性均与发出时一致。按现有`canonicalDigest`复算仍为`9765f8fdef768335a25b314867dd3e077429a84848cba067ff8394c8a017848d`。
5. **Supplier B仍可独立报价。** 服务端读模型返回Supplier B `INVITED`且`quote_entry_enabled=true`；隔离环境成功提交并验证并发单胜。主UAT只观察入口，没有进入、填写或提交，Supplier B Quote最终仍为0。
6. **原“当前阻断项”来源。** Repository的`eligible`同时要求邀请为INVITED；Service此前把所有`!eligible`固定Binding并入阻断项，且兜底显示“Mapping Version/CAS已漂移”。Supplier A正常RESPONDED因此被误判。
7. **错误基线已更正。** 范围漂移现在只由固定Binding完整性与稳定ID、Supplier/RFQ Line固定集合、Mapping ID/Version/Row CAS/content digest/状态/有效期/唯一性和固定摘要决定。邀请响应生命周期和RFQ当前聚合CAS不再充当Mapping漂移谓词；真实Mapping变化仍失败关闭。

## Quote追溯合同

- 稳定身份：Quote数据库ID `1`。现有Schema没有独立Quote业务编号字段，页面精确显示“未设置独立Quote业务编号”，没有用数据库ID、RFQ编号或外部参考伪造业务编号。
- 归属与版本：Supplier ID `1` / `SUP-000001`，RFQ ID `1` / Round `1`，Quote `v1`，权威状态`SUBMITTED`；外部参考`UAT-Q-A-042576`，有效期`2026-09-30`。
- 记录凭证：actor `uat_20260729_purchase`，记录及Event时间`2026-08-06 13:10:59.800906（Asia/Shanghai）`，request_id `5ca5863a-6a5d-4457-917a-d1b24f41ccff`，结果`SUCCESS`。
- Event语义：产品模型为单事务直接提交Quote，只产生一条`QUOTE_SUBMITTED`，没有独立CREATE Event；页面明确说明该合同且不伪造CREATE。历史Event的`old_version/new_version`均为空，未回填或改写；页面显示“事件未记录版本转换”，并从Quote Header独立显示当前v1，未出现`vnull`。
- 金额与交期：四行均由服务端投影`10 PCS × 12.00 CNY`、行金额`120.00 CNY`；服务端总额`480.00 CNY`。需求日`2026-10-30`、承诺日`2026-10-20`、日期差10天、`ON_TIME`，中文说明“准时，提前10天”。浏览器只格式化服务端小数字符串，不成为金额、交期或业务状态权威。

## 实现结果

- Repository新增与邀请状态解耦的`scope_intact`；固定Binding卡片和漂移问题使用该字段，DRAFT当前资格仍使用要求INVITED的`eligible`。
- Service只在DRAFT发出资格中把当前邀请资格列为阻断；已发出RFQ的RESPONDED不再污染范围完整性。首版Quote接口显式拒绝非INVITED邀请，已有当前Quote仍返回修订语义。
- 详情读模型显式提供Quote稳定ID、业务编号存在性、RFQ/Supplier/Quote版本状态、actor/上海时间/request_id、服务器行金额/总额、需求/承诺日期、提前/延期天数、稳定交期状态及中文解释，并明确Event是否记录版本转换。
- 页面按Supplier独立展示RESPONDED/INVITED和首版Quote入口；Supplier A从首版提交下拉框移除，Supplier B仍可见。Quote追溯卡完整展示Header、四行、总额与Event；修订操作折叠，不改变既有不可变历史。
- 未修改Schema、0039或任何已执行Migration；未新增0040，版本保持alpha.40。

## 自动测试

- Unit/UI合同：`9/9 + 12/12`。
- 隔离PostgreSQL：`21/21`。覆盖首家Quote后CAS/RESPONDED、第二家INVITED、Binding/摘要不变、真实Mapping CAS漂移失败关闭、稳定Quote/Event/金额/交期、幂等重放、异正文冲突、过期CAS、权限/CSRF和Supplier B并发单胜。
- 隔离Chromium：`3/3`。FIX-27用例覆盖四行`480.00`、提前10天、无阻断/红色漂移/`vnull`、Supplier B独立入口及隔离成功报价、桌面和390×844；该Supplier B Quote只存在于临时库，库已删除。
- Migration：0018 upgrade `3/3`，0039空库/升级/重放/回滚/Schema合同`6/6`。
- 基线：`npm test` `3/3`、environment guard `6/6`、Python `server.py --self-test`/`smoke_test.py`/临时SQLite `go_live_check.py --no-backup`全部通过。
- 静态/构建：采购寻源typecheck、production build/postbuild、最终Docker Web build、1,236文件凭据扫描和`git diff --check`通过；lint为0 error/11个既有warning。首次环境守卫只因测试容器未挂载仓库根`config/`而失败，修正只读挂载后6/6通过，没有改代码或降低断言。

## 备份、恢复与Web-only部署

- 正式备份：`/var/backups/chenyida-erp/rfq-quote-semantics-fix27-predeploy-20260806T064119Z.dump`，root:root、0600、单硬链接、2,286,915 bytes，SHA-256`4fa038e093a846ae0d8380f383b5fc9a89cb926aded1c3bc98746269f89a400d`。
- `pg_restore --list`为3,359行。第二全新库`rfq_quote_fix27_restore_20260806`恢复为39/head 0039、226张public表，保护指纹仍为`597eb456837e0cda35d3544c1aeae94f3a190eed373d1145de5a72261fe37f9f`；恢复库随后精确删除，正式备份保留。
- 只把Web从`sha256:c8c3fdd52236b84e3ceb67f7b81ca2e5530bfaba964a92ebd22dab9f7da19989`（88,546,098 bytes）替换为`sha256:20b41bd34741758e707f3748baaa1018232df6be5d44cd63bed290fd49c9f4f9`（88,551,279 bytes）。旧Web保留为`rollback-rfq-quote-semantics-fix27-predeploy-20260806T064119Z`。
- 没有运行Migration。PostgreSQL容器`f3a2f3cb…`、Worker`fb68d9a81…`和Caddy`c209765be…`的ID与启动时间未变；四个受保护Volume未更换。内外health通过，四服务RestartCount 0、OOMKilled false。

## 主UAT只读验收

- 只登录`uat_20260729_purchase`；浏览器路由拒绝除login/logout外的任何非只读请求，仅允许Session和RFQ详情API读取。没有进入、填写或提交Supplier B报价。
- 服务端与页面在桌面和390×844核对ISSUED v4、Supplier A RESPONDED、Supplier B INVITED且入口可用、Binding/摘要完整、Quote ID 1/SUBMITTED v1、无业务编号、四行金额、480.00总额、提前10天、actor/上海时间/request_id/SUCCESS、无CREATE及无版本转换事实。
- 首次runner完成桌面断言后，仅因移动端错误期待连续字符串“SUP-000002 · INVITED”而停止；实际UI分栏显示`SUP-000002`和`INVITED / 待报价`。finally已logout，Session 0、business POST 0、保护指纹不变。只修正验收器字符串断言并lint后最终runner通过。
- 最终runner输出`business_post=0`、desktop 1、mobile 1、Session 0。最终哈希复验与起点完全相同；Quote/Award/PO仍为`1/0/0`，Supplier B Quote仍为0。

## Git、资源与清理

- 功能提交：`1be492e68f6635bc00ea3fb8ce461eac0617d8e7`，`fix: correct rfq quote traceability semantics`。部署、恢复、主UAT、runner小修、D-099和文档由独立`ops: deploy rfq quote traceability fix`提交收口；实际SHA以`git log`为准。
- 未push、PR、amend、rebase、reset、stash、restore或改写历史；版本和Migration未变，秘密、数据库、dump正文、Cookie/Token/Session材料未进入Git。
- 起点约available memory 2.1 GiB、Swap 290 MiB、根盘19 GiB、Load`0.04/0.09/0.08`；最终约2.2 GiB、Swap 287 MiB、根盘18 GiB、Load`0.14/0.17/0.33`。迁移测试后1分钟Load曾瞬时6.21，30秒后降至3.18，未持续三分钟超过4；Swap最高约292 MiB，未触发停止阈值。任务窗口内核OOM 0，四服务restart 0/OOM false。
- 隔离PostgreSQL/Chromium库、恢复库、临时容器、Playwright runtime和Python临时SQLite已精确清理；匹配FIX-27的临时数据库/目录/容器均为0。未prune。正式备份、当前/候选/rollback Web镜像和四个受保护Volume保留。

## 停止边界

Supplier B技术上重新具备首版Quote条件，但主UAT Supplier B Quote仍为0。本任务到此立即停止；创建Supplier B Quote、修订Supplier A Quote、生成Comparison/Award/PO或任何下游都需要新的明确授权。
