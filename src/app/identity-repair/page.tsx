'use client';

import { useEffect, useState } from 'react';

// ─── Types from /api/auth/fix-workspace GET ───────────────────────────────────

interface WorkspaceCandidate {
  id:                  string;
  brand_name:          string | null;
  twitch_display_name: string | null;
  twitch_login:        string | null;
  owner_user_id:       string | null;
}

interface DiagnosisData {
  authUser: {
    id:                 string;
    email:              string | null;
    currentWorkspaceId: string | null;
  };
  currentWorkspace: WorkspaceCandidate | null;
  isOwnerMatch:     boolean;
  ownedWorkspaces:  WorkspaceCandidate[];
  note:             string;
}

// ─── Step display ─────────────────────────────────────────────────────────────

function Step({
  num,
  label,
  value,
  ok,
  warn,
}: {
  num:    number;
  label:  string;
  value:  string | null;
  ok?:    boolean;
  warn?:  boolean;
}) {
  const color = ok === false || warn ? 'text-red-400' : ok === true ? 'text-g-green' : 'text-g-text';
  return (
    <div className="flex items-start gap-4 py-3 border-b border-g-border/30 last:border-0">
      <span className="w-6 h-6 rounded-full bg-g-green/10 border border-g-green/20 text-g-green text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {num}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-g-muted">{label}</p>
        <p className={`text-sm font-mono mt-0.5 break-all ${color}`}>
          {value ?? <span className="text-g-muted/40 italic">ikke satt</span>}
        </p>
      </div>
      {ok !== undefined && (
        <span className={`text-xs font-bold px-2 py-0.5 rounded border flex-shrink-0 mt-0.5 ${
          ok ? 'text-g-green border-g-green/20 bg-g-green/5' : 'text-red-400 border-red-500/20 bg-red-500/5'
        }`}>
          {ok ? '✓ OK' : '✗ FEIL'}
        </span>
      )}
      {warn && ok === undefined && (
        <span className="text-xs font-bold px-2 py-0.5 rounded border text-yellow-400 border-yellow-500/20 bg-yellow-500/5 flex-shrink-0 mt-0.5">
          ⚠ Mismatch
        </span>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function IdentityRepairPage() {
  const [diag, setDiag]     = useState<DiagnosisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const [repairing, setRepairing]   = useState(false);
  const [repairResult, setRepairResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/fix-workspace')
      .then(r => r.json())
      .then((d: DiagnosisData) => { setDiag(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  async function repair(newWorkspaceId: string) {
    setRepairing(true);
    setRepairResult(null);
    try {
      const res = await fetch('/api/auth/fix-workspace', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ newWorkspaceId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRepairResult({ ok: true, message: data.message ?? 'Fikset! Last inn siden på nytt.' });
        // Re-fetch diagnosis after repair
        setTimeout(() => {
          fetch('/api/auth/fix-workspace').then(r => r.json()).then(setDiag).catch(() => {});
        }, 1000);
      } else {
        setRepairResult({ ok: false, message: data.error ?? 'Repair feilet' });
      }
    } catch (e: unknown) {
      setRepairResult({ ok: false, message: String(e) });
    }
    setRepairing(false);
  }

  // ─── Derived state ───────────────────────────────────────────────────────────

  const jwtWsId      = diag?.authUser.currentWorkspaceId ?? null;
  const dbWs         = diag?.currentWorkspace ?? null;
  const isOwnerMatch = diag?.isOwnerMatch ?? false;
  const owned        = diag?.ownedWorkspaces ?? [];

  // The display name that the Topbar would show (mirroring Topbar.tsx logic)
  const topbarName = dbWs?.brand_name ?? dbWs?.twitch_display_name ?? diag?.authUser.email?.split('@')[0] ?? '–';

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold gradient-text">Identity Diagnostics</h1>
        <p className="text-sm text-g-muted mt-1">
          Sporer hele auth-kjeden: JWT → workspace_id → DB-oppslag → topbar
        </p>
      </div>

      {loading && (
        <div className="glass-card rounded-2xl p-8 text-center">
          <p className="text-sm text-g-muted animate-pulse">Henter diagnostikk...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-6">
          <p className="text-sm text-red-400">Feil: {error}</p>
        </div>
      )}

      {diag && (
        <>
          {/* Auth chain */}
          <div className="glass-card rounded-2xl p-6 shadow-green-sm">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
              Auth-kjede (steg for steg)
            </h2>

            <Step
              num={1}
              label="Supabase Auth User ID"
              value={diag.authUser.id}
              ok={!!diag.authUser.id}
            />
            <Step
              num={2}
              label="Email"
              value={diag.authUser.email}
              ok={!!diag.authUser.email}
            />
            <Step
              num={3}
              label="JWT user_metadata.workspace_id"
              value={jwtWsId}
              ok={!!jwtWsId}
            />
            <Step
              num={4}
              label="DB workspace (hentet via workspace_id)"
              value={dbWs ? `${dbWs.id} — ${dbWs.brand_name ?? dbWs.twitch_display_name ?? '(ingen navn)'}` : null}
              ok={!!dbWs}
            />
            <Step
              num={5}
              label="DB workspace eier (owner_user_id)"
              value={dbWs?.owner_user_id ?? null}
              ok={isOwnerMatch}
            />
            <Step
              num={6}
              label="Navn topbar ville vist (brandName ?? twitchDisplayName)"
              value={topbarName}
              warn={!isOwnerMatch || topbarName === 'Jaco_Bini' || topbarName.toLowerCase().includes('jaco')}
            />
          </div>

          {/* Mismatch alert */}
          {!isOwnerMatch && (
            <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-5">
              <p className="text-sm font-semibold text-red-400 mb-1">
                ⚠ workspace_id i JWT peker til feil workspace
              </p>
              <p className="text-xs text-red-400/70 leading-relaxed">
                JWT sier workspace_id = <code className="font-mono bg-red-500/10 px-1 rounded">{jwtWsId ?? '—'}</code>,
                men dette workspacet tilhører <code className="font-mono bg-red-500/10 px-1 rounded">{dbWs?.owner_user_id?.slice(0,16) ?? '–'}…</code>,
                ikke din bruker-ID.
                Hele appen slår opp feil workspace-data — ikke bare topbaren.
              </p>
            </div>
          )}

          {/* Owned workspaces */}
          <div className="bg-g-card border border-g-border rounded-2xl p-6">
            <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4 pb-3 border-b border-g-border/40">
              Workspaces du eier ({owned.length})
            </h2>

            {owned.length === 0 ? (
              <p className="text-sm text-g-muted/50">
                Ingen workspaces funnet med owner_user_id = din bruker-ID.<br/>
                Mulig årsak: onboarding er ikke fullført, eller workspaces ble opprettet med en annen bruker.
              </p>
            ) : (
              <div className="space-y-3">
                {owned.map(ws => {
                  const isCurrent = ws.id === jwtWsId;
                  return (
                    <div key={ws.id} className={`p-4 rounded-xl border ${
                      isCurrent
                        ? 'border-g-green/30 bg-g-green/5'
                        : 'border-g-border bg-g-bg'
                    }`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-g-text">
                              {ws.brand_name ?? ws.twitch_display_name ?? ws.twitch_login ?? ws.id}
                            </p>
                            {isCurrent && (
                              <span className="text-[10px] font-bold text-g-green bg-g-green/10 border border-g-green/20 px-1.5 py-0.5 rounded">
                                AKTIV I JWT
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-g-muted font-mono mt-0.5">{ws.id}</p>
                          {ws.twitch_login && (
                            <p className="text-xs text-g-muted/60 mt-0.5">twitch: @{ws.twitch_login}</p>
                          )}
                        </div>
                        {!isCurrent && (
                          <button
                            onClick={() => repair(ws.id)}
                            disabled={repairing}
                            className="px-3 py-1.5 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-semibold rounded-lg hover:bg-g-green/20 transition-all flex-shrink-0 disabled:opacity-50"
                          >
                            {repairing ? 'Reparerer...' : 'Bruk dette'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Repair result */}
          {repairResult && (
            <div className={`rounded-2xl p-5 border ${
              repairResult.ok
                ? 'bg-g-green/5 border-g-green/20'
                : 'bg-red-500/5 border-red-500/30'
            }`}>
              <p className={`text-sm font-semibold ${repairResult.ok ? 'text-g-green' : 'text-red-400'}`}>
                {repairResult.ok ? '✓' : '✗'} {repairResult.message}
              </p>
              {repairResult.ok && (
                <button
                  onClick={() => window.location.reload()}
                  className="mt-3 px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-semibold rounded-lg hover:bg-g-green/20 transition-all"
                >
                  Last inn siden på nytt →
                </button>
              )}
            </div>
          )}

          {/* Manual repair form */}
          <details className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer text-xs font-semibold tracking-widest uppercase text-g-muted hover:text-g-text transition-colors">
              Manuell repair (vet du workspace-ID?)
            </summary>
            <ManualRepairForm onRepair={repair} repairing={repairing} />
          </details>

          {/* Raw data */}
          <details className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
            <summary className="px-6 py-4 cursor-pointer text-xs font-semibold tracking-widest uppercase text-g-muted hover:text-g-text transition-colors">
              Rådata (JSON)
            </summary>
            <pre className="px-6 pb-6 text-[11px] text-g-muted font-mono leading-relaxed overflow-x-auto">
              {JSON.stringify(diag, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

function ManualRepairForm({
  onRepair,
  repairing,
}: {
  onRepair:  (id: string) => void;
  repairing: boolean;
}) {
  const [wsId, setWsId] = useState('');
  return (
    <div className="px-6 pb-6 space-y-3">
      <p className="text-xs text-g-muted">
        Skriv inn workspace-ID du vil bytte til. Sikkerhetssjekk: workspace må eies av deg eller ikke ha eier.
      </p>
      <div className="flex gap-3">
        <input
          type="text"
          value={wsId}
          onChange={e => setWsId(e.target.value)}
          placeholder="workspace_id (f.eks. glenvex)"
          className="flex-1 bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 font-mono"
        />
        <button
          onClick={() => wsId.trim() && onRepair(wsId.trim())}
          disabled={repairing || !wsId.trim()}
          className="px-4 py-2.5 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-semibold rounded-lg hover:bg-g-green/20 transition-all disabled:opacity-40"
        >
          Repair
        </button>
      </div>
    </div>
  );
}
