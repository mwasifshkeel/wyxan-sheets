import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { addressAt, parseAddress } from './address';
import { createFixtures } from './fixtures';
import { DEFAULT_COL_WIDTH, INITIAL_COLS, MAX_COLS, type CellMap, type Sheet, type Workbook } from './types';

const directory = path.join(process.cwd(), '.data');
const location = path.join(directory, 'studio.json');
const maxBytes = 15 * 1024 * 1024;

export function validateWorkbook(input: unknown): Workbook {
  if (!input || typeof input !== 'object') throw Error('invalid workbook');
  const obj = input as Record<string, unknown>;
  if (obj.id !== 'studio' || !Array.isArray(obj.sheets) || obj.sheets.length > 15 || !obj.sheets.length) throw Error('invalid sheets');
  const used = new Set<string>();
  const sheets: Sheet[] = obj.sheets.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw Error('invalid sheet');
    const sheet = entry as Record<string, unknown>;
    if (typeof sheet.id !== 'string' || !/^[a-z0-9-]{1,50}$/.test(sheet.id) || used.has(sheet.id)) throw Error('invalid sheet id');
    used.add(sheet.id);
    if (typeof sheet.name !== 'string' || sheet.name.length > 80) throw Error('invalid name');
    if (!sheet.cells || typeof sheet.cells !== 'object' || Array.isArray(sheet.cells)) throw Error('invalid cells');
    const cells: CellMap = Object.create(null) as CellMap;
    for (const [address, value] of Object.entries(sheet.cells)) {
      const position = parseAddress(address);
      if (!position || typeof value !== 'string' || value.length > 4000) throw Error('invalid cell');
      if (value) cells[addressAt(position.row, position.col)] = value;
    }
    const widths = Array.isArray(sheet.widths) ? sheet.widths : [];
    const columnCount = Object.keys(cells).reduce((count, address) => Math.max(count, parseAddress(address)!.col + 1), Math.max(INITIAL_COLS, Math.min(MAX_COLS, widths.length)));
    return {
      id: sheet.id,
      name: sheet.name,
      cells,
      widths: Array.from({ length: columnCount }, (_, index) => {
        const width: unknown = widths[index];
        return typeof width === 'number' && Number.isFinite(width) ? Math.max(64, Math.min(600, width)) : DEFAULT_COL_WIDTH;
      }),
      frozen: sheet.frozen === true,
    };
  });
  return { id: 'studio', name: typeof obj.name === 'string' ? obj.name.slice(0, 80) : 'Workbook', sheets, updatedAt: typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now() };
}

export async function loadWorkbook(): Promise<Workbook> {
  try {
    const content = await readFile(location, 'utf8');
    return validateWorkbook(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createFixtures();
    throw error;
  }
}

export async function saveWorkbook(input: unknown): Promise<Workbook> {
  const validated = validateWorkbook(input);
  const content = JSON.stringify(validated);
  if (Buffer.byteLength(content) > maxBytes) throw Error('workbook is too large');
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `studio-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, location);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return validated;
}

export async function resetWorkbook() {
  await rm(location, { force: true });
  return createFixtures();
}
