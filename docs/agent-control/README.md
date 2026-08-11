# 晨亿达ERP Agent Control Plane — R1只读边界

当前只实现`AGENT-R1`无状态只读巡检器。命令：

```bash
python3 -B tools/erp_agent_control/readonly_controller.py --repo /opt/erp --pretty
```

控制器只读取本地Git元数据、项目权威文档、活动任务Packet、`package.json`及PostgreSQL Migration文件，并将一个版本化JSON报告写到stdout。退出码`0`表示`READY`或`IDLE`；退出码`2`表示`STATE_RECONCILIATION_REQUIRED`；意外的控制器内部错误使用`70`。

R1没有输出文件参数，不创建数据库、缓存、日志、锁、租约或后台进程，也不执行修复。它不连接网络、UAT、生产或数据库，不运行SQL、Migration、build、deploy、backup/restore或Compose命令。报告中的UAT版本只表示权威Markdown声明通过本地匹配，不是在线核验。

机器可读Task Packet位于`docs/agent-control/task-packets/<TASK-ID>.json`。Packet只保存非敏感控制元数据，包括活动任务身份、Git基线、允许变更路径、必读文档、源码/Migration期望和文档声明的UAT边界。R1验证Packet但不写回；缺失、损坏、状态不一致或漂移均失败关闭。

R1不实现D-113中的Control Store、active slot、两阶段状态转换、独立Unix/容器身份、路径租约、fencing、Policy Engine、命令/秘密代理、Capability Broker、Agent调度、UAT能力或生产能力。这些属于未授权的R2及以后阶段。
