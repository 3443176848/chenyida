# Cutover Snapshot 与 Post-cutover Journey 分类

| 来源/行为 | 分类 | 处理 |
| --- | --- | --- |
| Identity | cutover snapshot plan | 不迁 Session/旧 hash；未知 hash 禁用且 must-change；测试 admin 由受控 setup 建立 |
| Unit/Category/Material/Customer/Supplier/Product/BOM/Mapping | cutover snapshot | 物化稳定 public ID；code 冲突、缺 Unit/orphan/有效期重叠阻断 |
| 截止日在手/冻结库存 | cutover snapshot | TASK02 `MIGRATION_OPENING`，不伪造 Receipt/Completion/Return |
| 截止日无 Shipment/Receipt 的 AR/AP | cutover snapshot | TASK02 `OPENING_AR/AP`，不伪造历史单据 |
| 小型虚构二进制文件 | cutover snapshot | 新空临时目标、相对路径、SHA/size/MIME 合同与 provenance |
| 来源中的历史 PO/WO/SO/Quality/稳定来源 Finance | archive-only plan evidence | 不直接物化或重放，避免与期初重复；无法分类即 BLOCKED |
| 新 PO/Receipt/IQC/AP | post-cutover journey | 使用现有 Procurement/Quality/Finance Service/API |
| 新 WO/领退料/报工/完工/IPQC | post-cutover journey | 使用现有 Production/Inventory/Quality Service/API |
| 新 Quote/SO/FQC/Shipment/AR | post-cutover journey | 使用现有 Sales/Quality/Finance Service/API；FQC 门禁必须真实生效 |
| 收付款与冲销 | post-cutover journey | 使用 Finance Service；原 Document 不修改 |

同一 source stable reference 只能属于一个分类。snapshot 数量/金额和 journey 事件分别核对，不能用历史活动再次过账来“证明”迁移。
