'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main className="empty-page"><div className="empty-card"><span className="empty-mark">Error</span><h1>Something interrupted the workspace.</h1><p>Your local edits are kept in this browser. You can try loading the sheet again.</p><button className="primary-button" onClick={reset}>Try again</button></div></main>;
}
