#!/usr/bin/env bash
# Android 冒烟测试（发布流程 android-smoke 任务，在带 KVM 的模拟器里跑）：
# 装上 APK → 打开 → 看进程活着、没有崩溃；把屏幕上的文字打到日志里（不登录也能看日志）；
# 点欢迎页的「开始」，再看一次屏幕（Core 在 WebView 里跑、rusqlite 建库写库，第一次打开选水平并放一篇示例）。
set -uo pipefail
APK="$1"; OUT="${2:-smoke}"; mkdir -p "$OUT"
texts() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/$1.xml"; echo "== 屏幕上的文字（$1）"; grep -oE '(text|content-desc)="[^"]+"' "$OUT/$1.xml" | sort -u | head -80; adb exec-out screencap -p > "$OUT/$1.png"; }
tap() { # 点第一个文字等于 $1 的节点
  python3 - "$OUT/$2.xml" "$1" <<'PY' | while read -r x y; do echo "tap $x $y"; adb shell input tap "$x" "$y"; done
import re, sys
xml, want = open(sys.argv[1], encoding='utf-8').read(), sys.argv[2]
for m in re.finditer(r'<node [^>]*>', xml):
    n = m.group(0)
    if f'text="{want}"' in n or f'content-desc="{want}"' in n:
        x1, y1, x2, y2 = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
}

adb install -r "$APK" || exit 1
adb logcat -c
waitfor() { # 等屏幕的 XML 里出现 $1（grep 的式子，最多 $2 秒），存成 $3
  for _ in $(seq 1 $(( $2 / 5 ))); do adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/$3.xml"; grep -q -- "$1" "$OUT/$3.xml" && return 0; sleep 5; done; return 1; }
adb shell am start -W -n app.tibi/.MainActivity
waitfor 'text="开始"' 180 launch || echo "180 秒内没等到「开始」"
texts launch
tap "开始" launch
sleep 15
texts after-start
tap "书架" after-start
waitfor "How a Compiler Sees Your Code" 90 library && echo "书架里有示例文章" || echo "书架里没看到示例文章"
texts library
adb logcat -d > "$OUT/logcat.txt"
echo "== Tibi 的日志（WebView 控制台、Rust）"
grep -E "Tauri|tibi|RustStdoutStderr|chromium.*CONSOLE" "$OUT/logcat.txt" | grep -v "^--" | tail -60
pid=$(adb shell pidof app.tibi | tr -d '\r')
echo "pid=$pid"
if grep -E "FATAL EXCEPTION|panicked at" "$OUT/logcat.txt" | grep -q .; then echo "== 有崩溃"; grep -A20 -E "FATAL EXCEPTION|panicked at" "$OUT/logcat.txt" | head -60; exit 1; fi
[ -n "$pid" ] || { echo "进程不在了"; exit 1; }
grep -q "How a Compiler Sees Your Code" "$OUT/library.xml" || { echo "第一次打开后书架里没有示例文章"; exit 1; }
echo "OK"
