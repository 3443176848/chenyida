# 计划交接包规格

计划交接包是项目部提交给计划部的不可变技术/数量快照，不是净需求、采购申请、采购订单或生产指令。

## 包头

- 稳定 Project、Requirement Version、包版本号和目标交期。
- 状态、prepare/submit/return/accept 操作者与时间、退回原因、CAS version、request_id。
- SHA-256 `package_digest` 覆盖包版本、需求版本、交期、明细、BOM 快照和安全文件元数据。

## 每项需求

- Requirement Item、RELEASED Product Version、RELEASED BOM Version。
- 原需求数量、enabled Unit 和需求行号。
- `source_digest` 固化来源关系和 BOM 内容。

## 每条 BOM

- 来源 BOM Line、ACTIVE Material、enabled Unit、单耗、损耗率和行号。
- 毛数量由 PostgreSQL numeric 计算并保存：`required × quantity_per × (1 + loss_rate)`。
- 安全规格快照只含内部物料编码、标准名称、分类、品牌/制造商/型号、基础单位和类型化属性；另存 `material_digest`。

## 文件与不可变规则

文件仅复用 TASK01 `project_document_links`，读取 original filename、MIME、SHA-256、size 和 storage status；API/UI 不返回 storage name、相对/绝对路径或正文。包项、BOM 快照、文件链接和事件插入后不可 UPDATE/DELETE；包头仅允许受控状态转换。退回后 v1 保持原样，项目部以新包版本重提。
