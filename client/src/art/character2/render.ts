// Personagens v2 (PROTÓTIPO): o mesmo contrato do personagem atual (Appearance, Dir, Pose; folha de 24x34 unidades
// de mundo com âncora (12, 31) no centro dos pés), mas desenhado com curvas em vez de pixel a pixel. Resultado:
// formas arredondadas, rosto com olhos de verdade (brilho, íris, cílios) e cabelo com volume, nítido em qualquer
// zoom porque o canvas sai na escala pedida (`scale` px por unidade de mundo).
//
// Proporções em unidades de mundo (em pé, de frente): cabelo a partir de y≈3.5, cabeça 4.8–17.2, tronco 18–24.8,
// pernas 24.5–30, sapatos ~30.4. Sentado: tudo acima do quadril desce SEAT_DROP. Luz de cima/esquerda.
// Cobre por enquanto as poses stand, walk, sit e type; as demais caem em stand (ver poseOf).
import type { Appearance, CharacterFrameRequest, Dir, HeldItem, Pose } from '../api';
import { isSeated, POSE_DURATION, POSE_FRAMES } from '../character/render';
import { luminance, mix, shade } from '../core/color';

export const V2_W = 24;
export const V2_H = 34;
export const V2_AX = 12;
export const V2_AY = 31;
const SEAT_DROP = 4;
/** Espessura do contorno (unidades de mundo). */
const LINE = 0.42;

type Facing = 'front' | 'back' | 'side';

export interface V2Request {
  appearance: Appearance;
  dir: Dir;
  pose: Pose;
  frame: number;
  held?: HeldItem;
  /** Poses que podem ser em pé ou sentadas (raise_hand, read, talk...). */
  seated?: boolean;
  costume?: CharacterFrameRequest['costume'];
}

/** Mesmas contagens e durações de quadro do personagem clássico: o mundo anima os dois do mesmo jeito. */
export const V2_FRAMES: Readonly<Record<Pose, number>> = POSE_FRAMES;
export const V2_DURATION: Readonly<Record<Pose, number>> = POSE_DURATION;

/** Todas as poses do contrato são desenhadas (mantido para quem chamava a versão do protótipo). */
export function poseOf(p: Pose): Pose {
  return p;
}

// ---------------------------------------------------------------- paleta

interface Pal {
  skin: string;
  skinShade: string;
  skinLine: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  hairLine: string;
  top: string;
  topLine: string;
  acc: string;
  bottom: string;
  bottomLine: string;
  shoes: string;
  shoesLine: string;
  eyeDark: string;
  iris: string;
  lip: string;
  blush: string;
  item: string;
}

function line(c: string): string {
  return mix(shade(c, -0.34), '#2a2340', 0.2);
}

function paletteOf(a: Appearance): Pal {
  const dark = luminance(a.skin) < 0.38;
  return {
    skin: a.skin,
    skinShade: shade(a.skin, -0.08),
    skinLine: mix(mix(shade(a.skin, -0.3), '#4a3238', 0.22), '#6b6470', 0.25),
    hair: a.hair,
    hairShade: shade(a.hair, -0.1),
    hairLight: shade(a.hair, luminance(a.hair) > 0.7 ? 0.06 : 0.16),
    hairLine: line(a.hair),
    top: a.top,
    topLine: line(a.top),
    acc: a.topAccent,
    bottom: a.bottom,
    bottomLine: line(a.bottom),
    shoes: a.shoes,
    shoesLine: line(a.shoes),
    eyeDark: dark ? '#1a1320' : '#231a2c',
    iris: a.eyes,
    lip: mix(a.skin, dark ? '#b3405a' : '#e0566f', dark ? 0.45 : 0.5),
    blush: dark ? 'rgba(214,92,104,0.22)' : 'rgba(255,120,130,0.3)',
    item: a.accessoryColor,
  };
}

// ---------------------------------------------------------------- desenho

type Ctx = CanvasRenderingContext2D;

/** Preenche o caminho atual com degradê suave (luz no alto à esquerda) e contorna. */
function paint(g: Ctx, base: string, outline: string, box: [number, number, number, number], opts: { flat?: boolean; lw?: number } = {}): void {
  if (opts.flat) {
    g.fillStyle = base;
  } else {
    const [x0, y0, x1, y1] = box;
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, shade(base, 0.07));
    gr.addColorStop(0.5, base);
    gr.addColorStop(1, shade(base, -0.11));
    g.fillStyle = gr;
  }
  g.fill();
  // lineWidth 0 é ignorado pelo canvas: sem contorno, não traça
  if (opts.lw === 0) return;
  g.lineWidth = opts.lw ?? LINE;
  g.strokeStyle = outline;
  g.stroke();
}

/** Membro arredondado (cápsula) com contorno: um traço grosso escuro e, por cima, o preenchimento. */
function limb(g: Ctx, x1: number, y1: number, x2: number, y2: number, r: number, fill: string, outline: string): void {
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.strokeStyle = outline;
  g.lineWidth = r * 2 + LINE * 2;
  g.stroke();
  g.strokeStyle = fill;
  g.lineWidth = r * 2;
  g.stroke();
  // sombra do lado direito
  g.beginPath();
  g.moveTo(x1 + r * 0.45, y1 + 0.2);
  g.lineTo(x2 + r * 0.45, y2);
  g.strokeStyle = shade(fill, -0.07);
  g.lineWidth = r * 0.8;
  g.stroke();
}

function ellipse(g: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function dot(g: Ctx, x: number, y: number, r: number, fill: string): void {
  ellipse(g, x, y, r, r);
  g.fillStyle = fill;
  g.fill();
}

// ---------------------------------------------------------------- pose

interface Pt {
  x: number;
  y: number;
}

type Eyes = 'open' | 'closed' | 'happy' | 'half';
type Mouth = 'auto' | 'open' | 'smile' | 'frown' | 'o';
/** Como a mão está: aberta (padrão), punho, ou o gesto do jokenpô. */
type Hand = 'open' | 'fist' | 'rock' | 'paper' | 'scissors';

interface Rig {
  facing: Facing;
  seated: boolean;
  /** Deslocamento vertical do corpo de cima (respiração, passo, sentado, ombros caídos). */
  bob: number;
  /** Pulo: o corpo inteiro sobe (pés inclusive). */
  jump: number;
  /** Cabeça: deslocamento extra (cochilo, gargalhada, inclinada para a tela). */
  headDx: number;
  headDy: number;
  /** Frente/costas: quanto cada pé sobe (esquerdo, direito). Lado: ângulo das pernas (perto, longe). */
  lift: [number, number];
  legA: [number, number];
  /** Mãos em unidades de mundo. Frente/costas: [esquerda da tela, direita da tela]. Lado: [perto, longe]. */
  hands: [Pt, Pt];
  handKind: [Hand, Hand];
  /** Braços cruzados na frente do peito (esperando). */
  crossed: boolean;
  /** Item e em que mão (0, 1) ou entre as duas ('mid'). */
  item: HeldItem;
  itemAt: 0 | 1 | 'mid';
  eyes: Eyes;
  mouth: Mouth;
}

/** Itens que vão com as duas mãos na frente do peito. */
const TWO_HANDED: ReadonlySet<HeldItem> = new Set<HeldItem>(['box', 'laptop', 'controller']);

function rigOf(req: V2Request, frame: number): Rig {
  const pose = req.pose;
  const dir = req.dir;
  const facing: Facing = dir === 'down' ? 'front' : dir === 'up' ? 'back' : 'side';
  const seated = isSeated(pose, req.seated);
  const f = frame;
  const odd = f % 2 === 1;
  const r: Rig = {
    facing, seated, bob: 0, jump: 0, headDx: 0, headDy: 0, lift: [0, 0], legA: [0, 0],
    hands: [{ x: 0, y: 0 }, { x: 0, y: 0 }], handKind: ['open', 'open'], crossed: false,
    item: req.held ?? 'none', itemAt: 1, eyes: 'open', mouth: 'auto',
  };
  // ritmo do corpo
  if (pose === 'stand' || pose === 'talk' || pose === 'read' || pose === 'drink' || pose === 'use') r.bob = odd ? 0.25 : 0;
  if (pose === 'sit' || pose === 'wait') r.bob = odd ? 0.2 : 0;
  if (pose === 'sulk') r.bob = 0.45;
  let swing = 0;
  if (pose === 'walk' || pose === 'run') {
    const run = pose === 'run';
    const k = f % 4 === 0 ? 1 : f % 4 === 2 ? -1 : 0;
    r.bob = f % 2 ? (run ? -0.7 : -0.45) : run ? -0.2 : 0;
    r.lift = [k > 0 ? (run ? 1.6 : 1.1) : 0, k < 0 ? (run ? 1.6 : 1.1) : 0];
    r.legA = [k * (run ? 0.62 : 0.42), -k * (run ? 0.62 : 0.42)];
    swing = k;
  }
  if (seated) r.bob += SEAT_DROP;
  if (pose === 'cheer' && odd && !seated) r.jump = 1.1;
  if (pose === 'laugh') r.headDx = odd ? 0.3 : -0.3;
  if (pose === 'sleep') r.headDy = 0.9 + (odd ? 0.3 : 0);
  if (pose === 'sulk') r.headDy = 0.6;
  if (pose === 'game') r.headDy = 0.3;

  const bodyY = 18 + r.bob;
  const sh = bodyY + 1.2;
  const top = 4.8 + r.bob + r.headDy;
  const P = (x: number, y: number): Pt => ({ x, y });

  // posição de descanso das mãos
  if (facing === 'side') {
    if (seated) r.hands = [P(15.2, sh + 3.8), P(14.6, sh + 3.6)];
    else {
      const run = pose === 'run';
      const a0 = -swing * (run ? 0.8 : 0.45);
      const len = run ? 3.8 : 4.6;
      r.hands = [P(12.6 + Math.sin(-a0) * -len, sh + Math.cos(a0) * len - (run ? 0.6 : 0)), P(12.2 + Math.sin(a0) * -len, sh + Math.cos(a0) * len - (run ? 0.6 : 0))];
    }
  } else if (seated) {
    r.hands = facing === 'front' ? [P(9.4, sh + 4.6), P(14.6, sh + 4.6)] : [P(7.4, sh + 4.2), P(16.6, sh + 4.2)];
  } else {
    const run = pose === 'run';
    const lift = run ? 1.2 : 0.7;
    r.hands = [P(6.8, sh + (run ? 3.2 : 4.6) + swing * lift), P(17.2, sh + (run ? 3.2 : 4.6) - swing * lift)];
  }

  const side = facing === 'side';
  // [mão principal na frente, mão principal de lado]
  const main = (front: Pt, sidePt: Pt) => {
    if (side) r.hands[0] = sidePt;
    else r.hands[1] = front;
  };
  const both = (l: Pt, rr: Pt, sidePt: Pt, sideFar?: Pt) => {
    if (side) {
      r.hands[0] = sidePt;
      r.hands[1] = sideFar ?? P(sidePt.x - 0.6, sidePt.y - 0.2);
    } else r.hands = [l, rr];
  };

  switch (pose) {
    case 'type': {
      const t = odd ? 0.45 : 0;
      if (facing === 'back') r.hands = [P(8.6, sh + 3.6 - t), P(15.4, sh + 3.6 - (0.45 - t))];
      else both(P(10.0, sh + 3.0 - t), P(14.0, sh + 3.0 - (0.45 - t)), P(16.8, sh + 2.6 - t), P(16.2, sh + 2.4));
      break;
    }
    case 'sleep':
      r.eyes = 'closed';
      break;
    case 'drink':
      if (r.item === 'none') r.item = 'coffee';
      main(odd ? P(13.8, top + 10.6) : P(15.0, sh + 2.6), odd ? P(16.4, top + 10.4) : P(15.4, sh + 2.6));
      break;
    case 'use':
      main(P(15.4, sh + 2.0 + (odd ? 0.4 : 0)), P(17.6, sh + 1.2 + (odd ? 0.3 : 0)));
      break;
    case 'raise_hand':
      main(P(18.4 + (odd ? 0.6 : 0), top + 1.2), P(14.8 + (odd ? 0.5 : 0), top + 0.8));
      if (!odd) r.mouth = 'open';
      break;
    case 'talk':
      main(odd ? P(17.8, sh + 3.2) : P(16.8, sh + 2.2), odd ? P(17.2, sh + 3.4) : P(16.6, sh + 2.4));
      r.mouth = odd ? 'auto' : 'open';
      break;
    case 'stretch': {
      const up = odd ? 0.6 : 0;
      both(P(9.6, top - 0.6 - up), P(14.4, top - 0.6 - up), P(13.6, top - 0.8 - up), P(12.6, top - 0.6 - up));
      r.eyes = 'closed';
      r.mouth = 'o';
      break;
    }
    case 'read':
      if (r.item === 'none') r.item = 'book';
      both(P(10.6, sh + 3.4), P(13.4, sh + 3.4), P(16.0, sh + 3.0));
      r.itemAt = side ? 0 : 'mid';
      break;
    case 'play':
      if (r.item === 'none') r.item = 'paddle';
      main(odd ? P(15.8, sh + 3.6) : P(18.4, sh + 1.6), odd ? P(14.8, sh + 3.4) : P(17.4, sh + 1.0));
      break;
    case 'wait':
      if (r.item === 'popcorn') {
        // balde no colo, a outra mão leva pipoca à boca
        if (side) r.hands = [odd ? P(16.2, top + 10.6) : P(15.6, sh + 3.6), P(15.0, sh + 4.0)];
        else {
          r.hands = [P(10.4, sh + 4.2), odd ? P(13.4, top + 10.8) : P(14.6, sh + 4.2)];
          r.itemAt = 0;
        }
        if (side) r.itemAt = 1;
      } else {
        r.crossed = facing === 'front';
        if (facing === 'front') r.hands = [P(14.0, sh + 2.6), P(10.0, sh + 2.8 + (odd ? 0.3 : 0))];
        else if (side) r.hands = [P(15.4, sh + 2.6), P(14.8, sh + 2.4)];
      }
      break;
    case 'cheer':
      both(P(8.0, top - 0.4), P(16.0, top - 0.4), P(14.4, top - 0.2), P(11.6, top));
      r.handKind = ['fist', 'fist'];
      r.mouth = 'open';
      r.eyes = odd ? 'happy' : 'open';
      break;
    case 'laugh':
      r.eyes = 'happy';
      r.mouth = 'open';
      if (side) r.hands[0] = P(15.0, sh + 3.4);
      else r.hands[0] = P(13.0, sh + 4.4);
      break;
    case 'game': {
      if (r.item === 'none') r.item = 'controller';
      const t = odd ? 0.15 : 0;
      both(P(11.0, sh + 3.2 + t), P(13.0, sh + 3.35 - t), P(16.2, sh + 3.0 + t));
      r.itemAt = side ? 0 : 'mid';
      r.mouth = 'o';
      break;
    }
    case 'rps':
      if (r.item === 'rock' || r.item === 'paper' || r.item === 'scissors') {
        main(P(15.6, sh + 2.2), P(17.4, sh + 2.0));
        r.handKind[side ? 0 : 1] = r.item;
        r.item = 'none';
      } else {
        main(odd ? P(16.6, sh + 3.4) : P(16.6, sh + 1.4), odd ? P(16.2, sh + 3.2) : P(16.2, sh + 1.2));
        r.handKind[side ? 0 : 1] = 'fist';
        r.item = 'none';
      }
      break;
    case 'groom':
      if (facing === 'back') r.hands[1] = P(16.4 + (odd ? 0.4 : 0), top + 7.8);
      else main(P(15.4 + (odd ? 0.4 : 0), top + 8.2), P(16.8, top + 8.4 + (odd ? 0.4 : 0)));
      break;
    case 'sulk':
      r.eyes = 'half';
      r.mouth = 'frown';
      if (side) r.hands = [P(13.0, sh + 5.2), P(12.4, sh + 5.0)];
      else r.hands = [P(7.2, sh + 5.0), P(16.8, sh + 5.0)];
      break;
    default:
      break;
  }
  // itens de duas mãos sem pose própria: no peito
  if (TWO_HANDED.has(r.item) && (pose === 'stand' || pose === 'walk' || pose === 'run' || pose === 'sit' || pose === 'talk')) {
    both(P(10.2, sh + 3.0), P(13.8, sh + 3.0), P(16.0, sh + 3.0));
    r.itemAt = side ? 0 : 'mid';
  }
  // itens de uma mão: na mão principal (de lado, a de perto)
  if (side && r.itemAt === 1 && pose !== 'wait') r.itemAt = 0;
  return r;
}

// ---------------------------------------------------------------- cabelo

type HairKind = 'long' | 'wavy' | 'bob' | 'ponytail' | 'pigtails' | 'bun' | 'curly' | 'afro' | 'short' | 'side_part' | 'buzz' | 'spiky' | 'bald';

function hairKind(a: Appearance): HairKind {
  switch (a.hairStyle) {
    case 'mohawk': return 'spiky';
    default: return a.hairStyle;
  }
}

/** Contorno da cabeça (de frente/costas), com queixo levemente afinado. */
function headPath(g: Ctx, cx: number, top: number, grow = 0): void {
  const l = cx - 6.3 - grow;
  const r = cx + 6.3 + grow;
  const t = top - grow;
  const b = top + 12.4 + grow * 0.6;
  const mid = top + 6.4;
  g.beginPath();
  g.moveTo(cx, t);
  g.bezierCurveTo(cx + 4.3, t, r + 0.1, top + 2.8, r, mid);
  g.bezierCurveTo(r - 0.1, top + 9.8, cx + 3.6, b, cx, b);
  g.bezierCurveTo(cx - 3.6, b, l + 0.1, top + 9.8, l, mid);
  g.bezierCurveTo(l - 0.1, top + 2.8, cx - 4.3, t, cx, t);
  g.closePath();
}

/** Cabeça de perfil (olhando para a direita): nuca arredondada, testa e bochecha mais retas. */
function headSidePath(g: Ctx, cx: number, top: number): void {
  g.beginPath();
  g.moveTo(cx + 0.4, top);
  g.bezierCurveTo(cx + 4.4, top, cx + 6.3, top + 2.6, cx + 6.1, top + 6.2);
  g.quadraticCurveTo(cx + 6.05, top + 7.6, cx + 6.2, top + 8.3);
  g.quadraticCurveTo(cx + 6.7, top + 9.0, cx + 5.9, top + 9.3);
  g.quadraticCurveTo(cx + 5.6, top + 9.6, cx + 5.4, top + 10.0);
  g.bezierCurveTo(cx + 4.6, top + 11.8, cx + 2.4, top + 12.4, cx + 0.4, top + 12.4);
  g.bezierCurveTo(cx - 3.8, top + 12.4, cx - 6.2, top + 9.6, cx - 6.2, top + 6.2);
  g.bezierCurveTo(cx - 6.2, top + 2.6, cx - 3.6, top, cx + 0.4, top);
  g.closePath();
}

function hairPaint(g: Ctx, p: Pal, box: [number, number, number, number]): void {
  paint(g, p.hair, p.hairLine, box);
}

/** Brilho do cabelo: arcos claros no alto, do lado da luz. */
function hairShine(g: Ctx, p: Pal, cx: number, cy: number, rad: number, from: number, to: number): void {
  g.lineCap = 'round';
  g.strokeStyle = p.hairLight;
  g.lineWidth = 0.75;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.arc(cx, cy, rad, from, to);
  g.stroke();
  g.lineWidth = 0.45;
  g.beginPath();
  g.arc(cx, cy, rad - 1.2, from + 0.25, to - 0.05);
  g.stroke();
  g.globalAlpha = 1;
}

/** Cachos: um contorno de bolinhas ao redor de um centro. */
function curlsPath(g: Ctx, cx: number, cy: number, rx: number, ry: number, n: number, bump: number, from = 0, to = Math.PI * 2): void {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (i === 0) g.moveTo(x, y);
    else {
      const am = from + ((to - from) * (i - 0.5)) / n;
      g.quadraticCurveTo(cx + Math.cos(am) * (rx + bump), cy + Math.sin(am) * (ry + bump), x, y);
    }
  }
  g.closePath();
}

/** Camada de cabelo que fica ATRÁS da cabeça (e do corpo, de frente). */
function hairBack(g: Ctx, a: Appearance, p: Pal, facing: Facing, top: number): void {
  const k = hairKind(a);
  const cx = 12;
  if (facing === 'front') {
    if (k === 'long' || k === 'wavy') {
      const bottom = top + (k === 'long' ? 19 : 18);
      g.beginPath();
      g.moveTo(cx - 6.4, top + 3.6);
      if (k === 'wavy') {
        g.bezierCurveTo(cx - 8.6, top + 7, cx - 6.4, top + 10, cx - 7.9, top + 13);
        g.bezierCurveTo(cx - 9.1, top + 15.5, cx - 6.6, top + 16.4, cx - 7.6, bottom);
      } else {
        g.bezierCurveTo(cx - 8.4, top + 8, cx - 8.2, top + 14, cx - 7.6, bottom);
      }
      g.quadraticCurveTo(cx, bottom + 1.6, cx + 7.6, bottom);
      if (k === 'wavy') {
        g.bezierCurveTo(cx + 6.6, top + 16.4, cx + 9.1, top + 15.5, cx + 7.9, top + 13);
        g.bezierCurveTo(cx + 6.4, top + 10, cx + 8.6, top + 7, cx + 6.4, top + 3.6);
      } else {
        g.bezierCurveTo(cx + 8.2, top + 14, cx + 8.4, top + 8, cx + 6.4, top + 3.6);
      }
      g.closePath();
      paint(g, p.hairShade, p.hairLine, [cx - 8, top, cx + 8, bottom]);
    } else if (k === 'bob') {
      g.beginPath();
      g.moveTo(cx - 6.4, top + 3.4);
      g.bezierCurveTo(cx - 8.2, top + 6, cx - 8.4, top + 10.4, cx - 7.8, top + 12.4);
      g.quadraticCurveTo(cx - 7.4, top + 13.6, cx - 5.6, top + 13.2);
      g.lineTo(cx + 5.6, top + 13.2);
      g.quadraticCurveTo(cx + 7.4, top + 13.6, cx + 7.8, top + 12.4);
      g.bezierCurveTo(cx + 8.4, top + 10.4, cx + 8.2, top + 6, cx + 6.4, top + 3.4);
      g.closePath();
      paint(g, p.hairShade, p.hairLine, [cx - 8, top, cx + 8, top + 14]);
    } else if (k === 'ponytail' || k === 'pigtails') {
      const sides = k === 'pigtails' ? [-1, 1] : [1];
      for (const s of sides) {
        g.beginPath();
        g.moveTo(cx + s * 5.6, top + 4.2);
        g.bezierCurveTo(cx + s * 9.6, top + 4.6, cx + s * 9.8, top + 10.4, cx + s * 8.2, top + 13.6);
        g.quadraticCurveTo(cx + s * 7.4, top + 10.6, cx + s * 6.0, top + 8.6);
        g.closePath();
        paint(g, p.hairShade, p.hairLine, [cx + s * 6, top + 4, cx + s * 9, top + 14]);
      }
    } else if (k === 'afro') {
      curlsPath(g, cx, top + 5.8, 8.4, 7.6, 14, 0.9);
      paint(g, p.hairShade, p.hairLine, [cx - 8, top - 2, cx + 8, top + 13]);
    } else if (k === 'curly') {
      curlsPath(g, cx, top + 7.6, 8.0, 8.4, 13, 0.8, Math.PI * 0.05, Math.PI * 0.95 + Math.PI);
      paint(g, p.hairShade, p.hairLine, [cx - 8, top, cx + 8, top + 16]);
    }
    if (k === 'bun') {
      ellipse(g, cx, top - 0.6, 2.9, 2.6);
      hairPaint(g, p, [cx - 3, top - 3, cx + 3, top + 2]);
    }
    return;
  }
  if (facing === 'side') {
    if (k === 'ponytail' || k === 'pigtails') {
      g.beginPath();
      g.moveTo(cx - 4.4, top + 3.8);
      g.bezierCurveTo(cx - 9.2, top + 3.6, cx - 9.4, top + 10, cx - 7.6, top + 14.4);
      g.quadraticCurveTo(cx - 6.4, top + 9.6, cx - 4.6, top + 7.4);
      g.closePath();
      paint(g, p.hairShade, p.hairLine, [cx - 9, top + 3, cx - 4, top + 14]);
    } else if (k === 'bun') {
      ellipse(g, cx - 5.2, top + 1.8, 2.7, 2.5);
      hairPaint(g, p, [cx - 8, top - 1, cx - 2.5, top + 4.5]);
    } else if (k === 'afro') {
      curlsPath(g, cx - 0.4, top + 5.8, 8.2, 7.6, 14, 0.9);
      paint(g, p.hairShade, p.hairLine, [cx - 8, top - 2, cx + 8, top + 13]);
    } else if (k === 'curly') {
      // volume de cachos atrás da nuca, até os ombros
      curlsPath(g, cx - 2.2, top + 8.2, 6.0, 7.4, 12, 0.8);
      paint(g, p.hairShade, p.hairLine, [cx - 8, top + 1, cx + 4, top + 16]);
    }
  }
}

/** Mechas compridas que caem por cima das costas (de costas e de lado): desenhadas depois do tronco. */
function hairOverBack(g: Ctx, a: Appearance, p: Pal, facing: Facing, top: number): void {
  const k = hairKind(a);
  const cx = 12;
  if (facing === 'back' && (k === 'long' || k === 'wavy')) {
    const bottom = top + (k === 'long' ? 19 : 18);
    g.beginPath();
    g.moveTo(cx - 6.7, top + 6.4);
    g.bezierCurveTo(cx - 8.2, top + 11, cx - 7.8, top + 15, cx - 7.0, bottom);
    g.quadraticCurveTo(cx, bottom + 1.8, cx + 7.0, bottom);
    g.bezierCurveTo(cx + 7.8, top + 15, cx + 8.2, top + 11, cx + 6.7, top + 6.4);
    g.closePath();
    paint(g, p.hair, p.hairLine, [cx - 8, top + 4, cx + 8, bottom]);
    // mechas
    g.strokeStyle = p.hairShade;
    g.lineWidth = 0.45;
    for (const dx of [-3.4, 0, 3.4]) {
      g.beginPath();
      g.moveTo(cx + dx * 0.7, top + 10);
      g.quadraticCurveTo(cx + dx * 1.1, top + 15, cx + dx, bottom - 0.4);
      g.stroke();
    }
  }
  if (facing === 'back' && k === 'curly') {
    curlsPath(g, cx, top + 9.4, 7.8, 6.4, 13, 0.8);
    paint(g, p.hairShade, p.hairLine, [cx - 8, top + 3, cx + 8, top + 16]);
  }
  if (facing === 'back' && (k === 'ponytail' || k === 'pigtails')) {
    const sides = k === 'pigtails' ? [-3.2, 3.2] : [0];
    for (const dx of sides) {
      g.beginPath();
      g.moveTo(cx + dx - 1.6, top + 8.4);
      g.bezierCurveTo(cx + dx - 3.0, top + 12, cx + dx - 1.4, top + 16, cx + dx, top + 17.6);
      g.bezierCurveTo(cx + dx + 1.4, top + 16, cx + dx + 3.0, top + 12, cx + dx + 1.6, top + 8.4);
      g.closePath();
      paint(g, p.hair, p.hairLine, [cx + dx - 3, top + 8, cx + dx + 3, top + 18]);
      dot(g, cx + dx, top + 8.6, 1.1, p.item);
    }
  }
  if (facing === 'side' && (k === 'long' || k === 'wavy')) {
    const bottom = top + (k === 'long' ? 19 : 18);
    g.beginPath();
    g.moveTo(cx - 5.6, top + 4);
    g.bezierCurveTo(cx - 8.0, top + 9, cx - 7.4, top + 14, cx - 6.6, bottom);
    g.quadraticCurveTo(cx - 3.6, bottom + 1, cx - 1.6, bottom - 0.6);
    g.bezierCurveTo(cx - 2.8, top + 14, cx - 1.6, top + 10, cx + 0.6, top + 9);
    g.closePath();
    paint(g, p.hair, p.hairLine, [cx - 8, top + 4, cx, bottom]);
  }
}

/** Cabelo por cima da cabeça: topo, franja, laterais. */
function hairFront(g: Ctx, a: Appearance, p: Pal, facing: Facing, top: number): void {
  const k = hairKind(a);
  if (k === 'bald') return;
  const cx = 12;
  const t = top - 1.1;
  if (facing === 'back') {
    // a nuca: cabelo curto deixa a pele aparecer embaixo
    const long = k === 'long' || k === 'wavy';
    const low = k === 'short' || k === 'side_part' || k === 'buzz' || k === 'spiky' ? top + 9.6 : long ? top + 13.4 : top + 11.6;
    g.beginPath();
    g.moveTo(cx - 6.7, top + 6.6);
    g.bezierCurveTo(cx - 6.9, top + 2, cx - 3.8, t, cx, t);
    g.bezierCurveTo(cx + 3.8, t, cx + 6.9, top + 2, cx + 6.7, top + 6.6);
    g.bezierCurveTo(cx + 6.6, low - 1.2, cx + 3.6, low + 0.8, cx, low + 0.4);
    g.bezierCurveTo(cx - 3.6, low + 0.8, cx - 6.6, low - 1.2, cx - 6.7, top + 6.6);
    g.closePath();
    if (k === 'curly' || k === 'afro') curlsPath(g, cx, top + 5.2, 7.2, 6.8, 12, 0.7);
    if (k === 'long' || k === 'wavy') {
      // cabelo comprido: o topo continua nas mechas das costas (mesmo degradê), sem a linha da nuca
      paint(g, p.hair, p.hairLine, [cx - 8, top + 4, cx + 8, top + 19], { lw: 0 });
      g.beginPath();
      g.moveTo(cx - 6.7, top + 6.6);
      g.bezierCurveTo(cx - 6.9, top + 2, cx - 3.8, t, cx, t);
      g.bezierCurveTo(cx + 3.8, t, cx + 6.9, top + 2, cx + 6.7, top + 6.6);
      g.lineWidth = LINE;
      g.strokeStyle = p.hairLine;
      g.stroke();
    } else paint(g, k === 'buzz' ? mix(p.hair, p.skin, 0.35) : p.hair, p.hairLine, [cx - 7, t, cx + 7, low]);
    hairShine(g, p, cx, top + 6.2, 5.6, Math.PI * 1.15, Math.PI * 1.45);
    if (k === 'bun') {
      ellipse(g, cx, top + 1.2, 2.9, 2.6);
      hairPaint(g, p, [cx - 3, top - 1.5, cx + 3, top + 4]);
    }
    return;
  }
  if (facing === 'side') {
    g.beginPath();
    // franja na testa, topo, nuca e volta pela orelha
    g.moveTo(cx + 5.6, top + 5.4);
    g.bezierCurveTo(cx + 6.2, top + 1.2, cx + 3.0, t, cx - 0.2, t);
    g.bezierCurveTo(cx - 4.6, t, cx - 7.0, top + 2.6, cx - 6.6, top + 7.2);
    const nape = k === 'short' || k === 'side_part' || k === 'buzz' || k === 'spiky' ? top + 9.4 : top + 11.2;
    g.bezierCurveTo(cx - 6.4, nape, cx - 4.6, nape + 0.8, cx - 2.6, nape);
    g.quadraticCurveTo(cx - 1.4, top + 7.6, cx + 0.2, top + 5.6);
    g.quadraticCurveTo(cx + 2.6, top + 4.6, cx + 3.2, top + 6.2);
    g.quadraticCurveTo(cx + 4.4, top + 4.4, cx + 5.6, top + 5.4);
    g.closePath();
    paint(g, k === 'buzz' ? mix(p.hair, p.skin, 0.35) : p.hair, p.hairLine, [cx - 7, t, cx + 6, top + 11]);
    hairShine(g, p, cx - 0.4, top + 6.2, 5.4, Math.PI * 1.2, Math.PI * 1.55);
    if (k === 'bob') {
      g.beginPath();
      g.moveTo(cx - 6.5, top + 7);
      g.bezierCurveTo(cx - 6.8, top + 11, cx - 5.2, top + 13.4, cx - 2.2, top + 13.2);
      g.quadraticCurveTo(cx - 1.0, top + 10.6, cx - 2.4, top + 8.6);
      g.closePath();
      paint(g, p.hair, p.hairLine, [cx - 7, top + 7, cx - 1, top + 13]);
    }
    return;
  }
  // de frente
  if (k === 'curly' || k === 'afro') {
    curlsPath(g, cx, top + 4.4, 6.9, 4.6, 11, 0.85, Math.PI * 0.92, Math.PI * 2.08);
    // curlsPath fecha com uma reta; troca por uma linha do cabelo em arco, com cachinhos
    g.beginPath();
    const n = 11;
    const from = Math.PI * 0.92;
    const to = Math.PI * 2.08;
    for (let i = 0; i <= n; i++) {
      const ang = from + ((to - from) * i) / n;
      const x = cx + Math.cos(ang) * 6.9;
      const y = top + 4.4 + Math.sin(ang) * 4.6;
      if (i === 0) g.moveTo(x, y);
      else {
        const am = from + ((to - from) * (i - 0.5)) / n;
        g.quadraticCurveTo(cx + Math.cos(am) * 7.75, top + 4.4 + Math.sin(am) * 5.45, x, y);
      }
    }
    const ex = cx + Math.cos(to) * 6.9;
    const sx = cx + Math.cos(from) * 6.9;
    const ey = top + 4.4 + Math.sin(to) * 4.6;
    for (let i = 1; i <= 4; i++) {
      const x0 = ex + ((sx - ex) * (i - 1)) / 4;
      const x1 = ex + ((sx - ex) * i) / 4;
      const arch = Math.sin((Math.PI * (i - 0.5)) / 4) * 1.6;
      g.quadraticCurveTo((x0 + x1) / 2, ey + 0.9 - arch, x1, ey - Math.sin((Math.PI * i) / 4) * 1.3);
    }
    g.closePath();
    paint(g, p.hair, p.hairLine, [cx - 7, t, cx + 7, top + 8]);
    hairShine(g, p, cx, top + 6.6, 5.6, Math.PI * 1.2, Math.PI * 1.5);
    return;
  }
  const L = cx - 6.7;
  const R = cx + 6.7;
  g.beginPath();
  g.moveTo(L, top + 7.6);
  g.bezierCurveTo(L - 0.4, top + 1.6, cx - 3.6, t, cx, t);
  g.bezierCurveTo(cx + 3.6, t, R + 0.4, top + 1.6, R, top + 7.6);
  switch (k) {
    case 'long':
    case 'wavy':
      // risca no meio, cortina dos dois lados do rosto
      g.bezierCurveTo(R - 0.2, top + 9.6, R + 0.2, top + 11.6, R - 0.6, top + 12.6);
      g.quadraticCurveTo(R - 1.6, top + 8.0, cx + 2.2, top + 3.6);
      g.quadraticCurveTo(cx, top + 2.4, cx - 0.6, top + 3.2);
      g.quadraticCurveTo(cx - 2.6, top + 3.8, cx - 4.4, top + 6.4);
      g.quadraticCurveTo(L + 0.6, top + 9.0, L + 0.6, top + 12.6);
      g.bezierCurveTo(L - 0.2, top + 11.6, L + 0.2, top + 9.6, L, top + 7.6);
      break;
    case 'bob':
      // franja reta, um pouco irregular
      g.lineTo(R, top + 12.0);
      g.quadraticCurveTo(R - 0.8, top + 9.6, R - 1.4, top + 5.2);
      for (let i = 0; i < 5; i++) {
        const x0 = R - 1.4 - (i * (R - L - 2.8)) / 5;
        const x1 = R - 1.4 - ((i + 1) * (R - L - 2.8)) / 5;
        g.quadraticCurveTo((x0 + x1) / 2, top + 5.9 + (i % 2) * 0.3, x1, top + 5.0);
      }
      g.quadraticCurveTo(L + 0.8, top + 9.6, L, top + 12.0);
      g.closePath();
      break;
    case 'ponytail':
    case 'pigtails':
    case 'bun':
      // franja de lado, varrida para a esquerda
      g.quadraticCurveTo(R - 0.4, top + 6.0, R - 1.6, top + 4.6);
      g.bezierCurveTo(cx + 2.4, top + 4.4, cx - 2.8, top + 4.6, L + 1.2, top + 8.4);
      g.quadraticCurveTo(L + 0.2, top + 8.4, L, top + 7.6);
      break;
    case 'side_part':
      g.quadraticCurveTo(R - 0.2, top + 4.8, R - 1.4, top + 3.6);
      g.bezierCurveTo(cx + 2.4, top + 2.6, cx - 1.6, top + 3.4, cx - 2.6, top + 2.6);
      g.quadraticCurveTo(cx - 4.8, top + 3.0, L + 0.6, top + 6.0);
      g.lineTo(L, top + 7.6);
      break;
    case 'spiky':
      for (const [x, y] of [[R - 1.2, top + 3.4], [cx + 3.2, top + 4.2], [cx + 1.6, top + 2.8], [cx - 0.6, top + 4.0], [cx - 2.6, top + 2.8], [cx - 4.0, top + 4.2], [L + 1.0, top + 3.6]]) {
        g.lineTo(x, y);
        g.lineTo(x - 0.9, y + 1.4);
      }
      g.lineTo(L, top + 7.6);
      break;
    default:
      // curto: franjinha irregular
      g.quadraticCurveTo(R - 0.3, top + 5.2, R - 1.6, top + 4.4);
      g.quadraticCurveTo(cx + 3.2, top + 4.8, cx + 2.2, top + 3.8);
      g.quadraticCurveTo(cx + 0.6, top + 4.6, cx - 0.6, top + 3.6);
      g.quadraticCurveTo(cx - 2.6, top + 4.8, cx - 3.6, top + 3.8);
      g.quadraticCurveTo(L + 1.0, top + 4.6, L + 0.3, top + 6.4);
      g.lineTo(L, top + 7.6);
  }
  g.closePath();
  paint(g, k === 'buzz' ? mix(p.hair, p.skin, 0.35) : p.hair, p.hairLine, [cx - 7, t, cx + 7, top + 12]);
  hairShine(g, p, cx, top + 6.4, 5.7, Math.PI * 1.13, Math.PI * 1.42);
  if (k === 'ponytail' || k === 'pigtails') {
    // prendedor aparecendo atrás da cabeça
    for (const s of k === 'pigtails' ? [-1, 1] : [1]) dot(g, cx + s * 6.2, top + 4.6, 0.85, p.item);
  }
}

// ---------------------------------------------------------------- rosto

function face(g: Ctx, a: Appearance, p: Pal, top: number, side: boolean, eyesKind: Eyes = 'open', mouth: Mouth = 'auto'): void {
  const f = a.look === 'f';
  const eyeY = top + 7.2;
  const eyes = side ? [15.9] : [9.5, 14.5];
  // bochechas
  g.fillStyle = p.blush;
  for (const x of side ? [15.1] : [8.5, 15.5]) {
    ellipse(g, x, top + 9.4, f ? 1.25 : 1.0, 0.62);
    g.fill();
  }
  // sobrancelhas
  g.strokeStyle = shade(a.hair, -0.25);
  g.lineCap = 'round';
  g.lineWidth = f ? 0.32 : 0.46;
  for (const x of eyes) {
    const inner = side ? -1 : x < 12 ? 1 : -1;
    g.beginPath();
    g.moveTo(x - inner * 1.1, eyeY - 2.15);
    g.quadraticCurveTo(x, eyeY - (f ? 2.95 : 2.75), x + inner * 1.05, eyeY - 2.5);
    g.stroke();
  }
  // olhos fechados (cochilo, espreguiçada) ou felizes (^ ^): só o traço da pálpebra
  if (eyesKind === 'closed' || eyesKind === 'happy') {
    g.strokeStyle = p.eyeDark;
    g.lineWidth = 0.42;
    for (const x of eyes) {
      const w = side ? 0.85 : 1.1;
      g.beginPath();
      g.moveTo(x - w, eyeY + (eyesKind === 'happy' ? 0.3 : -0.1));
      g.quadraticCurveTo(x, eyeY + (eyesKind === 'happy' ? -1.0 : 0.8), x + w, eyeY + (eyesKind === 'happy' ? 0.3 : -0.1));
      g.stroke();
    }
  }
  // olhos: forma escura, íris embaixo, brilhos
  for (const x of eyesKind === 'closed' || eyesKind === 'happy' ? [] : eyes) {
    const rx = side ? 0.85 : 1.1;
    ellipse(g, x, eyeY, rx, f ? 1.55 : 1.4);
    g.fillStyle = p.eyeDark;
    g.fill();
    ellipse(g, x, eyeY + 0.5, rx * 0.78, 0.85);
    g.fillStyle = mix(p.iris, '#ffffff', 0.12);
    g.fill();
    dot(g, x - 0.38, eyeY - 0.55, 0.42, '#ffffff');
    dot(g, x + 0.42, eyeY + 0.62, 0.2, 'rgba(255,255,255,0.85)');
    if (eyesKind === 'half') {
      // pálpebra caída (chateado): pele cobre a metade de cima
      g.beginPath();
      g.ellipse(x, eyeY - 0.9, rx + 0.25, 1.1, 0, 0, Math.PI * 2);
      g.fillStyle = p.skin;
      g.fill();
      g.strokeStyle = p.eyeDark;
      g.lineWidth = 0.4;
      g.beginPath();
      g.moveTo(x - rx, eyeY + 0.05);
      g.lineTo(x + rx, eyeY + 0.05);
      g.stroke();
      continue;
    }
    if (f) {
      // cílios: pálpebra superior grossa com a pontinha para fora
      g.strokeStyle = p.eyeDark;
      g.lineWidth = 0.42;
      g.beginPath();
      g.moveTo(x - 1.25, eyeY - 0.8);
      g.quadraticCurveTo(x, eyeY - 2.0, x + 1.25, eyeY - 0.8);
      g.stroke();
      const out = side || x > 12 ? 1 : -1;
      g.lineWidth = 0.32;
      g.beginPath();
      g.moveTo(x + out * 1.15, eyeY - 0.95);
      g.quadraticCurveTo(x + out * 1.6, eyeY - 1.1, x + out * 1.8, eyeY - 1.45);
      g.stroke();
    }
  }
  // nariz e boca
  g.strokeStyle = p.skinLine;
  g.lineWidth = 0.32;
  g.globalAlpha = 0.6;
  if (!side) {
    g.beginPath();
    g.moveTo(12.15, top + 8.9);
    g.lineTo(11.95, top + 9.3);
    g.stroke();
  }
  g.globalAlpha = 1;
  const mx = side ? 16.5 : 12;
  const my = top + 10.6;
  if (mouth === 'open' || mouth === 'o') {
    // boca aberta (falando, comemorando, rindo) ou em "o" (espreguiçando, concentrado)
    const big = mouth === 'open';
    ellipse(g, mx, my + 0.1, side ? (big ? 0.6 : 0.4) : big ? 1.0 : 0.5, big ? 0.75 : 0.5);
    g.fillStyle = '#7a2e3a';
    g.fill();
    if (big) {
      ellipse(g, mx, my + 0.45, side ? 0.4 : 0.6, 0.3);
      g.fillStyle = '#e07a85';
      g.fill();
    }
    return;
  }
  if (mouth === 'smile' || mouth === 'frown') {
    g.strokeStyle = p.skinLine;
    g.lineWidth = 0.38;
    g.beginPath();
    const d = mouth === 'smile' ? 0.6 : -0.45;
    g.moveTo(mx - (side ? 0.5 : 0.9), my - d * 0.3);
    g.quadraticCurveTo(mx, my + d, mx + (side ? 0.5 : 0.9), my - d * 0.3);
    g.stroke();
    return;
  }
  if (f) {
    ellipse(g, mx, my, side ? 0.55 : 0.85, 0.42);
    g.fillStyle = p.lip;
    g.fill();
    dot(g, mx - 0.25, my - 0.12, 0.16, 'rgba(255,255,255,0.55)');
  } else {
    g.strokeStyle = p.skinLine;
    g.lineWidth = 0.38;
    g.beginPath();
    g.moveTo(mx - (side ? 0.5 : 0.8), my - 0.1);
    g.quadraticCurveTo(mx, my + 0.45, mx + (side ? 0.5 : 0.8), my - 0.1);
    g.stroke();
  }
}

function facialHair(g: Ctx, a: Appearance, p: Pal, top: number, side: boolean): void {
  const fh = a.facialHair ?? 'none';
  if (fh === 'none' || a.look !== 'm') return;
  const c = shade(a.hair, -0.05);
  const cx = side ? 15.4 : 12;
  if (fh === 'stubble' || fh === 'beard') {
    g.beginPath();
    if (side) {
      g.moveTo(12.4, top + 8.8);
      g.quadraticCurveTo(13.0, top + 12.2, 15.8, top + 12.3);
      g.quadraticCurveTo(17.0, top + 11.8, 17.4, top + 10.9);
      g.quadraticCurveTo(15.2, top + 11.0, 13.8, top + 9.2);
    } else {
      g.moveTo(6.2, top + 8.2);
      g.bezierCurveTo(6.8, top + 11.2, 9.2, top + 12.5, 12, top + 12.5);
      g.bezierCurveTo(14.8, top + 12.5, 17.2, top + 11.2, 17.8, top + 8.2);
      g.bezierCurveTo(16.8, top + 10.8, 14.6, top + 11.0, 12, top + 11.2);
      g.bezierCurveTo(9.4, top + 11.0, 7.2, top + 10.8, 6.2, top + 8.2);
    }
    g.closePath();
    g.fillStyle = fh === 'stubble' ? mix(p.skin, c, 0.2) : c;
    g.fill();
    if (fh === 'beard') {
      g.strokeStyle = p.hairLine;
      g.lineWidth = LINE;
      g.stroke();
    }
  }
  if (fh === 'mustache' || fh === 'beard' || fh === 'goatee') {
    const mx = cx + (side ? 1.1 : 0);
    const my = top + 10.05;
    g.fillStyle = mix(c, p.skin, 0.12);
    for (const s of side ? [1] : [-1, 1]) {
      g.beginPath();
      g.moveTo(mx, my - 0.25);
      g.quadraticCurveTo(mx + s * 1.0, my - 0.55, mx + s * (side ? 1.0 : 1.75), my + 0.25);
      g.quadraticCurveTo(mx + s * 0.9, my + 0.05, mx, my + 0.12);
      g.closePath();
      g.fill();
    }
  }
  if (fh === 'goatee') {
    g.beginPath();
    const gx = cx + (side ? 1.0 : 0);
    g.moveTo(gx - 0.7, top + 11.25);
    g.quadraticCurveTo(gx, top + 12.6, gx + 0.7, top + 11.25);
    g.quadraticCurveTo(gx, top + 11.6, gx - 0.7, top + 11.25);
    g.fillStyle = mix(c, p.skin, 0.12);
    g.fill();
  }
}

function accessory(g: Ctx, a: Appearance, p: Pal, top: number, facing: Facing): void {
  const eyeY = top + 7.2;
  switch (a.accessory) {
    case 'glasses':
    case 'sunglasses': {
      const sun = a.accessory === 'sunglasses';
      g.strokeStyle = sun ? '#1d1e26' : p.item;
      g.lineWidth = 0.42;
      const lens = (x: number) => {
        g.beginPath();
        g.roundRect(x - 1.75, eyeY - 1.35, 3.5, 2.8, 1.2);
        if (sun) {
          g.fillStyle = 'rgba(25,26,36,0.88)';
          g.fill();
        } else {
          g.fillStyle = 'rgba(200,230,255,0.18)';
          g.fill();
        }
        g.stroke();
      };
      if (facing === 'front') {
        lens(9.5);
        lens(14.5);
        g.beginPath();
        g.moveTo(11.25, eyeY - 0.4);
        g.quadraticCurveTo(12, eyeY - 0.9, 12.75, eyeY - 0.4);
        g.stroke();
      } else if (facing === 'side') {
        lens(17.0);
        g.beginPath();
        g.moveTo(15.25, eyeY - 0.5);
        g.lineTo(12.2, eyeY - 0.2);
        g.stroke();
      }
      return;
    }
    case 'earrings':
      if (facing !== 'back') for (const x of facing === 'side' ? [11.6] : [5.8, 18.2]) dot(g, x, top + 9.1, 0.55, p.item);
      return;
    case 'bow': {
      const x = facing === 'side' ? 9.6 : facing === 'back' ? 14.6 : 16.2;
      const y = top + 0.9;
      g.fillStyle = p.item;
      g.strokeStyle = line(p.item);
      g.lineWidth = 0.4;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + s * 2.2, y - 2.0, x + s * 2.4, y + 0.2);
        g.quadraticCurveTo(x + s * 1.6, y + 1.4, x, y);
        g.fill();
        g.stroke();
      }
      dot(g, x, y, 0.55, shade(p.item, -0.1));
      return;
    }
    case 'headphones': {
      g.strokeStyle = line(p.item);
      g.lineWidth = 1.0;
      g.beginPath();
      g.arc(12, top + 6.6, 7.1, Math.PI * 1.08, Math.PI * 1.92);
      g.stroke();
      g.strokeStyle = p.item;
      g.lineWidth = 0.6;
      g.stroke();
      for (const x of facing === 'side' ? [11.2] : facing === 'back' ? [5.6, 18.4] : [5.6, 18.4]) {
        g.beginPath();
        g.roundRect(x - 1.1, top + 6.0, 2.2, 3.4, 1.0);
        paint(g, p.item, line(p.item), [x - 1, top + 6, x + 1, top + 9.4]);
      }
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------- corpo

function longSleeves(a: Appearance): boolean {
  return a.topStyle === 'hoodie' || a.topStyle === 'sweater' || a.topStyle === 'shirt_tie' || a.topStyle === 'jacket';
}

function sleeveColor(a: Appearance): string {
  return a.topStyle === 'jacket' ? a.top : a.top;
}

/** Braço: manga (curta ou comprida), mão redonda. */
function arm(g: Ctx, a: Appearance, p: Pal, sx: number, sy: number, hx: number, hy: number, far = false, hand: Hand = 'open'): void {
  const sleeve = far ? shade(sleeveColor(a), -0.06) : sleeveColor(a);
  const skin = far ? p.skinShade : p.skin;
  if (longSleeves(a)) {
    limb(g, sx, sy, hx, hy - 0.4, 1.2, sleeve, p.topLine);
    if (a.topStyle === 'sweater' || a.topStyle === 'hoodie') {
      // punho canelado
      g.strokeStyle = shade(sleeve, -0.12);
      g.lineWidth = 0.5;
      g.beginPath();
      g.moveTo(hx - 1.1, hy - 0.9);
      g.lineTo(hx + 1.1, hy - 0.9);
      g.stroke();
    }
  } else {
    limb(g, sx, sy, hx, hy - 0.4, 1.02, skin, p.skinLine);
    const mx = sx + (hx - sx) * 0.42;
    const my = sy + (hy - sy) * 0.42;
    limb(g, sx, sy, mx, my, a.topStyle === 'blouse' ? 1.45 : 1.3, sleeve, p.topLine);
  }
  handShape(g, p, { x: hx, y: hy }, hand, skin);
}

/** Tronco de frente/costas, com cintura para o look 'f'. */
function torsoPath(g: Ctx, a: Appearance, y: number, side: boolean): void {
  const f = a.look === 'f';
  g.beginPath();
  if (side) {
    g.moveTo(9.6, y + 0.6);
    g.quadraticCurveTo(12.2, y - 0.2, 14.4, y + 0.6);
    g.quadraticCurveTo(15.6, y + 1.6, 15.0, y + 3.8);
    g.lineTo(f ? 14.4 : 14.8, y + 4.8);
    g.quadraticCurveTo(15.1, y + 6.4, 14.9, y + 7.0);
    g.lineTo(9.4, y + 7.0);
    g.quadraticCurveTo(9.0, y + 4.0, 9.6, y + 0.6);
  } else {
    const w = f ? 0.9 : 0.3;
    g.moveTo(8.2, y + 0.2);
    g.quadraticCurveTo(12, y - 0.7, 15.8, y + 0.2);
    g.quadraticCurveTo(17.2, y + 0.5, 16.9, y + 2.2);
    g.lineTo(16.6 - w, y + 4.4);
    g.quadraticCurveTo(16.5 - w * 0.2, y + 6.2, 16.5, y + 6.9);
    g.lineTo(7.5, y + 6.9);
    g.quadraticCurveTo(7.5 + w * 0.2, y + 6.2, 7.4 + w, y + 4.4);
    g.lineTo(7.1, y + 2.2);
    g.quadraticCurveTo(6.8, y + 0.5, 8.2, y + 0.2);
  }
  g.closePath();
}

function torsoDetails(g: Ctx, a: Appearance, p: Pal, y: number, facing: Facing): void {
  if (facing === 'back') {
    if (a.topStyle === 'hoodie') {
      g.beginPath();
      g.moveTo(8.6, y + 0.4);
      g.quadraticCurveTo(12, y + 4.2, 15.4, y + 0.4);
      g.quadraticCurveTo(12, y - 0.4, 8.6, y + 0.4);
      paint(g, shade(a.top, -0.06), p.topLine, [8, y, 16, y + 4]);
    }
    return;
  }
  const cx = facing === 'side' ? 14.0 : 12;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (a.topStyle) {
    case 'shirt_tie':
    case 'polo': {
      g.fillStyle = a.topStyle === 'polo' ? shade(a.top, 0.08) : '#f6f6f2';
      g.strokeStyle = p.topLine;
      g.lineWidth = 0.4;
      for (const s of facing === 'side' ? [1] : [-1, 1]) {
        g.beginPath();
        g.moveTo(cx, y + 0.1);
        g.lineTo(cx + s * 2.0, y - 0.1);
        g.lineTo(cx + s * 1.1, y + 1.6);
        g.closePath();
        g.fill();
        g.stroke();
      }
      if (a.topStyle === 'shirt_tie' && facing === 'front') {
        g.beginPath();
        g.moveTo(cx - 0.55, y + 0.5);
        g.lineTo(cx + 0.55, y + 0.5);
        g.lineTo(cx + 0.75, y + 4.6);
        g.lineTo(cx, y + 5.4);
        g.lineTo(cx - 0.75, y + 4.6);
        g.closePath();
        paint(g, a.topAccent, line(a.topAccent), [cx - 1, y, cx + 1, y + 5], { lw: 0.35 });
      }
      if (a.topStyle === 'polo' && facing === 'front') {
        g.strokeStyle = shade(a.top, -0.15);
        g.beginPath();
        g.moveTo(cx, y + 0.8);
        g.lineTo(cx, y + 2.4);
        g.stroke();
        dot(g, cx, y + 1.3, 0.22, '#f4f4f0');
        dot(g, cx, y + 2.1, 0.22, '#f4f4f0');
      }
      return;
    }
    case 'jacket': {
      if (facing !== 'front') return;
      // camisa por dentro, lapelas abertas
      g.beginPath();
      g.moveTo(cx - 2.2, y - 0.1);
      g.lineTo(cx + 2.2, y - 0.1);
      g.lineTo(cx + 1.3, y + 6.9);
      g.lineTo(cx - 1.3, y + 6.9);
      g.closePath();
      paint(g, a.topAccent, line(a.topAccent), [cx - 2, y, cx + 2, y + 7], { flat: true, lw: 0.35 });
      g.strokeStyle = p.topLine;
      g.lineWidth = 0.45;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + s * 2.2, y);
        g.lineTo(cx + s * 1.2, y + 3.0);
        g.lineTo(cx + s * 1.4, y + 6.9);
        g.stroke();
      }
      return;
    }
    case 'hoodie': {
      g.fillStyle = shade(a.top, -0.08);
      g.beginPath();
      g.ellipse(cx, y + 0.5, facing === 'side' ? 1.6 : 2.8, 0.9, 0, 0, Math.PI * 2);
      g.fill();
      if (facing === 'front') {
        g.strokeStyle = a.topAccent;
        g.lineWidth = 0.32;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(cx + s * 0.9, y + 1.0);
          g.lineTo(cx + s * 1.0, y + 3.0);
          g.stroke();
          dot(g, cx + s * 1.0, y + 3.1, 0.25, a.topAccent);
        }
        // bolso canguru
        g.strokeStyle = shade(a.top, -0.16);
        g.lineWidth = 0.4;
        g.beginPath();
        g.moveTo(cx - 2.6, y + 6.6);
        g.lineTo(cx - 2.0, y + 4.6);
        g.lineTo(cx + 2.0, y + 4.6);
        g.lineTo(cx + 2.6, y + 6.6);
        g.stroke();
      }
      return;
    }
    case 'blouse': {
      // decote arredondado
      g.beginPath();
      if (facing === 'side') g.ellipse(cx + 0.6, y + 0.3, 1.0, 1.0, 0, 0, Math.PI);
      else g.ellipse(cx, y + 0.1, 2.3, 1.5, 0, 0, Math.PI);
      g.fillStyle = shade(a.top, -0.02);
      g.fill();
      g.beginPath();
      if (facing === 'side') g.ellipse(cx + 0.6, y + 0.1, 0.8, 0.8, 0, 0, Math.PI);
      else g.ellipse(cx, y - 0.1, 2.0, 1.25, 0, 0, Math.PI);
      g.fillStyle = shade(a.skin, -0.04);
      g.fill();
      return;
    }
    case 'sweater': {
      g.strokeStyle = shade(a.top, -0.12);
      g.lineWidth = 0.55;
      g.beginPath();
      g.moveTo(facing === 'side' ? 9.6 : 7.7, y + 6.3);
      g.lineTo(facing === 'side' ? 14.8 : 16.3, y + 6.3);
      g.stroke();
      g.beginPath();
      if (facing === 'side') g.ellipse(cx + 0.4, y + 0.2, 1.1, 0.7, 0, 0, Math.PI);
      else g.ellipse(cx, y, 2.0, 1.0, 0, 0, Math.PI);
      g.fillStyle = shade(a.skin, -0.04);
      g.fill();
      g.strokeStyle = shade(a.top, -0.14);
      g.lineWidth = 0.4;
      g.stroke();
      return;
    }
    default: {
      // camiseta: gola redonda
      g.beginPath();
      if (facing === 'side') g.ellipse(cx + 0.4, y + 0.1, 1.0, 0.7, 0, 0, Math.PI);
      else g.ellipse(cx, y, 1.8, 0.95, 0, 0, Math.PI);
      g.fillStyle = shade(a.skin, -0.04);
      g.fill();
      g.strokeStyle = shade(a.top, -0.12);
      g.lineWidth = 0.4;
      g.stroke();
    }
  }
}

function lanyard(g: Ctx, a: Appearance, y: number, facing: Facing): void {
  if (!a.lanyard || facing === 'back') return;
  const cx = facing === 'side' ? 13.6 : 12;
  g.strokeStyle = a.lanyard;
  g.lineWidth = 0.4;
  g.beginPath();
  g.moveTo(cx - (facing === 'side' ? 0.4 : 1.8), y + 0.2);
  g.lineTo(cx, y + 3.6);
  if (facing !== 'side') g.lineTo(cx + 1.8, y + 0.2);
  g.stroke();
  g.beginPath();
  g.roundRect(cx - 1.1, y + 3.5, 2.2, 2.6, 0.4);
  paint(g, '#f7f7f4', '#5b6576', [cx - 1, y + 3.5, cx + 1, y + 6], { flat: true, lw: 0.3 });
  g.fillStyle = a.lanyard;
  g.fillRect(cx - 1.1, y + 3.5, 2.2, 0.7);
}

/** Perna (calça, bermuda ou pele com saia) e sapato. `lift` sobe o pé. */
function leg(g: Ctx, a: Appearance, p: Pal, x: number, hipY: number, footY: number, lift: number, far = false): void {
  const bottom = a.bottomStyle ?? 'pants';
  const fy = footY - lift;
  const cloth = far ? shade(p.bottom, -0.06) : p.bottom;
  const skin = far ? p.skinShade : p.skin;
  if (bottom === 'pants') limb(g, x, hipY, x, fy - 0.6, 1.35, cloth, p.bottomLine);
  else {
    limb(g, x, hipY, x, fy - 0.6, 1.05, skin, p.skinLine);
    if (bottom === 'shorts') limb(g, x, hipY, x, hipY + 2.4, 1.45, cloth, p.bottomLine);
  }
  ellipse(g, x + (x < 12 ? -0.25 : 0.25), fy, 1.75, 1.0);
  paint(g, far ? shade(p.shoes, -0.06) : p.shoes, p.shoesLine, [x - 1.7, fy - 1, x + 1.7, fy + 1]);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  ellipse(g, x - 0.6, fy - 0.4, 0.6, 0.3);
  g.fill();
}

function skirt(g: Ctx, p: Pal, y: number, side: boolean): void {
  g.beginPath();
  if (side) {
    g.moveTo(9.4, y);
    g.lineTo(14.9, y);
    g.quadraticCurveTo(16.2, y + 2.6, 16.4, y + 3.6);
    g.quadraticCurveTo(12.4, y + 4.4, 8.6, y + 3.6);
    g.quadraticCurveTo(8.8, y + 2.0, 9.4, y);
  } else {
    g.moveTo(7.6, y);
    g.lineTo(16.4, y);
    g.quadraticCurveTo(17.6, y + 2.4, 18.0, y + 3.6);
    g.quadraticCurveTo(12, y + 4.6, 6.0, y + 3.6);
    g.quadraticCurveTo(6.4, y + 2.4, 7.6, y);
  }
  g.closePath();
  paint(g, p.bottom, p.bottomLine, [6, y, 18, y + 4]);
}

// ---------------------------------------------------------------- mãos e itens

/** Mão no fim do braço: aberta (bolinha), punho, ou gesto do jokenpô. */
function handShape(g: Ctx, p: Pal, h: Pt, kind: Hand, skin: string): void {
  if (kind === 'paper') {
    ellipse(g, h.x, h.y, 1.4, 0.85);
    paint(g, skin, p.skinLine, [h.x - 1.4, h.y - 1, h.x + 1.4, h.y + 1], { lw: 0.36 });
    g.strokeStyle = p.skinLine;
    g.lineWidth = 0.22;
    for (const dx of [-0.5, 0, 0.5]) {
      g.beginPath();
      g.moveTo(h.x + dx, h.y - 0.6);
      g.lineTo(h.x + dx, h.y - 0.1);
      g.stroke();
    }
    return;
  }
  if (kind === 'scissors') {
    for (const s of [-1, 1]) limb(g, h.x, h.y, h.x + s * 0.8, h.y - 1.9, 0.38, skin, p.skinLine);
  }
  const big = kind === 'fist' || kind === 'rock' ? 1.15 : 0.95;
  ellipse(g, h.x, h.y, big, big + 0.05);
  paint(g, skin, p.skinLine, [h.x - 1, h.y - 1, h.x + 1, h.y + 1], { lw: 0.36 });
  if (kind === 'fist' || kind === 'rock') {
    g.strokeStyle = p.skinLine;
    g.lineWidth = 0.22;
    g.beginPath();
    g.moveTo(h.x - 0.6, h.y - 0.2);
    g.lineTo(h.x + 0.6, h.y - 0.2);
    g.stroke();
  }
}

/** Item seguro em (x, y) (centro da mão ou entre as mãos). `side`: visto de perfil. */
function drawItem(g: Ctx, item: HeldItem, x: number, y: number, side: boolean): void {
  const box = (w: number, h: number, fill: string, r = 0.4, dy = 0) => {
    g.beginPath();
    g.roundRect(x - w / 2, y - h / 2 + dy, w, h, r);
    paint(g, fill, line(fill), [x - w / 2, y - h / 2, x + w / 2, y + h / 2], { lw: 0.36 });
  };
  switch (item) {
    case 'coffee':
      box(1.9, 2.3, '#f4f1ea', 0.35, -0.6);
      g.strokeStyle = line('#f4f1ea');
      g.lineWidth = 0.35;
      g.beginPath();
      g.arc(x + 1.2, y - 0.6, 0.6, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.fillStyle = '#6b4630';
      g.fillRect(x - 0.75, y - 1.75, 1.5, 0.35);
      return;
    case 'water':
      box(1.6, 2.4, 'rgba(170,215,245,0.85)', 0.3, -0.6);
      g.fillStyle = 'rgba(90,160,225,0.7)';
      g.fillRect(x - 0.65, y - 0.7, 1.3, 1.2);
      return;
    case 'papers':
      g.save();
      g.translate(x, y);
      g.rotate(-0.12);
      g.translate(-x, -y);
      box(2.8, 3.4, '#fbfbf8', 0.2, -0.4);
      g.strokeStyle = '#b7c0cf';
      g.lineWidth = 0.22;
      for (const dy of [-1.3, -0.6, 0.1]) {
        g.beginPath();
        g.moveTo(x - 0.9, y + dy);
        g.lineTo(x + 0.9, y + dy);
        g.stroke();
      }
      g.restore();
      return;
    case 'book':
      box(side ? 1.6 : 3.4, 2.6, '#c9473f', 0.3, -0.5);
      if (!side) {
        g.fillStyle = '#f4efe3';
        g.fillRect(x - 0.12, y - 1.7, 0.24, 2.4);
      }
      return;
    case 'laptop':
      box(side ? 1.2 : 4.6, side ? 3.0 : 2.0, '#aab3c2', 0.35, -0.4);
      if (!side) dot(g, x, y - 0.4, 0.35, '#f2f4f8');
      return;
    case 'box':
      box(side ? 3.2 : 5.0, 3.4, '#c99a5e', 0.3, -0.6);
      g.strokeStyle = '#a5763f';
      g.lineWidth = 0.3;
      g.beginPath();
      g.moveTo(x - (side ? 1.6 : 2.5), y - 1.4);
      g.lineTo(x + (side ? 1.6 : 2.5), y - 1.4);
      g.stroke();
      return;
    case 'paddle':
      limb(g, x, y, x + 0.4, y - 1.4, 0.3, '#8a5a35', '#4e3320');
      ellipse(g, x + 0.7, y - 2.6, 1.3, 1.5);
      paint(g, '#d9433f', '#7d1f1f', [x - 0.6, y - 4, x + 2, y - 1.2], { lw: 0.36 });
      return;
    case 'popcorn': {
      g.beginPath();
      g.moveTo(x - 1.4, y - 2.0);
      g.lineTo(x + 1.4, y - 2.0);
      g.lineTo(x + 1.0, y + 0.8);
      g.lineTo(x - 1.0, y + 0.8);
      g.closePath();
      paint(g, '#f4f1ea', '#8a2f2f', [x - 1.4, y - 2, x + 1.4, y + 1], { flat: true, lw: 0.34 });
      g.fillStyle = '#d8403b';
      for (const dx of [-0.8, 0.2]) g.fillRect(x + dx, y - 1.9, 0.5, 2.6);
      for (const [dx, dy] of [[-0.8, -2.3], [0, -2.6], [0.8, -2.2], [-0.3, -2.0], [0.5, -2.0]]) dot(g, x + dx, y + dy, 0.45, '#fff3c4');
      return;
    }
    case 'controller':
      g.beginPath();
      g.roundRect(x - (side ? 1.0 : 2.0), y - 0.9, side ? 2.0 : 4.0, 1.6, 0.8);
      paint(g, '#3a3f4f', '#1c1f28', [x - 2, y - 1, x + 2, y + 1], { lw: 0.34 });
      if (!side) {
        dot(g, x + 1.0, y - 0.2, 0.25, '#e2604f');
        dot(g, x - 1.0, y - 0.2, 0.25, '#7cc8ff');
      }
      return;
    case 'phone':
      box(1.3, 2.2, '#22252e', 0.3, -0.5);
      g.fillStyle = '#7cc8ff';
      g.fillRect(x - 0.45, y - 1.35, 0.9, 1.55);
      return;
    case 'lipstick':
      limb(g, x, y - 0.4, x + 0.3, y - 1.6, 0.32, '#d24a6b', '#7a1f36');
      return;
    case 'comb':
      box(2.4, 0.8, '#3b4256', 0.2, -0.6);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------- chapéus e fantasias

/** Boné, gorro (acessórios) e os chapéus das fantasias sazonais. */
function hat(g: Ctx, a: Appearance, p: Pal, req: V2Request, top: number, facing: Facing): void {
  const cx = facing === 'side' ? 11.8 : 12;
  const costume = req.costume;
  if (costume === 'santa') {
    g.beginPath();
    g.moveTo(cx - 6.6, top + 3.0);
    g.bezierCurveTo(cx - 4.6, top - 3.4, cx + 2.4, top - 4.8, cx + 6.4, top - 2.0);
    g.quadraticCurveTo(cx + 5.4, top + 0.2, cx + 6.6, top + 3.0);
    g.closePath();
    paint(g, '#d23b48', '#7d1b26', [cx - 7, top - 5, cx + 7, top + 3]);
    ellipse(g, cx, top + 3.1, 7.1, 1.3);
    paint(g, '#fff6e6', '#b9b2a2', [cx - 7, top + 2, cx + 7, top + 4.4], { flat: true });
    ellipse(g, cx + 6.5, top - 2.1, 1.2, 1.2);
    paint(g, '#fff6e6', '#b9b2a2', [cx + 5, top - 3.3, cx + 8, top - 1], { flat: true });
    return;
  }
  if (costume === 'witch') {
    ellipse(g, cx, top + 2.6, 9.0, 1.7);
    paint(g, '#3e2a55', '#1f1430', [cx - 9, top + 1, cx + 9, top + 4.3]);
    g.beginPath();
    g.moveTo(cx - 4.2, top + 2.4);
    g.quadraticCurveTo(cx - 1.4, top - 2.6, cx + 2.6, top - 6.6);
    g.quadraticCurveTo(cx + 1.6, top - 2.0, cx + 4.2, top + 2.4);
    g.closePath();
    paint(g, '#55387a', '#1f1430', [cx - 4, top - 6.6, cx + 4, top + 2.4]);
    g.strokeStyle = '#e9a548';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(cx - 3.9, top + 1.6);
    g.quadraticCurveTo(cx, top + 2.2, cx + 3.9, top + 1.6);
    g.stroke();
    return;
  }
  if (costume === 'pumpkin') {
    ellipse(g, cx, top + 0.2, 5.0, 3.0);
    paint(g, '#ed963c', '#8d4930', [cx - 5, top - 3, cx + 5, top + 3]);
    g.strokeStyle = '#d0752b';
    g.lineWidth = 0.4;
    for (const dx of [-2.2, 0, 2.2]) {
      g.beginPath();
      g.moveTo(cx + dx, top - 2.6);
      g.quadraticCurveTo(cx + dx * 1.35, top + 0.2, cx + dx, top + 3.0);
      g.stroke();
    }
    limb(g, cx + 0.2, top - 2.8, cx + 0.8, top - 4.2, 0.45, '#47754b', '#2c4a2f');
    return;
  }
  if (a.accessory === 'cap') {
    g.beginPath();
    g.moveTo(cx - 6.8, top + 4.4);
    g.bezierCurveTo(cx - 6.8, top - 1.4, cx + 6.8, top - 1.4, cx + 6.8, top + 4.4);
    g.closePath();
    paint(g, p.item, line(p.item), [cx - 7, top - 1, cx + 7, top + 4.4]);
    if (facing === 'front') {
      ellipse(g, cx, top + 4.6, 5.2, 1.1);
      paint(g, shade(p.item, -0.12), line(p.item), [cx - 5, top + 3.6, cx + 5, top + 5.6], { flat: true });
    } else if (facing === 'side') {
      ellipse(g, cx + 6.4, top + 4.2, 3.0, 0.8);
      paint(g, shade(p.item, -0.12), line(p.item), [cx + 3.4, top + 3.4, cx + 9.4, top + 5], { flat: true });
    }
    dot(g, cx, top - 0.3, 0.5, shade(p.item, -0.15));
    return;
  }
  if (a.accessory === 'beanie') {
    g.beginPath();
    g.moveTo(cx - 6.9, top + 5.0);
    g.bezierCurveTo(cx - 7.2, top - 2.4, cx + 7.2, top - 2.4, cx + 6.9, top + 5.0);
    g.closePath();
    paint(g, p.item, line(p.item), [cx - 7, top - 2, cx + 7, top + 5]);
    g.beginPath();
    g.roundRect(cx - 7.1, top + 3.2, 14.2, 2.2, 1.0);
    paint(g, shade(p.item, -0.1), line(p.item), [cx - 7, top + 3, cx + 7, top + 5.4], { flat: true });
    g.strokeStyle = shade(p.item, -0.2);
    g.lineWidth = 0.25;
    for (let x = cx - 6; x <= cx + 6; x += 1.2) {
      g.beginPath();
      g.moveTo(x, top + 3.5);
      g.lineTo(x, top + 5.1);
      g.stroke();
    }
  }
}

/** Capa do vampiro (atrás do corpo) e a gola alta (por cima dos ombros). */
function cape(g: Ctx, bodyY: number, facing: Facing, part: 'back' | 'collar'): void {
  if (part === 'back') {
    g.beginPath();
    if (facing === 'side') {
      g.moveTo(10.2, bodyY);
      g.quadraticCurveTo(6.6, bodyY + 6, 6.8, bodyY + 9.4);
      g.lineTo(11.6, bodyY + 8.4);
      g.closePath();
    } else {
      g.moveTo(7.4, bodyY + 0.2);
      g.quadraticCurveTo(5.4, bodyY + 6.0, 5.6, bodyY + 9.6);
      g.lineTo(18.4, bodyY + 9.6);
      g.quadraticCurveTo(18.6, bodyY + 6.0, 16.6, bodyY + 0.2);
      g.closePath();
    }
    paint(g, facing === 'back' ? '#35283e' : '#702743', '#1d1424', [5, bodyY, 19, bodyY + 10]);
    return;
  }
  if (facing === 'back') return;
  for (const s of facing === 'side' ? [-1] : [-1, 1]) {
    const x0 = facing === 'side' ? 10.6 : 12 + s * 3.4;
    g.beginPath();
    g.moveTo(x0, bodyY + 0.4);
    g.lineTo(x0 + s * 1.6, bodyY - 2.8);
    g.lineTo(x0 + s * 2.6, bodyY + 0.6);
    g.closePath();
    paint(g, '#35283e', '#1d1424', [x0 - 3, bodyY - 3, x0 + 3, bodyY + 1], { flat: true, lw: 0.34 });
  }
}

// ---------------------------------------------------------------- personagem

/** Desenha o personagem num contexto já escalado (1 unidade = 1 px de mundo), com a folha em (0, 0). */
export function drawCharacterV2(g: Ctx, req: V2Request, opts: { shadow?: boolean } = {}): void {
  const a = req.appearance;
  const p = paletteOf(a);
  const n = V2_FRAMES[req.pose] ?? 1;
  const frame = ((Math.floor(req.frame) % n) + n) % n;
  const rig = rigOf(req, frame);
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (req.dir === 'left') {
    g.translate(V2_W, 0);
    g.scale(-1, 1);
  }
  const top = 4.8 + rig.bob + rig.headDy;
  const bodyY = 18 + rig.bob;
  const hipY = bodyY + 6.4;
  const footY = 30.4;
  const side = rig.facing === 'side';
  const skirted = (a.bottomStyle ?? 'pants') === 'skirt';
  const shoulderY = bodyY + 1.2;

  // sombra no chão (o mundo já desenha a dele: só na prévia e quando pedida)
  if (opts.shadow) {
    g.fillStyle = 'rgba(20,24,40,0.18)';
    ellipse(g, 12, 31, 5.6, 1.4);
    g.fill();
  }
  if (rig.jump) g.translate(0, -rig.jump);

  // capa do vampiro e cabelo de trás (de frente ficam atrás de tudo)
  if (req.costume === 'vampire') cape(g, bodyY, rig.facing, 'back');
  if (rig.facing === 'front') hairBack(g, a, p, 'front', top);
  if (side) hairBack(g, a, p, 'side', top);

  // pernas
  if (!rig.seated) {
    if (side) {
      const legLen = footY - 0.6 - hipY;
      const legAt = (ang: number, far: boolean) => {
        const fx = 12 + Math.sin(ang) * legLen;
        const fy = hipY + Math.cos(ang) * legLen + 0.6;
        const bottom = a.bottomStyle ?? 'pants';
        const cloth = far ? shade(p.bottom, -0.07) : p.bottom;
        if (bottom === 'pants') limb(g, 12, hipY, fx, fy - 0.6, 1.35, cloth, p.bottomLine);
        else {
          limb(g, 12, hipY, fx, fy - 0.6, 1.05, far ? p.skinShade : p.skin, p.skinLine);
          if (bottom === 'shorts') limb(g, 12, hipY, 12 + Math.sin(ang) * 2.4, hipY + Math.cos(ang) * 2.4, 1.45, cloth, p.bottomLine);
        }
        ellipse(g, fx + 0.6, fy, 1.9, 0.95);
        paint(g, far ? shade(p.shoes, -0.07) : p.shoes, p.shoesLine, [fx - 1, fy - 1, fx + 2.4, fy + 1]);
      };
      legAt(rig.legA[1], true);
      legAt(rig.legA[0], false);
    } else {
      leg(g, a, p, 10.3, hipY - 0.4, footY, rig.lift[0]);
      leg(g, a, p, 13.7, hipY - 0.4, footY, rig.lift[1]);
    }
  } else if (rig.facing === 'front') {
    // sentado de frente: coxas vindo para a câmera, só os joelhos e os sapatos
    for (const x of [10.2, 13.8]) {
      ellipse(g, x, footY - 1.4, 1.75, 1.5);
      paint(g, skirted ? p.skin : p.bottom, skirted ? p.skinLine : p.bottomLine, [x - 2, footY - 3, x + 2, footY]);
      ellipse(g, x, footY + 0.1, 1.6, 0.85);
      paint(g, p.shoes, p.shoesLine, [x - 1.6, footY - 1, x + 1.6, footY + 1]);
    }
  } else if (side) {
    // sentado de lado: coxa para a frente
    limb(g, 12, hipY, 16.2, hipY + 0.2, 1.4, skirted ? p.skin : p.bottom, skirted ? p.skinLine : p.bottomLine);
    limb(g, 16.2, hipY + 0.2, 16.4, footY - 0.6, 1.15, skirted ? p.skin : p.bottom, skirted ? p.skinLine : p.bottomLine);
    ellipse(g, 17.0, footY, 1.9, 0.95);
    paint(g, p.shoes, p.shoesLine, [15, footY - 1, 19, footY + 1]);
  }

  const itemPt = (): Pt => {
    const [h0, h1] = rig.hands;
    if (rig.itemAt === 'mid') return { x: (h0.x + h1.x) / 2, y: (h0.y + h1.y) / 2 };
    return rig.hands[rig.itemAt];
  };
  const item = rig.item;
  // de costas, o que está na frente do peito fica escondido pelo corpo: desenha antes
  const itemFrontOfBody = rig.facing === 'back' && item !== 'none' && rig.itemAt === 'mid';
  if (itemFrontOfBody) {
    const ip = itemPt();
    drawItem(g, item, ip.x, ip.y, false);
  }

  // braço de trás (de lado), com o item se for dele
  if (side) {
    const h = rig.hands[1];
    arm(g, a, p, 12.2, shoulderY, h.x, h.y, true, rig.handKind[1]);
    if (item !== 'none' && rig.itemAt === 1) drawItem(g, item, h.x, h.y, true);
  }

  // saia por baixo do tronco, pescoço, tronco
  if (skirted) skirt(g, p, hipY - 0.9, side);
  else if (!side) {
    // quadril da calça/bermuda ligando as pernas
    g.beginPath();
    g.roundRect(7.7, hipY - 1.2, 8.6, 2.2, 1.0);
    paint(g, p.bottom, p.bottomLine, [7.7, hipY - 1.2, 16.3, hipY + 1], { flat: true });
  }
  g.beginPath();
  g.roundRect(side ? 11.4 : 10.9, top + 11, 2.2, Math.max(3.0, bodyY - top - 10.4), 0.8);
  paint(g, p.skinShade, p.skinLine, [10.9, top + 11, 13.1, top + 14], { flat: true, lw: 0.35 });
  torsoPath(g, a, bodyY, side);
  paint(g, a.top, p.topLine, [7, bodyY, 17, bodyY + 7]);
  torsoDetails(g, a, p, bodyY, rig.facing);
  lanyard(g, a, bodyY, rig.facing);
  if (req.costume === 'vampire') cape(g, bodyY, rig.facing, 'collar');
  if (rig.facing === 'back' || side) hairOverBack(g, a, p, rig.facing, top);

  // braços (frente/costas) ou o da frente (lado), e o item na mão
  if (side) {
    const h = rig.hands[0];
    arm(g, a, p, 12.6, shoulderY, h.x, h.y, false, rig.handKind[0]);
  } else {
    // de braços cruzados, o de baixo primeiro
    arm(g, a, p, 7.6, shoulderY, rig.hands[0].x, rig.hands[0].y, false, rig.handKind[0]);
    arm(g, a, p, 16.4, shoulderY, rig.hands[1].x, rig.hands[1].y, false, rig.handKind[1]);
  }
  if (item !== 'none' && !itemFrontOfBody && !(side && rig.itemAt === 1)) {
    const ip = itemPt();
    drawItem(g, item, ip.x, ip.y, side);
    // as mãos seguram por cima de caixa, notebook, livro e controle
    if (rig.itemAt === 'mid' || TWO_HANDED.has(item)) {
      for (const k of side ? [0] : [0, 1]) handShape(g, p, rig.hands[k], rig.handKind[k], p.skin);
    }
  }

  // cabeça: orelhas, rosto, cabelo
  g.save();
  if (rig.headDx) g.translate(rig.headDx, 0);
  const hk = hairKind(a);
  const earsHidden = rig.facing === 'back' && (hk === 'long' || hk === 'wavy' || hk === 'bob' || hk === 'curly' || hk === 'afro');
  if (rig.facing !== 'side') {
    for (const x of earsHidden ? [] : [5.9, 18.1]) {
      ellipse(g, x, top + 7.4, 0.95, 1.35);
      paint(g, p.skin, p.skinLine, [x - 1, top + 6, x + 1, top + 9], { flat: true });
    }
    headPath(g, 12, top);
  } else {
    ellipse(g, 11.4, top + 7.4, 1.0, 1.4);
    paint(g, p.skin, p.skinLine, [10.4, top + 6, 12.4, top + 9], { flat: true });
    headSidePath(g, 12, top);
  }
  paint(g, p.skin, p.skinLine, [6, top, 18, top + 12.4]);
  if (side) {
    // orelha por cima da cabeça de perfil
    ellipse(g, 11.6, top + 7.6, 0.95, 1.35);
    paint(g, p.skin, p.skinLine, [10.6, top + 6, 12.6, top + 9], { flat: true, lw: 0.4 });
  }
  if (rig.facing !== 'back') {
    // pelos do rosto recortados pelo contorno da cabeça (não saem do queixo)
    g.save();
    if (side) headSidePath(g, 12, top);
    else headPath(g, 12, top);
    g.clip();
    facialHair(g, a, p, top, side);
    g.restore();
    face(g, a, p, top, side, rig.eyes, rig.mouth);
  }
  hairFront(g, a, p, rig.facing, top);
  if (a.accessory !== 'cap' && a.accessory !== 'beanie') accessory(g, a, p, top, rig.facing);
  else if (!req.costume && (a.accessory === 'cap' || a.accessory === 'beanie')) hat(g, a, p, req, top, rig.facing);
  if (req.costume && req.costume !== 'vampire') hat(g, a, p, req, top, rig.facing);
  g.restore();

  // mão perto do rosto (espelho, café, pipoca) ou acima da cabeça: por cima da cabeça e do cabelo
  const nearHead = (h: Pt) => h.y < top + 12.6;
  if (rig.facing !== 'back' || req.pose === 'groom') {
    for (const k of side ? [0] : [0, 1]) {
      const h = rig.hands[k];
      if (!nearHead(h)) continue;
      handShape(g, p, h, rig.handKind[k], p.skin);
      if (item !== 'none' && rig.itemAt === k) drawItem(g, item, h.x, h.y, side);
    }
  }
  g.restore();
}

/** Folha do personagem em `scale` px por unidade de mundo (canvas novo; quem chama guarda em cache). */
export function renderCharacterV2(req: V2Request, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(V2_W * scale);
  c.height = Math.ceil(V2_H * scale);
  const g = c.getContext('2d') as Ctx;
  g.scale(scale, scale);
  drawCharacterV2(g, req);
  return c;
}
