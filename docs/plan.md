# Conser — 完整架构与设计说明书

> 用途：交付给实现 agent 的单一事实来源（SSOT）。包含范围、架构、契约、数据模型、验收标准与任务拆分。不含实现代码。

------

## 1. 项目定位与已锁定决策

**一句话定位**：opencode v2 常驻服务的轻量对等 GUI 客户端 + 本地适配层（BFF），补齐 opencode 不提供的"编辑 / 搜索 / 批量替换 / Git / Diff / 终端"能力，形态上参考 PyCharm 的日常操作习惯。

| 项         | 决策                                              | 备注                                          |
| ---------- | ------------------------------------------------- | --------------------------------------------- |
| 运行平台   | 仅 Windows 本机                                   | WSL、远程、公网全部推迟，仅保留抽象钩子       |
| 目标项目   | 仓库在 Windows 盘，主语言 Python                  | venv 内解释器、UTF-8 + LF 为默认              |
| 交付形态   | 浏览器打开 `127.0.0.1`（主）+ Tauri 壳（M4）      | 一套 Web SPA，两处运行                        |
| 语言       | BFF/前端 TypeScript(Node 20)，壳 Tauri(Rust 胶水) | 不引入第二运行时                              |
| 用户与鉴权 | 单用户、本机免登录                                | 不做 ACL/审计/TLS/CORS；opencode 仍设本地密码 |
| 终端 shell | cmd.exe（ConPTY）                                 | 自动激活 venv                                 |
| 内存预算   | opencode 不计入；壳+前端 < 200MB；BFF < 50MB      | 硬指标，见 §11                                |
| 状态归属   | 服务端为唯一真相，本地只存 UI 偏好                | 严格遵循"只做 GUI 适配"边界                   |

**明确不做**：多用户、远程访问、登录鉴权、审计、WSL 实现、LSP 客户端（复用 opencode 内置 pyright）、fork 官方前端、内置全仓索引。

------

## 2. 系统拓扑

```
[Windows 本机]
  浏览器 / Tauri 壳(WebView2)
      │  http://127.0.0.1:<BFF_PORT>   同源，无鉴权
      ▼
  BFF（Node 20 + Fastify，单进程，唯一后端）
      ├─ 托管 opencode 子进程（Job Object 兜底，父死子死）
      ├─ /api/oc/*   同源反代 → http://127.0.0.1:<OC_PORT>（注入 Basic Auth）
      ├─ /api/events SSE 汇聚 + 环形重放缓冲（补帧）
      ├─ /api/fs|search|git|snapshots|pty|lint  本地能力
      ▼
  opencode serve（v2，仅 127.0.0.1，密码存本地 env）
      ▲
      └─ 外部：pyright / ruff / git / ripgrep（BFF 以子进程调用）
```

关键取舍：

- **BFF 必需**：浏览器无法读文件系统、跑 git/rg、起 PTY；有了它 Web 与桌面共用同一能力面，未来接 WSL/远程只换 Host 实现。
- **前端只连 BFF**，永不直连 opencode（凭据不下发、CORS 不需要、SSE 可补帧）。
- **BFF 无业务状态**：仅缓存上游规范与 UI 无关的运行时信息（端口、pid、探测结果）。

------

## 3. 分层与模块划分

### 3.1 前端（apps/gui）

| 模块                | 职责                                                         |
| ------------------- | ------------------------------------------------------------ |
| `features/chat`     | 会话列表、消息流、工具调用时间线、权限审批面板、模型/参数选择 |
| `features/editor`   | 文件树、CodeMirror 6 单例编辑器、标签页、诊断标注、保存与冲突提示 |
| `features/search`   | 搜索面板（流式结果）、批量替换向导（preview→apply→撤销）     |
| `features/git`      | 状态/分支/日志、diff 视图（hunk 级暂存与回滚）、提交表单     |
| `features/diff`     | 统一 Diff 视图（四种来源归一化渲染）、快照对比               |
| `features/terminal` | xterm.js 多标签、scrollback、查找、resize                    |
| `features/settings` | workspace 管理、快捷键、内存/健康状态、能力探测结果展示      |
| `store`             | zustand 切片：sessions / messages / permissions / fs / diff / pty / ui |
| `api`               | 生成的类型客户端 + SSE 连接管理（重连、last-event-id、心跳） |

设计约束：虚拟滚动消息列表；工具输出默认折叠；diff 懒加载；文本增量 16ms 批处理刷新；reducer 为纯函数（可单测乱序/重复事件）。

### 3.2 BFF（apps/server）

| 模块               | 职责                                                        |
| ------------------ | ----------------------------------------------------------- |
| `app`              | Fastify 装配、静态托管前端、错误与日志、优雅关闭            |
| `runtime`          | 端口探测与占用回退、pid/端口写入 runtime 文件、单实例锁     |
| `routes/oc`        | 同源反代（HTTP/SSE/WS 透传，禁用缓冲）                      |
| `routes/events`    | 对前端暴露聚合 SSE，带 `since` 补帧                         |
| `routes/fs`        | 树、读、写（乐观锁）、重命名、删除、目录操作                |
| `routes/search`    | rg 流式搜索（NDJSON + 游标）、替换 preview/apply            |
| `routes/git`       | status/log/diff/exec（白名单子命令）、hunk 级 apply/reverse |
| `routes/snapshots` | 影子仓库记录、列举、对比、回滚                              |
| `routes/pty`       | 一次性票据 + WebSocket 终端                                 |
| `routes/lint`      | 保存后 pyright/ruff 诊断，映射行号                          |
| `lib/sseBus`       | 上游事件消费、环形缓冲、扇出                                |
| `lib/host`         | 注入 `RuntimeHost` 实现（本版 WindowsLocalHost）            |
| `lib/probe`        | 启动期能力探测（规范、事件端点、session diff 端点）         |

### 3.3 Host 抽象（packages/host）— 为 WSL 预留的唯一扩展点

接口能力（签名级，不含实现）：

- `id: 'win-local' | 'wsl'`
- `repoRoot` / `resolve(rel) → 绝对路径`
- `spawnOpencode({port, env}) → {child, baseUrl}`
- `watch(paths, cb) → unwatch`
- `createPty(opts) → PtyHandle`
- `exec(cmd, args, opts) → {code, out, err}`（`shell:false`，UTF-8 解码）

**规则**：业务代码不得出现平台字面量（盘符、`wsl.exe`、shell 名）；一切平台差异收敛到该实现内。

------

## 4. 目录结构

```
opencode-gui/
  apps/gui/            # React + Vite + CodeMirror6 + xterm.js + zustand
  apps/server/         # BFF：Fastify
  apps/desktop/        # Tauri（M4，Windows 目标）
  packages/host/       # RuntimeHost 抽象 + WindowsLocalHost
  packages/protocol/   # OpenAPI 生成类型 + 事件类型 + zod 校验
  packages/diff/       # diff 解析/归一化/hunk 操作（纯函数，单测覆盖）
  packages/config/     # 默认配置、schema、常量
  scripts/             # bootstrap.ps1 / codegen.mjs / probe.mjs / memtest.mjs
  docs/                # 本设计、ADR、API 契约快照
```

运行时数据（用户目录，不入仓库）：

- `%APPDATA%\opencode-gui\`：`settings.json`、`workspaces.json`
- `%LOCALAPPDATA%\opencode-gui\`：`runtime.json`、日志、缓存、`snapshots\<projectHash>\`

------

## 5. 核心数据模型（概念级）

| 实体         | 关键字段                                                | 说明                                         |
| ------------ | ------------------------------------------------------- | -------------------------------------------- |
| `Workspace`  | id, path, label, venv, checkCmd, lintCmd, encoding, eol | 多项目切换；所有 fs/git/pty 请求带 `ws` 参数 |
| `Session`    | id, title, status(busy/idle/error/retry), updatedAt     | 状态由事件归约得出，不本地推断               |
| `Message`    | id, role, parts[], tokens, error, finish                | 幂等 upsert；用户消息会 echo                 |
| `Part`       | id, kind(text/tool/patch/file), 状态, 增量内容          | 按 partID 合并增量                           |
| `Permission` | id, sessionID, 描述, 状态(ask/allow/deny)               | **按 sessionID 分桶排队**                    |
| `FileDiff`   | path, status, hunks[{old,new,lines}]                    | 四种来源归一化后的统一结构                   |
| `DiffSource` | kind: session/message/commit/working/snapshot, 定位参数 | UI 只认归一化结果                            |
| `Snapshot`   | id, projectHash, 时间点, 触发原因, blob 索引            | 影子仓库，按项目隔离                         |
| `PtySession` | id, ticket, shell, cwd, cols/rows                       | 票据一次性消费                               |

------

## 6. BFF 接口契约（前端唯一依赖）

| 分组 | 端点                                                         | 语义要点                                               |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------ |
| 系统 | `GET /api/health`                                            | 聚合 BFF + 上游健康与版本                              |
| 契约 | `GET /api/oc/spec`                                           | 缓存上游 OpenAPI；供类型校验                           |
| 探测 | `GET /api/probe`                                             | 事件端点、session diff 端点是否存在；前端据此隐藏入口  |
| 代理 | `ALL /api/oc/*`                                              | 透传 HTTP/SSE/WS；注入 Basic Auth；`no-transform`      |
| 事件 | `GET /api/events?since=<id>`                                 | 聚合 SSE + 补帧；心跳注释帧                            |
| 文件 | `GET /api/fs/tree`、`GET/PUT /api/fs/file`、`POST /api/fs/{rename,delete}` | 写带 `baseHash`，冲突 409                              |
| 搜索 | `POST /api/search`                                           | rg `--json` 流式 NDJSON + 游标分页                     |
| 替换 | `POST /api/replace/preview` → `POST /api/replace/apply`      | preview 返回命中数/样例/跳过项；apply 备份+事务+撤销栈 |
| Git  | `GET /api/git/status`、`GET /api/git/diff`、`POST /api/git/exec`、`POST /api/git/apply-hunk` | exec 仅白名单子命令                                    |
| 快照 | `GET/POST /api/snapshots`、`GET /api/snapshots/diff?a=&b=`、`POST /api/snapshots/restore` | 影子仓库                                               |
| 诊断 | `POST /api/lint`                                             | pyright/ruff JSON → 行号级诊断                         |
| 终端 | `POST /api/pty/token` → `WS /api/pty?ticket=`                | 首帧 resize，双向字节流                                |

**契约纪律**：opencode 的路由/事件名变化只影响 `routes/oc` + `lib/probe`，不得泄漏到前端业务代码；前端只消费 BFF 的稳定契约。

------

## 7. 事件流与状态归约

**链路**：opencode SSE → BFF 消费者（解析、编号、入环形缓冲）→ 扇出到前端 → reducer → 渲染。断线时前端带 `last-event-id` 重连，BFF 从缓冲补帧；缓冲溢出则前端触发"全量重拉会话"降级。

**归约规则表（实现 agent 必须逐条落实并单测）**

| 事件语义      | 动作                                   | 陷阱                                   |
| ------------- | -------------------------------------- | -------------------------------------- |
| message 更新  | 按 id 幂等 upsert                      | 用户消息 echo 会重复                   |
| part 增量更新 | 按 partID 合并；文本进 16ms 批处理     | 以最终 part 覆盖增量，避免残字         |
| message 移除  | 删消息并清 part 索引                   | 上下文压缩会触发                       |
| session 状态  | 更新 busy/retry/idle                   | retry 显示"重试中"而非报错             |
| session 空闲  | 标记结束但留宽限期                     | 过早收尾会截断输出                     |
| session 错误  | 立即收尾、标红、保留已产出             | 与 error part 是两条路径               |
| session 删除  | 移除并切相邻会话                       | 必须清局部状态，否则串会话             |
| 权限请求      | 按 sessionID 入队，弹审批              | 全局单队列会互相阻塞；不响应会卡死整轮 |
| 文件/工具事件 | 更新时间线 + 触发 diff 刷新 + 记录快照 | 高频事件需节流，防重渲染风暴           |

> 事件与端点的**具体名称以本机 v2 导出规范与实测为准**（2.0 Server API 为全新约定）。M0 的探测结果决定 UI 能力矩阵，缺能力则隐藏入口并降级，禁止白屏。

------

## 8. 功能设计要点

**8.1 会话面板**：连接已运行服务（只连不启）；流式渲染 + 工具时间线折叠；权限三态（allow/ask/deny），"始终允许"仅会话内有效并在 UI 说明。

**8.2 编辑器**：CodeMirror 6 按需装配；全局单例 + 标签页；保存后触发 lint 并标注行号；>2MB 只读 + 虚拟滚动；二进制走懒加载预览。不内嵌 LSP 客户端（诊断来自 opencode 侧与 CLI）。

**8.3 搜索/批量替换**：搜索走 rg 流式，不在浏览器建索引；替换为事务流程：preview（命中/样例/跳过）→ 生成 patch → 备份 → 一次性应用 → 写后校验 → 入撤销栈。应用前逐文件校验 mtime/hash，被外部改动则中止并提示三方合并。EOL 与编码保真：读时探测、写回保持原样，非 UTF-8 默认跳过并提示。

**8.4 Git 与 Diff**：一律调系统 git CLI（porcelain/流式解析），不用纯 JS git 实现。Diff 解析为结构化 hunks，支持按文件/按 hunk 暂存与回滚。统一 DiffSource → FileDiff 归一化，覆盖：工作区 vs HEAD、会话/消息前后、指定 commit、两个快照。

**8.5 影子仓库（安全网）**：独立 `--git-dir`，按 content-hash 去重记录 blob 快照；触发点为批量替换前、agent 写文件前后。提供任意两点对比与回滚，不污染用户仓库；目录在用户数据区，不入仓库、不被搜索命中。

**8.6 终端**：ConPTY + cmd.exe，启动时 `chcp 65001` 并激活 venv；多标签、scrollback、查找、resize；子进程统一注入 UTF-8 环境与 venv PATH。BFF 内部命令一律 `shell:false` 绕开 cmd 转义。

------

## 9. 跨切面设计

**配置与 workspace**：`workspaces.json` 为项目列表，每项含路径、venv、检查/格式化命令、编码与 EOL；所有 fs/git/pty 请求带 `ws` 参数解析根路径。影子仓库按 projectHash 隔离。

**Windows 专项**：长路径开关与 `\\?\` 规范化；CRLF/编码探测与保真；NTFS 大小写不敏感（`core.ignorecase`、仅大小写重命名走两步）；文件监听用原生事件 + 200ms 去抖 + 目录级合并 + 背压（忽略 `.venv/__pycache__/dist/build/.git`）；进程生命周期用 Job Object 兜底并启动时清理同端口残留；Defender 排除目录仅提示不自动改。

**Python 专项**：所有子进程用项目 venv 解释器并前置其 PATH；`PYTHONUTF8/PYTHONIOENCODING=utf-8`；诊断来自 pyright（GUI 侧 CLI）+ opencode 内置 LSP（agent 侧）；rg 排除 Python 缓存与虚拟环境目录。

**安全（本机也执行）**：opencode 仅绑 127.0.0.1 并设密码（BFF 内部持有，不下发前端）；不传 `--cors`；BFF 仅监听 127.0.0.1；插件目录变更视为可展示、可 diff 的事件；快照目录不出用户数据区。

**内存策略**：消息虚拟滚动、工具输出折叠、diff 懒加载、单编辑器实例、生产关 sourcemap、BFF 流式 IO 不缓存全仓内容。

------

## 10. 非功能性验收

| 指标             | 目标                                                   | 测法                                                      |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| 壳+前端常驻      | < 200MB                                                | 固定 20 万行仓库 + 50 条会话，采样 RSS 峰值与 30 分钟驻留 |
| BFF              | < 50MB                                                 | 同上                                                      |
| 首屏可交互       | < 2s（本机）                                           | 冷启动计时                                                |
| 流式延迟         | 增量到屏 < 100ms                                       | 打点统计                                                  |
| 搜索 20 万行仓库 | 首结果 < 1.5s                                          | 固定查询集                                                |
| 可靠性           | 杀 BFF 不留孤儿 opencode；重启后会话可续、消息不丢不重 | 脚本化故障注入                                            |
| 契约漂移         | 上游规范变更时 CI 类型 diff 失败                       | codegen + `git diff --exit-code`                          |

------

## 11. 里程碑与任务拆分（可直接派单）

**M0 基座（1 周）**

- T0.1 `bootstrap.ps1`：检查 Node20/git/rg/opencode/pyright/VS Build Tools/长路径/venv，缺项显式报错
- T0.2 `RuntimeHost` 抽象 + `WindowsLocalHost`（进程托管、监听、exec、PTY 骨架）
- T0.3 BFF 装配：健康、单实例锁、端口回退、runtime 文件、优雅关闭
- T0.4 同源反代 + SSE 透传
- T0.5 codegen：拉取上游规范生成类型 + CI diff
- T0.6 能力探测 + 前端能力矩阵（缺 session diff 则隐藏入口）
- 验收：浏览器打开可见会话列表；杀 BFF 无孤儿进程；探测结果落盘

**M1 对话闭环（2 周）**

- T1.1 sseBus（编号、环形缓冲、补帧、重连）
- T1.2 reducer 全事件覆盖 + 单测（乱序/重复/丢失）
- T1.3 流式渲染 + 工具时间线 + 权限审批分桶
- 验收：日常对话可替换官方桌面端；断网恢复不丢不重；并发审批互不阻塞

**M2 编辑与搜索（2 周）**：文件树、CodeMirror 标签页、乐观锁保存、EOL/编码保真、lint 标注、rg 搜索、替换 preview/apply/撤销 **M3 Git 与 Diff（2 周）**：Git 面板、统一 Diff 归一化、hunk 级操作、影子仓库记录/对比/回滚 **M3.5 终端（1 周）**：票据握手、cmd+venv、多标签/scrollback/查找 **M4 桌面与压测（1–2 周）**：Tauri(WebView2) 打包、托盘、Job Object、内存压测与降级

------

## 12. 风险登记册

| 风险                          | 影响                         | 缓解                                                |
| ----------------------------- | ---------------------------- | --------------------------------------------------- |
| v2 契约漂移（端点/事件变动）  | 面板白屏、功能缺失           | 锁小版本 + 类型 diff + 启动探测 + 能力降级          |
| 上游事件重放语义不确定        | 断线丢消息、UI 与 TUI 不一致 | BFF 自建缓冲补帧 + 溢出全量重拉                     |
| Windows 原生运行已知不完美    | 交互卡顿                     | 只用 serve，不用其 TUI；异常时切 WSL（Host 已抽象） |
| node-pty 原生编译失败         | 终端模块阻塞                 | bootstrap 前置检查 + 可选关闭终端特性               |
| 批量写与 agent 并发冲突       | 丢改动                       | 乐观锁 + 事务 + 备份 + 影子仓库回滚                 |
| CRLF/编码导致整文件 diff 翻红 | 审查困难                     | 探测保真 + `.gitattributes`/autocrlf 约定           |
| 事件风暴导致 UI 卡死          | 可用性                       | 监听去抖 + 事件节流 + 批处理渲染                    |
| 本地服务未认证暴露面          | 本机被网页脚本触发           | 仅 127.0.0.1 + 密码 + 无 CORS                       |

------

## 13. 交给实现 Agent 的硬性约束（Do / Don't）

**Do**

1. 先跑 M0 探测，把实测端点/事件清单写进 `docs/api-contract.md`，再实现 M1。
2. reducer、diff 归一化、EOL 保真、hunk 操作写成纯函数并单测。
3. 所有平台差异收敛到 `RuntimeHost`；新增平台只加实现类。
4. 每个里程碑结束跑内存与故障注入脚本，指标进 CI 记录。

**Don't**

1. 不在前端直连 opencode、不下发上游凭据。
2. 不在业务代码写盘符/shell 名/WSL 命令。
3. 不 fork 官方前端、不引入 Electron、不引入第二运行时。
4. 不做登录/多用户/远程/TLS（本轮范围外）。
5. 不把快照写进仓库、不依赖 opencode 内部快照路径作为契约。
6. 不用纯 JS 实现 git；不在浏览器建全仓索引。

**Definition of Done（每票通用）**：类型通过 + 单测通过 + 手测验收项勾选 + 内存指标未劣化 + 契约文档同步更新。

------

需要我补充的话，可以再生成两份配套件：**① `docs/api-contract.md` 的空白模板（供 M0 探测后填写）**、**② 各里程碑票的验收用例清单（含故障注入步骤）**。