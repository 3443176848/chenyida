# SELFHOST-PHASE2-TASK07 测试验收

验收日期：2026-07-25（Asia/Shanghai）

状态：`PASS`（非生产隔离环境）

## 1. 专项验收

| 验收面 | 结果 | 说明 |
| --- | --- | --- |
| Unit / UI contract | PASS | Sales 规则/权限 3/3、legacy UI/委托 2/2；稳定 ID、六位 decimal、服务端金额和受保护写边界通过 |
| PostgreSQL / API | PASS | 3/3；报价生命周期、并发转单/编码/发货、部分/全部发货、冲销、精确金额、权限、CSRF、幂等和整体回滚通过 |
| Migration | PASS | 3/3；空库、0010 存量、重复 runner、失败回滚、约束/索引/不可变 guard、旧数据不回填通过 |
| Schema consistency | PASS | Drizzle schema、journal、`0011_snapshot.json` 与 generator 一致；无待生成差异 |
| Compose E2E | PASS | 空库迁移、Quote→Accept→SO→Shipment→Reversal→Shipment；PostgreSQL/Web/Worker 整栈重启后业务、Ledger、金额来源和 Audit 持久 |

## 2. 关键不变量

- Quote Header/Version/Line 使用稳定 Customer/Product/Product Version/Material/Unit ID；只有 DRAFT 内容可替换，已发布版本和状态历史不可改写。
- 只有 ACCEPTED 当前报价版本可原子转换一次；Quote 投影、SO Header/Version/Line、唯一来源 Link、状态事件、审计和幂等共同提交或回滚。
- 金额固定 CNY、PostgreSQL `numeric(24,6)` 服务端计算；不接受客户端总额，不实现税、折扣或汇率。
- Shipment 锁定订单明细与余额版本，禁止超发和负库存；Shipment、SO 投影、TASK04 Ledger/Balance、金额来源、审计和幂等单事务。
- 已过账发货不更新/删除；一次全额冲销追加 reversal Shipment、反向库存和负金额来源，原始金额来源保持不变并建立反向链接。
- 不写 `erp_records`，不自动创建 Material，不创建应收、收款、总账、FQC 或其他品质结论。

## 3. 全量适用回归

| 套件 | 结果 |
| --- | --- |
| Shared unit/UI | PASS，65/65 |
| PostgreSQL/API | PASS，54/54 |
| 历代 migration upgrade | PASS，21/21 |
| Import parser/file inspector/adaptive supplier | PASS，53/53 |
| FileStorage / environment guard | PASS，3/3、6/6 |
| TypeScript typecheck | PASS：Normalization、Review、Procurement、Production、Sales |
| Lint / build | PASS：0 error、1 条起点既有 warning；Vinext 5/5 |
| Credentials scan | PASS，563 个仓库文件 |
| Python/SQLite | PASS：项目虚拟环境 `server.py --self-test`、`smoke_test.py`、临时 SQLite `go_live_check.py --no-backup` |
| `git diff --check` | 提交前 PASS |

## 4. 迁移、环境与资源

- `0011_sales.sql` SHA-256：`6d97c854ecd2fd47f4540c0403de097332f406c7d9f5155c2355dd44d5a57e3b`。
- `0010_production.sql` 仍为 `d60c4100f726d6572a9969c78cf06f64aa2f789d3a31d3be5fd58c22fa7dec35`；`0001`—`0010` checksum 保持不变。
- 首轮系统 Python 的 smoke 在导入阶段因缺少 `openpyxl` 停止；按项目文档改用常驻服务实际使用的 `/opt/erp/.venv/bin/python` 后三项全部通过，没有降低断言。
- 隔离 PostgreSQL、Compose 容器/网络/卷、临时 SQLite 和测试文件均已清理；未访问生产 PostgreSQL/D1/Site/SQLite，未部署、push 或创建 PR。
