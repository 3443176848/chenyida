# SELFHOST-PHASE3-TASK03 Dashboard 与 API 核对报告

日期：2026-07-25（Asia/Shanghai）

## 核对路径

在 snapshot 完成后启动 Compose Web/Worker，使用正常领域 Service/API 依次运行主数据/BOM、库存、采购收货、生产领退料/报工/完工、报价转单、FQC 门禁与发货、IQC/IPQC 处置关闭、AR/AP、收付款与冲销。迁移工具没有插入这些 post-cutover 单据。

## 结果

| 核对项 | 结果 |
| --- | --- |
| `/api/summary` | `authority=Node/PostgreSQL` |
| `/api/management-dashboard` | 8 个实时指标，来自 public 业务表 |
| `/api/finance-summary` | AR `56.500001`；AP `27.250000`；包含但不重复计算 opening |
| Inventory Opening | `112.000000`；与合成 snapshot 一致 |
| Procurement | 2 个 PO；post-cutover Receipt 与库存/API 事务通过 |
| Production | 3 个 WO；BOM snapshot、领料、报工、完工通过 |
| Sales | 3 个 SO；FQC 额度门禁后 Shipment 通过 |
| Quality | IQC/IPQC/FQC 均存在；4 个 Inspection 为 CLOSED；创建人与处置人分离 |
| Finance | 4 个 Document；正常稳定来源与 `OPENING_AR/AP` 分开核对 |
| 权限裁剪 | quality 角色只获得允许的领域投影 |
| Legacy refresh | 23/23 GET 返回 200 |
| `erp_records` | 0，Dashboard 未读取 staging 伪装业务结果 |

恢复到第二个新空目标并整体重启 PostgreSQL/Web/Worker 后，健康检查、migration head `0014_migration_openings.sql`、Dashboard 8 指标和 23 个 legacy GET 再次通过。合成文件 SHA-256 仍为 `19ae05a8872e4000652f2efe7e9123cfc5e64aa2d69f9afb5511f80e21d66346`。

结论：public 关系表、正常 Service/API 和 Dashboard 在合成 cutover + post-cutover 场景中一致；`PASS FOR SYNTHETIC PUBLIC-TABLE MATERIALIZATION`。生产仍为 `NO-GO FOR REAL DATA / PRODUCTION`。
