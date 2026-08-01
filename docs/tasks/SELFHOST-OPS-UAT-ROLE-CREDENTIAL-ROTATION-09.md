# SELFHOST-OPS-UAT-ROLE-CREDENTIAL-ROTATION-09

## 结论

`PARTIAL UAT CREDENTIAL ROTATION — RECOVERY CANDIDATE RETAINED`

本任务只处理十个指定 UAT 角色账号的身份凭据，不进入经营工作台或任何业务页面，不执行 Planning Package 核验、接收、退回或 v2 生成。十个目标账号的密码重置均已由管理员网页成功提交，角色和启用状态保持，Identity 审计为成功 10、失败 0；但首个目标账号完成旧密码拒绝、新临时密码认证和首次强制改密页确认后，页面退出及 Session 失效证明未完成，受控进程按规则停止。候选恢复文件保留，正式凭据文件没有被替换。

## 严格起点

| 项目 | 结果 |
| --- | --- |
| Git | clean `main@615fe3ab4913c1964cfeb7337196f0d3e1a8d787`，Parent `682e79378660ef7859617655836f02e2112df244`，`origin/main...HEAD` 为 behind 0 / ahead 111 |
| 版本/Migration | 源码 `0.1.0-alpha.37`；源码与 PostgreSQL 均为 36/head `0036_project_requirement_unit_resolution.sql` |
| Web | `sha256:6b94a9c73a182799ffad6df5f89ecb86e5407162f0f233e8741aea3fd9dc4e25` |
| 服务 | PostgreSQL/Web healthy，Worker/Caddy running；四服务 restart 0/OOM false |
| 文件 | 正式 UAT 凭据与管理员凭据文件均为 `root:root 0600`；写入前没有候选文件 |
| 资源 | available memory 约 2.3 GiB，Swap 218 MiB/1 GiB，根盘可用 22 GiB，Load `0.44/0.31/0.21` |

门禁在浏览器准备完成后再次核对并通过，才允许进程读取凭据和创建候选。前三次本地解析校验只在受控进程内读取材料且不输出正文，并在候选创建/Identity 请求前安全结束；一次交互管道准备在凭据读取前结束。这些预检均未形成身份或文件变更。

## 受控 Identity 结果

- 单个临时容器内只启动一个 Chromium 实例；管理员使用一个 Context，十个 UAT 账号设计为顺序、相互隔离的 Context。未启用调试日志、截图、trace、HAR、录像或持久化浏览器配置。
- 浏览器 API allowlist 仅允许 Session、login、logout、users、reset-password 和任务范围 Identity audit；任何业务 API 均 fail closed。兼容页面刷新被收敛为 users-only，不请求 Dashboard 或业务数据。
- 十个指定角色账号逐个完成重置，候选文件在每次成功后立即原子更新并 fsync；逐个复核角色、启用状态均保持。
- `admin`、UAT admin-check 账号及其他用户未重置；目标用户名、角色、启用状态、顺序、注释和格式未改。
- Identity 审计页面范围内的 `USER_PASSWORD_RESET`：成功 10、失败 0；未展示或复制敏感正文。

## 验证中止点

| 验证项 | 结果 |
| --- | --- |
| 旧密码拒绝 | 1/10 PASS；其余 9 个未验证 |
| 新临时密码认证 | 1/10 PASS；其余 9 个未验证 |
| 首次强制改密页 | 1/10 PASS；未执行实际改密；其余 9 个未验证 |
| 页面退出与 Session 失效 | 0/10 完成证明；首个 UAT 账号在该阶段停止，其余 9 个未开始 |
| 管理员退出 | 未到达完成证明；不能用关闭浏览器冒充安全退出 |

因此本任务创建的管理员 Session 与首个 UAT 验证 Session 均按存在风险处理；未读取全局 Session 表，也未直接 SQL 撤销或改写 Session。其余九个 UAT 账号没有启动登录验证。

## 恢复材料

- 保留候选：`/etc/chenyida-erp/.uat-role-accounts.txt.candidate-20260801025603-b821881a80`，`root:root 0600`。
- 候选已在十次重置后逐项同步，但因验证未完成，没有原子提升为正式文件。
- 正式 `/etc/chenyida-erp/uat-role-accounts.txt` 保持原文件和 `root:root 0600`；其中十个旧密码已因网页重置而失效，不能再当作有效恢复材料。
- 管理员凭据文件未修改。没有创建旧凭据副本；候选不得删除、覆盖或提升，除非后续独立授权任务完成 Session 风险处置和全部验证。
- 不对普通文件在底层介质上的不可恢复删除作任何声明。

## 业务与运行保护

- 没有打开 Planning Package 详情或经营工作台，没有越过强制改密页，没有发起 Package 接收、退回、生成 v2 或任何采购、库存、生产、品质、销售、财务请求。
- 本轮没有直接读取 Package 数据；只能确认受控路由未发出业务请求，不能把此前的 Package ID 1/v1 基线冒充为本轮黑盒核验结果。
- 未运行 build、Migration、PostgreSQL 测试、Compose 重建或服务重启；未 prune、删除镜像、Volume、备份或修改生产配置。
- 提交前仓库凭据扫描通过 1,118 个文件，`git diff --check` 通过；扫描器明确排除禁止读取的 `shujvbiao/`。
- 临时 Chromium 容器、浏览器 profile/cache、临时依赖、控制脚本和精确临时目录均已删除；恢复候选按失败规则保留。
- 最终 available memory 约 2.3 GiB、Swap 218 MiB/1 GiB、根盘可用 22 GiB、Load `0.13/0.18/0.20`；内核 OOM 记录 0，四服务 restart 0/OOM false，四个受保护 Volume 均存在。
- 未读取或修改 `shujvbiao/`，未输出密码、Token、Cookie、Session 摘要或凭据文件正文。

## 后续解除条件

停止所有进一步 UAT/Planning 登录。只有项目负责人另行明确授权后，才能用候选文件作为恢复权威，在同等保密和浏览器边界下先处置管理员与首个 UAT Session 风险，再从未完成验证点执行十账号完整验证；全部页面退出和 Session 失效通过前不得提升候选或开始 planning-only 核验。
