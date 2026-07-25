# TASK04 本机 SQLite Schema fingerprint 报告

执行日期：2026-07-25（Asia/Shanghai）

## 安全来源与快照

- source path digest：`0e90fe787e17c5dc8195543be4795b455b209498d7774b5f47bf45a0f7656752`
- 一致性快照 SHA-256：`580ca44d803eccf16038925a9aab6c35d53613ced27aada54f3a1f9d82800105`
- Schema fingerprint：`29b846f021e50b9234181e80da3bafd474033ff1a3e86f656c2acf159d38dee8`
- SQLite `3.42.0`；page size `4096`；page count `377`；快照大小 `1,544,192` bytes。
- `PRAGMA integrity_check` 严格返回 `ok`。
- 实际表数 `29`；Python `create_schema` + `0001`—`0004` 的期望表数 `29`；运行结果没有未知表，`MODEL_GAP` 表记录为 `0`。
- `local_schema_migrations` 期望 `4` 个版本。实际 Schema fingerprint 已绑定完整 `sqlite_master` table/index/trigger/view 元数据。

## 一致性与运行面保护

- 源连接使用 `mode=ro` 和连接级 `query_only=ON`，通过 SQLite online backup 读取；未执行写事务、DDL、VACUUM、checkpoint 或持久 PRAGMA。
- Python PID 前后均为 `277640`。
- 源 inode、mode 和权限在快照前后相同，权限保持 `0600`。
- 快照仅存在于权限 `0700` 的任务临时目录，文件权限 `0600`；执行结束后临时目录已删除且不可恢复。
- 报告未保存绝对源路径、Schema SQL 正文、业务行或 source ID。

## 表域登记

实际 29 张表均在静态 mapping registry 中登记：Identity 2、Material/Import 5、Party/Product/BOM 6、Inventory 3、Procurement 2、Production 3、Sales 3、Quality 2、Finance 2、Audit 1。全部列名、SQLite 类型、PK、unique/index 和声明 FK 已在临时报告中核对；临时明细报告通过脱敏扫描后随快照销毁，可提交证据只保留 fingerprint 和聚合结论。

结论：`SOURCE SCHEMA FINGERPRINT COMPLETE`。这不是 PostgreSQL Schema 兼容或生产迁移批准。
