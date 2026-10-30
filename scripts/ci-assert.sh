#!/usr/bin/env bash
# scripts/ci-assert.sh
# M6-011 (Redis key browsing must use SCAN, never KEYS) and
# M6-016 (credentials must not leak into responses/logs/connections.json).
#
# Exit codes: 0 pass, 1 assertion failure, 2 environment/precondition error
#             (BLOCKED, not FAIL), 3 usage error.
# Run from Git Bash/WSL. This repository's M6 endpoints are not implemented yet,
# so the default run exits 2 with an explicit BLOCKED message; --self-test is
# runnable today and validates the assertion logic itself.

set -uo pipefail

readonly EXIT_OK=0
readonly EXIT_ASSERT=1
readonly EXIT_ENV=2
readonly EXIT_USAGE=3

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
SELF_TEST=0
FAILED=0
RAN=""

log() { printf '[ci-assert] %s\n' "$*" >&2; }
die_env() { log "ENV/BLOCKED: $*"; exit "$EXIT_ENV"; }
die_usage() { log "USAGE ERROR: $*"; exit "$EXIT_USAGE"; }
fail() { log "ASSERT FAIL: $*"; FAILED=$((FAILED + 1)); }
pass() { log "PASS: $*"; }
have() { command -v "$1" >/dev/null 2>&1; }
require_cmd() { have "$1" || die_env "缺少命令：$1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out=*) OUT_DIR="${1#*=}" ;;
    --only=*) ONLY="${1#*=}" ;;
    --self-test) SELF_TEST=1 ;;
    -h|--help)
      cat <<'USAGE'
用法：ci-assert.sh [--out=DIR] [--only=m6-011,m6-016] [--self-test]
环境变量：BFF_BASE REDIS_URL LOG_DIR CONN_FILE SECRETS_FILE MONITOR_SECONDS
退出码：0 通过 / 1 断言失败 / 2 环境错误或场景未跑到(BLOCKED) / 3 用法错误
USAGE
      exit "$EXIT_OK" ;;
    *) die_usage "未知参数：$1" ;;
  esac
  shift
done

mkdir -p "$OUT_DIR/responses" "$OUT_DIR/logs"
monitor_file="$OUT_DIR/redis-monitor.log"
scan_response="$OUT_DIR/responses/redis-scan.json"

wait_http() {
  local url="$1" timeout="${2:-15}" i=0
  until curl -fsS -o /dev/null "$url" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -ge "$timeout" ] && return 1
    sleep 1
  done
}

post_json() { # post_json <path> <json> <outfile>  -> prints HTTP code
  curl -sS -o "$3" -w '%{http_code}' -X POST "$BFF_BASE$1" \
    -H 'content-type: application/json' -d "$2" 2>/dev/null || true
}

preflight() {
  require_cmd curl
  require_cmd jq
  require_cmd grep
  wait_http "$BFF_BASE/api/health" 15 || die_env "BFF 不可达：$BFF_BASE/api/health"
  if [ "$ONLY" = "m6-011" ] || [[ ",$ONLY," == *,m6-011,* ]]; then
    require_cmd redis-cli
    redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1 || die_env "Redis 不可达：$REDIS_URL"
  fi
  if [ "$ONLY" = "m6-016" ] || [[ ",$ONLY," == *,m6-016,* ]]; then
    [ -f "$SECRETS_FILE" ] || die_env "缺少夹具：$SECRETS_FILE（复制 secrets.example.json 后填入测试值）"
  fi
  log "OUT=$OUT_DIR"
}

# ------------------------- scenario drivers (TODO when M6 lands) -------------------------
drive_redis_scan() {
  local code
  code="$(post_json '/api/redis/scan' "{\"profileId\":\"$REDIS_PROFILE\",\"pattern\":\"*\",\"count\":100}" "$scan_response")"
  case "$code" in
    200|201) ;;
    404|501) die_env "M6 Redis 端点未实现（/api/redis/scan -> $code）；M6-011 记 BLOCKED" ;;
    *) die_env "redis scan 调用失败（HTTP $code）；场景未跑到" ;;
  esac
}

drive_secret_scenarios() {
  local code
  code="$(post_json '/api/db/query' "{\"profileId\":\"$DB_PROFILE\",\"sql\":\"SELECT 1\"}" "$OUT_DIR/responses/db-query.json")"
  case "$code" in
    200|201) ;;
    404|501) die_env "M6 数据库端点未实现（/api/db/query -> $code）；M6-016 记 BLOCKED" ;;
    *) log "db query 返回 HTTP $code（继续收集日志）" ;;
  esac
  code="$(curl -sS -o "$OUT_DIR/responses/connections.json" -w '%{http_code}' "$BFF_BASE/api/connections" 2>/dev/null || true)"
  case "$code" in
    200) ;;
    404|501) die_env "M6 连接档案端点未实现（/api/connections -> $code）；M6-016 记 BLOCKED" ;;
    *) log "connections 返回 HTTP $code（继续收集日志）" ;;
  esac
  curl -fsS "$BFF_BASE/api/health" -o "$OUT_DIR/responses/health.json" 2>/dev/null || true
}

# ---------------------------------- assertions ----------------------------------
normalize_monitor() { # normalize_monitor <raw> <out>
  sed -E 's/^[0-9.]+ \[[^]]+\] //; s/"//g' "$1" | awk '{print toupper($1)}' | sort -u >"$2"
}

check_monitor_file() { # exits with assertion result via FAILED; used by self-test too
  local raw="$1" label="$2"
  [ -s "$raw" ] || die_env "MONITOR 未捕获任何命令，场景未跑到（BLOCKED）"
  local norm="$OUT_DIR/redis-commands.txt"
  normalize_monitor "$raw" "$norm"
  local bad
  bad="$(grep -nE '^(KEYS|FLUSHALL|FLUSHDB|SHUTDOWN|DEBUG|CONFIG)$' "$norm" || true)"
  if [ -n "$bad" ]; then
    fail "$label 捕获到禁用命令：$(echo "$bad" | tr '\n' ' ')"
  else
    pass "$label 未出现 KEYS/FLUSH 类命令"
  fi
  grep -q '^SCAN$' "$norm" && pass "$label 确认走 SCAN 游标" || fail "$label 未捕获 SCAN（检查驱动或实现）"
}

test_m6_011() {
  RAN="$RAN m6-011"
  command -v redis-cli >/dev/null 2>&1 || die_env "缺少 redis-cli，无法执行 MONITOR 断言"
  # Keep the monitor window short; MONITOR is only for local test instances.
  redis-cli -u "$REDIS_URL" --no-raw MONITOR >"$monitor_file" 2>&1 &
  local mon_pid=$!
  sleep 1
  drive_redis_scan
  sleep 2
  kill "$mon_pid" 2>/dev/null || true
  wait "$mon_pid" 2>/dev/null || true
  check_monitor_file "$monitor_file" "M6-011"
}

test_m6_016() {
  RAN="$RAN m6-016"
  drive_secret_scenarios

  local scan_root="$OUT_DIR/scan"
  mkdir -p "$scan_root/logs" "$scan_root/responses"
  [ -d "$LOG_DIR" ] && cp -R "$LOG_DIR/." "$scan_root/logs/" 2>/dev/null || log "日志目录不存在：$LOG_DIR"
  cp -R "$OUT_DIR/responses/." "$scan_root/responses/" 2>/dev/null || true
  [ -f "$CONN_FILE" ] && cp "$CONN_FILE" "$scan_root/connections.json" || die_env "连接档案不存在：$CONN_FILE（场景未跑到）"

  local pattern_file="$OUT_DIR/secret-patterns.txt"
  jq -r 'to_entries[].value' "$SECRETS_FILE" 2>/dev/null \
    | grep -vE '^(null|""?)$' \
    | sed -e 's/[][\\.^$*+?(){}|]/\\&/g' >"$pattern_file"
  [ -s "$pattern_file" ] || die_env "夹具未解析出任何密钥值"

  local hits="" pat found
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    found="$(grep -rInE "$pat" "$scan_root" 2>/dev/null || true)"
    [ -n "$found" ] && hits="$hits$found"$'\n'
  done <"$pattern_file"

  if [ -n "$hits" ]; then
    echo "$hits" | sed -E 's/^(.*:[0-9]+:).*/\1 <REDACTED>/' | head -n 20 >"$OUT_DIR/m6-016-hits.txt"
    fail "M6-016 命中凭据明文，位置见 $OUT_DIR/m6-016-hits.txt"
  else
    pass "M6-016 日志/响应/连接档案中未出现凭据明文"
  fi

  if jq -e '.. | objects | has("password")' "$scan_root/connections.json" >/dev/null 2>&1; then
    fail "M6-016 connections.json 含 password 字段（应只存 authRef）"
  else
    pass "M6-016 connections.json 无明文 password 字段"
  fi
}

self_test() {
  local tmp="$OUT_DIR/selftest"
  mkdir -p "$tmp"
  local secret="SELFTEST_$(date +%s)_SECRET"
  printf '{"dbPassword":"%s"}\n' "$secret" >"$tmp/secrets.json"
  printf 'allowed\nnoise with %s here\n' "$secret" >"$tmp/leak.log"
  local pat found
  pat="$(printf '%s' "$secret" | sed -e 's/[][\\.^$*+?(){}|]/\\&/g')"
  found="$(grep -rInE "$pat" "$tmp" 2>/dev/null || true)"
  if [ -n "$found" ]; then
    pass "self-test 检出植入密钥（扫描逻辑有效）"
  else
    fail "self-test 未检出植入密钥（扫描逻辑失效）"
  fi
  printf '1700000000.000000 [0 127.0.0.1:6379] "SCAN" "0" "MATCH" "*"\n' >"$tmp/monitor-ok.log"
  printf '1700000001.000000 [0 127.0.0.1:6379] "KEYS" "*"\n' >"$tmp/monitor-bad.log"
  local before="$FAILED"
  check_monitor_file "$tmp/monitor-ok.log" "self-test SCAN" >/dev/null 2>&1 || true
  local ok_failed="$FAILED"
  FAILED="$before"
  check_monitor_file "$tmp/monitor-bad.log" "self-test KEYS" >/dev/null 2>&1 || true
  local detected=0
  [ "$FAILED" -gt "$before" ] && detected=1
  FAILED="$before"
  if [ "$ok_failed" -eq "$before" ]; then
    pass "self-test SCAN 样本未误报"
  else
    fail "self-test SCAN 样本被误判"
  fi
  if [ "$detected" -eq 1 ]; then
    pass "self-test 能识别 KEYS（判定有效）"
  else
    fail "self-test 未识别 KEYS（判定失效）"
  fi
  rm -rf "$tmp"
}

main() {
  if [ "$SELF_TEST" = "1" ]; then
    self_test
    log "self-test 失败数：$FAILED"
    [ "$FAILED" -eq 0 ] && exit "$EXIT_OK" || exit "$EXIT_ASSERT"
  fi
  preflight
  case ",$ONLY," in *,m6-011,*) test_m6_011 ;; esac
  case ",$ONLY," in *,m6-016,*) test_m6_016 ;; esac
  log "已执行：${RAN:-（无）}  失败数：$FAILED"
  log "产物：$OUT_DIR"
  [ "$FAILED" -eq 0 ] && exit "$EXIT_OK" || exit "$EXIT_ASSERT"
}

main "$@"
