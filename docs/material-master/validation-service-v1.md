# Material Master V2 物料校验服务 V1

状态：`IMPLEMENTED_AND_VERIFIED`

任务：`PHASE1-TASK04`

日期：2026-07-12

目标运行面：`chenyida_erp_site/` 服务端 TypeScript / Cloudflare D1

## 1. 目标

建立独立的 `material-validation` 服务模块，在物料创建和审核前，根据 D1 中当前有效的分类、分类属性绑定和属性定义校验物料输入。

服务只返回校验结果，不创建、更新或审核物料，不接入现有 API，也不修改前端或下游业务。

统一返回格式：

```ts
{
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
```

其中 `valid` 严格等于 `errors.length === 0`。`ERROR` 阻断创建和审核，`WARNING` 只提示、不阻断。

## 2. 范围

### 2.1 包含

- Repository、Rules、Service 三层服务端架构。
- 物料基础字段校验。
- 四级叶子分类存在性和启用状态校验。
- 按当前 D1 metadata 读取分类属性绑定。
- 属性 code、必填、绑定范围、类型、单位和枚举校验。
- 创建前校验和审核前校验。
- 结构化错误 code 和 `ERROR`、`WARNING` 等级。
- Memory Repository 单元测试。
- 隔离本地 D1 metadata 变化测试。

### 2.2 不包含

- 现有 API 或路由接入。
- 前端页面。
- Excel/CSV 导入。
- AI 分类、AI 置信度决策或自动建档。
- 真实物料创建、审核、迁移或生产 D1 操作。
- 跨物料重复匹配或候选冲突查询。
- 单位数值换算或类型化属性值写库。
- BOM、采购、库存、生产或本地 Python/SQLite 逻辑修改。

## 3. 已批准设计决策

1. 采用 Repository + Rules + Service 三层架构。
2. D1 metadata 是运行时分类、绑定、必填、类型、标准单位和枚举规则的唯一来源。
3. 运行时不得读取 `seeds/material-category-v1.ts` 作为规则来源。
4. 属性接口只使用长期稳定的 `attribute_code`，不得接受 `attribute_id`。
5. `attributes` 使用属性 code 索引对象，不使用数组。
6. 属性 code 必须使用大写英文、数字和下划线，格式为 `^[A-Z][A-Z0-9_]{1,63}$`。
7. 类型校验严格按 JSON/JavaScript 原生类型执行，不自动解析或转换字符串数字、布尔或枚举。
8. `source` 和 `confidence` 作为属性输入的可选扩展字段保留；V1 不依据它们改变校验结果。
9. 服务默认不缓存 metadata；受控 metadata 变化在下一次校验调用生效。
10. Memory Repository 仅作为测试替身，不得成为生产运行规则来源。

## 4. 模块边界

模块位于：

```text
chenyida_erp_site/app/lib/material-validation/
  types.ts
  repository.ts
  rules.ts
  service.ts
  index.ts
```

职责如下：

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| Repository | 按 `category_id` 读取分类和当前有效属性 metadata；提供 D1 与 Memory 实现 | 业务错误等级、输入类型判断、物料写入 |
| Rules | 执行纯函数基础字段、属性 code、类型、单位、枚举和警告规则 | 数据库访问、HTTP 响应、写库 |
| Service | 编排 metadata 读取、规则执行、结果排序和创建/审核入口 | API 鉴权、事务写入、正式编码、审核状态转换 |

统一入口由 `index.ts` 导出。现有 `erp-api.ts` 不引用本模块，API 接入必须由后续独立任务实施。

## 5. 输入契约

```ts
type MaterialAttributeInput = {
  value: unknown;
  unit?: string;
  source?: string;
  confidence?: number;
};

type MaterialValidationInput = {
  category_id: number;
  basic_fields: {
    standard_name: unknown;
    unit: unknown;
    source_type: unknown;
  };
  attributes: Record<string, MaterialAttributeInput>;
};
```

示例：

```ts
{
  category_id: 123,
  basic_fields: {
    standard_name: "普通 FR4 覆铜板",
    unit: "PCS",
    source_type: "MANUAL"
  },
  attributes: {
    BRAND: { value: "KINGBOARD", source: "MANUAL", confidence: 1 },
    MODEL: { value: "KB-6160" },
    THICKNESS: { value: 1.6, unit: "mm" },
    COPPER_THICKNESS: { value: 35, unit: "um" },
    TG: { value: 150, unit: "°C" },
    FLAMMABILITY: { value: "V-0" },
    HALOGEN_FREE: { value: false }
  }
}
```

约束：

- `category_id` 必须是正整数；接口不接受分类 code 代替 ID。
- `attributes` 的对象键就是稳定属性 code。
- 顶层或属性条目中的 `attribute_id` 都必须明确拒绝，不能静默忽略。
- `source` 和 `confidence` 仅保留字段位置；V1 不校验来源字典、置信度范围或阈值。
- `basic_fields.unit` 在未来写服务中对应 `material_master.base_uom`；本任务不写库。

## 6. 输出契约

```ts
type ValidationSeverity = "ERROR" | "WARNING";

type ValidationIssue = {
  code: string;
  severity: ValidationSeverity;
  field: string;
  message: string;
  attribute_code?: string;
  metadata?: Record<string, string | number | boolean | readonly string[]>;
};

type MaterialValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};
```

要求：

- `code` 是稳定、可供 API 或前端映射的机器错误码。
- `message` 使用中文，不包含 SQL、堆栈或敏感输入正文。
- `field` 使用稳定路径，例如 `basic_fields.standard_name`、`category_id`、`attributes.THICKNESS.value`。
- 属性问题必须返回 `attribute_code`。
- `metadata` 只返回安全的期望类型、合法单位或枚举 code，不回显敏感值。
- 结果顺序必须稳定：基础字段、分类、按绑定 `sort_order` 的属性、未绑定属性 code 字典序。

## 7. D1 Metadata Repository

实际绑定表名为 `material_category_attributes`。任务文本中的 `category_attribute_bindings` 仅为业务描述，不新增同义表。

Repository 每次校验读取：

1. `material_categories`
   - `id`
   - `category_code`
   - `category_level`
   - `status`
2. `material_category_attributes`
   - `category_id`
   - `attribute_definition_id`
   - `is_required`
   - `sort_order`
   - `status`
3. `material_attribute_definitions`
   - `attribute_code`
   - `attribute_name_cn`
   - `data_type`
   - `decimal_scale`
   - `canonical_unit`
   - `allowed_values_json`
   - `status`

只使用状态为 `ACTIVE` 的绑定和属性定义。分类本身即使停用也需要被读取，以便返回明确的 `CATEGORY_INACTIVE`，而不是误报不存在。

D1 Repository 接收注入的最小 D1 `prepare/bind/first/all` 接口，不直接导入 `cloudflare:workers.env`，因此不会自行选择或连接数据库。调用方未来负责注入正确绑定。

Repository 不缓存 metadata。数据库读取失败时，Service 返回脱敏的 `MATERIAL_VALIDATION_METADATA_UNAVAILABLE`，不得把底层异常、SQL 或绑定信息放入结果。

## 8. 校验流程

1. 校验输入容器和基础字段。
2. 拒绝任何 `attribute_id`。
3. 校验 `category_id` 形态；合法时调用 Repository。
4. 校验分类存在、`ACTIVE` 且为四级叶子。
5. 获取该叶子的全部当前有效绑定和属性定义。
6. 校验属性 code 格式及是否绑定当前分类。
7. 按绑定顺序检查必填属性。
8. 对已提供属性执行严格类型校验。
9. 对数值属性执行单位校验。
10. 对枚举属性执行允许值校验。
11. 执行非阻断警告规则。
12. 分离 `errors` 和 `warnings`，计算 `valid`。

当分类不存在、停用或不是叶子时，不继续把全部输入属性误报为未绑定；只返回已经能够确定的输入和分类问题。

## 9. 规则定义

### 9.1 基础字段

| 字段 | 规则 | 等级 |
| --- | --- | --- |
| `standard_name` | 必须是去除首尾空白后非空的字符串 | ERROR |
| `category_id` | 必须存在、是正整数、指向 `ACTIVE` 四级叶子 | ERROR |
| `unit` | 必须是去除首尾空白后非空的字符串 | ERROR |
| `source_type` | 必须是 `MANUAL`、`LEGACY_D1`、`LEGACY_SQLITE`、`GOVERNANCE_TEMPLATE`、`API` 之一 | ERROR |

### 9.2 必填和值存在性

- D1 binding 的 `is_required = 1` 时，属性 code 必须存在。
- `null`、`undefined` 和只含空白的字符串视为缺值。
- 数字 `0` 和布尔 `false` 是有效已提供值。
- 未绑定当前叶子的属性不得静默接收。

### 9.3 严格类型

| D1 `data_type` | 接受 | 拒绝示例 |
| --- | --- | --- |
| `TEXT` | JavaScript `string` | 数字、布尔、对象 |
| `INTEGER` | 有限且 `Number.isInteger(value)` 的 `number` | `"10"`、`10.5`、`NaN`、无穷值 |
| `DECIMAL` | 有限 `number` | `"1.6"`、`NaN`、无穷值 |
| `BOOLEAN` | 原生 `boolean` | `0`、`1`、`"true"` |
| `ENUM` | 原生 `string`，并继续执行枚举检查 | 数字、布尔、对象 |

数据库模型还预留 `DATE`，但本任务只批准上述五种类型。遇到 `DATE` 或未知类型必须返回 `MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED`，不得静默放行。

### 9.4 单位

- `canonical_unit` 非空的数值属性必须提供 `unit`。
- `canonical_unit` 为空的属性不得提供非空单位。
- `mm` 与 `um` 属于首版长度兼容单位族，二者可互相接受。
- 除已声明兼容单位族外，输入单位必须与 D1 `canonical_unit` 完全相同。
- 单位 code 区分大小写，不自动修剪、转换或换算数值。
- 首版实际覆盖 `mm`、`um`、`ohm`、`%`、`W`、`kg`，同时允许其他 metadata 标准单位按精确匹配通过。

### 9.5 枚举

- `allowed_values_json` 必须可解析为只包含非空字符串的 JSON 数组。
- 输入必须与数组中的稳定枚举 code 完全相同。
- 不自动转大写、不接受显示名称、不做同义词映射。
- metadata JSON 非法时返回 metadata 错误并阻断审核。

### 9.6 品牌警告

- 当前叶子把 `BRAND` 标为必填时，缺少品牌仍返回 `ERROR`。
- `BRAND` 值为 `UNKNOWN`、`UNSPECIFIED`、`N/A`、`NA` 或 `未知` 时返回 `MATERIAL_BRAND_UNKNOWN`，等级为 `WARNING`。
- 当前没有品牌主数据字典；其他非空字符串不做真假品牌判断。

## 10. 创建与审核入口

Service 提供两个明确入口：

```ts
validateForCreate(input): Promise<MaterialValidationResult>
validateForReview(input): Promise<MaterialValidationResult>
```

两个入口在 V1 使用相同基础、分类和属性规则。审核入口作为未来审核状态机的稳定边界，并执行以下判定：

- 只要存在一个 `ERROR`，`valid = false`，不得审核通过。
- 只有 `WARNING` 时，`valid = true`，允许进入后续人工审核流程。
- 当前没有跨物料冲突或候选匹配实体；V1 中“严重冲突”定义为本服务产生的任一 `ERROR`。
- 跨物料重复、供应商冲突、AI 置信度冲突必须由后续独立任务提供数据模型和规则，不能在本任务中虚构查询。

## 11. 稳定错误码

| Code | 等级 | 含义 |
| --- | --- | --- |
| `MATERIAL_STANDARD_NAME_REQUIRED` | ERROR | 标准名称为空或不是字符串 |
| `MATERIAL_CATEGORY_REQUIRED` | ERROR | 分类 ID 缺失 |
| `MATERIAL_CATEGORY_INVALID` | ERROR | 分类 ID 不是正整数 |
| `MATERIAL_CATEGORY_NOT_FOUND` | ERROR | 分类不存在 |
| `MATERIAL_CATEGORY_INACTIVE` | ERROR | 分类已停用 |
| `MATERIAL_CATEGORY_NOT_LEAF` | ERROR | 分类不是四级叶子 |
| `MATERIAL_UNIT_REQUIRED` | ERROR | 基础单位为空或不是字符串 |
| `MATERIAL_SOURCE_TYPE_REQUIRED` | ERROR | 来源类型为空 |
| `MATERIAL_SOURCE_TYPE_INVALID` | ERROR | 来源类型不在受控值集 |
| `MATERIAL_ATTRIBUTES_INVALID` | ERROR | attributes 不是 code 索引对象 |
| `MATERIAL_ATTRIBUTE_ID_FORBIDDEN` | ERROR | 输入包含 attribute_id |
| `MATERIAL_ATTRIBUTE_CODE_INVALID` | ERROR | 属性 code 格式非法 |
| `MATERIAL_ATTRIBUTE_ENTRY_INVALID` | ERROR | 属性条目不是 `{ value, unit? }` 对象 |
| `MATERIAL_CATEGORY_RULES_MISSING` | ERROR | 有效叶子没有有效属性绑定 |
| `MATERIAL_ATTRIBUTE_METADATA_INVALID` | ERROR | 属性定义 metadata 无法安全解释 |
| `MATERIAL_VALIDATION_METADATA_UNAVAILABLE` | ERROR | metadata 读取失败 |
| `MATERIAL_ATTRIBUTE_REQUIRED` | ERROR | 缺少必填属性或必填值为空 |
| `MATERIAL_ATTRIBUTE_NOT_BOUND` | ERROR | 属性未绑定当前分类 |
| `MATERIAL_ATTRIBUTE_TYPE_INVALID` | ERROR | 属性值原生类型错误 |
| `MATERIAL_ATTRIBUTE_TYPE_UNSUPPORTED` | ERROR | metadata 类型不在 V1 支持范围 |
| `MATERIAL_ATTRIBUTE_UNIT_REQUIRED` | ERROR | 有标准单位的数值属性未提供单位 |
| `MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE` | ERROR | 属性单位与标准单位量纲不兼容 |
| `MATERIAL_ATTRIBUTE_UNIT_NOT_ALLOWED` | ERROR | 无单位属性提供了单位 |
| `MATERIAL_ATTRIBUTE_ENUM_INVALID` | ERROR | 枚举值不在允许集合 |
| `MATERIAL_BRAND_UNKNOWN` | WARNING | 品牌使用明确未知占位值 |

## 12. 示例

### 12.1 缺少 FR4 厚度

```json
{
  "valid": false,
  "errors": [
    {
      "code": "MATERIAL_ATTRIBUTE_REQUIRED",
      "severity": "ERROR",
      "field": "attributes.THICKNESS",
      "attribute_code": "THICKNESS",
      "message": "缺少必填属性：厚度"
    }
  ],
  "warnings": []
}
```

### 12.2 铜厚单位错误

```json
{
  "valid": false,
  "errors": [
    {
      "code": "MATERIAL_ATTRIBUTE_UNIT_INCOMPATIBLE",
      "severity": "ERROR",
      "field": "attributes.COPPER_THICKNESS.unit",
      "attribute_code": "COPPER_THICKNESS",
      "message": "属性“铜厚”的单位与标准单位不兼容",
      "metadata": {
        "canonical_unit": "um",
        "allowed_units": ["mm", "um"]
      }
    }
  ],
  "warnings": []
}
```

### 12.3 未知品牌警告

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "code": "MATERIAL_BRAND_UNKNOWN",
      "severity": "WARNING",
      "field": "attributes.BRAND.value",
      "attribute_code": "BRAND",
      "message": "品牌为未知占位值，请人工确认"
    }
  ]
}
```

## 13. 测试设计

测试使用 Node `node:test` 和 `node:assert/strict`，不连接生产 D1。

### 13.1 Memory Repository 单元测试

Memory Repository 接收测试内构造的分类和属性 metadata，覆盖：

1. FR4 正确。
2. FR4 缺厚度。
3. FR4 铜厚单位错误。
4. 电阻正确。
5. 电阻缺阻值。
6. 电阻功率类型错误。
7. 锡膏正确。
8. 锡膏合金枚举错误。
9. 基础字段缺失及非法 `source_type`。
10. 分类不存在、停用和非四级叶子。
11. 属性 code 小写或非法格式。
12. 顶层或条目包含 `attribute_id`。
13. 未绑定属性。
14. 未知品牌只产生 WARNING 且不阻断审核。
15. 不支持的 metadata 类型和损坏枚举 metadata。
16. Repository 读取异常被转换为脱敏结构化错误。

### 13.2 隔离 D1 Metadata 变化测试

使用本机一次性 Miniflare D1：

1. 应用现有 `0000`、`0001` migration。
2. 直接插入合成分类、属性定义和绑定，不导入或读取 seed。
3. 通过 D1 Repository 校验同一输入。
4. 在测试事务范围内修改 `is_required`、`canonical_unit` 或 `allowed_values_json`。
5. 再次校验同一输入，确认结果立即反映新 metadata，证明服务没有运行时 seed 依赖或陈旧缓存。
6. 测试结束销毁临时 D1，不保留业务数据。

## 14. 验收与安全边界

实施完成必须满足：

- `npm run lint`
- `npm test`
- 使用隔离环境运行 `tests/erp-api-smoke.mjs`
- `git diff --check`
- 凭证检查
- 根仓库最终变更只包含校验模块、测试和规定文档/项目状态更新
- 未连接生产 D1、未创建真实物料、未修改 API、页面、迁移或下游业务

任何生产 metadata 修改、部署或 API 接入都需要独立任务和用户明确授权；本文件不构成生产操作授权。

## 15. 实施结果

`PHASE1-TASK04` 已按本规格实现并完成隔离验证：

- 新增 `app/lib/material-validation/`，包含 Types、D1/Memory Repository、Rules、Service 和统一导出。
- D1 Repository 每次调用读取 `material_categories`、`material_category_attributes` 和 `material_attribute_definitions`，不导入 seed、不缓存 metadata。
- 实现本文件列出的 25 个稳定结构化 code，其中 24 个 `ERROR`、1 个 `WARNING`。
- 新增 22 个顶层测试及 6 个子测试，共 28 个校验测试；完整 Node 测试为 40/40 通过。
- 隔离 D1 测试确认标准单位、枚举、必填、属性定义状态、绑定状态和分类状态变化在下一次调用生效。
- `npm run lint`、`npm test`、隔离 API 烟测、凭证检查和 `git diff --check` 通过；lint 保留 1 个与本任务无关的既有警告。
- TypeScript 全量检查仍只报告 `db/schema.ts` 第 129、243 行的既有 Drizzle 自引用类型错误；新增模块没有类型错误。
- 未接入 API、页面或生产环境，未创建真实物料，未修改 schema、migration、BOM、采购或库存。

当前已知限制：没有品牌主数据字典；`mm`/`um` 只做单位兼容判断、不换算数值；`DATE` 暂不支持；不检测跨物料重复或候选冲突；`source`、`confidence` 暂不参与决策。
