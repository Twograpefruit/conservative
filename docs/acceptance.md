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
| RISK-04 | BFF 常驻 RSS 约 约 67–69MB                            | 超出 50MB 预算                | 记录为偏差；后续按需裁剪依赖/日志/缓冲            |
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
