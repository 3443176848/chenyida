# SELFHOST-MATERIAL-REQUIREMENT-DATE-ONLY-FIX-88 需求日期时区无关修复

> 状态：`TODO / P0-01 MINIMAL FIX / PRODUCTION NO-GO`
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

TASK87曾在根盘只比10 GiB硬线高约3.5 MiB时立即停止；清理后虽自然恢复并完成Supplier Mapping补验，但最终仍只高于硬线约12.7 MiB。没有新的资源检查证明根盘、内存、Swap、Load和OOM/restart全部满足规则前，TASK88保持`TODO`，不得启动Node重测或隔离PostgreSQL。
