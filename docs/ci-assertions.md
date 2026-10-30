# CI 断言：M6-011 / M6-016

脚本：`scripts/ci-assert.sh`（Git Bash / WSL）
夹具：`scripts/fixtures/secrets.example.json` → 复制为 `secrets.local.json`（已加入 `.gitignore`）
产物：`artifacts/ci-assert/<时间戳>/`（已加入 `.gitignore`）

## 退出码

| 码 | 含义 | 验收表 |
| -- | ---- | ------ |
| 0 | 全部断言通过 | PASS |
| 1 | 断言失败（行为不合规） | FAIL，上传 `--out` 产物 |
| 2 | 环境/前置缺失，或场景未跑到 | BLOCKED，不算 FAIL |
| 3 | 参数/用法错误 | 流水线配置问题，直接失败 |

## 当前状态（2026-10-30）

- 脚本断言已接入真实 M6 端点，`--self-test` 可验证“密钥扫描”和“KEYS 检测”逻辑。
- **M6-011 / M6-016 已在本地通过**：
  - M6-011：`--only=m6-011`，MONITOR 捕获 SCAN，无 KEYS/FLUSH/CONFIG，退出码 0。
  - M6-016：`--only=m6-016`，日志/响应/connections.json 无明文，退出码 0。
- 本机 2026-10-30：`bash -n` 通过；`--self-test` 退出码 0；真实用例退出码 0。
- `drive_redis_scan` / `drive_secret_scenarios` 已对应 `/api/redis/scan`、`/api/db/query`、`/api/connections`。

## 运行

```bash
# 只验证脚本自身
bash scripts/ci-assert.sh --self-test --out=artifacts/ci-assert/selftest

# 真实 M6 断言（需要 BFF + 本地 Redis + 测试 SQLite 连接）
BFF_BASE=http://127.0.0.1:4311 \
REDIS_URL=redis://:testsecret@127.0.0.1:6381 \
REDIS_PROFILE=<redis-profile-id> \
DB_PROFILE=<sqlite-profile-id> \
CONN_FILE=C:/Users/<user>/AppData/Roaming/opencode-gui/connections.json \
LOG_DIR=C:/Users/<user>/AppData/Local/opencode-gui/logs \
SECRETS_FILE=scripts/fixtures/secrets.local.json \
bash scripts/ci-assert.sh --out=artifacts/ci-assert/run1
```

## 判定边界

- **M6-011**：MONITOR 必须捕获到 `SCAN`，且不得出现 `KEYS / FLUSHALL / FLUSHDB / SHUTDOWN / DEBUG / CONFIG`。未捕获 SCAN 记为 **FAIL**（不是 PASS）；MONITOR 为空或 Redis 不可达记为 **BLOCKED**。
- **M6-016**：扫描 BFF 日志、前端响应快照、`connections.json`；命中夹具中的任一密钥即 FAIL。输出只包含 `文件:行号 <REDACTED>`，不打印明文。`connections.json` 含 `password` 字段同样 FAIL。
- MONITOR 仅对本地测试 Redis 使用，脚本用 `MONITOR_SECONDS` 限制窗口。
- Windows 原生 runner 目前需 Git Bash；PowerShell 等价脚本尚未提供，退出码与产物目录约定保持一致。
