// Tipos e funções puras do depurador (testáveis sem DOM).

export type Breakpoint = {
 path: string; line: number; condition: string; enabled: boolean;
 /** Suspend execution (PhpStorm). false = breakpoint de log: registra e continua. */
 suspend?: boolean;
 /** "Breakpoint hit" message. */
 log?: boolean;
 /** Evaluate and log. */
 logExpression?: string;
 /** Remove once hit. */
 removeOnce?: boolean;
};
export type ExceptionBreakpoint = { name: string; enabled: boolean; condition: string; suspend?: boolean };
export type Mapping = { server: string; local: string };
export type Frame = { level: number; where: string; type: string; line: number; local: string | null; server: string };
export type Prop = { name: string; fullname: string; type: string; classname?: string | null; facet?: string | null; value: string; size?: number | null; children: boolean; numchildren: number; page: number; pagesize?: number | null; items: Prop[] };
export type Settings = { port: number; all: boolean; breakFirst: boolean; breakpoints: Breakpoint[]; exceptions: ExceptionBreakpoint[]; mappings: Mapping[]; watches: string[]; muted: boolean; inline: boolean };
/** Estado informado pelo motor durante a sessão. */
export type BreakpointState = { state: 'verified' | 'pending' | 'invalid'; message?: string };

export const defaults = (): Settings => ({ port: 9003, all: false, breakFirst: false, breakpoints: [], exceptions: [], mappings: [], watches: [], muted: false, inline: true });
export const errorText = (error: unknown) => String((error as Error)?.message ?? error);
export const suspends = (b: { suspend?: boolean }) => b.suspend !== false;
export const lineKey = (path: string, line: number) => `${path}:${line}`;

/** Classe do ícone no número da linha (estado mais específico primeiro, como no PhpStorm). */
export function iconKind(b: Breakpoint, state: BreakpointState | undefined, muted: boolean): string {
 if (muted) return b.enabled ? 'muted' : 'muted-disabled';
 if (!b.enabled) return 'disabled';
 if (state?.state === 'invalid') return 'invalid';
 const base = suspends(b) ? (b.condition.trim() ? 'conditional' : 'line') : 'log';
 return state?.state === 'verified' ? base + ' verified' : base;
}

/** Valor de uma propriedade como `{tipo} valor` (formato da árvore de variáveis do PhpStorm). */
export function typeLabel(p: Prop): string {
 if (p.type === 'object') return p.classname ?? 'object';
 if (p.type === 'array') return `array[${p.numchildren}]`;
 return p.type;
}
export function valueText(p: Prop): string {
 if (p.type === 'string') return `"${p.value}"${p.size && p.size > p.value.length ? '…' : ''}`;
 if (p.type === 'bool') return p.value === '1' ? 'true' : 'false';
 if (p.type === 'null') return 'null';
 if (p.type === 'uninitialized') return 'uninitialized';
 if (p.type === 'object' || p.type === 'array') return '';
 return p.value;
}
/** Valor inline no editor: `60`, `"Ana"`, `Order`, `array[3]`. */
export function inlineText(p: Prop): string {
 if (p.type === 'object') return p.classname ?? 'object';
 if (p.type === 'array') return `array[${p.numchildren}]`;
 const text = valueText(p);
 return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

/** Linha onde começa o corpo que contém `line` (para valores inline): a declaração de função mais próxima acima
 *  com indentação menor que a da linha; 1 no escopo global. */
export function scopeStart(lines: string[], line: number): number {
 const indent = (text: string) => text.match(/^\s*/)![0].replace(/\t/g, '    ').length;
 const own = indent(lines[line - 1] ?? '');
 for (let i = Math.min(line, lines.length) - 2; i >= 0; i--) {
  if (lines[i].trim() && indent(lines[i]) < own && /^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*function\b/.test(lines[i])) return i + 1;
 }
 return 1;
}

/** Variáveis citadas em cada linha de [from, to], na ordem em que aparecem, sem repetir na mesma linha. */
export function inlineValues(lines: string[], from: number, to: number, known: Map<string, Prop>): { line: number; text: string }[] {
 const out: { line: number; text: string }[] = [];
 for (let n = from; n <= to && n <= lines.length; n++) {
  const code = lines[n - 1].replace(/\/\/.*$|#.*$/, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const seen = new Set<string>(); const parts: string[] = [];
  for (const match of code.matchAll(/\$[A-Za-z_\x80-￿][\w\x80-￿]*/g)) {
   const name = match[0]; if (seen.has(name) || name === '$this') continue; seen.add(name);
   const p = known.get(name); if (p) parts.push(`${name}: ${inlineText(p)}`);
  }
  if (parts.length) out.push({ line: n, text: parts.join('   ') });
 }
 return out;
}

/** Breakpoint de linha atingido por uma parada (topo da pilha). */
export function hitBreakpoint(points: Breakpoint[], frame: Frame | undefined): Breakpoint | undefined {
 if (!frame?.local) return undefined;
 return points.find(b => b.enabled && b.path === frame.local && b.line === frame.line);
}
/** Breakpoint de exceção que corresponde à classe lançada (nome exato, sem barra inicial, ou `*`). */
export function hitException(list: ExceptionBreakpoint[], exception: string | undefined): ExceptionBreakpoint | undefined {
 if (!exception) return undefined;
 const name = exception.replace(/^\\/, '');
 return list.find(e => e.enabled && (e.name === '*' || e.name.replace(/^\\/, '') === name));
}

/** Configuração enviada ao serviço: breakpoints mudos não vão ao motor. */
export function engineConfig(s: Settings) {
 if (s.muted) return { breakpoints: [] as Breakpoint[], exceptions: [] as ExceptionBreakpoint[] };
 return { breakpoints: s.breakpoints.filter(b => b.enabled), exceptions: s.exceptions.filter(e => e.enabled).map(e => ({ name: e.name, enabled: true, condition: '' })) };
}
