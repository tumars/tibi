/**
 * 词汇量测试（00 §3.9，R8）没有词典时用的内置词表：按词频段各 ≥ 20 个候选，加一份伪词。
 * 有 ECDICT 时按 frq 区间随机取，这里只是兜底。
 */
export const BANDS: { label: string; lo: number; hi: number; real: number }[] = [
  { label: '前 1k', lo: 0, hi: 1000, real: 8 },
  { label: '1–2k', lo: 1000, hi: 2000, real: 8 },
  { label: '2–4k', lo: 2000, hi: 4000, real: 8 },
  { label: '4–6k', lo: 4000, hi: 6000, real: 10 },
  { label: '6–8k', lo: 6000, hi: 8000, real: 10 },
  { label: '8–10k', lo: 8000, hi: 10000, real: 10 },
  { label: '10k+', lo: 10000, hi: 12000, real: 8 },
];
export const PSEUDO_PER_BAND = 2;

export const BUILTIN_WORDS: string[][] = [
  ['house', 'water', 'people', 'think', 'because', 'always', 'morning', 'family', 'answer', 'change', 'money', 'school', 'story', 'between', 'light', 'friend', 'question', 'window', 'remember', 'country', 'enough', 'without'],
  ['improve', 'weather', 'journey', 'manage', 'ordinary', 'suggest', 'surface', 'patient', 'describe', 'advantage', 'purpose', 'treatment', 'reduce', 'quarter', 'favorite', 'explain', 'measure', 'generation', 'attract', 'independent', 'frequent', 'recognize'],
  ['embrace', 'hesitate', 'tremendous', 'abandon', 'reluctant', 'conceal', 'tolerate', 'accumulate', 'vanish', 'curious', 'prosper', 'estimate', 'ambition', 'inherit', 'wander', 'precise', 'thrive', 'moderate', 'persuade', 'fragile', 'remedy', 'ridiculous'],
  ['ambiguous', 'pragmatic', 'eloquent', 'scrutiny', 'diligent', 'notorious', 'meticulous', 'coherent', 'retrieve', 'subtle', 'indulge', 'plausible', 'benevolent', 'tedious', 'intricate', 'curtail', 'superficial', 'vigorous', 'candid', 'austere', 'lucid', 'ominous'],
  ['ephemeral', 'ubiquitous', 'laconic', 'obstinate', 'verbose', 'pernicious', 'cursory', 'disparate', 'equanimity', 'garrulous', 'impetuous', 'juxtapose', 'languid', 'magnanimous', 'nonchalant', 'obsequious', 'perfunctory', 'quixotic', 'recalcitrant', 'sanguine', 'taciturn', 'vacillate'],
  ['abstruse', 'calumny', 'desultory', 'evanescent', 'fatuous', 'hubris', 'inchoate', 'jejune', 'lugubrious', 'mendacious', 'nugatory', 'obdurate', 'panegyric', 'querulous', 'recondite', 'sedulous', 'truculent', 'umbrage', 'vituperate', 'winsome', 'apotheosis', 'bellicose'],
  ['tergiversate', 'sesquipedalian', 'defenestration', 'pulchritude', 'perspicacious', 'callipygian', 'hebetude', 'mellifluous', 'nudiustertian', 'obambulate', 'pandiculation', 'quotidian', 'rebarbative', 'sciolist', 'tatterdemalion', 'ultracrepidarian', 'velleity', 'widdershins', 'xenial', 'zeugma', 'anfractuous', 'bloviate'],
];

/** 伪词：读起来像英文、词典查不到 */
export const PSEUDO_WORDS = ['flandish', 'trombule', 'calverin', 'spannock', 'dremious', 'plinthal', 'vorcalide', 'merrowing', 'quastrel', 'bilfonic', 'stratoven', 'ponderix', 'glambent', 'tervious', 'morrisant', 'crendible', 'ablorate', 'fenticle', 'sulpherate', 'wrenlock', 'obscuvel', 'tanglorous', 'perfidate', 'lumbrient', 'cravendish', 'oxilline', 'duressant', 'ferntide'];

/** 把一个真词改两个字母做成伪词（词典查不到才算数，由调用方验证） */
export function mutateWord(word: string, seed: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const chars = word.split('');
  const i = 1 + (seed % Math.max(1, chars.length - 2));
  const k = (i + 2 + (seed >> 3)) % chars.length;
  chars[i] = letters[(letters.indexOf(chars[i]!) + 7 + seed) % 26]!;
  chars[k] = letters[(letters.indexOf(chars[k]!) + 11 + seed) % 26]!;
  return chars.join('');
}
