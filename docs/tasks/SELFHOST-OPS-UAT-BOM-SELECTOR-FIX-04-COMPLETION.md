# SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04 完成报告

## 最终结论

`BOM CODE-FIRST MATERIAL SELECTION FIXED — UAT BOM NOT CREATED`

BOM 物料选择已改为正式内部编码优先、服务端有界检索和稳定 ID 引用；既有 Product/BOM 发布服务与 Planning Handoff 的关系模型已经核清并在隔离 PostgreSQL 回归。运行面仅替换 alpha.34/0034 兼容 Web，没有执行 0035、创建 0036、部署完整 alpha.36 或创建任何 UAT BOM/Planning 记录。

## Git 与范围

- 起点：`main` / `28b79d2328a936b2580a194ca73678de39b2ee72`，Parent `d00ef012aba86d4bd2a31bc63d1f75300d53e053`，`origin/main...HEAD = behind 0 / ahead 101`，工作区 clean。
- 功能提交：`b66e742abe866aa7e1644c09c4fc28efb5e373e4`，`fix: make bom material selection code-first`。
- 功能提交只修改 12 个 BOM handler/service、兼容 UI/CSS/cache key 和测试文件；没有修改 `db/schema.ts`、`drizzle-postgres/` 或任何 Migration。
- 文档与验收以独立提交 `ops: accept bom selector fix` 收口；实际提交 SHA 以 `git log` 为准。
- 未 push、PR、amend、rebase、reset、stash、restore 或合并未知修改；没有读取、修改或提交 `shujvbiao/` 和任何工作簿。

## 根因

旧兼容 BOM 页面复用全量 `/api/items` 列表，却使用不存在的旧适配字段 `internal_item_code` 作为 option value 和提交回退字段；当前 DTO 实际字段是稳定 `id`、`internal_material_code`、`standard_name` 和 `base_uom`。页面既没有正式编码搜索，也要求在数百项下拉中滚动。

服务端此前允许在缺少 `material_id/unit_id` 时按编码和自由文本单位反查；虽会检查 ACTIVE 和 enabled Unit，但没有证明单位就是物料主单位，也没有阻止同一 BOM Version 重复引用同一 `material_id`。正式编码并非缺在主数据 API，而是 BOM 前端适配、搜索合同和写入边界不完整。

## Selector 合同

新增 `GET /api/bom-material-candidates?q=...&limit=...`：

- DTO 固定返回 `material_id`、`internal_code`、`name`、`unit_id`、`unit`、`status`、`version`。
- 只投影 `ACTIVE`、正式内部编码非空、主单位可解析且 enabled 的物料；结果默认/上限均为 20。
- 正式编码大小写不敏感精确搜索时只返回该物料；若精确编码存在但物料不合格，返回空，不退化命中同前缀其他物料。
- 非精确搜索支持正式编码前缀与名称包含；空查询返回空集合。
- UI 显示 `正式内部编码 · 名称 · 单位`，隐藏选择值为稳定 `material_id` 和 `unit_id`；提交不包含用于反向解析的名称或编码。
- 搜索请求有 250 ms debounce、AbortController 和查询一致性保护；有清楚的空、等待、加载、无结果、失败及已选择状态。
- 客户端阻止重复物料，服务端以 `(bom_version_id, material_id)` 事实再次拒绝；390px 规则允许换行且不产生整页横向滚动。

## 服务端事务校验

`POST /api/bom-lines` 只接受稳定 `material_id`、`unit_id` 和合法业务字段。既有幂等事务内先锁定 BOM Header/当前 DRAFT Version，再以共享锁读取 Material/Unit，并验证：

1. `material_id` 存在；
2. 物料为 `ACTIVE` 且正式内部编码非空；
3. `unit_id` 存在且 enabled；
4. 单位与 `base_unit_id` 一致；alpha.34 遗留 `base_unit_id=NULL` 时只允许 enabled Unit code 与 `base_uom` 精确一致；
5. 同一 BOM Version 尚无相同 `material_id`；
6. `quantity_per` 为正数且最多六位小数，`loss_rate` 保持 `[0,1)` 规则。

BOM 发布事务会再次锁定并验证全部行的正式编码、ACTIVE、Unit enabled 和主单位一致性；失败不会部分发布。既有发布不可变、幂等重放/正文冲突、CAS、权限、成功/失败审计和事务回滚逻辑没有放宽。

## Product、BOM 与 Planning 权威模型

三者共用 PostgreSQL 关系模型，不存在第二套需要名称桥接的权威：

```text
products.id
  -> product_versions.id
  -> bom_versions.product_version_id
  -> bom_lines.material_id / unit_id
  -> project_requirement_resolutions
  -> project_planning_package_items.product_version_id / bom_version_id
```

Product Version `A0` 与 BOM Version `V1` 是两条独立版本轴；Product 状态、Product Version 发布状态、产品生命周期和 BOM 发布状态也分别展示。BOM 属于 Product Version，不直接属于项目；具体项目只在 Planning Handoff 中通过稳定 ID 关联。

真实发布路径已经存在：engineering 复用既有 `master.product.manage` / `master.bom.manage` 权限，Product Version 先发布，BOM 保存为 DRAFT、添加并校验行、再调用既有 release API。发布后的 BOM 不可原地修改，只能创建修订。Planning 服务只接受同一 Product 下 `RELEASED` Product Version、`RELEASED` BOM Version 和 ACTIVE BOM Header；没有新增状态机或伪按钮。

## 自动验证

全部写测试只连接隔离 PostgreSQL 和合成数据，严格串行执行：

- BOM/Master Data PostgreSQL：5/5；四类编码精确/前缀/名称、DTO、ACTIVE/空编码/PENDING_REVIEW/禁用单位过滤、有界结果、稳定 ID、不存在/非 ACTIVE/错单位、重复、数量精度、readiness、真实 release、权限、幂等、CAS、审计与故障回滚通过。
- Planning PostgreSQL：3/3；测试从 DRAFT 调用真实 BOM release 后进入 Planning candidates，DRAFT/错客户候选被排除，既有权限、幂等、并发和回滚保持。
- Identity 10/10、Material 7/7、operations review 4/4、Dashboard 2/2；均在 0034 结构隔离库通过，测试库已删除。
- 兼容 unit/UI/handler 回归 120/120；TASK09 标准化工作台 14/14；Material、Product/BOM、Planning、Review、Dashboard、Identity/logout/no-store 均通过。
- `production-routing`、Planning、Review、Dashboard、Standardization typecheck 通过；兼容 Schema consistency 为 209 tables、`No schema changes, nothing to migrate`。
- lint、alpha.34 compatibility build、File Storage 3/3、Environment 6/6、代码阶段 credentials scan 1,029 files、最终暂存内容稀疏 credentials scan 1,105 repository paths、`git diff --check` 通过；最终扫描工作树未包含 `shujvbiao/` 或工作簿。
- Python 基线：`server.py --self-test`、`smoke_test.py`、隔离临时 SQLite 的 `go_live_check.py --no-backup` 均通过；临时 SQLite 已逐项删除，未操作 Python 服务。
- 历史 D1 `tests/erp-api-smoke.mjs` 仍依赖退役 `/api/import` 与旧 BOM 正文，未误报为自托管通过；本任务以当前 PostgreSQL 集成测试和 alpha.34 candidate HTTP smoke 作为对应证据。

当前 alpha.36 Material/operations 测试若强制落在 0034 会因合理依赖 0035 失败，因此未运行 0035 迁就测试；在真实 alpha.34 兼容源上把临时测试迁移期望校正为 0034 后，Material 7/7、operations 4/4、Dashboard 2/2 全部通过。没有降低业务断言。

## 备份与隔离恢复

- 备份：`/var/backups/chenyida-erp/SELFHOST-OPS-UAT-BOM-SELECTOR-FIX-04/postgresql-20260730T194009Z.dump`
- 大小/权限：2,023,590 bytes，0600，`root:root`。
- SHA-256：`8facc469c6bbdf3d2dedce57ce2d8a740d58cd2d2f8cd6e85c714421d05c35b9`。
- `pg_restore --list`：3,065 行、3,050 个非注释条目。
- 独立恢复结果：34/head 0034，Material 536、User 14、Audit 1153；四条保护物料、项目、产品、UAT BOM=0、Planning=0 与主库一致。
- 候选镜像在该恢复库执行 engineering API smoke：四码各唯一命中、DTO/PCS/V3/ACTIVE/稳定 ID 正确，BOM/Planning 写入 0，退出成功。恢复库随后删除。

## alpha.34/0034 兼容部署

兼容构建从 alpha.34 基线 `cda8c7e` 叠加当前 Origin、CSRF/logout、operations review、审核详情、Dashboard/no-store hotfix 与本任务差异；明确没有 0035、TASK09 标准化模块或 Schema diff。

- 部署前 Web：`sha256:881c033dc97e7bc121ab6b2f7faf6a010881ee74377da5e352ee603b4e00ea50`。
- 部署后 Web：`sha256:cb6a5c1fae89608e07e72d458b4466e0b571e36374b16f3b592248280f8dc6e1`，package 仍为 `0.1.0-alpha.34`。
- 旧 Web 以 `chenyida-erp-parallel-web:rollback-bom-selector-fix-04-predeploy` 保留。
- 只执行 Web `--no-build --no-deps --force-recreate`；PostgreSQL `f3a2f3cb32f4...`、Worker `fb68d9a81b87...`、Caddy `c209765be0b4...` 容器 ID 未变。Web 从 `e18610e483a9...` 变为 `426eff713f9c...`。
- 四服务 restart 0、OOM false；PostgreSQL/Web healthy，Worker/Caddy running。PostgreSQL 仍 34/head 0034，0035 count 0。
- 可信 Origin 保持 `https://43.135.148.43.nip.io:18888`；内网与公网 `/api/health` 均 200。

## 浏览器只读验收

固定 Playwright/Chromium 在当前公网 Origin 使用既有 engineering 账号；没有改密，只允许 login/logout 两个 POST，并在路由层阻断其他非读 API。

| 正式内部编码 | 匹配数 | 稳定 material_id | 显示单位 | 结果 |
| --- | ---: | ---: | --- | --- |
| `CYD-RB_PCB-000016` | 1 | 533 | PCS | PASS |
| `CYD-RB_SENSOR-000003` | 1 | 534 | PCS | PASS |
| `CYD-RB_CONN-000075` | 1 | 535 | PCS | PASS |
| `CYD-RB_METAL-000015` | 1 | 536 | PCS | PASS |

每次结果均显示 `编码 · 实际名称 · PCS`；选择后隐藏值精确等于 material_id/unit_id，随即清除，未点击保存。页面显示 Product Version A0、Product Version DRAFT、产品生命周期样品、产品 ACTIVE、BOM Version V1、BOM DRAFT，并显示项目关系和发布说明。桌面与 390×844 均无整页/候选横向溢出。

正常验收只产生 `POST /api/login` 和 `POST /api/logout`。首次自动化因把原生 `<option>` 错当“可见”而在选择产品前超时，留下一个任务会话；随后精确调用既有 Identity `logout()` 事务撤销并写标准审计。最终本轮为 LOGIN 2、LOGOUT 2，engineering ACTIVE Session 0。退出后直接重访、后退、前进、刷新都保持未登录，文档响应含 `no-store`。

## UAT 数据前后证明

| 对象 | 部署前 | 最终 | 结论 |
| --- | --- | --- | --- |
| `PRJ-00000001` | ACCEPTED / 10.000000 | ACCEPTED / 10.000000 | 未变 |
| `UAT-BB-PROD-042576` | ACTIVE；A0/DRAFT/样品；row version 1 | 相同 | 未变 |
| 四条正式物料 | IDs 533—536；V3/ACTIVE/PCS | 相同 | 未变 |
| 四物料比较指纹 | `56f19dee12d72109f7d631cec6e58022` | `56f19dee12d72109f7d631cec6e58022` | 一致 |
| `BOM-UAT-BB-PROD-042576-V1` | 0 | 0 | 未创建 |
| 该产品全部 BOM | 0 | 0 | 未创建 |
| `PRJ-00000001` Planning Package | 0 | 0 | 未创建 |

比较指纹固定串联 `id|internal_material_code|standard_name|version|material_status|base_uom` 并按正式编码排序；只用于本任务前后相等证明。

## 资源与清理

- 首次资源门禁约 2.3 GiB available、Swap 198 MiB、根盘余 29 GiB，Load 低于 3；部署前为 2.3 GiB/180 MiB/29 GiB/`0.09/0.44/0.48`。
- 浏览器验收后为 2.3 GiB/204 MiB；最终临时镜像清理后根盘恢复 29 GiB，未达到任一停止阈值。内核/容器 OOM 0，四服务 restart 0。
- 两个隔离 PostgreSQL 测试库、恢复库、候选 API 容器、浏览器/会话清理容器、456 个浏览器临时文件、12 MiB 依赖、899 MiB Playwright 镜像、候选临时 tag、两个 task worktree 和可明确归属本任务的 BuildKit cache 已清理。
- 保留正式部署镜像、旧 Web 回退 tag 和 root-only PostgreSQL 备份；没有 prune Volume，也未触碰四个受保护持久卷。

## 安全记录与后续使用

一次本地命令因分隔符写错，把 root-only 账号材料内容显示在本次授权工具输出中。内容没有写入仓库、任务文件、服务日志或外部系统；凭据文件、engineering 账号与密码均未修改，所有本轮 Session 已撤销。遵守本任务“不得再次改密”边界，本轮不轮换凭据；建议在任何可写 engineering 试用前另立授权任务完成该 UAT 凭据轮换。

功能上可以重新开始 engineering 的只读 BOM 选择器试用；当前受保护产品 A0 仍是 DRAFT，因此服务端会继续禁止保存它的 BOM。创建或发布该 UAT BOM、发布 Product Version、建立 Planning Handoff 或继续可写试用都必须另行授权。
