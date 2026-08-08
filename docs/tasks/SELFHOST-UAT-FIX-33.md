# SELFHOST-UAT-FIX-33 — Award to PO Supplier Mapping Validation Diagnosis and Fix

## 状态、授权与起点

- 状态：`FUNCTION IMPLEMENTED / PRE-DEPLOY VERIFIED`；任务台账仍为唯一`DOING`，正式备份恢复、Web-only部署和主UAT取消验收尚未执行。
- 日期：2026-08-08（Asia/Shanghai）。
- 授权：诊断 Award #1 转 PO 的 Supplier Mapping 422，修复 GET 预览与最终 POST 的资格规则不一致；在隔离 PostgreSQL/Chromium 完成成功和失败验证后，执行正式备份恢复、Web-only 部署，并仅用 purchase 打开主 UAT 预览、填写备注、桌面/390×844核验、取消和安全退出。
- 禁止：不得重试主 UAT 转换；不得修改、重提或重新批准主 UAT Mapping；不得修改 Award、Candidate、Binding、Quote 或 RFQ；不得创建主 UAT PO；不得直接 SQL 修主 UAT；不得登录 operations 或其他角色；不得新增或运行 0040。
- 精确起点：`main@79ac7fae76fdb69286a16f0bbd9551d41598cd57`，Parent `a4ffb8ee022234ea25add4ce636050366ac6887a`，behind 0 / ahead 169，工作区 clean，单一 worktree，无并发 Mapping/Award/PO 任务；`0.1.0-alpha.40`；Migration 0001—0039；Web `sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`。

## 主 UAT 保护基线

- RFQ 1 `CLOSED/v7`；Award 1 `AWARDED/v1`；Award Line 1—4；Candidate 2/4/6/8；RFQ Binding 1—4。
- PO / PO Line / Delivery Plan / queue 均为 0；成功转换 0；现有粗粒度页面投影 `po_convertible_now=true`。
- 失败请求 `f30a7801-1cd0-4849-95a8-9c61d5c52e67` 恰好一次，HTTP 422，错误代码 `AWARD_SUPPLIER_MAPPING_NOT_UNIQUE`，中文“定标物料必须存在唯一有效的一比一Supplier Mapping”；无半记录。
- 主 UAT 验收始终要求 `business POST=0`，并在取消、退出后保持上述业务事实不变。

## 权威 Mapping 与谱系

| Award Line | Candidate | Quote Line | RFQ Binding | Supplier | Material | Mapping UUID | Fact / Mapping Version / Row CAS | Supplier Part |
| ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |
| 1 | 2 | 1 | 1 | 1 / SUP-000001 | 533 | `224d1965-44ef-4c3e-901e-1926b6b07ff8` | 1 / v1 / 3 | `UAT-A-PCBA-042576` |
| 2 | 4 | 2 | 2 | 1 / SUP-000001 | 534 | `43ca04d8-9933-4dac-ba21-b7fb85741830` | 2 / v1 / 3 | `UAT-A-SENSOR-042576` |
| 3 | 6 | 3 | 3 | 1 / SUP-000001 | 535 | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` | 3 / v1 / 3 | `UAT-A-HARNESS-042576` |
| 4 | 8 | 4 | 4 | 1 / SUP-000001 | 536 | `9659ad2d-406a-4c4c-b575-51329badc63f` | 4 / v1 / 3 | `UAT-A-CASE-042576` |

只读事务已证明四行 Supplier、Material、Mapping、Binding 和 PCS Unit 均 ACTIVE/enabled，Mapping 为 PCS→PCS、1:1、2026-08-05起长期有效，两类冲突均 0，Binding 快照与 Mapping fact 的 UID/version/CAS/digest 完全一致。身份只按稳定 Award Line→Candidate→Quote Line→RFQ Line/Supplier→Binding→Mapping fact 外键解释；禁止名称、料号、价格或数组位置桥接。

## 诊断分支与根因

采用分支 A，不需要 0040：

1. GET 转换预览只复用 Award 历史的粗粒度 `po_convertible_now`，没有执行逐行 Supplier Mapping 资格验证，也没有返回 Mapping 凭证。
2. POST 在写事务内另行按 Supplier/Material/Unit 重查 `supplier_mappings`，没有使用固定 RFQ Binding；因此 GET 与 POST 不是同一资格函数或 DTO。
3. POST 额外要求 `material.base_unit_id=unit.id`。主 UAT 四条 legacy Material 的关系化 `base_unit_id` 均为空，但已按 D-091 的兼容规则由 `base_uom=PCS` 精确解析到唯一启用 PCS Unit；POST 因而把四条合法 Mapping 全部过滤为 0。
4. 当前四条 Mapping 的换算均为精确 `1/1`，不存在 bigint 比较、状态、有效期、Supplier邀请、Version/Event伪重复或换算精度数据问题；但新统一规则必须覆盖这些失败关闭场景。

## 实现合同

- GET 与 POST 复用一个服务端资格函数和同一行级 DTO；使用一个显式 as-of 时间及 `[valid_from, valid_to)` 边界。
- 每行返回 Award Line、Candidate、Quote Line、RFQ Binding、Supplier、Material、Mapping UUID/fact/version/row CAS、状态、Supplier/Internal Unit、换算率、有效期、content digest、两类冲突数、`qualified`、稳定错误代码和中文原因。
- `po_convertible_now=true` 仅在完整 Award 行集逐行全部 qualified 且 PO/PO Line/Delivery Plan 为 0 时返回；确认窗口在桌面和移动端显示四行资格凭证。
- 最终 POST 锁定 Award、Award Line、固定 Binding、Mapping fact 及相关 Supplier/Material/Unit，使用与 GET 相同函数重算；确认正文携带资格摘要断言，真实 Binding/Mapping 状态、版本、有效期或 digest 漂移失败关闭，无关 Mapping 变化不阻断。
- PO Line 使用固定 Binding 指向的 Mapping fact；浏览器不提交或决定 Supplier、Material、价格或 Mapping ID。既有单事务 PO/Line/Link/Plan/queue/Event/Audit/幂等与故障回滚边界保持。

## 实施与预部署验收记录

- 新增共享`AWARD_PO_MAPPING_QUALIFICATION_V1`资格服务。GET在只读repeatable-read事务中加载资格；POST在同一写事务as-of下先重算预览，再锁定Award、Award Line、Candidate、Quote/Quote Line、Binding、固定Mapping及相关Supplier/Material/Unit，使用同一loader和DTO重算摘要。
- 资格只沿`Award Line→Candidate→Quote Line→RFQ Binding→Mapping fact`解析。Mapping Event不参与基数；DTO中的数据库ID保持规范十进制字符串，排序使用`BigInt`，不按名称、supplier part、价格或数组位置反查。
- legacy主单位按D-091仅在`base_unit_id`为空时由`base_uom`精确解析唯一启用Unit；Supplier Unit、Internal Unit与RFQ Unit必须相同，换算分子/分母必须为正且相等。有效期使用单一transaction as-of与`[from,to)`边界。
- 两类冲突分别核验相同Supplier/Material当前ACTIVE 1:1事实和相同Supplier内标准化supplier part/稳定claim。资格读与Mapping写共用`part→material` advisory lock顺序；锁等待后重读Mapping identity/version/CAS，避免死锁和并发漂移误通过。
- 确认窗口合同升级为`AWARD_PO_CONFIRMATION_V2`，桌面表与390×844卡片逐行展示全部资格凭证。`po_convertible_now`只在完整行集全部qualified且PO/PO Line/Delivery Plan为0时为true；最终按钮还要求资格总结果为true。
- 最终POST正文新增`expected_mapping_qualification_digest`断言；固定Mapping发生状态、version、CAS、digest、有效期或身份漂移时失败关闭，无关Mapping变化不阻断。PO Line的`supplier_mapping_id`只取固定Binding指向的Mapping fact，浏览器不能选择该值。
- 隔离成功路径精确为`1 PO / 4 PO Line / 4 Delivery Plan / 4 queue`；所有隔离失败路径的PO/Line/Plan/queue均为0。真实Mapping新版本与转换并发无死锁、无半记录；受控冲突场景的GET/POST均返回同一逐行错误。
- 串行回归通过：无数据库组合93/93，资格/履约/Mapping Unit 22/22，Fulfillment PostgreSQL 5/5，Supplier Mapping PostgreSQL 10/10，0038 5/5，0039 6/6，Sourcing PostgreSQL 9/9，RFQ Binding PostgreSQL 18/18，履约升级3/3，`npm test` 3/3；三个适用typecheck、production build、lint 0 error/11既有warning、1,277文件凭据扫描、`git diff --check`及Python self-test/smoke/go-live均通过。
- 最终隔离Chromium 1/1通过：四行资格摘要稳定、桌面与390×844均可读；取消/关闭/ESC/背景关闭零POST，隔离成功仍为1/4/4/4、下游0、Session0。候选Web`sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664`、88,636,706 bytes，受限临时容器health通过。
- 主UAT在预部署阶段未登录、未发送业务POST，失败请求、四条Mapping、Award/RFQ及PO/计划保护事实保持起点值。

## 测试、部署与完成条件

- 串行隔离覆盖四条有效 Mapping、GET/POST完全一致、完整谱系、bigint字符串、Event join不伪重复、缺失/冲突/停用/生效期/Supplier或Material停用/Unit与换算错误、无关变化、固定事实漂移、CAS/权限/CSRF/Origin/幂等/并发、成功 `1 PO / 4 Line / 4 Plan / 4 queue`、失败全 0，以及桌面/390×844。
- 运行 0038/0039、Mapping、RFQ、Award、PO 与安全回归；不新增 Migration。
- 全部通过后执行 root-only 正式 custom dump、权限/大小/SHA-256、`pg_restore --list` 和第二新库恢复；只替换 Web，不重建 PostgreSQL、Worker、Caddy，不修改四个受保护 Volume。
- 主 UAT 只登录 purchase，打开 Award #1预览、核对四行 qualified、填写 UAT 备注、桌面/390×844核验、取消并安全退出；禁止最终确认。最终 `business POST=0` 且 PO/计划仍为 0。
- 更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 及必要设计/决策/发布文档；功能和部署验收分别独立提交，不 push、不 PR、不改写历史。

最终状态只能是：

- `AWARD TO PO SUPPLIER MAPPING VALIDATION FIXED — UAT PO NOT CREATED`
- `AWARD TO PO MAPPING DATA INTEGRITY BLOCKED — NO UAT CHANGE`
- `AWARD TO PO TRACEABILITY REQUIRES SCHEMA — UAT UNCHANGED`

完成后立即停止，不创建主 UAT PO。
