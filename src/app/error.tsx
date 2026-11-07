'use client';

import Link from 'next/link';
import { useTransition } from 'react';

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  const [pending, startTransition] = useTransition();
  return <main className="empty-page"><section className="empty-card"><span className="empty-mark">Error</span><h1>Something interrupted the workspace.</h1><p>Try loading the sheet again, or return to the workbook.</p><div className="recovery-actions"><button className="primary-button" disabled={pending} onClick={() => startTransition(retry)}>{pending ? 'Trying again…' : 'Try again'}</button><Link className="text-button" href="/s/budget?cell=A1">Open workbook</Link></div></section></main>;
}
