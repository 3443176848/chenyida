# SELFHOST-OPS-TRUSTED-ORIGIN-05 完成报告

## 结论

- 状态：`DONE / DEPLOYED / USER FIRST-CHANGE RETRY REQUIRED`。
- Caddy TLS 终止后的合法公网 HTTPS Origin 已不再被 Web 内部 HTTP URL 误判；公网无凭据验收进入 `AUTH_REQUIRED/401`，而不是“请求来源校验失败”。
- `admin2` 已成功登录，仍为 active admin、version 2、`must_change_password=true`。本任务没有替用户设置或读取新密码；项目负责人需刷新页面后重新提交首次改密。
- 只修改自托管 Node Web 来源识别和 root-only 运行配置；未访问 SQLite、D1、历史 Sites、其他数据库或外部服务，未操作 Python 服务。

## 根因与安全修复

- 失败请求 `84774e46-4e92-47b3-bce8-e837a4e59c7b` 的去敏 Web 日志和 Identity Audit 均为 `CSRF_INVALID`。公网浏览器发送 `Origin=https://43.135.157.211.nip.io:18888`，Caddy 却把请求以内部 HTTP 转给 Web；旧实现直接和代理后的 `Request.url.origin` 比较，因此误拦合法请求。
- 新增统一 Origin 规范化/比较模块，并在身份写和通用受保护写入口复用。`ERP_PUBLIC_ORIGIN` 存在时是唯一允许来源；禁止凭据、通配、路径、查询和 fragment，production 禁止 HTTP。
- 不读取或信任客户端 `Forwarded`/`X-Forwarded-*`。身份写仍要求 Origin；Cookie/Header CSRF Token 仍常量时间双提交。Session、must-change、幂等、限流、权限、CAS 和审计均未关闭或放宽。

## 验证

| 项目 | 结果 |
| --- | --- |
| 来源/身份单元测试 | `11/11`；合法直连与 TLS 代理通过，缺失/非法/错误协议、主机、端口、路径和内部 HTTP Origin fail closed |
| 隔离 PostgreSQL Identity | `9/9`；错误/缺失 Origin、缺 Token 被拒绝，合法公网 Origin + 正确双提交完成首次改密事务 |
| UI 安全合同 | `4/4`；密码/Token 不写 URL、日志或浏览器存储，must-change 与幂等合同保持 |
| alpha.34 hotfix build | PASS；build 明确显示 `0.1.0-alpha.34`，候选容器 `/api/health` 为 200 |
| 最终公网验收 | 合法 Origin 的无凭据 `POST /api/me/password` 返回 `AUTH_REQUIRED/401`，证明已越过来源门禁；没有使用真实密码、Cookie 或 Session |
| 健康/配置 | 本机和 TLS `/api/health` 均为 200；运行容器内 `ERP_PUBLIC_ORIGIN` 为批准的唯一公网 origin |

首轮来源单测为 `10/11`，暴露“配置公网 origin 后仍接受内部 HTTP origin”的联合 allowlist 风险；实现随即收紧为配置值独占并复测通过。隔离 PostgreSQL runner 还先后暴露 bind 文件权限、旧 0034 Worker 镜像缺 alpha.35 模块及测试配置设置过早三个夹具问题；全部发生在主库外，未降低断言，最终 `9/9`。临时数据库 `chenyida_erp_origin05_test` 已删除。

## 受控运行更新与版本边界

- `/etc/chenyida-erp/parallel.env` 只新增/规范化公开的 `ERP_PUBLIC_ORIGIN` 键，文件保持 root:root 0600；变更前副本为 `/var/backups/chenyida-erp/SELFHOST-OPS-TRUSTED-ORIGIN-05-parallel.env.pre-change`，root:root 0600。
- 首个候选镜像从仓库当前 alpha.35 源码构建。构建后复核发现它会把尚未授权的 0035 Web 代码一起带入运行面；虽然 0035 从未应用、任务时段只有 health/Identity 探针且无治理请求或写入，该候选仍在最终交付前被判定超出最小边界。
- 最终镜像改为从已部署功能基线 `cda8c7e` / `0.1.0-alpha.34` 创建临时 detached worktree，只叠加相同 Origin hotfix；镜像为 `sha256:f9c34a11b900a17edd25be9751f5c6596feb3af0df12ddabbc251a7bb43c18ce`。越界候选容器和镜像均已删除，临时 worktree 已移除。
- 任务中 Web 因上述纠偏共受控重建两次；PostgreSQL、Worker、Caddy 的容器 ID和启动时间始终不变，均 restart 0/OOM false。旧 Web 镜像保留为 `chenyida-erp-parallel-web:origin05-predeploy-alpha34-20260729` 以便回滚。

## 数据与 Migration 核对

| 项目 | 任务起点 | 最终 | 说明 |
| --- | ---: | ---: | --- |
| Migration / head | 34 / 0034 | 34 / 0034 | checksum 与 0001—0034 源文件一致；manifest 始终为 `b2ff69f7b72db5f5bdd02b0fc6cc4e70dd913e52e1140a4abe1a8c3549d13b8b` |
| 用户 / active admin | 2 / 2 | 2 / 2 | 账号、角色、状态、密码摘要均未修改 |
| Session / 有效 | 3 / 1 | 3 / 1 | 用户此前成功登录形成的合法 Session 保留 |
| Audit / Identity | 885 / 13 | 887 / 15 | 两次无凭据公网验收各新增一条 `SELF_PASSWORD_CHANGED/failed/AUTH_REQUIRED` 合法审计 |
| 身份幂等 | 3 | 3 | 不变 |
| Material/Product/BOM/Line | 532/6/6/316 | 532/6/6/316 | 不变；采购、库存、生产、品质、销售和财务事实未创建 |

`admin2` 最终为 active admin、version 2、已登录、`must_change_password=true`。本任务未读取或输出密码摘要、Session token、Cookie、数据库凭据或真实业务正文。

## 资源、清理与 Git

- 起点约为 available 2.3 GiB、Swap 126—127 MiB、根盘可用 35 GiB、低 Load；最终约为 2.2 GiB、Swap 142 MiB、根盘 34 GiB、Load `1.08/0.48/0.29`。四服务 restart 0/OOM false，内核 OOM 记录 0。
- 备份、测试、两次 build 和 Web 更新全部串行，`COMPOSE_PARALLEL_LIMIT=1`；任一时刻最多一个任务临时容器。Build Cache 最终 2.789 GB，按禁止扩大清理边界未 prune。
- 临时 PostgreSQL 数据库、runner、验证容器、alpha.34 build worktree 和越界候选镜像已清理；四个 ERP 持久卷全部存在且未删除。root-only env 回滚副本与旧 Web 回滚镜像是有意保留的恢复资源。
- Git 只包含来源校验代码、测试和脱敏文档；不包含 env、回滚副本、密码、摘要、Cookie、Token、数据库备份、日志、真实 XLSX 或逐行数据。受保护未跟踪 `shujvbiao/` 未修改、打开、暂存或提交。
- 未 push、创建 PR、切流、发布历史 Sites/D1、上传外部或操作 Python 服务。根据网站构建/托管指导，发布边界被明确限制在当前自托管 alpha.34 Web，不使用历史 Sites 发布面。

## 用户下一步

刷新 `https://43.135.157.211.nip.io:18888`，使用当前 `admin2` 会话重新填写临时密码和新密码并提交。成功后系统会撤销现有会话，需用新密码重新登录；此动作完成前不得把账号状态描述为“首次改密已完成”。
