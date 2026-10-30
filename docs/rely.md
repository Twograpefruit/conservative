|                  组件                  |                         版本/要求                          |                    用途                     |        必需性         |
| :------------------------------------: | :--------------------------------------------------------: | :-----------------------------------------: | :-------------------: |
|                Node.js                 | 建议 **22 LTS**（资料口径不一：有写 18+、20+，也有写 ≥22） |            跑 opencode 2.x + BFF            |         必需          |
|                npm/pnpm                |                随 Node；pnpm 用 corepack 开                |                  依赖管理                   |         必需          |
|            Git for Windows             |                           2.40+                            |          BFF 调 git CLI、影子仓库           |         必需          |
|             ripgrep (`rg`)             |                            14+                             |              搜索/批量替换后端              |         必需          |
|                 Python                 |                   3.11/3.12 + 项目 venv                    |               目标项目运行时                | 必需（你选了 Python） |
|                pyright                 |                        全局或 pipx                         | GUI 编辑器诊断（2.0 不再由 opencode 提供）5 |         必需          |
|                  ruff                  |                           项目内                           |                lint + format                |         建议          |
|              opencode 2.x              |                      `@opencode/cli`                       |                被对接的服务                 |         必需          |
| VS Build Tools（C++ 工作负载）+ Python |                       用于 node-gyp                        |          编译 `node-pty` 原生模块           |   做终端面板时必需    |
|         Rust 工具链 + WebView2         |               stable；WebView2 系统一般自带                |                  Tauri 壳                   |       M4 才需要       |