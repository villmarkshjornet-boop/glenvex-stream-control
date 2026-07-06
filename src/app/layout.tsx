import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import BotVarsler from '@/components/BotVarsler';
import { I18nProvider } from '@/contexts/I18nContext';

export const metadata: Metadata = {
  title: 'GLENVEX Stream Control',
  description: 'Twitch + Discord command center for GLENVEX',
};

const FULL_PAGE_PATHS = ['/login', '/onboarding', '/overlay'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname') ?? '';
  const isFullPage = FULL_PAGE_PATHS.some(p => pathname.startsWith(p));

  const isOverlay = pathname.startsWith('/overlay');

  if (isFullPage || isOverlay) {
    if (isOverlay) {
      return (
        <html lang="no" style={{ margin: 0, padding: 0, background: 'transparent', overflow: 'hidden' }}>
          <head>
            <style>{`html,body{background:transparent!important;margin:0;padding:0;overflow:hidden}`}</style>
          </head>
          <body style={{ margin: 0, padding: 0, background: 'transparent', overflow: 'hidden' }}>
            {children}
          </body>
        </html>
      );
    }
    return (
      <html lang="no">
        <body className="bg-g-bg text-g-text">
          {children}
        </body>
      </html>
    );
  }

  return (
    <html lang="no">
      <body className="bg-g-bg text-g-text">
        <I18nProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <Topbar />
              <main className="flex-1 p-5 overflow-auto">{children}</main>
            </div>
          </div>
          <BotVarsler />
        </I18nProvider>
      </body>
    </html>
  );
}
