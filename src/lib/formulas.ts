import { addressAt, normalizedAddress, parseAddress } from './address';
import { MAX_COLS, MAX_ROWS, type CellMap } from './types';

type Token = { kind: 'number' | 'word' | 'operator' | 'end'; text: string };
type Node =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'range'; start: string; end: string }
  | { kind: 'unary'; node: Node; operator: string }
  | { kind: 'binary'; left: Node; right: Node; operator: string }
  | { kind: 'call'; name: string; args: Node[] };
type CellValue = string | number;
export type FormulaError = '#REF!' | '#DIV/0!' | '#CYCLE!' | '#VALUE!' | '#ERROR!';
const ERRORS = new Set(['#REF!', '#DIV/0!', '#CYCLE!', '#VALUE!', '#ERROR!']);
const MAX_FORMULA_LENGTH = 4000;
const MAX_RANGE = 120000;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) { index++; continue; }
    const part = text.slice(index);
    const matched = /^(?:((?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)|(\$?[A-Za-z]+\$?[1-9][0-9]*|[A-Za-z_][A-Za-z_0-9]*)|([+*/():,\-]))/.exec(part);
    if (!matched) throw Error('unrecognized formula token');
    if (matched[1]) tokens.push({ kind: 'number', text: matched[1] });
    else if (matched[2]) tokens.push({ kind: 'word', text: matched[2].toUpperCase() });
    else tokens.push({ kind: 'operator', text: matched[3] });
    index += matched[0].length;
    if (tokens.length > 2000) throw Error('formula too complex');
  }
  tokens.push({ kind: 'end', text: '' });
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private tokens: Token[]) {}
  private peek(): Token { return this.tokens[this.index]; }
  private take(): Token { return this.tokens[this.index++]; }
  private accept(symbol: string): boolean {
    if (this.peek().text !== symbol) return false;
    this.index++;
    return true;
  }
  private expect(symbol: string): void { if (!this.accept(symbol)) throw Error('expected ' + symbol); }
  parse(): Node {
    const expression = this.expression();
    if (this.peek().kind !== 'end') throw Error('trailing token');
    return expression;
  }
  private expression(): Node {
    let node = this.term();
    while (['+', '-'].includes(this.peek().text)) {
      const operator = this.take().text;
      node = { kind: 'binary', left: node, right: this.term(), operator };
    }
    return node;
  }
  private term(): Node {
    let node = this.unary();
    while (['*', '/'].includes(this.peek().text)) {
      const operator = this.take().text;
      node = { kind: 'binary', left: node, right: this.unary(), operator };
    }
    return node;
  }
  private unary(): Node {
    if (['+', '-'].includes(this.peek().text)) {
      const operator = this.take().text;
      return { kind: 'unary', node: this.unary(), operator };
    }
    return this.primary();
  }
  private primary(): Node {
    const token = this.take();
    if (token.kind === 'number') return { kind: 'number', value: Number(token.text) };
    if (token.text === '(') {
      const node = this.expression();
      this.expect(')');
      return node;
    }
    if (token.kind === 'word') {
      if (this.accept('(')) {
        const args: Node[] = [];
        if (!this.accept(')')) {
          do { args.push(this.argument()); } while (this.accept(','));
          this.expect(')');
        }
        return { kind: 'call', name: token.text, args };
      }
      if (!/^\$?[A-Z]+\$?[1-9][0-9]*$/.test(token.text)) throw Error('unknown identifier');
      return { kind: 'ref', name: token.text };
    }
    throw Error('expected expression');
  }
  private argument(): Node {
    if (this.peek().kind === 'word' && /^\$?[A-Z]+\$?[1-9][0-9]*$/.test(this.peek().text)
      && this.tokens[this.index + 1]?.text === ':') {
      const start = this.take().text;
      this.take();
      const end = this.take();
      if (end.kind !== 'word' || !/^\$?[A-Z]+\$?[1-9][0-9]*$/.test(end.text)) throw Error('invalid range');
      return { kind: 'range', start, end: end.text };
    }
    return this.expression();
  }
}

function parseFormula(raw: string): Node | null {
  if (!raw.startsWith('=') || raw.length > MAX_FORMULA_LENGTH) return null;
  try { return new Parser(tokenize(raw.slice(1))).parse(); }
  catch { return null; }
}

function expandRange(start: string, end: string): string[] | null {
  const a = parseAddress(start);
  const b = parseAddress(end);
  if (!a || !b) return null;
  const top = Math.min(a.row, b.row), bottom = Math.max(a.row, b.row);
  const left = Math.min(a.col, b.col), right = Math.max(a.col, b.col);
  if ((bottom - top + 1) * (right - left + 1) > MAX_RANGE) return null;
  const values: string[] = [];
  for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) values.push(addressAt(r, c));
  return values;
}

function references(node: Node, result = new Set<string>()): Set<string> {
  if (node.kind === 'ref') {
    const address = normalizedAddress(node.name);
    if (address) result.add(address);
  } else if (node.kind === 'range') {
    for (const address of expandRange(node.start, node.end) || []) result.add(address);
  } else if (node.kind === 'binary') {
    references(node.left, result); references(node.right, result);
  } else if (node.kind === 'unary') references(node.node, result);
  else if (node.kind === 'call') for (const arg of node.args) references(arg, result);
  return result;
}

function asNumber(value: CellValue): number | FormulaError {
  if (typeof value === 'number') return value;
  if (ERRORS.has(value)) return value as FormulaError;
  if (value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : '#VALUE!';
}

export class FormulaEngine {
  private raw: CellMap;
  private parsed = new Map<string, Node | null>();
  private dependencies = new Map<string, Set<string>>();
  private dependents = new Map<string, Set<string>>();
  private cache = new Map<string, CellValue>();
  constructor(cells: CellMap) {
    this.raw = { ...cells };
    for (const [address, value] of Object.entries(this.raw)) {
      if (value.startsWith('=')) this.setDependencies(address, value);
    }
  }
  get size() { return this.raw ? Object.keys(this.raw).length : 0; }
  getRaw(address: string) { return this.raw[address] ?? ''; }
  private setDependencies(address: string, raw: string) {
    for (const old of this.dependencies.get(address) || []) {
      const users = this.dependents.get(old);
      users?.delete(address);
      if (users?.size === 0) this.dependents.delete(old);
    }
    const tree = parseFormula(raw);
    this.parsed.set(address, tree);
    const deps = tree ? references(tree) : new Set<string>();
    this.dependencies.set(address, deps);
    for (const dep of deps) {
      if (!this.dependents.has(dep)) this.dependents.set(dep, new Set());
      this.dependents.get(dep)!.add(address);
    }
  }
  patch(changes: { address: string; after: string }[]): Set<string> {
    const affected = new Set<string>();
    const queue = changes.map(change => change.address);
    for (const change of changes) {
      if (change.after) this.raw[change.address] = change.after;
      else delete this.raw[change.address];
      this.setDependencies(change.address, change.after);
    }
    while (queue.length) {
      const address = queue.pop()!;
      if (affected.has(address)) continue;
      affected.add(address);
      for (const dependent of this.dependents.get(address) || []) queue.push(dependent);
    }
    for (const address of affected) this.cache.delete(address);
    return affected;
  }
  evaluate(address: string): CellValue {
    const normalized = normalizedAddress(address);
    if (!normalized) return '#REF!';
    return this.resolve(normalized, new Set());
  }
  private resolve(address: string, visiting: Set<string>): CellValue {
    if (visiting.has(address)) return '#CYCLE!';
    if (this.cache.has(address)) return this.cache.get(address)!;
    const raw = this.getRaw(address);
    if (!raw) return '';
    if (raw.startsWith('=') && raw.includes('#REF!')) return '#REF!';
    if (!raw.startsWith('=')) return raw;
    const tree = this.parsed.get(address);
    if (!tree) return '#ERROR!';
    visiting.add(address);
    const result = this.walk(tree, visiting);
    visiting.delete(address);
    const final = typeof result === 'number' && !Number.isFinite(result) ? '#VALUE!' : result;
    this.cache.set(address, final);
    return final;
  }
  private walk(node: Node, visiting: Set<string>): CellValue {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'ref') {
      const address = normalizedAddress(node.name);
      return address ? this.resolve(address, visiting) : '#REF!';
    }
    if (node.kind === 'range') return '#VALUE!';
    if (node.kind === 'unary') {
      const value = asNumber(this.walk(node.node, visiting));
      if (typeof value !== 'number') return value;
      return node.operator === '-' ? -value : value;
    }
    if (node.kind === 'binary') {
      const left = asNumber(this.walk(node.left, visiting));
      if (typeof left !== 'number') return left;
      const right = asNumber(this.walk(node.right, visiting));
      if (typeof right !== 'number') return right;
      if (node.operator === '/' && right === 0) return '#DIV/0!';
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        default: return left / right;
      }
    }
    if (!['SUM', 'AVG'].includes(node.name)) return '#ERROR!';
    let sum = 0, count = 0;
    for (const arg of node.args) {
      const candidates = arg.kind === 'range' ? expandRange(arg.start, arg.end) : null;
      if (arg.kind === 'range' && !candidates) return '#REF!';
      if (candidates) {
        for (const address of candidates) {
          const value = this.resolve(address, visiting);
          if (typeof value === 'string' && ERRORS.has(value)) return value;
          if (value === '' || (typeof value === 'string' && !Number.isFinite(Number(value)))) continue;
          const numeric = Number(value);
          sum += numeric; count++;
        }
      } else {
        const value = this.walk(arg, visiting);
        if (typeof value === 'string' && ERRORS.has(value)) return value;
        if (arg.kind === 'ref' && (value === '' || (typeof value === 'string' && !Number.isFinite(Number(value))))) continue;
        const numeric = asNumber(value);
        if (typeof numeric !== 'number') return numeric;
        sum += numeric; count++;
      }
    }
    return node.name === 'SUM' ? sum : count ? sum / count : '#DIV/0!';
  }
}

export function displayValue(value: CellValue): string {
  if (typeof value === 'string') return value;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

export function isFormulaError(value: CellValue) {
  return typeof value === 'string' && ERRORS.has(value);
}

export function formulaBounds() { return { rows: MAX_ROWS, columns: MAX_COLS }; }
