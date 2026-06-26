'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PlayCircle, MessageCircle, Scissors, Sparkles } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';

export function QuickActions() {
  const { t } = useI18n();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function runStreamTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/discord/test-live', { method: 'POST' });
      setTestResult(res.ok ? t('quickActions.testSent') : t('quickActions.testFailed'));
    } catch {
      setTestResult(t('quickActions.testFailed'));
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 6000);
  }

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6 h-full">
      <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-4">{t('quickActions.title')}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={runStreamTest} disabled={testing}
          className={`flex items-center gap-1.5 px-3.5 py-2 border rounded-lg text-xs font-bold transition-colors ${
            testing ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed' : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
          }`}>
          <PlayCircle size={14} /> {testing ? t('quickActions.testing') : t('quickActions.runTest')}
        </button>
        <Link href="/stream-coach" className="flex items-center gap-1.5 px-3.5 py-2 border border-g-border rounded-lg text-xs font-bold text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
          <MessageCircle size={14} /> {t('quickActions.streamCoach')}
        </Link>
        <Link href="/content-factory-admin/highlights" className="flex items-center gap-1.5 px-3.5 py-2 border border-g-border rounded-lg text-xs font-bold text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
          <Scissors size={14} /> {t('quickActions.highlight')}
        </Link>
        <Link href="/ai-producer" className="flex items-center gap-1.5 px-3.5 py-2 border border-g-border rounded-lg text-xs font-bold text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
          <Sparkles size={14} /> {t('quickActions.aiAnalysis')}
        </Link>
        {testResult && <span className="text-xs text-g-muted ml-1">{testResult}</span>}
      </div>
    </div>
  );
}
