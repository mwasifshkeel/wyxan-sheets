'use client';

import './globals.css';

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return <html lang="en"><body><title>Workspace error | Tally</title><main className="empty-page"><section className="empty-card"><h1>The workspace couldn&apos;t load.</h1><p>Try again to reopen your workbook.</p><button className="primary-button" onClick={retry}>Try again</button></section></main></body></html>;
}
