'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Users, MessageSquare, Clock, AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { tidSiden } from './helpers';
import type { HeroStream } from './types';
import { useI18n } from '@/contexts/I18nContext';

const GRADE_STYLE: Record<HeroStream['grade'], { text: string; ring: string; glow: string }> = {
  S: { text: 'text-purple-400', ring: 'ring-purple-500/30', glow: 'shadow-purple-500/20' },
  A: { text: 'text-g-green',    ring: 'ring-g-green/30',    glow: 'shadow-g-green/20' },
  B: { text: 'text-blue-400',   ring: 'ring-blue-500/30',   glow: 'shadow-blue-500/20' },
  C: { text: 'text-yellow-400', ring: 'ring-yellow-500/30', glow: 'shadow-yellow-500/20' },
  D: { text: 'text-red-400',    ring: 'ring-red-500/30',    glow: 'shadow-red-500/20' },
};

function formatDuration(min: number, locale: string): string {
  const h = Math.floor(min / 60), m = min % 60;
  return locale === 'en'
    ? h > 0 ? `${h}h ${m}m` : `${m}m`
    : h > 0 ? `${h}t ${m}m` : `${m}m`;
}

export function Hero({ heroStream, loading }: { heroStream: HeroStream | null | undefined; loading: boolean }) {
  const { t, locale } = useI18n();
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  if (!heroStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
        <p className="text-sm text-g-muted">{t('hero.noStream')}</p>
        <Link href="/streamplan" className="text-xs text-g-green hover:underline mt-2 inline-block">{t('hero.viewStreamplan')}</Link>
      </div>
    );
  }

  const grade = GRADE_STYLE[heroStream.grade];
  const isEstimate = !heroStream.checklist.streamHistory;

  const stats = [
    { label: t('hero.peakViewers'),   val: heroStream.peakViewers.toLocaleString(),    icon: Eye },
    { label: t('hero.avgViewers'),    val: heroStream.avgViewers.toLocaleString(),     icon: Users },
    { label: t('hero.uniqueChatters'),val: heroStream.uniqueChatters.toLocaleString(), icon: Users },
    { label: t('hero.messages'),      val: heroStream.chatMessages.toLocaleString(),   icon: MessageSquare },
    { label: t('hero.duration'),      val: formatDuration(heroStream.durationMinutes, locale), icon: Clock },
  ];

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-8 shadow-lg shadow-black/30">
      <div className="flex items-start justify-between flex-wrap gap-6">
        <div className="min-w-0">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">{t('hero.lastStream')}</p>
          <h2 className="text-2xl font-black text-g-text truncate max-w-xl">{heroStream.title || heroStream.game}</h2>
          <p className="text-sm text-g-muted mt-1">{heroStream.game} · {t('hero.endedAgo', { ago: tidSiden(heroStream.endedAt) })}</p>
          {isEstimate && (
            <p className="flex items-center gap-1.5 text-xs text-yellow-400 mt-2">
              <AlertTriangle size={13} /> {heroStream.historyMissingReason ?? t('hero.estimate')}
            </p>
          )}
        </div>

        {heroStream.dataIntegrity?.status === 'broken' && heroStream.streamScore === 0 ? (
          <div className="flex flex-col items-center justify-center w-32 h-32 rounded-full ring-4 ring-red-500/20 flex-shrink-0 bg-red-950/10">
            <AlertTriangle size={22} className="text-red-400/50" />
            <p className="text-[10px] text-red-400/60 font-bold mt-1.5 text-center leading-tight">
              {t('hero.brokenBadge').split('\n').map((line, i) => (
                <span key={i}>{line}{i === 0 ? <br /> : null}</span>
              ))}
            </p>
          </div>
        ) : (
          <div className={`flex flex-col items-center justify-center w-32 h-32 rounded-full ring-4 ${grade.ring} shadow-xl ${grade.glow} flex-shrink-0`}>
            <p className={`text-5xl font-black leading-none ${grade.text}`}>{heroStream.streamScore}</p>
            <p className={`text-xs font-bold mt-1 ${grade.text}`}>Grade {heroStream.grade}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-8">
        {stats.map(({ label, val, icon: Icon }) => (
          <div key={label} className="border border-g-border/40 rounded-xl py-3 px-3">
            <Icon size={14} className="text-g-muted mb-2" />
            <p className="text-lg font-black text-g-text">{val}</p>
            <p className="text-[11px] text-g-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-6">
        <Link href={`/stream-coach?streamId=${encodeURIComponent(heroStream.streamId)}`}
          className="flex items-center gap-1.5 px-4 py-2 bg-g-green/10 border border-g-green/30 rounded-lg text-xs font-bold text-g-green hover:bg-g-green/20 transition-colors">
          {t('hero.openStreamCoach')} <ArrowRight size={13} />
        </Link>
        <Link href="/content-factory-admin"
          className="px-4 py-2 border border-g-border rounded-lg text-xs font-bold text-g-muted hover:text-g-text hover:border-g-border transition-colors">
          {t('hero.openContentFactory')}
        </Link>
      </div>

      <DataIntegrityCard integrity={heroStream.dataIntegrity} />
    </div>
  );
}

function DataIntegrityCard({ integrity }: { integrity: HeroStream['dataIntegrity'] | undefined }) {
  const { t, locale } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  if (!integrity || integrity.status === 'full') return null;

  const { status, botStatus, missingDataReasons, repairedSources = [] } = integrity;
  const isManualRepair = botStatus === 'manual_repair';
  const isBreaking     = status === 'broken';

  const iconColor = isManualRepair ? 'text-blue-400' : isBreaking ? 'text-red-400' : 'text-yellow-400';
  const badge     = isManualRepair ? t('hero.integrity.partialRepaired') : t('hero.integrity.partialData');

  const botDesc = botStatus === 'crashed'   ? t('hero.integrity.botCrashed')
                : botStatus === 'offline'   ? t('hero.integrity.botOffline')
                : botStatus === 'auth_failed'? t('hero.integrity.botAuthFailed')
                : t('hero.integrity.botUnavailable');

  const summary = isManualRepair
    ? t('hero.integrity.repaired')
    : isBreaking
    ? `${locale === 'en' ? 'Bot ' : 'Boten '}${botDesc}${locale === 'en' ? ' during stream. ' : ' under streamen. '}${t('hero.integrity.incomplete')}`
    : t('hero.integrity.someMissing');

  return (
    <div className="mt-5 pt-4 border-t border-g-border/30">
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-bold ${iconColor}`}>{badge}</span>
        <span className="text-[11px] text-g-muted/60">— {summary}</span>
        <button
          onClick={() => setShowDetails(v => !v)}
          className="ml-auto text-[10px] text-g-muted/40 hover:text-g-muted transition-colors underline underline-offset-2 flex-shrink-0"
        >
          {showDetails ? t('storage.hideDetails') : t('storage.showDetails')}
        </button>
      </div>

      {showDetails && (
        <div className={`mt-3 rounded-xl border p-4 space-y-3 ${
          isManualRepair ? 'border-blue-500/30 bg-blue-950/10'
          : isBreaking   ? 'border-red-500/30 bg-red-950/10'
          :                'border-yellow-500/30 bg-yellow-950/10'
        }`}>
          {repairedSources.length > 0 && (
            <div className="space-y-1.5">
              {repairedSources.map((r, i) => (
                <div key={i} className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-2.5 text-[11px]">
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={11} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-blue-300 font-medium">✓ {r.source}</span>
                      {r.note && <p className="text-blue-300/60 mt-0.5 font-mono">{r.note}</p>}
                      <p className="text-g-muted/40 mt-0.5">{t('hero.integrity.repairedAt')} {new Date(r.repairedAt).toLocaleString(locale === 'en' ? 'en-GB' : 'no')}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {missingDataReasons.length > 0 && (
            <div className="space-y-2">
              {repairedSources.length > 0 && (
                <p className="text-[10px] text-g-muted/40 uppercase tracking-wider font-bold">{t('hero.integrity.missingStill')}</p>
              )}
              {missingDataReasons.map((r, i) => (
                <div key={i} className="bg-black/20 rounded-lg p-2.5 text-[11px]">
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={11} className="text-g-muted/60 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-g-text/80 font-medium">{r.source}</span>
                      <span className="text-g-muted/60"> — {t('hero.integrity.expected')}: </span>
                      <span className="text-yellow-300/80 font-mono">{r.expected}</span>
                      <p className="text-g-muted/60 mt-0.5">{r.reason}</p>
                      {r.lastSeen && (
                        <p className="text-g-muted/40 mt-0.5">{t('hero.integrity.lastSeen')}: {new Date(r.lastSeen).toLocaleString(locale === 'en' ? 'en-GB' : 'no')}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
