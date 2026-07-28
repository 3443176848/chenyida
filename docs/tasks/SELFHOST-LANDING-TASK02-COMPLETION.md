# SELFHOST-LANDING-TASK02 完成报告

## 结论

- 状态：`DONE / PARTIAL IMPORT`。
- 固定结论：`PARTIAL REAL BOM IMPORT COMPLETED — REVIEW REQUIRED`。
- 用户澄清需要由系统承担历史数据分类后，任务从提交 `d63078bdda2d016306931a29ae98fc96f46de420` 连续执行；不 amend、reset、rebase 或改写该历史提交。
- 8 个获准真实表格全部通过名称、数量和 SHA-256 强校验；全程本机离线解析，未访问 D1、旧 SQLite 正文、其他服务器或互联网。

## 分类与映射

- 8 文件、13 Sheet、1,113 条来源记录：`ELIGIBLE=515`、`NEEDS_REVIEW=438`、`ARCHIVE_ONLY=160`、`BLOCKED=0`。
- 物料实体层面可映射来源 806 条，经 274 条重复来源归并后形成 532 个稳定 Material；BOM 层面 488 条来源可安全映射，按同物料聚合为 316 行。
- 匹配只采用来源稳定编码、明确 MPN、严格类别/名称/规格/型号/封装组合；类别还可由单一标准位号前缀解释。未以模糊名称合并。
- 缺单位时只对确定性可数电子/结构件推导 `PCS`；范围位号、重复位号、不可数耗材、无稳定身份、身份冲突或无法确定类别的来源保持隔离。
- A200 注意事项只归档；A200 BOM 与物料清单没有足够严格的跨文件同一身份证据，未猜测合并，也未把注意事项解释为 BOM。
- 6 个 Product/Version、6 个 BOM/Version、316 个 BOM Line 已写入；每个 BOM 都有隔离来源，因此 6 个 BOM Version 全部保持 DRAFT、发布数 0。

## staging、主库与幂等

- clean-0034 staging 首次导入与同批次重放通过：532 Material、6 Product、6 BOM、316 Line；第二次新增 0。
- 主库写入前仍为 34 migrations、唯一启用管理员/合法 Session、Material/Product/BOM/交易业务 0；没有其他导入进程。
- 主库首次导入与同批次重放通过，计数与 staging 一致。孤儿引用、重复内部编码、非法数量/精度/单位均为 0。
- 147 条物料级待复核来源没有写入 Material；291 条 BOM 级待复核来源没有写入 BOM Line。实体级部分导入通过独立 classification 和 source link 证据表达。
- `migration_tool` 运行面保存 1,113 条分类和 1,318 条目标来源链接；正式 Material 同时使用既有 `legacy_material_mapping`，每个正式 Material、Product、BOM 和 BOM Line 均有来源关系。
- 应用 Repository 查询返回 Material 总数 532、Product 6、BOM 6、Line 316；Web root/health 为 200，未伪造浏览器认证。

## 非目标业务与灾备

- Inventory Ledger/Balance、PO、Receipt、Work Order、Shipment、Finance Document/Settlement 全部保持 0；未生成库存期初、采购、生产、销售、品质或财务事实。
- 最新 pre-import custom dump：`/var/backups/chenyida-erp/real-bom-preimport-20260728T143430Z.dump`，SHA-256 `0e53c2b3079874fd224e25dddd4e162376f7df023cfc964b2275201252eb54a1`；list 与新空库恢复通过。
- post-import custom dump：`/var/backups/chenyida-erp/real-bom-postimport-20260728T143621Z.dump`，SHA-256 `42486ab24f2130f6c2f1a6920637cd34ff06a8ad73ed45b531e3e909e1f8fe57`；list 与第二新空库恢复通过。
- 主库和恢复库的 Migration、Material、Product/Version、BOM/Version/Line、来源链接、分类和待复核摘要逐项一致，非目标业务合计为 0。
- 本次 post-import dump 尚未异机复制；现有 alpha.34 异机灾备包不含本次导入数据，必须由用户另行执行受控异机复制和校验。

## 保密、清理与边界

- 资源起点/终点 available memory 均约 2.3 GiB、Swap 129 MiB、根盘可用 36 GiB；最终 60 秒 Swap `132452→132452 KiB`、增长 0，Load `0.21/0.28/0.27→0.38/0.31/0.28`。三容器 RestartCount 0/OOM false；Python PID `13737`、NRestarts 0。
- `source-manifest.json`、`profiling-report.json`、`mapping-results.csv`、`needs-review.csv`、`staging-reconciliation.json` 和 `import-plan.json` 均位于 `/var/lib/chenyida-erp/intake/real-bom-20260728`，目录 0700、文件 0600。
- staging、precheck、post-restore 数据库及容器内 payload/工具副本均已删除；pre/post dump、既有 alpha.34 包、resource-guard 备份和四个 ERP 持久卷保留。
- 原始表格未 add、commit、移动、改名或修改；最终 inode、大小、mode、mtime 与 SHA-256 重新核对。
- Git 只提交通用离线分类器、受控导入 adapter、单元测试和脱敏文档；不提交原始表格、payload、数据库 dump 或逐行结果。
- 未 push、创建 PR、部署、切流、停止 Python 服务、删除旧 SQLite 或启动下一任务。
