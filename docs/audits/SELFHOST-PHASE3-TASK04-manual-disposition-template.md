# TASK04 人工处置清单模板

本次真实只读执行生成的行级 opaque disposition 数为 `0`。以下模板供后续获授权任务使用；不得补入 source ID、业务值或可关联摘要。

| opaque_reference | domain | issue_code | severity | blocking_status | required_decision_type | dependency | recommended_action_category |
|---|---|---|---|---|---|---|---|
| _task-local HMAC only_ | _domain_ | _fixed issue code_ | _BLOCKER/MAJOR_ | _BLOCKED/REVIEW_ | _fixed decision type_ | _domain only_ | _allowlisted action_ |

允许 action category：`MAP_STABLE_ID`、`SELECT_CANONICAL`、`PROVIDE_UNIT`、`FIX_STATUS`、`ARCHIVE_ONLY`、`OPENING_BALANCE`、`DISABLE_ACCOUNT`、`MANUAL_FILE_REVIEW`、`EXCLUDE_WITH_APPROVAL`、`MODEL_CHANGE_REQUIRED`。

4 条 supplier mapping 在表级分类上保持 `NEEDS_BUSINESS_REVIEW`，但本次没有满足行级 blocker/conflict 条件的 opaque ref。执行版的 1 个空料号保守分组不应被人工清单误当作已定位冲突；规则修正后也没有重新读取真实数据。
