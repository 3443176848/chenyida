# Supplier Mapping 治理 V1

适用版本：`chenyida-erp-selfhosted@0.1.0-alpha.39` / PostgreSQL `0038_supplier_mapping_governance.sql`

任务：`SELFHOST-UAT-FIX-20`

## 1. 权威边界

- `supplier_mappings` 继续是 Supplier/Material Mapping 正文和版本的唯一关系化权威表；没有建立第二套正文模型。
- `mapping_uid` 是跨版本稳定 Mapping ID，`mapping_version_no` 是只增版本号，数据库行 `id` 是不可变版本事实 ID。
- `supplier_mapping_events` 保存 CREATED、DRAFT_EDITED、SUBMITTED、APPROVED、REJECTED、NEW_VERSION_CREATED、SUPERSEDED 的不可变成功事实。
- `supplier_mapping_supplier_part_keys` 是 Supplier 范围内 supplier part number 的稳定占用边界，不承载 Mapping 正文。
- 旧 `/api/mappings` 不再允许一步创建 ACTIVE 或直接修改状态；治理写入必须走 `/api/supplier-mappings`。

## 2. 权限与职责分离

| 角色 | 读取 | 创建/编辑草稿/提交 | 审核队列/批准/退回 | 正文代改 |
| --- | --- | --- | --- | --- |
| purchase | `supplier_mapping.read` | `create`、`edit_draft`、`submit` | 无 | 仅本人 DRAFT |
| operations | `supplier_mapping.read` | 无 | `review_queue`、`approve`、`reject` | 无 |
| engineering | 沿既有规则只读 | 无 | 无 | 无 |
| admin / manager | 按既有继承规则 | 有 | 有 | 仍受状态与自审门禁 |

创建人不得审核自己的 Mapping；purchase 的审核请求和 operations 的正文编辑请求都由服务端返回 403。页面隐藏按钮不是授权依据。

## 3. 生命周期

```text
DRAFT -> PENDING_REVIEW -> ACTIVE
                        -> REJECTED
ACTIVE / REJECTED -> 新 DRAFT 版本
ACTIVE -> INACTIVE（仅由获批替代版本在同一事务中固化）
```

- DRAFT 只有创建人可按 `expected_version` 修改或提交。
- SUBMIT 后正文冻结；REJECT 必须有原因；APPROVE 后才进入 RFQ 当前有效范围。
- ACTIVE、REJECTED、INACTIVE 和历史 Event 不允许直接 UPDATE/DELETE。
- 每个 Supplier/Material 的 ACTIVE 1:1 Mapping 有效期不得重叠；同一 Supplier 的规范化 supplier part number 唯一。
- 批准替代版本时，旧 ACTIVE 在同一事务内转为 INACTIVE，并建立前后版本引用；失败不留下半记录。

## 4. 物料、单位与有效期

- Supplier 必须 ACTIVE；Material 必须 ACTIVE 且有正式 `CYD-…-NNNNNN` 内部编码。
- 主单位优先使用 `material_master.base_unit_id`；对既有正式 Material，如果该列为空，则复用 BOM 治理已确认的兼容规则：`base_uom` 必须精确匹配唯一启用的 `units.code`，并把匹配到的 Unit ID 作为稳定内部单位。无匹配时失败关闭，不回填或猜测主 UAT 数据。
- Supplier Unit 必须是启用 Unit；换算使用受控正整数有理数并约分；RFQ V1 只接受分子等于分母的 1:1 Mapping。
- 有效开始/结束按 Asia/Shanghai 日期边界转换，结束日不含；结束必须晚于开始。

## 5. API 与事务保护

- GET：列表、审核队列、Supplier/Material/Unit 编码优先有界搜索、RFQ coverage。
- 写入：创建、草稿 CAS 编辑、提交、批准、退回、新版本。
- 所有写入要求服务端权限、可信 Origin、Cookie/Header CSRF、64 KiB 正文上限、Idempotency-Key、canonical request digest、限流、CAS 和并发唯一性。
- Mapping、版本关系、Event、Audit 和 Idempotency 在一个 PostgreSQL 事务内提交；故障注入验证回滚后零半记录。
- 错误返回稳定 code、中文 message 与 request_id；Audit 只记录稳定对象、结果和安全摘要，不记录完整敏感备注或凭据。

## 6. RFQ 覆盖率合同

RFQ 页面和 create/issue 服务端复用 `loadSupplierMappingCoverage`。每个申请行同时满足以下条件才算覆盖：

1. Supplier ACTIVE；
2. Material ACTIVE、正式编码且申请 Unit 等于解析后的主单位；
3. Mapping ACTIVE；
4. Supplier/Material/Unit 精确匹配；
5. 当前时间位于有效期；
6. 换算为 1:1；
7. 唯一命中一条 Mapping。

页面逐 Supplier 显示 `covered/required` 和缺失的 Material ID/正式编码。部分覆盖或零覆盖的 checkbox 必须禁用；伪造请求仍由服务端以 `SUPPLIER_MAPPING_INCOMPLETE` 拒绝，错误只列当前候选 Supplier 和当前 PRQ 的缺失组合。

## 7. 当前并行 UAT 状态

- 0038 与 alpha.39 已部署；主 UAT 目标 2×4 Mapping 仍为 0，RFQ/Quote/Award/PO 仍为 0。
- purchase 主 UAT 只读核对入口、Material 有界搜索、两家 0/4、八个缺失组合和不可选状态通过，业务 POST 为 0。
- operations Canonical 账号仍处于既有 `must_change_password=true`，本任务禁止修改 Canonical 凭据，因此没有完成主 UAT operations 页面登录验收；隔离 PostgreSQL/Chromium 的职责分离和只读审核已通过。
- 在独立身份授权解决 operations 强制改密前，不应开始八条主 UAT Mapping 的端到端创建/审核；本任务没有创建 Mapping 或任何下游单据。
