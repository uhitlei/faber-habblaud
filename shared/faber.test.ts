import { describe, expect, it } from 'vitest';
import { faberSummary, type FaberTaskInfo } from './faber';

const t = (over: Partial<FaberTaskInfo>): FaberTaskInfo => ({ id: 'TASK-1', title: 'Login', state: 'in-development', gate: 'G3', ...over });

describe('faberSummary', () => {
  it('sala da worktree: espera o Owner, bloqueada ou o estado com o gate', () => {
    expect(faberSummary({ task: t({ state: 'my-review', gate: 'G6', awaitingOwner: 'G6' }) })).toMatchObject({ text: '✋ G6 aguarda você · TASK-1', tone: 'owner' });
    expect(faberSummary({ task: t({ state: 'blocked', blocked: 'sem acesso' }) })).toMatchObject({ text: '⛔ TASK-1 bloqueada', tone: 'blocked' });
    const s = faberSummary({ task: t({ agent: 'qa' }) })!;
    expect(s).toMatchObject({ text: 'TASK-1 · Em desenvolvimento · G3', tone: 'normal' });
    expect(s.detail).toContain('Login');
    expect(s.detail).toContain('qa');
  });

  it('sala do repositório: quem espera o Owner vem primeiro; depois bloqueadas; depois a contagem', () => {
    expect(faberSummary({ tasks: [t({ id: 'TASK-2', awaitingOwner: 'G1', state: 'ready-for-dev' }), t({})] })?.text).toBe('✋ TASK-2 aguarda você no G1');
    expect(faberSummary({ tasks: [t({ awaitingOwner: 'G1' }), t({ awaitingOwner: 'G8' })] })?.text).toBe('✋ 2 demandas aguardam você');
    expect(faberSummary({ tasks: [t({ state: 'blocked' }), t({})] })).toMatchObject({ tone: 'blocked' });
    expect(faberSummary({ tasks: [t({}), t({})], done: 3 })).toMatchObject({ text: '🏭 2 demanda(s) em andamento', tone: 'normal' });
    expect(faberSummary({ tasks: [], invalid: 1 })?.tone).toBe('invalid');
    expect(faberSummary({ invalid: 1 })?.tone).toBe('invalid');
    expect(faberSummary(undefined)).toBeUndefined();
  });
});
