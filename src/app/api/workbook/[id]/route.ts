import { NextResponse } from 'next/server';
import { loadWorkbook, saveWorkbook } from '@/lib/persistence';
import { isSameOriginMutation } from '@/lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if ((await context.params).id !== 'studio') return NextResponse.json({ error: 'Workbook not found' }, { status: 404 });
  try {
    return NextResponse.json(await loadWorkbook(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load the workbook. Try again.' }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: 'Cross-origin changes are not allowed' }, { status: 403 });
  if ((await context.params).id !== 'studio') return NextResponse.json({ error: 'Workbook not found' }, { status: 404 });
  await new Promise(resolve => setTimeout(resolve, 350 + Math.floor(Math.random() * 1151)));
  if (Math.random() < 0.2) {
    return NextResponse.json({ error: 'Simulated save failure. Your local changes are safe.' }, { status: 503 });
  }
  try {
    const content = await request.text();
    if (Buffer.byteLength(content) > 15 * 1024 * 1024) return NextResponse.json({ error: 'Workbook too large' }, { status: 413 });
    const saved = await saveWorkbook(JSON.parse(content));
    return NextResponse.json({ updatedAt: saved.updatedAt });
  } catch {
    return NextResponse.json({ error: 'Could not save this workbook.' }, { status: 400 });
  }
}
