# 07 吉祥物素材：清单、规格与提示词

> 决策 F1–F5 见 [`research/04-mac-native-and-mascot.md`](../research/04-mac-native-and-mascot.md) §4。角色定义以 [`03-visual-language.md` §7.1](03-visual-language.md#71-吉祥物藏狐-tibi提比) 为准。出图脚本 [`tools/gen-mascot.py`](../../tools/gen-mascot.py) 读的就是本文件里的提示词（`prompt:<id>` 注释块），改提示词只改这里。

## 1. 规格

| 项 | 规定 |
|---|---|
| 风格 | 软 3D 玩偶渲染：圆润、柔和的全局光、轻微毛绒质感、无硬描边；扁平 SVG 小狐狸只在应用内动态位置使用，二者同一角色 |
| 背景 | 透明（`background: transparent`），落地时由页面给底色；hero 系列例外，自带浅色场景 |
| 尺寸 | 生成 1024×1024 或 1536×1024，导出 PNG；交付时转 WebP（质量 85）并出 @1x / @2x 两档。下表的尺寸指 @2x，@1x 减半 |
| 命名 | `docs/prototypes/img/mascot/<id>.webp`（@1x）与 `<id>@2x.webp`，`<id>` 与下表一致；贴纸拆为 `sticker-1` … `sticker-6` |
| 颜色 | 见 [03 §7.1](03-visual-language.md#71-吉祥物藏狐-tibi提比) |
| 一致性 | 每张图都以 `ref-sheet` 为参考图；提示词开头固定一段角色描述（§2 的 CHARACTER） |
| 留白 | 主体占画面 60–70%，四周留白，便于裁切 |
| 文字 | 图内不出现任何文字或字母 |

### 1.1 怎么出图

实际出图走 Codex 命令行（ChatGPT 登录，不需要 API Key）：

```sh
python3 tools/gen-mascot.py --print <id> | …   # 拼出提示词（去掉 ===== 标题行），传给下一步的标准输入
codex exec --json --skip-git-repo-check -s read-only - -i docs/design/mascot/ref-sheet.png
```

产物在 `~/.codex/generated_images/<thread_id>/`。`tools/gen-mascot.py` 不带 `--print` 时直接调 Images API，是有 API Key 时的备用路径。

归档到 `docs/prototypes/img/mascot/` 时：

- 透明图的实际尺寸不一：先裁切，再居中到画布，主体最长边占 70%（`icon-face` 占 80%）。
- 贴纸：整张 3×2 按 1024×1024 生成（脚本没有单独给它定尺寸），按连通域切成 6 张，每张交付 512×512（@2x）、256×256（@1x）。所以下表写 512，脚本写 1024，两者不矛盾。
- WebP 用 `cwebp -q 85`。

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
| hero-morning | 预留未用（原计划首页 6:00–12:00） | 1536×1024 | 已出 |
| hero-day | 预留未用（原计划首页 12:00–18:00） | 1536×1024 | 已出 |
| hero-night | 预留未用（原计划首页 18:00–6:00） | 1536×1024 | 已出 |
| empty-library | 书架为空 | 1024×1024 | 应用已用 |
| empty-review | 没有到期卡片 | 1024×1024 | 应用已用 |
| empty-tasks | 运行记录为空 | 1024×1024 | 运行记录页已去掉（T35），应用里的图 2026-11-05 删掉 |
| empty-words | 生词本为空 | 1024×1024 | 应用已用 |
| empty-stats | 统计页还没有数据（R17） | 1024×1024 | 待出图；出图前统计空状态仍用 SVG |
| celebrate-review | 复习完成页 | 1024×1024 | 应用已用 |
| celebrate-streak | 连续学习 7 / 30 / 100 天当天的复习完成页 | 1024×1024 | 应用已用 |
| onboarding-hello | 预留未用（引导第 1 步 认识一下；引导页用 SVG 小狐狸） | 1024×1024 | 已出 |
| onboarding-test | 预留未用（校准词汇量，`#step=2`，不在引导主流程） | 1024×1024 | 已出 |
| onboarding-model | 预留未用（连接模型，`#step=3`，不在引导主流程） | 1024×1024 | 已出 |
| onboarding-read | 预留未用（引导第 2 步 读第一篇；引导页用 SVG 小狐狸） | 1024×1024 | 已出 |
| error-offline | 原型：首页失败态（模型不可用 / 离线）；应用：首页连不上 Core | 1024×1024 | 应用已用 |
| error-generic | 原型：首页失败态（出错了）；应用：复习、文章打不开 | 1024×1024 | 应用已用 |
| sticker-* | 贴纸（6 张：赞、笑、疑问、加油、睡、惊）。`sticker-1` 用在准确率 80% 以上的练习成绩页，其他未用；不放进 AI 的回答 | 512×512 | sticker-1 应用已用，其他已出 |
| about | 设置 → 关于（仅桌面端，手机端没有关于页） | 1024×1024 | 应用已用 |
| icon-face | 应用图标上层（Icon Composer），只有正脸 | 1024×1024 | 已出 |

<!-- prompt:hero-morning -->
CHARACTER sitting on a small stack of three books, holding a bright blue (#3b5bfd) open book, looking up at the viewer with the calm default expression, a tiny cup of coffee beside the books. Soft morning light from the left, warm and airy. Plain very light warm background (#fbfaf8) fading to white, no scene details other than the books and the cup. Wide composition with the character in the lower centre, generous empty space above. No text.
<!-- /prompt -->

<!-- prompt:hero-day -->
CHARACTER sitting cross-legged, reading the bright blue (#3b5bfd) book held in both paws, eyes scanning the page (reading expression), tail curled around. A couple of small floating pale-blue highlighter marks drifting up from the book like confetti. Neutral soft daylight, plain very light background (#fbfaf8). Wide composition, character lower centre, empty space above. No text.
<!-- /prompt -->

<!-- prompt:hero-night -->
CHARACTER curled up sleepily next to a small warm desk lamp, eyes half closed, one paw resting on the closed blue (#3b5bfd) book, a tiny "z" made of soft light (not a letter, a glowing wisp) rising. Dim cool background (#1b1b1e) with a warm pool of lamp light around the character. Wide composition, character lower centre. No text.
<!-- /prompt -->

> hero-night 注：提示词里的 "z" 会让模型画出字母。交付图是对生成结果局部模糊修图后的版本（`mascot/out/hero-night-retouched.png`），重出时要再修。

<!-- prompt:empty-library -->
CHARACTER standing in front of an empty, simple wooden bookshelf with three bare shelves, looking at the viewer with a hopeful expression, one paw gesturing at the shelf. Transparent background, character and shelf only, centred, 65% of the frame. No text.
<!-- /prompt -->

<!-- prompt:empty-review -->
CHARACTER lying on its back on a small pile of flashcards that are all neatly stacked and done, relaxed, happy closed-eye smile, one leg crossed over the other, tail wagging. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:empty-tasks -->
CHARACTER sitting at a tiny desk with nothing on it but one pencil, chin resting on both paws, patient waiting expression with half-lowered lids. Transparent background, centred. No text.
<!-- /prompt -->

<!-- prompt:empty-stats -->
CHARACTER sitting next to a small, blank bar chart with three empty bars, holding a pencil as if about to draw the first bar, curious and eager expression, ears up. Transparent background, centred. No text.
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
Only the head of CHARACTER, front view, perfectly centred, filling 80% of the square, calm default expression with half-lowered eyelids and a small confident smile, slight soft 3D volume, even frontal lighting, transparent background. Designed to sit on a flat deep indigo (#2f3fa8) rounded square app icon. No text, no body, no accessories.
<!-- /prompt -->

## 4. 3D（F3，排在 M5 后）

1. 用 `ref-sheet` 里的正面图（裁出、纯色背景）喂给 Meshy 的"卡通角色"模式或 Tripo 图生 3D，导出 GLB（带贴图，≤ 3 MB）。
2. 在 Blender 里只做三件事：修正脸部比例、给尾巴白尖补色、加一个 2 秒的待机呼吸动画（可选）。
3. 存 `docs/prototypes/img/mascot/tibi.glb`；引导页"认识一下"与关于页用 `<model-viewer auto-rotate camera-controls>` 懒加载；其他地方不用。
4. macOS 26 应用图标：Icon Composer，底层深靛蓝（`#2f3fa8`，与 logo 一致）圆角方块，上层 `icon-face`（或 3D 渲染的正脸），系统负责玻璃质感。

## 5. 落地到原型

SVG 小狐狸和插画不同框，每个位置只放一只：要跟着输入、思考、完成切换状态的位置用 SVG（首页、手机版首页、引导页；统计页空状态在 `empty-stats` 出图前暂用 SVG，R17 定为改用插画）；静态画面用插画（书架、复习、运行记录、生词本的空状态，复习完成页，首页失败态的 `error-generic` / `error-offline`，含 `mobile.html`）。未用的素材：`hero-*`、`onboarding-*`、`icon-face`、除 `sticker-1` 外的贴纸。

应用用的是 `apps/desktop/public/mascot/` 里的副本（只放状态列为“应用已用”的 9 张），改图后要同步过去；代码入口是 `components/Mascot.tsx`。首页有 SVG 小狐狸，所以书架空状态不放插画；连不上 Core 时显示 `error-offline`，同时隐藏小狐狸。

替换时更新 `03-visual-language.md` §7.2 与本文件状态列。
