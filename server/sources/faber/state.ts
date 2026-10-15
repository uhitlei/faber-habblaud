// Um faber/tasks/TASK-<n>/state.yaml → FaberTaskInfo. Mesmas regras do leitor do dashboard do Faber
// (faber/dashboard/leitor.py): estado fora da lista fechada é leitura inválida, nunca estado — um arquivo lido no
// meio da escrita pode parsear e devolver lixo. Puro.
import {
  FABER_GATES, faberAwaitingOwner, faberColumn, faberCurrentGate, isFaberState, type FaberGate, type FaberTaskInfo,
} from '../../../shared/faber';
import { parseYaml, YamlError, type YamlValue } from './yaml';

export const TASK_ID = /^TASK-[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;
const TITLE_MAX = 160;

export class FaberStateError extends Error {}

type Obj = { [k: string]: YamlValue };

function isObj(v: YamlValue | undefined): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Texto curto e sem caracteres de controle (o título vem da issue do GitHub). */
function text(v: YamlValue | undefined, max = TITLE_MAX): string | undefined {
  if (v === null || v === undefined || typeof v === 'object') return undefined;
  const s = String(v).replace(/[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function time(v: YamlValue | undefined): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export function parseFaberState(src: string, expectedId?: string): FaberTaskInfo {
  let doc: YamlValue;
  try {
    doc = parseYaml(src);
  } catch (err) {
    if (err instanceof YamlError) throw new FaberStateError(`YAML: ${err.message}`);
    throw err;
  }
  if (!isObj(doc)) throw new FaberStateError('o state.yaml não é um mapa');
  const id = text(doc.task, 48);
  if (!id || !TASK_ID.test(id)) throw new FaberStateError('campo task ausente ou inválido');
  if (expectedId && id !== expectedId) throw new FaberStateError(`task ${id} na pasta ${expectedId}`);
  const state = doc.state;
  if (!isFaberState(state)) throw new FaberStateError(`estado fora da lista: ${String(state)}`);
  const gates = isObj(doc.gates) ? doc.gates : {};
  const statusOf = (g: FaberGate) => {
    const gate = gates[g];
    return isObj(gate) ? gate.status : undefined;
  };
  // gate que não é um dos nove também é leitura inválida (o gate-check do Faber recusaria)
  for (const k of Object.keys(gates)) if (!(FABER_GATES as readonly string[]).includes(k)) throw new FaberStateError(`gate desconhecido: ${k}`);
  const info: FaberTaskInfo = { id, title: text(doc.title) ?? '', state };
  const type = text(doc.type, 24);
  if (type) info.type = type;
  const column = faberColumn(state);
  if (column) info.column = column;
  const gate = faberCurrentGate(statusOf);
  if (gate) info.gate = gate;
  const owner = faberAwaitingOwner(state, statusOf);
  if (owner) info.awaitingOwner = owner;
  if (state === 'blocked') info.blocked = (isObj(doc.blocking) ? text(doc.blocking.reason) : undefined) ?? '';
  const inv = Array.isArray(doc.invocations) ? doc.invocations[doc.invocations.length - 1] : undefined;
  const agent = isObj(inv) ? text(inv.agent, 48) : undefined;
  if (agent) info.agent = agent;
  const pr = text(doc.pr, 200);
  if (pr) info.pr = pr;
  const updatedAt = time(doc.updated_at) ?? time(doc.created_at);
  if (updatedAt !== undefined) info.updatedAt = updatedAt;
  return info;
}
