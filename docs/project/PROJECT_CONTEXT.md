# 晨亿达ERP项目上下文

> 新的 Codex 对话必须先阅读 `MASTER.md`，然后阅读本文件、`TASKS.md` 和当前任务文档。

## 项目介绍

晨亿达ERP面向 PCB、FPC、SMT 行业，目标是用统一内部编码贯通物料、产品、BOM、采购、库存、生产、销售、品质和财务。当前系统已经存在本地版和在线版；未来主线是 AI 物料主数据中心，但 AI 必须受审核、审计和数据权限约束。

## 系统组成

### 本地 ERP

- 路径：`chenyida_erp_app/`
- 技术：Python 3.11、标准库 HTTP Server、SQLite、原生 HTML/CSS/JavaScript；项目虚拟环境固定 `openpyxl`/`xlrd` 解析 XLSX/XLS。
- 入口：`server.py`；静态页面位于 `static/`。
- 用途：服务器本地运行和后续默认交付目标；根据 D-029 公网验证期间监听 `0.0.0.0:18888`。
- 数据：`chenyida_erp_app/data/erp.sqlite3`，运行数据被 Git 忽略。

### 在线 Site

- 路径：`chenyida_erp_site/`
- 技术：Vinext、React、TypeScript、Cloudflare Worker、D1、Drizzle、OpenAI Sites。
- 页面：根 `app/page.tsx` 继续通过 iframe 加载 legacy `public/erp/index.html`；Material Master 和 Import Workspace 使用 `app/materials/` 原生 Vinext 路由。
- API：`app/api/[...path]/route.ts` 转交给 `app/lib/erp-api.ts` 的集中式处理器。
- 历史在线生产：Sites `v3`，公开地址 `https://chenyida-erp-online.sjin74376.chatgpt.site`；不作为后续新功能默认交付目标。

- 公网验证地址：`http://43.135.157.211:18888`；仅用于本次验证，长期公网运行仍需 HTTPS 和访问控制。
- 开发常驻服务：systemd `chenyida-erp.service`，服务定义源码位于 `deployment/chenyida-erp.service`。
- 源码管理：`PHASE0-TASK01-B` 已将原 gitlink 转为根仓库直接跟踪的普通目录；新克隆可恢复完整源码。生产提交为 `2b4f178`，纳管前开发提交为 `9f2c2dc`。

### 治理资料

- `物料主数据治理落地包/`：编码、字段、导入、审核 SOP、模板和清洗辅助工具。
- `docs/audits/current-system-audit.md`：当前系统技术审计。
- `docs/material-master/`：物料主数据中心 V2 计划和待确认决策。
- `docs/project/`：本项目长期运行的权威上下文和任务台账。

## 数据库

### 本地 SQLite

- 29 张业务/迁移表；历史 26 张表仍由 `server.py` 建立，Excel 导入新增表从 `0001_material_import_source_lineage.sql` 起使用版本化迁移。
- 覆盖用户、会话、物料、映射、清洗、客户、供应商、产品、BOM、采购、库存、生产、销售、品质、财务和活动日志。
- 已增加 `local_schema_migrations`、`material_import_batches`、`material_import_raw_rows` 及来源外键/索引；`0002` 为批次增加完整原文件归档 key、大小和 warning。历史表的迁移基线与外键治理仍待逐步补齐。

### 在线 D1

- `drizzle/0000`—`0008` 形成 45 张表的开发 schema；Material V2、Draft/Review、Import Batch、Parser/Mapping、Normalization、Material Library 和 Supplier Profile 全部使用版本化 Up、snapshot/journal、受保护恢复边界与隔离迁移测试，尚未执行生产 migration。
- 大多数业务对象按 `kind` 存入 `erp_records.data_json`。
- API 运行时仍只为 legacy 8 表包含兼容建表语句；V2 与 Material API 对象必须显式应用版本化 migration，不在生产启动时自动创建。

## 主要模块

- 身份与权限：初始化、登录、会话、角色、用户状态、密码重置、审计。
- 物料治理：物料、供应商映射、CSV/XLSX/XLS 自适应导入、不可变原始行、清洗确认、新物料建档。
- 工程：产品、BOM、BOM 行、齐套分析。
- 供应链：供应商、采购建议、采购订单、收货、库存调整和库存流水。
- 制造：工单、BOM 转工单、领料、完工和报工。
- 销售：客户、询价/报价、销售订单和发货。
- 品质与财务：检验、缺陷、应收应付单据、收付款和汇总。
- 运维：健康检查、管理看板、备份、恢复和导出。

## 当前架构结论

1. 两个运行面包含大量相似业务能力，但数据库结构不同，尚未明确唯一生产权威源。
2. 在线版是当前公开生产方向；服务端 API/D1 是权限和数据规则的权威边界。
3. legacy 在线 API 主要集中在 `erp-api.ts`；Material namespace 已由 catch-all 精确分发到独立 Material API、安全、查询和审计导出模块，并调用现有 Validation/Draft/Review Service。
4. Material Master V2 应先建立关系化数据底座和迁移测试，再接入页面或 AI。
5. 当前生产 `v3` / `2b4f178` 与纳管开发基线 `9f2c2dc` 的运行时代码一致；任何后续业务修改与部署仍须单独批准。
6. 测试默认使用本机一次性 Miniflare D1；只接受 `ERP_ENV=test` 和 HTTP 回环地址，远程绑定关闭，测试后销毁数据库。

## 当前风险

- Site 源码已可从根仓库恢复；生产提交与开发提交仍需在后续发布基线中持续追踪。
- 本地和在线数据模型、编码和治理行为分叉。
- 在线 JSON 模型缺少关键关系约束；本地 SQLite 缺少外键和迁移历史。
- A118/V700 已在服务器本地形成 2 Batch、766 Raw Rows 和 543 Cleaning Rows，完整原文件按 SHA 归档；全部行仍为 NEEDS_REVIEW，22 行缺规格、543 行缺单位，内部物料没有自动增加。
- Material Draft/Review POST 已具备同源/CSRF、持久幂等和限速；其他 legacy POST 的 CSRF 与限速仍需专项治理。测试环境已有本机一次性 D1，尚无远程 Test D1。
- Material Draft、Review Queue、Import Workspace 和 Normalization Review UI 已完成非生产实现，但生产 Site 仍为旧版本。
- 在线同库备份和本地零字节历史备份不能视为可靠灾备。
- 业务决策 `B01-B24` 尚未全部确认。

## 开发规范

- 每次只执行 `TASKS.md` 中一个任务编号。
- 不扩大范围，不修改无关代码，不直接操作生产数据或生产环境。
- 数据库变化必须使用版本化迁移并提供隔离迁移测试。
- 新功能必须有测试；关键写操作必须有权限、事务、幂等、并发和审计。
- AI 不得直接覆盖正式数据，物料合并不得绕过人工审核。
- 完成任务必须更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 并创建独立提交。

## 当前路线

当前已完成 Phase 1 Material V2 非生产数据、服务、API 与前端，Phase 2 Import，以及 Phase 3 Normalization、内部物料库、多供应商识别和服务器本地 Excel 接入。A118/V700 已进入开发服务器清洗审核队列；下一步是批次级单位/Mapping 确认和 22 条空规格处置，而不是重新索取模板。

## 恢复上下文检查清单

1. 阅读 `AGENTS.md` 和 `docs/project/MASTER.md`。
2. 阅读 `TASKS.md`，确认唯一当前任务和依赖。
3. 阅读本文件及 `DECISIONS.md`，区分已确认与待确认事项。
4. 阅读当前任务文档，检查禁止事项和验收标准。
5. 运行 `git status`，不得覆盖用户未提交变更。
6. 只读核验可能变化的 Git、Site 和数据库状态后再开发。
