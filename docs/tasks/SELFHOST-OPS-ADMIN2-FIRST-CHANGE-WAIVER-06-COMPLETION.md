# SELFHOST-OPS-ADMIN2-FIRST-CHANGE-WAIVER-06 完成报告

## 结论

- 状态：`DONE / SINGLE-ACCOUNT WAIVER APPLIED`。
- `admin2` 已无需首次改密：账号保持 active admin，`must_change_password=true→false`，version `2→3`。
- 当前密码摘要的不可逆二次指纹前后一致，密码本身没有读取、输出、重设或改写；现有合法 Session 未撤销。
- 这是项目负责人明确授权的单账号例外。全局新建/重置用户“临时密码必须首次改密”策略、API 和 D-045 保持不变。

## 执行与审计

- 正式 API 没有“豁免首次改密”入口，因此没有新增可被日常滥用的通用 API。
- 使用单一 serializable PostgreSQL 事务：任务级 advisory lock、目标行 `FOR UPDATE`、active admin/version 2/must-change true 前置校验、CAS 更新和审计同事务提交；任一失败整体回滚。
- 新增且仅新增一条 `USER_FIRST_PASSWORD_CHANGE_WAIVED/success`、`route_code=IDENTITY` 审计，记录执行者、目标、请求/操作 ID、old/new version、任务 ID、项目负责人授权、单账号范围、未改密码、未撤销会话和未改全局策略；未记录密码、摘要、Token、Cookie 或请求正文。
- 同任务重放实际进入 `already applied` no-op 分支，账号仍 version 3，豁免审计仍为 1 条。

## 前后核对

| 项目 | 前 | 后 |
| --- | ---: | ---: |
| `admin2` active/role | true/admin | true/admin |
| must-change/version | true/2 | false/3 |
| 密码二次指纹 | 基线值 | 与基线相同 |
| Session/有效 | 3/1 | 3/1 |
| `admin2` 有效 Session | 1 | 1 |
| Audit/Identity | 887/15 | 888/16 |
| 豁免审计 | 0 | 1 |
| 身份幂等 | 3 | 3 |
| Migration/head | 34/0034 | 34/0034 |
| Material/Product/BOM/Line | 532/6/6/316 | 532/6/6/316 |

Migration checksum manifest 保持 `b2ff69f7b72db5f5bdd02b0fc6cc4e70dd913e52e1140a4abe1a8c3549d13b8b`。没有修改 Schema、角色权限映射、业务数据、采购/库存/生产/品质/销售/财务事实或四个 ERP 持久卷。

## 服务、资源与边界

- Identity unit `8/8` 通过，证明全局密码策略、must-change 门禁和身份错误映射仍保留。
- 本机/TLS health 与匿名 session API 均为 200。PostgreSQL/Web/Worker/Caddy 的容器 ID 和启动时间未变，restart 0、OOM false；没有 build、restart、Migration 或 deploy。
- 起点与完成时 available memory 均约 2.3 GiB、Swap 约 142 MiB、根盘可用 34 GiB；最终 Load `0.08/0.16/0.12`，内核 OOM 0。
- 两个 task-only SQL 文件执行后已删除，无临时容器或数据库。四个受保护卷、Web 回滚镜像和既有 root-only 备份均保留；未执行任何 prune。
- Git 只提交脱敏任务记录，不包含密码、二次指纹、Token、Cookie、数据库凭据或业务数据；`shujvbiao/` 未修改、暂存、打开或提交。未 push、PR、访问 Sites/D1、上传外部或操作 Python 服务。

## 使用方式

刷新 `https://43.135.157.211.nip.io:18888` 后，当前 `admin2` 会话可直接进入 ERP；若会话失效，使用当前账号和现有密码重新登录即可，不会再出现首次改密页。
