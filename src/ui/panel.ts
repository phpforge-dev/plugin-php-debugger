// Depurador Xdebug (DBGp): breakpoints no número da linha, janela Debug (frames, variáveis, watches, console),
// Evaluate Expression, valores inline, breakpoints de exceção e pausa assíncrona quando o motor aceita.
// Referência de comportamento: docs/research/xdebug-fidelity.md no php-ide (observação do PhpStorm 2026.1.4).
import { type Breakpoint, type BreakpointState, type ExceptionBreakpoint, type Frame, type Mapping, type Prop, type Settings, defaults, engineConfig, errorText, hitBreakpoint, hitException, inlineValues, lineKey, scopeStart, suspends } from './model';
import { mountGutter } from './gutter';
import { mountDialogs } from './dialogs';
import { propNode, type TreeCtx } from './tree';

type Session = { id: string; info: { idekey?: string; server?: string; local?: string | null; peer?: string; run?: string | null; engine?: string }; status: string; frames: Frame[]; frame: number; epoch: number; async: boolean; exception?: { name: string; message?: string }; lastAction: string; result?: { expression: string; prop: Prop | null; error?: string } };
type DebugEvent = { kind: string; session?: string; run?: string; [key: string]: any };
/** Métodos do serviço nativo (native/src/debug.rs) expostos pelo proxy de ferramenta do host. */
interface DebugApi {
 debugStatus(): Promise<{ listening: { port: number; all: boolean } | null; sessions: { id: string; status: string; info: Session['info']; async?: boolean }[] }>;
 debugListen(port: number, all: boolean): Promise<unknown>; debugUnlisten(): Promise<unknown>;
 debugConfig(breakpoints: Breakpoint[], mappings: Mapping[], breakFirst: boolean, exceptions: ExceptionBreakpoint[]): Promise<void>;
 debugRun(path: string, args?: string[]): Promise<{ run: string; idekey: string; script: string }>; debugRunStop(run: string): Promise<void>;
 debugContinue(session: string, action: string): Promise<void>; debugPause(session: string): Promise<void>; debugStack(session: string): Promise<Frame[]>;
 debugContexts(session: string, depth: number): Promise<{ id: number; name: string }[]>;
 debugVariables(session: string, depth: number, context: number): Promise<Prop[]>;
 debugProperty(session: string, depth: number, context: number, fullname: string, page: number): Promise<Prop>;
 debugEval(session: string, expression: string): Promise<Prop | null>;
}
type Host = { editor: any; open(path: string, line: number): Promise<void>; status(text: string): void };

// Ícones próprios (traço simples, 16px), sem recursos da JetBrains.
const ICONS: Record<string, string> = {
 stop: '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>',
 resume: '<path d="M3.5 3.5v9" stroke-width="1.6"/><path d="M6.5 3.5 12.5 8l-6 4.5z" fill="currentColor" stroke="none"/>',
 pause: '<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="1.8"/>',
 over: '<path d="M3 9.5c1-4 7-5 9.5-1"/><path d="M12.5 5.5v3h-3"/><path d="M3 12.5h10"/>',
 into: '<path d="M8 2.5v8"/><path d="M5 7.5l3 3 3-3"/><path d="M3 13.5h10"/>',
 out: '<path d="M8 11V3"/><path d="M5 6l3-3 3 3"/><path d="M3 13.5h10"/>',
 breakpoints: '<circle cx="6" cy="9" r="3.5"/><circle cx="10" cy="7" r="3.5"/>',
 mute: '<circle cx="8" cy="8" r="4.5"/><path d="M3 13 13 3"/>',
 more: '<circle cx="8" cy="3.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="12.5" r=".9" fill="currentColor"/>',
 listen: '<path d="M5.5 3.5c-1.4 1.2-2 2.7-2 4.5s.6 3.3 2 4.5M10.5 3.5c1.4 1.2 2 2.7 2 4.5s-.6 3.3-2 4.5"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>',
 run: '<path d="M5 3.5 12 8l-7 4.5z"/>',
 watch: '<path d="M8 3v10M3 8h10" />',
 layout: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M6.5 3v10"/>',
};
const svg = (name: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

export function activate(sdk: any) {
 const { monaco, listen, tr, msg, html, keymap, own } = sdk;
 return mountDebugger(sdk.api, sdk.host);

 function mountDebugger(ideApi: any, host: Host) {
  const api = ideApi as DebugApi;
  const editor = host.editor;
  const panel = document.createElement('section'); panel.id = 'debug-panel'; panel.hidden = true; panel.setAttribute('aria-label', tr('Depurar'));
  panel.innerHTML = html(`<div class="debug-header"><strong>Depurar</strong><div id="debug-sessions" role="tablist" aria-label="Sessões de depuração"></div><span id="debug-state" role="status" aria-live="polite"></span><button id="debug-listen" class="debug-tool" aria-pressed="false"></button><button id="debug-script" class="debug-tool"></button><button id="debug-hide" class="debug-tool" aria-label="Ocultar">−</button></div>
<div class="debug-toolbar" role="toolbar" aria-label="Depurador"><button id="debug-stop" class="debug-tool"></button><span class="debug-sep"></span><button id="debug-resume" class="debug-tool"></button><button id="debug-pause" class="debug-tool"></button><button id="debug-over" class="debug-tool"></button><button id="debug-into" class="debug-tool"></button><button id="debug-out" class="debug-tool"></button><span class="debug-sep"></span><button id="debug-view-breakpoints" class="debug-tool"></button><button id="debug-mute" class="debug-tool" aria-pressed="false"></button><button id="debug-more" class="debug-tool" aria-haspopup="menu"></button><div class="debug-tabs" role="tablist"><button role="tab" data-tab="threads" aria-selected="true">Threads e variáveis</button><button role="tab" data-tab="console" aria-selected="false">Console</button></div></div>
<div class="debug-body"><div data-view="threads" class="debug-threads"><div class="debug-frames-pane"><ol id="debug-frames" aria-label="Frames"></ol></div><div class="debug-vars-pane"><form id="debug-eval-form"><input id="debug-eval" spellcheck="false" autocomplete="off" aria-label="Avaliar expressão ou adicionar watch"><button id="debug-add-watch" type="button" class="debug-tool"></button></form><ul id="debug-tree" class="debug-tree" role="tree" aria-label="Variáveis"></ul></div></div>
<div data-view="console" hidden><pre id="debug-console" aria-live="polite"></pre></div>
<div data-view="settings" hidden class="debug-settings"><h4>Configurações do depurador</h4><label class="debug-inline-field"><span>Porta Xdebug</span><input id="debug-port" type="number" min="1024" max="65535"></label><label class="debug-check"><input type="checkbox" id="debug-all"> Aceitar conexões de outras interfaces (Docker no Linux)</label><label class="debug-check"><input type="checkbox" id="debug-break-first"> Parar na primeira linha</label><label class="debug-check"><input type="checkbox" id="debug-inline"> Mostrar valores inline</label><h4>Mapeamentos de caminho</h4><p class="debug-hint">Caminho no servidor (container) → pasta do projeto. Vazio = raiz do projeto.</p><ul id="debug-mappings"></ul><form id="debug-mapping-form"><input id="debug-map-server" placeholder="/var/www/html" aria-label="Caminho no servidor"><input id="debug-map-local" placeholder="pasta no projeto" aria-label="Pasta local"><button class="debug-button">Adicionar</button></form><button type="button" class="debug-link" id="debug-settings-close">Voltar para Threads e variáveis</button></div></div>`);
  document.querySelector('.code')!.append(panel);
  const rail = document.createElement('button'); rail.id = 'show-debug'; rail.title = tr('Depurar') + ' · ⌘5'; rail.setAttribute('aria-label', tr('Depurar'));
  rail.innerHTML = html('<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0zM12 10v8M4 12h4m8 0h4M5 6l3 3m11-3-3 3M5 19l3-3m11 3-3-3"/></svg>');
  document.querySelector('.left-rail')?.append(rail);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => panel.querySelector<T>('#' + id)!;
  const tool = (id: string, icon: string, label: string) => { const b = el<HTMLButtonElement>(id); b.type = 'button'; b.innerHTML = svg(icon); b.setAttribute('aria-label', tr(label)); b.title = tr(label); return b; };
  tool('debug-stop', 'stop', 'Parar (⌘F2)'); tool('debug-resume', 'resume', 'Continuar programa (⌥⌘R)'); tool('debug-pause', 'pause', 'Pausar programa');
  tool('debug-over', 'over', 'Passar por cima (F8)'); tool('debug-into', 'into', 'Entrar (F7)'); tool('debug-out', 'out', 'Sair (⇧F8)');
  tool('debug-view-breakpoints', 'breakpoints', 'Ver breakpoints (⇧⌘F8)'); tool('debug-mute', 'mute', 'Silenciar breakpoints'); tool('debug-more', 'more', 'Mais');
  tool('debug-listen', 'listen', 'Escutar conexões de depuração PHP'); tool('debug-script', 'run', 'Depurar o arquivo PHP atual'); tool('debug-add-watch', 'watch', 'Adicionar aos watches (⇧⌘⏎)');
  el<HTMLInputElement>('debug-eval').placeholder = tr('Avaliar expressão (⏎) ou adicionar watch (⇧⌘⏎)');

  let root = ''; let settings: Settings = defaults(); let listening: { port: number; all: boolean } | null = null;
  const sessions = new Map<string, Session>(); let current: string | undefined; const runs = new Map<string, string>();
  const states = new Map<string, BreakpointState>(); const exceptionStates = new Map<string, BreakpointState>();
  let locals = new Map<string, Prop>(); let pushTimer = 0;
  const key = () => `php-ide-debug:${root}`;
  const save = () => { try { localStorage.setItem(key(), JSON.stringify(settings)); } catch { /* armazenamento indisponível: segue só na memória */ } };
  const load = () => { try { settings = { ...defaults(), ...JSON.parse(localStorage.getItem(key()) ?? '{}') }; } catch { settings = defaults(); } };
  function log(text: string, kind = '') { const line = document.createElement('span'); line.textContent = text.endsWith('\n') ? text : text + '\n'; if (kind) line.className = 'debug-' + kind; const out = el('debug-console'); out.append(line); while (out.childNodes.length > 2000) out.firstChild!.remove(); out.scrollTop = out.scrollHeight; }
  function fail(error: unknown) { const text = errorText(error); log(text, 'error'); host.status(text); }
  const config = () => { const c = engineConfig(settings); return api.debugConfig(c.breakpoints, settings.mappings, settings.breakFirst, c.exceptions); };
  function push() { clearTimeout(pushTimer); pushTimer = window.setTimeout(() => { save(); void config().catch(fail); }, 150); }

  // ---- breakpoints ----
  const relative = (model: any): string | undefined => { const p = model.uri.fsPath ?? model.uri.path; return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : undefined; };
  const modelFor = (path: string) => monaco.editor.getModels().find((m: any) => relative(m) === path);
  const session = () => current ? sessions.get(current) : undefined;
  const repaint = (path?: string) => { if (path) { const m = modelFor(path); if (m) gutter.paint(m); } else gutter.paintAll(); };
  function changed(b?: Breakpoint) {
   const seen = new Set<string>();
   settings.breakpoints = settings.breakpoints.filter(x => { const k = lineKey(x.path, x.line); if (seen.has(k)) return false; seen.add(k); return true; });
   if (b) states.delete(lineKey(b.path, b.line));
   repaint(b?.path); dialogs.refresh(); push();
  }
  function add(b: Breakpoint) { settings.breakpoints = settings.breakpoints.filter(x => !(x.path === b.path && x.line === b.line)).concat(b); changed(b); }
  function remove(b: Breakpoint) { settings.breakpoints = settings.breakpoints.filter(x => x !== b); states.delete(lineKey(b.path, b.line)); repaint(b.path); dialogs.refresh(); push(); }
  function toggleAtCursor() {
   const model = editor.getModel(); const path = model && relative(model); const line = editor.getPosition()?.lineNumber;
   if (!path || !line) { host.status(tr('Breakpoints só em arquivos do projeto')); return; }
   const existing = settings.breakpoints.find(b => b.path === path && b.line === line);
   if (existing) remove(existing); else add({ path, line, condition: '', enabled: true });
  }
  function execution(path: string) {
   const s = session(); if (s?.status !== 'break') return undefined;
   const f = s.frames[s.frame]; if (!f || f.local !== path) return undefined;
   return { line: f.line, top: s.frame === 0, exception: s.frame === 0 && !!s.exception };
  }
  function inline(path: string) {
   const s = session(); if (!settings.inline || s?.status !== 'break' || !locals.size) return [];
   const f = s.frames[s.frame]; const model = f?.local === path ? modelFor(path) : undefined; if (!model) return [];
   const lines = model.getLinesContent(); return inlineValues(lines, scopeStart(lines, f.line), f.line, locals);
  }

  const tree: TreeCtx = {
   tr, msg,
   async children(p, page) {
    const s = session(); if (!s || s.status !== 'break') return undefined; const epoch = s.epoch;
    const depth = s.frames[s.frame]?.level ?? 0;
    const r = await api.debugProperty(s.id, depth, 0, p.fullname, page);
    return epoch === s.epoch ? r : undefined;
   },
  };
  const gutter = mountGutter({ monaco, editor, tr, msg, own, relative, breakpoints: () => settings.breakpoints, muted: () => settings.muted, state: (path, line) => states.get(lineKey(path, line)), execution, inline, add, remove, changed, openDialog: b => dialogs.breakpoints(b), status: host.status });
  const dialogs = mountDialogs({
   tr, msg, settings: () => settings, changed, remove,
   removeException: e => { settings.exceptions = settings.exceptions.filter(x => x !== e); dialogs.refresh(); push(); },
   addException: name => { const existing = settings.exceptions.find(e => e.name === name); if (existing) return existing; const e: ExceptionBreakpoint = { name, enabled: true, condition: '' }; settings.exceptions.push(e); push(); return e; },
   goTo: b => void host.open(b.path, b.line - 1).catch(fail),
   preview: async b => {
    const model = modelFor(b.path); let lines: string[] | undefined = model?.getLinesContent();
    if (!lines) try { lines = String((await ideApi.read(b.path)).text ?? '').split('\n'); } catch { return undefined; }
    const first = Math.max(1, b.line - 3); return { first, lines: lines.slice(first - 1, b.line + 3) };
   },
   tree, evaluate: expression => { const s = session(); return s ? api.debugEval(s.id, expression) : Promise.resolve(null); }, addWatch, paused: () => session()?.status === 'break',
   restoreFocus: () => editor.focus(),
  });

  // ---- sessões, frames e variáveis ----
  function controls() {
   const s = session(); const paused = s?.status === 'break'; const running = s?.status === 'running';
   for (const id of ['debug-resume', 'debug-over', 'debug-into', 'debug-out']) el<HTMLButtonElement>(id).disabled = !paused;
   const pause = el<HTMLButtonElement>('debug-pause'); pause.disabled = !running || !s?.async;
   pause.title = running && !s?.async ? tr('Pausar programa: este motor (Xdebug) não aceita pausa durante a execução. Use um breakpoint.') : tr('Pausar programa');
   el<HTMLButtonElement>('debug-stop').disabled = !s && !runs.size;
   const listenButton = el('debug-listen'); listenButton.setAttribute('aria-pressed', String(!!listening));
   listenButton.title = listening ? msg`Parar de escutar conexões de depuração PHP (porta ${listening.port})` : tr('Escutar conexões de depuração PHP');
   el('debug-mute').setAttribute('aria-pressed', String(settings.muted));
   rail.dataset.state = paused ? 'paused' : s ? 'running' : listening ? 'listening' : '';
   const tabs = el('debug-sessions');
   tabs.replaceChildren(...[...sessions.values()].map(x => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.className = 'debug-session-tab'; b.setAttribute('aria-selected', String(x.id === current));
    const dot = document.createElement('i'); dot.className = 'debug-session-dot'; dot.dataset.state = x.status;
    const name = document.createElement('span'); name.textContent = (x.info.local ?? x.info.server ?? x.info.idekey ?? x.id).split('/').pop() || x.id;
    const close = document.createElement('span'); close.className = 'debug-session-close'; close.textContent = '×'; close.title = tr('Encerrar sessão'); close.onclick = e => { e.stopPropagation(); current = x.id; void act('stop'); };
    b.append(dot, name, close); b.onclick = () => { current = x.id; controls(); renderFrames(); selectFrame(x.frame); };
    return b;
   }));
   el('debug-state').textContent = !s ? (listening ? msg`Aguardando conexão do Xdebug na porta ${listening.port}` : tr('Não está escutando')) : '';
  }
  function renderFrames() {
   const s = session(); const list = el('debug-frames');
   if (!s || s.status !== 'break') { const li = document.createElement('li'); li.className = 'debug-empty debug-centered'; li.textContent = s ? tr('Frames não disponíveis') : tr('Sem sessão de depuração'); list.replaceChildren(li); return; }
   list.replaceChildren(...s.frames.map((f, index) => {
    const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-selected', String(index === s.frame));
    const file = document.createElement('span'); file.textContent = `${(f.local ?? f.server).split('/').pop()}:${f.line}, `;
    const where = document.createElement('em'); where.textContent = (f.where || '{main}') + '()';
    b.title = `${f.local ?? f.server}:${f.line}`; b.append(file, where); b.onclick = () => selectFrame(index); li.append(b);
    if (!f.local) { li.classList.add('debug-unmapped'); const fix = document.createElement('button'); fix.type = 'button'; fix.className = 'debug-link'; fix.textContent = tr('Mapear caminho…'); fix.title = msg`Sem mapeamento para ${f.server}`; fix.onclick = () => suggestMapping(f.server); li.append(fix); }
    return li;
   }));
  }
  function selectFrame(index: number) {
   const s = session(); if (!s) return; s.frame = index; renderFrames();
   const f = s.frames[index]; locals = new Map(); repaint();
   if (f?.local) void host.open(f.local, f.line - 1).catch(fail);
   else if (f) log(msg`Arquivo do servidor sem mapeamento local: ${f.server}. Use “Mapear caminho…” no frame.`, 'warn');
   void variables();
  }
  const info = (text: string) => { const li = document.createElement('li'); li.className = 'debug-info-row'; const i = document.createElement('i'); i.className = 'debug-icon debug-icon-info'; li.append(i, text); return li; };
  async function variables() {
   const s = session(); const treeEl = el('debug-tree');
   if (!s) { treeEl.replaceChildren(); return; }
   if (s.status !== 'break') { treeEl.replaceChildren(info(s.status === 'running' ? tr('Conectado') : tr('Encerrando…'))); return; }
   const epoch = s.epoch; const depth = s.frames[s.frame]?.level ?? 0;
   try {
    const [watches, vars, globals] = await Promise.all([
     Promise.all(settings.watches.map(w => api.debugEval(s.id, w).then(p => ({ w, p, e: '' })).catch(e => ({ w, p: null, e: errorText(e) })))),
     api.debugVariables(s.id, depth, 0), api.debugVariables(s.id, depth, 1).catch(() => [] as Prop[]),
    ]);
    if (epoch !== s.epoch || session() !== s) return;
    locals = new Map(vars.filter(v => v.type !== 'uninitialized').map(v => [v.name, v])); repaint(s.frames[s.frame]?.local ?? undefined);
    const rows: HTMLLIElement[] = [];
    if (s.result) rows.push(s.result.prop ? propNode(tree, { ...s.result.prop, fullname: s.result.prop.fullname || s.result.expression }, { kind: 'result', label: 'result' }) : propNode(tree, { name: 'result', fullname: '', type: 'error', value: s.result.error ?? tr('(sem valor)'), children: false, numchildren: 0, page: 0, items: [] }, { kind: 'error' }));
    rows.push(...watches.map(({ w, p, e }, index) => propNode(tree, p ? { ...p, name: w, fullname: p.fullname || w } : { name: w, fullname: w, type: 'error', value: e || tr('sem valor'), children: false, numchildren: 0, page: 0, items: [] }, { kind: p ? 'watch' : 'error', label: w, remove: () => { settings.watches.splice(index, 1); save(); void variables(); } })));
    if (s.exception && s.frame === 0) rows.push(propNode(tree, { name: 'Exception', fullname: '', type: 'object', classname: s.exception.name, value: s.exception.message ?? '', children: false, numchildren: 0, page: 0, items: [] }, { kind: 'exception', label: 'Exception' }));
    // Como no PhpStorm: variáveis ainda não inicializadas não aparecem; do contexto global só as superglobais ($_*) não vazias.
    rows.push(...vars.filter(v => v.type !== 'uninitialized').map(v => propNode(tree, v)));
    rows.push(...globals.filter(g => g.name.startsWith('$_') && g.type !== 'uninitialized' && !(g.type === 'array' && g.numchildren === 0)).map(g => propNode(tree, g)));
    treeEl.replaceChildren(...rows);
    if (!rows.length) treeEl.replaceChildren(info(tr('Sem variáveis neste frame')));
   } catch (error) { if (epoch === s.epoch) { treeEl.replaceChildren(); fail(error); } }
  }
  function addWatch(expression: string) { if (!settings.watches.includes(expression)) settings.watches.push(expression); save(); show(); tab('threads'); void variables(); }
  el('debug-eval-form').onsubmit = e => { e.preventDefault(); void evaluateInline(); };
  el<HTMLInputElement>('debug-eval').onkeydown = e => { if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) { addWatch(v); (e.target as HTMLInputElement).value = ''; } } };
  el('debug-add-watch').onclick = () => { const input = el<HTMLInputElement>('debug-eval'); const v = input.value.trim(); if (v) { addWatch(v); input.value = ''; } else input.focus(); };
  async function evaluateInline() {
   const input = el<HTMLInputElement>('debug-eval'); const expression = input.value.trim(); const s = session(); if (!expression) return;
   if (s?.status !== 'break') { fail(tr('Pause num breakpoint para avaliar expressões')); return; }
   try { s.result = { expression, prop: await api.debugEval(s.id, expression) }; } catch (error) { s.result = { expression, prop: null, error: errorText(error) }; }
   await variables(); el('debug-tree').querySelector<HTMLButtonElement>('li:first-child .debug-twist:not(:disabled)')?.click();
  }

  // ---- mapeamentos e configurações ----
  function renderMappings() {
   const list = el('debug-mappings');
   list.replaceChildren(...settings.mappings.map((m, index) => {
    const li = document.createElement('li'); const text = document.createElement('code'); text.textContent = `${m.server} → ${m.local || tr('(raiz do projeto)')}`;
    const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.textContent = '×'; removeButton.title = tr('Remover mapeamento'); removeButton.onclick = () => { settings.mappings.splice(index, 1); renderMappings(); push(); };
    li.append(text, removeButton); return li;
   }));
   el<HTMLInputElement>('debug-all').checked = settings.all; el<HTMLInputElement>('debug-break-first').checked = settings.breakFirst; el<HTMLInputElement>('debug-inline').checked = settings.inline; el<HTMLInputElement>('debug-port').value = String(settings.port);
  }
  el('debug-mapping-form').onsubmit = e => {
   e.preventDefault(); const server = el<HTMLInputElement>('debug-map-server').value.trim(); const local = el<HTMLInputElement>('debug-map-local').value.trim().replace(/^\.?\/+|\/+$/g, '');
   if (!/^(\/|[A-Za-z]:)/.test(server)) { fail(tr('O caminho do servidor deve ser absoluto, ex.: /var/www/html')); return; }
   if (local.split('/').includes('..')) { fail(tr('A pasta local deve ficar dentro do projeto')); return; }
   settings.mappings = settings.mappings.filter(m => m.server !== server).concat({ server, local });
   el<HTMLInputElement>('debug-map-server').value = ''; el<HTMLInputElement>('debug-map-local').value = ''; renderMappings(); push();
   const s = session(); if (s?.status === 'break') void api.debugStack(s.id).then(frames => { s.frames = frames; renderFrames(); selectFrame(s.frame); }).catch(fail);
  };
  function suggestMapping(server: string) { tab('settings'); show(); el<HTMLInputElement>('debug-map-server').value = server.replace(/\/[^/]*$/, '') || '/'; el<HTMLInputElement>('debug-map-local').focus(); }
  el<HTMLInputElement>('debug-break-first').onchange = e => { settings.breakFirst = (e.target as HTMLInputElement).checked; push(); };
  el<HTMLInputElement>('debug-inline').onchange = e => { settings.inline = (e.target as HTMLInputElement).checked; save(); repaint(); };
  el<HTMLInputElement>('debug-all').onchange = e => { settings.all = (e.target as HTMLInputElement).checked; save(); if (listening) void startListening(); };
  el<HTMLInputElement>('debug-port').onchange = () => { settings.port = Number(el<HTMLInputElement>('debug-port').value) || 9003; save(); if (listening) void startListening(); };
  el('debug-settings-close').onclick = () => tab('threads');

  // ---- ações ----
  async function act(action: 'run' | 'step_into' | 'step_over' | 'step_out' | 'stop') {
   const s = session();
   if (!s) { if (action === 'stop' && runs.size) { for (const run of runs.keys()) await api.debugRunStop(run).catch(fail); } return; }
   if (action !== 'stop' && s.status !== 'break') return;
   s.lastAction = action; s.result = undefined;
   try { await api.debugContinue(s.id, action); if (action === 'stop' && s.info.run) await api.debugRunStop(s.info.run).catch(() => {}); } catch (error) { fail(error); }
  }
  async function pause() {
   const s = session(); if (s?.status !== 'running') return;
   try { s.lastAction = 'pause'; await api.debugPause(s.id); } catch (error) { fail(error); }
  }
  async function startListening() {
   settings.port = Number(el<HTMLInputElement>('debug-port').value) || settings.port || 9003; settings.all = el<HTMLInputElement>('debug-all').checked; save();
   try { await config(); const status = await api.debugListen(settings.port, settings.all) as { listening: { port: number; all: boolean } | null }; listening = status.listening; log(msg`Escutando conexões Xdebug na porta ${settings.port}${settings.all ? tr(' (todas as interfaces)') : ' (127.0.0.1)'}.`); host.status(msg`Depurador escutando na porta ${settings.port}`); }
   catch (error) { listening = null; fail(error); }
   controls();
  }
  async function toggleListening() { if (listening) { await api.debugUnlisten().catch(fail); listening = null; log(tr('Parou de escutar conexões de depuração.')); controls(); } else await startListening(); }
  el('debug-listen').onclick = () => void toggleListening();
  el('debug-script').onclick = () => void debugScript();
  async function debugScript() {
   const model = editor.getModel(); const path = model && relative(model);
   if (!path?.endsWith('.php')) { fail(tr('Abra um arquivo .php do projeto para depurá-lo')); return; }
   show(); if (!listening) await startListening(); if (!listening) return;
   try { const r = await api.debugRun(path); runs.set(r.run, path); log(msg`$ php ${r.script} · XDEBUG_SESSION=${r.idekey}`, 'input'); controls(); } catch (error) { fail(error); }
  }
  function toggleMute() { settings.muted = !settings.muted; save(); repaint(); push(); controls(); host.status(settings.muted ? tr('Breakpoints silenciados') : tr('Breakpoints ativos')); }
  el('debug-resume').onclick = () => void act('run'); el('debug-pause').onclick = () => void pause(); el('debug-over').onclick = () => void act('step_over'); el('debug-into').onclick = () => void act('step_into'); el('debug-out').onclick = () => void act('step_out'); el('debug-stop').onclick = () => void act('stop');
  el('debug-view-breakpoints').onclick = () => dialogs.breakpoints(); el('debug-mute').onclick = toggleMute;
  el('debug-more').onclick = () => {
   const button = el('debug-more'); const r = button.getBoundingClientRect();
   const menu = document.createElement('div'); menu.className = 'context-menu debug-more-menu'; menu.setAttribute('role', 'menu');
   const item = (label: string, shortcut: string, run: () => void, disabled = false) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.disabled = disabled; const span = document.createElement('span'); span.textContent = tr(label); b.append(span); if (shortcut) { const k = document.createElement('kbd'); k.textContent = shortcut; b.append(k); } b.onclick = () => { closeMenu(); run(); }; menu.append(b); };
   const paused = session()?.status === 'break';
   item('Avaliar expressão…', '⌥F8', () => evaluate(), !paused);
   item('Mostrar ponto de execução', '⌥F10', () => { const s = session(); if (s) selectFrame(0); }, !paused);
   item('Desanexar da sessão', '', () => { const s = session(); if (s) void api.debugContinue(s.id, 'detach').catch(fail); }, !session());
   menu.append(Object.assign(document.createElement('hr'), { className: 'debug-menu-sep' }));
   item('Configurações do depurador', '', () => { show(); tab('settings'); });
   document.body.append(menu); menu.style.left = r.left + 'px'; menu.style.top = r.bottom + 4 + 'px';
   const closeMenu = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); };
   const outside = (e: Event) => { if (!menu.contains(e.target as Node)) closeMenu(); };
   menu.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); button.focus(); } };
   document.addEventListener('pointerdown', outside, true); menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };
  function evaluate() {
   const model = editor.getModel(); const selection = editor.getSelection(); let initial = '';
   if (model && selection && !selection.isEmpty()) initial = model.getValueInRange(selection);
   else if (model && editor.getPosition()) { const p = editor.getPosition(); const line = model.getLineContent(p.lineNumber); const m = [...line.matchAll(/\$[A-Za-z_]\w*(?:->\w+(?!\w*\())*/g)].find(x => x.index! <= p.column - 1 && x.index! + x[0].length >= p.column - 1); initial = m?.[0] ?? ''; }
   dialogs.evaluate(initial.trim());
  }
  function tab(name: string) { panel.querySelectorAll<HTMLElement>('[data-view]').forEach(v => v.hidden = v.dataset.view !== name); panel.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name))); }
  panel.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab!));
  function show() { panel.hidden = false; rail.setAttribute('aria-pressed', 'true'); }
  function hide() { panel.hidden = true; rail.setAttribute('aria-pressed', 'false'); }
  rail.onclick = () => panel.hidden ? show() : hide(); el('debug-hide').onclick = hide;

  // UI-KEYMAP-001: atalhos no keymap central (editáveis). Padrões do keymap macOS do PhpStorm (ajuda pública).
  const paused = () => session()?.status === 'break';
  const debugAction = (id: string, label: string, mac: string | string[], other: string | string[], run: () => unknown, enabled?: () => boolean, aliases = '', jetbrains?: { mac?: string | string[]; other?: string | string[] }) =>
   keymap.registerAction({ id, label, category: 'Depuração', aliases: 'xdebug debug ' + aliases, defaults: { mac, other }, jetbrains, enabled, run });
  debugAction('tool.debug', 'Depurar', 'Alt+5', 'Alt+5', () => panel.hidden ? show() : hide(), undefined, 'janela ferramenta', { mac: 'Meta+5' });
  debugAction('debug.toggleBreakpoint', 'Alternar breakpoint de linha', 'Meta+F8', 'Ctrl+F8', () => toggleAtCursor(), undefined, 'toggle line breakpoint');
  debugAction('debug.viewBreakpoints', 'Ver breakpoints', 'Shift+Meta+F8', 'Ctrl+Shift+F8', () => dialogs.breakpoints(), undefined, 'view breakpoints');
  debugAction('debug.muteBreakpoints', 'Silenciar breakpoints', [], [], toggleMute, undefined, 'mute breakpoints');
  debugAction('debug.evaluate', 'Avaliar expressão', 'Alt+F8', 'Alt+F8', () => evaluate(), paused, 'evaluate expression');
  debugAction('debug.stop', 'Parar depuração', 'Meta+F2', 'Ctrl+F2', () => void act('stop'), () => !!session() || runs.size > 0, 'stop');
  debugAction('debug.resume', 'Continuar programa', ['Alt+Meta+R', 'F9'], 'F9', () => void act('run'), paused, 'resume program', { mac: ['Alt+Meta+R', 'F9'] });
  debugAction('debug.pause', 'Pausar programa', [], [], () => void pause(), () => session()?.status === 'running', 'pause program');
  debugAction('debug.stepOver', 'Passar por cima (step over)', 'F8', 'F8', () => void act('step_over'), paused, 'step over');
  debugAction('debug.stepInto', 'Entrar (step into)', 'F7', 'F7', () => void act('step_into'), paused, 'step into');
  debugAction('debug.stepOut', 'Sair (step out)', 'Shift+F8', 'Shift+F8', () => void act('step_out'), paused, 'step out');
  debugAction('debug.showExecutionPoint', 'Mostrar ponto de execução', 'Alt+F10', 'Alt+F10', () => selectFrame(0), paused, 'show execution point');
  debugAction('debug.listen', 'Escutar conexões de depuração PHP', [], [], () => void toggleListening(), undefined, 'start listening php debug connections');
  const railHint = () => { const k = keymap.shortcut('tool.debug'); rail.title = tr('Depurar') + (k ? ' · ' + k : ''); };
  keymap.onChange(railHint); railHint();

  // ---- eventos do serviço ----
  /** Parada atingida por um breakpoint de log/condição de exceção: registra e, se não suspende, continua. */
  async function afterBreak(s: Session, ev: DebugEvent): Promise<boolean> {
   const top = s.frames[0];
   if (ev.exception) {
    const e = hitException(settings.exceptions, ev.exception);
    if (e?.condition.trim()) { try { const r = await api.debugEval(s.id, e.condition); if (!r || r.value === '0' || r.value === '' || r.type === 'null' || (r.type === 'bool' && r.value !== '1')) { await api.debugContinue(s.id, 'run'); return true; } } catch (error) { log(msg`Condição do breakpoint de exceção ${e.name}: ${errorText(error)}`, 'warn'); } }
    if (e && !suspends(e)) { log(msg`Exceção ${ev.exception}: ${ev.message ?? ''}`, 'warn'); await api.debugContinue(s.id, 'run'); return true; }
    return false;
   }
   const b = (s.lastAction === 'run' || s.lastAction === 'start') ? hitBreakpoint(settings.breakpoints, top) : undefined;
   if (!b) return false;
   if (b.log) log(msg`Breakpoint atingido em ${b.path}:${b.line}`, 'info');
   if (b.logExpression?.trim()) { try { const r = await api.debugEval(s.id, b.logExpression); log(`${b.logExpression} = ${r ? (r.type === 'object' ? r.classname : r.type === 'array' ? `array[${r.numchildren}]` : r.value) : 'null'}`, 'info'); } catch (error) { log(msg`Avaliar e registrar: ${errorText(error)}`, 'warn'); } }
   if (b.removeOnce) remove(b);
   if (!suspends(b)) { s.lastAction = 'run'; await api.debugContinue(s.id, 'run'); return true; }
   return false;
  }
  function onEvent(ev: DebugEvent) {
   const s = ev.session ? sessions.get(ev.session) : undefined;
   switch (ev.kind) {
    case 'session': {
     sessions.set(ev.session!, { id: ev.session!, info: ev.info ?? {}, status: 'starting', frames: [], frame: 0, epoch: 0, async: false, lastAction: 'start' });
     if (!session() || session()!.status !== 'break') current = ev.session;
     log(msg`Conexão Xdebug ${ev.info?.engine ?? ''} de ${ev.info?.peer ?? '?'} · ${ev.info?.server ?? ''}`);
     if (ev.info?.server && !ev.info.local && !String(ev.info.server).startsWith('dbgp:')) { log(msg`Sem mapeamento local para ${ev.info.server}: breakpoints deste servidor não serão atingidos. Configure em Mapeamentos.`, 'warn'); suggestMapping(ev.info.server); }
     show(); break;
    }
    case 'capabilities': if (s) s.async = !!ev.async; break;
    case 'breakpoint': {
     const state: BreakpointState = { state: ev.state, message: ev.message };
     if (ev.exception) exceptionStates.set(ev.exception, state);
     else if (ev.path) { states.set(lineKey(ev.path, ev.line), state); repaint(ev.path); if (ev.state === 'invalid') log(msg`Breakpoint ${ev.path}:${ev.line} inválido: ${ev.message ?? ''}`, 'warn'); }
     dialogs.refresh(); break;
    }
    case 'running': if (s) { s.status = 'running'; s.epoch++; s.exception = undefined; if (s.id === current) { locals = new Map(); repaint(); renderFrames(); void variables(); } } break;
    case 'break': if (s) {
     s.status = 'break'; s.epoch++; s.frames = ev.frames ?? []; s.frame = 0; current = s.id;
     s.exception = ev.exception ? { name: ev.exception, message: ev.message } : undefined;
     void afterBreak(s, ev).then(resumed => {
      if (resumed || s.status !== 'break') return;
      if (ev.exception) log(msg`Exceção ${ev.exception}: ${ev.message ?? ''}`, 'error');
      show(); tab('threads'); renderFrames(); selectFrame(0); controls();
      const f = s.frames[0]; host.status(f ? msg`Pausado em ${f.local ?? f.server}:${f.line}` : tr('Pausado'));
     }).catch(fail);
    } break;
    case 'stopping': if (s) s.status = 'stopping'; break;
    case 'ended': sessions.delete(ev.session!); if (current === ev.session) { current = [...sessions.keys()].at(-1); locals = new Map(); renderFrames(); void variables(); }
     if (!sessions.size) { states.clear(); exceptionStates.clear(); }
     repaint(); log(tr('Sessão de depuração encerrada.')); host.status(tr('Sessão de depuração encerrada')); break;
    case 'output': { const out = document.createElement('span'); out.className = ev.stream === 'stderr' ? 'debug-stderr' : 'debug-stdout'; out.textContent = String(ev.text ?? ''); el('debug-console').append(out); el('debug-console').scrollTop = el('debug-console').scrollHeight; break; }
    case 'exit': {
     const path = runs.get(ev.run!); runs.delete(ev.run!);
     log(msg`[Processo encerrado: ${ev.code ?? tr('interrompido')}]`);
     if (path && !debugSeen.has(ev.run!)) log(tr('O script terminou sem conectar ao depurador. Verifique se o Xdebug 3 está ativo (xdebug.mode=debug) e a porta configurada.'), 'warn');
     break;
    }
    case 'error': fail(ev.message); break;
   }
   if (ev.kind === 'session' && ev.info?.run) debugSeen.add(ev.info.run);
   controls(); if (ev.kind === 'running' || ev.kind === 'ended' || ev.kind === 'session') renderFrames();
  }
  const debugSeen = new Set<string>();
  void listen('debug-event', (event: { payload: DebugEvent }) => onEvent(event.payload)).catch((error: unknown) => console.warn(tr('Eventos do depurador indisponíveis'), error));

  async function init() {
   root = (await ideApi.workspace()).root; load();
   renderMappings(); repaint(); renderFrames(); void variables();
   log(tr('Use “Escutar” e inicie o PHP com Xdebug 3 (xdebug.mode=debug, xdebug.start_with_request=trigger e XDEBUG_SESSION), ou “Depurar o arquivo PHP atual”.'));
   try {
    await config();
    const status = await api.debugStatus(); listening = status.listening;
    for (const x of status.sessions) if (!sessions.has(x.id)) sessions.set(x.id, { id: x.id, info: x.info, status: x.status, frames: [], frame: 0, epoch: 0, async: !!x.async, lastAction: 'run' });
    current ??= status.sessions[0]?.id;
    const s = session(); if (s?.status === 'break') { s.frames = await api.debugStack(s.id); renderFrames(); selectFrame(0); }
   } catch (error) { fail(error); }
   controls();
  }
  void init();
  return {
   toggleBreakpoint: toggleAtCursor,
   dispose() { clearTimeout(pushTimer); dialogs.close(); },
   reset() { el('debug-console').replaceChildren(); el('debug-tree').replaceChildren(); el('debug-frames').replaceChildren(); sessions.clear(); current = undefined; states.clear(); locals = new Map(); void init(); },
  };
 }
}
