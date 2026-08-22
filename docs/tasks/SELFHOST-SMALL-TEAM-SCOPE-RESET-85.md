# SELFHOST-SMALL-TEAM-SCOPE-RESET-85 小团队版范围重置

> 状态：`DONE / SMALL-TEAM RESET RECORDED / TASK70 FROZEN / DOCS ONLY / PRODUCTION NO-GO`
> 日期：2026-08-23（Asia/Shanghai）
> 依赖：项目负责人确认系统实际使用人数少于20人，并明确确认按小团队版重置
> 责任：项目负责人确认产品规模与方向；Codex只更新治理文档、验证边界并创建独立提交

## 1. 目标

把项目优先级从平台级发布控制和合成证据扩展，重新收敛到少于20名内部用户真正使用的ERP业务闭环。此次只记录范围与调度决定，不删除代码、不修改业务行为、Schema、Migration、API、镜像、Compose或运行数据。

## 2. 已确认方向

- 未来唯一生产方向保持自托管，但默认采用最小单体：Caddy、一个Node Web/API应用、PostgreSQL和本地文件存储；只有导入等确需异步处理的任务才保留一个Worker。
- 发布目标简化为“可恢复备份 → 版本化Migration → 替换Web/必要Worker → 健康检查 → 回退上一已知可用版本”，不再扩展自研十五检查点晋升事务、Capability Broker、多智能体运行时或内容寻址控制平面。
- 开发优先级只由真实岗位、真实业务流程、真实数据迁移和员工UAT决定，不再由假设并发、未来组织规模或合成证明缺口自动生成新平台任务。

## 3. 必须保留的底线

- 稳定内部ID与一物一码、关系约束、版本化Migration和可恢复备份。
- 服务端认证授权、关键写事务、幂等、并发控制、审计和稳定错误码。
- 已过账库存、生产、出货和财务事实只通过调整、冲销或反向记录更正。
- 测试与生产隔离，任何真实数据、部署、Migration、恢复和生产动作继续需要明确授权。

这些要求保护数据正确性，与用户人数无关，不属于本次冻结范围。

## 4. 冻结范围

- `SELFHOST-UAT-PROMOTION-DYNAMIC-VALIDATION-70`由`DOING`转为`BLOCKED / OWNER-REQUESTED SMALL-TEAM RESCOPE`；既有源码与部分证据保留为历史，不再因磁盘恢复而自动续跑。
- TASK59—TASK82已完成的发布、监控、授权和回退控制平面只保留为历史实现，不继续扩展或激活；实际备份恢复能力、安全修复和最小部署脚本可在后续小团队基线中按需复用。
- D-113/D-114的R2—R5、多智能体Runtime、Control Store、lease/fencing和Capability Broker继续`NOT AUTHORIZED`，且不再是当前路线候选。
- 外部AI、AI采购/报价/生产辅助及未启动的产品AI任务继续冻结。
- 在核心业务范围获确认前，不新增业务模块、表、Migration、角色、控制面或基础设施。

## 5. 不做破坏性清理

本任务不删除TASK59—TASK82、TASK70、既有Migration、Schema、测试或历史文档。后续只有完成依赖盘点、确认没有运行时引用、提供恢复点并经项目负责人批准后，才可在独立任务中删除或归档代码。

## 6. 下一步输入

下一阶段只形成一页小团队业务基线，至少确认：

1. 实际用户及岗位，不按现有技术角色数量倒推组织。
2. 每天或每周真实发生的8—10条端到端业务流程。
3. 必须上线的单据、状态、审批、报表和数据迁移范围。
4. 当前UAT中哪些流程已经可用、哪些存在真实阻断。
5. 现有源码的`KEEP / PARK / REMOVE_LATER`清单。

项目负责人确认该业务基线前，保持零`DOING`，不自动开始代码精简、Migration、部署或员工账号操作。

## 7. 验收边界

- D-166、MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS和TASK70状态已对齐；当前状态搜索只剩带明确历史日期的TASK70旧`DOING`事实。
- 变更只涉及Markdown治理文档；用户既有未跟踪`docs/ERP_CURRENT_STATUS_REPORT.md`保持不读、不改、不提交。
- Python基线：`server.py --self-test`、项目虚拟环境下`smoke_test.py`及`go_live_check.py --no-backup`均通过。smoke首次误用系统Python，因缺`openpyxl`在导入阶段失败；改用既有项目虚拟环境后通过，未安装依赖。
- `go_live_check.py`首次按默认行为生成本任务时间戳备份`erp-backup-20260823-040937.sqlite3`；核对精确路径后只删除该本次生成文件，再以`--no-backup`通过。没有清理任何其他备份或数据库。
- 自托管Node发布合同在断网、只读挂载、单容器和资源限额下通过76/76；配套Python fixed-executor合同通过130/130。lint退出0，为0 error/50个既有warning。
- 历史D1 `tests/erp-api-smoke.mjs`不属于当前Node/PostgreSQL运行面且依赖已退役Wrangler；本任务未为旧smoke恢复依赖，也未启动PostgreSQL测试库、Migration、Docker build、备份恢复或Compose变更。
- `git diff --check`通过；完成后创建独立Git提交，不push、不部署。

## 8. 资源与清理记录

- 任务前：available memory约2.4GiB，Swap 145MiB/1GiB，根分区可用约11GiB，Load为`0.49/0.50/0.36`。
- 任务后：available memory约2.4GiB，Swap 147MiB/1GiB，根分区可用约11GiB，Load为`0.16/0.35/0.35`；全部指标保持在低资源停止线以内。
- 四个既有服务保持running，Web/PostgreSQL healthy；restart均为0、容器OOM均为false，宿主`oom_kill=0`。`docker compose ps`因本机缺少必填release deployment ID配置而无法渲染，未补写或修改配置；改用只读`docker ps`与`docker inspect`完成运行状态核验。
- 本任务未留下测试容器；只删除精确确认由本任务创建的`erp-backup-20260823-040937.sqlite3`，没有删除其他备份、镜像、容器、网络或Volume。
