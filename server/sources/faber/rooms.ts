// A fábrica Faber nas salas: para cada sala aberta, procura os state.yaml das demandas e publica o resumo em
// RoomInfo.faber. Somente leitura, sem git e sem rede — só o sistema de arquivos:
// - sala de worktree de demanda (<repo>/.claude/worktrees/TASK-<n>): a cópia da própria worktree,
//   <sala>/faber/tasks/TASK-<n>/state.yaml, que é a viva (é ali que os scripts do Faber escrevem);
// - sala do repositório da fábrica (tem faber/tasks/): as demandas da pasta e de todas as worktrees em
//   .claude/worktrees/*/faber/tasks/. A mesma demanda em várias cópias vale a de updated_at mais recente (empate:
//   a da worktree), como no leitor do dashboard do Faber.
// Os arquivos só são relidos quando mudam (mtime + tamanho). Uma demanda que passa a esperar o Owner (G1/G6/G8)
// ou fica bloqueada vira aviso — nunca na primeira varredura, que só registra o estado atual.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { faberStateLabel, type FaberGate, type FaberRoomInfo, type FaberTaskInfo } from '../../../shared/faber';
import { tr } from '../../../shared/i18n';
import { FaberStateError, parseFaberState, TASK_ID } from './state';

/** Demandas listadas na sala do repositório (as demais só contam). */
export const FABER_ROOM_TASKS_MAX = 12;
/** state.yaml maior que isto não é de verdade: não lê. */
const STATE_MAX_BYTES = 512 * 1024;
const WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)$/;

export interface FaberRoomRef {
  id: string;
  path: string;
}

export interface FaberNotice {
  roomId: string;
  level: 'alert' | 'warn';
  text: string;
  key: string;
}

interface Cached {
  mtimeMs: number;
  size: number;
  task?: FaberTaskInfo;
  error?: string;
}

interface Copy {
  task: FaberTaskInfo;
  /** Cópia de uma worktree (não da pasta do repositório). */
  worktree: boolean;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Demanda dona da worktree da sala ("TASK-42" de .../.claude/worktrees/TASK-42), se for uma. */
export function worktreeTask(roomPath: string): string | undefined {
  const m = WORKTREE.exec(roomPath);
  return m && TASK_ID.test(m[1]) ? m[1] : undefined;
}

/** Ordem da sala do repositório: espera o Owner, bloqueada, depois a mais recente. */
function rank(t: FaberTaskInfo): number {
  return t.awaitingOwner ? 0 : t.state === 'blocked' ? 1 : 2;
}

export class FaberRooms {
  private files = new Map<string, Cached>();
  private rooms = new Map<string, FaberRoomInfo>();
  private sigs = new Map<string, string>();
  /** Por demanda: o que já foi avisado (gate esperando o Owner, bloqueio). */
  private seen = new Map<string, { owner?: FaberGate; blocked: boolean }>();
  private primed = false;

  constructor(private readonly opts: { onNotice?: (n: FaberNotice) => void } = {}) {}

  /** O Faber de uma sala (pelo caminho da sala), se houver. */
  get(roomPath: string): FaberRoomInfo | undefined {
    return this.rooms.get(roomPath);
  }

  /** Varre as salas abertas. Devolve true quando algo publicado mudou. */
  scan(rooms: readonly FaberRoomRef[]): boolean {
    const next = new Map<string, FaberRoomInfo>();
    const used = new Set<string>();
    // demanda → sala onde ela mora (a worktree, se aberta; senão o repositório)
    const home = new Map<string, { roomId: string; task: FaberTaskInfo; worktree: boolean }>();
    for (const r of rooms) {
      const info = this.roomInfo(r.path, used);
      if (!info) continue;
      next.set(r.path, info);
      if (info.task) home.set(info.task.id, { roomId: r.id, task: info.task, worktree: true });
      for (const t of info.tasks ?? []) if (!home.get(t.id)?.worktree) home.set(t.id, { roomId: r.id, task: t, worktree: false });
    }
    for (const p of [...this.files.keys()]) if (!used.has(p)) this.files.delete(p);
    this.notify(home);
    let changed = false;
    const sigs = new Map<string, string>();
    for (const [path, info] of next) {
      const sig = JSON.stringify(info);
      sigs.set(path, sig);
      if (this.sigs.get(path) !== sig) changed = true;
    }
    if (sigs.size !== this.sigs.size) changed = true;
    this.rooms = next;
    this.sigs = sigs;
    return changed;
  }

  private roomInfo(roomPath: string, used: Set<string>): FaberRoomInfo | undefined {
    const own = worktreeTask(roomPath);
    if (own) {
      const file = join(roomPath, 'faber', 'tasks', own, 'state.yaml');
      used.add(file);
      const c = this.read(file, own);
      if (!c) return undefined;
      return c.task ? { task: c.task } : { invalid: 1 };
    }
    if (!isDir(join(roomPath, 'faber', 'tasks'))) return undefined;
    const copies = new Map<string, Copy>();
    let invalid = 0;
    const collect = (base: string, worktree: boolean) => {
      for (const id of listDir(base)) {
        if (!TASK_ID.test(id)) continue;
        const file = join(base, id, 'state.yaml');
        used.add(file);
        const c = this.read(file, id);
        if (!c) continue;
        if (!c.task) {
          invalid++;
          continue;
        }
        const cur = copies.get(id);
        const t = c.task.updatedAt ?? 0;
        const ct = cur?.task.updatedAt ?? 0;
        if (!cur || t > ct || (t === ct && worktree && !cur.worktree)) copies.set(id, { task: c.task, worktree });
      }
    };
    collect(join(roomPath, 'faber', 'tasks'), false);
    const wts = join(roomPath, '.claude', 'worktrees');
    for (const name of listDir(wts)) collect(join(wts, name, 'faber', 'tasks'), true);
    const all = [...copies.values()].map((c) => c.task);
    const active = all
      .filter((t) => t.state !== 'done' && t.state !== 'cancelled')
      .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id));
    const info: FaberRoomInfo = { tasks: active.slice(0, FABER_ROOM_TASKS_MAX) };
    const done = all.filter((t) => t.state === 'done').length;
    if (done) info.done = done;
    if (invalid) info.invalid = invalid;
    return info;
  }

  /** Lê (ou reaproveita) um state.yaml. undefined = não existe. */
  private read(file: string, id: string): Cached | undefined {
    let st;
    try {
      st = statSync(file);
    } catch {
      this.files.delete(file);
      return undefined;
    }
    if (!st.isFile()) return undefined;
    const cur = this.files.get(file);
    if (cur && cur.mtimeMs === st.mtimeMs && cur.size === st.size) return cur;
    const c: Cached = { mtimeMs: st.mtimeMs, size: st.size };
    try {
      if (st.size > STATE_MAX_BYTES) throw new FaberStateError('arquivo grande demais');
      c.task = parseFaberState(readFileSync(file, 'utf8'), id);
    } catch (err) {
      c.error = err instanceof Error ? err.message : String(err);
    }
    this.files.set(file, c);
    return c;
  }

  private notify(home: Map<string, { roomId: string; task: FaberTaskInfo }>): void {
    const prime = !this.primed;
    this.primed = true;
    for (const [id, { roomId, task }] of home) {
      const before = this.seen.get(id);
      const blocked = task.state === 'blocked';
      this.seen.set(id, { owner: task.awaitingOwner, blocked });
      if (prime || !this.opts.onNotice) continue;
      const title = task.title ? `: ${task.title}` : '';
      if (task.awaitingOwner && task.awaitingOwner !== before?.owner) {
        this.opts.onNotice({
          roomId,
          level: 'alert',
          key: `${id}|owner|${task.awaitingOwner}`,
          text: tr('✋ {0} aguarda você no {1} ({2}){3}', [id, task.awaitingOwner, faberStateLabel(task.state), title]),
        });
      }
      if (blocked && !before?.blocked) {
        this.opts.onNotice({
          roomId,
          level: 'warn',
          key: `${id}|blocked`,
          text: tr('⛔ {0} bloqueada: {1}', [id, task.blocked || tr('sem motivo registrado')]),
        });
      }
    }
    for (const id of [...this.seen.keys()]) if (!home.has(id)) this.seen.delete(id);
  }
}

