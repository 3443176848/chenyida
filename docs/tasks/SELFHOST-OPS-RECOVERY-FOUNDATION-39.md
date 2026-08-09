# SELFHOST-OPS-RECOVERY-FOUNDATION-39 — alpha.42 三锚点恢复基础

## 任务状态

`DOING / PHASE_GIT_PRIVATE_REMOTE`

本任务只建立 alpha.42 恢复基础。当前阶段只处理 Git 私有恢复锚点；容器镜像远端锚点和 PostgreSQL/文件卷异机恢复锚点保持待办，不因 Git 推送成功而自动开始或宣称完成。

## 授权与目标

项目负责人于 2026-08-10 在前序 `GITHUB AUTHORIZATION BLOCKED` 结果后明确要求 Codex 协助配置。该授权允许：

1. 按 GitHub CLI 官方 RPM 仓库为当前 OpenCloudOS 9.4 主机安装 `gh`。
2. 启动 GitHub 设备授权，由项目负责人在 GitHub 页面亲自完成一次授权。
3. 只在认证身份精确为 `3443176848` 时创建空的 private 仓库 `3443176848/chenyida-erp-recovery-private`。
4. 保留现有公开 `origin` 的 fetch URL、push URL、默认分支和 upstream，不向公开仓库推送内部历史。
5. 对新增治理提交增量复扫后，以普通、非强制 push 将精确 `main` 提交写到新私有仓库的 `refs/heads/main`。

## 严格起点

- Branch：`main`
- HEAD：`acdf1de0364e04aef2a860b3ff1148469d978db7`
- Parent：`fc551c6571b57593a3232a14617935b3e3c3171f`
- `origin/main`：`39946f6b854a985b5c19106eaa6c938bddaf9c7c`
- ahead / behind：`186 / 0`
- 工作树及索引：clean
- Worktree：仅 `/opt/erp`
- 公开 `origin` fetch：`https://github.com/3443176848/chenyida.git`
- 公开 `origin` push：`git@github.com:3443176848/chenyida.git`
- 新目标匿名 API 预检：HTTP 404；认证后必须再次确认仓库确实不存在
- 主机：OpenCloudOS 9.4 / x86_64；起点 `gh` 未安装
- 运行面沿用 FIX38：alpha.42 Web、40/head0040、四服务 restart 0/OOM false、四个受保护 Volume 完整；本阶段不登录或操作 UAT

## 当前阶段进度

- GitHub CLI已从GitHub官方RPM仓库安装为`gh 2.97.0`；RPM签名使用已核对的官方主指纹`2C6106201985B60E6C7AC87323F3D4EA75716059`和`7F38BBB59D064DBCB3D84D725612B36462313325`。
- 项目负责人已在GitHub设备页亲自完成授权；活动账号由`gh api user`证明为`3443176848`。
- `gh`报告当前主机没有可用系统密钥环，认证材料按其Linux回退保存在root配置中；只核对`/root/.config/gh/hosts.yml`元数据为`root:root / 0600`，未读取或输出正文。
- `3443176848/chenyida-erp-recovery-private`已创建；认证元数据证明`PRIVATE / ADMIN / non-fork / size 0`，创建后为0 branch、0 tag、0 release。
- 公开`3443176848/chenyida`继续为`PUBLIC / ADMIN / main`，本地`origin`尚未改变；`recovery-private`将在治理提交及增量复扫通过后才添加。
- 文档门禁已通过：47个本地Markdown链接无断链、任务/D-108标题各唯一、TASKS仅本任务一个`DOING`、`RELEASES.md`未修改、`git diff --check`通过；断网、源码只读、1 CPU容器中的lint为0 error/11条既有warning，已完整检查为纯本地读文件的UI contract为6/6。

## 固定远端与推送合同

- 私有仓库：`3443176848/chenyida-erp-recovery-private`
- 本地 remote：`recovery-private`
- 目标分支：`refs/heads/main`
- 创建方式：空仓库，不初始化 README、license、`.gitignore`、release 或其他分支
- 可见性：必须由认证后的 GitHub 元数据证明为 `PRIVATE`
- 推送方式：`<精确完整提交>:refs/heads/main`，不使用 `--force`、`--force-with-lease`、`--mirror`、`--all`、`--tags` 或 `-u`
- 公开 `origin`：URL、push URL、remote HEAD、upstream 和远端 main 必须前后完全一致
- 不创建 PR，不改写历史，不 rebase、amend、reset、stash 或 restore

## 身份与秘密边界

- 认证必须使用 `gh auth login --web` 的设备授权；项目负责人亲自在 GitHub 页面确认。
- 不要求用户在聊天、命令行参数或仓库文件中粘贴 Personal Access Token。
- 不读取、输出、复制或提交 GitHub 令牌；不得运行会显示 token 的命令。
- `gh auth status` 必须证明活动账号精确为 `3443176848`；账号不匹配立即停止。
- 认证成功后再次查询目标仓库；若已存在、可见性不明或不是 private，立即停止，不删除或改名任何仓库。

## 执行顺序

1. 复核 Git、远端、资源、服务和受保护 Volume 基线。
2. 建立本任务文档和 D-108，保持任务为唯一 `DOING`。
3. 从 GitHub CLI 官方 RPM 仓库安装 `gh`，核对包签名来源和版本。（已完成）
4. 完成设备授权并核对活动账号。（已完成）
5. 认证后确认目标仓库不存在，再创建空 private 仓库并复核 owner、visibility、权限和空分支状态。（已完成）
6. 更新 `MASTER.md`、`TASKS.md`、`CHANGELOG.md` 和 `STATUS.md`，形成独立提交 `docs: define alpha42 recovery foundation`。
7. 仅对新增提交做增量敏感信息、禁止路径、提交对象和 diff 检查；任一确认或可能秘密立即停止。
8. 添加 `recovery-private` HTTPS remote，不改变 `origin`，把精确新 HEAD 普通推送到私有 `main`。
9. 以 GitHub 元数据和 `git ls-remote` 验证私有 `main` 精确等于本地 HEAD；再次证明公开 `origin/main` 未变化。

## 停止条件

出现以下任一情况必须停止，不得创建仓库或推送：

- Git 起点、工作区、worktree、公开 origin 或 ahead/behind 不匹配。
- GitHub 活动账号不是 `3443176848`，或认证权限不足。
- 目标仓库已存在、名称冲突、创建结果不是 private，或默认权限/所有者不匹配。
- 新提交扫描出现 `CONFIRMED_SECRET` 或 `POSSIBLE_SECRET`。
- 推送需要强制、历史改写、删除、覆盖非空远端分支或修改公开 origin。
- available memory 小于 768 MiB、Swap 使用率超过 80%、根盘可用小于 10 GiB、持续高 Load、OOM、容器重启或数据库失去健康。

## 明确排除

- 不向公开 `3443176848/chenyida` 推送。
- 不把私有恢复仓库改为 public，不公开内部文档、UAT 标识、主机路径、网络、容器或备份拓扑。
- 不推送容器镜像，不创建 registry、release、package、tag、PR 或 GitHub Actions secret。
- 不创建或复制 PostgreSQL dump、Volume 归档或异机备份。
- 不登录 UAT，不调用业务 API，不写数据库，不运行 Migration、build、测试数据库、Compose、部署或服务重启。
- 不修改 `RELEASES.md`；Git 锚点不是产品发布。
- 不修改 Swap、dockerd、内核、防火墙或 systemd。

## 本阶段验收标准

- `gh` 由 GitHub CLI 官方 RPM 仓库安装且可执行。
- GitHub 活动账号精确为 `3443176848`，认证过程没有令牌泄漏。
- `3443176848/chenyida-erp-recovery-private` 已创建且认证后元数据为 private。
- 独立治理提交通过 diff、链接、敏感信息和增量历史检查。
- `recovery-private/main` 精确等于本地最终 HEAD；公开 `origin/main` 仍为起点 SHA，公开 remote 配置不变。
- 工作区最终 clean；UAT、数据库、镜像、服务和受保护 Volume 未被本阶段改变。
- 任务仍为 `DOING`：只关闭 Git 单机恢复风险，镜像远端和数据库/文件卷异机恢复风险继续开放。
