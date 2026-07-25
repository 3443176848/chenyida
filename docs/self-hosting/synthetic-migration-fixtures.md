# 自托管迁移合成 Fixture 规格

## 生成规则

Fixture 不跟踪静态数据库或业务导出。每次测试由 `scripts/selfhost-migration-fixture.mjs` 在名称含 `_migration_test` 的操作系统临时目录中即时创建；支持临时 SQLite 与结构化 D1 JSON export。二者使用相同的规范记录契约和 `SYNTHETIC_MIGRATION_TEST_ONLY` 标识。

规范记录只包含 `domain/kind/stable_key/data/relations`。所有关系显式使用 kind + stable key，不允许按名称或数组顺序解析。名称、账号、料号、金额和文件均为 `Synthetic/SYN-*` 虚构值，不复制真实公司、人员、联系方式或样本。

## 数据集

| kind | 目的 | 主要覆盖 |
| --- | --- | --- |
| `valid` | 合成跨域成功路径 | disabled+must-change 管理员计划、Unit/Category、两个 Material、客户/供应商、客户专用 Product、Supplier part mapping、Released BOM、余额/冻结、PO部分收货、WO部分完工、SO部分发货、IQC/IPQC/FQC、稳定来源 AR/AP 部分结算、匹配文件、审计引用 |
| `reviewable` | 可人工处置、不随机匹配 | 同名不同 Material code；保持两个确定 source identity，不按名称合并 |
| `blocked` | fail-closed 汇总 | 未知角色、重复 Material code、orphan BOM、负库存、缺 Unit、未知状态、数量/金额/六位精度、币种、孤立 Finance opening、缺失/错 SHA 文件 |
| `resume` | 中断恢复 | 与 valid 相同，在 executor domain checkpoint 后注入中断 |
| `repeat` | 幂等与摘要失效 | 与 valid 相同，重复 commit 后改变 source/mapping digest |

## 文件与安全

本阶段文件记录只验证 stable ref、字节数和 checksum 状态的核对框架，不迁移真实二进制。`MATCHED/MISSING/MISMATCH` 分别覆盖正常、缺失和摘要错误；任何非 `MATCHED` 在计划阶段阻断。运行报告只输出文件计数、总字节和 checksum 状态计数，不输出路径或正文。
