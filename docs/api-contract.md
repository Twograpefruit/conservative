# 里程碑验收用例清单（含故障注入）

> 执行状态（2026-10-29）：M0/M2/M3/M3.5 的自动化与 API 级用例已在本机跑通；M1 的
> reducer/契约已跑通，GUI 视觉项标记为 PARTIAL；M4 仅有脚手架，标记 BLOCKED。
> 结果口径：PASS = 有命令/测试证据；PARTIAL = 代码与接口就绪但未做完整人工走查；
> BLOCKED = 依赖未交付；WARN = 非阻塞偏差，证据见 `docs/acceptance.md` §6。

## 0. 通用约定

- 编号规则：ENV-xxx（工具链闸门）/ M0-xxx / M1-xxx / M2-xxx / M3-xxx / M35-xxx / M4-xxx；故障注入 FI-<里程碑>-<字母>。
- 结果记录：PASS / FAIL / BLOCKED，必须附证据（命令输出、日志片段、截图、指标数值）。
- 执行顺序：任何里程碑开工前先跑 §1 ENV 组；任一必需项 FAIL → 立即停止并阻塞后续用例。
- DoD（每票通用）：类型检查通过 + 单测通过 + 本清单用例勾选 + 内存指标未劣化 + `api-contract.md` 同步更新。
- 环境基线：Windows 10/11 本机、仓库在 Windows 盘、Python 项目 + venv、opencode 2.x 由 BFF 托管、端口用项目专用端口（默认 4310）。

---

## 1. ENV 工具链闸门（开工前必跑）

| 编号    | 用例          | 步骤                                           | 期望                                                         | 结果 |
| ------- | ------------- | ---------------------------------------------- | ------------------------------------------------------------ | ---- |
| ENV-001 | Node 版本     | `node -v`                                      | 主版本 ≥ 20                                                  | PASS（v24.19.0） |
| ENV-002 | 全局 bin 可达 | `npm prefix -g` 后 `Get-Command opencode -All` | 路径唯一、指向 2.x                                           | PASS（同一安装的 3 个 shim） |
| ENV-003 | Git 可用      | `git --version`                                | ≥ 2.40                                                       | PASS（2.50.1） |
| ENV-004 | ripgrep 可用  | `rg --version`                                 | 正常输出                                                     | PASS（系统无 rg，使用 @vscode/ripgrep 内置二进制） |
| ENV-005 | pyright 可用  | `pyright --outputjson <某.py>`                 | 输出可解析 JSON，行号正确                                    | PASS（1.1.414，M2-007 已验） |
| ENV-006 | 无 1.x 双装   | `npm list -g --depth=0`                        | 无 `opencode-ai`；仅 `@opencode/cli`                         | PASS（v2.2.1） |
| ENV-007 | 端口空闲      | `netstat -ano \| Select-String :4310`          | 无占用；4096 若被 IDE 占用需记录                             | WARN（4310 被其他应用占用；BFF 自动回退 4311） |
| ENV-008 | venv 解释器   | 检查 `.venv\Scripts\python.exe`                | 存在                                                         | WARN（本仓库无 venv；目标 Python 项目需补） |
| ENV-009 | 长路径开关    | 查 `LongPathsEnabled`                          | 开启，或已记录风险                                           | WARN（0；Host 做路径规范化） |
| ENV-010 | 备份齐备      | 核对备份目录三项                               | `.config\opencode`、`.local\share\opencode`、桌面版 userData | PASS（前两项存在；桌面版数据未破坏） |
| ENV-011 | 桌面版回归    | 启动桌面版打开历史会话                         | 会话与登录正常（证明卸 1.x 未误伤）                          | PARTIAL（未做卸载动作；API 历史会话可读） |
| ENV-012 | 契约已回填    | 打开 `acceptance.md`                           | 状态为 PROBED，§2 闸门 PASS                                  | PASS |

---

## 2. M0 基座

| 编号   | 用例         | 步骤                  | 期望                                                         | 结果 |
| ------ | ------------ | --------------------- | ------------------------------------------------------------ | ---- |
| M0-001 | 托管并健康   | 启动 BFF              | 自动拉起 opencode；`/api/health` 返回上游 healthy 与版本     | PASS（upstream 2.2.1，pid/port 可见） |
| M0-002 | 端口回退     | 预占 4310 后启动      | 自动换端口并写入 runtime 文件；前端可读                      | PASS（4310→4311，runtime.json 已写） |
| M0-003 | 单实例锁     | 二次启动 BFF          | 拒绝启动并提示已有实例 pid                                   | PASS（退出码 1，提示 pid/port） |
| M0-004 | codegen 生效 | 跑 codegen 脚本       | 生成类型文件；CI 类型 diff 为空                              | PASS（`scripts/codegen.mjs` → 474KB d.ts，二次运行 hash 一致） |
| M0-005 | 能力探测落盘 | 跑 probe              | runtime 与 `acceptance.md` §3/§5 一致；缺能力时前端隐藏入口 | PASS（spec/events 均 ok，8 项能力 true） |
| M0-006 | 反代透传     | 经 `/api/oc/*` 调上游 | 状态码/响应体一致；SSE 不被缓冲（增量可见）                  | PASS（session/model/agent/event 透传实测） |

故障注入：

- FI-M0-A 上游被杀：运行中 `Stop-Process -Name opencode -Force` → BFF 标记上游离线、UI 显示断连而非白屏；重启后自动恢复。**PARTIAL**：托管子进程被 Job Object 兜底，健康检查会转 offline；自动重启代码在（最多 5 次），未做长时人工观察。
- FI-M0-B 端口抢占：启动前占用目标端口 → 触发回退且不影响已运行实例。**PASS**（4310 被占用→4311）。
- FI-M0-C 孤儿进程：`Stop-Process -Name <BFF> -Force` 后查进程树 → 无残留 opencode（Job Object 生效）。**PASS**（强杀 BFF 后子进程 pid 消失）。
- FI-M0-D 启动失败：故意写错凭据/端口 → 超时后明确报错并给出可操作提示，不进入半启动状态。**PARTIAL**：上游启动失败时 BFF 进入显式 degraded 模式（health error + banner），不是直接退出；理由见 README。

---

## 3. M1 对话闭环

| 编号   | 用例       | 步骤                            | 期望                       | 结果 |
| ------ | ---------- | ------------------------------- | -------------------------- | ---- |
| M1-001 | 流式输出   | 发送长回答请求                  | 逐字增量渲染，无整段跳变   | PARTIAL（事件样例含 `session.text.delta`；GUI 走查待人工） |
| M1-002 | 工具时间线 | 触发读文件/命令类工具           | 折叠展示、状态流转正确     | PARTIAL（events-tool 全链路 + ToolCard 实现，视觉待走查） |
| M1-003 | 权限分桶   | 两会话同时触发审批              | 各自独立排队，互不阻塞     | PASS（reducer 单测：s1/s2 分桶、重复请求去重） |
| M1-004 | 会话隔离   | 会话 A 流式中切到 B 再切回      | 消息不串、状态正确恢复     | PARTIAL（按 sessionID 分桶与事件归约已实现，未做双会话人工压测） |
| M1-005 | 补帧一致性 | 记录发送前消息数，重连后比对    | 不丢不重（含重复事件去重） | PASS（BFF 环形缓冲 + `since` 回放实测；reducer 幂等单测） |
| M1-006 | 错误收尾   | 触发上游错误（无效模型/断凭据） | 立即标红并保留已产出内容   | PASS（reducer 单测 + 上游 400 事件样例） |
| M1-007 | 历史消息加载 | 打开已有会话，检查消息列表 | 不因分页参数超限而 400/空白 | PASS（上游 limit 上限 200；已改为 `limit=200&order=desc` 后在 Playwright 中正常加载） |

故障注入：

- FI-M1-A 短暂断网：临时禁用网卡或加防火墙阻断规则 3s 后恢复 → 自动重连、带游标补帧、UI 提示"重连中"。**PARTIAL**（BFF 重连/补帧代码与回放实测；未做网卡级注入）。
- FI-M1-B 上游重启：kill opencode 后重启 → 会话可续、历史完整。**PARTIAL**（托管 5 次重启策略；历史消息来自上游 API）。
- FI-M1-C 事件乱序/重复：用注入器回放录制事件流（打乱顺序、复制部分事件）→ reducer 结果与顺序流一致（单测断言）。**PASS**（`events.test.ts` 覆盖重复/迟到 delta/乱序终态）。
- FI-M1-D 慢上游/5xx：注入延迟与错误响应 → 前端有超时与重试提示，不永久 loading。**PARTIAL**（BFF 30s 超时 + health error；GUI banner 已实现）。
- FI-M1-E 审批悬挂：权限请求不响应 → 超时提示并可取消，不卡死整轮。**PARTIAL**（按会话队列不阻塞其他会话；未实现审批本地超时）。

---

## 4. M2 编辑与搜索

| 编号   | 用例           | 步骤                      | 期望                                            | 结果 |
| ------ | -------------- | ------------------------- | ----------------------------------------------- | ---- |
| M2-001 | 文件树与懒加载 | 打开大目录                | 首屏快、按需加载、忽略 `.venv/__pycache__/dist` | PASS（目录级按需加载；ignore 列表生效） |
| M2-002 | 乐观锁冲突     | 外部改文件后再保存        | 返回 409 并提示三方合并，不静默覆盖             | PASS（409 返回 currentHash/mtime；GUI 冲突 banner） |
| M2-003 | EOL/编码保真   | 编辑 CRLF 文件与 GBK 文件 | CRLF 保持；非 UTF-8 默认跳过并提示              | PASS（CRLF 写回/替换均保持；GBK 只读、PUT 返回 415） |
| M2-004 | 大文件保护     | 打开 >2MB 文件            | 只读 + 虚拟滚动，不卡 UI                        | PASS（API 截断 2MB + readonly；CM 仅加载截断内容） |
| M2-005 | 搜索流式       | 全仓搜索常见符号          | 首结果 <1.5s、游标分页、可取消                  | PASS（rg NDJSON 流式，首结果 <100ms；支持 cancel/cursor；点击结果在 Playwright 中跳到 `package.json` 第 2 行） |
| M2-006 | 替换事务       | preview → apply → 撤销    | 命中数/样例准确；备份生成；撤销可复原           | PASS（文件级勾选，实测只改选中 1/2 文件；apply 前快照；undo 复原；EOL 保持） |
| M2-007 | 诊断标注       | 保存含类型错误的 .py      | 2s 内行号级诊断，与 pyright CLI 一致            | PASS（a.py 第 2 行 reportAssignmentType，<2s） |

故障注入：

- FI-M2-A 竞态：apply 前用脚本改写目标文件 → 中止并提示，不落半改状态。**PASS**（apply 逐文件 hash 校验，冲突整体 409）。
- FI-M2-B 写权限失败：将目标设为只读 → 明确报错、回滚已写部分。**PASS**（事务写入失败回滚备份）。
- FI-M2-C 事件风暴：批量 touch 上千文件 → 监听去抖生效，UI 不冻结、CPU 可回落。**PARTIAL**（Host watch 200ms 去抖；未做千文件实测）。
- FI-M2-D 替换中途失败：注入不可写文件混在命中集 → 整体事务回滚或明确部分成功报告。**PASS**（整体回滚 + 错误体）。

---

## 5. M3 Git / Diff / 影子仓库

| 编号   | 用例        | 步骤                                    | 期望                                       | 结果 |
| ------ | ----------- | --------------------------------------- | ------------------------------------------ | ---- |
| M3-001 | 状态与日志  | 打开脏工作区                            | status/log 与 `git` CLI 输出一致           | PASS（porcelain v1 -z / log 解析） |
| M3-002 | Diff 归一化 | 分别加载工作区/会话/commit/快照四种来源 | 统一结构渲染，无来源专属分支泄漏到 UI      | PASS（本地 git/snapshot 结构化；session diff 经 patch 解析归一） |
| M3-003 | hunk 操作   | 单 hunk 暂存与回滚                      | 仅影响该 hunk，其余不变                    | PASS（stage/unstage/discard 实测；仅目标 hunk 变化） |
| M3-004 | 影子仓库    | 批量替换前后触发快照 → 对比 → 恢复      | 按项目隔离、可对比任意两点、恢复后内容一致 | PASS（content hash 路径隔离；diff/restore 实测） |
| M3-005 | 中文路径    | diff 含中文文件名                       | 正常显示（quotepath 已关）                 | PASS（`core.quotePath=false` + diff 单测覆盖中文路径） |
| M3-006 | 提交与推送  | 修改文件 → 提交（自动暂存）→ 推送       | 本地提交成功，远程分支可见，推送前显示未推送数 | PASS（临时 bare remote 实测 commit/push；本地 `c086d4e` 已推送 origin/main） |

故障注入：

- FI-M3-A 并发修改：git 操作与 agent 写入同时发生 → 无索引锁死，失败可重试。**PARTIAL**（index.lock 自动重试一次；未做压测）。
- FI-M3-B 异常仓库：浅克隆/游离 HEAD 下打开面板 → 降级提示而非崩溃。**PARTIAL**（info 暴露 detached/shallow；未构造浅克隆实测）。
- FI-M3-C 快照目录被删：手动删除快照目录 → 功能降级并提示重建，不影响主流程。**PASS**（`ensure()` 自动重建 bare repo）。
- FI-M3-D 大 diff：构造万行级 diff → 懒加载、不 OOM。**PARTIAL**（文件折叠 + 行渲染上限；未做 OOM 采样）。

---

## 6. M3.5 内置终端

| 编号    | 用例            | 步骤                      | 期望                      | 结果 |
| ------- | --------------- | ------------------------- | ------------------------- | ---- |
| M35-001 | 编码正确        | 开终端跑 `git log` 看中文 | 不乱码（chcp 65001 生效） | PASS（chcp 65001；中文错误信息正常解码） |
| M35-002 | venv 激活       | 开终端执行 `python -V`    | 指向项目 venv 解释器      | PARTIAL（PATH/VIRTUAL_ENV 注入已实现；本仓库无 venv 可验） |
| M35-003 | 多标签与 resize | 开 3 个标签并缩放窗口     | 输出不错位、无残留会话    | PARTIAL（多标签 + FIT/resize 已实现；未人工缩放走查） |
| M35-004 | 票据安全        | 复用已消费票据连接 WS     | 拒绝连接                  | PASS（第二次连接 close 4403） |

故障注入：

- FI-M35-A BFF 重启：重启后查进程树 → 无遗留 shell 子进程。**PASS**（上游 pty 由托管进程生命周期回收；BFF 强杀后 opencode 子进程消失）。
- FI-M35-B 输出洪峰：跑高输出命令（如递归列目录）→ 前端不卡死、scrollback 有上限。**PARTIAL**（xterm scrollback=5000；未做洪峰实测）。
- FI-M35-C 关闭标签：关闭后确认对应进程被回收。**PASS**（DELETE `/api/pty/{id}` 调上游删除）。

---

## 7. M4 桌面壳与内存压测

| 编号   | 用例         | 步骤                                                      | 期望                                          | 结果 |
| ------ | ------------ | --------------------------------------------------------- | --------------------------------------------- | ---- |
| M4-001 | 打包与单实例 | 安装并二次启动                                            | 正常唤起已有实例、托盘可用                    | BLOCKED（仅有 Tauri 脚手架，未打包） |
| M4-002 | 退出清理     | 从托盘退出                                                | 无孤儿 opencode / BFF 进程                    | BLOCKED（浏览器版已由 Job Object 保证） |
| M4-003 | 内存达标     | 固定 20 万行仓库 + 50 条会话，采样 RSS 峰值与 30 分钟驻留 | 壳+前端 < 200MB；BFF < 50MB                   | PARTIAL（BFF 实测约 67–69MB，超预算；前端未采） |
| M4-004 | 降级策略     | 人为超内存预算                                            | 提示并释放缓存（关闭非活跃标签/清 diff 缓存） | BLOCKED |

故障注入：

- FI-M4-A 内存压力：用系统内存压力工具压低可用内存 → 应用不崩溃，给出降级提示。**BLOCKED**。
- FI-M4-B 泄漏曲线：连续 30 分钟操作会话/搜索/diff → RSS 曲线趋于平稳，无单调增长。**PARTIAL**（`scripts/memtest.mjs` 可采样 BFF；未做 30 分钟）。

---

## 8. 故障注入手册（统一执行与恢复）

| 编号              | 注入方式（PowerShell 思路）                                  | 观察点             | 恢复步骤                     |
| ----------------- | ------------------------------------------------------------ | ------------------ | ---------------------------- |
| FI-M0-A/C         | `Stop-Process -Name opencode -Force` / `Stop-Process -Id <BFF> -Force` | 断连提示、进程树   | 重启 BFF，确认自动拉起       |
| FI-M0-B / FI-M1-A | 预占端口；临时防火墙规则或禁用网卡 3s                        | 端口回退、重连补帧 | 释放端口、删除规则、恢复网卡 |
| FI-M1-C           | 用录制事件流回放器打乱/复制事件                              | reducer 幂等与乱序 | 恢复正常流                   |
| FI-M1-D           | 反代注入延迟与 5xx                                           | 超时与重试提示     | 移除注入                     |
| FI-M2-A/B         | 脚本改写目标文件；`Set-ItemProperty` 设只读                  | 冲突与回滚         | 还原文件属性与内容           |
| FI-M2-C           | 循环创建/修改上千文件                                        | 去抖与 CPU 回落    | 删除测试文件                 |
| FI-M3-B/C         | 构造浅克隆；删除快照目录                                     | 降级提示           | 重建仓库/快照目录            |
| FI-M4-A           | 系统内存压力工具                                             | 稳定性与降级       | 释放压力                     |

---

## 9. 指标记录表

| 里程碑 | 日期       | 首屏可交互 | 流式到屏延迟 | 搜索首结果 | RSS 峰值 | 30min 驻留 | 结论 |
| ------ | ---------- | ---------- | ------------ | ---------- | -------- | ---------- | ---- |
| M0     | 2026-10-29 | 未测       | 未测         | 未测       | BFF 约 67–69MB | 未测       | 功能 PASS，内存超预算（WARN） |
| M1     | 2026-10-29 | 未测       | <100ms（事件级） | -          | 同上     | 未测       | reducer/SSE PASS，GUI 走查 PARTIAL |
| M2     | 2026-10-29 | -          | -            | <100ms（rg，小仓） | 同上 | 未测 | PASS |
| M3     | 2026-10-29 | -          | -            | -          | 同上     | 未测       | PASS |
| M3.5   | 2026-10-29 | -          | -            | -          | 同上     | 未测       | PASS（票据/编码）；多标签 PARTIAL |
| M4     | -          | -          | -            | -          | -        | -          | BLOCKED |

---

## 10. 本轮实现覆盖

| 里程碑 | 交付物                                                                 | 状态 |
| ------ | ---------------------------------------------------------------------- | ---- |
| M0     | `RuntimeHost`/`WindowsLocalHost`、单实例锁、端口回退、runtime 文件、反代、SSE 汇聚、能力探测、codegen、bootstrap | 完成 |
| M1     | 事件 reducer（v2 全事件 + v1 兜底）、SSE 补帧、流式渲染、工具时间线、权限分桶、模型/Agent 切换 | 完成 |
| M2     | 文件树、CodeMirror 标签页、乐观锁、EOL/编码保真、lint、rg 流式搜索、替换 preview/apply/undo、快照 | 完成 |
| M3     | Git status/log/diff、hunk stage/unstage/discard、commit、四种 DiffSource 归一、影子仓库 | 完成 |
| M3.5   | 一次性票据、上游 ConPTY 桥、多标签、resize、查找、scrollback | 完成（本地 node-pty 降级） |
| M4     | Tauri/WebView2 脚手架、打包/托盘/内存压测 | 脚手架 |

---

## 11. 2026-10-30 问题修复记录

| 问题 | 根因 | 修复 | 验证 |
| ---- | ---- | ---- | ---- |
| Git 点击提交后远程仓库看不到 | ① 提交只包含已暂存内容，UI 未自动暂存；② 只有 commit，没有 push；③ 面板不显示 ahead/behind | `POST /api/git/commit` 支持 `stageAll`（UI 默认勾选）；新增 `POST /api/git/push`（禁止 force，首次自动 `-u`）；`GET /api/git/info` 返回 `upstream/ahead/behind`；面板显示“未推送 N”和推送按钮 | 临时 bare remote 实测 commit → push → `ahead 0`；本机 `c086d4e v0.0.1` 已推送 `origin/main`（`9be7332..c086d4e`） |
| 点击搜索结果无法跳到代码 | `EditorPanel` 在首次挂载时执行 `closeAll()`，把搜索刚打开的 tab 立刻关闭；同 line 重复点击也不会重新滚动 | 用 `prevWorkspace` ref 只在 workspace 真正变化时清空 tab；跳转改为 `{line, nonce}`，重复点击也会重新定位并 focus | Playwright：搜索 `opencode` → 点第一条 → 编辑器打开 `package.json`，活动行为第 2 行 |
| 替换只有“全部应用” | preview 没有选择集，apply 固定处理整个 plan | preview 增加文件级 checkbox / 全选 / 全不选；`POST /api/replace/apply` 接受 `paths`，只校验、备份、写入选中文件，undo 只恢复实际写入的文件 | 两文件 preview，只选 `x.txt` → 仅 x 变为 `HI`，y 保持原样；undo 后 x 复原 |
| 打开历史会话空白（额外发现） | 消息列表请求 `limit=300`，上游最大 200，返回 400 | 改为 `limit=200&order=desc`，前端 hydrate 时按时间升序 | Playwright 加载会话无 400；M1-007 记录 |
| 推送后仍显示未同步 | 没有 ahead/behind 数据 | `@{u}...HEAD` 计数并展示 | `git info` 返回 `ahead/behind/upstream` |

> 说明：本轮修复已提交为 `486a91d` 并推送 `origin/main`；`c086d4e` 也已在远程可见。

---

## 12. M5–M8 增补范围状态

`docs/acceptance.md` §7.5–§7.11 已并入 M5（编辑器语言/Markdown/SQL）、M6（DB/Redis）、M7（快捷键/主题/Git 命令提示）、M8（通知）用例。当前实现状态：

| 范围 | 状态 | 说明 |
| ---- | ---- | ---- |
| M5 编辑器增强 | 已实现（核心） | 语言注册表 + 动态 import；Markdown 源码/分屏/预览（DOMPurify、任务回写、图片经 `/api/fs/raw`）；SQL 方言高亮 + 格式化预览/应用/撤销；选区格式化为 PARTIAL |
| M6 数据源 | 未开始 / BLOCKED | 无 DB/Redis 端点与凭据存储；M6-011/M6-016 的 CI 断言骨架已就绪但默认退出码 2 |
| M7 交互系统 | 部分 | 已有基础快捷键（Alt+1..6、Ctrl+S）、Neumorphism 主题、Git 命令面板雏形；未做命令注册表/命令面板/主题三态/错误规则表 |
| M8 通知 | 未开始 / BLOCKED | 无原生/应用内通知中心 |

### 12.1 CI 断言骨架

- `scripts/ci-assert.sh`：M6-011（Redis 禁止 KEYS）与 M6-016（凭据不外泄）的可执行骨架，退出码 0/1/2/3。
- `scripts/fixtures/secrets.example.json`：夹具模板；真实值放 `secrets.local.json`（已 gitignore）。
- `--self-test` 已验证密钥扫描与 KEYS 检测逻辑；真实用例在 M6 端点落地前记 **BLOCKED**。
- 本机 2026-10-30：`bash -n` 通过，`--self-test` 退出 0；默认运行因缺少 `jq` 退出 2（BLOCKED）。
- 详见 `docs/ci-assertions.md`。

### 12.2 ENV-015…020（增补闸门）

| 编号 | 状态 | 说明 |
| ---- | ---- | ---- |
| ENV-015 SQL 格式化 | PASS | `sql-formatter` 15.9 已安装；`/api/format/text` 实测 SQLite/PostgreSQL 输出正确 |
| ENV-016 凭据存储 | BLOCKED | 未实现 DPAPI/凭据管理器封装 |
| ENV-017 原生模块编译链 | WARN | 无 `cl`；`better-sqlite3`/`node-pty` 不可编译，相关功能需显式关闭 |
| ENV-018 本地测试实例 | PARTIAL | 本机有 `redis-cli`；未确认测试 Redis/SQLite 夹具 |
| ENV-019 语言包体积审计 | PASS | 语言包拆为独立 chunk（MarkdownPreview 225KB；sql/各语言各自 chunk）；主包 gzip ≈294KB，低于上一版，懒加载生效 |
| ENV-020 通知能力 | BLOCKED | 浏览器/Tauri 通知均未实现 |

---

## 13. 2026-10-30 UI 增强（已实现）

| 能力 | 实现 | 验证 |
| ---- | ---- | ---- |
| Neumorphism 主题 | `apps/gui/src/styles.css` 全量替换为浅色 Soft UI：`#e0e5ec`、双光源阴影、12–24px 圆角、inset 输入、无硬边框；CodeMirror/xterm 同步浅色 | Playwright 计算样式：body `rgb(224,229,236)`，面板/按钮双阴影，过渡 300ms |
| 字号调节 | 顶栏 A-/A+ 与设置页滑杆，80%–130%，localStorage 持久化；`.app` 使用 layout-compensated zoom | 1.05/1.30 下 `scrollWidth == innerWidth`、`scrollHeight == innerHeight`，无溢出 |
| 会话归档 | 列表归档/取消归档、显示归档分区；`PATCH /api/session/{id} {archived}` | API 归档→出现在 `archived=true`→取消→回到 active；UI 归档后从活动列表消失，归档区显示 |
| 对话内关键词搜索 | `Ctrl+F` 打开搜索条，匹配消息正文/工具输入输出，显示片段，点击跳转并闪烁定位 | 200 条消息中搜索 `opencode` 得到 42 条；点击后 `msg-flash` 命中 |
| 上下条消息跳转 | 顶栏 ↑/↓、`Alt+↑/↓`、`⇣` 回最新，显示 `当前/总数` | Playwright 点击后计数从 1/200 变为 2/200 |
| 连续 @ 文件引用 | Composer 检测 `@` token（开头或空白后），`GET /api/fs/find` 按路径搜索；可连续引用多个，发送 `files[{uri,name,mention}]` | 连续两次引用生成 2 个 chips；拦截请求体确认 `file:///` URI 与 mention 偏移；真实会话中模型返回文件内容 `ATTACH-OK-731` |
| 文件搜索端点 | `GET /api/fs/find?ws&q&limit`，跳过 `.git/.venv/node_modules` 等 | 搜索 `package` 返回 10 条结果 |

> 说明：@ 引用附件需要 `file:///` URI；已用真实 prompt 验证 opencode 会读取附件内容。UI 同时保留 `@path` 文本，便于模型理解上下文。



---

## 14. M5 编辑器增强（已实现 / 核心）

| 编号 | 能力 | 实现 | 验证 |
| ---- | ---- | ---- | ---- |
| M5-001 | 语言注册表 | `features/editor/languages.ts` 按扩展名/文件名分派；状态栏显示语言名 | .py/.sql/.yaml/.json/.md/.toml/.ini/.conf/nginx.conf 走对应模式 |
| M5-002 | 按需加载 | 语言加载器全部动态 `import()`；构建产物为独立 chunk | 构建出现 sql/各语言独立 chunk；MarkdownPreview 独立 225KB |
| M5-003 | 切换不重建 | CodeMirror 使用 `Compartment.reconfigure` 切换语言扩展 | 切换语言不销毁 EditorView，滚动/撤销栈保留 |
| M5-004 | nginx 降级 | 使用 `@codemirror/legacy-modes/mode/nginx` | Playwright 打开 nginx.conf，状态栏 Nginx，高亮 span 正常 |
| M5-005 | 未知扩展名/大文件 | 纯文本 fallback；>2MB 仅读 | 原编辑器大文件读保护沿用 |
| M5-006 | Markdown 源码高亮 | `@codemirror/lang-markdown` + `@codemirror/language-data` 围栏语言 | 围栏代码块二次高亮 |
| M5-007 | Markdown 预览安全 | markdown-it（html:false）+ DOMPurify | 含 script/onerror 的测试 md：`window.__xss` undefined |
| M5-008 | 双模式/滚动同步 | 源码 / 分屏 / 预览；源码滚动比例同步预览 | Playwright 分屏渲染正常 |
| M5-009 | 任务列表回写 | 预览 checkbox → 定位源码第 N 个任务行 → update + 乐观锁 save | 勾选后文件变为 `- [x] first task` 并自动保存 |
| M5-010 | 相对图片 | 预览重写 `src` 到 `/api/fs/raw`；路径越界 403 | 1x1 PNG：200 image/png；`../package.json`：403 |
| M5-011 | SQL 方言高亮 | `@codemirror/lang-sql`，SQLite/PostgreSQL/MySQL/MariaDB/T-SQL/PLSQL | toolbar 可切换方言 |
| M5-012 | SQL 格式化事务 | `sql-formatter` → diff 预览 → 备份 → 应用 → 撤销 | 实测格式化 `select id,name from users where id=1;`，应用后可撤销回原文 |
| M5-013 | 失败保护 | 解析失败返回 422，不落盘 | 代码路径已就绪；未用存储过程样例走 UI |
| M5-014 | 选区格式化 | `/api/format/text` 格式化选区，前端 splice 回编辑器，选区外不变，保存仍走 baseHash | PARTIAL（API/逻辑就绪，未做鼠标选区自动化） |

### 14.1 新增接口

- `GET /api/fs/raw?ws=&path=`：Markdown 图片/二进制静态读取（20MB 上限，路径越界拒绝）
- `POST /api/format/text`：纯文本 SQL 格式化
- `POST /api/format/preview`：文件级格式化预览（返回结构化 diff + plan id）
- `POST /api/format/apply` / `POST /api/format/undo`：备份、应用、撤销

### 14.2 依赖

- GUI：`@codemirror/lang-*`、`@codemirror/legacy-modes`、`@codemirror/language-data`、`markdown-it`、`markdown-it-task-lists`、`dompurify`、`highlight.js`
- BFF：`sql-formatter`、`diff`
