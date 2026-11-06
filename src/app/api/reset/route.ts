import { NextResponse } from 'next/server';
import { resetWorkbook } from '@/lib/persistence';

export const runtime = 'nodejs';

export async function POST() {
  try { return NextResponse.json(await resetWorkbook()); }
  catch { return NextResponse.json({ error: 'Reset failed' }, { status: 500 }); }
}
