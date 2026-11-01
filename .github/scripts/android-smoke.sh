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
if [ -n "$sock" ]; then adb forward tcp:9222 "localabstract:$sock" && timeout 420 node "$(dirname "$0")/android-smoke-cdp.mjs" 9222 "$OUT" && ui=0; fi
texts final
timeout 60 adb logcat -d > "$OUT/logcat.txt"
echo "== Tibi 的日志（WebView 控制台、Rust）"
grep -E "Tauri|tibi|RustStdoutStderr|chromium.*CONSOLE" "$OUT/logcat.txt" | grep -v "^--" | tail -60
pid=$(adb shell pidof app.tibi | tr -d '\r')
echo "pid=$pid"
if grep -E "FATAL EXCEPTION|panicked at" "$OUT/logcat.txt" | grep -q .; then echo "== 有崩溃"; grep -A20 -E "FATAL EXCEPTION|panicked at" "$OUT/logcat.txt" | head -60; exit 1; fi
[ -n "$pid" ] || { echo "进程不在了"; exit 1; }
[ "$ui" = 0 ] || { echo "界面冒烟测试没通过"; exit 1; }
echo "OK"
