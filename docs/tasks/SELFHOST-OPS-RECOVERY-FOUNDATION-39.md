# SELFHOST-OPS-RECOVERY-FOUNDATION-39 — alpha.42 三锚点恢复基础

## 任务状态

`DOING / IMAGE_ANCHOR_ESTABLISHED / DATA_ANCHOR_PENDING`

阶段判定：`ALPHA.42 PRIVATE GHCR IMAGE ANCHOR ESTABLISHED — DATA RECOVERY ANCHOR PENDING`

Git 私有恢复锚点和唯一 alpha.42 Web 镜像的 private GHCR 恢复锚点均已建立并完成 digest 回拉验证。GHCR package 保持 private，只有唯一完整 revision tag、没有 `latest` 或 public 仓库关联，匿名读取被拒；一次性 classic PAT、Docker config 和本任务认证目录已经清理。PostgreSQL dump 与文件卷异机锚点仍未开始，整个任务继续 `DOING`，不得标记 `DONE` 或宣称 production ready。

## 严格起点

### Git 与 GitHub

- Branch：`main`
- HEAD：`c96f9bfc912cb2a5dc6f4a3ad47bb51260847dbd`
- Parent：`e1eff533eb7cb38d169f266bdf3a97b0d3dc7e71`
- Commit：`docs: prepare private image recovery anchor`
- 工作树及索引：clean；唯一 worktree：`/opt/erp`
- public `origin/main`：`39946f6b854a985b5c19106eaa6c938bddaf9c7c`；相对 public 为 behind `0` / ahead `188`
- `recovery-private/main`：`c96f9bfc912cb2a5dc6f4a3ad47bb51260847dbd`；相对 private 为 behind `0` / ahead `0`
- `recovery-private`：`3443176848/chenyida-erp-recovery-private`，认证元数据为 `PRIVATE / ADMIN / main / non-fork / active`
- 活动 GitHub 账号：`3443176848`
- public `origin` 保持 HTTPS fetch `https://github.com/3443176848/chenyida.git`、SSH push `git@github.com:3443176848/chenyida.git`、upstream `origin/main`、remote HEAD `refs/remotes/origin/main` 和 public visibility 不变

这证明 D-108 的 Git 阶段在本次预检开始前已经达到 `GIT PRIVATE RECOVERY ANCHOR ESTABLISHED`；不得重复创建仓库或重复初始化 Git 锚点。

### 运行面与资源

- Web 容器完整 ID：`f0066fe6fb07bd2542caf39f8409571125b0b8009592d7dfd3b754c91981a35f`
- Web 容器实际引用完整 Image ID：`sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`
- 当前本地候选 tag：`chenyida-erp-parallel-web:0.1.0-alpha.42-fix38-569aa95`
- 版本 / source revision：`0.1.0-alpha.42` / `569aa954d764309e239d1f6c174e582596d33a24`
- alpha.41 回退镜像保持 `sha256:0cf98937f3ae28fe68e84436ab85c12ef5e8922f50a04973641cb79b8a0d5f19`
- 被拒候选保持 `sha256:81126136c63714be2a53812b3512549ed1fa4eb9deb7c8c6462b715eafe4278e`，仍为 `REJECTED — DO NOT DEPLOY / DO NOT PUSH`
- PostgreSQL、Worker、Caddy、Web 均运行；Web/PostgreSQL healthy；四服务 `RestartCount=0`、`OOMKilled=false`
- `chenyida-erp-parallel_erp_postgres`、`chenyida-erp-parallel_erp_uploads`、`chenyida-erp-parallel_erp_attachments`、`chenyida-erp-parallel_erp_backup_status` 四个受保护 Volume 全部存在
- 起点资源约为 available memory `2.2 GiB`、Swap `332 MiB / 1.0 GiB`、根分区可用 `17 GiB`、Load `0.22 / 0.16 / 0.11`；均未触发停止阈值，内核启动期 OOM 计数为 `0`

## 镜像身份与 OCI metadata

预检阶段只审计上述精确 Image ID，没有 build、pull、tag 或 push；本次第三阶段复用该已经验收且仍由运行 Web 引用的内容身份，没有重跑 image save、layer 解包或秘密扫描：

| 项目 | 审计值 |
| --- | --- |
| 本地 Docker Image ID / OCI image index digest | `sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964` |
| 本地 `linux/amd64` manifest digest | `sha256:36fd3118a4725aa8546ca28d1f21fe53ca472e81da4d0febff576ba88e4b482f` |
| config digest | `sha256:72452032dfdec71e55376a511ec762aeb5265f758f257a5b6c858b76372732c7` |
| Docker inspect size | `88,679,975 bytes` |
| 创建时间 | `2026-08-09T21:11:11.69732358+08:00` |
| OS / architecture | `linux / amd64` |
| Entrypoint / Cmd | `docker-entrypoint.sh` / `node server.js` |
| User / Workdir / Port | `node` / `/app` / `3000/tcp` |
| Image Healthcheck | 无；运行服务 healthcheck 由 Compose 提供 |
| OCI labels | `version=0.1.0-alpha.42`、`revision=569aa954d764309e239d1f6c174e582596d33a24`、`task=SELFHOST-UAT-FIX-38` |
| `/app/package.json` | 仅 `name/private/type/version`；`chenyida-erp-selfhosted`、private、module、`0.1.0-alpha.42`；SHA-256 `a2f4565e12cfc982ad9e5ef3e6868db9023fd7ad32e0b1c8e271aa3bcbf47c60` |
| provenance | 额外 in-toto/SLSA v1 attestation manifest `sha256:f4a82ba3ef6234037ff270c38685adeed3374db341376a8ac95652ff0cd4621b`；其 config 与 layer digest 也完成摘要验证和秘密扫描 |

本地运行 Image ID、本地 `linux/amd64` manifest digest、config digest、layer digest、已删除 archive 的 SHA-256 和 GHCR registry manifest digest 是不同身份。本次实际 GHCR registry manifest digest 为 `sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`；它与本地 OCI index/Image ID 恰好逐字一致，但仍分别作为运行身份与 registry 恢复身份记录，不能由数值相同而混为同一证据来源。

## Config、Env 与 history 审计

- `Config.Env` 仅记录 6 个变量名：`PATH`、`NODE_VERSION`、`YARN_VERSION`、`NODE_ENV`、`PORT`、`HOSTNAME`；不在文档输出值正文。
- config history `17` 条，其中 `8` 条 empty layer；Docker history 同步扫描 `17` 条。
- config、labels、Env、history、OCI metadata 和 provenance 中密码、Token/API Key、带凭据数据库 URL、Cookie/Session、Docker auth、私钥、Bearer/JWT、构建凭据的 `CONFIRMED_SECRET=0`、`POSSIBLE_SECRET=0`。
- 审计只记录分类、计数和安全元数据，没有输出任何扫描命中正文。

## 一次性 archive 与 layer 摘要

在 `mktemp` 创建的唯一目录 `/var/tmp/alpha42-image-preflight.vOgaG7E0` 中只执行一次 `docker image save`：

- archive：`alpha42-image.tar`，`88,699,904 bytes`，`root:root / 0600`
- archive SHA-256：`d7c78654ee422421a3f38527794145c84b6cc2f04039b63501a7a2a819a9bea2`
- Docker 兼容 `manifest.json` SHA-256：`9faf2dfe099a9410ba8900292d7aea5f188dcd55464af05734c2c068b999d3f4`
- OCI blobs：`15/15` 摘要匹配；9 个 rootfs diff ID 与各层解压 SHA-256 逐项匹配；所有层为 gzip，whiteout 为 `0`
- 去敏审计报告 SHA-256：`eb569187c74e112032df8cd431c36c6f810da578e58b97d8c4dc781113a550f2`

| 层 | compressed blob SHA-256 | compressed bytes | uncompressed diff ID SHA-256 | uncompressed bytes |
| --- | --- | ---: | --- | ---: |
| 1 | `039e6f9f9752f74a3ff4a6a224f64c7c864da16ed98f882107704328f41b9c42` | 28,232,590 | `66462cc862fe2053b9863fefa3866e07bb5dfb06f6b3ce3177cc096e4021aabe` | 77,895,680 |
| 2 | `5404bc2cc13c8aefe11c6d1d4bc40a30e07879b45d93b485c1d72317488d3b04` | 3,311 | `971f4222c89e76e28d9b107cb29729a5abb9fd7adea0d4a1c419ce9b73204feb` | 21,504 |
| 3 | `555d3507458376894ba4e9c5ea63da2b3d9dd3e9765e756483d94438eb840440` | 49,937,716 | `d84f419161f986391e64d28f3e40dd54381ea37495b0a25daef6353bd8df4d92` | 147,570,176 |
| 4 | `8f99eb9866f3244aac3800fb9f992ecc69aef9894d3d0c29be5b09c4ae0e40e5` | 1,712,643 | `a45e8410aa35d5194fcdeb7f7969789ac3cc9431d5b69be8602492a2097909d7` | 7,214,592 |
| 5 | `c0ed9f2d0e0e040af91270b0d33de349f4769825f106751ed52d7105fd1870bf` | 445 | `a8a755e4d6c4443f2aa3d52c6581a3253c71013f240d1a02edd519c317a66c4b` | 3,584 |
| 6 | `6e0d99882c1df156ee50066b615827c1dedfc3adb35d2e0a6092e9028f28f53a` | 93 | `63d47df84155af5870167263d48f815a83567a3b33e4617c8d237d37e215da22` | 1,536 |
| 7 | `c59c3a2d8e7edd31718b2536bfe02a62e4d589f4ca0be8986c953604ace0fb42` | 8,781,137 | `b2159d31e17b3d940f362f74dc6d3bad6b69d2e74a53e589834353196f05f48a` | 40,607,744 |
| 8 | `b6916f863d3b65f90d7eb3ae4f72f3800be778c6b4df248e0b45c47bb4de0dea` | 226 | `7c76856cb4566d45d73ca91b22e414eb6d03fd4ae3922750b59c3101e3b96188` | 2,560 |
| 9 | `be0fd3ae581bca3c603831dd9c1f70f9fabf99c0e22f177c42e094d3d6c82cfd` | 170 | `5bb9b7283b0f6f95245a86113537f7ce3db682673b7d4617987d1bd65ffa3b14` | 3,072 |

该 archive 从未离开本机，也没有作为备份保留，因此明确 **不是异机镜像恢复锚点**。

## layer 路径、文件类型与秘密分类

- 扫描 `8,112` 个 regular file/metadata record、`266,026,785` bytes；可读文本 `6,444`、二进制 `1,668`。
- 最终文件系统共 `9,823` 个路径：regular `8,068`、directory `1,239`、symlink `514`、hardlink `2`。
- 安全结构：路径穿越 `0`、层内重复路径 `0`、逃逸或非法 link `0`、world-writable regular file `0`；记录 `476` 个安全相对 symlink、`40` 个容器根内绝对 symlink 和 `13` 个基础系统 setuid/setgid 路径。
- 敏感内容分类：`CONFIRMED_SECRET=0`、`POSSIBLE_SECRET=0`、`TEST_FIXTURE=10`、`DOCUMENTATION_PLACEHOLDER=1`、`FALSE_POSITIVE=566`。
- 10 个 fixture 均位于 Debian GnuTLS ELF `usr/lib/x86_64-linux-gnu/libgnutls.so.30.34.3` 的 `crypto-selftests-pk.c` 已知答案自检区；以精确库路径、ELF magic、自检源码边界、`known-sig self test` 和 `gnutls_pk_self_test` 符号证明，不使用宽泛路径白名单。
- documentation placeholder 为依赖文档中的通用赋值示例；566 个 false positive 为 Git/SHA 摘要或依赖代码标识符，均没有按正文输出。
- Docker auth、SSH key、PEM/P12/PFX/私钥文件、数据库/dump/业务备份、浏览器 Profile/Cookie/Session、上传/附件/客户或供应商原始文件的最终 regular file 均为 `0`。
- 唯一 `.npmrc` 为 npm 运行时的 `0 byte` 文件；11 个 `.gpg` 为 Debian 公共包信任 keyring；最终 4 个日志、合计 `113,590 bytes`，只属于 apt/dpkg 安装记录且秘密扫描为 0。
- 运行镜像仍含 `4,888` 个 `node_modules` 路径、`516` 个 source map、`524` 个 `.d.ts`、`60` 个 `.ts` 和 `32` 个 test/fixture 路径；没有业务原始数据或凭据，但作为后续镜像瘦身/最小化风险保留，不在本 docs-only 任务修改镜像。

## 私有 GHCR 镜像恢复锚点结果

D-109 的准入合同已按项目负责人明确的 `GHCR CREDENTIAL READY` 授权执行完毕：

- 目标：`ghcr.io/3443176848/chenyida-erp-web`
- 唯一 immutable-intent tag：`0.1.0-alpha.42-fix38-569aa954d764309e239d1f6c174e582596d33a24`
- push 前以独立临时 GitHub CLI 配置确认 PAT 身份为 `3443176848`，normalized scope 只有 `write:packages`，没有 `delete:packages` 或其他 scope；PAT 正文从未进入聊天、日志、Git、remote URL 或命令参数
- 认证 GitHub package API 返回目标 package 不存在，认证 registry 查询确认精确 tag 不存在；随后只为验收 Image ID 创建上述一个本地 tag，并只执行一次精确 `docker push`，没有重试
- push 返回、认证 registry 顶层 manifest 和带唯一 tag 的 GitHub package version 三方一致，registry digest 均为 `sha256:e7761e2c61bfe77c6aab526fb0b6cbd840ad1bf6300381f4319f6e279af94964`
- registry OCI index 只有预期的 `linux/amd64` child `sha256:36fd3118a4725aa8546ca28d1f21fe53ca472e81da4d0febff576ba88e4b482f` 与 attestation child `sha256:f4a82ba3ef6234037ff270c38685adeed3374db341376a8ac95652ff0cd4621b`；platform config 为 `sha256:72452032dfdec71e55376a511ec762aeb5265f758f257a5b6c858b76372732c7`，9 个 compressed layer digest 与 D-109 预检基线逐项一致
- GitHub package metadata 为 `PRIVATE`，没有 repository association；三个 OCI 对象只在顶层 index 上存在上述唯一 tag，没有 `latest`、额外 tag、alpha.41 或被拒候选
- 只执行一次精确按 registry digest 拉取，回拉成功且 Image ID、平台、config、9 层、labels、User、WorkingDir、Entrypoint、Cmd 和 exposed port 全部与已验收本地基线一致；没有运行、替换或部署回拉镜像
- 独立空 Docker 配置的匿名 manifest 查询被 `HTTP_401_AUTHENTICATION_REQUIRED` 拒绝，证明该恢复锚点没有匿名读取能力

本阶段没有创建 release、Git tag、PR、Actions secret 或持久 Docker auth，也没有推送 `latest`、alpha.41、被拒候选或任何第二个镜像/tag/registry。

## 临时资源清理

- 完成审计并固化去敏摘要后，精确删除 `/var/tmp/alpha42-image-preflight.vOgaG7E0`。
- 复核 task directory、archive、解包 layer 和报告路径均不存在；匹配 `scan_image.py` 的 Python 进程为 `0`。
- GHCR 验证完成后使用精确临时 Docker 配置执行 `docker logout ghcr.io`；核对 Docker buildx 仅在授权目录生成的已知元数据路径后，逐个 unlink 并按目录层级清理。
- `/run/cyd-ghcr-auth`、其 `pat` 与 `config.json`、独立 GitHub API 配置 `/run/cyd-ghcr-ghapi` 和匿名验证目录 `/run/cyd-ghcr-anon` 均已不存在；默认 `gh` 身份仍为 `3443176848`，没有触碰默认 Docker 配置。
- 没有删除任何镜像、镜像 tag、容器、网络或 Volume，没有执行任何 prune。

## 文档、测试与 Git 收口

- 只修改任务文档、`DECISIONS.md`、`MASTER.md`、`TASKS.md`、`CHANGELOG.md`、`STATUS.md` 六份 Markdown；`RELEASES.md` 不变。
- 运行 `git diff --check`、本地 Markdown 链接、任务/D-109 唯一性、唯一 `DOING`、精确文件范围和敏感信息门禁。
- 文档-only 验证继续使用既有 `node:22-bookworm-slim` 镜像，断网、源码只读、1 CPU、1,280 MiB 内存硬上限、Node heap 1,024 MiB 且串行运行；`npm run lint` 为 0 error/0 warning，`tests/selfhost-procurement-fulfillment-ui-contract.test.mjs` 为 6/6。两个 `--rm` 容器均清零，不安装依赖、不连接数据库。
- 独立提交消息固定为 `docs: record private image recovery anchor`。提交增量复扫只有 `CONFIRMED_SECRET=0 / POSSIBLE_SECRET=0` 才允许把精确完整 SHA 普通推送到 `recovery-private/main`。
- 推送不使用 force、tags、mirror、all、`-u`，不向 public `origin` 推送；最终必须证明 private main 等于最终本地 HEAD，public `origin/main` 仍为 `39946f6b854a985b5c19106eaa6c938bddaf9c7c`。

## 明确边界与下一阶段

- 本阶段未登录 UAT、未调用业务 API、未读取或写入业务数据库、未运行 Migration、未备份或恢复、未 build、未部署、未重启服务；只执行授权范围内的唯一 GHCR tag、一次 push、一次按 digest pull 和只读验证。
- FIX38 继续为非生产 alpha.42 / 0040 / `NO UAT RECEIPT`；本任务继续 `DOING`。
- 镜像远端恢复锚点已经建立；运行 Web 容器仍引用原 Image ID，四服务容器 ID、Image ID、健康状态、`RestartCount=0` 与 `OOMKilled=false` 全部不变，四个受保护 Volume 仍存在。GHCR 操作与凭据清理检查点约为 available memory `2.2 GiB`、Swap `332 MiB / 1.0 GiB`、根分区可用 `17 GiB`、Load `0.03 / 0.08 / 0.08`；串行文档验证后约为 `2.2 GiB`、`336 MiB / 1.0 GiB`、`17 GiB`、`0.87 / 0.53 / 0.26`，内核启动期 OOM 计数始终为 `0`。
- PostgreSQL dump 与 uploads、attachments、backup-status 文件卷的异机恢复锚点仍未开始，是本任务剩余唯一恢复基础阶段；必须另行确认方案和授权，不能因镜像锚点完成而自动开始、部署、迁移或宣称 production ready。
- 项目负责人仍须在 GitHub 网站手工撤销本次一次性 classic PAT；本机凭据已清理不等于远端 PAT 已撤销。
