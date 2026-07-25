# 自托管迁移状态机与 Checkpoint

## 运行状态

`CREATED`、`INSPECTED`、`PLANNED`、`BLOCKED`、`DRY_RUN_PASSED`、`COMMITTING`、`COMMITTED`、`RECONCILED`、`FAILED`、`CANCELLED`。

允许主路径为：

```text
CREATED -> INSPECTED -> PLANNED -> DRY_RUN_PASSED
        -> COMMITTING -> COMMITTED -> RECONCILED
```

Validate/Plan 发现确定性问题进入 `BLOCKED`；运行异常进入 `FAILED`；只有未完成运行可 `CANCELLED`。`COMMITTED` 后 Reconcile 失败保持非成功状态，不得 Finalize 为完成。

## Checkpoint 契约

每个阶段 checkpoint 保存阶段、完成时间、输入 digest、前一 checkpoint digest、输出安全摘要和工具版本。输入 digest 绑定 manifest schema/source snapshot/source file SHA、mapping registry、normalization、目标版本/Git/migration checksum、execution mode 与 plan。任何字段改变后旧 checkpoint 返回 `CHECKPOINT_STALE`。

逐行结果只保存 opaque source reference、domain、`MIGRATED/SKIPPED/BLOCKED/CONFLICTED`、安全 code 和目标 stable ref；不保存源行、姓名、联系方式、地址、密码、Token 或业务正文。

## 恢复

执行器以领域和 chunk 为原子 checkpoint，写入目标与 ID map 成功后才提交 checkpoint。中断恢复先验证所有 digest，再从最近完成 chunk 开始；目标幂等键和 ID map 防止重复创建。测试注入的中断不能将运行标为 COMMITTED。
