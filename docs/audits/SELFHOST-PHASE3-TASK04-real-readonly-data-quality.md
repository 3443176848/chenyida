# TASK04 真实只读数据质量聚合报告

## Identity

- 用户 `9`：active `9`、disabled `0`、非法 active flag `0`。
- 9 个固定角色各 `1`；未知角色 `0`；规范化 username 重复组 `0`。
- `pbkdf2_sha256` 格式 `9`；未知 hash 格式 `0`。未输出 username 或 hash。
- Session `1`；创建时间范围为 `2026-07-25 15:13:25` 至同一时间，过期 epoch 范围为 `1785006805` 至同一值。未输出 token 或 username。

## Material / Master / BOM

- Material `9`；缺 code/unit/category 均 `0`；全部为已知启用状态；同名疑似重复 `0`。
- Supplier mapping `4`；orphan material `0`；缺 purchase unit `0`。执行版保守 duplicate group `1`，按映射报告说明仅列入 review，未认定为真实冲突。
- Customer `1`、Supplier `2`、Product `1`、BOM `1`、BOM line `3`。
- 稳定 code 缺失/重复、BOM orphan、未知 Material、Unit 缺失、数量精度异常均 `0`；BOM 状态为已知草稿 `1`。

## Inventory

- Balance `4`；Material/Unit 缺失 `0`；负库存 `0`；冻结大于 on-hand `0`；六位精度异常 `0`。
- on-hand 聚合 `20,010`；frozen/reserved 聚合 `0`。
- Inventory Opening 可规划 `4`，BLOCKED `0`；只生成计划，Opening 创建数 `0`。

## Procurement / Production / Sales / Quality

- Procurement document/line、Production work order/material/report、Sales order/shipment 均为 `0`；数量链、orphan、未知状态均为 `0`。
- IQC/IPQC/FQC 和 defect 均为 `0`；不稳定 legacy source、数量守恒、orphan 均为 `0`。
- 无法安全物化的活动历史为 `0`；这些领域仍按 snapshot/archive/post-cutover 规则治理，不因零记录解除模型与流程要求。

## Finance

- AR/AP document、收付款均为 `0`；金额精度、负金额、金额链、orphan、无稳定来源均为 `0`。
- legacy Schema 不记录 currency，因此 CNY/非 CNY 都不作推断；`currency_not_recorded` 为 `0` 条 document。
- source total、paid、balance、settled/unsettled 和 Finance Opening 均为 `0`；创建数 `0`。

## Files / JSON / redaction

- 数据库文件引用记录 `19`；记录路径 metadata 存在 `19`，格式异常 `0`；记录 checksum 格式存在 `19`、缺失/异常 `0`。
- 实际文件存在性与实际 checksum：`NOT_READ`；文件正文读取数 `0`。
- 所有已知 JSON metadata 字段只统计 `json_valid` 结果，不输出 JSON 正文；没有把自由文本用于 DISTINCT 输出。
- 可提交结果通过绝对源路径、远程 URL、电话模式、凭证赋值和 opaque ref 格式扫描。

结论：聚合层没有行级 BLOCKER。4 条 supplier mapping 继续处于 `NEEDS_BUSINESS_REVIEW`；文件实际存在性、业务冲突和生产可迁移性均未获批准或确认。
