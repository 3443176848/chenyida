# SELFHOST-LANDING-TASK04 — 兼容业务台供应商导入入口收敛

状态：`DONE / DEPLOYED`

## 目标

修复 PostgreSQL ERP 的兼容业务台仍展示 CSV-only 旧导入页面的问题，使“供应商导入”进入现有原生 Material Import 批次工作流，并明确展示该工作区接受 CSV、XLS 与 XLSX。

## 已授权范围

- 项目负责人于 2026-07-28 指出 PostgreSQL 兼容业务台仍只接受 CSV，允许在当前源码内修复该入口和对应回归测试。
- 允许更新项目任务账本并创建独立 Git 提交。
- 源码修复阶段不包含生产部署、容器重建、服务重启、数据库写入或真实文件导入。
- 项目负责人于 2026-07-29 单独明确授权“部署 TASK04 到当前 18888 运行面并允许 build/restart”；该授权不包含 Migration、数据库写入或真实文件导入。

## 实施边界

- 兼容业务台不恢复已退役的 `/api/import`、`/api/import-file` 或 `/api/sample-import` 一步直写流程。
- “供应商导入”直接进入 `/materials/imports/new`，复用 PostgreSQL 原生的 Batch → file → parse → mapping → normalize → review 链路。
- 删除兼容页 CSV 文本粘贴、示例载入和二进制文件按文本读取的死入口。
- 所有原生工作台→兼容页入口增加统一版本标识，并为 `/erp/index.html` 配置 `no-store`，避免部署后继续命中旧的一小时静态缓存。
- 不修改 Parser、Worker、API、Schema、Migration、Compose、权限或业务数据。
- 保留未跟踪的 `shujvbiao/`，不读取、修改或提交其中真实业务文件。

## 验收标准

- 兼容业务台“供应商导入”链接指向 `/materials/imports/new`。
- 兼容页面不再含 `accept=".csv"`、`csvFile`、`runImportBtn`，前端不再调用已退役导入 API。
- 原生创建页继续声明接受 `.csv,.xls,.xlsx`，Worker 继续分别路由三类解析器。
- 原生工作台不再生成无版本的 `/erp/index.html?tab=...` 链接，兼容 HTML 配置为不缓存。
- Dashboard/Material Import 相关轻量回归测试通过，`git diff --check` 通过。
- Migration head 保持 `0034`，不执行数据库或生产环境变更。

## 完成结果

- `public/erp/index.html` 的“供应商导入”已改为直达 `/materials/imports/new`，并明确展示 CSV、XLS、XLSX；同步更新 `app.js` 缓存标识。
- 兼容页的 CSV 文本框、示例载入、`file.text()` 和 `/api/import` 调用已删除；Tab 事件只绑定带 `data-tab` 的按钮，不拦截原生页面链接。
- 原生工作台和 Dashboard 返回的兼容入口统一带 `20260728-import-handoff`，`next.config.ts` 为 `/erp/index.html` 设置 `private, no-store` 与 `Pragma: no-cache`，防止新部署继续复用旧 HTML。
- `/api/sample-import`、`/api/import`、`/api/import-file` 继续稳定返回 `410 LEGACY_OPERATION_RETIRED`，没有恢复绕过批次审核的一步直写。
- Dashboard UI/Unit/API coverage `12/12`、Material Import UI `102/102`、Parser `38/38`、Dashboard typecheck、浏览器脚本语法、定向 ESLint、`git diff --check` 和 1,023 个任务仓库文件 credentials scan 全部通过；全量 ESLint 为 0 error/8 个既有 warning。Parser 单测实际覆盖 CSV/XLSX 内容解析；XLS 本轮只核验 OLE 签名分类和 Worker 静态路由，未执行 XLS/XLSX→PostgreSQL 端到端导入。
- 验证前后 available memory 均为 2.2 GiB、Swap 均为 114 MiB、根盘可用均为 36 GiB；PostgreSQL/Web/Worker/Caddy restart 0、OOM false。
- 源码提交时未修改 package 版本、API、Schema、Migration、Compose 或业务数据；当时未 build、重启、部署或导入真实文件。该历史事实不改写，后续部署记录见下节。

## 部署结果（2026-07-29）

- 部署对象为功能提交 `cda8c7eebf93d1ba3b558a700b535dbf00fd92b2`；开始时工作区仅有已授权保留的未跟踪 `shujvbiao/`，本轮没有读取、修改或提交其中文件。
- 以 `COMPOSE_PARALLEL_LIMIT=1` 串行构建 Web，新镜像为 `sha256:2db38e312586ef769f62f53b077fae2ebdaa88a926731642d6d89e223131ea05`；仅使用 `--no-deps --force-recreate --wait` 替换 Web。PostgreSQL、Worker 和 Caddy 容器 ID 保持，未运行 migrate、未重启 Python、未改 Schema/Compose/数据。
- 公网与回环 `/api/health` 均为 200，匿名 `/api/materials` 为 401，`/materials/imports/new` 为 200。公网 `index.html` SHA-256 为 `5a81e310f80f5809d9f8e79b74fd4ab0b7ef1753e512529d2396cc4d58cbd087`，`app.js` 为 `a401e43648f0ea59dc89ee6b823e0b38c44bd365f4de8f460d4aa40bbcaa2939`，均与源码精确一致；旧 CSV 控件、`file.text()` 和退役 API 调用标记全部消失。
- 在线响应已包含 `Cache-Control: private, no-store, max-age=0, must-revalidate` 和 `Pragma: no-cache`；Vinext 同时输出一条冗余 `Cache-Control: public, max-age=3600`。标准缓存须遵守更严格的 `no-store`，但为避免矛盾指令，精确消除该默认头已记为后续独立收缩任务。
- 部署前后数据只读计数保持：34 migrations、head `0034_supplier_receipt_lot_iqc.sql`，Material/Product/Product Version/BOM/BOM Version/Line 为 `532/6/6/6/6/316`，Inventory Ledger/PO/Receipt/WO/Shipment/Finance Document/Settlement 为 0。
- 起点 available memory 2.1 GiB、Swap 114 MiB、根盘可用 36 GiB；最终为 2.2 GiB、123 MiB、35 GiB。build 后 60 秒 Swap +100 KiB，部署后 60 秒 -24 KiB；PostgreSQL/Web/Worker/Caddy restart 0、OOM false，本轮内核 OOM 记录 0。
- 所有临时验证容器已 `--rm`，无 TASK04 临时容器残留；四个 ERP 持久卷与 Caddy 证书卷未更换或删除。Build Cache 1.401 GB 和旧 Web 回滚标签 `chenyida-erp-parallel-web:task04-predeploy-20260729` 有意保留，未执行未授权的 prune。

## 相邻风险（不在本任务变更范围）

- 只读审计确认 `/api/material-master/import-batches` 当前返回 `{items,next_cursor}`，原生列表页却读取 `{data,total,page}`，且 cursor 被忽略；列表页会因此失配，需单独任务修复。
- 解析任务重试耗尽时，现有 Worker 可能只把 Job 标为 `DEAD` 而未把 Batch 置为 `FAILED`；损坏文件可能停在轮询态，需单独任务补终态与回归。
- PostgreSQL 创建/上传端对幂等键以及前端发送的版本、SHA、重复策略和基础安全检查契约尚未完整落实；本任务没有触碰上传 API，不能把入口兼容修复表述为这些安全语义已验收。
- CSV/XLS/XLSX 是页面选择器和 Worker 路由合同；本轮没有实际执行 XLS/XLSX→PostgreSQL 端到端导入，Excel 运行验收须另立任务。
