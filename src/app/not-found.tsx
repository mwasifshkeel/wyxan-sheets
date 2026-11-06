import Link from 'next/link';

export default function NotFound() {
  return <main className="empty-page"><div className="empty-card"><span className="empty-mark">404</span><h1>We couldn&apos;t find that page.</h1><p>The address may have changed.</p><Link className="primary-button" href="/s/budget?cell=A1">Open workbook</Link></div></main>;
}
