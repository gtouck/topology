# 工程维护与部署

## 代码边界

| 层次 | 入口 | 职责 |
| --- | --- | --- |
| 通用文档 | `document.ts`、`topology.ts`、`diagram.ts`、Schema | 解析、迁移及配置结构，保留节点位置和手工拐点 |
| 编辑命令 | `editor-commands.ts`、`layout-commands.ts`、`template-commands.ts` | 纯文档变换，先校验后返回完整结果 |
| 编辑会话 | `editor-history.ts`、`document-signature.ts` | 每张图最多 50 步撤销，克隆进出，不持有 Graph、DOM、计时器或运行值 |
| 共享工作空间 | `workspace.ts`、`publication.ts`、`publication-storage.ts` | 纯草稿/历史/发布规则，服务端复用；保留本地适配及宿主发布存储接口 |
| 服务器持久化 | `server/`、`shared/api.ts`、`workspace-client.ts` | SQLite 事务、认证、版本冲突、幂等重试及服务器确认 |
| 本机恢复 | `server-recovery.ts` | 保留未确认快照和旧浏览器迁移来源，不代表服务器保存成功 |
| 运行数据 | `editor-telemetry.ts`、`data-freshness.ts`、`link-state.ts` | 参数、接收时间、连接与链路状态，独立于文档和撤销 |
| 渲染与导航 | `rendering.ts`、`diagram-rendering.ts`、`graph-navigation.ts` | 设备/图面/线缆外观与视口，不自动整理人工布局 |
| 界面调度 | `main.ts` | 图形事件、表单、拖动合并、保存计时和调用上述模块 |
| 独立组件 | `viewer-index.ts`、`viewer.ts` | 只读展示、宿主 API 与回调；不导入制作工具、本地存储适配器或模拟器 |

切图保留当前会话内各图历史；删除释放所属历史。打开前最后一笔尚未合并的草稿会纳入当前图历史。撤销不恢复运行数据、接收时效或视口；批量拖动、走线与编辑命令仍由界面合并为一次记录。刷新后的恢复使用工作空间草稿/检查点，会话撤销栈不持久化。

## 版本与构建产物

工作台和组件版本统一取根 `package.json`，当前为 **0.7.0**。组件包位于 `dist-viewer/`，包含 ESM、UMD、NodeNext 可消费的声明和 Schema；声明消费检查在仓库外的临时目录执行，禁止借用工作台依赖，且 `skipLibCheck: false`。

- 通用文件版本仍为 v3，继续导入 v1/v2。可选扩展按旧文件缺省解释，不批量注入字段或重写人工布局；破坏兼容的结构变更必须升级文件版本并提供迁移和 Schema。
- 本地库根版本 1、编辑元数据版本 2 与通用文件版本独立；旧工具拒绝未知编辑元数据，避免覆盖发布记录。导出的通用 JSON 不携带本地库、历史、运行参数或缓存。
- 0.6.x 支持子拓扑与导航；0.5.x 起提供发布接口；0.4.x 起提供时效接口；0.1.x 不支持 v3。0.x 的小版本可增加必需配套的功能，升级时同时替换制作工具与组件并阅读接入说明，不能只降低文件版本号。
- 补丁版本用于兼容修复。API 或文件行为变化同步更新接入说明、解析、声明、导出与验证；ESM 需要浏览器/打包器环境，UMD 使用 `TopologyKit` 全局。不承诺 Node 服务端执行 DOM 绘图。宿主页面和脚本应使用 UTF-8。

大包体积有独立预算：工作台每个 JS 最大 750 KiB / gzip 250 KiB，SDK ESM 最大 1100 KiB / gzip 300 KiB，UMD 最大 800 KiB / gzip 250 KiB。配置见 `scripts/artifact-budgets.json`；`check:package` 超额直接失败，并输出实际体积至 `artifacts/package/sizes.json`。Vite 的应用警告阈值与预算一致。ESM 保留库注释/格式，UMD 压缩为单文件；共享 X6 仍是主要体积，离线 HTML 的 UMD 只在用户导出时请求。没有通过重复加载两套图形库来缩小某个文件的数字。

## 检查入口

```bash
bun install --frozen-lockfile
bun run check
bun run test:e2e
# 单独性能测量，与其他浏览器任务顺序运行
bun run test:benchmark
# 安装版 Safari 的原生功能检查，退出 2 表示仍有待验收项
bun run test:safari
```

`check` 顺序执行数据、服务端数据库/HTTP、部署备份和旧静态服务测试、脚本语法、组件/应用/后端构建、产物入口/类型/Schema/体积检查。Python 3 用于旧版服务回滚及部署检查。`test:e2e` 使用 `dev:local` 验证原本地路径；`test:e2e:server` 使用独立临时数据库验证真实服务端路径。依赖更新使用 `bun install`，锁文件和 Bun 版本一并维护；当前固定 Bun 1.3.14。

`.github/workflows/verify.yml` 配置 Linux 三浏览器、Windows Chrome/Edge、macOS WebKit，并保留失败截图、trace 和包体积报告。Windows 不允许创建符号链接时，仅部署服务的符号链接测试会显示跳过；浏览器与组件检查仍必须执行。**CI 配置本身不是执行记录**，尚未推送/触发的工作流以及安装版 Safari/Windows 实机验收保持待验收。

## 部署与恢复

```bash
bun run deploy
bun run deploy:status
bun run deploy:rollback
```

日常命令继续打包并部署到 `ubuntu@101.43.68.117`，预览端口 **10001**。本机需要 Bun、git、tar、SSH/SCP；远端需要 Python 3、systemd、flock、unzip 和 ubuntu 用户免交互 sudo。脚本在项目自己的 `runtimes/` 下安装并校验固定 Bun，不替换系统其他运行时。脚本不在远端安装 npm 包或构建源码，不修改浏览器本地拓扑存档。

上传使用独立版本目录 `releases/版本ID/`，其中 `site/` 为静态文件，`server/index.js` 为该版 Bun 服务，`runtime-version` 指定运行时。旧 Python 脚本仅用于保留版本回滚。持久数据库与账户文件固定在根目录 `data/`，不放入发布包。完整解压并检查入口后，以符号链接原子切换 `current`。首次迁移将旧 `dist/` 备份为 `releases/legacy`；之后 `previous` 指向上一成功版本。部署锁避免并发切换。历史保留最近五版并保护当前和上一版；失败的暂存目录不影响当前服务。

systemd 单元名 `station-device-draw.service`，以 ubuntu 身份运行，`Restart=always`、一秒重启延迟，并启用 `multi-user.target` 启动恢复。日志可用 `journalctl -u station-device-draw -n 100 --no-pager` 查看。部署后的短启动健康检查只请求远端回环的 `/api/health` 和版本 JSON（旧版没有元信息时检查入口）；失败自动切回先前版本并重启服务，命令保持失败退出。没有例行远端浏览器、资源遍历或哈希比对。

`deploy:rollback` 不重新构建，将应用及服务脚本切到 `previous`，成功后交换当前/上一版，可再次执行返回。代码回滚不回滚数据库；回到 0.6.x 时暂时不能访问服务器库，再部署 0.7.0 即恢复读取。部署/切换到服务器版本前自动执行一致性数据库备份，手动入口为 `bun run deploy:backup`。还原数据库须停服务并按 [服务器说明](server.md) 操作。运行中的旧标签页仍可请求保留版本的内容寻址资源；HTML 与元数据不长缓存，资源按哈希长期缓存。已超出保留范围的标签页可刷新加载当前版。静态服务不列目录，服务脚本位于静态根之外。

S12 验证应记录：服务 active/enabled、异常终止后 PID/重启计数变化、停止后冷启动、版本回滚往返、故障版本健康失败后旧版恢复。验证开机启用配置与服务冷启动不等于重启整台云服务器；不为了验收擅自重启服务器上的其他服务。

S12 本轮部署恢复验收记录见 仓库中的 `docs/deployment/s12-proof.json`。其中构建来自记录中的基础提交加本批次未提交改动，manifest 明确标记 `dirty: true`；最终提交标识见迭代指引与 git 历史。

## 0.7.0 服务器边界

SQLite 第一版使用单共享库快照及独立库版本，事务内复用 WorkspaceStore 命令；浏览器切图不是库写入。请求 ID 收据支持响应丢失后的幂等重试；并发修改按全库拒绝，不提供逐字段自动合并。数据库模式版本独立于文档 v3，未来结构升级必须提供数据库迁移与回滚兼容说明。

账号为单管理员，初始随机凭据保存在权限受限的 data/admin-credentials.json，部署后下载到本机 .local/preview-credentials.json。开发和预览 HTTP 登录不代替正式 HTTPS 部署。SQLite备份、凭据、会话和本机恢复数据均不纳入 Git 或静态资源目录。
