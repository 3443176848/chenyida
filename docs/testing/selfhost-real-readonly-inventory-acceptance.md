# TASK04 真实只读盘点验收计划

## 合成专项（真实读取之前）

完全合成 fixture 覆盖：未授权模式、错误源路径、symlink、backup 路径、path digest、online backup 一致性、integrity、snapshot SHA、无 target URL、强制 no-materialize/no-files、manifest/Git/version/SHA 不匹配、敏感字段脱敏、自由文本不 DISTINCT、opaque reference、Schema drift、重复/orphan/status/unit/precision、Inventory/Finance opening 聚合、报告敏感扫描，以及成功/失败清理。现有 synthetic dry-run/commit 守卫必须保持通过。

## 获准的单次真实执行

只验证：源由只读 URI 打开；原库 inode/mode/权限未被工具改变；Python PID 不变；未提供或连接 PostgreSQL target；未写 staging/public/业务表；未读文件正文；快照 integrity 与 SHA 通过；输出报告通过脱敏扫描；临时快照和 task-local key 最终删除。

真实盘点不得纳入普通自动测试，不得由 Web/API 调用。

## 全量回归

执行 TASK01—TASK04 migration tooling、TASK02—TASK10 unit/UI、PostgreSQL/API、migration upgrade、typecheck、lint、`npm test`、build、Schema consistency、credentials/environment guards、synthetic materialization、backup/restore 合成回归、Python self-test/smoke/临时 SQLite go-live 和 `git diff --check`。任何环境未覆盖项必须明确记录，不得降低断言或跳过失败。
