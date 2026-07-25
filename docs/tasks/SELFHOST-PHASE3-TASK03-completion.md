# SELFHOST-PHASE3-TASK03 完成报告

状态：`DONE`（完全合成、非生产）

日期：2026-07-25（Asia/Shanghai）

## 交付

- 在 Web/API 启动路径之外新增 `tools/selfhost-migration/materializer/`，覆盖 plan、dispatcher、domain materializer、事务、checkpoint、provenance、actual target ID map、reconcile 和安全报告。
- cutover snapshot 物化 Identity、Unit/Category/Material、Customer/Supplier、Product/Version、Supplier Mapping、BOM、Inventory/Finance Opening、合成文件和 Audit；历史活动只作 `ARCHIVE_ONLY` 证据。
- actual ID map 绑定 run/source/mapping/plan/target digest；同 run 可恢复，不同 manifest、非空目标、digest 漂移、target 缺失/变化、文件 mismatch 均 fail closed。
- 新增 post-cutover 全域 Compose 核对脚本，正常 API 跑通采购、生产、销售、IQC/IPQC/FQC 和财务，并校验 Dashboard、角色裁剪和 23 个 legacy GET。

## 验收

30 条合成来源得到 18 个 actual public targets 和 12 个 archive-only 分类；Inventory Opening `112.000000/4.000000`，Finance Opening AR/AP `6.500000/7.250000`。全域旅程后 Dashboard AR/AP 为 `56.500001/27.250000`，4 个 Quality Inspection 关闭，`erp_records` 为 0。

停服 backup/verify 已恢复到第二个新空目标；14 个 migration、关键业务表计数、18 个 map 和 17-byte 文件 SHA 一致。同 manifest 复跑无重复，PostgreSQL/Web/Worker 重启后 Dashboard/API 再次通过。完整适用 unit/UI、PG/API、migration upgrade、专项、typecheck、schema consistency、lint/build/security/environment 和 Python 三项全部通过。

## 版本、数据库与边界

- 包与 migration tool 版本：`0.1.0-alpha.13`。
- PostgreSQL migration：保持 `0001`—`0014`；旧 checksum 不变；未创建 `0015`；`db/schema.ts` 未修改。
- 独立提交消息：`feat: materialize synthetic migration into business tables`；父提交必须为 `8f30798464476b53f435d53022c45ed731804e95`。
- 未读取真实 SQLite/D1、真实备份/上传/附件/归档；未修改 Python 数据库或重启 systemd；未访问生产、部署、push 或创建 PR。

最终结论：`PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`。

生产结论：`NO-GO FOR REAL DATA / PRODUCTION`。
