# 物料主数据中心 V2

状态：准备阶段

范围：实施计划、业务决策和验收门禁
本轮不包含业务代码、数据库变更、生产 Site 修改或部署

## 文档索引

- [分阶段实施计划](./phased-implementation-plan.md)
- [需要人工确认的业务决策](./business-decisions.md)
- [当前系统技术审计](../audits/current-system-audit.md)
- [Material Import Batch Foundation V1](./material-import-batch-v1.md)
- [Material Import Parser V1](./material-import-parser-v1.md)
- [Material Import Parser/Mapping OpenAPI](./material-import-parser-v1.openapi.yaml)
- [Material Import Mapping V1](./material-import-mapping-v1.md)
- [Material Import Parser 流程图](./material-import-parser-flow.md)
- [本地 CSV/XLSX/XLS 自适应导入](./local-spreadsheet-import-v1.md)
- [A118/V700 真实 BOM 入库暂存报告](./real-sample-staging-a118-v700.md)
- [电容匹配测试物料 1～5](./matching-test-seed-1-5.md)
- [清洗审核匹配置信度排序 V1](./cleaning-confidence-sort-v1.md)
- [清洗审核安全清空 V1](./cleaning-clear-v1.md)

## V2 目标

物料主数据中心 V2 将建立一个可审计、可迁移、可被 BOM/采购/库存/生产共同引用的内部物料权威源，重点解决：

- 内部物料编码分叉
- 属性模板缺失和自由文本过多
- 供应商名称、料号和品牌/MPN 的多名归一
- 在线导入没有候选匹配
- 新物料一次提交直接建档
- 替代料和客户专用限制未落地
- SQLite、在线 D1 和模板数据无法受控迁移

## 推荐顺序

1. 先确认唯一生产主系统、编码规则、审核角色和数据责任人。
2. 修复在线 Site 源码可恢复性，并建立隔离测试 D1。
3. 以新增表和兼容层建立 V2 关系化数据底座。
4. 迁移导入、标准化、匹配候选和审核流程。
5. 分批切换 BOM、采购、库存和生产引用。
6. 完成试迁移、数据核对、安全验收和恢复演练后，再申请生产迁移与部署授权。

## 推荐的第一项开发任务

在不改变现有页面和读取路径的前提下，建立 **V2 数据契约与版本化迁移测试基线**：

- 确认并固化内部编码与生命周期状态。
- 新增关系化物料、品类属性、供应商映射、导入批次和审核表的首个增量迁移。
- 增加空库、已有数据、重复执行和回滚恢复测试。
- 不导入生产数据，不切换现有 `erp_records` 读取。

该任务完成后，后续匹配、审核和下游切换才有稳定边界。
