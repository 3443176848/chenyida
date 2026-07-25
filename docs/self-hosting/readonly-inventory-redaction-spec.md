# 真实只读盘点脱敏规范

## 输出允许表面

可提交报告只允许：表/列/索引/外键元数据，表总数和行数，固定枚举的预先允许值与计数，NULL/重复/孤儿/格式/精度错误计数，时间最小最大值，字符串长度桶，领域总量与金额/数量聚合，以及不可逆 SHA-256 摘要。

自由文本不得执行或输出 DISTINCT。姓名、账号值、电话、地址、联系人、客户/供应商/物料/产品名称、料号、BOM 正文、备注、密码哈希、Session/Token、业务单号、逐单金额和完整业务行均禁止输出或提交。

## 固定枚举

只有源码或 Schema 中已确认的状态、类型、角色、启停值、币种、检验类型可作为预定义 allowlist 分组。查询使用条件聚合或与固定 allowlist 连接，不输出数据库返回的未知值；未知值只输出总数。

## Opaque reference

需要定位问题行时使用：

`HMAC-SHA256(task-local random key, source-table + NUL + source-id)`

报告保存带类型前缀的截断十六进制 opaque reference，不保存 key、source ID、原始输入或可反推业务编号的 digest。key 只在盘点进程内存中生成和使用，不写文件，进程结束后不可恢复。同一快照内稳定，不同任务默认不可关联。

## 自动拒绝与扫描

写报告前使用结构化 allowlist 校验字段名；写后执行凭证、PII、商业正文、绝对路径、source ID、业务编号模式和远程 URL 扫描。扫描失败则报告不得复制进仓库。Schema SQL 只用于内存 fingerprint，不把含默认业务文本的完整 SQL 写入报告。

## 人工处置字段

处置模板严格只含 `opaque_reference`、`domain`、`issue_code`、`severity`、`blocking_status`、`required_decision_type`、`dependency`、`recommended_action_category`。允许 action category 为 `MAP_STABLE_ID`、`SELECT_CANONICAL`、`PROVIDE_UNIT`、`FIX_STATUS`、`ARCHIVE_ONLY`、`OPENING_BALANCE`、`DISABLE_ACCOUNT`、`MANUAL_FILE_REVIEW`、`EXCLUDE_WITH_APPROVAL`、`MODEL_CHANGE_REQUIRED`。
