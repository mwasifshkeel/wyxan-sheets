export type FunctionDefinition = { name: 'SUM' | 'AVERAGE'; aliases: readonly string[]; description: string; syntax: string; example: string; parameter: string };
export const FUNCTIONS: readonly FunctionDefinition[] = [
  {
    name: 'SUM', aliases: [],
    description: 'Adds numbers and the numeric values in cells or ranges.',
    syntax: 'SUM(number1, [number2], …)',
    example: '=SUM(A1:A10, B1, 5)',
    parameter: 'A number, a cell such as B7, or a range such as A1:A10. Blank cells and text in ranges are ignored.',
  },
  {
    name: 'AVERAGE', aliases: ['AVG'],
    description: 'Returns the arithmetic mean of numeric values. AVG is also accepted.',
    syntax: 'AVERAGE(number1, [number2], …)',
    example: '=AVERAGE(A1:A10)',
    parameter: 'A number, cell, or range. Blank cells and text in ranges are ignored; zero values are included.',
  },
];

export function findFunction(name: string): FunctionDefinition | undefined {
  const upper = name.toUpperCase();
  return FUNCTIONS.find(fn => fn.name === upper || fn.aliases.includes(upper));
}

export function functionSuggestions(value: string, caret: number) {
  if (!value.startsWith('=') || value.length > 4000) return [];
  const match = /([A-Z_][A-Z_0-9]*)$/i.exec(value.slice(0, caret));
  if (!match || (match.index > 0 && !/[=+\-*/(,\s]/.test(value[match.index - 1]))) return [];
  const prefix = match[1].toUpperCase();
  return FUNCTIONS.flatMap(fn => [fn.name, ...fn.aliases].filter(name => name.startsWith(prefix)).map(name => ({ name, definition: fn, start: match.index })));
}

export function completeFunction(value: string, caret: number, name: string, start: number) {
  const tail = value.slice(caret).replace(/^[A-Z_0-9]+/i, '');
  const existingParenthesis = /^\s*\(/.test(tail);
  const text = value.slice(0, start) + name + (existingParenthesis ? '' : '()') + tail;
  return { text, caret: start + name.length + (existingParenthesis ? tail.indexOf('(') + 1 : 1) };
}

export function functionContext(value: string, caret: number) {
  if (!value.startsWith('=') || value.length > 4000) return null;
  const stack: { name: string; argument: number }[] = [];
  for (let i = 1; i < caret; i++) {
    if (value[i] === '(') stack.push({ name: /([A-Z_][A-Z_0-9]*)\s*$/i.exec(value.slice(0, i))?.[1] || '', argument: 0 });
    else if (value[i] === ')') stack.pop();
    else if (value[i] === ',' && stack.length) stack[stack.length - 1].argument++;
  }
  for (const entry of stack.reverse()) {
    const definition = findFunction(entry.name);
    if (definition) return { ...entry, name: entry.name.toUpperCase(), definition };
  }
  return null;
}

export function splitFunctionArguments(source: string): string[] {
  const values: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')') depth--;
    if (source[i] === ',' && depth === 0) { values.push(source.slice(start, i).trim()); start = i + 1; }
  }
  values.push(source.slice(start).trim());
  return values;
}
