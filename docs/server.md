# 服务器持久化（0.7.0）

第一版使用 Bun 1.3.14 + SQLite，一个管理员账户管理一个共享拓扑库。文档、模板、草稿、有限历史和发布版本都存入服务器。浏览器只保留界面偏好、当前图选择和未确认保存的恢复副本。设备参数、运行状态、连接时效和撤销栈不写入数据库。

## 启动与文件结构

```bash
bun install
bun run dev        # Vite 5173 + Bun API 3001，前端同源代理 /api
bun run dev:local  # 原纯浏览器模式，用于离线制作和原交互回归
bun run build     # 工作台、独立组件和服务端
TOPOLOGY_HOST=0.0.0.0 TOPOLOGY_PORT=10001 bun dist-server/index.js
```

开发首次启动生成 `data/admin-credentials.json`，查看其中用户名和密码登录。该文件、数据库、`.local/` 均忽略提交。生产部署会把预览账户下载到本机 `.local/preview-credentials.json`，不会在构建日志中输出密码。

```text
server/                  HTTP、登录、SQLite 事务及静态资源服务
shared/api.ts            前后端请求、响应及命令类型
src/workspace.ts          前后端复用的文档/草稿/历史/发布规则
src/workspace-client.ts   异步写入、服务器确认快照及重试
src/server-session.ts    登录与会话恢复
src/server-recovery.ts   本机未同步副本及旧库读取
tests/server/            数据库与 HTTP 验收
tests/server-browser/    真实服务端路径的浏览器验收
dist/                   工作台与展示页静态文件
dist-server/            Bun 服务端构建产物
dist-viewer/            可独立使用的展示 SDK
data/                   本地开发持久数据，不进入构建产物
```

原有纯领域模块仍保留在 `src/`，服务端直接复用校验和命令，避免维护两套规则。没有整体改成 monorepo。独立展示 SDK 不导入服务器、登录或存储客户端，通用文件仍是 v3，Schema 不变。

配置项：

| 环境变量 | 默认值与用途 |
| --- | --- |
| `TOPOLOGY_DATA_DIR` | `./data`；数据库、管理员凭据和备份目录 |
| `TOPOLOGY_SITE_DIR` | `./dist`；静态页面目录 |
| `TOPOLOGY_HOST` / `TOPOLOGY_PORT` | `127.0.0.1` / `3001`；监听地址和端口 |
| `TOPOLOGY_ADMIN_USERNAME` / `TOPOLOGY_ADMIN_PASSWORD` | 首次未提供时生成 `admin` 与随机密码；密码至少 12 字符 |
| `TOPOLOGY_ALLOWED_ORIGINS` | 额外允许的写请求 Origin，逗号分隔；默认只接受同源浏览器请求 |
| `TOPOLOGY_COOKIE_SECURE` | HTTPS 反向代理部署时设为 `true` |
| `TOPOLOGY_RELEASES_DIR` | 部署脚本设置，用于读取保留版本的旧哈希资源 |

密码使用 Argon2id 校验；初始凭据文件仅供管理员读取，目录和文件权限为 700/600。会话有效期 24 小时，Cookie 为 HttpOnly、SameSite=Lax，退出立即注销。现有 IP:10001 预览仍为 HTTP；正式使用凭据登录时应放在 HTTPS 反向代理后，并启用 Secure Cookie。第一版没有多角色权限、SSO、公开分享链接或多人实时共同编辑。

## 保存、冲突与恢复

自动保存和手动保存均等服务器确认后才显示成功。请求串行发送，在出队时使用最近确认的库版本。等待响应期间继续编辑，旧响应只确认当时的快照，不覆盖新修改。

SQLite 在事务内检查全库版本、执行命令、写入快照并记录请求 ID。两个浏览器基于同一版本写入时，第一个成功，后一个返回 409；不同图同时修改也可能冲突，这是第一版按库保护的边界。切换当前图只改本机偏好，不增加库版本。

断网或服务器异常时，画布保留并显示失败，不会悄悄切回本地库。重试使用相同请求 ID，以便服务器已提交而响应丢失时不重复发布。发生冲突后不能强制覆盖；先导出当前图，再重新读取服务器。在“服务器库 → 本机恢复副本”中可将未同步内容恢复为新图、导出或移除。原服务器图保持不变。

页面关闭前同步写入独立本机恢复键，未确认内容触发离开提醒。浏览器禁用存储或配额不足时会提示无法保留本机副本；服务器保存仍可使用。未点击“应用修改”的表单输入不属于文档草稿。

## 迁移与备份

在原来制作拓扑的浏览器、原访问地址打开新版，点击“服务器库 → 迁移本浏览器拓扑库”。先查看文档、草稿、历史和发布数量，也可先备份浏览器原存档。空服务器初始库会被迁入库替换；已有内容时合并不同 ID 的图。同 ID 的完整内容一致则跳过，不一致则整批拒绝，不自动改 ID 或覆盖。

迁移保留模板、节点和连线 ID、手工坐标/拐点、子图引用、草稿基准、历史及发布关系。迁移导致原有历史容量约束裁剪时拒绝整批操作。成功后浏览器原键继续保留。

不同地址或端口的浏览器存档无法互相读取。若旧地址无法访问，可从仍可访问的原浏览器导出通用图，或迁移完整库备份。“导出完整拓扑库 / 导入完整库备份”包含多图及编辑/发布记录；普通 `.topology.json` 只包含一张图，不包含历史。完整库导入是校验后的合并，不是无条件覆盖还原。

```bash
bun run backup          # 本地 SQLite 一致性备份
bun run deploy:backup   # 远端一致性备份，返回服务器上的备份路径
```

SQLite 使用 WAL；不要在运行时只复制 `workspace.sqlite` 而遗漏 WAL。备份脚本通过 `VACUUM INTO` 生成一致快照并做完整性检查，同时复制账户文件。数据库备份包含会话，属于私密管理资料。

完整数据库还原需停服务，先另备份现有 `data/`，将备份中的数据库与账户文件恢复到数据目录，并移走旧数据库对应的 `-wal`、`-shm` 文件，再启动服务。只有完整还原才会替换全库；日常代码回滚不会还原数据库。

## API 与展示接入

所有拓扑读写接口要求已登录会话，错误结构为 `{ error: { code, message, ... } }`。请求 JSON 上限 32 MiB，登录上限 4 KiB。浏览器写请求校验 Origin。

| 请求 | 行为 |
| --- | --- |
| `GET /api/health` | 进程/数据库可用性，不返回业务内容 |
| `GET /api/session` | `{ authenticated, username? }` |
| `POST /api/login` | `{ username, password }`，成功设置会话 Cookie |
| `POST /api/logout` | 注销当前会话 |
| `GET /api/workspace` | `{ revision, workspace }`，不缓存 |
| `POST /api/workspace/commands` | `{ expectedRevision, requestId, command }`；成功返回提交后的库和版本 |

命令包括 `saveDraft`、`saveDocument`、`updateLibrary`、`restoreDraft`、`discardDraft`、`publish`、`rollbackPublication`、`migrateWorkspace`，精确定义见 `shared/api.ts`。发布还需传 `expectedPublicationRevision`。请求 ID 用于一次操作的重试；新操作必须使用新 ID。401 表示会话失效，409 表示版本/迁移/请求 ID 冲突，422 表示输入不合法。

服务端展示页与工作台共用登录。`?document=ID&draft=1` 读取有效草稿，不带 `draft` 读取手动保存版本。`?published=ID` 每 5 秒检查当前发布，自动草稿不触发展示切换；带 `publication=发布ID` 的固定链接保持该历史快照。断网提示更新失败并保留已加载图，源图删除则当前发布展示清空。

嵌入其他软件仍推荐将业务后端读取的发布 `document` 传给 `TopologyViewer`，再由宿主使用 `setData` / `updateData` 和链路 API 更新运行值。本项目 API 不替代设备采集服务；SDK 不要求连接本服务器。导出的单文件 HTML、PNG、SVG 也不要求登录或访问数据库。

## 部署与验证

日常继续运行 `bun run deploy`。版本目录只有静态页面和服务代码，持久数据固定在 `/home/ubuntu/station-device-draw/data/`，Bun 运行时在 `runtimes/`。systemd 继续使用 `station-device-draw.service`，端口 10001；部署/回滚不覆盖数据库。回滚到 0.6.x 的纯静态版本后暂时无法访问服务器库，但数据库仍保留，重新部署 0.7.0 可继续读取。

```bash
bun run check             # 数据、服务器、部署工具、类型、构建及 SDK 包
bun run test:e2e          # 原本地模式三浏览器回归，专用端口5174
bun run test:e2e:server   # 独立临时数据库，真实服务器路径，端口5183
bun run test:safari:server # macOS实际Safari与Chrome双向存储验收
```

第一版验收：Chrome 创建/保存，另一个独立浏览器读取；未登录无法读写；冲突不覆盖；断网可恢复；完整迁移不丢草稿/历史/发布/子图关系；服务关闭重开及重新部署后数据库内容保持。具体执行结果和未验收项记录在迭代工作指引，不把已编写用例等同于已通过。
