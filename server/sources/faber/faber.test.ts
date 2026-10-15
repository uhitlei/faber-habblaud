import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FaberRooms, worktreeTask, type FaberNotice } from './rooms';
import { FaberStateError, parseFaberState } from './state';
import { parseYaml, YamlError } from './yaml';

// Saída real do yaml.safe_dump do PyYAML (como os scripts do Faber gravam): título longo quebrado em duas linhas,
// "#" dentro das aspas, texto entre aspas com linha em branco, escapes das aspas duplas.
const PYYAML = `task: TASK-7
title: 'Corrigir o login com Google quando o usuário volta do consentimento #12 e
  a sessão expira no meio: "rápido" e sem regressão'
state: blocked
blocking:
  reason: Esperando a API do parceiro liberar o escopo de e-mail; sem isso o fluxo
    de cadastro não fecha
  since: '2026-10-14T10:00:00-03:00'
  previous_state: in-development
note: 'linha1

  linha2'
tab: "a\\tb"
ascii: "Corrigir o login do usu\\xE1rio #12\\
  \\ e a sess\\xE3o \\U0001F44B"
`;

describe('parseYaml', () => {
  it('lê o que o PyYAML grava', () => {
    expect(parseYaml(PYYAML)).toEqual({
      task: 'TASK-7',
      title: 'Corrigir o login com Google quando o usuário volta do consentimento #12 e a sessão expira no meio: "rápido" e sem regressão',
      state: 'blocked',
      blocking: {
        reason: 'Esperando a API do parceiro liberar o escopo de e-mail; sem isso o fluxo de cadastro não fecha',
        since: '2026-10-14T10:00:00-03:00',
        previous_state: 'in-development',
      },
      note: 'linha1\nlinha2',
      tab: 'a\tb',
      ascii: 'Corrigir o login do usuário #12 e a sessão 👋',
    });
  });

  it('listas no mesmo recuo da chave, itens com mapa, mapas e listas em linha, comentários', () => {
    const src = [
      '# cabeçalho',
      'history:',
      '- from_state: intake   # comentário',
      '  to_state: specifying',
      '  reason: null',
      '- from_state: specifying',
      '  to_state: refinement',
      'gates:',
      '  G1: { name: ready-for-development, status: approved, approver: "@ana", at: null }',
      '  G2: {name: x, status: pending}',
      'ids: [G1, G6, "G8"]',
      'empty: []',
      'n: 42',
      'yes: true',
      'tilde: ~',
      'nested:',
      '  - a',
      '  -',
      '    b: 1',
    ].join('\n');
    expect(parseYaml(src)).toEqual({
      history: [
        { from_state: 'intake', to_state: 'specifying', reason: null },
        { from_state: 'specifying', to_state: 'refinement' },
      ],
      gates: {
        G1: { name: 'ready-for-development', status: 'approved', approver: '@ana', at: null },
        G2: { name: 'x', status: 'pending' },
      },
      ids: ['G1', 'G6', 'G8'],
      empty: [],
      n: 42,
      yes: true,
      tilde: null,
      nested: ['a', { b: 1 }],
    });
  });

  it('comentário depois de apóstrofo e de aspas dobradas; U+2028 é quebra que fica no texto', () => {
    expect(parseYaml("a: it's ok # comentário\nb: 'x'' # y' # z")).toEqual({ a: "it's ok", b: "x' # y" });
    expect(parseYaml("t: 'um\u2028  dois\n  tres'")).toEqual({ t: 'um\u2028dois tres' });
  });

  it('texto em bloco (| e >)', () => {
    expect(parseYaml('a: |\n  um\n    dois\nb: >-\n  tres\n  quatro\n')).toEqual({ a: 'um\n  dois\n', b: 'tres quatro' });
  });

  it('recusa o que não entende', () => {
    for (const bad of ['a: &x 1', 'a: *x', 'a: !!str 1', 'a: 1\na: 2', 'a: "sem fechar', '  a: 1', 'a: 1\n   b: 2', 'a: 1\n---\nb: 2', 'a: {x: 1']) {
      expect(() => parseYaml(bad), bad).toThrow(YamlError);
    }
  });
});

const GATES = (over: Record<string, string> = {}) =>
  ['gates:', ...['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'].map((g) => `  ${g}:\n    name: x\n    status: ${over[g] ?? 'pending'}`)].join('\n');

function state(id: string, st: string, gates: Record<string, string> = {}, extra = ''): string {
  return [`task: ${id}`, `title: Demanda ${id}`, 'type: feature', `state: ${st}`, "updated_at: '2026-10-14T10:00:00-03:00'", extra, GATES(gates)].filter(Boolean).join('\n');
}

describe('parseFaberState', () => {
  it('gate corrente, fila do Owner, coluna e último agente', () => {
    const t = parseFaberState(state('TASK-42', 'my-review', { G1: 'approved', G2: 'approved', G3: 'approved', G4: 'approved', G5: 'approved' }, 'invocations:\n- agent: qa\n  at: x\n- agent: devsecops\n  at: y'));
    expect(t).toEqual({
      id: 'TASK-42',
      title: 'Demanda TASK-42',
      type: 'feature',
      state: 'my-review',
      column: 'My Review',
      gate: 'G6',
      awaitingOwner: 'G6',
      agent: 'devsecops',
      updatedAt: Date.parse('2026-10-14T13:00:00Z'),
    });
  });

  it('só espera o Owner com o gate do estado pendente', () => {
    expect(parseFaberState(state('TASK-1', 'ready-for-dev')).awaitingOwner).toBe('G1');
    expect(parseFaberState(state('TASK-1', 'ready-for-dev', { G1: 'approved' })).awaitingOwner).toBeUndefined();
    expect(parseFaberState(state('TASK-1', 'pr-open', { G8: 'pending' })).awaitingOwner).toBe('G8');
    expect(parseFaberState(state('TASK-1', 'in-development')).awaitingOwner).toBeUndefined();
  });

  it('bloqueio com motivo', () => {
    const t = parseFaberState(state('TASK-3', 'blocked', {}, 'blocking:\n  reason: sem acesso ao banco\n  previous_state: validation'));
    expect(t.blocked).toBe('sem acesso ao banco');
    expect(t.column).toBe('Blocked');
  });

  it('leitura inválida: estado fora da lista, pasta de outra demanda, gate estranho, YAML quebrado', () => {
    expect(() => parseFaberState(state('TASK-1', 'refi'))).toThrow(FaberStateError);
    expect(() => parseFaberState(state('TASK-1', 'intake'), 'TASK-2')).toThrow(FaberStateError);
    expect(() => parseFaberState(`${state('TASK-1', 'intake')}\n  G10:\n    status: pending`)).toThrow(FaberStateError);
    expect(() => parseFaberState('task: TASK-1\nstate: "intake')).toThrow(FaberStateError);
    expect(() => parseFaberState('- a')).toThrow(FaberStateError);
  });

  it('limpa caracteres de controle do título (vem da issue do GitHub)', () => {
    const t = parseFaberState(state('TASK-1', 'intake').replace('title: Demanda TASK-1', 'title: "a\\x1b[2Jb\\u202Ec"'));
    expect(t.title).toBe('a [2Jb c');
  });
});

describe('worktreeTask', () => {
  it('a worktree da demanda; outras pastas não', () => {
    expect(worktreeTask('/u/repo/.claude/worktrees/TASK-42')).toBe('TASK-42');
    expect(worktreeTask('/u/repo/.claude/worktrees/feature-x')).toBeUndefined();
    expect(worktreeTask('/u/repo')).toBeUndefined();
  });
});

describe('FaberRooms', () => {
  let root: string;
  let repo: string;
  const write = (file: string, text: string) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  };
  const wt = (id: string) => join(repo, '.claude', 'worktrees', id);
  const stateFile = (dir: string, id: string) => join(dir, 'faber', 'tasks', id, 'state.yaml');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'habblaud-faber-'));
    repo = join(root, 'repo');
    mkdirSync(join(repo, 'faber', 'tasks'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('sala da worktree mostra a demanda; sala do repositório lista as demandas de todas as worktrees', () => {
    write(stateFile(wt('TASK-1'), 'TASK-1'), state('TASK-1', 'in-development', { G1: 'approved', G2: 'approved' }));
    write(stateFile(wt('TASK-2'), 'TASK-2'), state('TASK-2', 'my-review', { G1: 'approved', G2: 'approved', G3: 'approved', G4: 'approved', G5: 'approved' }));
    write(stateFile(repo, 'TASK-9'), state('TASK-9', 'done'));
    write(stateFile(repo, 'TASK-8'), 'task: TASK-8\nstate: "pela met');
    const f = new FaberRooms();
    const rooms = [
      { id: 'r', path: repo },
      { id: 'w1', path: wt('TASK-1') },
      { id: 'x', path: join(root, 'outro') },
    ];
    expect(f.scan(rooms)).toBe(true);
    expect(f.get(wt('TASK-1'))?.task).toMatchObject({ id: 'TASK-1', state: 'in-development', gate: 'G3' });
    const r = f.get(repo)!;
    // quem espera o Owner primeiro
    expect(r.tasks?.map((t) => t.id)).toEqual(['TASK-2', 'TASK-1']);
    expect(r.done).toBe(1);
    expect(r.invalid).toBe(1);
    expect(f.get(join(root, 'outro'))).toBeUndefined();
    // nada mudou: não republica
    expect(f.scan(rooms)).toBe(false);
  });

  it('a mesma demanda em duas cópias: vale a de updated_at mais recente', () => {
    write(stateFile(repo, 'TASK-5'), state('TASK-5', 'specifying').replace('2026-10-14T10:00', '2026-10-14T09:00'));
    write(stateFile(wt('TASK-5'), 'TASK-5'), state('TASK-5', 'refinement'));
    const f = new FaberRooms();
    f.scan([{ id: 'r', path: repo }]);
    expect(f.get(repo)?.tasks?.[0].state).toBe('refinement');
  });

  it('avisa quando a demanda passa a esperar o Owner ou fica bloqueada — não na primeira varredura', () => {
    const file = stateFile(wt('TASK-4'), 'TASK-4');
    write(file, state('TASK-4', 'ready-for-dev'));
    const notices: FaberNotice[] = [];
    const f = new FaberRooms({ onNotice: (n) => notices.push(n) });
    const rooms = [{ id: 'w4', path: wt('TASK-4') }];
    f.scan(rooms);
    expect(notices).toEqual([]);
    const bump = (text: string, s: number) => {
      write(file, text);
      utimesSync(file, s, s);
    };
    bump(state('TASK-4', 'in-development', { G1: 'approved' }), 2_000_000_000);
    expect(f.scan(rooms)).toBe(true);
    bump(state('TASK-4', 'my-review', { G1: 'approved', G2: 'approved', G3: 'approved', G4: 'approved', G5: 'approved' }), 2_000_000_100);
    f.scan(rooms);
    bump(state('TASK-4', 'blocked', { G1: 'approved' }, 'blocking:\n  reason: falta credencial'), 2_000_000_200);
    f.scan(rooms);
    expect(notices.map((n) => [n.roomId, n.level, n.key])).toEqual([
      ['w4', 'alert', 'TASK-4|owner|G6'],
      ['w4', 'warn', 'TASK-4|blocked'],
    ]);
    expect(notices[0].text).toContain('TASK-4');
    expect(notices[1].text).toContain('falta credencial');
  });
});
