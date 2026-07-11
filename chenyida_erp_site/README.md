# 晨亿达 ERP

晨亿达多用户在线 ERP，覆盖物料主数据、供应商映射、BOM、采购、库存、生产、销售、财务、品质和系统运维。

线上地址：[chenyida-erp-online.sjin74376.chatgpt.site](https://chenyida-erp-online.sjin74376.chatgpt.site)

## 技术栈

- Vinext / React / TypeScript
- Cloudflare Workers
- Cloudflare D1
- OpenAI Sites

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:3000`。

## 配置

复制 `.env.example` 中的变量到本地环境。`ERP_ENV` 只能是 `development`、`test` 或 `production`；生产 API/Site 地址必须由托管环境注入，不得写入源码。开发环境还需设置一次性初始化凭证：

```text
ERP_SETUP_TOKEN=replace-with-a-strong-random-token
```

首次打开系统时使用该凭证创建管理员。初始化成功后会自动登录，初始化入口随即关闭。

`vite.config.ts` 的本地 Cloudflare 绑定显式禁用远程资源。普通开发使用项目内 `.wrangler/state`；API 烟测使用操作系统临时目录中的一次性 Miniflare D1。

## 验证

```bash
npm run lint
npm test
npm run test:environment
npm run test:api
npm run security:credentials
```

`test:api` 只接受 `ERP_ENV=test`、HTTP 回环地址和带测试标识的临时 D1 路径。无论测试成功或失败，D1 业务数据都会删除；失败时仅在被 Git 忽略的 `work/test-logs/` 保存去敏诊断。

## 目录

- `app/`：在线 API、认证和页面入口
- `public/erp/`：ERP 操作界面
- `drizzle/`：数据库迁移
- `tests/`：构建和接口测试
- `chenyida_erp_app/`：早期本地 Python 版本
- `物料主数据治理落地包/`：物料治理模板、SOP 和辅助工具

## 安全说明

- 不要提交 `.env`、初始化凭证、账号密码或数据库文件。
- 生产环境变量通过托管平台配置。
- 系统采用服务端会话、角色权限和操作审计。
