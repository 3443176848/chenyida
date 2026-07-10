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

复制 `.env.example` 中的变量到本地环境，并设置一次性初始化凭证：

```text
ERP_SETUP_TOKEN=replace-with-a-strong-random-token
```

首次打开系统时使用该凭证创建管理员。初始化成功后会自动登录，初始化入口随即关闭。

## 验证

```bash
npm run lint
npm test
```

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
