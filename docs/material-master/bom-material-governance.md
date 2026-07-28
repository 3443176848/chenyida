# BOM 物料规格标准化与主数据治理

## 定位与运行边界

本模块是自托管 Node.js/PostgreSQL 运行面的非生产治理层，版本为 `0.1.0-alpha.35`，规则版本为 `bom-material-governance-v1`。它消费已经发布的 Material Import Normalization 结果，不另建第二套 CSV/XLSX 解析器，也不修改 Python/SQLite 或历史 D1。

本任务只交付源码、`0035_bom_material_governance.sql` 和隔离测试。迁移尚未应用到当前常驻 PostgreSQL，未部署 Web/Worker，未读取或回填真实 BOM。

## 数据流

```text
CSV/XLSX 导入
  -> Parser/Mapping/Normalization（现有链路）
  -> 确定性分类与精确规格解析
  -> READY / REVIEW_REQUIRED / UNSUPPORTED
  -> 严格身份分组与来源追溯
  -> ACTIVE 候选、替代候选、异常和映射报告
  -> 人工 BIND_EXISTING / CREATE_DRAFT / EXCLUDE
  -> 既有 Material Workflow 审核后生成正式 ERP 编码
```

字段识别、合并表头、前言/重复表头/页脚/合计行处理继续由现有自适应 Import、Mapping 与 Normalization 负责。公式、错误单元格、字段冲突和无法安全解释的值不会被当成空白或静默丢弃，而是进入异常证据。

## 身份规则

名称、供应商料号、原始料号和自由文本描述都不是通用唯一键。`identity_digest` 由规则版本、类别、身份参数和性能等级的规范值共同生成，使用精确十进制量纲，不用 JavaScript 浮点近似判等。

| 类别 | 严格身份/性能组成 | 自动处理边界 |
| --- | --- | --- |
| RES | PACKAGE + RESISTANCE + TOLERANCE + POWER | 仅命名配置可解码 `0201WMJ0000TCE`；只有 0201 配置允许补 `1/20W` |
| CAP | PACKAGE + CAPACITANCE + VOLTAGE + DIELECTRIC + TOLERANCE | `1uF`、`100nF`、`100pF` 分别保留精确量纲，缺任一必需项不建严格身份 |
| IND | PACKAGE + INDUCTANCE + RATED_CURRENT + TOLERANCE | 缺额定电流等必需项进入复核 |
| DIODE / TRANS / IC | 完整 MODEL/MPN + PACKAGE | 不做型号词干、模糊或近似合并 |
| OSC | MODEL + PACKAGE + FREQUENCY | 只接受版本化封装画像；兼容项只生成建议 |
| CON | BRAND + MODEL + PIN_COUNT + PITCH + STRUCTURE | 品牌双字段冲突、占位品牌和结构缺失均 fail closed |
| MECH / OTHER | 当前无可批准严格身份模板 | 保留来源并进入异常，不自动建稿 |

任何必需规格、性能等级、显式来源或分类证据冲突都会产生稳定 issue code。负数物理量不会被分隔符吞掉后变成正数；除电阻允许 `0R` 外，正数型物理量必须大于零。

## PostgreSQL 变化

迁移 `0035_bom_material_governance.sql` 为 expand-only，新增九张关系表：

- `material_governance_runs`：绑定发布的 normalization run、规则版本和配置摘要。
- `material_governance_groups`：严格身份组、规范规格、readiness、CAS 决策状态。
- `material_governance_rows`：原始行、料号、描述、BOM、数量/单位和解析问题的不可变追溯。
- `material_governance_specs`：按来源行保存 IDENTITY、PERFORMANCE、DESCRIPTIVE 规格及证据。
- `material_governance_material_candidates`：运行时 ACTIVE 精确或兼容复核候选快照。
- `material_governance_alternative_candidates`：只读替代候选，不是正式替代关系。
- `material_governance_decisions`、`material_governance_material_links`、`material_governance_events`：人工决定、稳定 `material_id` 关联和不可变历史。

正式物料继续使用既有 `material_master`、`material_attribute_values`、版本、变更和审计表；正式编码仍只在现有 Material approval 事务内生成。该设计对应需求中的主数据、规格、原始映射、替代候选和 BOM 导入记录，但不复制第二套 `materials` 权威表。

0035 同时为 `material_import_mappings` 新增 `header_start_row_number`、`header_end_row_number`、`data_start_row_number`、`structure_confidence`、`structure_status`、`adaptive_algorithm_version` 六个自适应结构证据字段；以 v2 metadata 新增 DIELECTRIC、RATED_CURRENT、STRUCTURE、FREQUENCY 四个属性和六个分类节点，提升电容/电感等精确小数精度并扩展必需规格叶子绑定。迁移增加来源边界、外键、唯一索引、CHECK、服务事务守卫和事实不可变触发器。生产执行前仍必须先做可恢复快照、0034 只读试迁移和数据核对。

## API

所有路径都要求现有 Session；写请求还要求同源 CSRF、`X-CSRF-Token`、`Idempotency-Key`，响应带 `X-Request-ID` 和 `Cache-Control: no-store`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/material-master/import-batches/{batchId}/governance` | 读取最新治理运行 |
| GET/POST | `/api/material-master/import-batches/{batchId}/governance-runs` | 分页列出/创建运行 |
| GET | `/api/material-master/import-batches/{batchId}/governance-runs/{runId}` | 运行摘要 |
| GET | `.../{runId}/groups`、`.../{runId}/groups/{groupId}` | 分页候选组与完整证据 |
| GET | `.../{runId}/rows?exceptions_only=true` | 来源追溯或异常行 |
| POST | `.../{runId}/groups/{groupId}/decision` | `BIND_EXISTING`、`CREATE_DRAFT` 或 `EXCLUDE` |
| GET | `.../{runId}/reports/{kind}` | `materials`、`bom-mapping`、`duplicates`、`exceptions`、`alternatives` |

创建运行的正文只接受当前已发布 normalization 和批次 CAS：

```json
{
  "normalization_run_id": 123,
  "expected_version": 7,
  "rule_version": "bom-material-governance-v1"
}
```

绑定既有正式物料时，服务端锁定当前 ACTIVE 行并实时重算完整身份；即使 ACTIVE 是运行快照之后产生，只要身份精确相同仍可收敛绑定。决定记录会保存 `RUN_SNAPSHOT` 或 `LIVE_REVALIDATED` 证据：

```json
{
  "expected_version": 1,
  "decision_type": "BIND_EXISTING",
  "reason_code": "EXACT_SPEC_CONFIRMED",
  "comment": "已核对完整规格",
  "material_id": 456
}
```

创建草稿必须提交目标分类当前 metadata 所需的完整 `basic_fields` 和 `attributes`。服务端会再次重算身份，只有与候选组完全相同才调用既有 Material Workflow 创建一个未编码 DRAFT；后续 PATCH、submit 和 approval 都继续验证不可变治理身份。

## 权限与并发

- `material.import.governance.read`：读取运行、组、行和报告。
- `material.import.governance.run`：从已发布 Normalization 创建或复用确定性运行。
- `material.import.governance.decide`：提交组决定。
- `material.import.governance.bind`：绑定精确 ACTIVE。
- `material.import.governance.create_draft` 与 `material.draft.create`：创建治理草稿。

同一严格身份使用 PostgreSQL transaction advisory lock。治理建稿、普通草稿批准和治理草稿批准共享同一锁序；同身份只能有一条路径成功。`CREATED_DRAFT` 关系在 DRAFT/PENDING_REVIEW 状态保留身份，普通草稿不能抢占正式编码。业务记录、关联、版本、幂等结果和审计均在同一事务提交。

旧逐行 Import Review 对受治理类别禁止 `CREATE_DRAFT`，也禁止把受治理来源或目标通过 `BIND_EXISTING` 绕过本模块。

## 报告与追溯

- `materials`：治理键、标准名称、规范规格、类别、readiness、ERP 编码和决定状态。
- `bom-mapping`：项目/BOM、原始料号、原始描述、数量/单位、治理键、`material_id` 和 ERP 编码。
- `duplicates`：同组所有原始来源及 `merge_evidence`，解释为什么归并。
- `exceptions`：无法分类、缺规格、冲突、上游 normalization 错误和稳定 issue code。
- `alternatives`：同身份不同来源的 primary/alternative source 候选，以及型号敏感类别的兼容组建议。

追溯关系为：

```text
material_master.id
  <- material_governance_material_links
  <- material_governance_groups
  <- material_governance_rows
  <- normalized/source row
  <- import batch / source BOM
```

替代项只供人工复核。本版本不会自动写正式 Supplier Mapping 或正式替代关系，也不会自动批准物料。

## 已知限制与后续处置

1. 历史 ACTIVE/FROZEN/INACTIVE 若缺少 v2 身份属性、基础字段与结构化字段冲突，或无法按当前规则可靠重构，同治理大类的新建稿/批准会安全阻断。当前版本没有修改 ACTIVE 属性的 API，不得猜测回填；需要另立受控主数据修订任务后重新治理。
2. 已配置的旧 CAP 介质缺失、IND 额定电流缺失、CON 结构缺失和历史 CON 品牌冲突只形成兼容复核证据，不会自动合并。
3. 治理草稿的冻结 `identity_digest` 包含规则版本；旧草稿不支持跨规则版本继续编辑/提交。升级规则前必须先处置未完成组或另立迁移任务。
4. 当前无治理 UI；通过受控 API/测试客户端使用。UI、正式替代料审批、客户专用料、单位换算过账、正式 BOM 自动改绑、真实数据迁移和部署均不在本任务范围。

## 验证命令

在隔离测试数据库和受限 Node 容器中串行运行：

```text
npm run typecheck:governance
npm run test:governance:unit
npm run test:governance:migration
npm run test:governance:migration-upgrade
npm run test:governance:postgres
npm run test:material:postgres
npm run test:normalization:postgres
npm run test:review:postgres
npm run lint
npm test
```

任何 PostgreSQL 测试 URL 都必须明确指向名称含 `test` 的隔离数据库；不得对当前常驻或生产数据库运行这些测试。
