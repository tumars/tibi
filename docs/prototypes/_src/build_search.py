# 生成 ../v2-search.js：把生词本 words.html 里的 RAW 词表精简后注入 _search.js（需要 node）。
# 用法：在 docs/prototypes/ 下运行 python3 _src/build_search.py
import json, subprocess
s = open('words.html', encoding='utf-8').read()
a = s.index('const RAW = ['); b = s.index('];', a) + 2
js = s[a:b].replace('const RAW', 'var RAW') + "\nconsole.log(JSON.stringify(RAW.map(r => [r[0], r[1] === 'phrase' ? 1 : 0, r[3], r[4], r[8][0][1]])))"
words = subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout.strip()
json.loads(words)
src = open('_src/_search.js', encoding='utf-8').read()
open('v2-search.js', 'w', encoding='utf-8').write(src.replace('%WORDS%', words).replace('由 _src/_search.js 生成（注入生词数据）', '由 _src/_search.js 生成，不要直接修改'))
print('built v2-search.js')
