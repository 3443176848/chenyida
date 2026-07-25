# SELFHOST-PHASE2-TASK10 隔离恢复演练报告

日期：2026-07-25（Asia/Shanghai）
结论：`PASS`，仅代表合成数据和本机隔离环境；不代表生产灾备、跨故障域、容量、RPO 或 RTO 通过。

## 环境与恢复点

- 源：全新命名 Compose、PostgreSQL 17、空卷从 `0001`—`0013` 迁移后运行 TASK02→TASK10 全域合成旅程。
- 一致性窗口：生成备份前停止源 Web 与 Worker，PostgreSQL 保持只读导出可达；脚本显式确认 `WEB_AND_WORKER_STOPPED`。
- 制品：`backup-20260725T065346Z-06a441340386`，应用版本 `0.1.0-alpha.10`；Git 值记录任务起始恢复点，非生产构建提交不作为发布声明。
- 目标：第二个全新命名 Compose project、新网络、新 PostgreSQL volume 和新空文件目录；从未对源数据库原地恢复。
- 工具：`backup-selfhost.sh` → `verify-backup-selfhost.sh` → `restore-selfhost.sh`；浏览器创建/恢复 API 全程禁用。

## 备份与校验

| 组件 | 结果 |
| --- | --- |
| `postgresql.dump` | custom format，737082 bytes，非零，SHA-256/size/`pg_restore --list` 通过 |
| `uploads.tar.gz` | 173 bytes，1 个合成文件，路径/link 检查通过 |
| `attachments.tar.gz` | 176 bytes，1 个合成文件，路径/link 检查通过 |
| `migrations.txt` | 13 行；源码与数据库 `schema_migrations` checksum 逐行一致，head `0013_finance.sql` |
| `manifest.json` | schema 1、status COMPLETE、版本/commit/UTC/tool/database id/大小/SHA/entries 完整；最后写入；目录与组件 mode 0600 |
| 去敏状态 | verifier 原子生成 `VERIFIED`；Web 只读卷读取，不含绝对路径、URL、凭证或正文 |

安全拒绝复核还覆盖：缺少停服确认、production environment/URL、已有输出、损坏 checksum、未知 schema、零字节/缺组件、`../`/绝对 tar 路径、符号/硬链接、非空数据库/目录和第二次原地恢复；失败均未留下成功 manifest。

## 恢复后关系事实核对

恢复脚本先验证全部制品，再确认 public schema 0 表、目标文件目录为空；数据库用单事务 restore，文件先进入 staging 再原子移动。启动恢复目标并重启 PostgreSQL/Web/Worker 后的计数：

| 项目 | 数量 |
| --- | ---: |
| migrations / public tables | 13 / 115 |
| users / audit | 3 / 68 |
| materials / customers / suppliers | 7 / 5 / 3 |
| products / BOM | 4 / 4 |
| inventory ledger | 14 |
| PO / receipts | 2 / 2 |
| WO / issues / reports / completions | 3 / 1 / 1 / 3 |
| quotes / SO / shipments | 1 / 3 / 5 |
| quality inspections | 2 |
| finance documents / settlements | 2 / 3 |
| inventory ledger→material orphan | 0 |

各领域初始旅程已分别断言库存 reconciliation、PO/Receipt、WO 领料/报工/完工、Quote→SO→Shipment、FQC eligibility、AR/AP/Settlement 与审计。恢复后 Dashboard 再次读取全部域，migration head 为 `0013_finance.sql`，合成 failed job 仍为 1；legacy 23 个 GET 再次全部 200，backup governance 显示 `VERIFIED`。

## 文件与重启

合成 uploads SHA-256 为 `f410e32b05efb4a438ca916a0e76849412b820e28a998edb2cd5ccbbd4fc4760`，attachments 为 `d03dc9078670ea715fb97d9644bab2478e62fe7e685d7d1b26445f4388d34698`；恢复目录和 Compose volumes 逐字节一致。PostgreSQL、Web、Worker 整体重启后，健康检查、管理员登录/Session、Dashboard、23 GET、关系事实和文件继续可用。

## 未证明范围

本机临时目录与 Docker volumes 位于同一主机故障域；没有真实数据、真实用户、生产凭证、生产 URL、外部对象存储、加密托管、异地副本、保留轮换、带宽/容量压力、RPO/RTO 计时或真实切换。因此后续生产恢复演练必须另立任务并取得明确授权。
