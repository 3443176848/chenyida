# SELFHOST-OPS-TRUSTED-ORIGIN-05 公网 HTTPS 受保护写请求来源校验修复

## 状态与授权

- 状态：`DONE / DEPLOYED / USER FIRST-CHANGE RETRY REQUIRED`。
- 日期：2026-07-29（Asia/Shanghai）。
- 授权：项目负责人确认修复 `admin2` 首次改密时的“请求来源校验失败”，允许对当前 `chenyida-erp-parallel` 自托管 Web 做最小代码修复、验证和受控更新。

## 已确认故障

- 公网入口固定为 `https://43.135.157.211.nip.io:18888`，Caddy 在该入口终止 TLS，再以内部 HTTP 转发到 Web。
- 失败请求 `84774e46-4e92-47b3-bce8-e837a4e59c7b` 在 Web 去敏日志中对应 `CSRF_INVALID`。
- 浏览器 `Origin` 是公网 HTTPS origin，运行时 `Request.url` 是代理后的内部 HTTP origin；现有身份与通用自托管写请求按字符串直接比较，合法请求被误拦截。

## 执行边界

1. 仅修复自托管 Node Web 的来源识别；不修改或访问 SQLite、D1、历史 Sites 或外部数据库。
2. 使用显式、规范化的 `ERP_PUBLIC_ORIGIN` 单值 allowlist；不得信任任意客户端 `Forwarded`/`X-Forwarded-*`，不得通配域名、协议或端口。
3. 配置公开 origin 时只允许该唯一来源；未配置时才使用原生 request origin。身份写仍强制要求 Origin，通用写保持既有缺失 Origin 语义。CSRF Header/Cookie 常量时间双提交校验、Session、must-change、幂等、限流、权限和审计全部保留。
4. 增加生产代理场景、错误来源、缺少来源、非法配置及直接同源回归；不得通过放宽断言、关闭 CSRF 或跳过测试修复。
5. 不修改 Schema/Migration、用户、密码、Session、角色权限、业务数据和四个 ERP 持久卷；不操作 Python 服务。
6. 构建和验证串行，`COMPOSE_PARALLEL_LIMIT=1`。如需运行更新，只构建并重建 Web；PostgreSQL、Worker、Caddy 不重启，不应用 `0035`。
7. 公网验收不得在命令、日志、报告或 Git 中记录密码、Cookie、Token 或摘要；可用无凭据请求证明合法 Origin 已越过来源门禁，再由项目负责人完成真实首次改密。
8. 不 push、不创建 PR、不发布历史 Sites/D1、不切流，不启动其他任务。

## 验收标准

- 生产代理形态 `Request.url=http://internal` + `Origin=https://43.135.157.211.nip.io:18888` 通过来源判断；任意其他 origin、非法配置和身份写缺少 Origin 均 fail closed。
- 缺少/错误 CSRF Token 仍为 `CSRF_INVALID`，正确 Header/Cookie 才允许进入后续身份业务。
- 公网受保护身份请求使用合法 Origin 时不再返回“请求来源校验失败”；无凭据请求应进入认证门禁而不是来源门禁。
- `admin2` 保持 active admin、version 2、`must_change_password=true`，直至项目负责人成功首次改密；本任务不代替用户设置新密码。
- Migration、Session、核心业务计数和四卷不变；本机/TLS health 200，四服务无 OOM/restart。
- 适用测试、build、凭据扫描、Git 差异检查通过；只提交代码、测试和脱敏文档。

## 完成记录

- 完成报告：`docs/tasks/SELFHOST-OPS-TRUSTED-ORIGIN-05-COMPLETION.md`。
- `ERP_PUBLIC_ORIGIN=https://43.135.157.211.nip.io:18888` 已以 root-only 运行配置生效；生产镜像只重建 Web，PostgreSQL、Worker、Caddy 未重启。
- 公网合法 Origin 的无凭据受保护请求已进入 `AUTH_REQUIRED`，不再被误判为“请求来源校验失败”；真实首次改密仍由项目负责人本人完成。
