# SELFHOST-MATERIAL-REQUIREMENT-DATE-ONLY-FIX-88 需求日期时区无关修复

> 状态：`DONE / P0-01 FIXED IN SOURCE AND ISOLATED POSTGRES / PRODUCTION NO-GO`
> 日期：2026-08-23（Asia/Shanghai）
> 依赖：TASK87、D-168、低资源服务器保护规则
> 责任：Codex实施最小源码/测试修复；项目负责人后续授权真实样本与员工UAT

## 1. 目标

修复Material Requirement把PostgreSQL `date`经JavaScript `Date.toISOString()`转换时受Node本地时区影响的问题，使同一日历日在UTC和Asia/Shanghai下生成、重算、提交和追溯结果完全一致。

## 2. 允许范围

- `app/lib/material-requirement-selfhost/`内可独立测试的date-only规范化及第148、273行等调用点。
- Material Requirement的Unit与隔离PostgreSQL回归测试。
- 必要的项目治理文档更新和独立Git提交。

## 3. 禁止范围

- 不新增或修改Schema、Migration、表、角色、权限、页面、审批、编号或部署结构。
- 不顺带更新全ERP smoke、重构其他模块或恢复TASK59—TASK82高级控制面。
- 不连接/修改UAT或生产数据库、四个受保护Volume、真实数据、账号、备份或运行服务；不build、不deploy。
- 不硬编码每岗2人或总人数18。

## 4. 验收标准

- date-only解析明确拒绝无效值，且对PostgreSQL `date`返回的Date、规范`YYYY-MM-DD`字符串产生同一日历日，不经本地时区漂移。
- Material Requirement隔离PG套件在`TZ=UTC`和`TZ=Asia/Shanghai`均为`8/8 PASS`，生成后立即提交不再错误返回`MATERIAL_REQUIREMENT_RECALC_REQUIRED`。
- 追溯读取使用同一规范化规则；计算摘要、需求日、库存/在途边界和既有失败关闭语义不放宽。
- 运行适用Unit/UI/PG测试、`git diff --check`和敏感信息检查；记录资源、OOM/restart和临时资源清理。
- 更新MASTER、TASKS、PROJECT_CONTEXT、CHANGELOG、STATUS、DECISIONS及本任务文档，创建独立提交；不push、不部署。

## 5. 启动条件

TASK87曾在根盘只比10 GiB硬线高约3.5 MiB时立即停止；清理后虽自然恢复并完成Supplier Mapping补验，但最终仍只高于硬线约12.7 MiB。本任务启动前必须由新的资源检查证明根盘、内存、Swap、Load和OOM/restart全部满足规则，否则保持`TODO`且不得启动Node重测或隔离PostgreSQL；实际启动门已按第8节通过。

## 6. 实施结果

- 在`material-requirement-selfhost/validation.ts`新增单一`normalizeDateOnly`边界：规范字符串继续按真实日历严格校验；PostgreSQL `date`返回的有效`Date`读取Node进程本地日历分量，不再先转换为UTC时间点。无效Date、非法日期及带时间正文均返回既有`REQUIRED_DATE_INVALID / 422`。
- `requiredDate`复用同一规则，因此请求日期和Package回退日期不再形成两套语义；提交重算与采购追溯两个已知消费点也统一调用该边界。
- 计算摘要、库存/在途SQL、Allocation、事务、权限、幂等、CAS、审计和既有失败关闭错误均未放宽；没有Schema、Migration、页面、角色、依赖或部署变化。

## 7. 验收证据

| 验证 | 结果 |
| --- | --- |
| Unit / UTC | `4/4 PASS` |
| Unit / Asia/Shanghai | `4/4 PASS` |
| UI合同 | `6/6 PASS` |
| 隔离PostgreSQL / UTC | `8/8 PASS` |
| 隔离PostgreSQL / Asia/Shanghai | `8/8 PASS` |
| Schema基线 | 全新PostgreSQL 17，顺序应用`0001`—`0046`，public表`233` |
| 静态边界 | 两个已知`required_date`消费点均调用`normalizeDateOnly`；Unit合同固定该事实 |

首次直接调用宿主`node`因宿主未安装Node而在测试前退出；随后通过运行Web容器根文件系统中的只读Node 22.23.2执行本地源码，默认进程隔离又因其内部固定`/usr/local/bin/node`路径在测试前退出。最终使用该Node支持的`--experimental-test-isolation=none`在当前进程执行，以上全部目标测试通过；这两个前置运行时错误没有执行产品断言，也没有修改容器或源码语义。

## 8. 资源、清理与运行面

- 启动门：available memory约2.4 GiB、Swap 171 MiB、根盘`10,758,881,280` bytes、Load `0.03/0.12/0.12`；四服务restart 0/OOM false，Web/PostgreSQL healthy，宿主`oom_kill=0`。
- 唯一临时PostgreSQL 17容器限制为1 CPU/512 MiB，数据目录为tmpfs；46项Migration和两次PG套件均串行。容器启动后根盘仍为`10,768,338,944` bytes，未越过10 GiB停止线。
- 测试后容器因`--rm`精确删除；`cyd-task88-*`容器、`/dev/shm`目录、数据库、端口、网络和Volume残留均为0。清理后available约2.4 GiB、Swap 171 MiB、根盘`10,768,314,368` bytes、Load `0.37/0.28/0.19`；60秒SwapFree为`873,784→873,784 KiB`，增长0。
- 文档收口终检为available约2.4 GiB、Swap 171 MiB、根盘`10,779,873,280` bytes、Load `0.65/0.30/0.20`；常驻四服务restart 0/OOM false，Web/PostgreSQL healthy，宿主`oom_kill=0`。Compose状态命令因缺必填deployment变量无法渲染，已用只读`docker ps/stats/inspect`核验。未连接UAT/生产、未读取受保护Volume/真实数据/凭据/备份，未build、deploy或重启常驻服务。

## 9. 结论与下一步

P0-01已在源码和隔离PostgreSQL层关闭，ST-04可从`FIX_REQUIRED`转为`READY`，十条小团队闭环现为`10 READY / 0 FIX_REQUIRED / 0 PARKED`。这不表示统一现代旅程、真实数据、员工UAT、恢复演练或生产准入完成；下一任务是`SELFHOST-SMALL-TEAM-UNIFIED-GOLDEN-JOURNEY-89`，只补现代接口的同库连续证据。
