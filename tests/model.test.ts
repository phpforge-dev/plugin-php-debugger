// Regras puras do depurador: ícones, formato de valores, valores inline, breakpoints atingidos e configuração.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineConfig, defaults, hitBreakpoint, hitException, iconKind, inlineValues, scopeStart, typeLabel, valueText, type Prop } from '../src/ui/model.ts';

const prop = (name: string, type: string, value: string, extra: Partial<Prop> = {}): Prop => ({ name, fullname: name, type, value, children: false, numchildren: 0, page: 0, items: [], ...extra });
const source = `<?php
final class Order
{
    public function total(): int
    {
        $sum = 0;
        foreach ($this->items as $price) {
            $sum += $price;
        }
        return $sum;
    }
}
function checkout(Order $order): int
{
    $total = $order->total(); // $ignored
    return $total;
}
$order = new Order();
$name = '$notAVariable';
`.split('\n');

test('ícone do breakpoint segue o estado mais específico', () => {
 const b = { path: 'a.php', line: 3, condition: '', enabled: true };
 assert.equal(iconKind(b, undefined, false), 'line');
 assert.equal(iconKind({ ...b, condition: '$i > 1' }, undefined, false), 'conditional');
 assert.equal(iconKind({ ...b, condition: '$i > 1' }, { state: 'verified' }, false), 'conditional verified');
 assert.equal(iconKind({ ...b, enabled: false }, { state: 'verified' }, false), 'disabled');
 assert.equal(iconKind(b, { state: 'invalid', message: 'x' }, false), 'invalid');
 assert.equal(iconKind({ ...b, suspend: false }, undefined, false), 'log');
 assert.equal(iconKind(b, { state: 'verified' }, true), 'muted');
 assert.equal(iconKind({ ...b, enabled: false }, undefined, true), 'muted-disabled');
});

test('valores no formato {tipo} valor da árvore de variáveis', () => {
 assert.equal(typeLabel(prop('$o', 'object', '', { classname: 'App\\Order' })), 'App\\Order');
 assert.equal(typeLabel(prop('$a', 'array', '', { numchildren: 3 })), 'array[3]');
 assert.equal(valueText(prop('$s', 'string', 'A-1')), '"A-1"');
 assert.equal(valueText(prop('$s', 'string', 'abc', { size: 9000 })), '"abc"…');
 assert.equal(valueText(prop('$b', 'bool', '1')), 'true');
 assert.equal(valueText(prop('$n', 'null', '')), 'null');
 assert.equal(valueText(prop('$i', 'int', '60')), '60');
});

test('valores inline: escopo da função corrente, ordem de aparição, sem comentários nem strings', () => {
 assert.equal(scopeStart(source, 15), 13);
 assert.equal(scopeStart(source, 6), 4);
 assert.equal(scopeStart(source, 19), 1);
 const known = new Map([['$order', prop('$order', 'object', '', { classname: 'Order' })], ['$total', prop('$total', 'int', '60')], ['$ignored', prop('$ignored', 'int', '1')], ['$notAVariable', prop('$notAVariable', 'int', '1')]]);
 assert.deepEqual(inlineValues(source, 13, 15, known), [{ line: 13, text: '$order: Order' }, { line: 15, text: '$total: 60   $order: Order' }]);
 assert.deepEqual(inlineValues(source, 18, 19, known), [{ line: 18, text: '$order: Order' }]);
});

test('breakpoint atingido pelo topo da pilha e exceção pelo nome', () => {
 const points = [{ path: 'a.php', line: 3, condition: '', enabled: true }, { path: 'a.php', line: 5, condition: '', enabled: false }];
 assert.equal(hitBreakpoint(points, { level: 0, where: '', type: 'file', line: 3, local: 'a.php', server: '/app/a.php' }), points[0]);
 assert.equal(hitBreakpoint(points, { level: 0, where: '', type: 'file', line: 5, local: 'a.php', server: '/app/a.php' }), undefined);
 assert.equal(hitBreakpoint(points, { level: 0, where: '', type: 'file', line: 3, local: null, server: '/app/a.php' }), undefined);
 const list = [{ name: 'App\\Boom', enabled: true, condition: '' }, { name: 'Off', enabled: false, condition: '' }];
 assert.equal(hitException(list, '\\App\\Boom'), list[0]);
 assert.equal(hitException(list, 'Off'), undefined);
 const any = [{ name: '*', enabled: true, condition: '' }];
 assert.equal(hitException(any, 'Anything'), any[0]);
});

test('configuração do motor: só ativos; silenciar não envia nada', () => {
 const s = { ...defaults(), breakpoints: [{ path: 'a.php', line: 3, condition: '', enabled: true }, { path: 'a.php', line: 4, condition: '', enabled: false }], exceptions: [{ name: 'E', enabled: true, condition: '$x' }, { name: 'F', enabled: false, condition: '' }] };
 assert.deepEqual(engineConfig(s).breakpoints.map(b => b.line), [3]);
 assert.deepEqual(engineConfig(s).exceptions, [{ name: 'E', enabled: true, condition: '' }], 'condição de exceção é avaliada pela IDE, não pelo Xdebug');
 assert.deepEqual(engineConfig({ ...s, muted: true }), { breakpoints: [], exceptions: [] });
});
