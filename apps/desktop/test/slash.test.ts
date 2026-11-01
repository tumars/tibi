import { describe, expect, it } from 'vitest';
import { ACTIONS, matchActions, parseSlash, slashQuery } from '../src/lib/slash';

describe('slashQuery', () => {
  it('整段是 /xxx 才打开菜单', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/讲')).toBe('讲');
    expect(slashQuery('/讲解 这句')).toBeUndefined();
    expect(slashQuery('/usr/bin')).toBeUndefined();
    expect(slashQuery('what is /')).toBeUndefined();
  });
});

describe('matchActions', () => {
  it('空查询列出全部六项', () => expect(matchActions('')).toHaveLength(6));
  it('按名字或 id 过滤，查不到返回空', () => {
    expect(matchActions('讲').map(a => a.id)).toEqual(['tutor']);
    expect(matchActions('SCOUT').map(a => a.id)).toEqual(['scout']);
    expect(matchActions('没有这个')).toEqual([]);
  });
  it('只在传入的动作里找（关掉的技能不出现）', () => {
    expect(matchActions('', ACTIONS.filter(a => a.id !== 'coach')).map(a => a.id)).not.toContain('coach');
  });
});

describe('parseSlash', () => {
  it('拆出动作和内容', () => {
    const r = parseSlash('/讲解 这句为什么用 had been');
    expect(r?.action.id).toBe('tutor');
    expect(r?.rest).toBe('这句为什么用 had been');
  });
  it('简称和全称都认，内容可以为空', () => {
    expect(parseSlash('/出题')?.action.id).toBe('coach');
    expect(parseSlash('/出题与批改')?.rest).toBe('');
  });
  it('不认识的、路径、普通句子都不算', () => {
    expect(parseSlash('/foo bar')).toBeUndefined();
    expect(parseSlash('/usr/bin')).toBeUndefined();
    expect(parseSlash('讲解 一下')).toBeUndefined();
  });
});
