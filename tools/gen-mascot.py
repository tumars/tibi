#!/usr/bin/env python3
"""按 docs/design/07-mascot-assets.md 里的提示词批量生成吉祥物插画。

实际出图走 Codex 命令行（ChatGPT 登录，不需要 API Key）：用 --print 拼提示词后交给
`codex exec`，命令与归档步骤见 07 §1.1。直接调 Images API 是有 API Key 时的备用路径。

用法（在仓库根目录，除 --list / --print 外需要 OPENAI_API_KEY）：
  python3 tools/gen-mascot.py --list                 # 列出提示词 id
  python3 tools/gen-mascot.py ref-sheet              # 先出角色设定图，挑一张存为 docs/design/mascot/ref-sheet.png
  python3 tools/gen-mascot.py hero-day empty-review  # 指定几张；自动带 ref-sheet.png 做参考图
  python3 tools/gen-mascot.py --all                  # 除 ref-sheet 外全部
  选项：--model gpt-image-1.5 --quality high --n 2 --out docs/design/mascot/out

没有 API Key 时，用 --print 把拼好的提示词打印出来，交给 Codex，或贴到 ChatGPT（附上设定图）。
只用标准库，不依赖 openai 包。
"""
import argparse, base64, json, os, pathlib, re, sys, time, urllib.request, uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = ROOT / 'docs/design/07-mascot-assets.md'
REF = ROOT / 'docs/design/mascot/ref-sheet.png'
# 其余都是 1024x1024。sticker 是 3×2 整张，生成后再切成单张（07 §1.1）。
SIZES = {'hero-morning': '1536x1024', 'hero-day': '1536x1024', 'hero-night': '1536x1024'}

def load_prompts():
    text = DOC.read_text(encoding='utf-8')
    found = dict(re.findall(r'<!-- prompt:([\w-]+) -->\s*(.*?)\s*<!-- /prompt -->', text, re.S))
    character = found.pop('character')
    return character, found

def build(character, pid, body):
    if pid == 'ref-sheet':
        return body.replace('CHARACTER', 'this character: ' + character)
    return character + '\n\n' + body.replace('CHARACTER', 'Tibi (the character above)')

def call(url, payload=None, files=None):
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        sys.exit('需要 OPENAI_API_KEY；或用 --print 只看提示词')
    if files:
        boundary = '----tibi' + uuid.uuid4().hex
        body = b''
        for k, v in payload.items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, (name, data, ctype) in files.items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b'\r\n'
        body += f'--{boundary}--\r\n'.encode()
        req = urllib.request.Request(url, data=body, headers={'Authorization': f'Bearer {key}', 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    else:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)

def generate(pid, prompt, args):
    size = SIZES.get(pid, '1024x1024')
    common = {'model': args.model, 'prompt': prompt, 'n': str(args.n), 'size': size, 'quality': args.quality}
    if pid not in ('ref-sheet', 'hero-morning', 'hero-day', 'hero-night', 'about'):
        common['background'] = 'transparent'
    if pid != 'ref-sheet' and REF.exists():
        res = call('https://api.openai.com/v1/images/edits', common, {'image[]': ('ref-sheet.png', REF.read_bytes(), 'image/png')})
    else:
        if pid != 'ref-sheet':
            print(f'  （没有 {REF.relative_to(ROOT)}，这张不带参考图，一致性会差）')
        res = call('https://api.openai.com/v1/images/generations', {**common, 'n': args.n})
    out = pathlib.Path(args.out); out.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, d in enumerate(res['data']):
        p = out / (f'{pid}.png' if args.n == 1 else f'{pid}-{i + 1}.png')
        p.write_bytes(base64.b64decode(d['b64_json'])); paths.append(p)
    return paths

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*'); ap.add_argument('--all', action='store_true'); ap.add_argument('--list', action='store_true'); ap.add_argument('--print', action='store_true')
    ap.add_argument('--model', default='gpt-image-1.5'); ap.add_argument('--quality', default='high'); ap.add_argument('--n', type=int, default=1)
    ap.add_argument('--out', default=str(ROOT / 'docs/design/mascot/out'))
    args = ap.parse_args()
    character, prompts = load_prompts()
    if args.list:
        print('\n'.join(prompts)); return
    ids = [i for i in prompts if i != 'ref-sheet'] if args.all else args.ids
    if not ids:
        ap.print_help(); return
    for pid in ids:
        if pid not in prompts:
            sys.exit(f'没有这个 id：{pid}（--list 查看）')
        prompt = build(character, pid, prompts[pid])
        if args.print:
            print(f'===== {pid} ({SIZES.get(pid, "1024x1024")}) =====\n{prompt}\n'); continue
        print(f'{pid} …', flush=True); t = time.time()
        for p in generate(pid, prompt, args):
            print(f'  → {p.relative_to(ROOT)}  ({time.time() - t:.0f}s)')

if __name__ == '__main__':
    main()
