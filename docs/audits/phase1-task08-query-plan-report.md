# PHASE1-TASK08 Material Query Plan Report

日期：2026-07-14

状态：`EVIDENCE_COMPLETE_NO_MIGRATION_AUTHORIZED`

## 1. 范围与安全边界

本报告使用 `chenyida_erp_site/scripts/material-query-plan.mjs` 在全新的、内存中的
Miniflare D1 上应用 `0000` 至 `0003` migration，然后分别生成 1,000、10,000 和
100,000 条合成 `material_master` 记录。脚本只允许 `ERP_ENV=test`，不接受 URL、远程
D1 binding、生产配置或持久化路径；每个规模完成后销毁隔离实例。

数据分布固定为：60% `ACTIVE`、20% `DRAFT`、20% `PENDING_REVIEW`。每个场景先执行
`EXPLAIN QUERY PLAN`，再预热并采样 7 次，每次最多返回 20 行。以下耗时是本机
Miniflare/D1 的端到端采样，只用于相对趋势和候选识别，不是生产容量承诺。

复现命令：

```powershell
$env:ERP_ENV='test'
npm.cmd run test:material-query-plan
```

## 2. 现有索引基线

三个规模的 `material_master` 索引一致：

- `material_master_internal_code_uq`
- `material_master_candidate_idx`
- `material_master_status_updated_idx`
- `material_master_category_status_idx`
- `material_master_review_queue_idx`
- `material_master_review_category_idx`
- `material_master_review_source_idx`
- `material_master_review_creator_idx`
- `material_master_standard_name_idx`

本任务没有创建、修改或删除索引，也没有创建 migration。

## 3. 查询计划

三个数据规模的计划形态一致：

| 场景 | `EXPLAIN QUERY PLAN` 结果 |
| --- | --- |
| 正式物料默认列表 | `SEARCH ... material_master_status_updated_idx (material_status=?)`; `USE TEMP B-TREE FOR ORDER BY` |
| 创建人行级可见范围 | `SCAN m`; `USE TEMP B-TREE FOR ORDER BY` |
| 创建人行级可见范围 count | `SCAN ... material_master_review_creator_idx` |
| edit-any 全生命周期范围 | `SCAN ... material_master_status_updated_idx`; `USE TEMP B-TREE FOR ORDER BY` |
| edit-any 全生命周期 count | `SCAN ... material_master_category_status_idx` |
| 审核队列待审范围 | `SEARCH ... material_master_review_category_idx (material_status=?)`; `USE TEMP B-TREE FOR ORDER BY` |
| 分类 + ACTIVE | `SEARCH ... material_master_status_updated_idx (material_status=?)` |
| 来源 + ACTIVE | `SEARCH ... material_master_status_updated_idx (material_status=?)` |
| 创建人 + DRAFT | `SEARCH ... material_master_review_creator_idx (material_status=? AND created_by=?)`; `USE TEMP B-TREE FOR ORDER BY` |
| keyword 字面包含 | `SEARCH ... material_master_status_updated_idx (material_status=?)`；领先 `%` 不能使用普通 B-tree 完成文本定位 |

`PENDING_APPROVAL` 仍按已批准的双读兼容规则包含在待审谓词中。本任务禁止收缩该状态，
因此没有为了获得更简单的单状态计划而改变兼容语义。

## 4. 规模测试结果

以下为 7 次采样的中位数 / 样本最大值（毫秒）：

| 场景 | 1k | 10k | 100k |
| --- | ---: | ---: | ---: |
| 正式物料默认列表 | 12.442 / 13.968 | 12.778 / 14.550 | 12.289 / 13.483 |
| 创建人行级可见范围 | 13.446 / 15.063 | 18.756 / 20.505 | 69.401 / 71.828 |
| 创建人行级可见范围 count | 13.093 / 13.610 | 13.462 / 14.828 | 33.789 / 33.897 |
| edit-any 全生命周期范围 | 12.865 / 13.540 | 16.417 / 17.929 | 66.747 / 67.973 |
| edit-any 全生命周期 count | 13.605 / 15.445 | 13.343 / 15.426 | 31.251 / 33.049 |
| 审核队列待审范围 | 12.886 / 14.253 | 12.535 / 14.481 | 22.034 / 23.687 |
| 分类 + ACTIVE | 12.069 / 13.976 | 11.937 / 13.835 | 11.274 / 13.338 |
| 来源 + ACTIVE | 11.853 / 12.836 | 11.722 / 13.155 | 11.629 / 12.316 |
| 创建人 + DRAFT | 12.200 / 13.784 | 12.643 / 14.971 | 17.502 / 19.895 |
| keyword 字面包含 | 12.027 / 13.690 | 14.698 / 18.631 | 16.671 / 19.488 |

所有场景在每次采样中最多返回 20 行。1k keyword 场景因合成文本命中数只有 6 而返回
6 行，其余列出的采样返回 20 行。

## 5. 候选优化与审批结论

发现候选优化点，但没有足够授权创建索引：

1. 创建人可见范围的多状态 `OR` 谓词在 100k 出现全表扫描。后续应先比较等价的
   `UNION ALL`/分支合并查询与候选复合索引，再决定是否需要
   `(material_status, created_by, updated_at, id)` 一类索引。
2. edit-any 的全生命周期多状态排序和正式物料多状态排序使用临时 B-tree。后续应先验证
   分状态有序合并能否复用现有 `material_master_status_updated_idx`，避免仅为 `IN` 排序
   盲目增加重复索引。
3. `DRAFT + created_by + created_at` 当前复用以 `submitted_at` 为后缀的审核索引并产生
   临时排序；候选为 `(material_status, created_by, created_at, id)`，但只有在真实草稿规模
   与频率证明确有收益后才应审批。
4. leading-wildcard keyword 不适合普通 B-tree。若真实规模下成为瓶颈，应另行设计受控的
   搜索/FTS 方案；本任务不引入搜索表、FTS migration 或候选匹配逻辑。

结论：**发现候选索引/查询改写方向，但未创建 migration。** 在新的人工审批前，数据库
schema 和索引基线保持 `0003` 不变。
