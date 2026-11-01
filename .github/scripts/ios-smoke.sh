#!/usr/bin/env bash
# iOS 冒烟测试（发布流程 ios-smoke 任务，macOS runner）：tauri ios dev 在模拟器里编译、安装、打开（不用签名），
# 等应用起来后截图，用 Vision 识别屏幕文字，看到欢迎面板（"你好，我是 Tibi" / "开始"）就说明 WKWebView 里页面和 Core 都起来了；
# 再看进程活着、没有崩溃报告。用法：ios-smoke.sh <模拟器 UDID> <输出目录>
set -uo pipefail
DEV="$1"; OUT="${2:-ios-smoke}"; mkdir -p "$OUT"
here="$(cd "$(dirname "$0")" && pwd)"
echo "== 等应用装上并启动（tauri ios dev 在后台编译，最多 40 分钟）$(date +%T)"
for _ in $(seq 1 240); do
  if xcrun simctl spawn "$DEV" launchctl list 2>/dev/null | grep -q "app.tibi"; then echo "应用在跑了 $(date +%T)"; break; fi
  if ! pgrep -f "tauri ios dev" >/dev/null; then echo "tauri ios dev 退出了"; tail -60 "$OUT/ios-dev.log"; exit 1; fi
  sleep 10
done
xcrun simctl spawn "$DEV" launchctl list | grep "app.tibi" || { echo "40 分钟内应用没起来"; tail -80 "$OUT/ios-dev.log"; exit 1; }
ok=1
for i in $(seq 1 12); do
  sleep 10
  xcrun simctl io "$DEV" screenshot "$OUT/screen.png" >/dev/null 2>&1 || continue
  swift "$here/ocr.swift" "$OUT/screen.png" > "$OUT/ocr.txt" 2>/dev/null || continue
  if grep -q -E "你好，?我是 ?Tibi|开始" "$OUT/ocr.txt"; then ok=0; echo "第 $((i * 10)) 秒看到欢迎面板"; break; fi
done
echo "== 屏幕上的文字（Vision 识别）"; cat "$OUT/ocr.txt" 2>/dev/null | head -40
echo "== 应用日志（最后 40 行）"; tail -40 "$OUT/ios-dev.log" | cut -c1-200
crash=$(ls ~/Library/Logs/DiagnosticReports 2>/dev/null | grep -i -E "tibi" || true)
[ -z "$crash" ] || { echo "== 有崩溃报告：$crash"; head -60 ~/Library/Logs/DiagnosticReports/$(echo "$crash" | head -1); exit 1; }
xcrun simctl spawn "$DEV" launchctl list | grep -q "app.tibi" || { echo "进程不在了"; exit 1; }
[ "$ok" = 0 ] || { echo "2 分钟内屏幕上没出现欢迎面板"; exit 1; }
echo "OK"
