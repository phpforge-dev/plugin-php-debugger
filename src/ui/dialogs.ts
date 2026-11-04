// Diálogo Breakpoints (⇧⌘F8), Add Exception Breakpoint e Evaluate Expression (⌥F8).
import { type Breakpoint, type ExceptionBreakpoint, type Prop, type Settings, suspends } from './model';
import { propNode, type TreeCtx } from './tree';

export type DialogCtx = {
 tr: (s: string, ...a: unknown[]) => string; msg: (p: TemplateStringsArray, ...v: unknown[]) => string;
 settings(): Settings; changed(b?: Breakpoint): void;
 remove(b: Breakpoint): void; removeException(e: ExceptionBreakpoint): void; addException(name: string): ExceptionBreakpoint | undefined;
 goTo(b: Breakpoint): void; preview(b: Breakpoint): Promise<{ first: number; lines: string[] } | undefined>;
 tree: TreeCtx; evaluate(expression: string): Promise<Prop | null>; addWatch(expression: string): void; paused(): boolean;
 restoreFocus(): void;
};
type Item = { kind: 'line'; b: Breakpoint } | { kind: 'exception'; e: ExceptionBreakpoint };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const n = document.createElement(tag); if (className) n.className = className; if (text) n.textContent = text; return n; };

export function mountDialogs(ctx: DialogCtx) {
 const { tr, msg } = ctx;
 let open: { close(): void; refresh(): void } | undefined;

 /** Diálogo Breakpoints: grupos à esquerda, propriedades do item à direita, Concluir. */
 function breakpoints(select?: Breakpoint | ExceptionBreakpoint) {
  open?.close();
  const backdrop = el('div', 'debug-dialog-backdrop');
  const dialog = el('section', 'debug-dialog debug-breakpoints-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', tr('Breakpoints'));
  const head = el('header', 'debug-dialog-title', tr('Breakpoints'));
  const body = el('div', 'debug-dialog-body');
  const left = el('div', 'debug-bp-list'); const tools = el('div', 'debug-bp-tools');
  const add = el('button', 'debug-icon-button', '+'); add.type = 'button'; add.title = tr('Adicionar'); add.setAttribute('aria-label', tr('Adicionar breakpoint'));
  const del = el('button', 'debug-icon-button', '−'); del.type = 'button'; del.title = tr('Remover'); del.setAttribute('aria-label', tr('Remover breakpoint'));
  tools.append(add, del);
  const tree = el('ul', 'debug-bp-tree'); tree.setAttribute('role', 'tree'); tree.tabIndex = 0; tree.setAttribute('aria-label', tr('Breakpoints'));
  left.append(tools, tree);
  const props = el('div', 'debug-bp-props');
  body.append(left, props);
  const foot = el('footer', 'debug-dialog-foot'); const done = el('button', 'debug-button debug-button-default', tr('Concluir')); done.type = 'button'; foot.append(done);
  dialog.append(head, body, foot); backdrop.append(dialog); document.body.append(backdrop);

  let selected: Item | undefined;
  const items = (): Item[] => [...ctx.settings().breakpoints].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line).map(b => ({ kind: 'line' as const, b }))
   .concat(ctx.settings().exceptions.map(e => ({ kind: 'exception' as const, e })) as any);
  const same = (a?: Item, b?: Item) => !!a && !!b && a.kind === b.kind && (a.kind === 'line' ? a.b === (b as any).b : a.e === (b as any).e);
  const label = (item: Item) => item.kind === 'line' ? `${item.b.path.split('/').pop()}:${item.b.line}` : item.e.name;
  const iconClass = (item: Item) => item.kind === 'exception' ? 'debug-icon-exception' + (item.e.enabled ? '' : ' off') : 'debug-icon-bp ' + (!item.b.enabled ? 'off' : !suspends(item.b) ? 'log' : item.b.condition.trim() ? 'conditional' : '');

  function group(kind: 'line' | 'exception', title: string, list: Item[]) {
   const li = el('li', 'debug-bp-group'); li.setAttribute('role', 'treeitem'); li.setAttribute('aria-expanded', 'true');
   const row = el('div', 'debug-bp-row');
   const box = el('input'); box.type = 'checkbox'; box.setAttribute('aria-label', title);
   const enabled = list.filter(i => i.kind === 'line' ? i.b.enabled : i.e.enabled).length;
   box.checked = !!list.length && enabled === list.length; box.indeterminate = enabled > 0 && enabled < list.length;
   box.onchange = () => { for (const i of list) { if (i.kind === 'line') i.b.enabled = box.checked; else i.e.enabled = box.checked; } ctx.changed(); refresh(); };
   row.append(box, el('i', kind === 'line' ? 'debug-icon-bp' : 'debug-icon-exception'), el('span', '', title));
   const ul = el('ul'); ul.setAttribute('role', 'group');
   for (const item of list) {
    const child = el('li'); child.setAttribute('role', 'treeitem'); child.setAttribute('aria-selected', String(same(item, selected)));
    const r = el('div', 'debug-bp-row'); const c = el('input'); c.type = 'checkbox'; c.checked = item.kind === 'line' ? item.b.enabled : item.e.enabled; c.setAttribute('aria-label', msg`Ativar ${label(item)}`);
    c.onclick = e => e.stopPropagation(); c.onchange = () => { if (item.kind === 'line') item.b.enabled = c.checked; else item.e.enabled = c.checked; ctx.changed(item.kind === 'line' ? item.b : undefined); refresh(); };
    const text = el('span', 'debug-bp-label' + ((item.kind === 'line' ? item.b.enabled : item.e.enabled) ? '' : ' off'), label(item));
    r.append(c, el('i', iconClass(item)), text); child.append(r);
    child.onclick = () => { selected = item; refresh(); };
    child.ondblclick = () => { if (item.kind === 'line') { close(); ctx.goTo(item.b); } };
    ul.append(child);
   }
   li.append(row, ul); return li;
  }
  function refresh() {
   const all = items(); if (selected && !all.some(i => same(i, selected))) selected = undefined; selected ??= all[0];
   tree.replaceChildren(group('line', tr('Breakpoints de linha PHP'), all.filter(i => i.kind === 'line')), ...(all.some(i => i.kind === 'exception') ? [group('exception', tr('Breakpoints de exceção PHP'), all.filter(i => i.kind === 'exception'))] : []));
   del.disabled = !selected; renderProps();
  }
  const check = (text: string, value: boolean, set: (v: boolean) => void, after?: () => void) => {
   const row = el('label', 'debug-check'); const input = el('input'); input.type = 'checkbox'; input.checked = value;
   input.onchange = () => { set(input.checked); ctx.changed(selected?.kind === 'line' ? selected.b : undefined); after?.(); };
   row.append(input, tr(text)); return { row, input };
  };
  const expressionField = (value: string, enabled: boolean, set: (v: string) => void, aria: string) => {
   const input = el('input', 'debug-expression'); input.value = value; input.disabled = !enabled; input.spellcheck = false; input.setAttribute('aria-label', aria);
   input.oninput = () => { set(input.value); ctx.changed(selected?.kind === 'line' ? selected.b : undefined); }; return input;
  };
  function renderProps() {
   props.replaceChildren();
   if (!selected) { props.append(el('p', 'debug-empty', tr('Nenhum breakpoint. Clique no número da linha para criar um, ou use + para um breakpoint de exceção.'))); return; }
   const item = selected;
   props.append(el('strong', 'debug-props-title', label(item)));
   if (item.kind === 'exception') {
    const e = item.e;
    props.append(check('Ativado', e.enabled, v => { e.enabled = v; refresh(); }).row, check('Suspender execução', suspends(e), v => e.suspend = v).row);
    let text = e.condition;
    const cond = check('Condição:', !!e.condition.trim(), v => { field.disabled = !v; e.condition = v ? text : ''; if (v) field.focus(); });
    const field = expressionField(e.condition, !!e.condition.trim(), v => { text = v; e.condition = v; }, tr('Condição'));
    props.append(cond.row, field); return;
   }
   const b = item.b;
   props.append(check('Ativado', b.enabled, v => { b.enabled = v; refresh(); }).row, check('Suspender execução', suspends(b), v => { b.suspend = v; }).row);
   let text = b.condition;
   const cond = check('Condição:', !!b.condition.trim(), v => { field.disabled = !v; b.condition = v ? text : ''; if (v) field.focus(); });
   const field = expressionField(b.condition, !!b.condition.trim(), v => { text = v; b.condition = v; }, tr('Condição'));
   const log = el('div', 'debug-log-row'); log.append(el('span', '', tr('Log:')), check('Mensagem "Breakpoint atingido"', !!b.log, v => b.log = v).row);
   let logText = b.logExpression ?? '';
   const evalLog = check('Avaliar e registrar:', !!b.logExpression?.trim(), v => { logField.disabled = !v; b.logExpression = v ? logText : ''; if (v) logField.focus(); });
   const logField = expressionField(b.logExpression ?? '', !!b.logExpression?.trim(), v => { logText = v; b.logExpression = v; }, tr('Expressão registrada'));
   const once = check('Remover após atingir', !!b.removeOnce, v => b.removeOnce = v).row;
   const code = el('pre', 'debug-bp-preview'); code.setAttribute('aria-label', tr('Código'));
   props.append(cond.row, field, log, evalLog.row, logField, once, code);
   void ctx.preview(b).then(view => {
    if (!view || selected !== item) return;
    code.replaceChildren(...view.lines.map((text, i) => { const n = view.first + i; const line = el('div', n === b.line ? 'current' : ''); line.append(el('span', 'debug-bp-gutter' + (n === b.line ? ' ' + iconClass(item) : ''), n === b.line ? '' : String(n)), document.createTextNode(text || ' ')); return line; }));
   });
  }
  function close() { backdrop.remove(); document.removeEventListener('keydown', keys, true); open = undefined; ctx.restoreFocus(); }
  const keys = (event: KeyboardEvent) => {
   if (event.key === 'Escape' && !document.querySelector('.debug-add-exception')) { event.preventDefault(); event.stopPropagation(); close(); }
   else if ((event.key === 'Delete' || event.key === 'Backspace') && document.activeElement === tree && selected) { event.preventDefault(); del.click(); }
   else if (event.key === 'F4' && selected?.kind === 'line') { event.preventDefault(); const b = selected.b; close(); ctx.goTo(b); }
  };
  document.addEventListener('keydown', keys, true);
  done.onclick = close; backdrop.onmousedown = e => { if (e.target === backdrop) close(); };
  del.onclick = () => { if (!selected) return; if (selected.kind === 'line') ctx.remove(selected.b); else ctx.removeException(selected.e); selected = undefined; refresh(); tree.focus(); };
  add.onclick = () => {
   const menu = el('div', 'context-menu debug-add-menu'); menu.setAttribute('role', 'menu');
   const item = el('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.append(el('i', 'debug-icon-exception'), el('span', '', tr('Breakpoints de exceção PHP')));
   menu.append(item); dialog.append(menu);
   const r = add.getBoundingClientRect(); const d = dialog.getBoundingClientRect(); menu.style.left = r.left - d.left + 'px'; menu.style.top = r.bottom - d.top + 4 + 'px';
   const closeMenu = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); };
   const outside = (e: Event) => { if (!menu.contains(e.target as Node)) closeMenu(); };
   document.addEventListener('pointerdown', outside, true);
   item.onclick = () => { closeMenu(); askException(name => { const e = ctx.addException(name); if (e) { selected = { kind: 'exception', e }; refresh(); } }); };
   menu.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); add.focus(); } };
   item.focus();
  };
  if (select) selected = 'path' in select ? { kind: 'line', b: select } : { kind: 'exception', e: select };
  refresh(); (dialog.querySelector('.debug-bp-tree') as HTMLElement).focus();
  open = { close, refresh };
 }

 /** Add Exception Breakpoint: campo "Nome da exceção:", Cancelar/OK. */
 function askException(done: (name: string) => void) {
  const box = el('div', 'debug-dialog-backdrop debug-add-exception');
  const dialog = el('section', 'debug-dialog debug-small-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', tr('Adicionar breakpoint de exceção'));
  const label = el('label', 'debug-inline-field'); const input = el('input', 'debug-expression'); input.spellcheck = false; input.placeholder = 'InvalidArgumentException';
  label.append(el('span', '', tr('Nome da exceção:')), input);
  const hint = el('small', 'debug-hint', tr('Nome completo da classe, ex.: App\\Exceptions\\PaymentFailed (* = qualquer exceção)'));
  const error = el('small', 'debug-field-error'); error.setAttribute('role', 'alert');
  const foot = el('footer', 'debug-dialog-foot'); const cancel = el('button', 'debug-button', tr('Cancelar')); cancel.type = 'button'; const ok = el('button', 'debug-button debug-button-default', 'OK'); ok.type = 'button';
  foot.append(cancel, ok); dialog.append(el('header', 'debug-dialog-title', tr('Adicionar breakpoint de exceção')), label, hint, error, foot); box.append(dialog); document.body.append(box);
  const close = () => box.remove();
  const accept = () => {
   const name = input.value.trim().replace(/^\\+/, '');
   if (!/^(\*|[A-Za-z_\x80-￿][\w\x80-￿]*(\\[A-Za-z_\x80-￿][\w\x80-￿]*)*)$/.test(name)) { error.textContent = tr('Informe o nome de uma classe de exceção'); input.focus(); return; }
   close(); done(name);
  };
  cancel.onclick = close; ok.onclick = accept;
  dialog.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); accept(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  input.focus();
 }

 /** Evaluate Expression: janela não modal com Expressão, Resultado em árvore, Fechar/Avaliar. */
 let evaluateWindow: HTMLElement | undefined;
 function evaluate(initial = '') {
  if (evaluateWindow?.isConnected) { const input = evaluateWindow.querySelector<HTMLInputElement>('.debug-expression')!; if (initial) input.value = initial; input.focus(); input.select(); return; }
  const win = el('section', 'debug-dialog debug-evaluate'); win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', tr('Avaliar'));
  const head = el('header', 'debug-dialog-title', tr('Avaliar'));
  const label = el('label', 'debug-field-label', tr('Expressão:'));
  const input = el('input', 'debug-expression'); input.value = initial; input.spellcheck = false; input.setAttribute('aria-label', tr('Expressão'));
  const hint = el('small', 'debug-hint debug-hint-right', tr('Use ⇧⌘⏎ para adicionar aos watches'));
  const result = el('ul', 'debug-tree debug-evaluate-result'); result.setAttribute('role', 'tree'); result.setAttribute('aria-label', tr('Resultado'));
  const empty = () => { const li = el('li', 'debug-empty debug-nothing', tr('Nada para mostrar')); result.replaceChildren(li); };
  empty();
  const foot = el('footer', 'debug-dialog-foot'); const close = el('button', 'debug-button', tr('Fechar')); close.type = 'button'; const run = el('button', 'debug-button debug-button-default', tr('Avaliar')); run.type = 'button';
  foot.append(close, run);
  win.append(head, label, input, hint, el('div', 'debug-field-label', tr('Resultado:')), result, foot);
  document.body.append(win); evaluateWindow = win;
  const shut = () => { win.remove(); evaluateWindow = undefined; ctx.restoreFocus(); };
  let busy = false;
  const go = async () => {
   const expression = input.value.trim(); if (!expression || busy) return;
   if (!ctx.paused()) { result.replaceChildren(propNode(ctx.tree, { name: 'result', fullname: '', type: 'error', value: tr('Pause num breakpoint para avaliar expressões'), children: false, numchildren: 0, page: 0, items: [] }, { kind: 'error' })); return; }
   busy = true; run.disabled = true;
   try {
    const p = await ctx.evaluate(expression);
    result.replaceChildren(p ? propNode(ctx.tree, { ...p, fullname: p.fullname || expression }, { kind: 'result', label: 'result' }) : el('li', 'debug-empty', tr('(sem valor)')));
    result.querySelector<HTMLButtonElement>('.debug-twist:not(:disabled)')?.click();
   } catch (error) { result.replaceChildren(propNode(ctx.tree, { name: 'result', fullname: '', type: 'error', value: String((error as Error)?.message ?? error), children: false, numchildren: 0, page: 0, items: [] }, { kind: 'error' })); }
   finally { busy = false; run.disabled = false; }
  };
  run.onclick = () => void go(); close.onclick = shut;
  win.onkeydown = e => {
   if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); }
   else if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (input.value.trim()) ctx.addWatch(input.value.trim()); }
   else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); void go(); }
  };
  // Arrastar pela barra de título (janela não modal, como no PhpStorm).
  head.onpointerdown = e => { const r = win.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top; head.setPointerCapture(e.pointerId);
   head.onpointermove = m => { win.style.left = Math.max(0, m.clientX - dx) + 'px'; win.style.top = Math.max(0, m.clientY - dy) + 'px'; win.style.transform = 'none'; };
   head.onpointerup = () => { head.onpointermove = null; }; };
  input.focus(); input.select();
 }
 return { breakpoints, evaluate, refresh: () => open?.refresh(), close: () => { open?.close(); evaluateWindow?.remove(); evaluateWindow = undefined; } };
}
