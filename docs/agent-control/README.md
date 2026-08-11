# 晨亿达 ERP Agent Control — R1 / R1.5

当前实现包含两个无状态、无外部连接的控制工具：

```bash
python3 -B tools/erp_agent_control/readonly_controller.py --repo /opt/erp --pretty
python3 -B tools/erp_agent_control/native_mvp.py \
  --bundle docs/agent-control/pilots/AGENT-R1-5/valid-bundle.json --pretty
```

`readonly_controller.py`兼容`chenyida-erp-agent-task/v1`和`v2`。它只读取本地Git元数据、项目权威文档、活动Task Packet、`package.json`及PostgreSQL Migration文件，并把一个版本化JSON报告写到stdout。退出码`0`表示`READY`或`IDLE`，`2`表示需要状态对账；控制器不写回或自动认领下一任务。

`native_mvp.py`只读取`--bundle`明确指定的单个常规JSON文件，拒绝symlink、hardlink、重复JSON key、缺字段和未知字段。它校验Task Packet、候选链、显式artifact注册表、角色专属Context Manifest、Message、checkpoint、Minority Report、`RESULT_UNKNOWN`恢复和最终候选门禁，并向stdout输出确定性JSON；退出码`0`为`PASS`，`2`为失败关闭。它没有输出文件、Git、subprocess、网络或数据库能力。

版本化合同位于：

- `schemas/task-packet-v2.schema.json`
- `schemas/message-v1.schema.json`
- `schemas/context-manifest-v1.schema.json`

活动Packet位于`task-packets/<TASK-ID>.json`。v2额外固定D-113/D-114、唯一产品写者、六个不复用角色、四项独立门禁、危险能力拒绝和低资源上限。JSON Schema定义严格结构；Python标准库验证器实现交叉对象、摘要、身份、候选、lease/revision与恢复语义。二者都拒绝未知字段。

`pilots/AGENT-R1-5/valid-bundle.json`是完全合成的`chenyida-erp-native-pilot-bundle/v2`试点：candidate v1被ERP/对抗/安全/QA拒绝，candidate v2修复后由新Context重新签核；旧候选PASS不复用，Minority Report有证据化处置，`RESULT_UNKNOWN`先对账再重试。v2内每个Context/Message locator都必须存在于严格artifact注册表，摘要按规范JSON payload重算；Context文档集合再按角色和candidate白名单匹配，Message的`input.artifacts`必须与Evidence locator相等，测试必须绑定`TEST_REPORT`或公开黑盒观察及同一exit code。未引用、伪造或摘要不一致的artifact全部失败关闭。`blackbox/`只含公开合成接口、按风险选择的Persona、预期、确定性harness和观察报告。

R1/R1.5不创建数据库、缓存、日志、锁、后台进程或Control Store，不连接网络、UAT、生产或数据库，不运行SQL、Migration、build、deploy、backup/restore或Compose restart。UAT版本只表示权威Markdown声明通过本地匹配，不是在线核验。独立Unix/容器Agent身份、强制路径租约/fencing、Policy/Capability Broker、秘密代理、daemon及真正的持续调度仍属于未授权R2；当前身份隔离除黑盒容器挂载外仍由Task Packet、原生Agent上下文和人工编排维持，不能宣称为OS级强制。
