# 自托管非生产运维基线

当前 `chenyida-erp-parallel` 为运行中的 `PARALLEL HTTP ACCEPTANCE ONLY` 空环境；访问、状态、日志、重启和资源停止流程见 `parallel-http-acceptance.md`。它不是生产上线，不迁真实数据、不切流。

## TASK05 采购履约并行验收基线

- 当前应用版本为 `0.1.0-alpha.19`，PostgreSQL 已应用 `0001`—`0019`；Web 只监听 `127.0.0.1:3000`，PostgreSQL 不映射宿主端口。
- 业务入口为采购 `/procurement/fulfillment`、仓库 `/warehouse/receiving`、财务 `/finance/payables`。操作必须使用对应角色，不能用页面隐藏代替服务端授权。
- 到货计划不增加库存、不创建采购财务来源或 AP；warehouse 过账 Receipt 后才原子更新 PO/计划、Ledger/Balance 与 purchase source；finance 必须再次显式核对生成 AP。
- 已过账 Receipt 不允许原地修改。冲销必须走原编排入口；若来源已经生成 AP，系统返回稳定冲突并保持全链不变。
- TASK05 验收完成后的标准空态是：19 migrations、唯一启用管理员、零临时账号、零采购/库存/财务及 Phase 4 合成业务、空 uploads/attachments。恢复或清理后必须重新核对这些计数。
- 本基线不授权真实数据迁移、生产部署、HTTPS、切流、付款/总账、生产制造或品质流程。

## Dashboard 与根工作台

- 根 `/` 是原生 Vinext 工作台，负责 setup/login/session/must-change/logout、权限裁剪的经营指标、风险和模块入口；不得重新嵌入 legacy iframe。
- `/erp/index.html` 仅作为显式 legacy 业务工作区和回滚证据，`?tab=` 只接受源码白名单。
- `/api/summary` 与 `/api/management-dashboard` 只读实时查询 TASK02—TASK09 PostgreSQL 权威关系表；不读取 `erp_records`，不跨单位相加库存。
- 最近系统审计要求 `system.audit.read`；备份治理状态要求 admin 的 `system.backup.read`。

## 备份治理状态

Web 通过只读 `ERP_BACKUP_STATUS_FILE` 读取 `verify-backup-selfhost.sh` 生成的去敏状态。文件缺失、格式错误、权限不足或超限时接口 fail closed 为 `UNVERIFIED`/安全错误，不回显服务器路径或解析细节。创建、校验和恢复命令见 `backup-restore.md`。

## 上线前最低门禁

TASK10 只形成非生产开发基线。真实数据试迁移、生产备份、恢复演练、部署和切换必须另建任务并获得明确授权；执行前至少准备异故障域快照、迁移核对报告、恢复目标、回退条件、HTTPS/访问控制、凭证轮换和人工验收清单。
