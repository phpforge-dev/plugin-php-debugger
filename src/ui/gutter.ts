// Breakpoints no lugar do número da linha (New UI do PhpStorm): clique alterna, ⌥+clique ativa/desativa,
// ⇧+clique cria breakpoint de log, clique direito abre o popup de propriedades (ou o menu do número).
// A ordem do gutter é do host (src/editor-chrome.ts); aqui só há classes no número e eventos no número.
import { type Breakpoint, type BreakpointState, iconKind, lineKey, suspends } from './model';

export type GutterCtx = {
 monaco: any; editor: any; tr: (s: string, ...a: unknown[]) => string; msg: (p: TemplateStringsArray, ...v: unknown[]) => string;
 own: (d: any) => any;
 relative(model: any): string | undefined;
 breakpoints(): Breakpoint[]; muted(): boolean; state(path: string, line: number): BreakpointState | undefined;
 /** Linha de execução/frame selecionado no modelo, com o tipo de parada. */
 execution(path: string): { line: number; top: boolean; exception: boolean } | undefined;
 inline(path: string): { line: number; text: string }[];
 add(b: Breakpoint): void; remove(b: Breakpoint): void; changed(b?: Breakpoint): void;
 openDialog(select?: Breakpoint): void; status(text: string): void;
};

export function mountGutter(ctx: GutterCtx) {
 const { monaco, editor, tr, msg } = ctx;
 const decorations = new Map<any, { ids: string[]; points: Breakpoint[] }>();
 const container: HTMLElement = editor.getContainerDomNode();
 const inlineValues = editor.createDecorationsCollection();
 ctx.own(editor.onDidChangeModel(() => paint(editor.getModel())));
 container.classList.add('debug-gutter');

 function paint(model: any) {
  if (!model || model.isDisposed()) return;
  const path = ctx.relative(model); const lines = model.getLineCount();
  const points = path ? ctx.breakpoints().filter(b => b.path === path && b.line <= lines) : [];
  const exec = path ? ctx.execution(path) : undefined;
  const muted = ctx.muted();
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ij-breakpoint').trim() || '#DB5C5C';
  const list: any[] = points.map(b => {
   const state = ctx.state(b.path, b.line);
   const kind = iconKind(b, state, muted);
   const live = b.enabled && !muted && suspends(b);
   const execHere = exec && exec.line === b.line;
   return { range: new monaco.Range(b.line, 1, b.line, 1), options: {
    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    lineNumberClassName: 'debug-bp ' + kind.split(' ').map(k => 'debug-bp-' + k).join(' ') + (execHere && exec!.exception ? ' debug-bp-exception' : ''),
    className: live && !execHere ? 'debug-bp-row' : undefined, isWholeLine: true,
    overviewRuler: b.enabled && !muted ? { color, position: monaco.editor.OverviewRulerLane.Right } : undefined,
   } };
  });
  if (exec) {
   const marked = points.some(b => b.line === exec.line);
   list.push({ range: new monaco.Range(exec.line, 1, exec.line, 1), options: { isWholeLine: true, className: exec.top ? 'debug-exec-line' : 'debug-frame-line',
    lineNumberClassName: marked ? undefined : exec.exception ? 'debug-bp debug-bp-exception' : 'debug-exec-number' } });
  }
  // Valores inline são do editor (não do modelo): só o editor visível os desenha.
  if (model === editor.getModel()) inlineValues.set((path ? ctx.inline(path) : []).filter(v => v.line <= lines).map(value => {
   const end = model.getLineMaxColumn(value.line);
   return { range: new monaco.Range(value.line, end, value.line, end), options: { showIfCollapsed: true, after: { content: '   ' + value.text, inlineClassName: 'debug-inline-value', cursorStops: monaco.editor.InjectedTextCursorStops?.None } } };
  }));
  decorations.set(model, { ids: model.deltaDecorations(decorations.get(model)?.ids ?? [], list), points });
 }
 const paintAll = () => monaco.editor.getModels().forEach(paint);

 // Linhas acompanham edições: a decoração "gruda" no texto e a nova linha é gravada.
 function track(model: any) {
  ctx.own(model.onDidChangeContent(() => {
   const painted = decorations.get(model); if (!painted) return; let moved = false;
   const { ids, points } = painted;
   ids.slice(0, points.length).forEach((id, index) => { const range = model.getDecorationRange(id); const b = points[index]; if (range && b && range.startLineNumber !== b.line) { b.line = range.startLineNumber; moved = true; } });
   if (moved) ctx.changed();
  }));
  paint(model);
 }
 monaco.editor.getModels().forEach(track); ctx.own(monaco.editor.onDidCreateModel(track));
 ctx.own(monaco.editor.onWillDisposeModel((model: any) => decorations.delete(model)));

 // ---- eventos no número da linha ----
 const numberAt = (event: MouseEvent): { path: string; line: number } | undefined => {
  const target = event.target as Element | null;
  if (!target?.closest?.('.margin-view-overlays .line-numbers')) return undefined;
  const model = editor.getModel(); const path = model && ctx.relative(model);
  const hit = editor.getTargetAtClientPoint(event.clientX, event.clientY);
  const line = hit?.position?.lineNumber ?? Number(target.closest('.line-numbers')?.textContent);
  if (!path) { ctx.status(tr('Breakpoints só em arquivos do projeto')); return undefined; }
  return line ? { path, line } : undefined;
 };
 const find = (path: string, line: number) => ctx.breakpoints().find(b => b.path === path && b.line === line);
 const swallow = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
 let lastPointer = -Infinity;
 const onDown = (event: MouseEvent) => {
  if (event.button !== 0) return;
  const at = numberAt(event); if (!at) return;
  swallow(event);
  // preventDefault no pointerdown suprime o mousedown de compatibilidade; sem Pointer Events, vale o mousedown.
  if (event.type === 'pointerdown') lastPointer = event.timeStamp; else if (event.timeStamp - lastPointer < 1000) return;
  closePopup();
  const existing = find(at.path, at.line);
  if (event.altKey) { if (existing) { existing.enabled = !existing.enabled; ctx.changed(existing); } else ctx.add({ path: at.path, line: at.line, condition: '', enabled: false }); return; }
  if (event.shiftKey) { if (existing) ctx.remove(existing); else ctx.add({ path: at.path, line: at.line, condition: '', enabled: true, suspend: false, log: true }); return; }
  if (existing) ctx.remove(existing); else ctx.add({ path: at.path, line: at.line, condition: '', enabled: true });
 };
 const onContext = (event: MouseEvent) => {
  const at = numberAt(event); if (!at) return;
  swallow(event);
  const existing = find(at.path, at.line);
  const anchor = (event.target as Element).closest('.line-numbers') as HTMLElement;
  if (existing) showPopup(existing, anchor); else showMenu(at, event.clientX, event.clientY);
 };
 const onMove = (event: MouseEvent) => {
  const target = (event.target as Element | null)?.closest?.('.margin-view-overlays .line-numbers') as HTMLElement | null; if (!target) return;
  const model = editor.getModel(); const path = model && ctx.relative(model); if (!path) return;
  const line = editor.getTargetAtClientPoint(event.clientX, event.clientY)?.position?.lineNumber; const b = line ? find(path, line) : undefined;
  target.title = b ? describe(b) : '';
 };
 for (const type of ['pointerdown', 'mousedown'] as const) container.addEventListener(type, onDown as any, true);
 container.addEventListener('mouseup', e => { if (numberAt(e)) swallow(e); }, true);
 container.addEventListener('contextmenu', onContext, true);
 container.addEventListener('mouseover', onMove, true);
 ctx.own(() => { for (const type of ['pointerdown', 'mousedown']) container.removeEventListener(type, onDown as any, true); container.removeEventListener('contextmenu', onContext, true); container.removeEventListener('mouseover', onMove, true); container.classList.remove('debug-gutter'); });

 function describe(b: Breakpoint) {
  const state = ctx.state(b.path, b.line);
  if (state?.state === 'invalid') return msg`Breakpoint inválido: ${state.message ?? ''}`;
  const kind = !b.enabled ? tr('Breakpoint desativado') : suspends(b) ? (b.condition.trim() ? msg`Breakpoint condicional: ${b.condition}` : tr('Breakpoint de linha')) : tr('Breakpoint de log (não suspende)');
  return `${kind}\n${b.path.split('/').pop()}:${b.line}${state?.state === 'verified' ? '\n' + tr('Verificado pelo Xdebug') : ''}`;
 }

 // ---- menu do número sem breakpoint ----
 let menu: HTMLElement | undefined;
 function closeMenu() { menu?.remove(); menu = undefined; document.removeEventListener('pointerdown', outsideMenu, true); }
 const outsideMenu = (event: Event) => { if (menu && !menu.contains(event.target as Node)) closeMenu(); };
 function showMenu(at: { path: string; line: number }, x: number, y: number) {
  closeMenu(); closePopup();
  menu = document.createElement('div'); menu.className = 'context-menu debug-gutter-menu'; menu.setAttribute('role', 'menu');
  const item = (label: string, run: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); const span = document.createElement('span'); span.textContent = tr(label); b.append(span); b.onclick = () => { closeMenu(); run(); }; menu!.append(b); return b; };
  item('Adicionar breakpoint', () => ctx.add({ path: at.path, line: at.line, condition: '', enabled: true }));
  item('Adicionar breakpoint condicional…', () => { const b: Breakpoint = { path: at.path, line: at.line, condition: '', enabled: true }; ctx.add(b); showPopup(b, lineNumberElement(at.line), true); });
  item('Adicionar breakpoint de log…', () => { const b: Breakpoint = { path: at.path, line: at.line, condition: '', enabled: true, suspend: false, log: true }; ctx.add(b); ctx.openDialog(b); });
  menu.onkeydown = event => {
   const buttons = [...menu!.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
   if (event.key === 'Escape') { event.preventDefault(); closeMenu(); editor.focus(); }
   if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
  };
  document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
  (menu.querySelector('button') as HTMLElement).focus();
  document.addEventListener('pointerdown', outsideMenu, true);
 }
 const lineNumberElement = (line: number): HTMLElement | undefined => {
  const top = editor.getTopForLineNumber(line) - editor.getScrollTop(); const node = editor.getDomNode();
  return [...(node?.querySelectorAll('.margin-view-overlays .line-numbers') ?? [])].find((el: any) => Math.abs(el.parentElement.offsetTop - top) < 2 || el.parentElement.style.top === top + 'px') as HTMLElement | undefined;
 };

 // ---- popup de propriedades (clique direito no breakpoint) ----
 let popup: HTMLElement | undefined;
 function closePopup() { popup?.remove(); popup = undefined; document.removeEventListener('pointerdown', outsidePopup, true); }
 const outsidePopup = (event: Event) => { if (popup && !popup.contains(event.target as Node)) closePopup(); };
 function showPopup(b: Breakpoint, anchor: HTMLElement | undefined, focusCondition = true) {
  closeMenu(); closePopup();
  popup = document.createElement('div'); popup.className = 'debug-bp-popup'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', msg`Breakpoint ${b.path}:${b.line}`);
  const title = document.createElement('strong'); title.textContent = `${b.path.split('/').pop()}:${b.line}`;
  const check = (label: string, value: boolean, set: (v: boolean) => void) => {
   const row = document.createElement('label'); row.className = 'debug-check'; const input = document.createElement('input'); input.type = 'checkbox'; input.checked = value;
   input.onchange = () => { set(input.checked); ctx.changed(b); }; row.append(input, tr(label)); return row;
  };
  const condLabel = document.createElement('label'); condLabel.className = 'debug-field-label'; condLabel.textContent = tr('Condição:');
  const condition = document.createElement('input'); condition.className = 'debug-expression'; condition.value = b.condition; condition.spellcheck = false; condition.setAttribute('aria-label', tr('Condição'));
  condition.oninput = () => { b.condition = condition.value; ctx.changed(b); };
  const foot = document.createElement('div'); foot.className = 'debug-popup-foot';
  const more = document.createElement('button'); more.type = 'button'; more.className = 'debug-link'; more.textContent = tr('Mais') + ' (⇧⌘F8)'; more.onclick = () => { closePopup(); ctx.openDialog(b); };
  const done = document.createElement('button'); done.type = 'button'; done.className = 'debug-button'; done.textContent = tr('Concluir'); done.onclick = () => { b.condition = condition.value.trim(); ctx.changed(b); closePopup(); editor.focus(); };
  foot.append(more, done);
  popup.append(title, check('Ativado', b.enabled, v => b.enabled = v), check('Suspender execução', suspends(b), v => b.suspend = v), condLabel, condition, foot);
  popup.onkeydown = event => { if (event.key === 'Escape' || (event.key === 'Enter' && event.target === condition)) { event.preventDefault(); done.click(); } };
  document.body.append(popup);
  const rect = (anchor ?? container).getBoundingClientRect();
  popup.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - 28, innerWidth - popup.offsetWidth - 8)) + 'px';
  popup.style.top = Math.min(rect.bottom + 8, innerHeight - popup.offsetHeight - 8) + 'px';
  popup.style.setProperty('--debug-arrow', Math.max(12, rect.left + rect.width / 2 - popup.getBoundingClientRect().left) + 'px');
  if (focusCondition) condition.focus();
  document.addEventListener('pointerdown', outsidePopup, true);
 }
 ctx.own(() => { closeMenu(); closePopup(); inlineValues.clear(); for (const [model, { ids }] of decorations) if (!model.isDisposed()) model.deltaDecorations(ids, []); decorations.clear(); });
 return { paint, paintAll, showPopup, closePopup };
}
