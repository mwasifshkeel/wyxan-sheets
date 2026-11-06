import { NextResponse } from 'next/server';
import { resetWorkbook } from '@/lib/persistence';
import { isSameOriginMutation } from '@/lib/request-security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: 'Cross-origin changes are not allowed' }, { status: 403 });
  try { return NextResponse.json(await resetWorkbook()); }
  catch { return NextResponse.json({ error: 'Reset failed' }, { status: 500 }); }
}
