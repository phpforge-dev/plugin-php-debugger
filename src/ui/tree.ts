// Árvore de valores (Variables, watches, Evaluate): `▸ ícone $nome = {tipo} valor`, filhos sob demanda e paginação.
import { type Prop, typeLabel, valueText } from './model';

export type TreeCtx = {
 tr: (s: string, ...a: unknown[]) => string; msg: (p: TemplateStringsArray, ...v: unknown[]) => string;
 /** Busca uma página de filhos; `undefined` quando a sessão já não está pausada. */
 children(p: Prop, page: number): Promise<Prop | undefined>;
};
export type RowOptions = { kind?: 'watch' | 'result' | 'exception' | 'error'; remove?: () => void; label?: string };

const icon = (p: Prop, kind?: RowOptions['kind']) => kind === 'watch' ? 'watch' : kind === 'error' || p.type === 'error' ? 'error' : p.type === 'object' ? 'object' : p.type === 'array' ? 'array' : 'primitive';

export function propNode(ctx: TreeCtx, p: Prop, options: RowOptions = {}): HTMLLIElement {
 const { tr, msg } = ctx;
 const li = document.createElement('li'); li.setAttribute('role', 'treeitem');
 const row = document.createElement('div'); row.className = 'debug-row'; row.tabIndex = -1;
 const twist = document.createElement('button'); twist.type = 'button'; twist.className = 'debug-twist'; twist.tabIndex = -1; twist.disabled = !p.children; twist.setAttribute('aria-label', tr('Expandir'));
 const glyph = document.createElement('i'); glyph.className = 'debug-icon debug-icon-' + icon(p, options.kind); glyph.setAttribute('aria-hidden', 'true');
 const name = document.createElement('span'); name.className = 'debug-name' + (options.kind === 'watch' ? ' debug-watch' : ''); name.textContent = options.label ?? (p.name || p.fullname);
 if (p.facet) name.title = p.facet;
 row.append(twist, glyph, name, document.createTextNode(' = '));
 if (options.kind === 'error' || p.type === 'error') {
  const value = document.createElement('span'); value.className = 'debug-value debug-type-error'; value.textContent = p.value; row.append(value);
 } else {
  const type = typeLabel(p); const text = valueText(p);
  // Strings e null aparecem só pelo valor; os demais como {tipo} valor.
  if (p.type !== 'string' && p.type !== 'null' && p.type !== 'uninitialized') { const t = document.createElement('span'); t.className = 'debug-type'; t.textContent = `{${type}}`; row.append(t); if (text) row.append(' '); }
  if (text) { const value = document.createElement('span'); value.className = `debug-value debug-type-${p.type}`; value.textContent = text; value.title = p.value; row.append(value); }
 }
 if (options.remove) { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'debug-remove'; remove.textContent = '×'; remove.title = tr('Remover watch'); remove.onclick = options.remove; row.append(remove); }
 li.append(row);
 if (!p.children) return li;
 li.setAttribute('aria-expanded', 'false');
 const children = document.createElement('ul'); children.setAttribute('role', 'group'); children.hidden = true; li.append(children);
 let items = p.items.slice(); let loading = false;
 const draw = () => {
  children.replaceChildren(...items.map(c => propNode(ctx, c)));
  if (items.length < p.numchildren) { const more = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.className = 'debug-link'; b.textContent = msg`Mostrar mais (${p.numchildren - items.length} restantes)`; b.onclick = () => void fetch(Math.ceil(items.length / (p.pagesize || 100))); more.append(b); children.append(more); }
 };
 const fetch = async (page: number) => {
  if (loading) return; loading = true;
  try { const r = await ctx.children(p, page); if (r) { items = page === 0 ? r.items : items.concat(r.items); draw(); } }
  catch (error) { children.replaceChildren(); const e = document.createElement('li'); e.className = 'debug-error'; e.textContent = String((error as Error)?.message ?? error); children.append(e); }
  finally { loading = false; }
 };
 const toggle = () => {
  const open = children.hidden; children.hidden = !open; li.setAttribute('aria-expanded', String(open)); twist.classList.toggle('open', open);
  if (open) { if (!items.length) void fetch(0); else draw(); }
 };
 twist.onclick = toggle; row.ondblclick = toggle;
 return li;
}
