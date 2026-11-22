import type { Metadata, Viewport } from 'next';
import AppProviders from '@/components/AppProviders';
import './globals.css';

export const metadata: Metadata = {
  title: 'NEXUS',
  description: 'Personal information and document intelligence.',
  applicationName: 'NEXUS',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'NEXUS', statusBarStyle: 'black-translucent' },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0c10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
