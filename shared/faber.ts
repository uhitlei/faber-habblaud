// Fábrica Faber no escritório (https://github.com/uhitlei/faber): cada demanda TASK-<n> roda numa worktree própria
// (<repo>/.claude/worktrees/TASK-<n>), que vira uma sala, e o estado dela fica em faber/tasks/TASK-<n>/state.yaml.
// Aqui ficam o formato publicado no snapshot (RoomInfo.faber) e as regras que o próprio Faber usa
// (faber/scripts/monitor.py): o gate corrente é o primeiro G1..G9 `pending`; a demanda espera o Owner quando está
// num dos três estados da fila humana com o gate correspondente pendente. Puro: sem Node nem DOM.
import { tr } from './i18n';

/** Os 15 estados finos do state.yaml, na ordem da tabela do Faber (§6.2). */
export const FABER_STATES = [
  'intake', 'clarification', 'specifying', 'refinement', 'ready-for-dev', 'in-development', 'developed', 'code-review',
  'validation', 'my-review', 'ready-for-pr', 'pr-open', 'done', 'blocked', 'cancelled',
] as const;
export type FaberState = (typeof FABER_STATES)[number];

export const FABER_GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'] as const;
export type FaberGate = (typeof FABER_GATES)[number];

/** Gates humanos: só o Owner aprova (no Faber, confirmar o diálogo do gate-set É a aprovação). */
export const FABER_HUMAN_GATES: ReadonlySet<string> = new Set(['G1', 'G6', 'G8']);

// Decisões do Owner que o Faber transforma de propósito num diálogo de permissão (h1-bash-guard.sh, regras 8 e 9):
// aprovar um gate humano com o gate-set e liberar a edição de workflows com o workflow-unlock. Confirmar o diálogo
// É a aprovação, então o Habblaud nunca as responde (nem pelo celular): fica só o terminal. A mesma regra está no
// hook de permissão (mod/habblaud-permissoes/hooks/permission-hook.mjs), que não pode importar este arquivo.
const GATE_SET = /\bgate-set(\.sh)?\b/;
const HUMAN_GATE = /\bG(1|6|8)\b/;
const APPROVED = /\bapproved\b/;
const UNLOCK = /\bworkflow-unlock(\.sh)?\b/;
const REVOKE = /--revoke\b/;

/** O comando (tool_input.command: texto ou lista de argumentos) é uma decisão do Owner na fábrica Faber? */
export function isFaberOwnerCommand(command: unknown): boolean {
  const cmd = typeof command === 'string' ? command : Array.isArray(command) ? command.filter((x) => typeof x === 'string').join(' ') : '';
  if (!cmd) return false;
  if (GATE_SET.test(cmd) && HUMAN_GATE.test(cmd) && APPROVED.test(cmd)) return true;
  return UNLOCK.test(cmd) && !REVOKE.test(cmd);
}

/** Estado → gate humano que ele espera (FILA_OWNER do monitor.py). */
const OWNER_QUEUE: Readonly<Partial<Record<FaberState, FaberGate>>> = { 'ready-for-dev': 'G1', 'my-review': 'G6', 'pr-open': 'G8' };

/** Estado fino → coluna macro do board (board_columns do state.template.yaml). */
const COLUMNS: Readonly<Record<FaberState, string | undefined>> = {
  intake: 'Backlog', clarification: 'Backlog', specifying: 'Specification', refinement: 'Specification',
  'ready-for-dev': 'Ready for Dev', 'in-development': 'In Development', developed: 'In Development',
  'code-review': 'Review & Validation', validation: 'Review & Validation', 'my-review': 'My Review',
  'ready-for-pr': 'My Review', 'pr-open': 'PR Open', done: 'Done', blocked: 'Blocked', cancelled: undefined,
};

/** Uma demanda, como a sala mostra. */
export interface FaberTaskInfo {
  /** "TASK-42". */
  id: string;
  title: string;
  /** Tipo da demanda (feature, bug, spike...). */
  type?: string;
  state: FaberState;
  /** Coluna macro do board (ausente: cancelada). */
  column?: string;
  /** Primeiro gate ainda pendente (o que a demanda persegue); ausente quando todos foram decididos. */
  gate?: FaberGate;
  /** Gate humano que espera o Owner agora (G1, G6 ou G8). */
  awaitingOwner?: FaberGate;
  /** Motivo do bloqueio (estado blocked). */
  blocked?: string;
  /** Último subagente invocado na demanda (invocations). */
  agent?: string;
  /** PR, quando aberta. */
  pr?: string;
  /** updated_at do state.yaml (epoch ms). */
  updatedAt?: number;
}

/**
 * O Faber na sala:
 * - sala de uma worktree de demanda (.claude/worktrees/TASK-<n>): `task`;
 * - sala do repositório da fábrica (onde o CTO roda): `tasks`, as demandas em andamento de todas as worktrees.
 */
export interface FaberRoomInfo {
  task?: FaberTaskInfo;
  /** Em andamento (sem done/cancelled): quem espera o Owner primeiro, depois bloqueadas, depois as mais recentes. */
  tasks?: FaberTaskInfo[];
  /** Demandas concluídas encontradas. */
  done?: number;
  /** Arquivos state.yaml que não deu para ler (meio da escrita, YAML inválido, estado fora da lista). */
  invalid?: number;
}

export function isFaberState(s: unknown): s is FaberState {
  return typeof s === 'string' && (FABER_STATES as readonly string[]).includes(s);
}

export function faberColumn(state: FaberState): string | undefined {
  return COLUMNS[state];
}

/** Primeiro gate (G1..G9) `pending`. `statusOf` devolve o status do gate no state.yaml. */
export function faberCurrentGate(statusOf: (gate: FaberGate) => unknown): FaberGate | undefined {
  return FABER_GATES.find((g) => statusOf(g) === 'pending');
}

/** Gate humano que a demanda espera: só nos estados da fila do Owner e com o gate correspondente pendente. */
export function faberAwaitingOwner(state: FaberState, statusOf: (gate: FaberGate) => unknown): FaberGate | undefined {
  const gate = OWNER_QUEUE[state];
  return gate && statusOf(gate) === 'pending' ? gate : undefined;
}

/** Nome do estado para a interface. */
export function faberStateLabel(state: FaberState): string {
  switch (state) {
    case 'intake': return tr('Entrada');
    case 'clarification': return tr('Esclarecendo');
    case 'specifying': return tr('Especificando');
    case 'refinement': return tr('Refinamento');
    case 'ready-for-dev': return tr('Pronta para dev');
    case 'in-development': return tr('Em desenvolvimento');
    case 'developed': return tr('Desenvolvida');
    case 'code-review': return tr('Code review');
    case 'validation': return tr('Validação');
    case 'my-review': return tr('Sua avaliação');
    case 'ready-for-pr': return tr('Pronta para PR');
    case 'pr-open': return tr('PR aberto');
    case 'done': return tr('Concluída');
    case 'blocked': return tr('Bloqueada');
    case 'cancelled': return tr('Cancelada');
  }
}

/** Resumo de uma linha: "TASK-42 · Em desenvolvimento · G3". */
export function faberTaskLine(t: FaberTaskInfo): string {
  return [t.id, faberStateLabel(t.state), t.gate].filter(Boolean).join(' · ');
}

/** O que o Owner precisa fazer: "✋ G6 aguarda você". */
export function faberOwnerLine(gate: FaberGate): string {
  return tr('✋ {0} aguarda você', [gate]);
}

/** Resumo da fábrica numa sala, para a placa no mundo e a lista lateral. */
export interface FaberSummary {
  /** Uma linha curta. Ex.: "✋ G6 aguarda você · TASK-42". */
  text: string;
  /** owner: alguém precisa do Owner (G1/G6/G8); blocked: demanda bloqueada; invalid: state.yaml ilegível. */
  tone: 'owner' | 'blocked' | 'invalid' | 'normal';
  /** Várias linhas, para a dica: título, motivo do bloqueio, as demandas do repositório. */
  detail: string;
}

function detailOf(t: FaberTaskInfo): string {
  const head = `${faberTaskLine(t)}${t.title ? ` — ${t.title}` : ''}`;
  const extra = [
    t.awaitingOwner ? faberOwnerLine(t.awaitingOwner) : '',
    t.state === 'blocked' ? tr('Bloqueio: {0}', [t.blocked || tr('sem motivo registrado')]) : '',
    t.agent ? tr('Último agente: {0}', [t.agent]) : '',
  ].filter(Boolean);
  return [head, ...extra.map((x) => `  ${x}`)].join('\n');
}

export function faberSummary(info: FaberRoomInfo | undefined): FaberSummary | undefined {
  if (!info) return undefined;
  const t = info.task;
  if (t) {
    const detail = detailOf(t);
    if (t.awaitingOwner) return { text: `${faberOwnerLine(t.awaitingOwner)} · ${t.id}`, tone: 'owner', detail };
    if (t.state === 'blocked') return { text: tr('⛔ {0} bloqueada', [t.id]), tone: 'blocked', detail };
    return { text: faberTaskLine(t), tone: 'normal', detail };
  }
  const tasks = info.tasks;
  if (!tasks) return info.invalid ? { text: tr('⚠️ state.yaml ilegível'), tone: 'invalid', detail: '' } : undefined;
  const owner = tasks.filter((x) => x.awaitingOwner);
  const blocked = tasks.filter((x) => x.state === 'blocked');
  const lines = tasks.map(detailOf);
  if (info.done) lines.push(tr('{0} concluída(s)', [info.done]));
  if (info.invalid) lines.push(tr('{0} state.yaml ilegível(is)', [info.invalid]));
  const detail = lines.join('\n');
  if (owner.length === 1) return { text: tr('✋ {0} aguarda você no {1}', [owner[0].id, owner[0].awaitingOwner!]), tone: 'owner', detail };
  if (owner.length > 1) return { text: tr('✋ {0} demandas aguardam você', [owner.length]), tone: 'owner', detail };
  if (blocked.length) return { text: tr('⛔ {0} bloqueada(s) · {1} em andamento', [blocked.length, tasks.length]), tone: 'blocked', detail };
  if (tasks.length) return { text: tr('🏭 {0} demanda(s) em andamento', [tasks.length]), tone: 'normal', detail };
  return { text: tr('🏭 Fábrica sem demandas abertas'), tone: info.invalid ? 'invalid' : 'normal', detail };
}
