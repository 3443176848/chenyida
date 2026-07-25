# 自托管非生产运维基线

当前 `chenyida-erp-parallel` 为运行中的 `PARALLEL HTTP ACCEPTANCE ONLY` 空环境；访问、状态、日志、重启和资源停止流程见 `parallel-http-acceptance.md`。它不是生产上线，不迁真实数据、不切流。

## Dashboard 与根工作台

- 根 `/` 是原生 Vinext 工作台，负责 setup/login/session/must-change/logout、权限裁剪的经营指标、风险和模块入口；不得重新嵌入 legacy iframe。
- `/erp/index.html` 仅作为显式 legacy 业务工作区和回滚证据，`?tab=` 只接受源码白名单。
- `/api/summary` 与 `/api/management-dashboard` 只读实时查询 TASK02—TASK09 PostgreSQL 权威关系表；不读取 `erp_records`，不跨单位相加库存。
- 最近系统审计要求 `system.audit.read`；备份治理状态要求 admin 的 `system.backup.read`。

## 备份治理状态

Web 通过只读 `ERP_BACKUP_STATUS_FILE` 读取 `verify-backup-selfhost.sh` 生成的去敏状态。文件缺失、格式错误、权限不足或超限时接口 fail closed 为 `UNVERIFIED`/安全错误，不回显服务器路径或解析细节。创建、校验和恢复命令见 `backup-restore.md`。

## 上线前最低门禁

TASK10 只形成非生产开发基线。真实数据试迁移、生产备份、恢复演练、部署和切换必须另建任务并获得明确授权；执行前至少准备异故障域快照、迁移核对报告、恢复目标、回退条件、HTTPS/访问控制、凭证轮换和人工验收清单。
