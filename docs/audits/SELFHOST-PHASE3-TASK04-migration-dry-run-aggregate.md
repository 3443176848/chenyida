# TASK04 无目标迁移 Dry-run 聚合报告

## 绑定

- 模式：`REAL_READONLY_INVENTORY`
- source Schema fingerprint：`29b846f021e50b9234181e80da3bafd474033ff1a3e86f656c2acf159d38dee8`
- source snapshot SHA-256：`580ca44d803eccf16038925a9aab6c35d53613ced27aada54f3a1f9d82800105`
- mapping registry digest：`2bd2d8349f7c2561fcd8e5eaad133a28187d25f5ba7ada132ecc81b4e8554cc0`
- Git commit：`a541360eefe12869c090b2408bbcf07485fc77cb`
- tool/application version：`0.1.0-alpha.14`
- target connection：`NONE`；materialization：`DISABLED`；file body read：`DISABLED`。

## 规划结果

| Metric | Count / aggregate |
|---|---:|
| total records | 3,619 |
| planned | 49 |
| archive-only | 3,566 |
| needs review | 4 |
| blocked unique records | 0 |
| model gap | 0 |
| orphan | 0 |
| conservative duplicate groups | 1 |
| invalid status / quantity / amount / unit | 0 / 0 / 0 / 0 |
| identity issues | 0 |
| file metadata issues | 0 |
| manual opaque dispositions | 0 |

Inventory Opening plan 为 `4` 条、on-hand `20,010`、frozen `0`、created `0`。Finance Opening plan 为 `0` 条，source/paid/balance 均为 `0`、created `0`。Procurement、Production、Sales、Quality 和 Finance dependency blocking 都为 `0`。

执行版结果为 `AGGREGATE_INVENTORY_COMPLETE`。其中 conservative duplicate `1` 的空料号分组问题已在代码审阅中收紧，未把它解释为真实冲突，也未重读源库。

## 明确未执行

没有创建 target ID、staging、public 业务行、正式编码、用户、Inventory/Finance Opening、文件复制、自动修复或重复合并。没有加载 PostgreSQL driver target adapter 的连接路径，没有目标 URL，也没有远程网络。

结论只表示本机快照的脱敏聚合 planner 已运行；不表示真实迁移已通过。
