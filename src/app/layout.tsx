import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import BotVarsler from '@/components/BotVarsler';

export const metadata: Metadata = {
  title: 'GLENVEX Stream Control',
  description: 'Twitch + Discord command center for GLENVEX',
};

const FULL_PAGE_PATHS = ['/login', '/onboarding'];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname') ?? '';
  const isFullPage = FULL_PAGE_PATHS.some(p => pathname.startsWith(p));

  if (isFullPage) {
    return (
      <html lang="no">
        <body className="bg-g-bg text-g-text">{children}</body>
      </html>
    );
  }

  return (
    <html lang="no">
      <body className="bg-g-bg text-g-text">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar />
            <main className="flex-1 p-5 overflow-auto">{children}</main>
          </div>
        </div>
        <BotVarsler />
      </body>
    </html>
  );
}
