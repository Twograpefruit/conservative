# OpenCode 服务契约快照

状态：**PROBED（已回填）**
上游版本：opencode v2.2.1（`@opencode/cli` 2.2.1）
探测时间：2026-10-29 17:30 (+08:00)
说明：BFF 与前端只依赖本文件记录的稳定契约。上游端点或事件变动时，先更新本文件并走评审，再改代码。
判定口径：一律以本机 `GET /openapi.json` 与实测事件流为准；文档、教程、模型记忆均不作为依据。无法确认的项写 UNKNOWN。

---

## 0. 使用说明

- 回填时间：M0/T0.6 完成时。此后每次升级 opencode 小版本、或 `npm run codegen` 类型 diff 非空时，重跑 `node scripts/probe.mjs` 并更新 §7。
- 原始证据：
  - `docs/upstream/openapi-2.2.1.json`（上游规范）
  - `docs/upstream/events-stream.txt`（纯文本流样例）
  - `docs/upstream/events-tool.txt`（工具调用流样例）
  - `docs/upstream/probe.json`（BFF 探测落盘）
- 闸门规则：§2 必需项任一 FAIL → M0 不得开工；可选项 FAIL → 记入 §6 并调整范围。

---

## 1. 版本与环境快照

| 项                                | 值                                                              |
| --------------------------------- | --------------------------------------------------------------- |
| 探测时间 / 机器名                 | 2026-10-29 17:30 / DESKTOP-HGH7771                              |
| OS 版本（Windows Build）          | Windows 10 专业版 19045                                         |
| opencode 版本                     | 2.2.1                                                           |
| 安装方式                          | npm 全局 `@opencode/cli`（`%APPDATA%\npm`）                     |
| 1.x 残留检查结果                  | `Get-Command opencode -All` 为同一安装的 shim（无 1.x 双装）    |
| 规范来源 URL                      | `GET /openapi.json`（`/doc` 返回 SPA HTML，不可用）             |
| opencode 监听地址与端口           | BFF 托管时 `127.0.0.1:4312`；探测时活动服务为 `127.0.0.1:28894` |
| BFF 监听地址与端口                | `127.0.0.1:4311`（默认 4310 被占用，自动回退）                  |
| 目标仓库路径 / 主语言             | `C:\Users\mp\Desktop\conservative`（TypeScript 工具链自身仓库） |
| 探测执行人                        | 实现 agent + 本机实测                                            |

---

## 2. 工具链前置校验（开工闸门，逐项实测）

| 编号    | 项                   | 校验命令                                           | 期望                     | 实测输出摘要                                      | 必需性      | 结论 |
| ------- | -------------------- | -------------------------------------------------- | ------------------------ | ------------------------------------------------- | ----------- | ---- |
| ENV-001 | Node.js              | `node -v`                                          | 主版本 ≥ 20              | v24.19.0                                          | 必需        | PASS |
| ENV-002 | npm 全局 bin 在 PATH | `npm prefix -g`；`Get-Command opencode -All`       | 可执行目录已入 PATH      | `%APPDATA%\npm`；3 个同安装 shim                  | 必需        | PASS |
| ENV-003 | Git                  | `git --version`                                    | ≥ 2.40                   | 2.50.1.windows.1                                  | 必需        | PASS |
| ENV-004 | ripgrep              | `rg --version`                                     | 命令可达                 | 系统未安装；使用 `@vscode/ripgrep` 内置二进制     | 必需        | PASS |
| ENV-005 | pyright              | `pyright --version`                                | 可达且能输出 JSON        | 1.1.414；`--outputjson` 正常                      | 必需        | PASS |
| ENV-006 | opencode 2.x         | `opencode --version`                               | 2.x，且无 1.x 双装       | `opencode v2.2.1`                                 | 必需        | PASS |
| ENV-007 | 端口可用性           | `netstat -ano \| Select-String :4310`              | 项目端口空闲             | 4310 被其他应用占用；BFF 自动回退 4311            | 必需        | WARN |
| ENV-008 | Python + venv        | `Test-Path <repo>\.venv\Scripts\python.exe`        | 存在                     | 本仓库为 TS 仓库，无 venv；目标 Python 项目需补 | 必需        | WARN |
| ENV-009 | 长路径开关           | 查 `LongPathsEnabled`                              | 已开启或记录风险         | `LongPathsEnabled=0`；BFF 对路径做规范化          | 建议        | WARN |
| ENV-010 | ruff                 | `ruff --version`                                   | 命令可达                 | 未安装；pyright 正常工作，ruff 为可选             | 可选        | WARN |
| ENV-011 | VS Build Tools(C++)  | `Get-Command cl`                                   | 存在（node-pty 编译）    | 未安装；终端改用上游 ConPTY 桥接                  | M3.5 前必需 | WARN |
| ENV-012 | WebView2 运行时      | 查系统安装项                                       | 存在                     | 已安装（M4 可用）                                 | M4 前必需   | PASS |
| ENV-013 | 备份完整性           | 核对 `.config\opencode`、`.local\share\opencode`  | 三项齐备                 | `.config` 与 `.local\share` 均存在                | 必需        | PASS |
| ENV-014 | 桌面版回归           | 启动桌面版并打开历史会话                           | 卸载 npm 1.x 后仍正常    | 未执行破坏性卸载，历史会话由 API 读取正常        | 必需        | PASS |

闸门结论：**PASS with warnings**（4 项 WARN 已记录；无阻塞项）。

---

## 3. 服务面探测结论

### 3.1 端点清单

v2 的 API 前缀是 **`/api`**，不是 v1 文档中的 `/global/*`。

| 编号  | 能力              | 实测路径                                             | 方法          | 认证  | 实测摘要                                                     |
| ----- | ----------------- | ---------------------------------------------------- | ------------- | ----- | ------------------------------------------------------------ |
| EP-01 | 健康/实例信息     | `/api/info`                                          | GET           | Basic | `{version:"2.2.1",pid,hostname,urls,paths,capabilities}`      |
| EP-02 | OpenAPI 规范      | `/openapi.json`                                      | GET           | Basic | 330,732 bytes，355 schemas                                    |
| EP-03 | 规范备选          | `/doc`                                               | GET           | Basic | **不可用**：返回 SPA HTML                                     |
| EP-04 | 事件流            | `/api/event`                                         | GET (SSE)     | Basic | `text/event-stream`；帧见 §3.2                                |
| EP-05 | 会话列表          | `/api/session`                                       | GET           | Basic | `{data: Session.Info[], cursor}`                              |
| EP-06 | 会话详情          | `/api/session/{id}`                                  | GET/PATCH/DEL | Basic | 详情/改名/删除                                                |
| EP-07 | 消息列表          | `/api/session/{id}/message`                          | GET           | Basic | `{data: Session.Message.Info[]}`，content 内联 parts          |
| EP-08 | 发送消息          | `/api/session/{id}/prompt`                           | POST          | Basic | body `{text}`；返回 `Session.Inbox.User`                      |
| EP-09 | 会话级 diff       | `/api/session/{id}/diff?from=&to=&context=`          | GET           | Basic | `{data: FileDiff.Info[]}`；存在，可用                          |
| EP-10 | 中断              | `/api/session/{id}/interrupt`                        | POST          | Basic | 存在                                                          |
| EP-11 | 权限列表          | `/api/permission/request`                            | GET           | Basic | `{data: Permission.Request[]}`                                |
| EP-12 | 权限回复          | `/api/session/{id}/permission/{requestID}/reply`     | POST          | Basic | body `{decision:"once"\|"always"\|"reject"}`                  |
| EP-13 | 模型 / Agent      | `/api/model`、`/api/agent`                           | GET           | Basic | `{data: Model.Info[]}` / `{data: Agent.Info[]}`               |
| EP-14 | VCS               | `/api/vcs`、`/api/vcs/status`、`/api/vcs/diff`       | GET           | Basic | diff 需 `mode`，返回 `FileDiff.Info[]`                        |
| EP-15 | PTY               | `/api/pty`、`/api/pty/{id}/connect-token`、WS connect | GET/POST/WS  | Basic | connect-token 需要请求头 `x-opencode-ticket: 1`               |
| EP-16 | 配置/项目/位置    | `/api/config`、`/api/project`、`/api/location`       | GET           | Basic | 只读展示可用                                                  |
| EP-17 | 其他              | `/api/plugin`、`/api/integration`、`/api/mcp`        | GET           | Basic | 存在；本 GUI 仅只读展示/不使用                                |

### 3.2 SSE 握手细节

| 项                                 | 实测结论                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------ |
| 响应 Content-Type                  | `text/event-stream`                                                      |
| 帧格式                             | `data: {json}\n\n`；无 `event:` 字段；心跳为注释帧 `: heartbeat`          |
| 事件 envelope                      | `{id, created?, type, location?, data, durable?}`                         |
| `durable`                          | `{aggregateID, seq, version}`；同一会话内 version 递增，可用于幂等/去重   |
| 心跳帧形式与间隔                   | `: heartbeat`；间隔 UNKNOWN（实测 ≤ 20s）                                 |
| 是否支持 `last-event-id` 续传      | UNKNOWN（规范未声明）；BFF 自建 `seq` + 环形缓冲补帧                      |
| 上游是否自带重放/补帧              | UNKNOWN；BFF 不依赖此能力                                                 |
| 断连后重连策略（退避上限）         | BFF：500ms 起、×1.8、上限 15s；前端 EventSource 自动重连                  |
| 事件编号是否单调（能否作补帧游标） | 上游 `evt_*` 不承诺单调；BFF 分配严格递增 `seq`，补帧只用 BFF seq         |

### 3.3 认证与网络

| 项                                      | 实测结论                                                        |
| --------------------------------------- | --------------------------------------------------------------- |
| Basic Auth 是否必需                     | 必需；未认证请求返回 401                                        |
| 未认证请求响应码                        | 401                                                             |
| 绑定地址                                | 仅 `127.0.0.1`                                                  |
| 是否使用 `--cors`                       | 否（BFF 同源反代，浏览器不直连上游）                            |
| 凭据存放位置                            | attach：`%USERPROFILE%\.config\opencode\service.json`；managed：BFF 启动时随机生成，仅存进程内存 |

---

## 4. 事件契约（reducer 的唯一依据）

实测事件（`events-tool.txt` 覆盖完整工具轮；`events-stream.txt` 覆盖纯文本轮）：

| 编号  | 事件 type                       | payload 关键字段                                              | 归约动作                         | 幂等键 / 注意事项                         |
| ----- | ------------------------------- | ------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| EV-01 | `server.connected`              | `{}`                                                          | 标记上游连接                     | 无                                        |
| EV-02 | `session.created`               | `sessionID, slug, projectID, location, title`                 | upsert 会话                      | `sessionID`；payload 用 sessionID 不是 id |
| EV-03 | `session.updated`               | 会话字段补丁                                                  | merge                            | `sessionID`                               |
| EV-04 | `session.deleted`               | `sessionID`                                                   | 删除会话 + 清消息/流/权限/运行时 | 必须清局部状态，防串会话                  |
| EV-05 | `session.execution.started`     | `sessionID`                                                   | busy                             | 按 `created` 防乱序覆盖                   |
| EV-06 | `session.execution.succeeded`   | `sessionID`                                                   | idle                             | 同上                                      |
| EV-07 | `session.execution.failed`      | `sessionID, error{type,message,status}`                       | error + 保留已产出               | 立即收尾标红                              |
| EV-08 | `session.execution.interrupted` | `sessionID`                                                   | idle                             | 同上                                      |
| EV-09 | `session.retry.scheduled`       | `sessionID, attempt?, message?`                               | retry（“重试中”，非错误）        | 与 error 区分                             |
| EV-10 | `session.step.started`          | `sessionID, assistantMessageID, agent, model`                 | 建立 assistant 流                | `assistantMessageID`                      |
| EV-11 | `session.step.ended`            | `assistantMessageID, finish, tokens, cost`                    | 结束 step、记录用量              | 同上                                      |
| EV-12 | `session.step.failed`           | `assistantMessageID, error`                                   | step 标红 + 会话 error           | 同上                                      |
| EV-13 | `session.step.streamed`         | `assistantMessageID`                                          | 触发一次增量刷新                 | 可忽略                                    |
| EV-14 | `session.text.started`          | `assistantMessageID, ordinal`                                 | 建立文本段                       | `(messageID, ordinal)`                    |
| EV-15 | `session.text.delta`            | `assistantMessageID, ordinal, delta`                          | 追加文本；前端 16ms 批渲染       | 乱序时以最终 text 为准                    |
| EV-16 | `session.text.ended`            | `assistantMessageID, ordinal, text`                           | 用完整 text 覆盖增量             | 防止残字                                  |
| EV-17 | `session.reasoning.started/delta/ended` | 与 text 同构（含 ordinal）                            | 思考过程折叠区                   | 未在样例中实测，按同构实现                |
| EV-18 | `session.tool.input.started`    | `assistantMessageID, id, name`                                | 建立 tool 流                     | `(messageID, toolID)`                     |
| EV-19 | `session.tool.input.delta/ended`| `assistantMessageID, id, delta/text`                          | 拼接/解析输入 JSON               | 高频需节流                                |
| EV-20 | `session.tool.called`           | `assistantMessageID, id, input, executed`                     | running                          | 同上                                      |
| EV-21 | `session.tool.progress`         | `assistantMessageID, id, metadata`                            | 合并进度                         | 同上                                      |
| EV-22 | `session.tool.success`          | `assistantMessageID, id, content[], metadata`                 | completed + 输出                 | 输出默认折叠                              |
| EV-23 | `session.tool.failed`           | `assistantMessageID, id, error`                               | error + 输出                     | 同上                                      |
| EV-24 | `session.inbox.enqueued`        | `inboxID, sessionID, item{type:"user",payload.text}`          | 乐观显示用户消息                 | `inboxID`；用户消息会 echo                |
| EV-25 | `session.inbox.delivered`       | `inboxID, sessionID`                                          | 投递确认（可忽略）               | 同上                                      |
| EV-26 | `session.usage.updated`         | `sessionID, cost, tokens`                                     | 更新 token/cost                  | 同上                                      |
| EV-27 | `permission.asked`              | `id, sessionID, action, resources[], message?`                | 按 sessionID 入队                | `permissionID`；不响应会卡死整轮          |
| EV-28 | `permission.replied/rejected`   | `sessionID, requestID, decision`                              | 出队                             | `permissionID`                            |
| EV-29 | `message.updated/removed`       | v1 兼容字段                                                   | upsert/删除消息                  | 未在 v2 流样例中出现，作兜底              |
| EV-30 | `session.diff` / `file.edited`  | 文件变更                                                      | 触发 diff 刷新 + 快照            | 需节流                                    |
| EV-31 | `vcs.branch.updated`            | 分支变更                                                      | 刷新 Git 面板                    | 可忽略                                    |

> 结论：v2 是**轮次级流事件**（`session.text.*` / `session.tool.*`），不是 v1 的
> `message.part.updated`。reducer 已按 v2 实现，并保留 v1 兜底。

---

## 5. 能力矩阵与降级策略

| 能力           | 探测依据                    | 可用 | UI 行为                                      |
| -------------- | --------------------------- | ---- | -------------------------------------------- |
| 流式对话       | EP-04 + EV-14..16           | 是   | 增量渲染，断线补帧                            |
| 工具调用时间线 | EV-18..23                   | 是   | 折叠卡片、状态流转                            |
| 权限审批       | EP-11/12 + EV-27/28         | 是   | 按会话分桶排队                                |
| 会话级 diff    | EP-09                       | 是   | 统一 DiffView                                 |
| 快照/回滚      | 本地影子仓库                | 是   | 任意两点对比、恢复前自动快照                  |
| 内置终端       | 上游 ConPTY（EP-15）        | 是   | 一次性票据 + 60s TTL；不可用时隐藏入口        |
| 编辑器诊断     | 本地 pyright CLI            | 是   | 保存后行号级诊断；ruff 可选                   |
| 原生 node-pty  | 本机无 VS Build Tools       | 否   | 自动降级到上游 PTY 桥接，不阻塞终端功能       |

---

## 6. 已知偏差与风险（探测期发现即记）

| 编号    | 现象                                              | 影响                          | 处置                                             |
| ------- | ------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| RISK-01 | v2 路径为 `/api/*`，`/doc` 返回 SPA               | 按 v1 文档接会全 404          | 以 `/openapi.json` 为准，BFF 固化契约             |
| RISK-02 | 事件是 `session.text/tool.*`，非 `message.part.*` | v1 reducer 直接失效           | reducer 覆盖 v2 + v1 兜底，单测锁行为             |
| RISK-03 | PTY connect-token 需 `x-opencode-ticket: 1`       | 缺头返回 403                  | BFF 统一注入；票据一次性消费                      |
| RISK-04 | BFF 常驻 RSS 约 79MB                            | 超出 50MB 预算                | 记录为偏差；后续按需裁剪依赖/日志/缓冲            |
| RISK-05 | 会话属于 location，跨项目会话不能互发            | 列表混杂/发送失败             | GUI 按 workspace 目录过滤；创建时显式带 location  |
| RISK-06 | npm 11 默认阻止 install scripts，node-pty 无二进制 | 本地 PTY 不可用              | 终端走上游 ConPTY 桥；保留 `createPty` 扩展点      |
| RISK-07 | `LongPathsEnabled=0`                              | 超长路径可能失败              | Host 层路径规范化；建议开启系统长路径             |
| RISK-08 | 默认端口 4310 可能被占用                          | 前端/脚本连错端口             | BFF 自动回退并写 runtime 文件；Vite 动态路由       |
| RISK-09 | 非 UTF-8 文件（GBK）                              | 直接写回会破坏编码            | 只读展示；替换流程跳过并提示                      |

---

## 7. 变更历史

| 日期       | opencode 版本 | 变更摘要                                                       | codegen diff | 影响里程碑 |
| ---------- | ------------- | -------------------------------------------------------------- | ------------ | ---------- |
| 2026-10-29 | 2.2.1         | 首次探测；v2 `/api/*` 契约、SSE envelope、PTY 票据、事件清单回填 | 基线         | M0–M3.5    |
| 2026-10-30 | 2.2.1         | 修复 Git 提交/推送、搜索结果跳转、替换按文件勾选；修复消息分页 400；新增 CI 断言骨架 | 无 | M1–M3 |
| 2026-10-30 | 2.2.1         | UI：字号调节、会话归档、对话内搜索、上下条跳转、连续 @ 文件引用、Neumorphism 主题 | 无 | M1–M3 / M7 部分 |

---

## 7.5 增补范围说明（M5–M8）

以下用例对应架构增补设计（多语言高亮 / Markdown / SQL 格式化 / 数据库 / Redis / 快捷键 / 主题 / Git 命令提示 / 通知）。
执行前置：先跑 §1 ENV 组 + §1.1 新增闸门（ENV-015 起）；能力探测缺失的功能按 `api-contract.md` §5 隐藏入口，对应用例记 BLOCKED 而非 FAIL。

> 当前状态（2026-10-30）：M5 核心、M6 的 SQLite/Redis 数据源已实现；M6-011/M6-016 的 CI 断言已实测通过。M6 的 PostgreSQL/MySQL 与 M7/M8 仍为 BLOCKED。

---

## 7.6 ENV 闸门追加（并入 §1 表格）

| 编号    | 用例             | 步骤                                                         | 期望                                     | 结果 |
| ------- | ---------------- | ------------------------------------------------------------ | ---------------------------------------- | ---- |
| ENV-015 | SQL 格式化引擎   | `npx sql-formatter --version` 或 venv 内 `sqlparse --version` | 至少一个可用                             |      |
| ENV-016 | 凭据存储可用     | 写入/读取一条测试凭据（凭据管理器或 DPAPI blob）             | 可读回、进程外不可见                     |      |
| ENV-017 | 原生模块编译链   | `Get-Command cl`（better-sqlite3 / node-pty 共用）           | 存在，或对应功能显式关闭                 |      |
| ENV-018 | 可选本地测试实例 | 本地 SQLite 测试库；可选 PostgreSQL / Redis                  | 测试库可连（缺失则 M6 相关用例 BLOCKED） |      |
| ENV-019 | 语言包体积审计   | 构建后统计首屏 chunk 增量                                    | 未超约定阈值（默认 +150KB gzip）         |      |
| ENV-020 | 通知能力探测     | 浏览器模式查 Notification 权限；Tauri 模式查插件可用性       | 结果写入 `api-contract.md` §5            |      |

---

## 7.7 M5 编辑器增强（语言 / Markdown / SQL）

| 编号   | 用例              | 步骤                                                | 期望                                                | 结果 |
| ------ | ----------------- | --------------------------------------------------- | --------------------------------------------------- | ---- |
| M5-001 | 语言注册表分派    | 依次打开 .py/.sql/.yaml/.json/.md/.toml/.ini        | 各自高亮正确，状态栏显示语言名                      |      |
| M5-002 | 按需加载          | 打开首屏后仅打开 .py，检查网络面板                  | 未加载 sql/markdown 等无关语言 chunk                |      |
| M5-003 | 语言切换不重建    | 同一文件手动切换语言（如 .conf → nginx）            | 编辑器实例复用，滚动与撤销栈保持                    |      |
| M5-004 | nginx 降级        | 打开 nginx.conf（社区包不可用场景）                 | 至少关键字/注释/块高亮，不报错、不空白              |      |
| M5-005 | 未知扩展名        | 打开 .xyz 与 >2MB 文件                              | 纯文本渲染 + 大文件只读提示                         |      |
| M5-006 | Markdown 源码高亮 | 打开含标题/表格/代码围栏的 md                       | 标记高亮；围栏代码块按语言二次高亮                  |      |
| M5-007 | Markdown 预览安全 | 打开含 `<img onerror>` / `<script>` 的 md           | 脚本不执行（DOMPurify 生效），控制台无 CSP 违规外泄 |      |
| M5-008 | 双模式与滚动同步  | 源码/预览分屏，滚动源码                             | 预览同步定位；切换单栏不丢内容                      |      |
| M5-009 | 任务列表回写      | 预览态勾选 `- [ ]` 项                               | 源码对应行更新，走 baseHash 乐观锁                  |      |
| M5-010 | 相对资源加载      | md 引用同目录图片                                   | 经 `/api/fs/raw` 正常显示，越界路径被拒             |      |
| M5-011 | SQL 方言高亮      | 打开 .sql 并切换 dialect（sqlite/postgresql/mysql） | 关键字与函数按方言着色，无解析崩溃                  |      |
| M5-012 | SQL 格式化事务    | 对多语句 .sql 执行格式化                            | 先出 diff 预览 → 确认 → 备份 → 应用 → 可撤销        |      |
| M5-013 | 格式化失败保护    | 输入含存储过程/方言扩展的失败样例                   | 不落盘，提示错误位置与建议（换方言重试）            |      |
| M5-014 | 选区格式化        | 仅选中部分语句格式化                                | 选区外内容字节级不变（含 EOL）                      |      |

故障注入：
- FI-M5-A 语言包加载失败：断网或篡改 chunk 路径后打开 .sql → 降级为纯文本并提示，不白屏。
- FI-M5-B md 超大文件：打开 5MB md → 预览懒渲染/提示，UI 不冻结（首帧 <2s）。
- FI-M5-C 格式化竞态：格式化预览期间外部修改该文件 → 应用前校验失败，中止并提示三方合并。
- FI-M5-D 恶意 md：注入超大嵌套引用与畸形表格 → 渲染有上限保护，内存回落。

---

## 7.8 M6 数据源（数据库 / Redis）

| 编号   | 用例             | 步骤                                   | 期望                                           | 结果 |
| ------ | ---------------- | -------------------------------------- | ---------------------------------------------- | ---- |
| M6-001 | 连接档案 CRUD    | 新建/编辑/删除 SQLite 连接             | 密码仅入凭据存储，`connections.json` 无明文    |      |
| M6-002 | 连接测试         | 错误 host/密码测试连接                 | 明确错误原因，超时可控（默认 ≤5s）             |      |
| M6-003 | 元数据浏览       | 展开表/视图/列/索引                    | 与 `sqlite3` CLI 或 `PRAGMA` 结果一致          |      |
| M6-004 | 数据网格         | 打开万行表                             | 虚拟滚动 + 分页，滚动流畅，单元格可复制        |      |
| M6-005 | 只读守卫         | 只读档案执行 `UPDATE/DELETE/DROP`      | 被拒并提示"档案为只读"，数据库无变更           |      |
| M6-006 | 语句白名单       | 提交 `SELECT ...; DROP TABLE x` 多语句 | 被拒（禁止多语句），无副作用                   |      |
| M6-007 | 参数化绑定       | 含引号/分号的参数值查询                | 正确绑定，不产生注入                           |      |
| M6-008 | 超时与行数上限   | 执行笛卡尔积大查询                     | 触发超时/行数上限并提示，可取消                |      |
| M6-009 | 结果导出         | 导出 CSV/JSON                          | 流式写盘，内存不随行数线性增长                 |      |
| M6-010 | 编辑器联动       | 在 .sql 中选中语句 Ctrl+Enter          | 在选定连接执行，结果进入统一结果面板           |      |
| M6-011 | Redis 连接与键树 | 连接本地 Redis，输入 match 模式        | 使用 SCAN 游标增量返回，**网络层无 KEYS 命令** |      |
| M6-012 | 大键空间         | 10 万键环境浏览                        | UI 不卡（帧率不塌），可中断，游标可续          |      |
| M6-013 | 类型分派查看     | 查看 string/hash/list/set/zset 各一    | 按类型渲染，大值截断 + 懒加载                  |      |
| M6-014 | 危险命令守卫     | 尝试 `FLUSHALL` / `CONFIG` / `KEYS`    | 默认禁用，需显式解锁 + 二次确认                |      |
| M6-015 | 订阅推送         | SUBSCRIBE 一个频道并外部 PUBLISH       | 消息经 BFF 推达前端，速率限流生效              |      |
| M6-016 | 凭据不外泄       | 抓取全部前端响应与 BFF 日志 grep 密码  | 零命中（含错误信息脱敏）                       |      |

故障注入：
- FI-M6-A DB 断连：查询中关闭数据库文件/停止服务 → 结果面板报错，应用不崩，可重连。
- FI-M6-B Redis 断连重连：重启 Redis → 前端提示断连并自动重连，订阅恢复。
- FI-M6-C 慢查询洪峰：并发发起 20 个慢查询 → 并发上限生效，无内存暴涨。
- FI-M6-D 凭据存储不可用：模拟凭据读取失败 → 连接功能降级并提示，不回落明文存储。

---

## 7.9 M7 交互系统（快捷键 / 主题 / Git 命令提示）

| 编号   | 用例                 | 步骤                                                      | 期望                                                   | 结果 |
| ------ | -------------------- | --------------------------------------------------------- | ------------------------------------------------------ | ---- |
| M7-001 | 命令注册表一致性     | 遍历菜单/命令面板/按钮触发                                | 全部经 `cmd id` 路由，无散落字符串绑定                 |      |
| M7-002 | 命令面板             | `Ctrl+Shift+P` 模糊搜索                                   | 命中命令 + 最近使用 + 支持跳转会话/文件/连接           |      |
| M7-003 | 用户键位覆盖         | settings 中改 `palette.open` 键位                         | 重启后生效；"重置为默认"可用                           |      |
| M7-004 | 冲突检测             | 绑定两个同 scope 同键位命令                               | UI 高亮告警并显示"被谁占用"                            |      |
| M7-005 | 分层优先级           | 终端聚焦时按被占用键                                      | xterm 优先接收，不触发全局命令                         |      |
| M7-006 | 保留键提示           | 尝试绑定 `Ctrl+W`/`F5`                                    | 提示为浏览器/WebView2 保留键，需确认                   |      |
| M7-007 | 主题三态             | 切换 light/dark/system 并改系统配色                       | 立即生效；system 跟随系统变更                          |      |
| M7-008 | 无首帧闪烁           | 冷启动（暗色主题）                                        | 首帧即暗色，无白闪                                     |      |
| M7-009 | 主题联动             | 切换主题                                                  | UI token、CM6 语法高亮、xterm 配色同步变化             |      |
| M7-010 | 切换不重建           | 主题切换时记录编辑器滚动与撤销栈                          | 均保持不变                                             |      |
| M7-011 | 命令目录与 argv 预览 | 打开 Git 面板任一命令                                     | 表单参数化 + 实时 argv 预览 + 可复制命令               |      |
| M7-012 | 安全分级确认         | 执行 `push --force` / `reset --hard`                      | danger 级需输入确认词 + 自动前置影子快照               |      |
| M7-013 | 结果面板             | 执行 `git status` / `git log`                             | stdout/stderr 分栏、退出码、耗时、可折叠、可在终端重跑 |      |
| M7-014 | 结构化解析           | 脏工作区执行 status                                       | porcelain 解析为结构化列表，与 CLI 输出一致            |      |
| M7-015 | 错误提示规则         | 制造 `non-fast-forward`、`no upstream`、`index.lock` 场景 | 命中规则表，给出人话解释 + 下一步动作按钮              |      |
| M7-016 | 历史与回放           | 连续执行 5 条命令后查历史                                 | 环形缓冲保留最近 N 条，可过滤、可复制、可重跑          |      |
| M7-017 | 输出脱敏             | 命令输出含 token 样式字符串                               | 结果面板与日志中已打码                                 |      |

故障注入：
- FI-M7-A 键位失效：绑定与 CM6 内置键冲突的组合 → 明确优先级结果，不出现"两命令同时触发"。
- FI-M7-B 主题资源缺失：破坏语法主题文件 → 回落默认主题并提示，不白屏。
- FI-M7-C Git 命令超时：注入长耗时命令（如大仓库 `git log --follow`）→ 超时提示 + 可取消，锁释放。
- FI-M7-D 并发写操作：同时触发两个写类 Git 命令 → 同仓库串行化，无索引锁冲突。

---

## 7.10 M8 消息通知

| 编号   | 用例           | 步骤                             | 期望                                                 | 结果 |
| ------ | -------------- | -------------------------------- | ---------------------------------------------------- | ---- |
| M8-001 | 三通道降级     | 分别在浏览器/Tauri 模式触发通知  | 按可用性降级（原生 → 应用内），无未处理异常          |      |
| M8-002 | 聚焦策略       | 窗口聚焦与失焦各触发一次会话完成 | 聚焦仅 toast；失焦发原生通知                         |      |
| M8-003 | 审批必达       | 触发权限审批等待                 | 必产生通知（含会话名与操作摘要），并可在通知中心跳转 |      |
| M8-004 | 去重与聚合     | 3s 内触发同源事件 5 次           | 聚合为一条并计数，不刷屏                             |      |
| M8-005 | 静音范围       | 对某 workspace/session 静音      | 该范围不再通知，其他不受影响                         |      |
| M8-006 | 免打扰时段     | 设置 quietHours 覆盖当前时间     | 静默期内仅入通知中心，不发原生/声音                  |      |
| M8-007 | 深链跳转       | 点击"Git 结果""DB 完成"类通知    | 路由正确定位到对应会话/结果/连接                     |      |
| M8-008 | 隐私控制       | 开启"不显示内容仅显示类型"       | 通知正文不含代码片段与路径                           |      |
| M8-009 | 通知中心       | 查看/标记已读/清空               | 状态持久化，重启后保留                               |      |
| M8-010 | 声音与标题闪烁 | 分别开关                         | 独立生效，互不影响                                   |      |

故障注入：
- FI-M8-A 通知风暴：脚本触发 200 条事件 → 前端不卡死，通知中心有上限与折叠。
- FI-M8-B 上游断连：kill opencode → 发出断连通知；恢复后发出恢复通知，且不重复刷屏。
- FI-M8-C 通知服务不可用：禁用系统通知权限 → 降级为应用内通知，功能不报错。

---

## 7.11 增补范围回归（并入 M4 压测）

| 编号    | 用例         | 步骤                                                   | 期望                                         | 结果 |
| ------- | ------------ | ------------------------------------------------------ | -------------------------------------------- | ---- |
| REG-001 | 常驻内存复测 | 打开 DB 面板 + Redis 键树 + 3 个 md 预览，驻留 30 分钟 | 壳+前端 < 200MB、BFF < 100MB，RSS 无单调增长 |      |
| REG-002 | 首屏不退化   | 冷启动计时                                             | 首屏可交互 < 2s（语言包懒加载生效）          |      |
| REG-003 | 契约同步     | 检查 `api-contract.md`                                 | §2 ENV-015~020 与 §5 新增四行已回填          |      |

### 8 故障注入手册

| 编号      | 注入方式（PowerShell 思路）                  | 观察点              | 恢复步骤             |
| --------- | -------------------------------------------- | ------------------- | -------------------- |
| FI-M5-A   | 构建后临时改名语言 chunk 文件                | 降级为纯文本 + 提示 | 还原文件             |
| FI-M5-C   | 预览期间用脚本改写目标 .sql                  | 应用前校验中止      | 还原文件内容         |
| FI-M6-A/B | 删除/锁定测试库文件；`Stop-Process` 停 Redis | 断连报错与自动重连  | 恢复文件、重启 Redis |
| FI-M6-C   | 并发发起 20 个慢查询                         | 并发上限与内存      | 取消查询             |
| FI-M7-C/D | 注入 sleep 包装的 git 命令；并发触发写命令   | 超时与串行化        | 结束进程、确认锁释放 |
| FI-M8-A   | 脚本循环触发通知事件 200 次                  | 聚合与 UI 流畅度    | 停止脚本、清空中心   |

### 9 指标记录表（行）

| 里程碑      | 日期 | 首屏可交互 | 流式到屏延迟 | 搜索首结果 | RSS 峰值 | 30min 驻留 | 结论 |
| ----------- | ---- | ---------- | ------------ | ---------- | -------- | ---------- | ---- |
| M5          |      |            |              |            |          |            |      |
| M6          |      |            |              |            |          |            |      |
| M7          |      |            |              |            |          |            |      |
| M8          |      |            |              |            |          |            |      |
| REG（回归） |      |            |              |            |          |            |      |

# 架构增补设计（v2 追加范围）：多语言高亮 / Markdown / SQL / 数据库 / Redis / 快捷键 / 主题 / Git 命令提示 / 通知

> 本文是原《完整架构与设计说明书》的**增量补丁**，不推翻已定范围。M0–M4 保持不变，新增能力排入 M5–M8。所有新增功能同样遵守既有硬约束：仅 Windows 本机、前端只连 BFF、平台差异收敛到 `RuntimeHost`、内存预算不劣化。

------

## A. 新增能力总览与归属

| 编号 | 能力                                                         | 归属 | 主要落点                                    |
| ---- | ------------------------------------------------------------ | ---- | ------------------------------------------- |
| F1   | 多语言语法高亮（md/sql/yaml/conf/nginx/py/js/go/rust/json/xml/toml…） | M5.1 | `apps/gui/features/editor/langs`            |
| F2   | Markdown 源码高亮 + 渲染预览（含代码块高亮、目录、任务列表） | M5.2 | `features/editor/markdown`                  |
| F3   | SQL 方言高亮 + 格式化（预览-确认-应用）                      | M5.3 | `features/editor/sql` + BFF `routes/format` |
| F4   | 本地数据库连接（SQLite 优先，PG/MySQL 次之）                 | M6.1 | `packages/db` + BFF `routes/db`             |
| F5   | Redis 连接（键浏览/类型查看/订阅/命令台）                    | M6.2 | `packages/redis` + BFF `routes/redis`       |
| F6   | 快捷键配置（命令注册表 + 用户覆盖 + 冲突检测）               | M7.1 | `apps/gui/keymap`                           |
| F7   | UI 风格配置（明/暗/跟随系统 + 语法主题 + 密度）              | M7.2 | `apps/gui/theme`                            |
| F8   | Git 命令提示（命令目录、argv 预览、运行结果、错误提示、历史） | M7.3 | BFF `routes/git` + `features/git`           |
| F9   | 消息通知（应用内 + Windows 原生 + 声音/标题闪烁）            | M8.1 | BFF `lib/notify` + 前端 `features/notify`   |

------

## B. F1–F3 编辑器语言与格式

### B.1 语言矩阵与加载策略

编辑器仍为 CodeMirror 6 单例。语言支持按"扩展名 → 语言描述符"注册表驱动，**按需动态 import**，避免把全部语言包打进首屏 chunk（首屏 <2s、内存预算的硬约束）。

| 文件类型                                         | 方案                                                         | 备注                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `.py .js .ts .go .rs .java .c .cpp .php .rb .sh` | 官方 `@codemirror/lang-*` 对应包                             | 官方语言包以 `lang-xxx` 命名，按需安装引入                   |
| `.json .xml .html .css .scss .yaml .toml .ini`   | 官方 `lang-json/xml/html/css/sass/yaml`；toml/ini 用 `lang-ini` 或社区包 | `lang-yaml`、`lang-xml` 均在官方包清单内                     |
| `.sql`                                           | `@codemirror/lang-sql`，按方言配置 `sql({ dialect })`        | 方言来自 workspace 配置（默认 `sqlite`/`postgresql`）        |
| `.md .markdown`                                  | `@codemirror/lang-markdown`，配 `codeLanguages` 让围栏代码块二次高亮 | markdown 支持 `codeLanguages: languages` 的嵌入式高亮用法    |
| `.conf .cfg .properties`                         | `lang-ini` 近似 + 自定义 `simple-mode` 补充（键值、注释、变量） | 无统一语法，接受"近似高亮"                                   |
| `nginx.conf`                                     | **无官方 `lang-nginx`**（官方 lang 包清单中未见 nginx），需社区包或自建 `StreamLanguage`/`simple-mode`（指令名 + 块 + 注释 + 变量） | 实现前必须实测社区包可用性；不可用则自建，降级为"关键字高亮" |
| 未知扩展名                                       | 纯文本 + 大文件只读                                          | 状态栏显示"未识别语言"，允许手动切换                         |

设计要点：

- 注册表结构（声明式，非实现）：`{ ext, name, loader: () => import(...), themeTokens, formatCmd? }`。
- 语言切换用 Compartment 动态注入，切标签页不重建编辑器实例。
- 语法主题与 UI 主题联动（见 D.2），同一 token 集合同时喂给 CM6 `HighlightStyle` 与 Markdown 预览的 `highlight.js`。
- 新增 ENV 闸门项：**语言包体积审计**（首屏 chunk 增量阈值，超阈值 FAIL）。

### B.2 Markdown 双模式（F2）

- **源码模式**：CM6 markdown 模式（含嵌入代码高亮、标题/列表/链接/表格标记高亮、折叠）。
- **预览模式**：`markdown-it`（GFM 插件）→ **DOMPurify 消毒** → 渲染。必须消毒：仓库内 md 属不可信输入，XSS 面在 WebView2 与浏览器同样存在。
- 增强项（可开关）：KaTeX 数学、mermaid 图（懒加载，默认关，避免体积与内存）、锚点与 TOC、任务列表勾选回写源码、相对图片经 `/api/fs/raw?ws=&path=` 加载。
- 布局：源码/预览分屏（默认）与单栏切换；预览滚动与源码滚动双向同步（按行映射，节流）。
- 写回：预览态勾选任务项 → 定位源码行 → 走既有乐观锁保存链路（`baseHash`），不绕过冲突检测。

### B.3 SQL 格式化（F3）

- 引擎首选 Node 侧 `sql-formatter`：支持 standard SQL、MariaDB、MySQL、PostgreSQL、DB2、PL/SQL、N1QL、Redshift、Spark、T-SQL 等方言，可配 `indent`、`uppercase`、`linesBetweenQueries`，并提供 `npx sql-formatter` CLI 。
- 备选：Python venv 内 `sqlparse`（目标项目已是 Python 栈，可作方言兜底）；DBeaver 生态也把 `sql-formatter` 与 `sqlparse` 并列为外部格式化选型 。
- 流程**必须复用批量替换的事务管线**：格式化 → 生成 diff 预览 → 用户确认 → 备份 → 应用 → 入撤销栈。理由：格式化是有语义风险的排版改写（注释、存储过程、方言扩展语法可能解析失败），官方也明确不支持存储过程等场景 。
- 失败策略：解析错误时**不落盘**，展示错误位置与建议（换方言重试）；提供"仅格式化选区"。
- 配置：`workspace.sql = { dialect, indent, keywordCase, engine }`。

------

## C. F4–F5 数据源（数据库 / Redis）

### C.1 连接配置与凭据安全（红线）

- 连接档案存 `%APPDATA%\opencode-gui\connections.json`，**密码不进该文件**：走 Windows 凭据管理器（Tauri 侧用安全存储/Stronghold；浏览器模式用 DPAPI 加密 blob + ACL 限当前用户）。
- 前端**永不接收密码**，只拿 `profileId`；BFF 内部解密后建连。
- 连接档案字段（声明式）：`{ id, kind: sqlite|postgres|mysql|redis, label, host, port, database, user, authRef, readOnly, timeoutMs, rowLimit }`。
- 默认 `readOnly: true`，写操作需按档案显式开启并在 UI 常驻标识（红色徽标）。

### C.2 数据库（F4）

驱动选型决策（实现前 spike 定案，记入 ADR）：

| 方案                                     | 优点                                                         | 风险                                                         |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `node:sqlite`                            | Node 22.5+ 内置、无需装包；v22.13 起不再需要 `--experimental-sqlite` 标志，但仍处实验阶段（Stability 1.1） | API 可能变动；Node 20 不可用（需与"Node ≥20"约束对齐，建议本功能要求 Node 22） |
| `better-sqlite3`                         | 成熟、同步 API、事务与预处理完整                             | 原生模块，需 VS Build Tools（与 node-pty 同一闸门）          |
| Python 桥（venv 内 `sqlite3`/`psycopg`） | 复用项目解释器与依赖                                         | 多一层进程协议，错误处理复杂                                 |

结论建议：**SQLite 用 `better-sqlite3`（M6.1 首发）**，PG/MySQL 用 `pg`/`mysql2`（纯 JS，无原生依赖），Python 桥作为"驱动缺失时的兜底"不进首发。

功能与安全约束：

- 连接测试、元数据浏览（表/视图/列/索引/DDL）、数据网格（虚拟滚动 + 分页 + 单元格复制）。
- 语句执行走**白名单守卫**：默认仅允许 `SELECT / WITH / EXPLAIN / PRAGMA(只读)`；禁止多语句拼接；参数化绑定；超时 + 行数上限 + 取消。
- 结果导出 CSV/JSON（流式写文件，不在内存聚合）。
- 与编辑器打通：`.sql` 文件"在当前连接执行选区"，结果面板与 Git 结果面板共用（见 E）。
- 影子仓库不参与 DB 文件写入；对 `.db` 文件的写操作前提示"未经版本控制的二进制变更"。

### C.3 Redis（F6 之 F5）

- 客户端 `ioredis`（支持 SCAN/订阅/集群/TLS）。
- 键浏览**一律用 SCAN 游标增量迭代**（`SCAN cursor MATCH pattern COUNT n`），**禁止 KEYS**：KEYS 为 O(N) 阻塞命令，会卡住单线程主线程导致超时甚至雪崩，生产环境严禁使用；SCAN 非阻塞、可分批，但结果可能重复需客户端去重 。
- 大集合用 `HSCAN/SSCAN/ZSCAN` 对应类型遍历 ；值查看按类型分派（string/hash/list/set/zset/stream），大值懒加载 + 截断显示 + 二进制安全渲染。
- 命令台：只读命令白名单；危险命令（`FLUSHALL/FLUSHDB/SHUTDOWN/CONFIG/DEBUG/KEYS/SCRIPT`…）默认禁用，需显式解锁并二次确认。
- 订阅面板：`SUBSCRIBE/PSUBSCRIBE` 经 BFF 转 WS/SSE 推前端，含消息速率限流与缓冲上限。
- 集群模式：按 master 节点分别 SCAN 再聚合 。

------

## D. F6–F7 快捷键与 UI 风格

### D.1 快捷键（F6）

- **单一事实来源**：命令注册表 `Command = { id, title, scope: 'global'|'editor'|'terminal'|'db', handler, defaultKeys, when }`。所有 UI 入口（菜单、命令面板、按钮）都引用 `id`，禁止散落字符串。
- 绑定模型：`{ keys: 'Ctrl+Shift+P', cmd, when, priority }`；支持组合键与序列（chord）。
- 分层优先级：`terminal（xterm 优先，避免吞键）> editor（CM6 keymap）> global（应用命令）`。CM6 自带 `defaultKeymap/historyKeymap/searchKeymap` 保留，应用级绑定在其之前拦截。
- 用户覆盖：`settings.json` 的 `keybindings: [{ cmd, keys, when? }]`；提供"重置为默认"、**冲突检测**（同 scope 同键位高亮告警）、"被谁占用"反查。
- Windows 保留键规避：`Ctrl+W/Ctrl+T/Ctrl+N/F11/F5` 等浏览器与 WebView2 语义键默认不占用，占用需显式提示风险。
- 命令面板（默认 `Ctrl+Shift+P`）：模糊搜索命令 + 最近使用 + 快捷跳转（会话/文件/连接）。
- 默认键位基线（实现时按此表落地并可覆盖）：

| 命令                  | 默认键              |
| --------------------- | ------------------- |
| 命令面板              | `Ctrl+Shift+P`      |
| 全局搜索 / 项目搜索   | `Ctrl+Shift+F`      |
| 保存                  | `Ctrl+S`            |
| 切换主题              | `Ctrl+K Ctrl+T`     |
| 打开文件              | `Ctrl+O`            |
| 新建终端              | `Ctrl+` `（反引号） |
| 分屏源码/预览（md）   | `Ctrl+K V`          |
| 格式化（sql/json/py） | `Shift+Alt+F`       |
| 执行 SQL 选区         | `Ctrl+Enter`        |
| 权限审批 允许/拒绝    | `Alt+Y` / `Alt+N`   |

### D.2 主题（F7）

- **token 化**：一套语义 token（`bg/surface/text/muted/accent/border/diff.add/diff.del/warn/err` + 语法 token `keyword/string/number/comment/type/func`），产出三份消费物：CSS 变量（UI）、CM6 `EditorView.theme` + `HighlightStyle`、xterm.js theme 对象。禁止组件内写死颜色。
- 模式：`light | dark | system`。`system` 用 `matchMedia('(prefers-color-scheme)')` + 监听变更；Tauri 侧同步窗口主题。
- 防闪烁：`index.html` 内联脚本在首帧前读 `settings` 缓存并设 `document.documentElement.dataset.theme`。
- 语法主题独立可选（如 one-light / one-dark / 自定义），与 UI 主题解耦但提供"跟随 UI"默认。
- 附加偏好：字体族与字号、行高、缩略图、界面密度（compact/comfortable）、动效开关（`prefers-reduced-motion`）。
- 所有主题切换必须可在运行时完成且不重建编辑器（Compartment 替换 theme 扩展）。

------

## E. F8 Git 命令提示（用法 + 运行结果）

目标：把"Git 操作"从黑盒按钮变成**可看见命令、可看见输出、可学习**的界面。

三个组成部分：

1. 命令目录 `GitCommandCatalog`（声明式）

   ```
   { id, title, argv: ['git','status','--porcelain=v2','--branch'], argsSchema, safety: 'read'|'write'|'danger', when, docs }
   ```

   - UI 由目录自动生成表单（分支/文件/范围等参数），并**实时渲染最终 argv 预览**与"复制命令"。
   - `safety` 决定确认强度：`write` 需确认，`danger`（`reset --hard`、`clean -fd`、`push --force`、`rebase`）需输入确认词 + 自动前置影子仓库快照。

2. 执行器 `GitRunner`

   - 统一 `execFile(shell:false)`、超时、取消、并发锁（同仓库串行化写操作）、输出脱敏（凭据/token 正则打码）。
   - 结果规范化：`{ argv, exitCode, stdout, stderr, durationMs, parsed? }`；`status/log/diff` 走 porcelain/流式解析成结构化数据。

3. 结果与提示

   - 结果面板：stdout/stderr 分栏、退出码与耗时、可折叠、可"在终端重跑"、可"复制命令"。
   - **历史环形缓冲**（每 workspace 最近 N 条，持久化尾部到 `%LOCALAPPDATA%`），支持过滤与回放。
   - **错误提示规则表**（stderr 模式 → 人话 + 建议动作）：如 `not a git repository`、`no upstream branch`、`rejected (non-fast-forward)`、`lock file .git/index.lock exists`、`Please commit your changes or stash them`、`fatal: unable to access ... (proxy)` 等，每条给"下一步"按钮（设置 upstream / 先 pull --rebase / 清理 lock 需确认）。
   - 命令使用提示：输入框内联补全（子命令 + 常用参数），以及"这条命令会做什么"的一句话说明 + 文档链接。
   - 与 hooks 联动：检测到 husky/lint-staged 时，把 hook 输出并入结果面板并标注来源。

------

## F. F9 消息通知

**三通道**（按可用性降级）：

1. 应用内 toast + 通知中心（收件箱，可静音/已读/跳转）。
2. Windows 原生通知：Tauri 侧用官方 notification 插件（需 Rust ≥1.77.2；**Windows 上仅对"已安装应用"生效，开发模式下会显示 powershell 名称与图标**） ；浏览器模式用 Web Notification API（需用户手势与授权）。点击回调在 Windows 侧能力有限，M8 spike 验证"点击聚焦并跳转"，不支持则降级为"点击仅唤起窗口"。
3. 声音 + 标题闪烁（任务栏），可在设置中单独关闭。

**事件源**：会话完成/空闲、会话错误、**权限审批等待（必须通知，否则审批悬挂卡死整轮）**、批量替换完成、Git 长命令完成、DB/Redis 查询完成、上游断连与恢复、新版本可用。

**规则引擎（声明式）**：`{ source, level: info|warn|error, when: 'always'|'window-blurred'|'longer-than:30s', muteScopes: [workspace|session|source], quietHours, dedupKey, aggregateWindow }`

- 默认策略：窗口聚焦时只出应用内 toast；失焦或最小化时发原生通知；同源事件在 3s 窗口内聚合计数。
- 点击行为：深链路由（`#/session/:id`、`#/git/result/:runId`、`#/db/:profileId`）。
- 隐私：通知正文默认截断，可配置"不显示内容仅显示类型"（避免敏感代码/凭据进入系统通知历史）。

------

## G. 配置 schema 增量（`settings.json` / `workspaces.json`）

```jsonc
// settings.json 追加
{
  "theme": { "mode": "system", "syntax": "auto", "density": "comfortable", "font": "JetBrains Mono", "fontSize": 14 },
  "keybindings": [{ "cmd": "palette.open", "keys": "Ctrl+Shift+P" }],
  "notifications": { "native": true, "sound": false, "quietHours": ["23:00","08:00"], "mute": [] },
  "editor": { "languages": { "nginx": "auto|community|builtin" }, "markdown": { "mermaid": false, "katex": true } }
}
// workspaces.json 每项追加
{
  "sql": { "dialect": "sqlite", "engine": "sql-formatter" },
  "dbProfiles": ["sqlite:main"], "redisProfiles": ["redis:local"],
  "git": { "hooksAware": true }
}
```

------

## H. 目录结构增量

```
apps/gui/features/editor/{langs,markdown,sql}/
apps/gui/features/db/        # 连接管理、元数据树、数据网格、结果面板
apps/gui/features/redis/     # 连接、键树、值查看器、订阅、命令台
apps/gui/features/git/{catalog,runner,result,hints}/
apps/gui/features/notify/
apps/gui/keymap/  apps/gui/theme/
apps/server/src/routes/{db,redis,format,notify}.ts
apps/server/src/lib/{dbGuard,redisGuard,gitCatalog,gitRunner,hintRules,credentialStore}.ts
packages/db/  packages/redis/   # 驱动封装 + 守卫 + 类型
```

------

## I. 非功能性影响与闸门新增

| 项           | 影响                                                         | 约束                                                |
| ------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| 首屏体积     | 语言包/mermaid/katex 增多                                    | 全部懒加载；CI 记录首屏 chunk 增量，超阈值 FAIL     |
| 内存         | 数据网格 + Redis 键树 + 通知缓存                             | 虚拟滚动 + 行数/键数上限；纳入 M4 压测基线复测      |
| 原生依赖     | `better-sqlite3`（可选）与 node-pty 同类                     | ENV 闸门新增：VS Build Tools 检查（M3.5/M6 前必需） |
| 安全面       | DB/Redis 凭据、SQL/命令注入、md XSS                          | 凭据入凭据管理器；只读白名单；DOMPurify + CSP       |
| ENV 闸门新增 | `sql-formatter` 可达、可选本地 PG/Redis 测试实例、凭据存储可用 | 记入 `api-contract.md` §2（ENV-015 起）             |

------

## J. 新增里程碑与任务拆分

- **M5 编辑器增强（2 周）**：T5.1 语言注册表 + 懒加载 + 体积审计；T5.2 Markdown 双模式 + 消毒 + 滚动同步；T5.3 SQL 方言 + 格式化事务管线。
- **M6 数据源（2.5 周）**：T6.1 凭据存储 + 连接档案 + SQLite 浏览/查询（含只读守卫）；T6.2 PG/MySQL 驱动 + 导出；T6.3 Redis 连接 + SCAN 键树 + 类型查看 + 订阅 + 命令台守卫。
- **M7 交互系统（2 周）**：T7.1 命令注册表 + 命令面板 + 用户键位覆盖与冲突检测；T7.2 主题 token 化 + 明暗/跟随系统 + CM6/xterm 联动；T7.3 Git 命令目录 + 执行器 + 结果面板 + 错误提示规则 + 历史。
- **M8 通知与打磨（1.5 周）**：T8.1 通知规则引擎 + 三通道降级 + 深链跳转 + Windows 点击回调 spike；T8.2 回归内存压测（含 DB/Redis 面板常驻）+ 文档更新。

------

## K. 新增风险登记

| 风险                         | 影响                   | 缓解                                                         |
| ---------------------------- | ---------------------- | ------------------------------------------------------------ |
| nginx/conf 无成熟 CM6 语法包 | 高亮缺失或误高亮       | 先 spike 社区包；不可用则自建 simple-mode，接受"关键字级"高亮 |
| SQL 格式化改变语义/丢注释    | 用户代码受损           | 预览-确认-备份-撤销；解析失败不落盘；方言可切换重试          |
| DB 写误操作                  | 数据损失               | 默认只读 + 白名单 + 超时行数上限 + 写操作显式解锁            |
| Redis 误用阻塞命令           | 影响线上 Redis         | 命令白名单，KEYS/FLUSH 等硬禁用，SCAN 强制游标 + 去重        |
| 凭据泄漏                     | 严重                   | 不进配置文件/前端/日志；脱敏与 ACL；导出前扫描               |
| Markdown 渲染 XSS            | 会话/仓库内容攻击      | DOMPurify + CSP + 禁用 raw HTML（可配置放开）                |
| 键位与浏览器/WebView2 冲突   | 快捷键失效             | 保留键黑名单 + 冲突检测 + 可覆盖                             |
| Windows 原生通知限制         | 通知不可用或无点击回调 | 开发模式差异已知；spike 后降级为应用内通知                   |
| 原生模块编译失败             | DB/终端功能缺失        | 与 node-pty 共用闸门；功能可开关降级                         |

------

## L. 配套件需要同步的更新（供实现 agent 执行）

1. `docs/api-contract.md`：§2 追加 ENV-015~（sql-formatter、凭据存储、可选 PG/Redis 实例、语言包体积审计）；§5 能力矩阵追加"SQL 格式化 / DB / Redis / 原生通知"四行（探测失败即隐藏入口）。

2. ```
   docs/acceptance.md
   ```

   ：新增 M5/M6/M7/M8 用例组，建议至少包含——

   - M5：nginx 文件降级高亮不报错；md 勾选回写走乐观锁冲突提示；SQL 格式化失败不落盘且可撤销。
   - M6：只读档案执行 `UPDATE` 被拒；Redis 键浏览在 10 万键下不卡 UI 且不发 `KEYS`；凭据不出现在任何前端响应与日志中（grep 断言）。
   - M7：键位冲突检测能报出重复绑定；主题切换不重建编辑器且滚动位置保持；`git push --force` 触发 danger 确认 + 自动快照；错误提示规则表命中 `non-fast-forward` 并给出建议。
   - M8：权限审批等待时必达通知；失焦才发原生通知；静音范围生效；点击深链跳转正确。
   - 故障注入：DB 连接中断（结果面板报错不崩）、Redis 断连重连、格式化超大 SQL 超时、通知风暴去重。



按上一轮的提议，把 M6-011（Redis 无 `KEYS`）与 M6-016（凭据不外泄）做成可执行的 CI 断言骨架。放在 `scripts/ci-assert.sh`，退出码约定固定，方便直接接进流水线并回填验收表。

## 退出码与调用约定

| 码   | 含义                                              | 流水线动作                   |
| ---- | ------------------------------------------------- | ---------------------------- |
| 0    | 全部断言通过                                      | 用例 PASS                    |
| 1    | 断言失败（被测行为不合规）                        | 用例 FAIL，上传 `--out` 目录 |
| 2    | 环境/前置错误（依赖缺失、服务不可达、场景未跑到） | 记 BLOCKED，不算 FAIL        |
| 3    | 用法错误（参数/夹具缺失）                         | 直接失败并打印用法           |

约定：脚本**自身绝不打印密钥明文**，命中只输出 `文件:行号 + 掩码片段`；所有产物落 `--out`，默认 `artifacts/ci-assert/<时间戳>/`。

## `scripts/ci-assert.sh`

```bash
#!/usr/bin/env bash
# scripts/ci-assert.sh
# 用途：M6-011（Redis 键浏览不得发 KEYS）与 M6-016（凭据不外泄）的自动化断言。
# 运行：Git Bash / WSL；Windows 原生可用等价的 ci-assert.ps1（退出码保持一致）。
set -euo pipefail

readonly EXIT_OK=0 EXIT_ASSERT=1 EXIT_ENV=2 EXIT_USAGE=3

# ---------- 配置（全部可用环境变量覆盖，禁止写死密钥） ----------
BFF_BASE="${BFF_BASE:-http://127.0.0.1:4310}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
REDIS_PROFILE="${REDIS_PROFILE:-redis:local}"
DB_PROFILE="${DB_PROFILE:-sqlite:main}"
LOG_DIR="${LOG_DIR:-$HOME/.local/share/opencode-gui/logs}"
CONN_FILE="${CONN_FILE:-$HOME/AppData/Roaming/opencode-gui/connections.json}"
SECRETS_FILE="${SECRETS_FILE:-scripts/fixtures/secrets.local.json}"
OUT_DIR="${OUT_DIR:-artifacts/ci-assert/$(date +%Y%m%d-%H%M%S)}"
MONITOR_SECONDS="${MONITOR_SECONDS:-20}"
ONLY="${ONLY:-m6-011,m6-016}"

# ---------- 工具函数 ----------
log()  { printf '[ci-assert] %s\n' "$*" >&2; }
die_env()   { log "ENV ERROR: $*"; exit "$EXIT_ENV"; }
die_usage() { log "USAGE ERROR: $*"; exit "$EXIT_USAGE"; }
fail() { log "ASSERT FAIL: $*"; FAILED=$((FAILED + 1)); }
pass() { log "PASS: $*"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || die_env "缺少命令：$1"; }

wait_http() { # wait_http <url> [timeout_s]
  local url="$1" timeout="${2:-15}" i=0
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    i=$((i + 1)); [ "$i" -ge "$timeout" ] && return 1; sleep 1
  done
}

# 正则转义（用于把密钥值变成 grep 模式）
regex_escape() { sed -e 's/[][\\.^$*+?(){}|]/\\&/g' <<<"$1"; }

# 掩码：只保留首尾各 2 字符
mask() { local s="$1"; [ "${#s}" -le 6 ] && printf '******' || printf '%s****%s' "${s:0:2}" "${s: -2}"; }

# ---------- 参数解析 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --out=*) OUT_DIR="${1#*=}" ;;
    --only=*) ONLY="${1#*=}" ;;
    --self-test) SELF_TEST=1 ;;
    -h|--help)
      cat <<'USAGE'
用法：ci-assert.sh [--out=DIR] [--only=m6-011,m6-016] [--self-test]
环境变量：BFF_BASE REDIS_URL LOG_DIR CONN_FILE SECRETS_FILE MONITOR_SECONDS
退出码：0 通过 / 1 断言失败 / 2 环境错误 / 3 用法错误
USAGE
      exit "$EXIT_OK" ;;
    *) die_usage "未知参数：$1" ;;
  esac
  shift
done

mkdir -p "$OUT_DIR/responses" "$OUT_DIR/logs"
FAILED=0
declare -A RAN

# ---------- 前置检查 ----------
preflight() {
  require_cmd curl; require_cmd jq; require_cmd grep; require_cmd timeout
  command -v rg >/dev/null 2>&1 && GREP_TOOL=rg || GREP_TOOL=grep
  wait_http "$BFF_BASE/api/health" 15 || die_env "BFF 不可达：$BFF_BASE/api/health"
  # Redis 可达性（优先 redis-cli，退化到 nc）
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1 || die_env "Redis 不可达：$REDIS_URL"
  else
    local hostport="${REDIS_URL#redis://}"; hostport="${hostport%%/*}"
    local host="${hostport%%:*}" port="${hostport##*:}"
    timeout 3 bash -c "cat < /dev/null > /dev/tcp/$host/${port:-6379}" 2>/dev/null \
      || die_env "Redis 不可达：$REDIS_URL"
  fi
  [ -f "$SECRETS_FILE" ] || die_env "缺少夹具：$SECRETS_FILE（复制 secrets.example.json 后填入测试值）"
  log "OUT=$OUT_DIR"
}

# ---------- 场景驱动（TODO：按你的实际路由/驱动方式替换） ----------
# 说明：优先用 HTTP 直调 BFF，稳定且无需 UI；如需覆盖 UI 路径，把这里换成 playwright 脚本。
drive_redis_scan() { # 触发一次键浏览，产生 SCAN 流量
  # TODO: 替换为真实端点与参数；期望返回键列表
  curl -fsS -X POST "$BFF_BASE/api/redis/scan" \
       -H 'content-type: application/json' \
       -d "{\"profileId\":\"$REDIS_PROFILE\",\"pattern\":\"*\",\"count\":100}" \
       -o "$OUT_DIR/responses/redis-scan.json" || die_env "redis scan 调用失败（场景未跑到）"
}

drive_secret_scenarios() { # 触发所有可能回显凭据的链路
  # TODO: 按实际路由补全；至少要覆盖 DB 查询失败、Redis 认证失败、Git 命令输出、通知内容
  curl -fsS -X POST "$BFF_BASE/api/db/query" -H 'content-type: application/json' \
       -d "{\"profileId\":\"$DB_PROFILE\",\"sql\":\"SELECT 1\"}" \
       -o "$OUT_DIR/responses/db-query.json" || log "db query 调用失败（继续收集日志）"
  curl -fsS "$BFF_BASE/api/connections" -o "$OUT_DIR/responses/connections.json" || true
  curl -fsS "$BFF_BASE/api/health" -o "$OUT_DIR/responses/health.json" || true
}

# ---------- M6-011：Redis 键浏览不得发 KEYS ----------
test_m6_011() {
  RAN[m6-011]=1
  local mon="$OUT_DIR/redis-monitor.log"
  if ! command -v redis-cli >/dev/null 2>&1; then
    die_env "缺少 redis-cli，无法执行 MONITOR 断言"
  fi
  # MONITOR 是调试命令，仅对本地测试实例使用
  timeout "$MONITOR_SECONDS" redis-cli -u "$REDIS_URL" --no-raw MONITOR >"$mon" 2>&1 &
  local mon_pid=$!
  sleep 1
  drive_redis_scan
  sleep 2
  kill "$mon_pid" 2>/dev/null || true
  wait "$mon_pid" 2>/dev/null || true

  [ -s "$mon" ] || die_env "MONITOR 未捕获任何命令，场景未跑到（BLOCKED）"

  # 归一化：去掉时间戳与引号，取命令名
  local norm="$OUT_DIR/redis-commands.txt"
  sed -E 's/^[0-9.]+ $$[^]]+$$ //; s/"//g' "$mon" | awk '{print toupper($1)}' | sort -u >"$norm"

  local bad
  bad="$(grep -nE '^(KEYS|FLUSHALL|FLUSHDB|SHUTDOWN|DEBUG|CONFIG)$' "$norm" || true)"
  if [ -n "$bad" ]; then
    fail "M6-011 捕获到禁用命令：$(echo "$bad" | tr '\n' ' ')"
  else
    pass "M6-011 未出现 KEYS/FLUSH 类命令"
  fi
  grep -q '^SCAN$' "$norm" \
    && pass "M6-011 确认走 SCAN 游标" \
    || fail "M6-011 未捕获 SCAN，可能未走预期路径（请检查 drive_redis_scan）"
}

# ---------- M6-016：凭据不外泄 ----------
test_m6_016() {
  RAN[m6-016]=1
  drive_secret_scenarios

  # 汇总待扫描文本：BFF 日志 + 前端响应快照 + 连接档案
  local scan_root="$OUT_DIR/scan"
  mkdir -p "$scan_root"
  [ -d "$LOG_DIR" ] && cp -R "$LOG_DIR/." "$scan_root/logs/" 2>/dev/null || log "日志目录不存在：$LOG_DIR"
  cp -R "$OUT_DIR/responses/." "$scan_root/responses/"
  [ -f "$CONN_FILE" ] && cp "$CONN_FILE" "$scan_root/connections.json" || log "连接档案不存在：$CONN_FILE"

  # 由夹具构造密钥模式（不打印值）
  local pattern_file="$OUT_DIR/secret-patterns.txt"
  jq -r 'to_entries[].value' "$SECRETS_FILE" 2>/dev/null \
    | grep -vE '^(null|""?)$' \
    | while IFS= read -r v; do regex_escape "$v"; done >"$pattern_file"
  [ -s "$pattern_file" ] || die_env "夹具未解析出任何密钥值"

  local hits=""
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    local found
    found="$("$GREP_TOOL" -rInE "$pat" "$scan_root" 2>/dev/null || true)"
    [ -n "$found" ] && hits+="$found"$'\n'
  done <"$pattern_file"

  if [ -n "$hits" ]; then
    # 只输出位置与掩码，不回显密钥
    local shown
    shown="$(echo "$hits" | head -n 20 | cut -d: -f1,2)"
    fail "M6-016 命中凭据明文（前 20 处，已掩码）：$(echo "$shown" | tr '\n' ' ')"
    echo "$hits" | sed -E 's/^(.*:[0-9]+:).*/\1 <REDACTED>/' >"$OUT_DIR/m6-016-hits.txt"
  else
    pass "M6-016 日志/响应/连接档案中未出现凭据明文"
  fi

  # 结构性检查：connections.json 不得有明文密码字段
  if [ -f "$scan_root/connections.json" ]; then
    if jq -e '.. | objects | has("password")' "$scan_root/connections.json" >/dev/null 2>&1; then
      fail "M6-016 connections.json 含 password 字段（应只存 authRef）"
    else
      pass "M6-016 connections.json 无明文 password 字段"
    fi
  fi
}

# ---------- 自检：验证脚本能抓到植入的密钥（负向测试） ----------
self_test() {
  local probe="$OUT_DIR/selftest-probe.log"
  local secret
  secret="$(jq -r 'to_entries[0].value' "$SECRETS_FILE")"
  printf 'fake log line with secret=%s\n' "$secret" >"$probe"
  local pat; pat="$(regex_escape "$secret")"
  if grep -qE "$pat" "$probe"; then
    pass "self-test 检出植入密钥，扫描逻辑有效"
  else
    fail "self-test 未检出植入密钥，扫描逻辑失效"
  fi
  rm -f "$probe"
}

# ---------- 主流程 ----------
main() {
  preflight
  case ",$ONLY," in
    *,m6-011,*) test_m6_011 ;;
  esac
  case ",$ONLY," in
    *,m6-016,*) test_m6_016 ;;
  esac
  [ "${SELF_TEST:-0}" = "1" ] && self_test

  log "--------------------------------------------"
  log "已执行：${!RAN[*]:-（无）}  失败数：$FAILED"
  log "产物：$OUT_DIR"
  [ "$FAILED" -eq 0 ] && exit "$EXIT_OK" || exit "$EXIT_ASSERT"
}
main "$@"
```

## 配套夹具 `scripts/fixtures/secrets.example.json`

```jsonc
{
  "dbPassword": "CHANGE_ME_db_pw",
  "redisPassword": "CHANGE_ME_redis_pw",
  "apiToken": "CHANGE_ME_api_token"
}
```

真实值放 `secrets.local.json`（加入 `.gitignore`），CI 里由流水线密钥注入生成。这三个值必须与 `connections.json` 中实际配置的凭据一致，否则 M6-016 会假通过。

## 流水线接入（GitHub Actions 片段）

```yaml
      - name: CI assertions (M6-011 / M6-016)
        run: bash scripts/ci-assert.sh --out=artifacts/ci-assert --self-test
        env:
          BFF_BASE: http://127.0.0.1:4310
          REDIS_URL: redis://127.0.0.1:6379
          SECRETS_FILE: scripts/fixtures/secrets.local.json
        continue-on-error: false
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: ci-assert, path: artifacts/ci-assert }
```

退出码映射建议：`1` → 验收表记 FAIL；`2` → 记 BLOCKED 并在 issue 里注明缺失依赖；`3` → 流水线配置问题，直接红。

## 三个落地注意点

**MONITOR 只准对本地测试实例用。** 它会拉取全量命令流、有性能开销，且本身属调试类命令；脚本里已用 `timeout` 限制窗口，但请确保 `REDIS_URL` 指向本机测试库，别误连共享环境。

**`drive_redis_scan` / `drive_secret_scenarios` 是唯一的 TODO 位。** 断言逻辑已完整，只要把这两个函数换成你真实的 BFF 调用（或 Playwright 驱动），脚本即可跑通。若走 UI 驱动，建议仍保留 HTTP 兜底，避免 UI 变动导致断言频繁 BLOCKED。

**Windows 原生需要等价 PS 脚本。** 项目是 Windows 本机，若 CI 跑在 Windows runner，`bash` 依赖 Git Bash；建议后续补 `scripts/ci-assert.ps1`，复用同一套退出码与产物目录结构，两边共用 `secrets.local.json` 与断言口径，避免"bash 过、ps 不过"的漂移。需要我把 PowerShell 版也写出来，或者顺手补一份 `docs/ci-assertions.md` 说明这两个断言的判定边界（尤其"未捕获 SCAN 记 BLOCKED 而非 PASS"这条），说一声就行。



---

## 7.12 2026-10-30 修复记录

| 问题 | 根因 | 修复与验证 |
| ---- | ---- | ---------- |
| Git 点击“提交”后远程仓库看不到 | 提交只包含已暂存内容，且 UI 没有 push；面板不显示 ahead/behind | 提交默认“暂存全部变更”；新增 `POST /api/git/push`（禁止 force，首次自动 -u）；面板显示“未推送 N”与推送按钮。临时 bare remote 实测 commit → push；本机 `c086d4e` 已推送 origin/main |
| 搜索结果无法跳转 | EditorPanel 首次挂载时 `closeAll()` 把刚打开的 tab 关闭 | 用 `prevWorkspace` ref 只在工作区变化时清空；跳转改为 `{line, nonce}`。Playwright 验证点击结果后打开 package.json 并定位第 2 行 |
| 替换只能全部应用 | preview 无选择集，apply 固定处理整个 plan | preview 增加文件级勾选/全选/全不选；apply 接受 `paths`，只校验、备份、写入选中文件，undo 只恢复实际写入文件。两文件 tests 仅改选中项 |
| 历史会话空白 | 请求 `limit=300` 超过上游上限 200，返回 400 | 改为 `limit=200&order=desc`；M1-007 记录 |
| Git 推送状态不可见 | `/api/git/info` 无 upstream/ahead/behind | 增加 `@{u}...HEAD` 计数并在面板展示 |

> 本轮修复已提交并推送；M5–M8 的验收结果仍为空/BLOCKED，未在本轮声称完成。


---

## 7.13 2026-10-30 UI 增强验收

| 编号 | 用例 | 步骤 | 期望 | 结果 |
| ---- | ---- | ---- | ---- | ---- |
| UI-001 | 字号调节 | 顶栏 A+ / 设置滑杆调整到 130% | 界面整体缩放且无滚动溢出；刷新后保留 | PASS（Playwright：1.30 下 scrollWidth==innerWidth、scrollHeight==innerHeight） |
| UI-002 | 会话归档 | 归档会话 → 显示归档 → 取消归档 | 活动列表移除、归档区出现、可恢复 | PASS（API + UI 实测） |
| UI-003 | 对话内搜索 | Ctrl+F 搜索关键词，点击结果 | 命中消息片段并可跳转定位 | PASS（200 条消息中命中 42 条，点击后消息闪烁定位） |
| UI-004 | 上下条跳转 | 顶栏 ↑/↓ 或 Alt+↑/↓ | 在消息间移动并显示序号 | PASS（1/200 → 2/200） |
| UI-005 | 连续 @ 引用 | 输入 @pack 选中，再继续输入 @docs 选中 | 两个 mention chip；发送文件附件 | PASS（请求体含两个 file:/// URI 与 mention 偏移；真实模型读取附件内容） |
| UI-006 | Neumorphism | 检查背景、面板、按钮、输入框 | #e0e5ec、双光源阴影、圆角、inset 输入、无硬边框 | PASS（计算样式 + 截图走查） |

> 说明：@ 附件使用 file:/// URI；opencode 2.2.1 实测可读取附件内容（探针返回 ATTACH-OK-731）。字号缩放同时作用于 CodeMirror 与 xterm，不需要重新创建编辑器实例。


---

## 7.14 2026-10-30 M5 编辑器增强验收

| 编号 | 用例 | 结果 |
| ---- | ---- | ---- |
| M5-001 | 语言注册表分派 | PASS（.py/.sql/.yaml/.json/.md/.toml/.ini/.conf/nginx 均走注册表；状态栏显示） |
| M5-002 | 按需加载 | PASS（语言动态 import；构建产出独立 chunk，主包 gzip ≈294KB） |
| M5-003 | 语言切换不重建 | PASS（Compartment.reconfigure，不销毁 EditorView） |
| M5-004 | nginx 降级 | PASS（legacy-modes nginx；Playwright 打开 nginx.conf，状态栏 Nginx，高亮正常） |
| M5-005 | 未知扩展名/大文件 | PASS（纯文本 fallback；>2MB 只读沿用） |
| M5-006 | Markdown 源码高亮 | PASS（lang-markdown + language-data 围栏代码） |
| M5-007 | Markdown 预览安全 | PASS（script/onerror 测试 md 未执行，window.__xss undefined） |
| M5-008 | 双模式/滚动同步 | PASS（源码/分屏/预览；源码滚动比例同步） |
| M5-009 | 任务列表回写 | PASS（勾选后源码变 `- [x]` 并自动保存） |
| M5-010 | 相对资源 | PASS（/api/fs/raw 返回 image/png；`../package.json` 返回 403） |
| M5-011 | SQL 方言高亮 | PASS（sqlite/postgresql/mysql/mariadb/tsql/plsql 可切换） |
| M5-012 | SQL 格式化事务 | PASS（预览 → 应用 → 撤销；实测格式化后文件正确，undo 复原） |
| M5-013 | 格式化失败保护 | PASS（不闭合样例返回 422，UI 显示行/列与换方言提示，文件字节未变） |
| M5-014 | 选区格式化 | PASS（CRLF 文件只格式化选中行；选区外 CRLF 与尾部语句字节级不变） |

> 运行状态：`npm run typecheck`、`npm test`（19 用例）、`npm run build` 均通过；Playwright 走查 Markdown 分屏/XSS/任务回写、SQL 格式化应用与撤销、nginx 语言切换。


---

## 7.15 2026-10-30 M6 数据源验收（SQLite / Redis）

| 编号 | 用例 | 结果 |
| ---- | ---- | ---- |
| M6-001 | 连接档案 CRUD | PASS（API + UI；connections.json 无明文/无 password） |
| M6-002 | 连接测试 | PASS（SQLite 3.53.3；Redis 5.0.14.1） |
| M6-003 | 元数据浏览 | PASS（users 列/idx_users_age 与 PRAGMA 一致） |
| M6-004 | 数据网格 | PASS/ PARTIAL（rowLimit=2 截断；万行虚拟滚动未压测） |
| M6-005 | 只读守卫 | PASS（UPDATE → 403，数据库不变） |
| M6-006 | 语句白名单 | PASS（多语句 → 400） |
| M6-007 | 参数化绑定 | PASS（age > ? 正确） |
| M6-008 | 超时/行数 | PASS（行数上限）；PARTIAL（慢查询超时注入未做） |
| M6-009 | 结果导出 | PASS CSV/JSON；PARTIAL（非严格流式） |
| M6-010 | 编辑器联动 | PASS（SQL Ctrl+Enter → Data panel 返回结果） |
| M6-011 | Redis 无 KEYS | PASS（scripts/ci-assert.sh --only=m6-011，MONITOR 捕获 SCAN，无 KEYS） |
| M6-012 | 大键空间 | PARTIAL（游标/加载更多已实现；10 万键压测未做） |
| M6-013 | 类型分派 | PASS（string/hash/list 实测） |
| M6-014 | 危险命令守卫 | PASS（GET 成功；KEYS/FLUSHALL → 403） |
| M6-015 | 订阅推送 | PASS（订阅频道 → 外部 PUBLISH → 前端收到） |
| M6-016 | 凭据不外泄 | PASS（--only=m6-016：日志/响应/connections.json 无明文） |
| M6-017 | PostgreSQL/MySQL | BLOCKED（501 driver_not_available） |

故障注入：
- FI-M6-A DB 断连：**PARTIAL**（错误返回与连接释放已实现，未做停库长时回归）。
- FI-M6-B Redis 断连重连：**PARTIAL**（SSE 报错/连接关闭已处理；未做重启自动恢复压测）。
- FI-M6-C 慢查询洪峰：**PARTIAL**（worker 超时/行数上限；并发上限未做）。
- FI-M6-D 凭据存储不可用：**PASS**（DPAPI 失败返回明确错误，不回退明文）。

> 本轮 M6 以 SQLite/Redis 首发；PostgreSQL/MySQL 驱动未启用。测试用的 6380/6381 Redis 实例与临时 SQLite 文件已清理。
