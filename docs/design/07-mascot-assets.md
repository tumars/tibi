# 07 吉祥物素材：清单、规格与提示词

> 决策 F1–F4 见 [`research/04-mac-native-and-mascot.md`](../research/04-mac-native-and-mascot.md) §4。角色定义以 [`03-visual-language.md` §7.1](03-visual-language.md#71-吉祥物藏狐-tibi缇比) 为准。出图脚本 [`tools/gen-mascot.py`](../../tools/gen-mascot.py) 读的就是本文件里的提示词（`prompt:<id>` 注释块），改提示词只改这里。

## 1. 规格

| 项 | 规定 |
|---|---|
| 风格 | 软 3D 玩偶渲染：圆润、柔和的全局光、轻微毛绒质感、无硬描边；扁平 SVG 小狐狸只在应用内动态位置使用，二者同一角色 |
| 背景 | 透明（`background: transparent`），落地时由页面给底色；hero 系列例外，自带浅色场景 |
| 尺寸 | 生成 1024×1024 或 1536×1024，导出 PNG；交付时转 WebP（质量 85）并出 @1x / @2x 两档 |
| 命名 | `docs/prototypes/img/mascot/<id>.webp`，`<id>` 与下表一致 |
| 颜色 | 毛色 `#f5a043`、深橙 `#e3842a`、脸颊与肚子 `#fff4e2`、体侧灰 `#cfc3b4`、耳内 `#ffc7a6`、腮红 `#ff8f7d`、五官 `#2b1f17`、书本 `#3b5bfd` |
| 一致性 | 每张图都以 `ref-sheet` 为参考图；提示词开头固定一段角色描述（§2 的 CHARACTER） |
| 留白 | 主体占画面 60–70%，四周留白，便于裁切 |
| 文字 | 图内不出现任何文字或字母 |

## 2. 角色设定图（先做这一张）

<!-- prompt:character -->
CHARACTER: Tibi, a Tibetan fox mascot. Round, plump one-piece body with a big head and a small body (Duolingo-like proportions, but an original design). Wide, square-ish flat face with pale cream square "jaw" cheeks, half-lowered upper eyelids giving a calm, deadpan look, big round eyes with large dark pupils and a white highlight, small dark brown nose and mouth, soft pink blush. Saturated warm orange fur (#f5a043) with darker orange (#e3842a) feet, paws and eyelid lines, cream (#fff4e2) cheeks and belly, soft grey (#cfc3b4) sides, peach (#ffc7a6) inner ears, a fluffy tail with a white tip. Stubby legs, tiny paws. Soft 3D toy render: rounded forms, gentle global illumination, subtle plush/felt texture, no hard outlines, no gradients that look painted. Friendly, cute, slightly smug.
<!-- /prompt -->

<!-- prompt:ref-sheet -->
Character reference sheet of CHARACTER on a plain light grey (#f2f2f1) background. Three full-body views side by side: front, three-quarter, side profile, all standing in a neutral relaxed pose. Below them a row of six head-only expressions: calm (default, half-lowered lids), listening (eyes wide, ears up), thinking (head tilted, eyes up-right), happy (closed smiling eyes, open mouth, tongue), sleeping (eyes closed), surprised (round eyes, small pupils, ears straight up). Consistent lighting, consistent proportions, orthographic feel, evenly spaced, no text, no labels, no arrows.
<!-- /prompt -->

> 定稿后保存为 `docs/design/mascot/ref-sheet.png`。后面每张图都附它做参考。

## 3. 素材清单与提示词

每条前面固定加上 §2 的 CHARACTER 段，再附参考图。`用在哪` 对应原型页面。

| id | 用在哪 | 尺寸 | 状态 |
|---|---|---|---|
| hero-morning | 首页标题上方，6:00–12:00 | 1536×1024 | 待出 |
| hero-day | 首页，12:00–18:00 | 1536×1024 | 待出 |
| hero-night | 首页，18:00–6:00（23 点后用 sleeping） | 1536×1024 | 待出 |
| empty-library | 书架为空 | 1024×1024 | 待出 |
| empty-review | 没有到期卡片 | 1024×1024 | 待出 |
| empty-tasks | 任务中心为空 | 1024×1024 | 待出 |
| empty-words | 生词本为空 | 1024×1024 | 待出 |
| celebrate-review | 复习完成页 | 1024×1024 | 待出 |
| celebrate-streak | 连续学习 7 / 30 / 100 天 | 1024×1024 | 待出 |
| onboarding-hello | 引导第 1 步 认识一下 | 1024×1024 | 待出 |
| onboarding-test | 引导第 2 步 词汇量测试 | 1024×1024 | 待出 |
| onboarding-model | 引导第 3 步 连接模型 | 1024×1024 | 待出 |
| onboarding-read | 引导第 4 步 读第一篇 | 1024×1024 | 待出 |
| error-offline | 模型不可用 / 离线 | 1024×1024 | 待出 |
| error-generic | 出错了 | 1024×1024 | 待出 |
| sticker-* | 对话里的贴纸反应（6 张：赞、笑、疑问、加油、睡、惊） | 512×512 | 待出 |
| about | 关于页 | 1024×1024 | 待出 |
| icon-face | 应用图标上层（Icon Composer），只有正脸 | 1024×1024 | 待出 |

<!-- prompt:hero-morning -->
CHARACTER sitting on a small stack of three books, holding a bright blue (#3b5bfd) open book, looking up at the viewer with the calm default expression, a tiny cup of coffee beside the books. Soft morning light from the left, warm and airy. Plain very light warm background (#fbfaf8) fading to white, no scene details other than the books and the cup. Wide composition with the character in the lower centre, generous empty space above. No text.
<!-- /prompt -->

<!-- prompt:hero-day -->
CHARACTER sitting cross-legged, reading the bright blue (#3b5bfd) book held in both paws, eyes scanning the page (reading expression), tail curled around. A couple of small floating pale-blue highlighter marks drifting up from the book like confetti. Neutral soft daylight, plain very light background (#fbfaf8). Wide composition, character lower centre, empty space above. No text.
<!-- /prompt -->

<!-- prompt:hero-night -->
CHARACTER curled up sleepily next to a small warm desk lamp, eyes half closed, one paw resting on the closed blue (#3b5bfd) book, a tiny "z" made of soft light (not a letter, a glowing wisp) rising. Dim cool background (#1b1b1e) with a warm pool of lamp light around the character. Wide composition, character lower centre. No text.
<!-- /prompt -->

<!-- prompt:empty-library -->
CHARACTER standing in front of an empty, simple wooden bookshelf with three bare shelves, looking at the viewer with a hopeful expression, one paw gesturing at the shelf. Transparent background, character and shelf only, centred, 65% of the frame. No text.
<!-- /prompt -->

<!-- prompt:empty-review -->
CHARACTER lying on its back on a small pile of flashcards that are all neatly stacked and done, relaxed, happy closed-eye smile, one leg crossed over the other, tail wagging. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:empty-tasks -->
CHARACTER sitting at a tiny desk with nothing on it but one pencil, chin resting on both paws, patient waiting expression with half-lowered lids. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:empty-words -->
CHARACTER holding an empty glass jar up to one eye like a magnifying glass, curious expression, ears up. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:celebrate-review -->
CHARACTER jumping mid-air with both paws up, happy expression (closed smiling eyes, open mouth, tongue out), blush stronger, tail fluffed, surrounded by a few small soft 3D stars in blue (#3b5bfd) and warm orange (#f5a043) and two or three pale confetti pieces. Transparent background, centred, dynamic but balanced. No text.
<!-- /prompt -->

<!-- prompt:celebrate-streak -->
CHARACTER proudly holding up a small round medal on a ribbon, the medal is warm orange with a blue ribbon, chest out, confident smug smile, one eye slightly closed. A faint glowing ring of light behind the character. Transparent background, centred. No text, no numbers on the medal.
<!-- /prompt -->

<!-- prompt:onboarding-hello -->
CHARACTER waving one paw at the viewer with a warm friendly expression, slightly leaning forward, tail up, standing on nothing. Transparent background, centred, 60% of frame. No text.
<!-- /prompt -->

<!-- prompt:onboarding-test -->
CHARACTER wearing tiny round glasses, holding a clipboard with blank lines (no text), thinking expression with head tilted and eyes up-right, a pencil tucked behind one ear. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:onboarding-model -->
CHARACTER plugging a short rounded cable into a small glowing blue (#3b5bfd) cube that floats at paw height, surprised-happy expression as the cube lights up, soft blue glow on the character's face. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:onboarding-read -->
CHARACTER opening the bright blue (#3b5bfd) book for the first time with both paws, eyes wide with delight, a soft light coming out of the pages onto the face. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:error-offline -->
CHARACTER holding a short cable whose end is unplugged, looking at the loose plug with a puzzled expression, ears slightly down, a tiny grey cloud above the head. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:error-generic -->
CHARACTER sitting among three fallen books with one book balanced on its head, surprised expression (round eyes, small pupils), ears straight up. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:sticker -->
A set of six round sticker-style head-and-shoulders portraits of CHARACTER arranged in a 3×2 grid on a transparent background, each with a thin white sticker border: 1 thumbs up with a wink, 2 laughing with closed eyes, 3 puzzled with one raised brow and a small question-mark-shaped wisp (no actual glyph), 4 cheering with both paws up, 5 sleepy with eyes closed and a small bubble, 6 shocked with round eyes. Evenly spaced, same scale, no text.
<!-- /prompt -->

<!-- prompt:about -->
CHARACTER sitting in a tiny cosy reading nook: a round cushion, a short stack of books with one bright blue (#3b5bfd) book on top, a small plant, a warm lamp. Calm reading expression. Soft warm light, plain light background (#fbfaf8). Square composition, character centred. No text.
<!-- /prompt -->

<!-- prompt:icon-face -->
Only the head of CHARACTER, front view, perfectly centred, filling 80% of the square, calm default expression with half-lowered eyelids and a small confident smile, slight soft 3D volume, even frontal lighting, transparent background. Designed to sit on a flat blue (#3b5bfd) rounded square app icon. No text, no body, no accessories.
<!-- /prompt -->

## 4. 3D（F3，排在 M5 后）

1. 用 `ref-sheet` 里的正面图（裁出、纯色背景）喂给 Meshy 的"卡通角色"模式或 Tripo 图生 3D，导出 GLB（带贴图，≤ 3 MB）。
2. 在 Blender 里只做三件事：修正脸部比例、给尾巴白尖补色、加一个 2 秒的待机呼吸动画（可选）。
3. 存 `docs/prototypes/img/mascot/tibi.glb`；引导页"认识一下"与关于页用 `<model-viewer auto-rotate camera-controls>` 懒加载；其他地方不用。
4. macOS 26 应用图标：Icon Composer，底层电光蓝圆角方块，上层 `icon-face`（或 3D 渲染的正脸），系统负责玻璃质感。

## 5. 落地到原型

出图后替换：首页 `#heroFox`（SVG 小狐狸保留，插画放在它后面或替换为插画 + 小狐狸贴纸）、四个空状态、复习完成页、引导四步、`mobile.html` 对应位置。替换时更新 `03-visual-language.md` §7.2 与本文件状态列。
