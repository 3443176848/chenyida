# 有界持续运行与故障恢复

## 1. Progress Loop

持续运行是一个可中断的确定性循环，不是一段永不结束的Agent对话：

```text
reconcile authority and checkpoint
  -> select one ready DAG node
  -> acquire exact capability and lease
  -> execute one bounded action
  -> validate result and side effects
  -> append message/evidence/checkpoint
  -> release heavy resources
  -> continue, PARK, ACCEPT, or BLOCK
```

每轮都必须有hard deadline、命令/Token/资源预算和幂等键。等待人工、外部服务或资源窗口时进入`PARKED`并释放Agent会话和租约，由新事件唤醒；不得忙轮询。

## 2. 失败分类与自动动作

| 分类 | 例子 | 自动处置 |
| --- | --- | --- |
| `IMPLEMENTATION_DEFECT` | 类型、编译、lint、单测、逻辑错误 | 定位最小原因、修复、形成新candidate、重跑相关门禁 |
| `TEST_ENVIRONMENT` | 临时端口、缺本地依赖、fixture损坏 | 证明环境问题，改用仓库批准隔离方式；不降低断言 |
| `CONTRACT_MISMATCH` | 代码与Task/Decision/Schema不一致 | 回PLANNING；以权威链澄清，必要时专家复核 |
| `CONCURRENCY_RECOVERY` | CAS、幂等、timeout-after-commit | 故障注入、只读对账、修复事务/重放合同 |
| `RESOURCE_PRESSURE` | RAM/Swap/Load/磁盘触线 | 停新重任务、保存检查点、清理精确临时资源、PARK |
| `CAPABILITY_DENIED` | 路径、网络、DB、Git或部署未授权 | 若任务可在现权限内完成则重规划；否则形成真BLOCKED |
| `EXTERNAL_TRANSIENT` | 已授权依赖短暂不可用 | 指数退避且不保持重资源；到预算后寻找安全替代 |
| `RESULT_UNKNOWN` | 进程在可能写成功后中断 | 禁止重放；先按对象/幂等键只读对账 |

普通代码冲突、依赖错误、测试或Migration测试失败都属于待诊断工作，不是立即询问用户的理由。

## 3. Retry与Failure预算

- 同一`failure_fingerprint`最多2次直接重试；没有新假设或新Evidence的重复不算progress并禁止继续。
- 第2次失败后必须由Orchestrator选择：缩小问题、创建对应专家、改变实现策略或回到合同层。
- 每个工作项有总attempt、wall-clock、Token和重任务预算；Task Packet可按风险收紧。
- Reviewer/Security/QA拒绝后的修复产生新SHA和新attempt；旧签核不能累积成多数票。
- 预算耗尽本身触发重新规划。只有安全替代和已知方案都被证据排除后，才满足真BLOCKED。

## 4. Deadlock与No-progress检测

控制器维护等待图：Agent/工作项 → lease、能力、Evidence、决定或外部事件。以下情况触发deadlock分析：

- 两个工作项相互等待对方租约或输出；
- 连续两轮消息摘要相同、无新Evidence；
- 同一candidate在Reviewer与Developer之间重复相同修复；
- Agent持有lease却超过heartbeat/hard deadline；
- 必需门禁等待已经失效的candidate。

恢复优先级是：撤销过期lease并提升fencing epoch → 串行化工作项 → 取消低优先级只读角色 → 回到共同合同 → 由独立专家验证冲突。不得通过给所有Agent更多写权限解锁。

## 5. 真 BLOCKED 合同

只有以下情况允许把正式TASKS状态改为`BLOCKED`并请求人工：

1. 缺少仓库中不存在且无法安全推导的业务决定；
2. 需要无法取得的凭据或新的外部权限；
3. 需要UAT/生产访问、业务写、Migration、部署或发布授权；
4. 需要不可逆或难恢复的高风险操作；
5. 两个已接受权威决定发生无法按权威链解决的冲突；
6. 外部服务不可用且没有安全、范围内的替代方案；
7. 达到明确Retry/Failure预算后，已更换假设、采用专家和最小实验仍无法确定安全正确方案；
8. `RESULT_UNKNOWN`无法通过只读证据判定，重放可能产生重复业务事实。

BLOCKED记录必须包含`blocker_type`、证据、已尝试动作、未采用替代及理由、潜在损害、解除主体、所需最小决定、恢复检查点和资源清理结果。仅写“需要用户确认”不合格。

## 6. 检查点

每个完整检查点至少保存：

- task/packet revision、阶段、DAG完成节点；
- branch、base/candidate/tree、dirty paths及用户文件排除清单；
- agent/role、Context Manifest digest、能力和到期时间；
- lease token/version/fencing epoch/heartbeat；
- 已执行动作、幂等键、命令结果和Evidence IDs；
- 可能的外部/DB/Git副作用及确认状态；
- retry/failure/Token/资源剩余预算；
- 未决veto、Minority Report、blocker和下一唯一动作。

检查点是追加记录；完成标记和Evidence摘要必须原子闭合。只有半条记录时视为未完成，恢复进入只读对账。

## 7. 中断恢复协议

1. 新实例只读加载L0—L2和最后完整检查点。
2. 核验TASKS唯一状态、Task Packet revision、Git branch/base/candidate、worktree归属和用户既有改动。
3. 核验lease是否过期；提升fencing epoch，确保旧实例不能提交消息或写入。
4. 逐项检查记录的副作用。Git用对象ID，DB用幂等键/审计，HTTP用request ID；不得凭退出日志猜测。
5. 若动作确定未发生，重新发放新attempt能力；确定已发生则从后续节点继续；不确定则`RESULT_UNKNOWN`并保持只读。
6. 重新采集资源快照、生成新Context Manifest，再执行一个有界动作。

恢复不得自动fetch/pull、stash用户改动、重启Compose、删除资源或连接UAT/生产。

## 8. 崩溃后的安全状态

控制器或Agent崩溃时，所有短时能力过期、写租约不自动转移、正式任务保持原状态。ERP产品运行面不依赖控制器，因此继续独立运行；控制面恢复失败只会停止研发调度，不会尝试“修复”ERP数据库或服务。
