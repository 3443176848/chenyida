# 晨亿达 ERP 跨岗位 UAT 证据与签字合同 v1

> 状态：`BLOCKED / SYNTHETIC CONTRACT ONLY / NOT AUTHORIZED TO EXECUTE`。本文件不授权登录、UAT写入、真实数据、迁移、部署、生产切换或恢复。

## 1. 权威绑定与当前判定

- 制品合同：`chenyida-erp-cross-role-uat-evidence-contract/v1`
- 制品 SHA-256：`7e07b6274276e1b0f06c98d8ca311a7693fa827fbf0d6db9eaa6104d9d467f94`
- TASK66 权限矩阵 artifact：`741bb74249fe9a88468a70c6d1f05b18cf6989ea7a6a7d10dd38b0b7ceb29a34`
- TASK66 权限源码 manifest：`2c4870ca99fc93627f487962182a00c0a530bcdc6df7db8750c4db10af1a1863`
- UAT证据源码 manifest：`a79005537170e95854598908f75c044dbe58bd5578585da75429ca9e523d70fc`
- release test inventory：`eb8f42092119fec85e78192a743bf7b2f29276ac53f80b6d9671d6193dbdd464`（257项）
- 判定：`BLOCKED`；该制品只定义合成执行与证据合同，不授权登录、写入、迁移、部署或生产操作。

### 未解除阻塞项

- `BUSINESS_ROLE_MATRIX_APPROVAL_PENDING`
- `UAT_ACCOUNT_MAPPING_APPROVAL_PENDING`
- `UAT_WRITE_SCOPE_AND_WINDOW_NOT_AUTHORIZED`
- `STOP_AND_ROLLBACK_OWNERS_NOT_ASSIGNED`
- `EXECUTOR_OBSERVER_BUSINESS_SIGNOFF_EMPTY`
- `HUMAN_CROSS_ROLE_UAT_NOT_EXECUTED`

## 2. 事前授权门禁（当前必须全部为空）

| 字段 | 当前值 |
| --- | --- |
| `business_role_matrix_approval_id` | `NULL / BLOCKED` |
| `uat_account_mapping_approval_id` | `NULL / BLOCKED` |
| `allowed_write_scope` | `NULL / BLOCKED` |
| `execution_window_start` | `NULL / BLOCKED` |
| `execution_window_end` | `NULL / BLOCKED` |
| `stop_authority_person` | `NULL / BLOCKED` |
| `rollback_owner_person` | `NULL / BLOCKED` |

任何字段为空、部署身份不一致或签字未闭合时不得执行。后续填写必须来自项目负责人专项授权及独立受控证据包，不能直接修改此canonical模板来伪造READY。

## 3. 合成数据与人员槽位

固定fixture：`UAT67-SYNTHETIC-V1`，数量 `10.000000`（两批 `4.000000` + `6.000000`），币种 `CNY`。

| 槽位 | 服务端角色 | 人员 | UAT账号 |
| --- | --- | --- | --- |
| `purchase_executor` | `purchase` | 未指定 | 未指定 |
| `warehouse_executor` | `warehouse` | 未指定 | 未指定 |
| `quality_inspector` | `quality` | 未指定 | 未指定 |
| `quality_dispositioner` | `quality` | 未指定 | 未指定 |
| `production_executor` | `production` | 未指定 | 未指定 |
| `sales_executor` | `sales` | 未指定 | 未指定 |
| `finance_executor` | `finance` | 未指定 | 未指定 |
| `operations_observer` | `operations` | 未指定 | 未指定 |
| `business_acceptor` | `manager` | 未指定 | 未指定 |
| `rollback_owner` | `operations` | 未指定 | 未指定 |

职责分离：

- `quality_inspector` ≠ `quality_dispositioner`：检验创建人与处置人必须分离
- `operations_observer` ≠ `business_acceptor`：技术观察人与业务验收人必须分离
- `operations_observer` ≠ `rollback_owner`：观察与回退执行责任必须分离
- `business_acceptor` ≠ `rollback_owner`：业务放行与回退责任必须分离

## 4. 通用证据合同

每个写步骤都必须保存以下非敏感证据；不得保存Authorization、Cookie、Set-Cookie、CSRF正文、密码或Session正文。

- 事前批准包编号、执行人员槽位与已核验账号映射。
- method/path、净化后的请求body、Origin存在性、X-Request-ID、Idempotency-Key摘要及CSRF验证结果。
- HTTP status、响应X-Request-ID、body.request_id、响应body SHA-256；重放时额外核对Idempotency-Replayed=true。
- 步骤前后关系计数、指定投影数量/金额/版本、业务Event、audit_log与idempotency_keys摘要。
- 失败用例必须证明所有相关业务表、Event、Audit和Idempotency均为零半记录。

## 5. 采购转单→收货/IQC→库存/AP（`PROCURE_RECEIVE_IQC_AP`）

前置条件：

- 合成Award已获选且预览可转换
- 合成物料、Supplier、Quote、库存位置和单位均有效
- Receipt/IQC/Ledger/AP起始计数已取证

### P01 采购执行人按预览确认值转换Award为PO

- 执行槽位/角色：`purchase_executor` / `purchase`；越权探针：`warehouse`。
- API：`POST /api/procurement/awards/{award_id}/purchase-orders`；矩阵操作：`fulfillment.convert`；permission：`procurement.award.convert`.
- 成功HTTP：`201`；CAS：`expected_award_version`、`expected_quote_version`、`expected_snapshot_digest`.
- 净化请求模板：

```json
{
  "expected_award_version": "$ref.conversion_preview.confirmation.expected_award_version",
  "expected_quote_version": "$ref.conversion_preview.confirmation.expected_quote_version",
  "expected_snapshot_digest": "$ref.conversion_preview.confirmation.expected_snapshot_digest",
  "remark": "UAT67合成采购转单"
}
```

- 预期数据库增量：

  - `purchase_orders`：`+1`；source_type=SOURCING_AWARD
  - `purchase_delivery_plans`：`+N`；逐PO Line建立计划
  - `audit_log`：`+1`；action=SOURCING_AWARD_CONVERTED且request_id一致

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P01-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p01-{attempt}`（实际证据只保存必要值/摘要）。

### P02 仓库执行人按收货预览确认值登记合成收货

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`purchase`。
- API：`POST /api/procurement/delivery-plans/{delivery_plan_id}/receipts`；矩阵操作：`fulfillment.receive`；permission：`procurement.receiving.receive`.
- 成功HTTP：`201`；CAS：`expected_version`、`expected_purchase_order_line_version`、`expected_balance_version`.
- 净化请求模板：

```json
{
  "quantity": "10.000000",
  "expected_version": "$ref.receipt_preview.confirmation.expected_version",
  "expected_purchase_order_line_version": "$ref.receipt_preview.confirmation.expected_purchase_order_line_version",
  "expected_balance_version": "$ref.receipt_preview.confirmation.expected_balance_version",
  "evidence_document_date": "$ref.execution_date",
  "supplier_lot": "UAT67-SUPPLIER-LOT-001",
  "reason": "UAT67合成收货"
}
```

- 预期数据库增量：

  - `purchase_receipts`：`+1`；NORMAL收货事实
  - `inventory_adjustments,inventory_ledger_entries,inventory_lots`：`+1 each`；库存冻结并保留supplier lot谱系
  - `purchase_financial_source_entries`：`+1`；AP来源金额来自收货事实

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P02-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p02-{attempt}`（实际证据只保存必要值/摘要）。

### P03 品质检验人创建IQC

- 执行槽位/角色：`quality_inspector` / `quality`；越权探针：`sales`。
- API：`POST /api/quality-inspections`；矩阵操作：`quality.inspect`；permission：`quality.inspect`.
- 成功HTTP：`201`；CAS：无显式版本字段，但仍受唯一性/来源锁约束.
- 净化请求模板：

```json
{
  "inspection_type": "IQC",
  "purchase_receipt_line_id": "$ref.P02.purchase_receipt_line_id",
  "inspected_qty": "10.000000",
  "passed_qty": "10.000000",
  "failed_qty": "0.000000",
  "responsible_stage": "IQC",
  "results": [
    {
      "characteristic": "UAT67综合检验",
      "result": "PASS"
    }
  ]
}
```

- 预期数据库增量：

  - `quality_inspections`：`+1`；OPEN/PENDING IQC
  - `quality_inspection_events`：`+1`；CREATED且request_id一致

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P03-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p03-{attempt}`（实际证据只保存必要值/摘要）。

### P04 独立品质处置人放行IQC

- 执行槽位/角色：`quality_dispositioner` / `quality`；越权探针：`purchase`。
- API：`POST /api/quality-inspections/{iqc_inspection_id}/dispositions`；矩阵操作：`quality.disposition`；permission：`quality.disposition`.
- 成功HTTP：`200`；CAS：`expected_version`、`expected_lot_version`、`expected_balance_version`.
- 净化请求模板：

```json
{
  "expected_version": 1,
  "disposition_code": "RELEASE",
  "release_qty": "10.000000",
  "expected_lot_version": "$ref.P02.inventory_lot_version",
  "expected_balance_version": "$ref.P02.inventory_balance_version",
  "reason": "UAT67 IQC独立放行"
}
```

- 预期数据库增量：

  - `quality_inspection_events`：`+1`；DISPOSITIONED
  - `inventory_stock_balances`：`frozen_qty -10`；可用量增加且版本+1

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P04-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p04-{attempt}`（实际证据只保存必要值/摘要）。

### P05 品质检验人关闭已处置IQC

- 执行槽位/角色：`quality_inspector` / `quality`；越权探针：`warehouse`。
- API：`POST /api/quality-inspections/{iqc_inspection_id}/close`；矩阵操作：`quality.close`；permission：`quality.close`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": 2,
  "reason": "UAT67 IQC关闭"
}
```

- 预期数据库增量：

  - `quality_inspection_events`：`+1`；CLOSED
  - `quality_inspections`：`version +1`；lifecycle_status=CLOSED

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P05-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p05-{attempt}`（实际证据只保存必要值/摘要）。

### P06 财务执行人从收货来源生成AP

- 执行槽位/角色：`finance_executor` / `finance`；越权探针：`purchase`。
- API：`POST /api/finance/documents`；矩阵操作：`finance.post-document`；permission：`finance.post`.
- 成功HTTP：`201`；CAS：无显式版本字段，但仍受唯一性/来源锁约束.
- 净化请求模板：

```json
{
  "doc_type": "AP",
  "purchase_source_entry_id": "$ref.P02.purchase_financial_source_entry_id",
  "accounting_date": "$ref.execution_date"
}
```

- 预期数据库增量：

  - `finance_documents`：`+1`；AP金额和币种精确继承收货来源
  - `finance_document_events`：`+1`；CREATED

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P06-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p06-{attempt}`（实际证据只保存必要值/摘要）。

### P07 隔离检查点冲销收货（必须在IQC/AP前单独执行）

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`purchase`。
- API：`POST /api/procurement/fulfillment/receipts/{receipt_id}/reversal`；矩阵操作：`fulfillment.reverse`；permission：`procurement.receiving.reverse`.
- 成功HTTP：`201`；CAS：`expected_plan_version`、`expected_line_versions`、`expected_balance_versions`、`expected_lot_version`.
- 隔离分支：`AFTER_P02_BEFORE_P03_P06`；不得和主链下游在同一fixture上连续执行。
- 净化请求模板：

```json
{
  "reason": "UAT67合成收货回退演练",
  "expected_plan_version": "$ref.P02.delivery_plan_version",
  "expected_line_versions": "$ref.P02.line_versions",
  "expected_balance_versions": "$ref.P02.balance_versions",
  "expected_lot_version": "$ref.P02.inventory_lot_version"
}
```

- 预期数据库增量：

  - `purchase_receipts`：`+1 REVERSAL`；原收货行不删除不覆盖
  - `inventory_adjustments,inventory_ledger_entries`：`+1 reversal each`；数量反向且保留原事实
  - `purchase_receipt_events`：`+1`；REVERSED

- 请求证据：`X-Request-ID=UAT67-PROCURE_RECEIVE_IQC_AP-P07-{uuid}`；`Idempotency-Key=uat67-procure_receive_iqc_ap-p07-{attempt}`（实际证据只保存必要值/摘要）。

### PROCURE_RECEIVE_IQC_AP 异常、原子性与冲销门禁

| 控制 | 目标步骤 | 必须观察到 |
| --- | --- | --- |
| `UNAUTHORIZED_403` | `P02` | purchase角色返回403且所有业务表delta=0 |
| `CSRF_403` | `P02` | 缺失或错误CSRF返回403且delta=0 |
| `IDEMPOTENCY_REPLAY` | `P02` | 同Key同正文返回原结果且Idempotency-Replayed=true |
| `IDEMPOTENCY_CONFLICT` | `P02` | 同Key异正文返回IDEMPOTENCY_CONFLICT且delta=0 |
| `CAS_CONFLICT` | `P02` | 陈旧版本返回DELIVERY_PLAN_VERSION_OR_STATE_CONFLICT且delta=0 |
| `ATOMIC_FAILURE_ZERO_HALF_RECORD` | `P02` | 故障注入证据证明receipt/allocation/ledger/audit/idempotency均无半记录 |
| `APPEND_ONLY_REVERSAL` | `P07` | 只新增REVERSAL事实；IQC或AP已存在时阻塞并保留证据 |
| `AUDIT_REQUEST_ID` | `ALL_STEPS` | 响应头、正文、业务行、事件、Audit使用同一request ID |

### 三方签字（当前为空，不能视为验收）

- 执行人槽位：`purchase_executor`、`warehouse_executor`、`quality_inspector`、`quality_dispositioner`、`finance_executor`；签字时间：`NULL`。
- 技术观察人：`operations_observer`；签字时间：`NULL`。
- 业务验收人：`business_acceptor`；接受时间：`NULL`；结果：`NULL`。

## 6. 生产领退料→工序/IPQC→正式报工/完工（`PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE`）

前置条件：

- 合成工单已Release并绑定已发布BOM与Routing快照
- 原料库存及CAS版本已取证
- 末工序启用IPQC gate

### M01 仓库领料

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`production`。
- API：`POST /api/production/material-issues`；矩阵操作：`production.issue`；permission：`production.issue`.
- 成功HTTP：`201`；CAS：`lines[].expected_requirement_version`、`lines[].expected_balance_version`.
- 净化请求模板：

```json
{
  "work_order_id": "$ref.work_order_id",
  "reason": "UAT67合成领料",
  "lines": [
    {
      "requirement_id": "$ref.requirement_id",
      "quantity": "10.000000",
      "expected_requirement_version": "$ref.requirement_version",
      "expected_balance_version": "$ref.raw_balance_version"
    }
  ]
}
```

- 预期数据库增量：

  - `production_material_issues,production_material_issue_lines`：`+1`；领料事实
  - `inventory_ledger_entries`：`+1`；原料出库

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M01-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m01-{attempt}`（实际证据只保存必要值/摘要）。

### M02 隔离分支仓库退料

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`production`。
- API：`POST /api/production/material-returns`；矩阵操作：`production.issue`；permission：`production.issue`.
- 成功HTTP：`201`；CAS：`lines[].expected_requirement_version`、`lines[].expected_balance_version`.
- 隔离分支：`AFTER_M01_BEFORE_M03`；不得和主链下游在同一fixture上连续执行。
- 净化请求模板：

```json
{
  "work_order_id": "$ref.work_order_id",
  "reason": "UAT67合成退料",
  "lines": [
    {
      "requirement_id": "$ref.requirement_id",
      "quantity": "4.000000",
      "expected_requirement_version": "$ref.after_M01.requirement_version",
      "expected_balance_version": "$ref.after_M01.balance_version"
    }
  ]
}
```

- 预期数据库增量：

  - `production_material_returns,production_material_return_lines`：`+1`；退料为新增事实
  - `inventory_ledger_entries`：`+1`；原料反向入库

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M02-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m02-{attempt}`（实际证据只保存必要值/摘要）。

### M03 生产派工

- 执行槽位/角色：`production_executor` / `production`；越权探针：`sales`。
- API：`POST /api/production/operation-execution/dispatch`；矩阵操作：`operation.dispatch`；permission：`production.dispatch`.
- 成功HTTP：`201`；CAS：`expected_operation_version`.
- 净化请求模板：

```json
{
  "snapshot_operation_id": "$ref.snapshot_operation_id",
  "quantity": "10.000000",
  "assigned_operator": "$ref.production_executor.account_username",
  "expected_operation_version": "$ref.operation_version"
}
```

- 预期数据库增量：

  - `production_operation_runs`：`+1`；READY派工批次
  - `production_operation_run_events`：`+1`；DISPATCHED

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M03-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m03-{attempt}`（实际证据只保存必要值/摘要）。

### M04 生产开工

- 执行槽位/角色：`production_executor` / `production`；越权探针：`warehouse`。
- API：`POST /api/production/operation-runs/{operation_run_id}/start`；矩阵操作：`operation.execute`；permission：`production.execute`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": "$ref.M03.run_version"
}
```

- 预期数据库增量：

  - `production_operation_run_events`：`+1`；STARTED
  - `production_operation_runs`：`version +1`；IN_PROGRESS

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M04-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m04-{attempt}`（实际证据只保存必要值/摘要）。

### M05 生产工序报工

- 执行槽位/角色：`production_executor` / `production`；越权探针：`warehouse`。
- API：`POST /api/production/operation-runs/{operation_run_id}/reports`；矩阵操作：`operation.execute`；permission：`production.execute`.
- 成功HTTP：`201`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": "$ref.M04.run_version",
  "processed_qty": "10.000000",
  "good_qty": "10.000000",
  "scrap_qty": "0.000000",
  "remark": "UAT67合成工序报工"
}
```

- 预期数据库增量：

  - `production_operation_run_reports`：`+1`；正式工序报工事实
  - `production_operation_run_events`：`+1`；REPORTED

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M05-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m05-{attempt}`（实际证据只保存必要值/摘要）。

### M06 品质检验人创建IPQC

- 执行槽位/角色：`quality_inspector` / `quality`；越权探针：`production`。
- API：`POST /api/quality-inspections`；矩阵操作：`quality.inspect`；permission：`quality.inspect`.
- 成功HTTP：`201`；CAS：无显式版本字段，但仍受唯一性/来源锁约束.
- 净化请求模板：

```json
{
  "inspection_type": "IPQC",
  "production_operation_run_report_id": "$ref.M05.operation_run_report_id",
  "inspected_qty": "10.000000",
  "passed_qty": "10.000000",
  "failed_qty": "0.000000",
  "results": [
    {
      "characteristic": "UAT67工序质量",
      "result": "PASS"
    }
  ]
}
```

- 预期数据库增量：

  - `quality_inspections`：`+1`；IPQC OPEN/PENDING
  - `quality_inspection_events`：`+1`；CREATED

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M06-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m06-{attempt}`（实际证据只保存必要值/摘要）。

### M07 独立品质处置人放行IPQC

- 执行槽位/角色：`quality_dispositioner` / `quality`；越权探针：`production`。
- API：`POST /api/quality-inspections/{ipqc_inspection_id}/dispositions`；矩阵操作：`quality.disposition`；permission：`quality.disposition`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": 1,
  "disposition_code": "RELEASE",
  "release_qty": "10.000000",
  "reason": "UAT67 IPQC独立放行"
}
```

- 预期数据库增量：

  - `quality_inspection_events`：`+1`；DISPOSITIONED
  - `production_operation_quality_projections`：`projection refresh`；末工序输出可正式报工

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M07-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m07-{attempt}`（实际证据只保存必要值/摘要）。

### M08 品质关闭IPQC

- 执行槽位/角色：`quality_inspector` / `quality`；越权探针：`warehouse`。
- API：`POST /api/quality-inspections/{ipqc_inspection_id}/close`；矩阵操作：`quality.close`；permission：`quality.close`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": 2,
  "reason": "UAT67 IPQC关闭"
}
```

- 预期数据库增量：

  - `quality_inspection_events`：`+1`；CLOSED

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M08-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m08-{attempt}`（实际证据只保存必要值/摘要）。

### M09 生产从末工序输出创建正式报工

- 执行槽位/角色：`production_executor` / `production`；越权探针：`warehouse`。
- API：`POST /api/production/reports`；矩阵操作：`production.report`；permission：`production.report`.
- 成功HTTP：`201`；CAS：`expected_work_order_version`、`expected_final_output_version`.
- 净化请求模板：

```json
{
  "work_order_id": "$ref.work_order_id",
  "expected_work_order_version": "$ref.work_order_version",
  "expected_final_output_version": "$ref.final_output_version",
  "final_output_allocations": [
    {
      "operation_run_report_id": "$ref.M05.operation_run_report_id",
      "quantity": "10.000000"
    }
  ],
  "reported_qty": "10.000000",
  "good_qty": "10.000000",
  "scrap_qty": "0.000000",
  "process_stage": "UAT67末工序"
}
```

- 预期数据库增量：

  - `production_reports,production_final_output_allocations`：`+1`；来源绑定末工序报工
  - `production_report_events`：`+1`；CREATED

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M09-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m09-{attempt}`（实际证据只保存必要值/摘要）。

### M10 仓库按正式报工完工入库

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`production`。
- API：`POST /api/production/completions`；矩阵操作：`production.complete`；permission：`production.complete`.
- 成功HTTP：`201`；CAS：`expected_version`、`expected_balance_version`、`allocations[].expected_report_version`.
- 净化请求模板：

```json
{
  "work_order_id": "$ref.work_order_id",
  "expected_version": "$ref.after_M09.work_order_version",
  "expected_balance_version": "$ref.finished_balance_version",
  "reason": "UAT67合成完工",
  "allocations": [
    {
      "report_id": "$ref.M09.production_report_id",
      "quantity": "10.000000",
      "expected_report_version": "$ref.M09.report_version"
    }
  ]
}
```

- 预期数据库增量：

  - `production_completions,production_completion_lines`：`+1`；完工事实
  - `inventory_adjustments,inventory_ledger_entries`：`+1`；成品入库

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M10-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m10-{attempt}`（实际证据只保存必要值/摘要）。

### M11 隔离检查点冲销完工（必须在FQC/销售下游前）

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`production`。
- API：`POST /api/production/completions/{completion_id}/reverse`；矩阵操作：`production.complete-reverse`；permission：`production.complete.reverse`.
- 成功HTTP：`201`；CAS：`expected_completion_version`、`expected_work_order_version`、`expected_balance_versions`.
- 隔离分支：`AFTER_M10_BEFORE_FQC_SALES`；不得和主链下游在同一fixture上连续执行。
- 净化请求模板：

```json
{
  "expected_completion_version": "$ref.M10.completion_version",
  "expected_work_order_version": "$ref.M10.work_order_version",
  "expected_balance_versions": "$ref.M10.balance_versions",
  "reason": "UAT67合成完工冲销"
}
```

- 预期数据库增量：

  - `production_completion_reversals`：`+1`；原完工不删除不改写
  - `inventory_adjustments,inventory_ledger_entries`：`+1 reversal each`；成品库存反向
  - `production_completion_events`：`+1`；REVERSED

- 请求证据：`X-Request-ID=UAT67-PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE-M11-{uuid}`；`Idempotency-Key=uat67-production_issue_return_ipqc_complete-m11-{attempt}`（实际证据只保存必要值/摘要）。

### PRODUCTION_ISSUE_RETURN_IPQC_COMPLETE 异常、原子性与冲销门禁

| 控制 | 目标步骤 | 必须观察到 |
| --- | --- | --- |
| `UNAUTHORIZED_403` | `M03` | sales角色返回403且delta=0 |
| `CSRF_403` | `M03` | 错误CSRF返回403且delta=0 |
| `IDEMPOTENCY_REPLAY` | `M03` | 同Key同正文重放原派工 |
| `IDEMPOTENCY_CONFLICT` | `M03` | 同Key异正文返回IDEMPOTENCY_CONFLICT |
| `CAS_CONFLICT` | `M03` | 陈旧expected_operation_version返回版本冲突且delta=0 |
| `ATOMIC_FAILURE_ZERO_HALF_RECORD` | `M10` | 故障注入证明生产、库存、ledger、audit、idempotency均无半记录 |
| `APPEND_ONLY_REVERSAL` | `M11` | 只新增冲销事实；存在FQC/发货下游时停止并保留 |
| `AUDIT_REQUEST_ID` | `ALL_STEPS` | 跨领料、工序、品质、报工、完工的request ID闭合 |

### 三方签字（当前为空，不能视为验收）

- 执行人槽位：`warehouse_executor`、`production_executor`、`quality_inspector`、`quality_dispositioner`；签字时间：`NULL`。
- 技术观察人：`operations_observer`；签字时间：`NULL`。
- 业务验收人：`business_acceptor`；接受时间：`NULL`；结果：`NULL`。

## 7. 销售分配→FQC→出货/AR（`SALES_FQC_SHIPMENT_AR`）

前置条件：

- 合成销售订单已确认
- 合成完工行有可分配数量
- 成品库存、订单行、完工行CAS版本已取证

### S01 销售分配完工成品到订单行

- 执行槽位/角色：`sales_executor` / `sales`；越权探针：`quality`。
- API：`POST /api/quality/finished-goods-allocations`；矩阵操作：`quality.allocation-create`；permission：`quality.finished_goods_allocation.create`.
- 成功HTTP：`201`；CAS：`expected_completion_version`、`expected_sales_order_line_version`.
- 净化请求模板：

```json
{
  "completion_line_id": "$ref.completion_line_id",
  "sales_order_line_id": "$ref.sales_order_line_id",
  "quantity": "10.000000",
  "expected_completion_version": "$ref.completion_line_version",
  "expected_sales_order_line_version": "$ref.sales_order_line_version"
}
```

- 预期数据库增量：

  - `finished_goods_allocations`：`+1`；ACTIVE分配

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S01-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s01-{attempt}`（实际证据只保存必要值/摘要）。

### S02 品质检验人创建FQC

- 执行槽位/角色：`quality_inspector` / `quality`；越权探针：`sales`。
- API：`POST /api/quality-inspections`；矩阵操作：`quality.inspect`；permission：`quality.inspect`.
- 成功HTTP：`201`；CAS：无显式版本字段，但仍受唯一性/来源锁约束.
- 净化请求模板：

```json
{
  "inspection_type": "FQC",
  "allocation_id": "$ref.S01.allocation_id",
  "inspected_qty": "10.000000",
  "passed_qty": "10.000000",
  "failed_qty": "0.000000",
  "results": [
    {
      "characteristic": "UAT67出货质量",
      "result": "PASS"
    }
  ]
}
```

- 预期数据库增量：

  - `quality_inspections,quality_inspection_events`：`+1 each`；FQC OPEN/PENDING

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S02-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s02-{attempt}`（实际证据只保存必要值/摘要）。

### S03 独立品质处置人放行FQC

- 执行槽位/角色：`quality_dispositioner` / `quality`；越权探针：`sales`。
- API：`POST /api/quality-inspections/{fqc_inspection_id}/dispositions`；矩阵操作：`quality.disposition`；permission：`quality.disposition`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": 1,
  "disposition_code": "RELEASE",
  "release_qty": "10.000000",
  "reason": "UAT67 FQC独立放行"
}
```

- 预期数据库增量：

  - `quality_inspection_events`：`+1`；DISPOSITIONED

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S03-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s03-{attempt}`（实际证据只保存必要值/摘要）。

### S04 品质关闭FQC

- 执行槽位/角色：`quality_inspector` / `quality`；越权探针：`warehouse`。
- API：`POST /api/quality-inspections/{fqc_inspection_id}/close`；矩阵操作：`quality.close`；permission：`quality.close`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": 2,
  "reason": "UAT67 FQC关闭"
}
```

- 预期数据库增量：

  - `quality_inspection_events`：`+1`；CLOSED

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S04-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s04-{attempt}`（实际证据只保存必要值/摘要）。

### S05 销售创建出货指令

- 执行槽位/角色：`sales_executor` / `sales`；越权探针：`warehouse`。
- API：`POST /api/delivery-instructions`；矩阵操作：`sales.delivery-create`；permission：`sales.delivery.create`.
- 成功HTTP：`201`；CAS：`expected_order_version`、`lines[].expected_line_version`.
- 净化请求模板：

```json
{
  "sales_order_id": "$ref.sales_order_id",
  "expected_order_version": "$ref.sales_order_version",
  "receiver_name": "UAT67合成收货人",
  "receiver_phone": "00000000000",
  "shipping_address": "UAT67合成地址",
  "lines": [
    {
      "sales_order_line_id": "$ref.sales_order_line_id",
      "quantity": "10.000000",
      "expected_line_version": "$ref.sales_order_line_version"
    }
  ]
}
```

- 预期数据库增量：

  - `sales_delivery_instructions,sales_delivery_instruction_lines`：`+1`；DRAFT出货指令

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S05-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s05-{attempt}`（实际证据只保存必要值/摘要）。

### S06 销售提交出货指令

- 执行槽位/角色：`sales_executor` / `sales`；越权探针：`warehouse`。
- API：`POST /api/delivery-instructions/{delivery_instruction_id}/submit`；矩阵操作：`sales.delivery-submit`；permission：`sales.delivery.submit`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": "$ref.S05.instruction_version",
  "reason": "UAT67提交"
}
```

- 预期数据库增量：

  - `sales_delivery_instruction_events`：`+1`；SUBMITTED

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S06-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s06-{attempt}`（实际证据只保存必要值/摘要）。

### S07 仓库接受出货指令

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`sales`。
- API：`POST /api/delivery-instructions/{delivery_instruction_id}/accept`；矩阵操作：`sales.delivery-accept`；permission：`sales.delivery.accept`.
- 成功HTTP：`200`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "expected_version": "$ref.S06.instruction_version",
  "reason": "UAT67仓库接受"
}
```

- 预期数据库增量：

  - `sales_delivery_instruction_events`：`+1`；ACCEPTED

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S07-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s07-{attempt}`（实际证据只保存必要值/摘要）。

### S08 仓库执行出货

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`sales`。
- API：`POST /api/delivery-instructions/{delivery_instruction_id}/execute`；矩阵操作：`sales.delivery-execute`；permission：`sales.delivery.execute`.
- 成功HTTP：`201`；CAS：`expected_instruction_version`、`expected_sales_order_version`、`lines[].expected_line_version`、`lines[].expected_sales_order_line_version`、`lines[].expected_balance_version`、`lines[].expected_lot_version`.
- 净化请求模板：

```json
{
  "expected_instruction_version": "$ref.S07.instruction_version",
  "expected_sales_order_version": "$ref.sales_order_version",
  "ship_date": "$ref.execution_date",
  "reason": "UAT67合成出货",
  "lines": [
    {
      "instruction_line_id": "$ref.S05.instruction_line_id",
      "inventory_lot_id": "$ref.finished_inventory_lot_id",
      "quantity": "10.000000",
      "expected_line_version": "$ref.S05.line_version",
      "expected_sales_order_line_version": "$ref.sales_order_line_version",
      "expected_balance_version": "$ref.finished_balance_version",
      "expected_lot_version": "$ref.finished_lot_version"
    }
  ]
}
```

- 预期数据库增量：

  - `sales_shipments,sales_shipment_lines`：`+1`；NORMAL出货事实
  - `inventory_ledger_entries`：`+1`；成品出库
  - `sales_financial_source_entries`：`+1`；AR来源

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S08-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s08-{attempt}`（实际证据只保存必要值/摘要）。

### S09 财务从出货来源生成AR

- 执行槽位/角色：`finance_executor` / `finance`；越权探针：`sales`。
- API：`POST /api/finance/documents`；矩阵操作：`finance.post-document`；permission：`finance.post`.
- 成功HTTP：`201`；CAS：无显式版本字段，但仍受唯一性/来源锁约束.
- 净化请求模板：

```json
{
  "doc_type": "AR",
  "sales_source_entry_id": "$ref.S08.sales_financial_source_entry_id",
  "accounting_date": "$ref.execution_date"
}
```

- 预期数据库增量：

  - `finance_documents,finance_document_events`：`+1 each`；AR精确继承出货来源

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S09-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s09-{attempt}`（实际证据只保存必要值/摘要）。

### S10 隔离检查点冲销出货（必须在AR前）

- 执行槽位/角色：`warehouse_executor` / `warehouse`；越权探针：`sales`。
- API：`POST /api/shipments/{shipment_id}/reversal`；矩阵操作：`sales.delivery-reverse`；permission：`sales.delivery.reverse`.
- 成功HTTP：`201`；CAS：`expected_balance_versions`、`expected_lot_versions`.
- 隔离分支：`AFTER_S08_BEFORE_S09`；不得和主链下游在同一fixture上连续执行。
- 净化请求模板：

```json
{
  "reason": "UAT67合成出货冲销",
  "expected_balance_versions": "$ref.S08.balance_versions",
  "expected_lot_versions": "$ref.S08.lot_versions"
}
```

- 预期数据库增量：

  - `sales_shipments`：`+1 REVERSAL`；原出货不删除不覆盖
  - `inventory_ledger_entries,sales_financial_source_entries`：`+1 reversal each`；库存、FQC额度与来源反向

- 请求证据：`X-Request-ID=UAT67-SALES_FQC_SHIPMENT_AR-S10-{uuid}`；`Idempotency-Key=uat67-sales_fqc_shipment_ar-s10-{attempt}`（实际证据只保存必要值/摘要）。

### SALES_FQC_SHIPMENT_AR 异常、原子性与冲销门禁

| 控制 | 目标步骤 | 必须观察到 |
| --- | --- | --- |
| `UNAUTHORIZED_403` | `S08` | sales角色执行出货返回403且delta=0 |
| `CSRF_403` | `S08` | 错误CSRF返回403且delta=0 |
| `IDEMPOTENCY_REPLAY` | `S08` | 同Key同正文重放原Shipment |
| `IDEMPOTENCY_CONFLICT` | `S08` | 同Key异正文返回IDEMPOTENCY_CONFLICT |
| `CAS_CONFLICT` | `S08` | 陈旧指令或库存版本返回DELIVERY_INSTRUCTION_VERSION_OR_STATE_CONFLICT |
| `ATOMIC_FAILURE_ZERO_HALF_RECORD` | `S08` | 故障注入证明shipment/inventory/FQC/source/audit/idempotency均无半记录 |
| `APPEND_ONLY_REVERSAL` | `S10` | 只新增冲销事实；AR存在时阻塞并保留 |
| `AUDIT_REQUEST_ID` | `ALL_STEPS` | 分配、FQC、指令、Shipment、AR的request ID闭合 |

### 三方签字（当前为空，不能视为验收）

- 执行人槽位：`sales_executor`、`quality_inspector`、`quality_dispositioner`、`warehouse_executor`、`finance_executor`；签字时间：`NULL`。
- 技术观察人：`operations_observer`；签字时间：`NULL`。
- 业务验收人：`business_acceptor`；接受时间：`NULL`；结果：`NULL`。

## 8. 客户收款/供应商付款→逐笔冲销（`FINANCE_PAYMENT_REVERSAL`）

前置条件：

- P06 AP与S09 AR已由可信来源生成
- 财务单据版本、余额和收付款计数已取证
- 仅使用合成账户名称

### F01 财务登记AR客户收款

- 执行槽位/角色：`finance_executor` / `finance`；越权探针：`sales`。
- API：`POST /api/finance/settlements`；矩阵操作：`finance.settle`；permission：`finance.pay`.
- 成功HTTP：`201`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "document_id": "$ref.S09.ar_document_id",
  "expected_version": "$ref.S09.document_version",
  "settlement_type": "RECEIPT",
  "amount": "4.000000",
  "accounting_date": "$ref.execution_date",
  "account_name": "UAT67合成账户",
  "reason": "UAT67合成客户收款"
}
```

- 预期数据库增量：

  - `finance_settlements`：`+1`；RECEIPT正向事实
  - `finance_document_events`：`+1`；SETTLED

- 请求证据：`X-Request-ID=UAT67-FINANCE_PAYMENT_REVERSAL-F01-{uuid}`；`Idempotency-Key=uat67-finance_payment_reversal-f01-{attempt}`（实际证据只保存必要值/摘要）。

### F02 财务冲销AR收款

- 执行槽位/角色：`finance_executor` / `finance`；越权探针：`sales`。
- API：`POST /api/finance-settlements/{ar_settlement_id}/reversal`；矩阵操作：`finance.reverse`；permission：`finance.reverse`.
- 成功HTTP：`201`；CAS：`expected_version`.
- 隔离分支：`AFTER_F01_AR_RECEIPT`；不得和主链下游在同一fixture上连续执行。
- 净化请求模板：

```json
{
  "expected_version": "$ref.F01.document_version",
  "accounting_date": "$ref.execution_date",
  "reason": "UAT67客户收款冲销"
}
```

- 预期数据库增量：

  - `finance_settlements`：`+1 negative reversal`；original_settlement_id绑定F01，原记录不改写
  - `finance_document_events`：`+1`；SETTLEMENT_REVERSED

- 请求证据：`X-Request-ID=UAT67-FINANCE_PAYMENT_REVERSAL-F02-{uuid}`；`Idempotency-Key=uat67-finance_payment_reversal-f02-{attempt}`（实际证据只保存必要值/摘要）。

### F03 财务登记AP供应商付款

- 执行槽位/角色：`finance_executor` / `finance`；越权探针：`purchase`。
- API：`POST /api/finance/settlements`；矩阵操作：`finance.settle`；permission：`finance.pay`.
- 成功HTTP：`201`；CAS：`expected_version`.
- 净化请求模板：

```json
{
  "document_id": "$ref.P06.ap_document_id",
  "expected_version": "$ref.P06.document_version",
  "settlement_type": "PAYMENT",
  "amount": "6.000000",
  "accounting_date": "$ref.execution_date",
  "account_name": "UAT67合成账户",
  "reason": "UAT67合成供应商付款"
}
```

- 预期数据库增量：

  - `finance_settlements`：`+1`；PAYMENT正向事实
  - `finance_document_events`：`+1`；SETTLED

- 请求证据：`X-Request-ID=UAT67-FINANCE_PAYMENT_REVERSAL-F03-{uuid}`；`Idempotency-Key=uat67-finance_payment_reversal-f03-{attempt}`（实际证据只保存必要值/摘要）。

### F04 财务冲销AP付款

- 执行槽位/角色：`finance_executor` / `finance`；越权探针：`purchase`。
- API：`POST /api/finance-settlements/{ap_settlement_id}/reversal`；矩阵操作：`finance.reverse`；permission：`finance.reverse`.
- 成功HTTP：`201`；CAS：`expected_version`.
- 隔离分支：`AFTER_F03_AP_PAYMENT`；不得和主链下游在同一fixture上连续执行。
- 净化请求模板：

```json
{
  "expected_version": "$ref.F03.document_version",
  "accounting_date": "$ref.execution_date",
  "reason": "UAT67供应商付款冲销"
}
```

- 预期数据库增量：

  - `finance_settlements`：`+1 negative reversal`；original_settlement_id绑定F03，原记录不改写
  - `finance_document_events`：`+1`；SETTLEMENT_REVERSED

- 请求证据：`X-Request-ID=UAT67-FINANCE_PAYMENT_REVERSAL-F04-{uuid}`；`Idempotency-Key=uat67-finance_payment_reversal-f04-{attempt}`（实际证据只保存必要值/摘要）。

### FINANCE_PAYMENT_REVERSAL 异常、原子性与冲销门禁

| 控制 | 目标步骤 | 必须观察到 |
| --- | --- | --- |
| `UNAUTHORIZED_403` | `F01` | sales角色登记收款返回403且delta=0 |
| `CSRF_403` | `F01` | 错误CSRF返回403且delta=0 |
| `IDEMPOTENCY_REPLAY` | `F01` | 同Key同正文重放原Settlement |
| `IDEMPOTENCY_CONFLICT` | `F01` | 同Key异正文返回IDEMPOTENCY_CONFLICT |
| `CAS_CONFLICT` | `F01` | 陈旧expected_version返回FINANCE_VERSION_CONFLICT |
| `ATOMIC_FAILURE_ZERO_HALF_RECORD` | `F02` | Audit故障时文档余额、冲销记录、事件和幂等均不变 |
| `APPEND_ONLY_REVERSAL` | `F02` | 新增负数冲销记录并引用原Settlement，不改写原收款 |
| `AUDIT_REQUEST_ID` | `ALL_STEPS` | 单据、Settlement、Event、Audit的request ID闭合 |

### 三方签字（当前为空，不能视为验收）

- 执行人槽位：`finance_executor`；签字时间：`NULL`。
- 技术观察人：`operations_observer`；签字时间：`NULL`。
- 业务验收人：`business_acceptor`；接受时间：`NULL`；结果：`NULL`。

## 9. 停止与回退

停止条件：

- 授权编号、账号映射、允许写范围、执行窗口、停止权或回退责任任一为空
- 当前提交、镜像、Migration或UAT部署身份与获批执行包不一致
- 发现非UAT67合成对象、真实业务值或范围外数据变化
- 越权、CSRF、幂等、CAS、审计或请求编号任一门禁不符合预期
- 任一失败留下半记录，或无法解释表计数、库存、金额差异
- 资源保护线触发、容器失去健康、OOM或数据库失联
- 业务冲销被下游引用阻塞且没有新的专项处置授权

回退模式为 `BUSINESS_REVERSAL_FIRST`。直接SQL删除或改写业务事实为 `FORBIDDEN`；快照恢复为 `SEPARATE_EXPLICIT_AUTHORIZATION_REQUIRED`；下游阻塞时执行 `STOP_PRESERVE_EVIDENCE_ESCALATE`。

回退后必须复核：

- 对象计数
- 库存数量与版本
- 应收应付与收付款
- Audit与request ID
- Idempotency记录
- UAT健康状态

## 10. 证据源码manifest

| 路径 | SHA-256 |
| --- | --- |
| `chenyida_erp_site/app/lib/finance-selfhost/handler.ts` | `ce773a2affae2461642da2a97f6923cfe36ef3ae7ed9dd0a2f45107e60444e0e` |
| `chenyida_erp_site/app/lib/procurement-fulfillment-selfhost/handler.ts` | `c24daca6a80325bad66f302734a47bddacb0c2b7a779c6b8613accda9f09a1de` |
| `chenyida_erp_site/app/lib/procurement-fulfillment-selfhost/service.ts` | `efcd31be3e758897493224606c3ba4ef022960fab30b4403e928cb9ff3c7d49e` |
| `chenyida_erp_site/app/lib/production-operation-selfhost/service.ts` | `9c3fc2a0a96ea57ecf9bc19b1ffdf5641c43870b1d8132b5b9bfdc0e01b71513` |
| `chenyida_erp_site/app/lib/production-selfhost/handler.ts` | `6a763e8f142d4364e19aac8ea63d2da01b6424283d8e93e5435c389656bcf9b4` |
| `chenyida_erp_site/app/lib/quality-selfhost/handler.ts` | `1181e581c70907c19d4024cf0af86bb2c2043dbe3311e57664c91a9c9fff0075` |
| `chenyida_erp_site/app/lib/quality-selfhost/service.ts` | `e681610a8726d33b43dbf5f37d660ac9e490a6037a298015ed88c9d6cfe6901f` |
| `chenyida_erp_site/app/lib/sales-selfhost/handler.ts` | `f669d4680b53e0a450ed8390f158157d99b8749a863e3f50ef307c6d1d840769` |
| `chenyida_erp_site/tests/selfhost-finance-postgres.test.mjs` | `21bf0163446e9a5d6345628c186a80d61c41be84297479014284d25b45d8d697` |
| `chenyida_erp_site/tests/selfhost-procurement-fulfillment-postgres.test.mjs` | `d6874a3d50392eef485527ba09f097abd686aade9d3e05ab3b0a95448bf799e2` |
| `chenyida_erp_site/tests/selfhost-production-operation-quality-gate-postgres.test.mjs` | `42d59adc10952bf2a822ff93cc6e313057745f55a55c32164a2351d75fb19ccd` |
| `chenyida_erp_site/tests/selfhost-production-postgres.test.mjs` | `2acd509dda26ea1292c55e3b1adcf5d0296934ebff78ba41cb2b8f2160c42551` |
| `chenyida_erp_site/tests/selfhost-sales-postgres.test.mjs` | `67a0f71c3433c70fd57773f9672c71b8eb2ba5337a251f8b67a587eed0024153` |
| `chenyida_erp_site/tests/selfhost-supplier-receipt-lot-iqc-postgres.test.mjs` | `af67ae321cf14339fb23da89c9f4142aa6cc9946540b0c137b8fedc5da9ce717` |
| `docs/tasks/SELFHOST-UAT-AUDIT-34.md` | `35f66907100b20a9fec38ed647f6883e4e0e128ca904ed7656d2ace65b43809a` |
| `docs/tasks/SELFHOST-UAT-DECISION-35.md` | `2a6ad714621462e5dd827511b01253898e3358250b04f4121e7e38e8bdde8c58` |

覆盖统计：4条链、32个步骤、6个隔离冲销分支、32个异常/证据控制、16个摘要绑定证据源。
