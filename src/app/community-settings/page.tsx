'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader, Toggle as UIToggle, SettingsRow } from '@/components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RewardRole {
  level: number;
  roleId: string;
  roleName: string;
}

interface CommunitySettings {
  aktiv: boolean;
  xpAktiv: boolean;
  levelUpMeldingerAktiv: boolean;
  communityHypeAktiv: boolean;
  idlePromptsAktiv: boolean;
  idleThresholdMinutes: number;
  maxBotPostsPerDay: number;
  rewardRoles: RewardRole[];
  xpCooldownSek: number;
  xpMinMeldingslengde: number;
}

const DEFAULTS: CommunitySettings = {
  aktiv: true,
  xpAktiv: true,
  levelUpMeldingerAktiv: true,
  communityHypeAktiv: true,
  idlePromptsAktiv: true,
  idleThresholdMinutes: 120,
  maxBotPostsPerDay: 2,
  rewardRoles: [],
  xpCooldownSek: 60,
  xpMinMeldingslengde: 4,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({
  label, description, value, onChange,
}: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <SettingsRow label={label} hint={description}>
      <UIToggle value={value} onChange={onChange} />
    </SettingsRow>
  );
}

function NumberInput({
  label, description, value, min, max, unit, onChange,
}: {
  label: string; description?: string; value: number; min?: number; max?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-g-border/30 last:border-0">
      <div>
        <p className="text-xs font-bold text-g-text">{label}</p>
        {description && <p className="text-[10px] text-g-muted mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={e => onChange(Number(e.target.value))}
          className="w-20 bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text text-right font-mono focus:outline-none focus:border-g-green/50"
        />
        {unit && <span className="text-[10px] text-g-muted">{unit}</span>}
      </div>
    </div>
  );
}

// ── Reward Roles Table ────────────────────────────────────────────────────────

function RewardRolesSection({
  roles, onChange,
}: {
  roles: RewardRole[]; onChange: (r: RewardRole[]) => void;
}) {
  const [draft, setDraft] = useState<RewardRole>({ level: 10, roleId: '', roleName: '' });
  const [adding, setAdding] = useState(false);

  const addRole = () => {
    if (!draft.roleId.trim() || draft.level < 1) return;
    onChange([...roles, { ...draft, roleId: draft.roleId.trim(), roleName: draft.roleName.trim() || `Level ${draft.level} Role` }]);
    setDraft({ level: 10, roleId: '', roleName: '' });
    setAdding(false);
  };

  const removeRole = (i: number) => {
    onChange(roles.filter((_, idx) => idx !== i));
  };

  const updateRole = (i: number, field: keyof RewardRole, value: string | number) => {
    onChange(roles.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs font-bold text-g-text">Reward Roles</p>
          <p className="text-[10px] text-g-muted mt-0.5">Tildel Discord-roller automatisk ved level-up. Tom liste = standard LEVEL_ROLLER brukes.</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="text-[10px] font-bold text-g-green border border-g-green/30 rounded px-2.5 py-1 hover:bg-g-green/10 transition-all flex-shrink-0">
            + Legg til
          </button>
        )}
      </div>

      {roles.length === 0 && !adding && (
        <div className="py-4 text-center border border-dashed border-g-border rounded-lg">
          <p className="text-[10px] text-g-muted">Ingen reward roles. Boten bruker standard LEVEL_ROLLER automatisk.</p>
        </div>
      )}

      {roles.length > 0 && (
        <div className="border border-g-border rounded-lg overflow-hidden mb-3">
          <div className="grid grid-cols-[80px_1fr_1fr_40px] gap-0 text-[9px] text-g-muted uppercase tracking-widest font-bold px-3 py-2 bg-g-bg border-b border-g-border">
            <span>Level</span>
            <span>Discord Role ID</span>
            <span>Rollenavn</span>
            <span />
          </div>
          {roles.map((r, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 px-3 py-2 border-b border-g-border/40 last:border-0 items-center">
              <input
                type="number"
                value={r.level}
                min={1}
                onChange={e => updateRole(i, 'level', Number(e.target.value))}
                className="w-full bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/50"
              />
              <input
                type="text"
                value={r.roleId}
                placeholder="123456789012345678"
                onChange={e => updateRole(i, 'roleId', e.target.value)}
                className="w-full bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/50"
              />
              <input
                type="text"
                value={r.roleName}
                placeholder="f.eks. VIP"
                onChange={e => updateRole(i, 'roleName', e.target.value)}
                className="w-full bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text focus:outline-none focus:border-g-green/50"
              />
              <button onClick={() => removeRole(i)}
                className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors text-center">✕</button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="border border-g-green/30 rounded-lg p-3 bg-g-green/5 space-y-2 mb-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Ny reward role</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] text-g-muted block mb-1">Level</label>
              <input type="number" value={draft.level} min={1}
                onChange={e => setDraft(d => ({ ...d, level: Number(e.target.value) }))}
                className="w-full bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/50" />
            </div>
            <div>
              <label className="text-[9px] text-g-muted block mb-1">Discord Role ID</label>
              <input type="text" value={draft.roleId} placeholder="ID fra Discord"
                onChange={e => setDraft(d => ({ ...d, roleId: e.target.value }))}
                className="w-full bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text font-mono focus:outline-none focus:border-g-green/50" />
            </div>
            <div>
              <label className="text-[9px] text-g-muted block mb-1">Rollenavn</label>
              <input type="text" value={draft.roleName} placeholder="Valgfritt"
                onChange={e => setDraft(d => ({ ...d, roleName: e.target.value }))}
                className="w-full bg-g-bg border border-g-border rounded px-2 py-1 text-xs text-g-text focus:outline-none focus:border-g-green/50" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={addRole}
              className="text-[10px] font-bold text-g-green border border-g-green/30 rounded px-3 py-1.5 hover:bg-g-green/10 transition-all">
              Legg til
            </button>
            <button onClick={() => setAdding(false)}
              className="text-[10px] text-g-muted border border-g-border rounded px-3 py-1.5 hover:text-g-text transition-all">
              Avbryt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CommunitySettingsPage() {
  const [settings, setSettings]     = useState<CommunitySettings>(DEFAULTS);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [status, setStatus]         = useState<'idle' | 'ok' | 'error'>('idle');
  const [statusMsg, setStatusMsg]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/community-settings')
      .then(r => r.json())
      .then(d => {
        if (d.settings) setSettings({ ...DEFAULTS, ...d.settings });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = <K extends keyof CommunitySettings>(field: K, value: CommunitySettings[K]) => {
    setSettings(s => ({ ...s, [field]: value }));
    setStatus('idle');
  };

  const save = async () => {
    setSaving(true);
    setStatus('idle');
    try {
      const res  = await fetch('/api/community-settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('ok');
        setStatusMsg('Innstillinger lagret');
        if (data.settings) setSettings({ ...DEFAULTS, ...data.settings });
      } else {
        setStatus('error');
        setStatusMsg(data.error ?? 'Lagring feilet');
      }
    } catch {
      setStatus('error');
      setStatusMsg('Nettverksfeil');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 animate-pulse">
        {[1, 2, 3].map(i => <div key={i} className="h-40 bg-g-card border border-g-border rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <PageHeader title="Community-innstillinger" subtitle="XP-system · Automatisk aktivitet · Reward roles">
        <Link href="/community-manager"
          className="text-[9px] text-g-muted hover:text-g-green border border-g-border rounded-lg px-2 py-1 transition-colors">
          ← Dashboard
        </Link>
      </PageHeader>

      {/* Info box: channels managed elsewhere */}
      <div className="bg-g-card border border-yellow-500/20 rounded-2xl p-4 flex items-start gap-3">
        <span className="text-yellow-400 text-sm font-bold flex-shrink-0">i</span>
        <div>
          <p className="text-xs font-bold text-g-text">Kanal-innstillinger</p>
          <p className="text-[10px] text-g-muted mt-0.5">
            Community-kanal og Admin-kanal settes under{' '}
            <Link href="/innstillinger" className="text-g-green hover:underline">Innstillinger → Discord Kanaler</Link>.
            Hype og idle-prompts krever at community-kanal er satt.
          </p>
        </div>
      </div>

      {/* Section: General */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Generelt</p>
        <Toggle
          label="Community Manager aktiv"
          description="Skrur av/på hele community-systemet inkl. XP, hype og idle-prompts."
          value={settings.aktiv}
          onChange={v => update('aktiv', v)}
        />
        <Toggle
          label="XP-system aktiv"
          description="Gir XP for Discord-meldinger i community-kanalen."
          value={settings.xpAktiv}
          onChange={v => update('xpAktiv', v)}
        />
        <Toggle
          label="Level-up meldinger"
          description="Boten poster gratulasjon i community-kanal når noen levler opp."
          value={settings.levelUpMeldingerAktiv}
          onChange={v => update('levelUpMeldingerAktiv', v)}
        />
        <NumberInput
          label="XP-cooldown"
          description="Minimum sekunder mellom XP-tildeling per bruker."
          value={settings.xpCooldownSek}
          min={10}
          max={3600}
          unit="sekunder"
          onChange={v => update('xpCooldownSek', v)}
        />
        <NumberInput
          label="Minimum meldingslengde for XP"
          description="Meldinger kortere enn dette ignoreres (spam-filter)."
          value={settings.xpMinMeldingslengde}
          min={1}
          max={50}
          unit="tegn"
          onChange={v => update('xpMinMeldingslengde', v)}
        />
      </div>

      {/* Section: Automatic activity */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Automatisk aktivitet</p>
        <Toggle
          label="Community hype aktiv"
          description="Boten poster automatisk hype-meldinger (level-ups, streaks, ukens topp)."
          value={settings.communityHypeAktiv}
          onChange={v => update('communityHypeAktiv', v)}
        />
        <Toggle
          label="Idle prompts aktiv"
          description="Boten sender et spørsmål til kanalen når den har vært stille en stund."
          value={settings.idlePromptsAktiv}
          onChange={v => update('idlePromptsAktiv', v)}
        />
        <NumberInput
          label="Idle-terskel"
          description="Minutter uten bruker-aktivitet før boten sender idle-prompt."
          value={settings.idleThresholdMinutes}
          min={30}
          max={1440}
          unit="minutter"
          onChange={v => update('idleThresholdMinutes', v)}
        />
        <NumberInput
          label="Maks bot-poster per dag"
          description="Totalt antall automatiske community-poster per dag (hype + prompts deler grensen)."
          value={settings.maxBotPostsPerDay}
          min={1}
          max={10}
          unit="poster"
          onChange={v => update('maxBotPostsPerDay', v)}
        />
      </div>

      {/* Section: Reward roles */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <RewardRolesSection
          roles={settings.rewardRoles}
          onChange={r => update('rewardRoles', r)}
        />
        <p className="text-[9px] text-g-muted/60 mt-3 leading-relaxed">
          Finn Discord Role ID ved å høyreklikke på en rolle i Discord (Developer Mode må være på).
          Rollen må ligge lavere enn bot-rollen i Discord for at boten skal kunne tildele den.
        </p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 text-g-green text-xs font-bold rounded-lg transition-all disabled:opacity-50"
        >
          {saving ? 'Lagrer...' : 'Lagre innstillinger'}
        </button>
        {status === 'ok'    && <p className="text-xs text-g-green">✓ {statusMsg}</p>}
        {status === 'error' && <p className="text-xs text-red-400">✗ {statusMsg}</p>}
      </div>
    </div>
  );
}
