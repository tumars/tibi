# OCR 运行文件

`node packages/core-node/scripts/sidecar.mjs` 会把 tesseract 的 worker（tesseract-worker.cjs）和 wasm 拷到这里，随安装包放进 resources/ocr/（tauri.conf.json 的 bundle.resources）。这些文件不进仓库。
