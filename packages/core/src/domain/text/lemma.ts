import type { Dict } from '../../dict/types.js';

/**
 * 词形还原：先查词典的 lemma_map（ECDICT exchange 展开），查不到再用保守的规则。
 * 规则宁可不还原也不要还错（bus → bu、this → thi 这类）。
 */

const CONTRACTIONS: Record<string, string> = { "n't": 'not', "'ll": 'will', "'re": 'be', "'ve": 'have', "'d": 'would', "'m": 'be' };
const IRREGULAR: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have', does: 'do', did: 'do', done: 'do', doing: 'do',
  went: 'go', gone: 'go', goes: 'go', going: 'go', made: 'make', making: 'make', said: 'say', saying: 'say', says: 'say',
  took: 'take', taken: 'take', taking: 'take', came: 'come', coming: 'come', got: 'get', gotten: 'get', getting: 'get',
  saw: 'see', seen: 'see', seeing: 'see', knew: 'know', known: 'know', thought: 'think', found: 'find', gave: 'give', given: 'give', giving: 'give',
  told: 'tell', became: 'become', left: 'leave', felt: 'feel', brought: 'bring', began: 'begin', begun: 'begin', beginning: 'begin', kept: 'keep',
  held: 'hold', wrote: 'write', written: 'write', writing: 'write', stood: 'stand', heard: 'hear', let: 'let', meant: 'mean', met: 'meet', ran: 'run', running: 'run',
  paid: 'pay', sat: 'sit', spoke: 'speak', spoken: 'speak', lay: 'lie', led: 'lead', read: 'read', grew: 'grow', grown: 'grow', lost: 'lose', fell: 'fall', fallen: 'fall',
  sent: 'send', built: 'build', understood: 'understand', drew: 'draw', drawn: 'draw', broke: 'break', broken: 'break', spent: 'spend', cut: 'cut', rose: 'rise', risen: 'rise',
  drove: 'drive', driven: 'drive', bought: 'buy', wore: 'wear', worn: 'wear', chose: 'choose', chosen: 'choose', ate: 'eat', eaten: 'eat', threw: 'throw', thrown: 'throw',
  caught: 'catch', taught: 'teach', sold: 'sell', fought: 'fight', won: 'win', forgot: 'forget', forgotten: 'forget', hid: 'hide', hidden: 'hide', shook: 'shake', shaken: 'shake',
  children: 'child', men: 'man', women: 'woman', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose', lives: 'life', leaves: 'leaf', wolves: 'wolf', knives: 'knife', halves: 'half', wives: 'wife',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad', more: 'many', most: 'many', less: 'little', least: 'little', further: 'far', farther: 'far',
  these: 'this', those: 'that', an: 'a',
};
// 以 s 结尾但本身就是原形的常见词，避免被当复数
const S_WORDS = new Set(['this', 'his', 'is', 'was', 'has', 'bus', 'yes', 'us', 'thus', 'plus', 'gas', 'virus', 'bonus', 'campus', 'status', 'focus', 'basis', 'crisis', 'analysis', 'always', 'perhaps', 'news', 'series', 'species', 'means', 'physics', 'mathematics', 'politics', 'economics', 'lens', 'chaos', 'canvas', 'atlas', 'class', 'glass', 'pass', 'mass', 'less', 'unless', 'across', 'process', 'access', 'address', 'business', 'kiss', 'boss', 'loss', 'cross', 'dress', 'press', 'stress', 'success', 'express', 'discuss', 'miss', 'grass', 'its', 'ours', 'yours', 'hers', 'theirs', 'whereas', 'towards', 'besides', 'sometimes', 'as', 'iris', 'oasis', 'thesis', 'axis', 'dis']);
const ED_WORDS = new Set(['need', 'feed', 'seed', 'bleed', 'speed', 'breed', 'succeed', 'proceed', 'exceed', 'indeed', 'red', 'bed', 'wed', 'shed', 'fed', 'led', 'embed', 'hundred', 'sacred', 'naked', 'wicked', 'rugged', 'wretched', 'beloved', 'aged', 'blessed', 'crooked', 'learned', 'ragged', 'hatred', 'kindred', 'shred', 'sled', 'shed']);
const ING_WORDS = new Set(['thing', 'king', 'ring', 'sing', 'bring', 'spring', 'string', 'wing', 'swing', 'sting', 'cling', 'fling', 'sling', 'wring', 'during', 'morning', 'evening', 'nothing', 'something', 'anything', 'everything', 'ceiling', 'building', 'being', 'meaning', 'feeling', 'wedding', 'pudding', 'herring', 'darling', 'sibling', 'duckling', 'ping', 'ding']);

/** 去掉 -ed / -ing 后补回原形：双写辅音去一个（stop），短词 CVC 补 e（make、move），常见词尾补 e（create） */
function restoreStem(stem: string): string {
  const dd = dedupeDouble(stem);
  if (dd !== stem) return dd;
  if (stem.length === 2 && /[aeiou][^aeiou]$/.test(stem)) return stem + 'e';            // us → use
  if (stem.length <= 4 && /[^aeiou][aeiou][^aeiouwxy]$/.test(stem)) return stem + 'e';   // mak → make，但 walk 不动
  if (stem.length >= 5 && /(eat|at|iz|is|iv|uc|us|ar|ag|or|ir|ov|ut|id|as|ak|et|ib|ol|ac|ic|ad|ur|ud|ot|ul|ap|ip|op|ub|ab|ob|ok|ik)$/.test(stem) && !/(it|ent|ant|ist|ast|ult|ect|ort|int|ount|ept|ck|ff|ss|ll|ng|sh|ch|th|rt|lt|nt|mp|nd|ld|rd|st|sk|lk|rk|lp|lm|rm|rn|wn|ln)$/.test(stem)) return stem + 'e';
  return stem;
}

function dedupeDouble(stem: string): string {
  // stopped → stop, running → run；但 falling → fall（ll 保留）、passing → pass
  if (/([bdgklmnprtvz])\1$/.test(stem) && !/(ll|ss|zz|ff)$/.test(stem)) return stem.slice(0, -1);
  return stem;
}

/** 纯规则还原（没有词典时的退路） */
export function ruleLemma(form: string): string {
  const w = form.toLowerCase();
  for (const [suf, base] of Object.entries(CONTRACTIONS)) if (w.endsWith(suf)) return base;
  if (IRREGULAR[w]) return IRREGULAR[w]!;
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ier') || w.endsWith('iest')) return w.replace(/i(er|est)$/, 'y');
  if (w.endsWith('ing') && !ING_WORDS.has(w) && w.length > 5) {
    const stem = w.slice(0, -3);
    if (!/[aeiou]/.test(stem)) return w;
    return restoreStem(stem);
  }
  if (w.endsWith('ed') && !ED_WORDS.has(w) && w.length > 3) {
    const stem = w.slice(0, -2);
    if (w.endsWith('eed')) return w.slice(0, -1);                      // agreed → agree
    return restoreStem(stem);
  }
  if (w.endsWith('est') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('er') && w.length > 5 && /[aeiou]/.test(w.slice(0, -2))) {
    // 比较级 bigger → big；但 writer / computer 这类名词不动（保守：只处理双写）
    const stem = w.slice(0, -2); const dd = dedupeDouble(stem); if (dd !== stem) return dd;
    return w;
  }
  if (w.endsWith('s') && !w.endsWith('ss') && !S_WORDS.has(w)) {
    if (/(ches|shes|sses|xes|zes|oes)$/.test(w) && w.length > 4) return /oes$/.test(w) && !/^(does|goes)$/.test(w) ? w.slice(0, -2) : w.slice(0, -2);
    if (/[^aeiou]es$/.test(w) && w.length > 4 && /(ves)$/.test(w)) return w.slice(0, -3) + 'f';
    return w.slice(0, -1);
  }
  return w;
}

/**
 * 词形还原：词典优先。形参 form 已做过大小写处理（见 tokenize.normalizeCase）。
 * 返回原形；如果词典里本身就有这个词（它自己是词头），优先当原形（left 既是 leave 的过去式也是词头）——
 * 这类歧义按 lemma_map 的 rank 取第一个，rank 0 表示"自己就是原形"。
 */
export async function lemmatize(form: string, dict: Dict): Promise<string> {
  const w = form.toLowerCase();
  if (!/^[a-z]/.test(w)) return form;
  const fromDict = await dict.lemmas(w);
  if (fromDict.length === 1) return fromDict[0]!;
  if (fromDict.length > 1) {
    // 多个候选（was → was / be）：取有词频且最常见的那个；都没有词频时按词典给的顺序
    const ranks = await Promise.all(fromDict.map(l => dict.frequencyRank(l)));
    let best = -1;
    ranks.forEach((r, i) => { if (r && (best < 0 || r < ranks[best]!)) best = i; });
    return fromDict[best >= 0 ? best : 0]!;
  }
  return ruleLemma(w);
}

/** 批量还原：先查词典一轮，剩下用规则 */
export async function lemmatizeAll(forms: string[], dict: Dict): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(forms)];
  await Promise.all(uniq.map(async f => { out.set(f, await lemmatize(f, dict)); }));
  return out;
}
