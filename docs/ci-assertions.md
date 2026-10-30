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

- 脚本骨架与断言逻辑已落地，`--self-test` 可在无 BFF/Redis 的情况下验证“密钥扫描”和“KEYS 检测”本身有效。
- **M6-011 / M6-016 的实际用例仍为 BLOCKED**：M6 的 `/api/redis/*`、`/api/db/*`、`/api/connections` 尚未实现，默认运行会以退出码 2 明确报告。
- 本机 2026-10-30 实测：`bash -n` 语法通过；`--self-test` 退出码 0（3 项 PASS）；默认运行因缺少 `jq` 退出码 2（BLOCKED）。
- M6 落地后只需替换 `drive_redis_scan` / `drive_secret_scenarios` 两个函数，断言与退出码不变。

## 运行

```bash
# 只验证脚本自身
bash scripts/ci-assert.sh --self-test --out=artifacts/ci-assert/selftest

# M6 落地后（本地 Redis + BFF）
BFF_BASE=http://127.0.0.1:4310 \
REDIS_URL=redis://127.0.0.1:6379 \
SECRETS_FILE=scripts/fixtures/secrets.local.json \
bash scripts/ci-assert.sh --out=artifacts/ci-assert/run1
```

## 判定边界

- **M6-011**：MONITOR 必须捕获到 `SCAN`，且不得出现 `KEYS / FLUSHALL / FLUSHDB / SHUTDOWN / DEBUG / CONFIG`。未捕获 SCAN 记为 **FAIL**（不是 PASS）；MONITOR 为空或 Redis 不可达记为 **BLOCKED**。
- **M6-016**：扫描 BFF 日志、前端响应快照、`connections.json`；命中夹具中的任一密钥即 FAIL。输出只包含 `文件:行号 <REDACTED>`，不打印明文。`connections.json` 含 `password` 字段同样 FAIL。
- MONITOR 仅对本地测试 Redis 使用，脚本用 `MONITOR_SECONDS` 限制窗口。
- Windows 原生 runner 目前需 Git Bash；PowerShell 等价脚本尚未提供，退出码与产物目录约定保持一致。
