# SELFHOST-LANDING-TASK05 PostgreSQL 业务数据重置与 V9 主数据重导入

## 状态与授权

- 状态：`DONE / STAGING ONLY / REVIEW REQUIRED`。
- 日期：2026-07-29（Asia/Shanghai）。
- 授权：项目负责人明确授权仅清除当前 `chenyida-erp-parallel` PostgreSQL 的旧业务测试/导入数据，并导入本次指定的单个只读 XLSX；不授权删除数据库、Schema、Migration、管理员、权限、系统初始化、必要身份审计、合法 Session 或四个 ERP 持久卷。

## 范围

1. 只访问当前 `chenyida-erp-parallel` PostgreSQL；不访问或修改 SQLite、D1、其他服务器或外部数据库。
2. 删除前只读盘点全部业务表，形成保留/清空清单；来源归属无法判定时停止。
3. 先在隔离 staging 数据库解析和验证 XLSX。只有显式 ERP 编码、标准字段、单位及适用的 BOM 产品/版本/数量均无歧义时，记录才可进入主库。
4. 不把“使用次数”、来源描述、名称相似度或原始 BOM 文本猜作单位、BOM 数量、产品版本或物料同一性；歧义行进入仓库外 root-only `needs-review.csv`。
5. 主库清理必须在已验证 custom-format pre-clean 备份之后，以单一受控事务完成；失败整批回滚。
6. 主库导入必须按文件 SHA 与来源行幂等；同一输入重放新增记录为 0。
7. 导入后创建 post-import custom-format 备份并恢复到第二个临时空数据库，核对 Migration/checksum、关键计数、引用和摘要。

## 保留与禁止

- 保留：`schema_migrations`、Schema/约束/索引/触发器、`app_meta`、唯一管理员、角色权限、合法 Session、身份审计和四个 ERP 持久卷。
- 清除范围仅限业务主数据、BOM、项目、采购、库存、生产、品质、销售、财务、导入批次/来源、业务幂等和业务审计。
- 禁止 `DROP DATABASE` 主库、`DROP SCHEMA`、修改/删除 Migration、删除 PostgreSQL Volume、`docker volume prune`、`docker system prune -a`、build、部署、切流、push、PR 或 Python 服务操作。
- 原始 XLSX 只读；不修改、改名、移动、提交或上传。真实逐行报告与数据库 dump 只保存于仓库外 root-only 目录。

## 验收结论

实际结论：`STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`。197 行均缺少显式单位且源表没有产品/BOM 结构，因此只完成隔离 staging 与幂等重放；拟清理事务和主库导入均未执行。完整脱敏结果见 `SELFHOST-LANDING-TASK05-COMPLETION.md`，真实逐行证据只保存在仓库外 root-only 目录。

最终只能使用以下之一：

- `OLD BUSINESS DATA CLEARED AND NEW SPREADSHEET IMPORTED`
- `PARTIAL IMPORT COMPLETED — REVIEW REQUIRED`
- `STAGING COMPLETE — MAIN DATABASE NOT MODIFIED`
- `BLOCKED — NO DELETION OR IMPORT`
