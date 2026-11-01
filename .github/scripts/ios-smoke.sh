#!/usr/bin/env bash
# iOS 冒烟测试（发布流程 ios-smoke 任务，macOS runner）：tauri ios dev 在模拟器里编译、安装、打开（不用签名），
# 等应用起来后截图，用 Vision 识别屏幕文字，看到欢迎面板（"你好，我是 Tibi" / "开始"）就说明 WKWebView 里页面和 Core 都起来了；
# 再看进程活着、没有崩溃报告。用法：ios-smoke.sh <模拟器 UDID> <输出目录>
set -uo pipefail
# 注意：不要写 `命令 | grep -q`——pipefail 下 grep -q 提前退出，上游收到 SIGPIPE，整条管道算失败
running() { xcrun simctl spawn "$DEV" launchctl list > "$OUT/launchctl.txt" 2>/dev/null; grep "app.tibi" "$OUT/launchctl.txt"; }
DEV="$1"; OUT="${2:-ios-smoke}"; mkdir -p "$OUT"
here="$(cd "$(dirname "$0")" && pwd)"
echo "== 等应用装上并启动（tauri ios dev 在后台编译，最多 40 分钟）$(date +%T)"
for _ in $(seq 1 240); do
  if running >/dev/null; then echo "应用在跑了 $(date +%T)"; break; fi
  if ! pgrep -f "tauri ios dev" >/dev/null; then echo "tauri ios dev 退出了"; tail -60 "$OUT/ios-dev.log"; exit 1; fi
  sleep 10
done
running || { echo "40 分钟内应用没起来"; tail -80 "$OUT/ios-dev.log"; exit 1; }
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
running >/dev/null || { echo "进程不在了"; exit 1; }
[ "$ok" = 0 ] || { echo "2 分钟内屏幕上没出现欢迎面板"; exit 1; }

# 两个扩展（ios-extensions/add-targets.py 加进工程、随应用内嵌）：系统登记了没有
ext=0
for id in app.tibi.share app.tibi.widget; do
  xcrun simctl spawn "$DEV" pluginkit -m -A -D -v -i "$id" > "$OUT/pluginkit-$id.txt" 2>&1
  if grep -q "$id" "$OUT/pluginkit-$id.txt"; then echo "✓ 扩展已登记：$(head -1 "$OUT/pluginkit-$id.txt" | tr -s ' ')"; else echo "✗ 扩展没登记：$id"; cat "$OUT/pluginkit-$id.txt"; ext=1; fi
done
# App Group：主应用写了小组件快照；分享扩展放进收件箱的网址，主应用打开时取走（app_group.rs、mobile/native.ts）
G=$(xcrun simctl get_app_container "$DEV" app.tibi group.app.tibi 2>&1) || { echo "✗ 拿不到 App Group 目录：$G"; ext=1; G=""; }
if [ -n "$G" ]; then
  echo "App Group 目录：$G"
  if [ -s "$G/widget.json" ]; then echo "✓ 小组件快照：$(cat "$G/widget.json")"; else echo "✗ 没有 widget.json"; ls -la "$G"; ext=1; fi
  mkdir -p "$G/share-inbox"
  echo '{"url":"https://go.dev/blog/go1.21","title":"Go 1.21","later":false,"at":0}' > "$G/share-inbox/9999999999999.json"
  xcrun simctl terminate "$DEV" app.tibi >/dev/null 2>&1; sleep 2; xcrun simctl launch "$DEV" app.tibi >/dev/null
  taken=1; for _ in $(seq 1 30); do sleep 2; [ -e "$G/share-inbox/9999999999999.json" ] || { taken=0; break; }; done
  if [ "$taken" = 0 ]; then echo "✓ 主应用打开后取走了分享收件箱里的网址"; else echo "✗ 分享收件箱里的网址 60 秒没被取走"; ext=1; fi
fi
[ "$ext" = 0 ] || { echo "扩展 / App Group 检查没通过"; exit 1; }
echo "OK"
