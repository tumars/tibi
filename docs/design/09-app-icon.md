# Tibi 应用图标：斜着探头

## 当前使用：格桑花发卡

当前背景采用蓝紫到深靛蓝的柔和对角渐变：左上目标色 `#7487DD`，经 `#526BCD`、`#394FAE` 向右下 `#293D91` 过渡，保留原蓝色方向但减弱纯亮蓝的刺激感。平台垫底色改为 `#394FAE`。灰紫蓝纯色方案已被用户否定；角色、发卡与构图保持。

渐变版由内置 imagegen 生成并重新生成平台图标，提示词：

```text
Edit ONLY the background of this Tibi app icon. Replace the dull grey background with a beautiful clear BLUE-to-INDIGO gradient, returning to a vivid blue identity but gentler than electric ultramarine. Design a smooth diagonal gradient: upper left soft luminous periwinkle blue #7487DD, upper middle cornflower blue #526BCD, upper right rich indigo blue #394FAE, lower right deep indigo #293D91. Smooth broad color transitions visible across the open space above the ears, elegant gentle depth, not muddy, not neon, not grey. No texture, no clouds, no shapes, no light rays, no stars, no halo outlining the fox. The lighter upper-left blue harmonizes with pink flower and the deeper right blue contrasts with orange ear. Preserve entire fox and hair clip exactly: head height, size, tilt, ear silhouette, eyes, expression, fur color and texture, pink flower placement on upper left ear rim, gold clasp, and bottom crop. Do not relight or recolor character. One square full bleed finished app icon, no frame or text.
```

历史灰紫蓝纯色版使用内置 imagegen，提示词：

```text
Precise background color edit ONLY. Replace the saturated electric blue background of this Tibi icon with a uniform muted low-saturation slate lavender blue, target hex #555970 (RGB 85,89,112). Matte nearly flat solid background, no bright blue glow, no luminous gradient, no vignette. Preserve the entire fox and flower hair clip unchanged: exact head position, scale, tilt, crop, orange and cream fur colors and texture, ears, eye shape, expression, smile, pink cosmos petals, golden center and tiny gold clasp on viewer-left upper ear rim. Do not recolor or desaturate the character. Only the exposed background changes. Clean natural fur edges against new muted background. Single full-bleed square app icon with no frame, no text and no new elements.
```

最新构图调整：发卡移至画面左耳内侧上缘，上部花瓣略微超出耳朵轮廓，卡扣与下部花瓣仍贴着毛发。保持头部位置和表情，不增加装饰。以下耳根位置为前一轮记录。

本轮由内置 imagegen 编辑，最终提示词：

```text
Precise localized edit of this Tibi icon: ONLY reposition the existing pink cosmos/gesang flower hair clip. Remove flower and gold clasp from current location on forehead and restore orange fur. Move the SAME flower clip UP to the upper inner rim of the ear on viewer's LEFT, near the valley between ears: flower center about x=33%, y=32% of full square, diameter about 17% of square. Lower petals and small gold clasp must overlap and visibly attach to orange ear fur along its upper-right sloping edge; upper petals extend into blue negative space above that edge. This is a wearable flower barrette clipped onto ear fur, never floating, no stem or leaf. Keep identical pink petals, golden yellow center, subtle gold clasp and soft 3D style. CRITICAL: leave fox head height, scale, tilt, silhouette, ears, eyes, eyebrows, expression, mouth, fur colors, bottom crop and blue background EXACTLY unchanged. Do not lift or enlarge head. No new objects, no text, no glow, no frame. One full bleed square app icon.
```

母图：[`app-icon.png`](../../apps/desktop/public/app-icon.png)。去掉从头顶长出的花茎与叶片，改为画面左侧耳根旁的粉色格桑花发卡，花朵贴着毛发，露出少量金色卡扣。保持头部高度、歪头表情与配色。下方头顶生花和灯泡均为已放弃的历史方案。

使用内置 imagegen 编辑；平台资源通过 `pnpm --filter @tibi/desktop icons` 重新生成。已检查生成后的桌面图标，未做真机安装验证。

最终编辑提示词：

```text
Precise accessory edit to this Tibi app icon. Remove the entire flower growing from the middle of the head, including ALL green stem and leaf; restore clean blue background and uninterrupted orange fur there. Replace with ONE small pink gesang/cosmos FLOWER HAIR CLIP worn against the fur at the base of the ear on the viewer's left. Center the blossom approximately x=27%, y=43% of canvas, nestled where the left ear meets the forehead. Blossom is about 16% of canvas width, eight broad pink softly notched petals and a small golden yellow center, slightly angled to lie against the curved head. A tiny simple pale gold barrette peeks out behind the flower sideways, visibly indicating a wearable hair accessory. Subtle contact shadow anchors the flower against orange fur. No stem, no leaves, no growth out of the head, no floating flower. Preserve original fox head height, size, tilt, ears, eyes, face, expression, fur, colors, bottom crop and deep blue backdrop exactly. Same soft sculpted 3D style. No text, no lightbulb, no extra props. One full bleed square icon.
```

## 历史方案：头顶格桑花（已放弃）

母图：[`app-icon.png`](../../apps/desktop/public/app-icon.png)。用户否定灯泡，改为脑袋上长出一朵格桑花。保留原有头部高度、歪头表情、暖橙主体与深蓝底；两耳之间长出短而微弯的绿色花茎，配一朵粉色格桑花、黄色花心与一片小叶。已去掉灯泡及光线。以下灯泡方案均为历史记录，不再使用。

使用内置 imagegen 编辑母图，再运行 `pnpm --filter @tibi/desktop icons` 生成平台资源。已检查母图和桌面圆角图标；未进行真机安装验证。

本轮最终提示词：

```text
Precise edit of this Tibi app icon. Remove the yellow lightbulb, its base, glow and both rays completely. Replace it with ONE small pink Tibetan gesang flower (cosmos-like blossom) growing naturally out of the crown of the fox's head between the ears. A short slender gently curved green stem visibly emerges from the orange fur at the crown around x=48%, y=36%. The stem grows upward with a gentle leftward lean and supports one simple open blossom around x=43%, y=22%, facing mostly toward viewer: eight broad soft pink petals with delicately notched tips, a small golden yellow center, perhaps one tiny green leaf on the short stem. Blossom diameter around 15 percent canvas width. Charming soft sculpted 3D material matching the fox; clear simple flower silhouette, not photorealistic botanical complexity. Flower is attached and growing from the head, not floating, not a hair clip, no pot. Keep the original fox head position, height, scale, tilt, ears, eyes, expression, smile, fur and bottom crop unchanged. Preserve saturated deep blue background and warm orange/cream fox. No lightbulb, no light rays, no sparkles, no text, no page, no other props, no frame. One full bleed square app icon.
```

## 历史方案：探头与灯泡（已放弃）

最新位置修订：灯泡从左上留白移至两耳之间、紧靠头顶，向左倾斜约 30°，灯座朝右下，形成从脑袋冒出灵感的关系。保持头部高度与大小。下文左上灯泡描述及其提示词为上一轮记录，以本修订为准。

本轮使用内置 imagegen，编辑提示词：

```text
Precise edit of this app icon: change ONLY the position and rotation of the existing yellow lightbulb and its two small rays. Remove it completely from its current upper-left floating position, restoring that area to blue. Place the same bulb directly above the crown of the fox's head BETWEEN the two ears, close to the orange forehead, tilted 30 degrees counterclockwise (glass globe toward upper-left, screw base toward lower-right). Bulb center roughly x=45%, y=27% of square; screw base roughly x=50%, y=34%, nearly touching the top of the orange head at x=50%, y=36%, with only a tiny blue gap. It should feel like a tilted idea bulb sprouting just above the head, not an unrelated floating decoration in the corner. Keep its small size and soft warm glow, relocate the two short rays with it. Keep ALL fox pixels/appearance, head height, scale, tilt, eyes, mouth, ears, fur, bottom crop and blue background unchanged. No extra objects, no text. Single square full bleed icon.
```

正式母图：[`app-icon.png`](../../apps/desktop/public/app-icon.png)。用户选择使用探头图标，随后否定头部上移方案，要求恢复 v3 高度并在顶部添加灯泡。当前保留 v3 的位置、大小和表情，在左上留白处增加一颗暖黄色小灯泡，表达理解与灵感；不再使用书页。由内置 imagegen 编辑生成。

应用打包图标通过 `pnpm --filter @tibi/desktop icons` 从该 PNG 生成；桌面使用圆角裁切与透明外边距，iOS 使用满版图，Android 使用完整图作为前景。界面 SVG Logo 仍独立使用。已运行图标生成；尚未验证真机系统裁切与已安装应用的图标缓存。

最终编辑提示词：

```text
Edit this exact Tibi icon by adding ONLY one small charming lightbulb in the empty blue area above the fox toward the upper left, centered approximately x=28%, y=15% of square. Keep the fox head's position, size, tilt, facial expression and crop EXACTLY unchanged: do not move it upward or enlarge it. The bulb should occupy about 13% of canvas width and 17% height, with sufficient blue separation from both ears. A simple warm buttery yellow frosted bulb with a tiny cream/gold base, softly sculpted 3D matching the fox, clearly recognizable rounded lightbulb silhouette, a very subtle warm glow and at most two short small light rays. It conveys a little moment of understanding, secondary to the face. Preserve original saturated indigo blue background and orange/cream/grey fox with half-lidded calm knowing eyes. No book, no page, no text, no other decorations, no frame. Output single full bleed square app icon.
```

## 历史提案 v3：去掉书页

用户反馈：底部看不出是书页，没有必要使用书页。取消用书页和荧光标记表达功能的方案，直接通过角色与画布边缘的关系形成探头动作。

当前原图：[`mascot/icon-peek-v3.png`](mascot/icon-peek-v3.png)。保留暖橙与深蓝对比、歪头和淡定表情，头部下移，下巴由画布底边自然裁切；去掉全部前景挡板、阅读线与黄色标记。使用内置 imagegen 编辑 v2，已检查上述元素移除。仍为设计提案，未替换打包图标，平台适配与小尺寸验收待完成。

v3 最终编辑提示词：

```text
Edit this Tibi app icon. Remove the entire ivory foreground page, both blue strokes and yellow highlight completely. No book, no page, no foreground panel, no accessories, no symbols. Retain the same charming Tibetan fox identity, broad cream square cheeks, orange fur, grey cheek edges, dark brown half-lidded eyes and tiny knowing smile, same soft 3D style and saturated deep indigo blue background. Recompose the head so it peeks diagonally into the square canvas from the bottom edge: move the tilted head down so the bottom canvas boundary itself crops the lower cheeks/chin, both eyes and nose and small smile remain visible, ears comfortably inside the top boundary with some blue breathing room. Large closeup face, slightly off centre, tilted about 12 degrees, bold and simple silhouette. The entire background is uninterrupted indigo, no artificial diagonal divider. Single full bleed square app icon, no rounded external frame, no margins, no text, no mockup. Preserve the personality and warm orange versus blue contrast of the source.
```

## 历史提案 v2：书页（已放弃）

> 2026-11-02 设计提案。原图：[`mascot/icon-reading-v2.png`](mascot/icon-reading-v2.png)。尚未替换应用打包图标和界面 Logo。

## 设计意图

Icon 优先承担吸引注意、快速识别与传递产品感受的任务。Tibi 是有性格的阅读伙伴，因此以藏狐表情为主体，以书页与荧光标记传递阅读、生词学习功能。

- **主体**：保留藏狐宽方脸、奶油色脸颊、灰色侧毛和淡定的半垂眼神；只展示头部，去除身体与额外配饰。
- **构图**：头部倾斜，靠近画布边缘；下方斜向书页遮住部分下巴，形成探头陪读的动作。
- **对比**：暖橙色主体与深靛蓝背景形成冷暖对比；奶油白书页承载两道阅读线，其中一道使用荧光黄标记。
- **质感**：柔和立体体积与接触阴影。此稿仍有细微绒毛纹理，后续若缩小后显杂，应优先简化材质。
- **边界**：本稿是满版方形设计母图。正式接入需沿用平台规则：macOS 留透明外边距，iOS 由系统裁圆角，Android 单独考虑自适应安全区域；不能直接用满版方图替换所有平台图标。

## 生成记录

使用内置 imagegen，以 `mascot/ref-sheet.png` 作为角色身份参考。此次只新增设计资产，不变更现有 SVG Logo 或图标生成脚本。

最终提示词：

```text
Use case: stylized-concept. Create one finished square app icon for Tibi, an AI English reading companion. Reference image is CHARACTER IDENTITY only, not composition. Preserve this Tibetan fox's broad square cream cheeks, orange head, small pointed ears, grey cheek edges, dark brown almost fully dark eyes with gently half lowered straight upper lids, tiny nose, calm knowing friendly expression. Design an attractive bold app icon, not a logo and not a presentation board. Full bleed rich deep cobalt/indigo #2f3fa8 square background, no external margin, no pre-rounded corners. Extreme closeup of the fox peeking diagonally over a single oversized ivory book page entering from the bottom; head tilted 12 degrees, slightly off centre, ears and upper face dominate, bottom cheek/chin partly hidden by the diagonal page, no torso, no paws. Head fills roughly 80 percent width. Page is a simple foreground diagonal occupying only bottom 22 percent, with two short thick indigo reading strokes and ONE fluorescent yellow highlight behind one stroke, no letters. Strong orange #f5a043 and creamy white #fff4e2 versus cobalt contrast. Charming premium softly sculpted 3D illustration with matte smooth toy-like material, simplified large shapes, subtle crisp contact shadow separating fox from page and backdrop. Keep Tibetan fox square face, avoid generic pointy long-muzzle fox, avoid dense fur texture. Clear bold silhouette and large expressive eyes readable at 32px. Composition feels like a clever little reading friend peeking out of the app canvas. No text, no lettering, no stars, no sparkles, no accessories, no extra objects, no mockup, no device, no watermark. Output just the single square icon.
```

已检查生成图的角色、配色与构图；尚未完成真实 Dock 和移动端小尺寸验收。
