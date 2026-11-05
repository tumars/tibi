// 由 scripts/build-samples.mjs 从 samples/*/ 生成，不要手改。
import type { SampleDef } from './samples.js';

export const SAMPLE_DEFS: SampleDef[] = [
  {"id":"peter-and-wendy","title":"Peter Pan","author":"J. M. Barrie","genre":"lit","kind":"book","source":"Peter and Wendy（1911）全本，正文据 Project Gutenberg 电子书 #16；插图为 F. D. Bedford 1911 年原版，取自 Wikimedia Commons（均为公有领域）","is_default":true,"order":1,"words":47274,"chapters":17, load: () => import('./samples/peter-and-wendy.gen.js').then(m => m.default) },
  {"id":"oliver-twist","title":"Oliver Twist","author":"Charles Dickens","genre":"lit","kind":"book","source":"Oliver Twist（1838）全本，正文与插图据 Project Gutenberg 电子书 #46675（George Cruikshank 原版插图，公有领域）","is_default":false,"order":2,"words":157966,"chapters":53, load: () => import('./samples/oliver-twist.gen.js').then(m => m.default) },
  {"id":"how-a-compiler-sees-your-code","title":"How a Compiler Sees Your Code","author":"Tibi","genre":"tech","kind":"article","source":"Tibi 自拟示例（MIT）","is_default":false,"order":3,"words":818, load: () => import('./samples/how-a-compiler-sees-your-code.gen.js').then(m => m.default) },
  {"id":"why-cities-are-getting-hotter","title":"Why Cities Are Getting Hotter","author":"Tibi","genre":"news","kind":"article","source":"Tibi 自拟示例（MIT）","is_default":false,"order":4,"words":537, load: () => import('./samples/why-cities-are-getting-hotter.gen.js').then(m => m.default) },
];
