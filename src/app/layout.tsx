import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tally | Northline Studio',
  description: 'A focused, responsive spreadsheet workspace.',
  applicationName: 'Tally',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
