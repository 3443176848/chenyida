# 晨亿达ERP状态快照

最后更新时间：2026-07-17（Asia/Shanghai）

## 自动统计摘要

| 指标 | 当前值 | 统计口径 |
| --- | ---: | --- |
| 总代码量 | 约 43,000 行 | Site 的 `app/db/drizzle/tests/scripts` 运行时、迁移、脚本和测试源码；不含依赖、构建产物和文档 |
| 源码文件 | 124 | Site 的 `app/db/drizzle/tests/scripts` 口径；TASK08 新增 Import Workspace 组件、Worker/轮询模块和专项测试 |
| 根仓库跟踪项 | 提交前动态值 | PHASE3-TASK01 仅新增 Normalization 规格/OpenAPI/流程图并同步治理文档；未修改运行时代码、Schema、Migration、API、前端、依赖或生产配置 |
| 主要目录 | 4 类 | `chenyida_erp_app/`、`chenyida_erp_site/`、`物料主数据治理落地包/`、`docs/` |
| 数据库实现 | 2 | 本地 SQLite、在线 Cloudflare D1 |
| 数据表 | 60（本地+开发 schema） | 本地 SQLite 26 张，Site 开发 schema 34 张；`0005` 仅在隔离 D1 测试，未执行生产迁移 |
| 在线 API 路径 | 81 | 新增批次作用域 Mapping Target Catalog；生产公开站点尚未部署开发基线 |
| 页面入口 | 14 | 既有 11 个入口加 3 条 Material Import 路由 |
| 测试文件 | 24 | PHASE3-TASK01 未改测试；任务开始基线为全量 Node 440/440 |

## 当前版本与环境

| 项目 | 当前值 |
| --- | --- |
| 根仓库 Branch | `main` |
| PM-000 前根提交 | `bbefb2e388323213b51531fec117d67d5a28fe70` |
| Site 开发基线 | `9f2c2dca9ccde237cb2db6c01d2e3792b284e6e9`；已作为普通目录纳入根仓库 |
| 生产 Site | active / public / v3 |
| 生产源码提交 | `2b4f1787ddbc7e0941ab2d5f5cadea6e817e8f12` |
| PowerShell | 5.1.26100.8655 |
| Git | 2.52.0.windows.1 |
| Node.js | 26.3.0 |
| npm | 11.16.0 |
| 项目绑定 Python | 3.12.13 |
| 系统 `python` 命令 | 2.7.18，不适用于当前 ERP；启动脚本使用项目绑定 Python 3.12.13 |
| 环境配置 | `development` / `test` / `production`；生产地址运行时注入，不在代码硬编码 |
| 默认测试数据库 | 本机一次性 Miniflare D1；远程绑定关闭，结束后销毁 |

## Git 状态

`PHASE3-TASK01` 开始时，根仓库 `main` 位于 `7cc89b8`，工作区干净，`chenyida_erp_site/` 不是嵌套仓库。当前差异只允许覆盖三份 Normalization 设计交付物和项目治理文档；不得修改 production binding、hosting、依赖、运行时 API/服务、Schema、Migration、Metadata、前端或本地旧版业务逻辑。

转换前，`git ls-files --stage -- chenyida_erp_site` 只显示一个 mode `160000` gitlink。转换后，根仓库直接跟踪 Site 的 77 个 mode `100644` 文件，仓库中不再存在 mode `160000`。暂存 Site 子树 hash `541decf5a685a0efc238868ef958d3ae500174e5` 与原 `9f2c2dc` tree 完全一致。

`PHASE3-TASK01` 计划提交消息为 `docs: design material import normalization`，实际哈希以 `git log -1` 为准。未创建生产版本、未推送、未连接或部署生产 D1/R2/Queue。

实时状态必须使用：

```powershell
git status --short
git -C chenyida_erp_site status --short
```

## PHASE3-TASK01 Material Import Normalization & Staging V1 书面设计

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / WAITING FOR SPEC CONFIRMATION | 正式规格、OpenAPI 草案、数据流/状态图完成；16 项决定全部 `PROPOSED` |
| 状态与运行 | DESIGNED | 批次排队/运行/发布；独立 run、租约、Outbox、CAS、失败恢复与 SUPERSEDED 历史 |
| 数据契约 | DESIGNED | 每行版本化 JSON payload + 常用关系列 + 独立 issue；完整 lineage，不覆盖原始行 |
| 类型/空值 | DESIGNED | MISSING/EMPTY/BLANK_TEXT/NULL_VALUE/PRESENT、受控默认、基础字段/动态属性、公式禁用 |
| Validation | DESIGNED | 只运行 Normalization 规则；完整 Material Validation 延迟到真实 category_id，Draft 写服务不调用 |
| API/权限 | DESIGNED | 5 个路由、opaque cursor、`material.import.normalize`、owner/read_any、404/403、CSRF/幂等/限流 |
| `0006` | DESIGN ONLY | 三个新表、batch current pointer、events/outbox/batches 重建、索引/Down/重升；未创建 Migration 或改 Drizzle |
| 测试计划 | COMPLETE | 54 项最低未来测试及完整 docs-only 基线 |
| 验证 | PASS | OpenAPI 3.1 为 5 个操作/98 个本地引用；16 项决定逐项 11 字段、54 项测试/docs-only 检查通过；lint 0 error/1 个既有 warning；build 与 Node 440/440；隔离 API smoke；Drizzle 34 表无漂移；296 文件凭证扫描；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 均通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、部署或创建 binding/Cron |

## PHASE2-TASK08 Material Import Workspace UI V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项正式决定已批准并实施；Catalog 与性能/可访问性门禁均通过 |
| 页面路由 | PASS | `/materials/imports`、`/materials/imports/new`、`/materials/imports/:batchId`；权限入口与单状态工作区 |
| 文件/SHA/XHR | PASS | 10 MiB 单文件预检；`@noble/hashes@2.2.0` MIT、1 MiB 分块 Worker；单 file part XHR、浏览器 boundary、真实进度 |
| 状态/恢复 | PASS | 服务端状态权威、URL allowlist、独立 Key/不可变载荷、RESULT_UNKNOWN、重复新批次、2/5/10 轮询、Retry-After、取消竞争 |
| Rows/Mapping | PASS | 完整 256 列、20/50 服务端分页、Sheet/Header、动态 Catalog、保存/preview/confirm 新鲜度、confirmed 只读 |
| UI 专项 | PASS | UI-001—UI-100 全部通过；含 10 MiB SHA 分块边界、权限、URL、错误、键盘与焦点 |
| Playwright 门禁 | PASS | Chromium 1366×768：50×256 + 256 Mapping，初渲染 1751 ms、翻页 1083 ms、横滚 197 ms、30,285 DOM、123,423,127 bytes JS heap；末列 IV、sticky、语义、键盘、700 窄屏和 0 console error/warning通过 |
| Site 全量 | PASS | build 成功，Node 440/440；首次并行高负载触发历史迁移 120 秒超时，串行全量通过 |
| lint | PASS | 0 error；1 个任务外既有 `build_material_workbook.mjs` unused warning |
| API/OpenAPI | PASS | 隔离 API smoke；仓库 5 份 OpenAPI 3.1、434 个本地引用、Batch 6 个操作通过 |
| Drizzle | PASS | 34 tables，`No schema changes, nothing to migrate`；未创建 0006 |
| 凭证/本地基线 | PASS | 289 文件凭证扫描；临时 SQLite self-test、smoke、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |
| 已知限制 | RECORDED | page_size=100 未开放；File、unknown 操作与 preview 只在页面内存；远程生产容量/冷启动未验收 |

## PHASE2-TASK07 Mapping Target Catalog V1 非生产实现

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 12 项正式决定已批准并实施；Catalog 门禁已 `RESOLVED` |
| API | PASS | `GET /api/material-master/import-batches/:batchId/mapping-targets`；仅支持 namespace/q/limit/cursor，DTO/OpenAPI 一致 |
| Registry/Snapshot | PASS | BASIC/SPECIAL 单一 Registry + 运行时 D1 ACTIVE ATTRIBUTE；Catalog、准备、保存、preview、confirm 共享 `material-import-mapping-metadata-v1` |
| digest/cursor | PASS | 业务语义进入 Mapping SHA-256；展示文案不进入 Mapping digest但进入 cursor 搜索摘要；稳定排序、条件绑定和旧 cursor 409 通过 |
| 权限/安全 | PASS | AUTH/read/map/owner/read_any、隐藏 404、可见无 map 403、读取限流、request_id、no-store 和安全审计通过；无 attribute_id/数据库内部信息 |
| Catalog 专项 | PASS | 51/51，覆盖正式 43 项最低契约和共享规则/历史失效/空结果/Repository 失败/日志去敏回归 |
| Site 全量 | PASS | build 成功，Node 339/339；原 288 基线全部保留 |
| lint/凭证 | PASS | lint 0 error/1 个既有 warning；凭证扫描通过 |
| API/OpenAPI | PASS | 一次性隔离 D1 API smoke 通过；OpenAPI 3.1 YAML、路由、参数、DTO、错误和 no-store 契约检查通过 |
| Drizzle | PASS | `db/schema.ts`、`drizzle/`、snapshot/journal 无差异；未创建 0006 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |
| UI 状态 | IMPLEMENTED BY PHASE2-TASK08 | Catalog 门禁已被真实 Workspace 使用；50×256 性能与可访问性门禁通过 |

## PHASE2-TASK06 Mapping Target Catalog V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / CONFIRMED BY TASK07 | 规格、OpenAPI 和 12 项决定已形成；全部决定由 PHASE2-TASK07 批准 |
| 推荐路由 | APPROVED / IMPLEMENTED | 批次作用域 `GET .../:batchId/mapping-targets`；全局路由与混入 Mapping 仅保留比较 |
| 权限/可见性 | DESIGNED | read + map + owner/read_any；隐藏批次 404，`read_any` 不隐含 map |
| Catalog 来源 | DESIGNED | BASIC/SPECIAL 来自共享 Registry；ATTRIBUTE 来自运行时 D1 ACTIVE metadata；禁止 seed/fixture/历史 Mapping |
| target DTO | DESIGNED | 保留现有小写 namespace 与大写 code，返回分组、类型、必填、mapping modes、default/unit/value constraints、enabled/selectable；不返回内部 ID/列名 |
| digest 审计 | RESOLVED BY TASK07 | 已抽共享 Registry + Snapshot，Catalog、准备、保存、preview、confirm 使用同一算法 |
| 搜索/cursor | DESIGNED | 三组统一有界分页；q 最大 64、limit 默认 50/最大 100、稳定排序、cursor 绑定业务与展示搜索快照，旧 cursor 409 |
| 缓存/历史目标 | DESIGNED | `private, no-store`；历史 Mapping code 保留，Catalog miss 由 UI 标失效，不新增 resolver、不自动替换 |
| 测试计划 | COMPLETE | 43 项未来实施测试，含权限、D1 metadata、digest、cursor、限流、审计、OpenAPI、隔离 D1 和 288 项回归 |
| 文档阶段验证 | PASS | 5 份 OpenAPI YAML/本地引用、规格 43 项编号/12 项决定、lint 0 error/1 个既有 warning、build 与 Node 288/288、隔离 API smoke、Drizzle 34 表无漂移、272 文件凭证扫描通过；首次 `npm test` 因 183 秒工具时限被终止并产生 reporter EPIPE，干净重跑 288/288 |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未迁移、修改 Metadata、部署或修改 hosting |

## PHASE2-MAINT-01 Protected Down 注释语句测试修复基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 只恢复测试基线，不实施新功能 |
| 根因 | FIXED | 既有 helper 以 breakpoint 分割后仅 `trim().filter(Boolean)`；尾部 `-- End of protected 0005 rollback.` 非空，因而被作为无可执行 SQL 的 D1 statement 提交 |
| 修复层级 | PASS | 新增共享 breakpoint-aware 过滤辅助器；识别空白、行注释、块注释、单/双引号及成对引号转义，原样返回可执行片段；未闭合字符串/块注释 fail-closed 保留给 D1 报错，不支持嵌套块注释 |
| Migration 语义 | UNCHANGED | `0003`、`0004`、`0005` Up/Down、Schema、snapshot、journal 均未修改；0005 尾部保护说明保留 |
| Migration 专项 | PASS | 共享辅助器 10/10，0003/0004/0005 Down 与其他专项合计 20/20 |
| Site 全量基线 | PASS | build 与 Node 288/288、隔离 API smoke、4 份 OpenAPI、Drizzle 34 表无漂移、凭证扫描通过；lint 0 error/1 个既有 warning |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1，未迁移、部署或修改生产配置 |

## PHASE2-TASK05 Material Import Workspace UI V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / SPECIFICATION CONFIRMED | 完整规格与 16 项决定已由项目负责人确认；Catalog 门禁已由 PHASE2-TASK07 解除，运行时 UI 实施仍受 50×256 性能与可访问性门禁限制 |
| 正式交付 | COMPLETE | `material-import-ui-v1.md`、wireframes、state matrix 三份独立文档 |
| 路由/恢复 | DESIGNED | 三条路由、单状态工作区 Stepper、view 非权威、allowlist/replaceState、单向 opaque cursor 单批结果导航 |
| 创建/上传 | DESIGNED | 客户端有限预检、Worker 增量 SHA、确认后创建、共享 Client 内 XHR、真实字节进度、独立幂等/RESULT_UNKNOWN、重复文件新批次恢复 |
| 解析/取消 | DESIGNED | parse 前重读与独立 Key、2/5/10 秒轮询、网络/429 退避、粗粒度真实状态、五状态协作式取消与 CAS 竞争 |
| Sheet/Rows/Header | DESIGNED | Sheet 可见性、真实 Rows 分页、稀疏 cell/DATE/FORMULA/ERROR、原始行与 Mapping 样本分离、Sheet/Header 随 Mapping 保存 |
| Mapping | IMPLEMENTED BY PHASE2-TASK08 | 三列编辑、显式保存、已保存版本 preview、当前页面最新 preview 门禁、服务端 confirm 最终裁决、confirmed 只读已实现 |
| Catalog 门禁 | RESOLVED BY PHASE2-TASK07 | 已实现批次作用域动态 Catalog 与共享 Registry/Snapshot/digest；仍禁止 seed、前端硬编码或历史 Mapping 绕过 |
| 表格门禁 | PASSED BY PHASE2-TASK08 | 50×256 的渲染、翻页、横滚、sticky、键盘、DOM、内存、语义、1366/窄屏均有 Playwright 记录 |
| 线框/矩阵/测试设计 | COMPLETE | 覆盖 22 个指定状态、集中主状态/URL/preparation/unknown/dirty/权限/门禁矩阵，100 个唯一未来实施测试编号 |
| 文档检查 | PASS | 100 项编号、16 项决定、22 状态结构、无 TBD/TODO 占位、`git diff --check` 与 docs-only 范围在提交前复核 |
| Site 静态/安全 | PASS | lint 0 error/1 个既有 warning；环境守卫 6/6；4 份 OpenAPI YAML 解析；268 文件凭证扫描；隔离 API smoke 通过 |
| Site 全量基线 | RESTORED BY PHASE2-MAINT-01 | 原 docs-only 任务发现的 0005 comment-only statement 失败已在共享测试辅助层修复；build 与 Node 288/288 通过，Migration 业务语义未变 |
| 本地基线 | PASS | Python 3.12 临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理 |
| 生产影响 | NONE | 未连接 production/公共 URL/远程 D1/R2/Queue，未创建 binding/Cron、迁移、修改 hosting 或部署 |

## PHASE2-TASK04 Excel/CSV Parser 与字段 Mapping V1 实施基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 16 项决定和非生产范围已批准；实现、测试和文档完成后停止 |
| Parser | PASS | 有界 XLSX/CSV 流式解析；UTF-8/BOM/GB18030、三种分隔符、类型化 cell、公式不执行、1900/1904、隐藏 Sheet、XML/ZIP 安全与组合资源上限 |
| 调度与恢复 | PASS / INJECTABLE | D1 Outbox、可注入 scheduler、Queue adapter、至少一次去重、租约领取/接管/心跳、Sheet 恢复、原子发布和 Mapping 准备独立重试；未创建生产 Queue/binding |
| Shared Strings/行 | PASS | run 级 D1 分块、有界 LRU、稳定 raw row hash、100 行逻辑批次与幂等冲突检测；发布前行不成为 current |
| Mapping/API | PASS | 关系化 Mapping、静态/动态 target allowlist、metadata 摘要、完整替换、100 行预览、确认 CAS、七个精确路由、权限/owner/read_any/CSRF/幂等/审计；不创建 Material Draft |
| `0005` | PASS / NOT APPLIED TO PRODUCTION | Up、Drizzle snapshot/journal、受保护 Down、legacy 行保留回填、批次/current-run 等价引用触发器、失败回滚和重升 4/4 |
| 兼容门禁 | PASS LOCALLY | 固定 `@zip.js/zip.js@2.8.26`、`sax-wasm@3.1.4`、`csv-parse@7.0.1`；Miniflare/WASM/Web Streams/R2 Range 替身/Bundle/64 MiB heap 门禁 3/3 |
| 依赖审计 | KNOWN BASELINE | `npm audit --omit=dev` 报告 Next 内置 PostCSS 的 2 个 moderate；建议的 force fix 会产生破坏性版本变化，未在本任务自动修改。三项新增 Parser 依赖的固定版本与许可证门禁通过 |
| 专项测试 | PASS | Parser 36、集成 11、migration 4、兼容 3，共 54/54 |
| Site 基线 | PASS | `npm test` 构建成功、Node 278/278；独立 build、Parser 类型夹具、隔离 API smoke、OpenAPI YAML、Drizzle 无漂移和 265 文件凭证扫描通过；lint 0 error/1 个任务外既有 warning |
| 全仓 TypeScript | KNOWN BASELINE | `tsc --noEmit` 仍有 10 个任务外既有错误，位于 multipart/service、Material list 与既有 schema 自引用；本任务未降低检查或扩大范围修复 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite go-live 检查通过；临时数据已清理 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1/R2/Queue，未创建 binding/Cron、执行生产 migration、修改 hosting 或部署 |

## PHASE2-TASK03 Excel/CSV Parser 与字段 Mapping V1 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / CONFIRMED BY TASK04 | 16 项决定已由项目负责人批准并在 PHASE2-TASK04 非生产实现 |
| 正式交付 | COMPLETE | Parser 主规格、OpenAPI 草案、Mapping 规格、Mermaid 流程图和 16 项 `PROPOSED` 决策表 |
| `PARSED` 语义 | DESIGNED | 当前策略允许的可见 Sheet 原始行、元数据和汇总完整核验后，run 状态、旧 run、current pointer、批次版本、事件、审计和幂等在单事务发布 |
| 调度 | PROPOSED | D1 同事务写 Outbox，提交后至少一次发送；Queue `max_batch_size=1` 与低并发仍需压测和基础设施审批，不宣称 D1/Queue 原子 |
| 恢复 | DESIGNED | 七个持久阶段；Sheet 是 V1 真正恢复边界，500 行/约 10 秒检查点只用于观测、预算、心跳和幂等写入 |
| 解析候选 | UNVERIFIED / PROPOSED | `zip.js + sax-wasm + 受限 OOXML`、`csv-parse` browser ESM；尚未通过 Vinext、Miniflare、Workers、WASM、R2 Range、Bundle 或内存矩阵 |
| 原始契约 | DESIGNED | sparse cells + `source_column_count`，区分缺失与 EMPTY；日期保留 source/raw/format/system/解释状态；公式不执行 |
| Shared Strings | PROPOSED | run 级 D1 分块和有界预取为推荐候选，R2 分块索引为备选；禁止逐 cell 查询或默认全量常驻内存 |
| 资源限制 | PROPOSED | 32 Sheet、50k 行、256 列、2m 非空 cell、256 MiB 规范化总量等组合限制；最终值需脱敏样本与容量/并发压测 |
| Mapping | DESIGNED / PROPOSED | Sheet/header suggestion、关系化主从、target allowlist、`category_hint`、版本 CAS、旧 Mapping STALE/SUPERSEDED 和有界预览 |
| API | CONTRACT ONLY | 七个拟议路由，包含权限、owner/read_any、CSRF、幂等、批次/Mapping 版本、metadata 摘要和稳定错误；未实施 |
| `0005` | DESIGN ONLY | 设计新表、状态 CHECK、rows 重建、外键/索引、Up/Down/重升/失败回滚；未创建 SQL、schema 或 snapshot |
| 文档验证 | PASS | OpenAPI YAML 与 115 个本地引用通过；规格约束/16 项决策检查通过；lint 0 error/1 个既有 warning、build 与 Node 224/224、隔离 API smoke、251 文件凭证扫描通过；临时 SQLite 环境守卫 4/4、self-test、smoke、backup/restore、go-live 通过并清理；`git diff --check` 和文档-only 范围核对通过 |
| 生产影响 | NONE | 未连接 production、D1、R2 或 Queue，未迁移、创建资源、修改部署配置或发布 |

## PHASE2-TASK02 Material Import Batch Foundation V1 实施基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 12 项决定已批准；非生产实现、测试和文档完成，停止等待验收或新任务 |
| 正式交付 | COMPLETE | 正式规格、OpenAPI、Mermaid 图、`0004`、运行时模块、集成与测试全部同步 |
| 基础设施现状 | SAFE / LOCAL ONLY | `.openai/hosting.json` 的 `r2` 仍为 `null`；只新增抽象、R2 适配代码和内存替身，没有创建生产资源 |
| 存储与上传 | IMPLEMENTED | 私有对象存储抽象 + D1 元数据；恰好一个 file part、10 MiB 流式计数、增量 SHA、类型探测、条件写入且不公开对象定位信息 |
| Saga 与状态 | PASS | D1 意图、对象存储不可覆盖写入、STORED、安全检查、FILE_READY 分层；对象不一致和提交结果不确定进入 `RECONCILIATION_REQUIRED` |
| 数据模型 | PASS | `0004` 创建四张业务表和专用幂等表；V1 六种批次状态、外键/唯一/CHECK/终态约束及 Down 数据保护均有测试 |
| API/权限 | PASS | 六个精确路由；Session、capability + owner/`read_any`、隐藏 404、CSRF、限流、request_id、CAS、稳定错误码；无下载端点 |
| 幂等/并发 | PASS | multipart 摘要排除 boundary/原始字节/Content-Length；条件写不覆盖；覆盖响应未知、并发单文件、取消/完成 CAS 与 D1 后提交失败 |
| 保留/清理 | IMPLEMENTED / NOT SCHEDULED | 30/1095 天终态字段和两阶段手工清理服务已实现；未创建生产生命周期或 Cron |
| Migration | PASS / NOT APPLIED TO PRODUCTION | 生成 `0004` SQL、Drizzle schema/快照和带数据保护 Down；空库/已有数据/约束/回滚/原子失败 3/3 通过 |
| 文件安全 | PASS | XLSX OOXML/ZIP 边界、宏/加密/路径/压缩风险和 CSV UTF-8/GB18030/NUL/二进制/HTML 伪装均有覆盖；不宣称杀毒能力 |
| Site 基线 | PASS | build、全量 Node 224/224、导入专项 12/12、迁移 3/3、隔离 API smoke 和 247 文件凭证扫描通过；lint 0 error/1 个既有 warning |
| 本地基线 | PASS | 项目 Python 3.12 临时 SQLite `server.py --self-test`、`smoke_test.py` 和 `go_live_check.py --no-backup` 通过；临时数据已清理 |
| 运行时范围 | IMPLEMENTED AS AUTHORIZED | 仅在线生产方向新增基础模块；没有解析业务行、写入 `material_import_rows`、创建 Material Draft 或扩展本地旧版业务逻辑 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1/R2 binding，未迁移真实数据、创建 bucket/密钥或部署 |

## PHASE1-TASK14 Material Review UI 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产前端实现、自动测试、浏览器验收、文档和独立功能提交完成；未自动开始后续任务 |
| 页面路由 | IMPLEMENTED | 新增 `/materials/review`、`/materials/:materialId/review`；入口只由 `material.review.queue` 控制 |
| 队列 | PASS | URL 权威筛选、300ms keyword、四种 allowlist 排序、20/50/100 服务端分页、叶子分类、创建人和提交日期；展示但不筛选 `submitted_by`，服务端 `total` 为权威 |
| 工作台 | PASS | 方案 A；左侧完整只读详情，右侧实测 310px sticky Validation/职责分离/审核操作；基本信息、职责、属性、Validation 和历史展示复用共享组件 |
| 批准与驳回 | PASS | 最终动作前重读统一详情；ERROR 禁止批准，WARNING 明示确认；批准返回正式编码与 ACTIVE，驳回返回 DRAFT 并复读 `last_rejection` |
| 权限与职责 | PASS | queue/approve/reject 独立能力；创建人或最后修改人禁审、提交人本身不禁审；前端无角色名推断，服务端继续最终裁决 |
| 安全与并发 | PASS | 复用 Session/共享 Client/CSRF；approve/reject 独立页面内存 Key 和不可变载荷；RESULT_UNKNOWN 仅原请求安全重试，覆盖版本冲突、状态变化、429、dirty 和离开保护 |
| 状态与可访问性 | PASS | 400/401/403/404/422/429/5xx、request_id、加载/空/无结果、焦点定位、对话框初始焦点/Tab/Escape/恢复和 live region 均有实现或测试 |
| UI 测试 | PASS | Review UI 51/51；只读 UI 回归 37/37；全量 Node 209/209 |
| 浏览器验收 | PASS | 本地 Vinext + Playwright 1366×768；队列 2 行、sticky 右栏 310px、WARNING 复选确认、批准写入模拟与成功返回原队列完整往返通过 |
| Site 基线 | PASS | build、lint 0 error/1 个既有 warning、一次性隔离 D1 API smoke、233 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED | 未修改 API、Schema、migration、索引、Material 业务服务、Legacy SQLite 或部署配置 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移真实数据、部署或修改生产配置 |
| 已知限制 | RECORDED | 队列 API 不支持 `submitted_by` 筛选；公开 Site 仍为旧版本；生产迁移/部署、候选索引及 `PENDING_APPROVAL` 收缩需独立任务 |

## PHASE1-TASK13 Material Review UI 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING SPECIFICATION CONFIRMATION | 五段设计和补充约束已确认；正式规格与低保真线框完成，停止并等待“规格确认” |
| 页面路由 | DESIGNED | `/materials/review`、`/materials/:materialId/review`；队列 URL 保存筛选、排序和分页，`return_to` 仅接受审核队列路径 |
| 推荐布局 | APPROVED | 方案 A：左侧完整只读详情，右侧 sticky Validation、职责分离和审核操作；方案 B 仅作线框比较 |
| 权限与职责 | APPROVED | 能力权限驱动；创建人或最后实质修改人禁审，提交人本身不禁审；前端提示，服务端 403 code 最终裁决 |
| 批准与驳回 | APPROVED | 批准前重读详情并单一最终确认；WARNING 明示确认；驳回原因 1–1000 字；成功返回原队列状态 |
| Validation | APPROVED | 确认绑定 material_id、current_version 和当前规范化摘要；摘要仅用于前端新鲜度，服务端重新校验是唯一安全边界 |
| API 兼容 | RECORDED | 队列无 `submitted_by` 筛选；职责分离使用既有 HTTP 403；不新增 metadata version API，三项均不阻断前端实施 |
| 组件边界 | DESIGNED | 后续实施仅最小提取现有只读详情展示，不复制逻辑、不改变契约、不引入大型依赖；本任务未改代码 |
| 测试设计 | COMPLETE | 分组保留全部 51 项，覆盖 A/B、队列/工作台、两类确认、职责分离、冲突/结果未知、HTTP 错误和 1366×768 |
| 文档阶段验证 | PASS | lint 0 error/1 个既有 warning；构建与 Node 158/158、隔离 API smoke、226 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 运行时范围 | UNCHANGED | 无前端运行时代码、API、Schema、Migration、索引、业务服务、测试业务代码或部署配置变化 |
| 生产影响 | NONE | 未连接 production、公共 URL、远程 D1 binding，未迁移真实数据或部署 |

## PHASE1-TASK12 Material Draft UI 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产前端实现、隔离验证、文档和独立功能提交完成；未自动开始后续任务 |
| 页面路由 | IMPLEMENTED | 新增 `/materials/new`、`/materials/:materialId/edit`；列表与 DRAFT 详情入口由 `user.permissions` 和所有权能力驱动 |
| 布局与表单 | PASS | 布局 C；分类/基础信息并列、动态属性全宽、200px 快速定位与 Validation、sticky 操作区；TEXT/INTEGER/DECIMAL/BOOLEAN/ENUM 和单位由当前 D1 Schema 驱动 |
| 数据语义 | PASS | 严格整数/小数、完整属性聚合、0/false 保留、空可选属性省略、MANUAL 固定来源、source_ref 只读、未知旧属性显式删除保护 |
| 写链路 | PASS | 创建 POST 后进入编辑页；编辑采用 PATCH 完整替换、GET 回读、WARNING 确认和 submit；保存/同步/提交期间禁用输入 |
| 安全与并发 | PASS | 复用 Session/CSRF/同源 Cookie；Material 写请求缺少显式 Key 或 CSRF 时 Client fail-closed；原 Key/原载荷安全重试、RESULT_UNKNOWN、SAVED_UNSYNCED、VERSION_CONFLICT 对照和 429 Retry-After 已覆盖 |
| 状态与可访问性 | PASS | 401/403/404/409/422/429/5xx、request_id、dirty/beforeunload、分类切换、离开确认、焦点定位、Tab/Escape/焦点恢复和 last_rejection 只读展示均有实现或测试 |
| UI 测试 | PASS | Draft UI 54/54；Material 只读 UI 回归 37/37；全量 Node 158/158 |
| 浏览器验收 | PASS | 一次性本地 D1 完成创建、编辑、PATCH/GET/submit 至 PENDING_REVIEW；1366/1280/1024/768 均无横向溢出，三列按断点降为两列/一列，离开保护与成功跳转通过 |
| Site 基线 | PASS | build、lint 0 error/1 个既有 warning、一次性 D1 API smoke、224 文件凭证扫描通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED | 未修改 API、Schema、migration、索引、Material 写服务、Legacy SQLite 或部署配置 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移真实数据、部署或修改生产配置 |
| 已知限制 | RECORDED | 详情契约没有历史 `schema_version`；V1 以当前 Schema、未知 code 保护和服务端 422 重新加载 fail-closed，不自动迁移旧属性 |

## PHASE1-TASK11 Material Detail last_rejection 投影状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 非生产实现、隔离验证、文档和独立功能提交完成；未开始 PHASE1-TASK12 |
| 历史规范来源 | PASS | 单一使用不可变 `material_versions` REJECT 行；当前写事务完整保存版本、原因、审核人和审核时间，不需要关联 change logs |
| 统一 Query Service | IMPLEMENTED | `/materials/:id` 与 `/drafts/:id` 共用 `lastRejection()`；先完成既有行级可见性，隐藏对象仍为 404 |
| 确定性与有界性 | PASS | `version_no DESC, reviewed_at DESC, id DESC LIMIT 1`；不读取最近 5 条推断，不加载全部历史，不影响列表或引入 N+1 |
| 安全与损坏历史 | PASS | reason 作为纯文本原样返回；缺少版本、原因、审核人或有效时间时 fail-closed 为脱敏 `INTERNAL_ERROR` 并保留 request_id |
| 查询计划 | PASS / NO MIGRATION | `SEARCH material_versions USING INDEX material_versions_material_version_uq (material_id=?)`；无全表扫描，未新增索引；极大单物料历史需后续复测 |
| 回归覆盖 | PASS | null、单次/多次驳回、摘要外驳回、重新编辑/提交、最终 ACTIVE、两接口一致、drafts 状态限制、隐藏 404、纯文本、损坏历史和分页/摘要不变 |
| Site 基线 | PASS | build、Node 104/104、lint 0 error/1 个既有 warning、一次性 D1 API smoke、219 文件凭证扫描和 OpenAPI YAML 解析通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 `go_live_check --no-backup` 通过；临时数据已清理 |
| 数据库/API 范围 | UNCHANGED STRUCTURE | 只扩展两个既有详情响应字段；无新路由、Schema、migration、索引、历史修改或写服务变化 |
| 生产影响 | NONE | 未连接生产 URL/D1，未迁移、部署或修改生产配置 |

## 统计复现方式

1. 使用 `rg --files` 获取两个运行面的源码文件。
2. 排除 `data/`、`node_modules/`、`.next/`、`dist/`、`.wrangler/`、生成物和嵌套仓库中的重复导入目录。
3. 代码扩展名：`.py`、`.ps1`、`.ts`、`.tsx`、`.js`、`.mjs`、`.html`、`.css`、`.sql`。
4. API 统计从在线集中式处理器提取具体 `/api/...` 字符串并去重。
5. 数据表统计来自本地 `server.py` 建表语句及在线 `db/schema.ts`。

## 下次更新触发条件

- 任务状态或 Branch 变化
- 新提交、发布或生产 Site 版本变化
- 数据库迁移或表数量变化
- API、页面、测试或主要目录变化
- 统计口径变化

## PHASE1-TASK10 Material Draft UI 书面设计基线

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 五节设计及全部补充约束已确认；只完成规格和线框稿 |
| 页面路由 | DESIGNED / IMPLEMENTED BY TASK12 | `/materials/new`、`/materials/:materialId/edit` 已由后续 PHASE1-TASK12 实施 |
| 布局 | APPROVED | 布局 C；分类/基础信息首屏并列、动态属性全宽、约 200px 快速定位与 Validation、sticky 操作区和窄宽降级 |
| 表单与 Schema | APPROVED | 当前 D1 Schema、完整 PATCH、严格数值、0/false、未知属性保护、分类切换确认和 Schema 漂移 fail-closed |
| 写状态 | APPROVED | POST 后 GET、PATCH/GET/submit、WARNING 确认、Idempotency 状态机、RESULT_UNKNOWN、SAVED_UNSYNCED、dirty 和版本冲突对照 |
| 权限 | APPROVED | `/api/session -> user.permissions`；不硬编码角色；服务端继续最终校验权限、所有权、状态和 expected_version |
| API 兼容 | PREREQUISITE COMPLETE | Session/创建响应/validate-only 未调整；统一详情 `last_rejection` 已由 PHASE1-TASK11 在非生产开发代码实现 |
| 测试设计 | COMPLETE | 单元、组件、集成、原 47 项加 7 项扩展 E2E，以及 1366×768 人工视觉/键盘验收 |
| 文档阶段基线 | PASS | lint 0 error/1 个既有 warning；Node 103/103；隔离 API、凭证扫描、临时 SQLite 五项基线和 `git diff --check` 通过 |
| 代码/API/schema 变化 | NONE IN TASK10 | TASK10 未修改运行时代码；后续 TASK12 仅实施前端与测试，仍未修改 API、Schema、Migration、索引或业务服务 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实物料、未部署或修改生产配置 |

## PHASE1-TASK09 Material 只读管理界面实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 规格已确认，非生产实现、测试和文档完成 |
| 页面路由 | IMPLEMENTED | `/materials`、详情、版本和变更日志四条原生 Vinext 路由；本地开发运行面深链接均返回 200 |
| 布局 | PASS | 高密度企业表格列表；高密度分区卡片详情；独立 URL 历史页签；首屏无统计卡片 |
| URL 与分类 | PASS | URL 权威筛选/排序/分页、300ms keyword debounce、popstate、安全 return_to、叶子 ID/非叶子 path 语义均有测试 |
| 认证与请求 | PASS | 复用现有 Cookie 和根页面登录遮罩；legacy 与 Material 共同委托唯一共享浏览器 Client；未硬编码生产地址或直连 D1 |
| 状态与错误 | PASS | INACTIVE 独立兼容、OBSOLETE/REPLACED 防御映射、unknown fallback；401/403/404/400/500、request_id、加载和空状态均覆盖 |
| UI 测试 | PASS | 37/37，覆盖任务要求的 36 类场景；无写操作、无界请求或客户端行级权限过滤 |
| Site 基线 | PASS | build、全量 Node 103/103、lint 0 error/1 个任务外既有 warning、一次性 D1 smoke 通过 |
| 本地基线 | PASS | 临时 SQLite 环境守卫 4/4、自测、烟测、备份恢复和 go-live 检查通过；临时目录已清理 |
| 安全检查 | PASS | 217 个仓库文件凭证扫描通过；`git diff --check` 通过 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实物料、未部署或修改生产配置 |

## PHASE1-TASK08 Reference & Query API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE / AWAITING ACCEPTANCE | 规格与 metadata 兼容规则已确认，非生产实现和验证完成 |
| 运行时代码 | IMPLEMENTED | 统一 Material Query Service、Reference Service、共享可见性和单位策略已接入；未修改前端或 legacy SQLite |
| 数据库 | UNCHANGED | 未修改 `db/schema.ts`、`drizzle/` 或任何 migration，未增加索引 |
| 统一查询 | PASS | `/materials` 覆盖全部生命周期；`/drafts` 复用统一可见性与详情组装；`/review-queue` 保持独立权限 |
| 行级可见性 | PASS | 正式状态全 read；DRAFT/PENDING_REVIEW 按创建人、edit-any、review-queue；隐藏详情/历史 404，列表及 total 完全过滤 |
| Reference | PASS | 完整启用分类 tree/flat、无 parent 懒加载；叶子 Schema 只读 D1 metadata；description/label fallback 和强 ETag/304 已验证 |
| 历史 | PASS | 详情每类最多 5 条摘要；版本和变更日志独立分页默认 20、最大 50；损坏 JSON fail-closed |
| 缓存与批量 | PASS | Reference 私有可验证缓存；物料及历史 private/no-store；列表 metadata 查询次数不随页大小增长 |
| 索引证据 | COMPLETE / NO MIGRATION | 1k/10k/100k 计划与采样完成；发现创建人 OR 可见范围等候选方向，只形成报告，未创建 migration |
| 非生产基线 | PASS | Site build、Node 66/66、lint 0 error/1 个既有 warning、一次性 D1 smoke、201 文件凭证扫描及临时 SQLite 完整基线通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 仅 `db/schema.ts:147`、`:332` 的既有 Drizzle 自引用 TS2740；TASK08 文件未出现类型错误，按授权未修改任务外问题 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK07 草稿生命周期实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 九项方案 A 已确认、实现、验证并记录；等待人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | 生命周期规格和 OpenAPI 明确 PATCH 非 Merge Patch、提交、队列、审核状态及稳定错误 |
| 状态命名 | PASS | 新代码只写/只返回 `PENDING_REVIEW`；通用查询双读旧/新值；历史快照旧文字不改写 |
| 职责字段 | PASS | 新增 `last_modified_by`、`submitted_by`、`submitted_at`；创建人永久禁审，当前版本最后修改人禁审，提交人本身不禁审 |
| API | IMPLEMENTED | PATCH 完整替换、POST 提交、GET 审核队列已实现；approve/reject 只处理 `PENDING_REVIEW` |
| 权限 | PASS | edit-own/edit-any/submit/review-queue 在服务端独立校验；admin/manager 无职责分离例外，purchase/engineering 仅自己的草稿 |
| Migration | PASS | `0003`、Down、snapshot/journal、旧状态可恢复回填、失败预检、子表保全、约束、索引、空库 Down/重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 仅修改在线服务端生命周期、Schema、Migration、测试和文档；未开发页面或下游业务 |
| 非生产基线 | PASS | Site build、Node 62/62、lint 0 error/1 个既有 warning、一次性 D1 API smoke、194 文件凭证扫描及本地临时 SQLite 完整基线通过 |
| TypeScript 全量检查 | EXISTING FAILURE | TASK07 新增代码无类型错误；`db/schema.ts` 两组既有 Drizzle 自引用类型诊断仍保留，按范围要求未修复 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK06 Draft/Review API 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 项目负责人已确认八项业务/安全选择；实现、测试和项目文档完成，等待功能提交后人工验收 |
| 规格文档 | APPROVED/IMPLEMENTED | `docs/material-master/draft-review-api-v1.md` 已记录确认选择和实施结果 |
| 认证边界 | VERIFIED | 复用 `app_users`/`app_sessions` 和服务端会话 actor；未使用未接入 ERP 的 ChatGPT Header 身份；禁止客户端伪造操作者 |
| 授权边界 | PASS | admin/manager 审核，purchase/engineering 创建，其他角色只读；所有角色包括 admin 禁止自审 |
| CSRF | PASS | 登录轮换 host-only 双提交 Token；Material POST 严格验证同源 Origin、Cookie/Header，Session Cookie 继续 HttpOnly |
| 幂等与限流 | PASS | 专用持久表保存 canonical 请求摘要、租约和 24 小时结果；完成/成功审计与业务 batch 原子提交；60 次写/20 个新 Key，测试可降低阈值 |
| Query | PASS | 列表默认 20/最大 100；详情当前 metadata 校验、分类路径、版本和变更日志均有界分页 |
| Migration | PASS | `0002` Up/Down、schema、snapshot/journal、已有数据升级、约束、防重、空状态回滚和重升通过 |
| 代码/API/schema 变化 | IMPLEMENTED | 新增 5 路由、Material API 五模块、共享 Validation 映射、2 张安全表和审计扩展；未开发页面或下游业务 |
| Site 基线 | PASS | build 成功；Node 58/58；lint 0 error/1 个既有 warning；一次性 D1 登录/CSRF/API smoke 和凭证检查通过 |
| 本地基线 | PASS | 项目 Python 3.12 的环境守卫 4/4、self-test、smoke、backup/restore 和临时 SQLite `go_live_check --no-backup` 通过 |
| 差异检查 | PASS | `git diff --check` 通过；敏感正文、原始 Key、Session/CSRF Token 不进入 Material 审计或错误响应 |
| 生产影响 | NONE | 未连接生产 D1、未迁移真实数据、未部署或修改生产配置 |

## PHASE1-TASK05 草稿创建与审核写服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-13 完成实现、验证、文档和独立功能提交 |
| 模块边界 | PASS | Types、D1 Repository、Draft Service、Review Service、Code Service 和统一导出保持独立；PHASE1-TASK06 通过受信适配调用，未复制业务规则 |
| 创建草稿 | PASS | Validation 无 ERROR 后原子写 `DRAFT`、类型化属性、`CREATE` 版本和 `CREATE_DRAFT` 审计；正式编码为空 |
| 批准启用 | PASS | 从 D1 重载并重新校验；单一 batch 原子领取序号、转 `ACTIVE`、写编码/批准信息、`APPROVE` 版本及两条审计 |
| 拒绝 | PASS | 保持 `DRAFT`、version + 1、追加 `REJECT` 版本和审计；不读取或消耗编码规则 |
| 属性存储 | PASS | 按 definition 类型列保存 TEXT/ENUM/INTEGER/DECIMAL/BOOLEAN，DECIMAL 精确缩放；保留 unit、source_type、source_ref、created_by/created_at |
| 并发与编码 | PASS | 同草稿双审核一成功一版本冲突；同规则双草稿读取同一旧序列后 CAS 重试并生成不同编码；唯一索引竞争路径跳过占用序号 |
| 规则漂移保护 | PASS | 创建和批准均比较 metadata/属性守卫；校验后品类/属性规则变化时事务冲突回滚 |
| 事务回滚 | PASS | 故障注入使最后一条编码审计失败，规则、物料状态、版本和审计全部保持事务前值 |
| 服务测试 | PASS | 新增 12/12 隔离 D1 场景；完整 Node 52/52 |
| Site 基线 | PASS | build 成功；lint 0 error/1 个既有 warning；隔离 API smoke、176 文件凭证检查和 `git diff --check` 通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍为既有 Drizzle 自引用类型错误 |
| 数据库/API 变化 | NONE | 未修改 schema、migration、API、页面、导入、BOM、采购、库存或生产 |
| 生产影响 | NONE | 未连接生产 D1，未迁移真实数据，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无多角色节点、草稿编辑/重新提交、API 权限/幂等；拒绝状态复用 `DRAFT`；编码规则仍需后续受控初始化 |

## PHASE1-TASK04 物料校验服务状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 任务状态 | DONE | 2026-07-12 完成实现、验证、文档和独立功能提交 |
| 设计审批 | PASS | 采用 Repository + Rules + Service；D1 metadata 是运行时分类和属性规则唯一来源 |
| 接口边界 | PASS | attributes 按稳定大写 attribute code 索引；禁止 attribute_id；保留 source/confidence 扩展字段 |
| 服务实现 | PASS | Types、D1/Memory Repository、Rules、Service 和统一导出已完成；25 个结构化 code 中 24 ERROR、1 WARNING |
| Metadata 变化 | PASS | 隔离 D1 中标准单位、枚举、必填、属性定义/绑定/分类状态变化均在下一次校验生效 |
| 校验测试 | PASS | 新增 22 个顶层测试和 6 个子测试，共 28/28；Memory Repository 与指定 FR4/电阻/锡膏矩阵通过 |
| Site 基线 | PASS | build 成功；Node 40/40；lint 0 错误/1 个既有警告；隔离 API 烟测和凭证检查通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 新增模块无类型错误；`db/schema.ts` 第 129、243 行仍有 PHASE1-TASK02 已记录的 Drizzle 自引用类型错误 |
| 业务变化 | NONE | 未修改 API、页面、迁移、真实物料或 BOM/采购/库存 |
| 生产影响 | NONE | 未连接生产 D1，未部署或修改生产 metadata |
| 已知限制 | RECORDED | 无品牌字典、不做单位数值换算、不支持 DATE、不检测跨物料冲突，source/confidence 暂不参与决策 |

## PHASE1-TASK03 分类与属性模板状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 分类数据 | PASS | 101 个节点、5 个一级分类、39 个四级叶子；父子级别连续 |
| 属性定义 | PASS | 34 个复用定义；覆盖 TEXT、INTEGER（NUMBER 语义）、DECIMAL、BOOLEAN、ENUM 与要求单位 |
| 属性绑定 | PASS | 228 条绑定全部指向四级叶子；叶子 39/39 均有完整模板，不存在父级继承 |
| Seed 幂等 | PASS | 首次写入后第二次 inserted 为 0，记录总数不变并输出 updated 统计 |
| 环境保护 | PASS | 仅接受 test/local；production 和 `--remote` 在数据库访问前拒绝 |
| 数据库影响 | NONE | `0001` migration、schema 和快照未修改；未连接生产 D1 |
| Site 基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 12/12（包含 migration）通过 |
| TypeScript 全量检查 | EXISTING FAILURE | 本任务新增文件无类型错误；`db/schema.ts` 第 129、243 行存在 PHASE1-TASK02 已有的 Drizzle 自引用类型错误 |

## PHASE1-TASK02 Schema 实施状态

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| 目标运行面 | CONFIRMED | 仅在线 Site/D1 schema；本地 SQLite 未修改 |
| 设计审批 | PASS | 已吸收正式编码审核后生成、生命周期、变更日志、供应商五要素时效唯一性和应用层校验调整 |
| 数据库变化 | IMPLEMENTED | 新增 12 张 V2 表的 Drizzle schema、`0001` Up/Down、snapshot 和 journal |
| 业务变化 | NONE | 未修改 BOM、采购、库存、生产、导入、AI、API 或页面 |
| 数据操作 | NONE | 未连接生产 D1，未迁移真实数据，未创建生产表 |
| 隔离迁移 | PASS | 空库 Up、防重、结构/约束、Down、重建通过；临时 D1 已清理 |
| 完整基线 | PASS | lint 0 错误/1 个既有警告；build 成功；Node 9/9；隔离 API 烟测、本地三项临时基线、凭证扫描和 `git diff --check` 通过 |

## PHASE0-TASK02 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| Site 环境守卫 | PASS | Node 6/6；production、公开 URL、非临时 D1 路径和非法环境名均拒绝 |
| 本地环境守卫 | PASS | Python 4/4；production/development 在数据库创建前拒绝 |
| 一次性 D1 API 烟测 | PASS | 完成合成写入、备份、恢复与错误提示验证；测试后数据库目录和进程均清理 |
| production 入口拒绝 | PASS | 退出码 1，未创建新临时目录 |
| 凭证检查 | PASS | `.env` 未跟踪；仓库文件、常见令牌格式和 hosting 键检查通过 |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时 SQLite |
| `smoke_test.py` | PASS | 输出 `SMOKE_TEST_OK`，数据库和备份均位于临时目录 |
| `backup_restore_test.py` | PASS | 创建、恢复、非法名称提示和最终数据清理通过 |
| `go_live_check.py --no-backup` | PASS | 使用临时 SQLite；未写正式数据或备份 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告 |
| `npm test` | PASS | 构建成功，Node 测试 8/8 通过；沙箱缓存写入限制下获准在沙箱外重跑 |
| `npm run build` | PASS | 最终独立构建通过，未连接数据库或网络 |
| 最终仓库检查 | PASS | 149 个仓库文件凭证扫描通过；`git diff --check` 无空白错误；代码中无生产地址硬编码 |

任务没有创建云端 D1、连接生产 D1、修改生产数据、保存 Site 版本或执行部署。

## PHASE0-TASK01-B 验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `server.py --self-test` | PASS | 输出 `SELF_TEST_OK`，使用临时数据库 |
| `go_live_check.py --no-backup` | PASS | 数据库检查通过；本地服务未启动，不要求在线健康检查 |
| `smoke_test.py` | FAIL（既有环境问题） | 临时测试进行到备份创建时返回 `unable to open database file`；与 PM-000 基线一致，未接触生产数据 |
| `npm run lint` | PASS with warning | 0 错误、1 个既有未使用变量警告，位于 Site 中此前合入的治理工具 |
| `npm test` | PASS | 沙箱内首次因 Vite 无权写 `node_modules/.vite-temp` 失败；按环境规则在沙箱外重跑后构建成功，渲染测试 2/2 通过 |
| Site tree 对比 | PASS | 纳管后的暂存子树 hash 与原 `9f2c2dc` tree hash 均为 `541decf5a685a0efc238868ef958d3ae500174e5` |
| Git 索引检查 | PASS | `chenyida_erp_site` 显示 77 个普通文件，仓库无 mode `160000` |
| 新 clone 恢复 | PASS | 使用 `git clone --no-local` 创建全新工作区；Site 为 77 个普通文件、0 个 gitlink，关键源码和文档完整存在，工作区干净 |
| 新 clone 依赖与测试 | PASS | Site 执行 `npm ci --offline` 安装 502 个包且 0 漏洞；`npm test` 构建成功、2/2 通过；本地 ERP `--self-test` 输出 `SELF_TEST_OK` |
| `git diff --check` | FAIL（继承内容） | 报告原 `9f2c2dc` tree 中既有的行尾空白和 EOF 空行；为保持 Site tree 完全一致，本任务未修改这些文件 |
| 在线 `erp-api-smoke.mjs` | NOT RUN | 脚本会写数据且尚无生产地址拒绝，禁止对公开生产 Site 执行 |

测试前后 `chenyida_erp_app/data/erp.sqlite3` 均为 233,472 字节，最后修改时间戳保持不变，本任务未修改正式本地数据库。
