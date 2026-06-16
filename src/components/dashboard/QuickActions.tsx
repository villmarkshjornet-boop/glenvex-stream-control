'use client';

import { useState } from 'react';
import Link from 'next/link';

export function QuickActions() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function runStreamTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/discord/test-live', { method: 'POST' });
      setTestResult(res.ok ? 'Test-melding sendt til Discord ✓' : 'Testen feilet – se aktivitetsfeed');
    } catch {
      setTestResult('Testen feilet – se aktivitetsfeed');
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 6000);
  }

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Hurtighandlinger</p>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={runStreamTest} disabled={testing}
          className={`px-3 py-1.5 border rounded-lg text-[10px] font-bold transition-colors ${
            testing ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed' : 'border-g-border text-g-muted hover:text-g-green hover:border-g-green/30'
          }`}>
          {testing ? '↻ Tester...' : '▶ Start stream test'}
        </button>
        <Link href="/stream-coach" className="px-3 py-1.5 border border-g-border rounded-lg text-[10px] font-bold text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
          Åpne Stream Coach
        </Link>
        <Link href="/content-factory-admin/highlights" className="px-3 py-1.5 border border-g-border rounded-lg text-[10px] font-bold text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
          Lag highlight
        </Link>
        <Link href="/ai-producer" className="px-3 py-1.5 border border-g-border rounded-lg text-[10px] font-bold text-g-muted hover:text-g-green hover:border-g-green/30 transition-colors">
          Kjør AI-analyse
        </Link>
        {testResult && <span className="text-[9px] text-g-muted ml-1">{testResult}</span>}
      </div>
    </div>
  );
}
