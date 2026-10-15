// YAML mínimo para o state.yaml do Faber, sem dependências (o servidor não tem nenhuma de runtime). Cobre o que o
// Faber grava — yaml.safe_dump do PyYAML (blocos, listas no mesmo recuo da chave, escalares quebrados em várias
// linhas, aspas simples e duplas) — e o que o template traz escrito à mão (mapas e listas em linha, comentários).
// Âncoras, aliases, tags e documentos múltiplos não existem nesses arquivos: viram erro, e o chamador trata o
// arquivo como leitura inválida. Puro.

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

export class YamlError extends Error {}

interface Line {
  /** Recuo da linha; -1 = linha vazia. */
  indent: number;
  /** Conteúdo sem o recuo e sem comentário ('' = só comentário ou vazia). */
  text: string;
  /** Conteúdo sem o recuo, com o que pareceria comentário (continuação de texto entre aspas). */
  raw: string;
  /** Quebra que termina a linha: '\n' (também \r\n, \r e \x85) ou U+2028/U+2029, que o YAML preserva no texto. */
  brk: string;
  no: number;
}

/** Tira o comentário (" #..." ou "#" no começo), respeitando aspas. */
function stripComment(s: string): string {
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === "'" && quote === "'" && s[i + 1] === "'") i++;
      else if (c === quote) quote = '';
    } else if ((c === '"' || c === "'") && (i === 0 || ' \t[{,'.includes(s[i - 1]))) {
      // aspas só abrem no começo de um valor ("it's" é texto sem aspas)
      quote = c;
    } else if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return s.slice(0, i);
    }
  }
  return s;
}

function lex(src: string): Line[] {
  const out: Line[] = [];
  let started = false;
  // as quebras de linha do YAML 1.1 (as mesmas do PyYAML)
  const chunks = src.split(/(\r\n|[\r\n\x85\u2028\u2029])/);
  for (let k = 0; k < chunks.length; k += 2) {
    const no = k / 2 + 1;
    const sep = chunks[k + 1];
    const brk = sep === '\u2028' || sep === '\u2029' ? sep : '\n';
    // só espaço e tab contam como branco (o YAML não apara U+00A0 nem U+2028)
    const body = chunks[k].replace(/[ \t]+$/, '');
    const spaces = body.length - body.replace(/^ +/, '').length;
    const raw = body.replace(/^[ \t]+/, '');
    const indent = raw ? spaces : -1;
    const text = stripComment(raw).replace(/[ \t]+$/, '');
    if (text === '---' && !started) continue;
    if (text === '---' || text === '...') throw new YamlError(`linha ${no}: documentos múltiplos`);
    if (text) started = true;
    out.push({ indent, text, raw, brk, no });
  }
  return out;
}

/** Posição do ":" que separa chave e valor (fora de aspas, seguido de espaço ou fim), ou -1. */
function keySep(s: string): number {
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if ((c === '"' || c === "'") && i === 0) {
      quote = c;
    } else if (c === '{' || c === '[') {
      return -1;
    } else if (c === ':' && (i + 1 === s.length || s[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

function unquoteKey(k: string): string {
  const t = k.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const v = scalar(t);
    return String(v);
  }
  return t;
}

const DQ_ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ', a: '\x07', b: '\b', v: '\v', f: '\f', L: '\u2028', P: '\u2029', e: '\x1b', N: '\u0085', _: '\u00a0' };

function doubleQuoted(s: string): string {
  if (!s.endsWith('"') || s.length < 2) throw new YamlError(`aspas duplas sem fechar: ${s.slice(0, 40)}`);
  const inner = s.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"') throw new YamlError('aspas duplas no meio do texto');
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = inner[++i];
    if (e === 'x' || e === 'u' || e === 'U') {
      const n = e === 'x' ? 2 : e === 'u' ? 4 : 8;
      const hex = inner.slice(i + 1, i + 1 + n);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== n) throw new YamlError(`escape inválido \\${e}${hex}`);
      out += String.fromCodePoint(parseInt(hex, 16));
      i += n;
    } else if (e !== undefined && e in DQ_ESC) {
      out += DQ_ESC[e];
    } else {
      throw new YamlError(`escape inválido \\${e ?? ''}`);
    }
  }
  return out;
}

/** Escalar de uma linha só (já sem comentário). */
export function scalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s.startsWith('"')) return doubleQuoted(s);
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError(`aspas simples sem fechar: ${s.slice(0, 40)}`);
    const inner = s.slice(1, -1);
    if (/'(?!')/.test(inner.replace(/''/g, ''))) throw new YamlError('aspas simples no meio do texto');
    return inner.replace(/''/g, "'");
  }
  if (s.startsWith('{') || s.startsWith('[')) return flow(s);
  if (/^[&*!|>%@`]/.test(s)) throw new YamlError(`recurso de YAML não suportado: ${s.slice(0, 20)}`);
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Mapa ou lista em linha: {a: 1, b: [x, y]}. */
function flow(src: string): YamlValue {
  let i = 0;
  const ws = () => {
    while (i < src.length && src[i] === ' ') i++;
  };
  const token = (stops: string): string => {
    ws();
    const start = i;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i++];
      while (i < src.length) {
        if (q === '"' && src[i] === '\\') i += 2;
        else if (q === "'" && src[i] === "'" && src[i + 1] === "'") i += 2;
        else if (src[i] === q) {
          i++;
          break;
        } else i++;
      }
      return src.slice(start, i);
    }
    while (i < src.length && !stops.includes(src[i]) && !(src[i] === ':' && (src[i + 1] === ' ' || src[i + 1] === ',' || src[i + 1] === '}'))) i++;
    return src.slice(start, i).trim();
  };
  const value = (stops: string): YamlValue => {
    ws();
    if (src[i] === '{' || src[i] === '[') return node();
    return scalar(token(stops));
  };
  const node = (): YamlValue => {
    ws();
    if (src[i] === '[') {
      i++;
      const arr: YamlValue[] = [];
      ws();
      if (src[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value(',]'));
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return arr;
        }
        throw new YamlError(`lista em linha malformada: ${src.slice(0, 40)}`);
      }
    }
    if (src[i] === '{') {
      i++;
      const obj: { [k: string]: YamlValue } = {};
      ws();
      if (src[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        const k = unquoteKey(token(',}'));
        ws();
        if (src[i] !== ':') throw new YamlError(`mapa em linha sem ":" depois de ${k}`);
        i++;
        obj[k] = value(',}');
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return obj;
        }
        throw new YamlError(`mapa em linha malformado: ${src.slice(0, 40)}`);
      }
    }
    throw new YamlError('esperava { ou [');
  };
  const v = node();
  ws();
  if (i !== src.length) throw new YamlError(`sobrou texto depois de ${src.slice(0, 40)}`);
  return v;
}

class Parser {
  private i = 0;
  constructor(private readonly lines: Line[]) {}

  private peek(): Line | undefined {
    while (this.i < this.lines.length && !this.lines[this.i].text) this.i++;
    return this.lines[this.i];
  }

  parse(): YamlValue {
    const first = this.peek();
    if (!first) return null;
    if (first.indent !== 0) throw new YamlError(`linha ${first.no}: recuo inesperado`);
    const v = this.block(0);
    const rest = this.peek();
    if (rest) throw new YamlError(`linha ${rest.no}: recuo inesperado`);
    return v;
  }

  /** Bloco (mapa ou lista) cujas linhas começam exatamente em `indent`. */
  private block(indent: number): YamlValue {
    const l = this.peek()!;
    return l.text === '-' || l.text.startsWith('- ') ? this.seq(indent) : this.map(indent);
  }

  private seq(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    for (let l = this.peek(); l && l.indent === indent && (l.text === '-' || l.text.startsWith('- ')); l = this.peek()) {
      const rest = l.text.slice(1).replace(/^ +/, '');
      const inner = indent + (l.text.length - rest.length);
      if (!rest) {
        this.i++;
        const next = this.peek();
        out.push(next && next.indent > indent ? this.block(next.indent) : null);
      } else if (keySep(rest) >= 0 && !rest.startsWith('{') && !rest.startsWith('[')) {
        // "- chave: valor": o item é um mapa que começa nesta linha, no recuo de depois do "- "
        this.lines[this.i] = { ...l, indent: inner, text: rest, raw: l.raw.slice(l.text.length - rest.length) };
        out.push(this.map(inner));
      } else {
        this.i++;
        out.push(this.inlineValue(rest, indent, l.no));
      }
    }
    return out;
  }

  private map(indent: number): { [k: string]: YamlValue } {
    const out: { [k: string]: YamlValue } = {};
    for (let l = this.peek(); l && l.indent === indent; l = this.peek()) {
      if (l.text === '-' || l.text.startsWith('- ')) throw new YamlError(`linha ${l.no}: item de lista no meio de um mapa`);
      const sep = keySep(l.text);
      if (sep < 0) throw new YamlError(`linha ${l.no}: esperava "chave: valor"`);
      const key = unquoteKey(l.text.slice(0, sep));
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlError(`linha ${l.no}: chave repetida ${key}`);
      const rest = l.text.slice(sep + 1).trim();
      this.i++;
      if (rest) {
        out[key] = this.inlineValue(rest, indent, l.no);
        continue;
      }
      const next = this.peek();
      if (next && next.indent > indent) out[key] = this.block(next.indent);
      // PyYAML grava a lista de um mapa no mesmo recuo da chave
      else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) out[key] = this.seq(indent);
      else out[key] = null;
    }
    const l = this.peek();
    if (l && l.indent > indent) throw new YamlError(`linha ${l.no}: recuo inesperado`);
    return out;
  }

  /** Valor escrito depois de "chave:" ou "- ", com as linhas de continuação (recuo maior que `indent`). */
  private inlineValue(first: string, indent: number, no: number): YamlValue {
    if (/^[|>][-+]?$/.test(first)) return this.blockScalar(first, indent);
    const q = first[0] === '"' || first[0] === "'" ? first[0] : '';
    // entre aspas que não fecham na primeira linha, "#" na continuação é texto, não comentário
    let open = false;
    if (q) {
      try {
        scalar(first);
      } catch {
        open = true;
      }
    }
    // dobra, como o PyYAML: a quebra de uma linha vira espaço (ou some, se vierem linhas em branco, que viram
    // quebras); U+2028/U+2029 ficam como estão; "\" no fim de uma linha entre aspas duplas junta sem nada
    let joined = first;
    let prevBrk = this.lines[this.i - 1]?.brk ?? '\n';
    let blanks: string[] = [];
    let more = false;
    while (this.i < this.lines.length) {
      const l = this.lines[this.i];
      if (l.indent < 0) {
        const next = this.lines.slice(this.i).find((x) => x.indent >= 0);
        if (!next || next.indent <= indent) break;
        blanks.push(l.brk);
        this.i++;
        continue;
      }
      if (l.indent <= indent || (!open && !l.text)) break;
      // texto sem aspas não continua com "chave: valor" (o YAML recusa: um mapa não cabe depois de um valor)
      if (!q && keySep(l.text) >= 0) throw new YamlError(`linha ${l.no}: recuo inesperado`);
      if (q === '"' && /(^|[^\\])(\\\\)*\\$/.test(joined)) joined = joined.slice(0, -1) + blanks.join('');
      else joined += (prevBrk !== '\n' ? prevBrk : blanks.length ? '' : ' ') + blanks.join('');
      joined += open ? l.raw : l.text;
      prevBrk = l.brk;
      blanks = [];
      more = true;
      this.i++;
    }
    if (more && !q && /^[&*!%@`]/.test(first)) throw new YamlError(`linha ${no}: recurso de YAML não suportado`);
    return scalar(joined);
  }

  private blockScalar(header: string, indent: number): string {
    const lines: string[] = [];
    let base = -1;
    while (this.i < this.lines.length) {
      const l = this.lines[this.i];
      if (l.indent >= 0 && l.indent <= indent) break;
      if (l.indent >= 0 && base < 0) base = l.indent;
      lines.push(l.indent < 0 ? '' : ' '.repeat(l.indent - base) + l.raw);
      this.i++;
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const text = header[0] === '|' ? lines.join('\n') : lines.join(' ').replace(/ ?\n ?/g, '\n');
    return header.endsWith('-') ? text : text + '\n';
  }
}

/** Lê um documento YAML. Lança YamlError no que não entende. */
export function parseYaml(src: string): YamlValue {
  return new Parser(lex(src)).parse();
}
