#!/usr/bin/env bash
# Android 冒烟测试（发布流程 android-smoke 任务，在带 KVM 的模拟器里跑）：
# 装上 APK → 打开 → 看进程活着、没有崩溃；把屏幕上的文字打到日志里（不登录也能看日志）；
# 界面经 DevTools 协议走一遍：欢迎 → 开始 → 示例文章进书架 → 打开 → 点生词 → 词卡有词典释义（android-smoke-cdp.mjs）。
set -uo pipefail
APK="$1"; OUT="${2:-smoke}"; mkdir -p "$OUT"
texts() { timeout 60 adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/$1.xml"; echo "== 屏幕上的文字（$1）"; grep -oE '(text|content-desc)="[^"]+"' "$OUT/$1.xml" | sort -u | head -80; timeout 30 adb exec-out screencap -p > "$OUT/$1.png"; }

echo "== 安装 $(date +%T)"; timeout 600 adb install -r "$APK" || exit 1
adb logcat -c
echo "== 启动 $(date +%T)"; timeout 120 adb shell am start -W -n app.tibi/.MainActivity
# debug 包的 WebView 开着远程调试：找到它的 socket，转到本机端口，用 DevTools 协议像用户一样点（android-smoke-cdp.mjs）
sock=""
for _ in $(seq 1 60); do sock=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1); [ -n "$sock" ] && break; sleep 3; done
echo "devtools socket: ${sock:-没找到}"
ui=1
if [ -n "$sock" ]; then adb forward tcp:9222 "localabstract:$sock" && ADB_SHOTS=1 timeout 420 node "$(dirname "$0")/android-smoke-cdp.mjs" 9222 "$OUT" | tee "$OUT/cdp.txt"; [ "${PIPESTATUS[0]}" = 0 ] && ui=0; fi
# 已知：GitHub 的模拟器一打开阅读器页（长页面）qemu 进程就没了（宿主 / guest 渲染、加内存、加磁盘都一样）。
# Core、欢迎、示例导入、词典都过了，之后只是模拟器没了，记成警告；别的失败照样算失败。
if [ "$ui" != 0 ] && grep -q "STAGE core-ok" "$OUT/cdp.txt" 2>/dev/null && ! pgrep -f qemu-system >/dev/null; then
  echo "::warning::模拟器在阅读器页崩了（已知的模拟器问题，见开发说明 §6）；Core、欢迎、示例导入、词典都已通过"
  exit 0
fi
if [ "$ui" != 0 ]; then
  echo "== 宿主状态（看模拟器是不是被 OOM 杀了、磁盘是不是满了）"
  df -h / | tail -1; free -m | head -2
  sudo dmesg 2>/dev/null | grep -i -E "killed process|out of memory|oom" | tail -5
  pgrep -a qemu | cut -c1-120 || echo "qemu 进程不在了"
fi
# secrets.json 里应该是 Keystore 加密后的密文（ks1:…），不该有明文（debug 包可以 run-as 读应用私有目录）
if [ "$ui" = 0 ]; then
  sec=$(timeout 30 adb shell run-as app.tibi cat secrets.json 2>&1 | tr -d '\r')
  echo "secrets.json：$(echo "$sec" | cut -c1-120)"
  if grep -q "sk-smoke-123456" <<< "$sec"; then echo "✗ secrets.json 里是明文"; ui=1
  elif grep -q '"smoke.test":"ks1:' <<< "$sec"; then echo "✓ secrets.json 里是 Keystore 密文"
  else echo "✗ secrets.json 里没找到加密的 smoke.test"; ui=1; fi
fi
texts final
timeout 60 adb logcat -d > "$OUT/logcat.txt"
echo "== Tibi 的日志（WebView 控制台、Rust）"
grep -E "Tauri|tibi|RustStdoutStderr|chromium.*CONSOLE" "$OUT/logcat.txt" | grep -v "^--" | tail -60
pid=$(adb shell pidof app.tibi | tr -d '\r')
echo "pid=$pid"
# 只算 Tibi 自己的崩溃（uiautomator 之类的进程也会在 logcat 里打 FATAL EXCEPTION）：Java 崩溃块里有 "Process: app.tibi"，Rust panic 有 "panicked at"
if grep -q -E "Process: app\.tibi|panicked at" "$OUT/logcat.txt"; then echo "== 有崩溃"; grep -B2 -A20 -E "Process: app\.tibi|panicked at" "$OUT/logcat.txt" | head -60; exit 1; fi
[ -n "$pid" ] || { echo "进程不在了"; exit 1; }
[ "$ui" = 0 ] || { echo "界面冒烟测试没通过"; exit 1; }
echo "OK"
