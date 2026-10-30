# 由 _src/_<name>_body.html 生成复习、统计、设置页（原型构建辅助脚本）。
# 用法：在 docs/prototypes/ 下运行 python3 _src/build_pages.py
# 生词本 words.html 的词表数据来自 v1，生成后又直接改过，不在这里重建。
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _build_side import side, HEAD, SCRIPTS

PAGES = {'review': '复习', 'stats': '统计', 'settings': '设置', 'tasks': '任务', 'library': '书架'}
SIDE_KEY = {'library': 'shelf'}   # 书架页高亮的是侧栏的“书架”项
for name, title in PAGES.items():
    body = open(f'_src/_{name}_body.html', encoding='utf-8').read()
    html = HEAD.format(title=f'Tibi {title}') + body.replace('%SIDE%', side(SIDE_KEY.get(name, name)).rstrip('\n')).replace('%SCRIPTS%', SCRIPTS.format(extra='').rstrip('\n')).rstrip('\n') + '\n<script src="v2-search.js"></script>\n'
    open(f'{name}.html', 'w', encoding='utf-8').write(html)
    print('built', name)
