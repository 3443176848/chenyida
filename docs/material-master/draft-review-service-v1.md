# Material Master V2 草稿创建与审核写服务 V1

状态：`IMPLEMENTED_AND_VERIFIED`

任务：`PHASE1-TASK05`

开始日期：2026-07-12

完成日期：2026-07-13

目标运行面：`chenyida_erp_site/` 服务端 TypeScript / Cloudflare D1

## 1. 目标

建立 Material Master V2 唯一的受控写服务，使未来人工创建、Excel 导入、AI 建议确认和供应商同步都只能先创建草稿，再经审核事务启用。当前任务只实现服务层和隔离测试，不接 API、页面或任何生产环境。

服务保证：

- 创建和批准前均调用现有 `material-validation` 服务；任一 `ERROR` 阻断写入或批准，`WARNING` 保留并允许继续。
- 草稿固定为 `DRAFT`，不生成正式编码。
- 批准在一个 D1 `batch()` 事务中完成编码序列领取、`ACTIVE` 状态、批准信息、版本和审计；任一语句失败则全部回滚。
- 所有审核命令携带 `expected_version`，数据库条件更新和事务守卫共同执行乐观锁。
- 创建和批准事务比较校验期 metadata/属性守卫；校验后规则或属性变化会触发冲突并整体回滚。
- 正式编码只在批准事务把目标状态原子变为 `ACTIVE` 时分配。

## 2. 范围

### 2.1 包含

```text
chenyida_erp_site/app/lib/material-master/
  types.ts
  repository.ts
  draft-service.ts
  review-service.ts
  code-service.ts
  index.ts
```

- D1 Repository 与可注入服务接口。
- `createDraft()`、`approveDraft()`、`rejectDraft()`。
- 类型化属性持久化、规范化值、单位和来源审计字段。
- 正式编码格式化、序列 CAS、占用序号跳过和唯一索引双重保护。
- Material 版本快照与动作审计。
- 本机一次性 Miniflare D1 集成、故障注入和并发测试。

### 2.2 不包含

- API、路由、鉴权适配、CSRF 或页面。
- Excel/CSV 导入、AI 推理或供应商同步实现。
- 真实数据迁移、生产 D1 访问、部署或 metadata 修改。
- BOM、采购、库存、生产或本地 Python/SQLite 修改。
- 多角色审批节点、草稿编辑/提交、驳回后补资料 UI。
- schema 或 migration 修改。

## 3. 已确认设计选择

### 3.1 采用现有 Schema

当前 `material_change_logs.change_type` 只允许 `CREATE`、`APPROVAL`、`REJECTION`、`CODE_ASSIGNMENT` 等已批准值，`material_master.material_status` 不含 `REJECTED`。本任务不新增同义状态或修改已执行迁移，使用以下稳定映射：

| 业务动作 | `change_type` | `field_name` |
| --- | --- | --- |
| `CREATE_DRAFT` | `CREATE` | `CREATE_DRAFT` |
| `APPROVE` | `APPROVAL` | `APPROVE` |
| `REJECT` | `REJECTION` | `REJECT` |
| `CODE_GENERATE` | `CODE_ASSIGNMENT` | `CODE_GENERATE` |

`rejectDraft()` 不生成编码，也不虚构 `REJECTED` 状态；它保持 `DRAFT`、递增版本并追加 `REJECT` 版本和 `REJECTION` 审计。未来草稿编辑/重新提交服务使用新版本继续流程。

### 3.2 审核数据库快照

`approveDraft()` 只接收 `material_id`、`expected_version` 和可信操作上下文。服务从 D1 重新读取主记录及当前属性，重建 `MaterialValidationInput` 并调用 `validateForReview()`；不接受调用方重新提交的一份属性副本作为审核依据。

### 3.3 D1 批事务而非交互事务

D1 Worker Binding 不提供传统交互事务回调。本服务把关键写操作组织为顺序 prepared statements，并用 `D1Database.batch()` 原子提交。条件更新之后紧跟带非空约束的守卫插入；若预期版本、状态、校验期 metadata/属性快照或编码规则 CAS 未命中，守卫语句失败并触发整个 batch 回滚。

## 4. 输入契约

### 4.1 创建草稿

```ts
type CreateMaterialDraftCommand = {
  basic_fields: {
    category_id: number;
    standard_name: unknown;
    unit: unknown;
    brand?: unknown;
    manufacturer?: unknown;
    manufacturer_part_number?: unknown;
    procurement_type: unknown;
    inventory_type: unknown;
    lot_control_required?: unknown;
    shelf_life_days?: unknown;
    inspection_type: unknown;
    environmental_requirement: unknown;
    source_ref: unknown;
  };
  attributes: Record<string, MaterialAttributeInput>;
  source_type: unknown;
  context: {
    actor: string;
    request_id: string;
  };
};
```

`created_at`、`updated_at` 由服务端时钟生成。`created_by`、`updated_by` 来自可信 `context.actor`，不得从属性正文中取得。

### 4.2 审核

```ts
type ReviewMaterialDraftCommand = {
  material_id: number;
  expected_version: number;
  reason?: string;
  context: {
    actor: string;
    request_id: string;
  };
};
```

拒绝必须提供非空 `reason`；批准理由可选。API 适配、角色权限和请求幂等键属于后续任务。

## 5. 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| `types.ts` | 输入、结果、记录、错误码和 Repository/Service 接口 | SQL、HTTP |
| `repository.ts` | D1 查询、类型 metadata、事务写入、CAS 和错误分类 | 业务校验、HTTP 错误 |
| `draft-service.ts` | 创建前校验、写字段校验、属性类型化/规范化、创建草稿 | 编码、审核 |
| `review-service.ts` | 加载草稿、审核前重校验、乐观锁入口、批准/拒绝编排 | 编码格式、API 权限 |
| `code-service.ts` | 有效规则选择、编码格式、序列冲突重试、原子启用 | 草稿创建、规则维护 |
| `index.ts` | 稳定统一导出 | 运行时数据库选择 |

## 6. 状态流转

```text
createDraft
  -> DRAFT (version 1, code null)

DRAFT + expected_version
  -> approveDraft -> ACTIVE (version + 1, code assigned)
  -> rejectDraft  -> DRAFT  (version + 1, no code, REJECT history)
```

`PENDING_APPROVAL`、多节点审核、冻结和停用不在本任务中实现。两个审核者使用同一 `expected_version` 时，只有一个条件更新能够成功；失败者得到结构化版本冲突。

## 7. 属性存储

创建前，服务按属性 code 从当前 ACTIVE definition/binding 读取存储 metadata，并写入对应类型列：

| 类型 | 存储列 |
| --- | --- |
| `TEXT`、`ENUM` | `value_text` |
| `INTEGER` | `value_integer` |
| `DECIMAL` | `value_decimal_scaled` |
| `BOOLEAN` | `value_boolean`，使用 `0/1` |

`DECIMAL` 必须能按 definition 的 `decimal_scale` 精确缩放；超过精度时阻断，禁止静默舍入。`DATE` 继续由 Validation V1 阻断。

存储 metadata 快照还包含分类层级/状态、必填绑定和稳定守卫。若 Validation 调用后新增必填属性、停用品类或改变定义，服务在写入前或事务守卫处阻断，不会创建基于过期规则的草稿。

每个 `material_attribute_values` 行保存：

- 稳定 `attribute_definition_id`，输入接口仍只接受 `attribute_code`。
- `normalized_value` 和原始兼容 `unit_code`。
- 属性 `source` 合法时作为 `source_type`；未提供时继承物料 `source_type`。
- 物料 `source_ref`、可信操作者、服务端时间和请求编号。

## 8. 创建事务

`createDraft()` 通过显式候选整数 ID 和主键冲突重试避免跨语句依赖隐式连接状态。一个 batch 包含：

1. 比对分类/属性 metadata 守卫并插入 `material_master`：`DRAFT`、`internal_material_code = NULL`、`version = 1`。
2. 插入 `material_versions`：`event_type = CREATE`、`version_no = 1`。
3. 插入 `material_change_logs`：业务动作 `CREATE_DRAFT`。
4. 插入全部类型化 `material_attribute_values`。

任何属性、外键、唯一性或审计写入失败，草稿主记录也必须回滚。

## 9. 批准与编码事务

### 9.1 规则选择

编码服务按草稿最具体分类和审核日期读取规则，只接受：

- `status = ACTIVE`。
- `effective_from <= 审核日期`。
- `effective_to` 为空或晚于审核日期。
- 恰好一条匹配规则；零条或多条均阻断。

格式：

```text
prefix + separator + major_segment + separator + minor_segment
  + separator + zeroPad(sequence, sequence_width)
```

例如：`CYD-PCB-FR4-000001`。序号超过配置宽度时阻断，不扩大字段宽度。

### 9.2 原子启用

批准 batch 包含：

1. 以 `rule.id + rule.version + next_sequence` 条件递增序列和规则版本。
2. 以 `material_id + expected_version + DRAFT + code IS NULL` 条件，同时写正式编码、`ACTIVE`、批准信息和新版本。
3. 插入带 CAS、metadata 和属性快照守卫的 `APPROVE` 版本；任一条件未命中即触发约束失败并回滚。
4. 插入 `APPROVE` 审计。
5. 插入 `CODE_GENERATE` 审计。

编码唯一索引是最后防线。若候选编码已占用，编码服务以规则 CAS 消耗该已占用序号并重试；序号不回收。并发规则冲突重新读取规则后重试，物料版本冲突绝不重试。

## 10. 拒绝事务

拒绝 batch 包含：

1. 以 `material_id + expected_version + DRAFT` 条件递增物料版本，状态仍为 `DRAFT`。
2. 插入带条件守卫的 `material_versions`：`event_type = REJECT`。
3. 插入 `REJECT` / `REJECTION` 审计和拒绝原因。

拒绝不读取或消耗编码规则。批准与拒绝并发时，只有第一个提交者成功。

## 11. 结构化错误

服务错误只包含稳定 code、中文消息和安全 metadata，不返回 SQL、堆栈或 D1 绑定内容。至少包括：

- `MATERIAL_CREATE_VALIDATION_FAILED`
- `MATERIAL_REVIEW_VALIDATION_FAILED`
- `MATERIAL_DRAFT_INPUT_INVALID`
- `MATERIAL_ATTRIBUTE_STORAGE_INVALID`
- `MATERIAL_ATTRIBUTE_VALUE_INVALID`
- `MATERIAL_ATTRIBUTE_STORAGE_METADATA_INVALID`
- `MATERIAL_ATTRIBUTE_STORAGE_METADATA_CONFLICT`
- `MATERIAL_DRAFT_NOT_FOUND`
- `MATERIAL_DRAFT_NOT_REVIEWABLE`
- `MATERIAL_VERSION_CONFLICT`
- `MATERIAL_CODE_RULE_NOT_FOUND`
- `MATERIAL_CODE_RULE_AMBIGUOUS`
- `MATERIAL_CODE_RULE_INVALID`
- `MATERIAL_CODE_SEQUENCE_EXHAUSTED`
- `MATERIAL_CODE_ALLOCATION_CONFLICT`
- `MATERIAL_WRITE_FAILED`

底层 Repository 可保留内部错误分类供服务重试，但不能把原始数据库错误向调用者传播。

## 12. 测试

### 12.1 必测场景

1. 正确 FR4 创建 `DRAFT`，编码为空，属性及来源审计字段完整。
2. 缺少厚度时 Validation 阻断，写表计数不变。
3. 创建后 metadata 变化，批准前重新校验并阻断。
4. 批准生成唯一编码、转 `ACTIVE`、写版本和两条审计。
5. 拒绝保持 `DRAFT`、版本递增、不生成编码。
6. 同一草稿并发批准：一成功、一版本冲突、只生成一个编码。
7. 同一规则并发批准两个草稿：编码不同且序列连续领取。
8. 已占用候选编码被跳过，不产生重复编码。
9. 首次创建校验后 metadata 变化，提交前第二次校验按存储快照阻断。
10. 第二次创建校验后 metadata 变化，创建事务守卫整体回滚。
11. 审核校验后 metadata 变化，批准事务返回版本冲突且不消耗编码。
12. 批准末段审计写入故障，规则、状态、版本和审计全部回滚。

### 12.2 基线

- `npm run lint`
- `npm test`
- 隔离环境 `tests/erp-api-smoke.mjs`
- `git diff --check`
- 凭证检查
- 可选 TypeScript 全量检查；既有 `db/schema.ts` 自引用类型问题必须与新增错误区分记录。

## 13. 风险和后续边界

- 当前 `DRAFT` 同时表示新草稿和被拒绝后待修订草稿；若未来必须直接查询拒绝队列，应通过后续已审批 schema 设计新增明确实体或状态，不能改写 `0001`。
- 当前服务接收可信 actor/request context，但尚无 API 权限、幂等键或多角色职责分离；接入前必须独立实现。
- Validation V1 不做单位换算、跨物料查重或品牌主数据校验；通过本服务不等于完成全部 Material Master V2 治理。
- 编码规则需要受控初始化；本任务不向生产插入任何默认规则。
- 所有未来来源必须调用本服务，但 Excel、AI 和供应商适配器仍必须遵守现有受控 `source_type` 字典；AI 不能成为未经人工确认的正式写入者。

## 14. 实施结果

`PHASE1-TASK05` 已按本规格实现并完成隔离验证：

- 新增 `app/lib/material-master/` 六个模块，分别封装类型、D1 Repository、草稿、审核、编码和稳定导出。
- `createDraft()` 写入 `DRAFT`、类型化属性、首个 `CREATE` 版本和 `CREATE_DRAFT` 审计，不生成正式编码。
- `approveDraft()` 从 D1 重新加载草稿并执行 `validateForReview()`，再以单一 batch 原子领取序号、写 `ACTIVE`/编码/批准信息、追加 `APPROVE` 版本和两条审计。
- `rejectDraft()` 保持 `DRAFT`、递增版本、追加 `REJECT` 版本和审计，不读取或消耗编码规则。
- 创建和批准均使用 metadata/属性守卫；同草稿乐观锁和同规则序列 CAS 均在隔离 D1 并发测试通过。
- 新增 12 个服务测试；完整 Node 测试为 52/52 通过。
- `npm run lint` 为 0 error，保留 1 个任务外既有 warning；隔离 API smoke、凭证检查和 `git diff --check` 通过。
- TypeScript 全量检查仍只报告 `db/schema.ts` 第 129、243 行既有 Drizzle 自引用错误；新增模块没有类型错误。
- 未接入 API、页面、导入、AI 或下游业务，未修改 schema/migration，未访问生产 D1 或部署。

`PHASE1-TASK06` 接入 API 时仅收窄了属性存储错误分类：客户端小数精度问题使用 `MATERIAL_ATTRIBUTE_VALUE_INVALID`，无效存储 metadata 使用 `MATERIAL_ATTRIBUTE_STORAGE_METADATA_INVALID`，校验后 metadata 竞态使用 `MATERIAL_ATTRIBUTE_STORAGE_METADATA_CONFLICT`；旧 `MATERIAL_ATTRIBUTE_STORAGE_INVALID` 继续作为兼容性 fail-closed code。未改变校验、属性存储、状态或编码业务语义。
