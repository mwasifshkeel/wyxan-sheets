import { addressAt } from './address';
import { DEFAULT_COL_WIDTH, MAX_COLS, type CellMap, type Sheet, type Workbook } from './types';

const widths = () => Array.from({ length: MAX_COLS }, (_, col) => col === 0 ? 210 : col === 1 ? 164 : DEFAULT_COL_WIDTH);
const sheet = (id: string, name: string, cells: CellMap): Sheet => ({ id, name, cells, widths: widths(), frozen: true });

function budget(): Sheet {
  const cells: CellMap = {
    A1: 'Northline Studio', A2: 'FY 2027 operating budget', A4: 'Revenue & operating plan',
    A6: 'Account', B6: 'Jan', C6: 'Feb', D6: 'Mar', E6: 'Q1 total', F6: 'Change',
    A7: 'Retained clients', A8: 'New engagements', A9: 'Licensing', A10: 'Services subtotal',
    A12: 'Payroll', A13: 'Contractors', A14: 'Infrastructure', A15: 'Software', A16: 'Travel',
    A17: 'Operations subtotal', A19: 'Gross contribution', A20: 'Margin',
    A22: 'Tax allocation', A23: 'Reserves', A24: 'Available cash', A26: 'Forecast adjustment',
    A27: 'Adjusted cash', A29: 'Target variance', A30: 'Management view',
    H6: 'Budget notes', H7: 'All figures in USD', H9: 'Update a source figure', H10: 'to watch the chain',
    H12: 'Q1 target', I12: '275000', H14: 'Forecast version', I14: 'Draft 02',
  };
  const lines: Record<number, [number, number, number]> = {
    7: [43000, 46500, 48200], 8: [18500, 22000, 24500], 9: [8200, 8200, 9000],
    12: [28000, 28000, 29400], 13: [9800, 12400, 11000], 14: [3700, 3900, 3900],
    15: [1800, 1850, 1850], 16: [1500, 2450, 2100],
  };
  for (const [rowText, values] of Object.entries(lines)) {
    const row = Number(rowText);
    for (let col = 1; col <= 3; col++) cells[addressAt(row - 1, col)] = String(values[col - 1]);
    cells[`E${row}`] = `=SUM(B${row}:D${row})`;
    cells[`F${row}`] = `=D${row}-B${row}`;
  }
  for (const col of ['B', 'C', 'D', 'E', 'F']) {
    cells[`${col}10`] = `=SUM(${col}7:${col}9)`;
    cells[`${col}17`] = `=SUM(${col}12:${col}16)`;
    cells[`${col}19`] = `=${col}10-${col}17`;
    cells[`${col}20`] = `=${col}19/${col}10*100`;
    cells[`${col}22`] = `=${col}19*0.18`;
    cells[`${col}23`] = `=${col}19*0.12`;
    cells[`${col}24`] = `=${col}19-${col}22-${col}23`;
    cells[`${col}26`] = `=${col}24*0.035`;
    cells[`${col}27`] = `=${col}24+${col}26`;
    cells[`${col}29`] = `=${col}27-$I$12`;
    cells[`${col}30`] = `=${col}29+${col}26`;
  }
  return sheet('budget', 'Operating budget', cells);
}

function large(): Sheet {
  const cells: CellMap = {
    A1: 'Order', B1: 'Segment', C1: 'Region', D1: 'Units', E1: 'Unit cost',
    F1: 'Unit price', G1: 'Discount', H1: 'Shipping', I1: 'Tax', J1: 'Quarter',
    K1: 'Channel', L1: 'Net', A10000: 'Portfolio total', L10000: '=SUM(L2:L9999)',
  };
  const regions = ['North', 'South', 'East', 'West'];
  const segments = ['Retail', 'Direct', 'Partner'];
  for (let row = 2; row <= 9999; row++) {
    const i = row - 2;
    cells[`A${row}`] = `ORD-${String(i + 1).padStart(5, '0')}`;
    cells[`B${row}`] = segments[i % 3];
    cells[`C${row}`] = regions[i % 4];
    cells[`D${row}`] = String(1 + (i * 7) % 22);
    cells[`E${row}`] = String(12 + (i * 3) % 65);
    cells[`F${row}`] = String(38 + (i * 11) % 150);
    cells[`G${row}`] = String((i % 5) * 0.025);
    cells[`H${row}`] = String(4 + i % 9);
    cells[`I${row}`] = String(1 + i % 6);
    cells[`J${row}`] = `Q${1 + i % 4}`;
    cells[`K${row}`] = i % 2 ? 'Web' : 'Store';
    cells[`L${row}`] = `=D${row}*F${row}*(1-G${row})-D${row}*E${row}-H${row}-I${row}`;
  }
  return sheet('orders', '10k orders', cells);
}

function broken(): Sheet {
  const cells = {
    A1: 'Formula diagnostics', A3: 'Test', B3: 'Expression', C3: 'Result',
    A5: 'Circular reference', B5: '=C5+1', C5: '=B5*2',
    A7: 'Out of range', B7: '=XFE99999', C7: '=B7+2',
    A9: 'Division by zero', B9: '120', C9: '=B9/0',
    A11: 'Dependent error', B11: '=C9+10', C11: '=B11*2',
    A13: 'Bad function', B13: '=MEDIAN(1,2)', C13: '=B13+1',
    A15: 'Valid comparison', B15: '36', C15: '=B15/3+8',
    A18: 'Cells display errors without interrupting the sheet.',
  };
  return sheet('diagnostics', 'Formula diagnostics', cells);
}

export function createFixtures(): Workbook {
  return {
    id: 'studio',
    name: 'Northline Studio',
    sheets: [budget(), large(), broken()],
    updatedAt: 1735689600000,
  };
}
