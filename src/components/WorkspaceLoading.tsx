import { Icon } from './Icons';

export function WorkspaceLoading({ resetting = false }: { resetting?: boolean }) {
  return <main className="app-shell loading-state" aria-busy="true">
    <header className="topbar"><div className="brand-section"><span className="brand-mark"><Icon name="grid" /></span><span className="brand-name">tally</span></div></header>
    <div className="loading-content" aria-hidden="true"><div className="loading-line wide"/><div className="loading-line"/><div className="loading-grid"/></div>
    <p className="loading-copy" role="status">{resetting ? 'Resetting workbook… Restoring the original demo sheets.' : 'Opening Northline Studio…'}</p>
  </main>;
}
