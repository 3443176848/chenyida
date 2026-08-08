# SELFHOST-UAT-FIX-33 完成报告 — Award to PO Supplier Mapping Validation Diagnosis and Fix

## 最终状态

`AWARD TO PO SUPPLIER MAPPING VALIDATION FIXED — UAT PO NOT CREATED`

完成时间：2026-08-08（Asia/Shanghai）。采用诊断分支A，完成源码修复、串行隔离回归、正式备份与第二新库恢复、Web-only部署，以及唯一一次purchase-only主UAT预览后取消验收。没有重试主UAT转换，没有修改四条Mapping或任何Award上游事实，没有创建主UAT PO。

## 1. 起点门禁与诊断分支

- 起点为唯一worktree、clean `main@79ac7fae76fdb69286a16f0bbd9551d41598cd57`，Parent `a4ffb8ee022234ea25add4ce636050366ac6887a`，behind0/ahead169。
- 版本为`0.1.0-alpha.40`，Migration为0001—0039/head `0039_rfq_traceability.sql`，无0040；起点Web为`sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`。
- 工作区、嵌套仓库、并发任务、资源、容器和受保护卷门禁均匹配。available约2.1GiB、Swap233MiB、根盘可用18GiB，未触发低资源停止阈值。
- 只读事实证明四条固定Mapping全部权威有效，因此选择分支A。没有数据完整性阻断，也不存在必须新增Schema才能追溯的缺口。

## 2. 主UAT失败请求与保护基线

- RFQ 1为`CLOSED/v7`；Award ID1为`AWARDED/v1`，Award Line恰好4条。
- Candidate为`2/4/6/8`；对应RFQ Binding为`1/2/3/4`。
- 起点PO/PO Line/Delivery Plan/queue为`0/0/0/0`，成功转换为0。
- 失败请求`f30a7801-1cd0-4849-95a8-9c61d5c52e67`恰好一次，HTTP 422，错误代码`AWARD_SUPPLIER_MAPPING_NOT_UNIQUE`，中文“定标物料必须存在唯一有效的一比一Supplier Mapping”；没有半记录。
- 起点页面粗粒度投影为`po_convertible_now=true`。本任务始终禁止再次发送主UAT转换POST、修改Mapping/Award/Candidate/Binding/Quote/RFQ、直接SQL修数据或登录其他角色。

## 3. 四条Mapping权威事实

四条均属于Supplier ID1 / `SUP-000001`；Supplier、Material、Mapping及Binding均为ACTIVE，Material为STOCKED。Supplier Unit、Internal Unit和RFQ Unit均精确解析为启用的Unit ID1 / PCS，换算为正数`1/1`，有效期自2026-08-05（Asia/Shanghai）起且无结束日；同Supplier/Material ACTIVE 1:1冲突和Supplier内supplier part冲突均为0。

| Material | Mapping UUID | Fact / Version / Row CAS | Supplier Part | Content digest |
| ---: | --- | --- | --- | --- |
| 533 | `224d1965-44ef-4c3e-901e-1926b6b07ff8` | 1 / v1 / 3 | `UAT-A-PCBA-042576` | `2c0a8a3116a8e1cc7d75baffb97fecd565a89a4ae3f7dd107d7f588bc2d7814a` |
| 534 | `43ca04d8-9933-4dac-ba21-b7fb85741830` | 2 / v1 / 3 | `UAT-A-SENSOR-042576` | `9ad00894b264581d611483f253c0296bd89b65efa80bda37dbdf832eb92f1163` |
| 535 | `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` | 3 / v1 / 3 | `UAT-A-HARNESS-042576` | `f717f0bf971e4d8823fe9f979fe57aa76ad5f14f244dbf5cc4799f96edd613b8` |
| 536 | `9659ad2d-406a-4c4c-b575-51329badc63f` | 4 / v1 / 3 | `UAT-A-CASE-042576` | `4e1e47e766cdcff3cd46ef880cfca66942e47904c0cf61620231686ccb2411ba` |

## 4. 四条完整谱系

| Award Line | Candidate | Quote Line | RFQ Binding | Supplier / Material | Mapping Fact / UUID |
| ---: | ---: | ---: | ---: | --- | --- |
| 1 | 2 | 1 | 1 | 1 / 533 | 1 / `224d1965-44ef-4c3e-901e-1926b6b07ff8` |
| 2 | 4 | 2 | 2 | 1 / 534 | 2 / `43ca04d8-9933-4dac-ba21-b7fb85741830` |
| 3 | 6 | 3 | 3 | 1 / 535 | 3 / `aa16f7e7-904d-4ae2-9f73-d34e7aaf257e` |
| 4 | 8 | 4 | 4 | 1 / 536 | 4 / `9659ad2d-406a-4c4c-b575-51329badc63f` |

身份只沿上述稳定关系外键解释。实现和验收均未按Supplier名称、supplier part、价格或数组位置反向寻找Mapping，Mapping Event也不参与fact基数。

## 5. 根因与GET/POST统一资格合同

根因由两个实现分叉共同造成：

1. 旧GET预览只投影Award历史中的粗粒度`po_convertible_now`，没有执行逐行Mapping资格，也没有返回资格凭证。
2. 旧POST另行从当前`supplier_mappings`按Supplier/Material/Unit动态重查，忽略已经固定的RFQ Binding，并错误要求`material.base_unit_id=unit.id`。四个legacy Material的`base_unit_id`均为NULL，但`base_uom=PCS`按D-091可以唯一解析到启用PCS Unit，因此四条合法Mapping被全部过滤为0。

这不是错误的legacy表、bigint字符串/数字比较、Mapping状态/版本、邀请/报价状态、Event join伪重复、有效期或1:1精度数据问题。Schema已能从Award无歧义追溯到固定Binding和Mapping fact。

修复新增共享`AWARD_PO_MAPPING_QUALIFICATION_V1`资格服务和逐行DTO。GET预览与最终POST现在复用同一loader、同一DTO、单一transaction as-of和`[valid_from, valid_to)`边界；数据库ID在资格边界保持规范十进制字符串，排序使用`BigInt`。每行返回Award Line、Candidate、Quote Line、Binding、Supplier、Material、Mapping UUID/fact/version/row CAS、Mapping/Supplier/Material状态、Supplier/Internal Unit、换算率、有效期、content digest、两类冲突数、`qualified`、稳定错误代码和中文原因。

`po_convertible_now=true`现在只在完整四行全部qualified且PO/PO Line/Delivery Plan为0时返回。确认窗口合同升级为`AWARD_PO_CONFIRMATION_V2`，桌面与390×844均显示四行完整资格凭证。

失败关闭代码可精确定位到Award Line、Supplier和Material，包括`AWARD_MAPPING_BINDING_MISSING`、`AWARD_MAPPING_FACT_MISSING`、`AWARD_MAPPING_NOT_ACTIVE`、`AWARD_MAPPING_VERSION_DRIFT`、`AWARD_MAPPING_NOT_YET_EFFECTIVE`、`AWARD_MAPPING_EXPIRED`、`AWARD_MAPPING_SUPPLIER_NOT_ACTIVE`、`AWARD_MAPPING_MATERIAL_NOT_ACTIVE`、`AWARD_MAPPING_INTERNAL_UNIT_UNRESOLVED`、`AWARD_MAPPING_UNIT_MISMATCH`、`AWARD_MAPPING_CONVERSION_NOT_ONE_TO_ONE`及两类冲突代码；不再只返回无法定位的泛化信息。

## 6. 最终事务与漂移保护

- 最终POST在同一写事务、同一as-of下重算与GET相同的资格摘要，并核验浏览器只作为断言提交的expected Award/RFQ CAS、完整Line集合、PO零计数、摘要和幂等正文。
- 事务锁定Award、来源RFQ/PRQ、Award Line、Candidate、Quote/Quote Line、RFQ Binding、固定Mapping fact以及相关Supplier、Material和Unit；资格读与Mapping写共用`part→material` advisory lock顺序，并在锁等待后重读Mapping identity/version/CAS。
- 固定Binding/Mapping的身份、状态、version、row CAS、digest或有效期发生真实漂移时返回资格错误或`AWARD_MAPPING_QUALIFICATION_DRIFT`并失败关闭；无关Mapping变化不阻断。
- 浏览器不能决定Supplier、Material、价格、Unit或Mapping ID；PO Line的`supplier_mapping_id`只取固定Binding引用的Mapping fact。
- 既有原子边界保持：同事务创建PO、四条PO Line、四条Award Link/Delivery Plan/queue以及Event/Audit/幂等结果；任一失败全部业务计数为0。

## 7. 测试与隔离计数

- 无数据库组合93/93；资格、履约及Mapping Unit 22/22。
- Fulfillment PostgreSQL 5/5；Supplier Mapping PostgreSQL 10/10；0038回归5/5；0039回归6/6；Sourcing PostgreSQL 9/9；RFQ Binding PostgreSQL 18/18；履约升级3/3。
- `npm test` 3/3；三个适用typecheck、production build、lint 0 error/11既有warning、最终1,278仓库文件凭据扫描、`git diff --check`和Python `server.py --self-test`、`smoke_test.py`、临时库`go_live_check.py`均通过。
- 覆盖四条ACTIVE 1:1、GET/POST相同结果、完整谱系、资格bigint字符串边界、Event join不增基数、缺失、双ACTIVE冲突、停用、未生效、过期、Supplier/Material停用、Unit/非1:1、无关变化、固定fact漂移、过期CAS、权限、CSRF、Origin、幂等、并发和故障回滚。
- 隔离成功计数精确为PO/PO Line/Delivery Plan/queue `1/4/4/4`；所有隔离失败路径均为`0/0/0/0`，没有半记录。
- 最终隔离Chromium 1/1：四行qualified，桌面与390×844可读，取消/关闭/ESC/背景关闭零POST；成功样本仍为`1/4/4/4`，下游0，Session0。

## 8. 正式备份与第二新库恢复

- 正式dump：`/var/backups/chenyida-erp/award-po-mapping-validation-fix33-predeploy-20260808T050516Z.dump`。
- 权限/大小：root:root、0600、单硬链接、2,294,665 bytes。
- SHA-256：`d3cf053f09948c6e4ae54caff028a7663a3750249bcaf3e8758e2f0ace49c5c2`；`pg_restore --list`为3,359项。
- 第二新库`award_po_mapping_fix33_restore_20260808t050516z`以`--single-transaction --exit-on-error --no-owner --no-acl`恢复通过。核对为39/head0039、226表、四条Mapping/Binding完整谱系、RFQ CLOSED/v7、Award1/v1/AWARDED、Line4、失败请求一次、成功转换0以及PO/Line/Plan/queue全0。
- 验证后第二库在连接0时精确删除；容器内临时dump删除，正式宿主dump保留。
- 备份窗口按Web→Worker停止。`docker compose start worker`因已不存在的一次性migrate依赖在真正启动前安全退出，没有创建、替换或修改容器；随后以`docker start`按Worker→Web恢复原容器和原镜像并通过健康检查。

## 9. Web-only部署

- 候选和最终Web：`sha256:83c1bff341294d1bee2db8fd2ee963204012cfac63f1289ba7d3755ca2920664`，88,636,706 bytes。
- 起点Web：`sha256:2396c8bc4fd5658c26cef11c4a438b2edb474607b73b2b8ee7fe337b125575ed`，88,626,192 bytes；保留为`chenyida-erp-parallel-web:rollback-award-po-mapping-validation-fix33-predeploy-20260808T050516Z`。
- 仅使用`--no-deps --no-build --pull never --force-recreate web`替换Web。没有运行Migration，没有重建PostgreSQL、Worker或Caddy，没有修改四个受保护Volume。
- 新Web容器ID为`fb6ba7d027bf7e5cfaa3c4e514dd4da780ba32010c3fd4972d263e436a5f0ef9`；Worker镜像保持`sha256:32d1ae335610c097d9fa38dd411acabc525c0fe17cfcb863271e32317afe96aa`。
- HTTPS health为200/ok，根页200，匿名资格预览401；39/head0039且无0040。Web/PostgreSQL healthy，Worker/Caddy running，四服务restart0/OOM false。

## 10. 主UAT只读取消验收

只使用purchase账号执行一次受保护流程。runner在路由层阻断除login/logout外全部业务写，并在前后只读事务中比较保护事实。

1. 桌面1440×900打开Award #1转换预览，核对四条固定Mapping均`qualified=true`和`po_convertible_now=true`。
2. 填写仅存在浏览器本地表单中的UAT备注。
3. 在390×844复核四行资格凭证可读。
4. 点击取消，没有点击最终转换；随后安全logout并验证Session失效。

验收输出为：

```text
AWARD_TO_PO_MAPPING_VALIDATION_UAT_READONLY_OK database=chenyida_erp actor=uat_20260729_purchase rfq=1 rfq_version=7 comparison_version=1 award=1 award_version=1 award_line=4 candidate=4 binding=4 mapping=4 qualified=4 failed_request_preserved=1 successful_conversion=0 po_before=0 po_after=0 po_line_before=0 po_line_after=0 delivery_plan_before=0 delivery_plan_after=0 queue_before=0 queue_after=0 preview_get=1 business_post=0 desktop=1 mobile=1 cancelled=1 session=0
```

独立最终只读核验仍为RFQ CLOSED/v7、Award1/v1/AWARDED、Award Line4、四条Mapping/Binding不变、失败请求一次、成功转换0、PO/PO Line/Delivery Plan/queue `0/0/0/0`、purchase有效Session0。

## 11. 资源、OOM/restart与清理

- 起点：available约2.1GiB、Swap233MiB/1GiB、根盘可用18GiB、低Load。
- 收口快照：available约2.1GiB、Swap250MiB/1GiB、根盘可用18GiB、Load`0.55/0.39/0.39`。
- 任务时段内核OOM为0；最终四服务restart0、OOM false。没有修改Swap、dockerd、内核、防火墙或systemd。
- 七个隔离测试库、第二恢复库、Python临时目录、Playwright runtime、UAT内部网络和全部任务临时容器均精确清理。正式dump、当前Web、候选标签、FIX33回退镜像和四个受保护卷保留；未执行任何prune。

## 12. Git与再次正式转换条件

- 功能提交：`1f205af0bf81379345a09353d9d32ab5c7545971`，`fix: unify Award to PO mapping qualification`。
- 部署、主UAT验收和最终文档由独立`ops: deploy Award to PO mapping validation fix`提交收口；该提交SHA以`git log`为准。
- 起点behind0/ahead169；两个聚焦提交后应为behind0/ahead171。没有push、PR、amend、rebase、reset、stash或restore。
- 统一资格、原子事务、回归、备份恢复和非生产Web部署表明技术门禁已经具备再次执行正式转换的条件；但本任务没有正式转换授权。必须另立任务并取得新的明确授权，同时重新核验当时Award/RFQ CAS、四条固定Binding/Mapping资格与摘要、PO0、权限、CSRF/Origin、幂等、审计和可恢复备份。

完成后立即停止；本任务没有创建主UAT PO。
