'use client';

import React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// GLENVEX Shared UI Primitives
// Single source of truth — import from here, never reinvent locally.
// Design tokens: see tailwind.config.js (g-green, g-card, g-border, g-muted, …)
// ─────────────────────────────────────────────────────────────────────────────


// ── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  variant?: 'default' | 'glass' | 'highlight';
}

const CARD_PAD = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' };

const CARD_VARIANT: Record<string, string> = {
  default:   'bg-g-card border border-g-border rounded-2xl',
  glass:     'glass-card rounded-2xl',
  highlight: 'bg-g-card border border-g-green/20 rounded-2xl shadow-[0_0_16px_rgba(0,255,65,0.06)]',
};

export function Card({ children, className = '', padding = 'md', hover = false, variant = 'default' }: CardProps) {
  return (
    <div className={`${CARD_VARIANT[variant]} ${CARD_PAD[padding]} ${hover ? 'card-hover' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function CardInner({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-g-sidebar border border-g-border/50 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}


// ── SectionLabel ──────────────────────────────────────────────────────────────

export function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-semibold tracking-widest uppercase text-g-muted border-b border-g-border/30 pb-2 mb-4 ${className}`}>
      {children}
    </p>
  );
}


// ── PageHeader ────────────────────────────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight gradient-text">{title}</h1>
        {subtitle && <p className="text-sm text-g-muted mt-1.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-shrink-0">{children}</div>}
    </div>
  );
}


// ── BrandLogo ─────────────────────────────────────────────────────────────────
// Used on login, onboarding, waiting — pages outside the main sidebar layout.

export function BrandLogo({ subtitle = 'Creator OS', size = 'md' }: { subtitle?: string; size?: 'sm' | 'md' | 'lg' }) {
  const textSize = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg';
  const subSize  = size === 'lg' ? 'text-xs' : 'text-[11px]';
  return (
    <div>
      <div
        className={`text-g-green font-black ${textSize} tracking-[0.15em] uppercase`}
        style={{ textShadow: '0 0 20px rgba(0,255,65,0.4), 0 0 40px rgba(0,255,65,0.15)' }}
      >
        GLENVEX
      </div>
      {subtitle && (
        <div className={`${subSize} text-g-muted tracking-[0.3em] uppercase mt-0.5`}>{subtitle}</div>
      )}
    </div>
  );
}


// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeVariant = 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'gray' | 'outline';
type BadgeSize    = 'xs' | 'sm' | 'md';

const BADGE_VARIANT: Record<BadgeVariant, string> = {
  green:   'text-g-green   border-g-green/30   bg-g-green/10',
  yellow:  'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  red:     'text-red-400   border-red-400/30   bg-red-400/10',
  blue:    'text-blue-400  border-blue-400/30  bg-blue-400/10',
  purple:  'text-purple-400 border-purple-400/30 bg-purple-400/10',
  gray:    'text-g-muted/70 border-g-border/40  bg-transparent',
  outline: 'text-g-muted   border-g-border     bg-transparent',
};

const BADGE_SIZE: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-0.5 text-[11px]',
  sm: 'px-1.5 py-0.5 text-[11px]',
  md: 'px-2   py-1   text-xs',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

export function Badge({ children, variant = 'outline', size = 'sm', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center border rounded font-bold ${BADGE_VARIANT[variant]} ${BADGE_SIZE[size]} ${className}`}>
      {children}
    </span>
  );
}


// ── StatusDot ─────────────────────────────────────────────────────────────────

type DotColor = 'green' | 'yellow' | 'red' | 'gray' | 'blue';

const DOT_COLOR: Record<DotColor, string> = {
  green: 'bg-g-green',
  yellow: 'bg-yellow-400',
  red:   'bg-red-400',
  gray:  'bg-g-muted/30',
  blue:  'bg-blue-400',
};

export function StatusDot({ color, pulse = false, size = 'sm' }: { color: DotColor; pulse?: boolean; size?: 'xs' | 'sm' | 'md' }) {
  const sz = size === 'xs' ? 'w-1 h-1' : size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';
  return (
    <span className={`inline-block rounded-full flex-shrink-0 ${sz} ${DOT_COLOR[color]} ${pulse ? 'pulse-live' : ''}`} />
  );
}


// ── MetricCard ────────────────────────────────────────────────────────────────
// Standardized stat/KPI card. Replaces: SummaryCard, MetricKort, StatCard, etc.

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: 'green' | 'yellow' | 'red' | 'default';
  className?: string;
  trend?: string;
  trendUp?: boolean;
  suffix?: string;
}

const METRIC_ACCENT: Record<string, string> = {
  green:   'text-g-green',
  yellow:  'text-yellow-400',
  red:     'text-red-400',
  default: 'text-g-text',
};

export function MetricCard({ label, value, sub, accent = 'default', className = '', trend, trendUp, suffix }: MetricCardProps) {
  return (
    <div className={`bg-g-card border border-g-border rounded-xl p-4 space-y-1 ${className}`}>
      <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted">{label}</p>
      <p className={`text-2xl font-mono font-bold ${METRIC_ACCENT[accent]}`}>
        {value}{suffix && <span className="text-base text-g-muted ml-1">{suffix}</span>}
      </p>
      {sub && <p className="text-[11px] text-g-muted/60 mt-1">{sub}</p>}
      {trend && (
        <p className={`text-xs font-medium ${trendUp ? 'text-g-green' : 'text-red-400'}`}>
          {trend}
        </p>
      )}
    </div>
  );
}


// ── ProgressBar ───────────────────────────────────────────────────────────────
// Replaces: XPBar, ScoreBar, konfidensBar, progress fill with inline styles.

interface ProgressBarProps {
  value: number;       // 0-100
  max?: number;        // default 100
  color?: 'green' | 'yellow' | 'red' | 'blue';
  size?: 'xs' | 'sm' | 'md';
  showGlow?: boolean;
  label?: string;
  className?: string;
}

const PROG_COLOR: Record<string, string> = {
  green:  'bg-g-green',
  yellow: 'bg-yellow-400',
  red:    'bg-red-400',
  blue:   'bg-blue-400',
};

const PROG_GLOW: Record<string, string> = {
  green:  'shadow-green-sm',
  yellow: '',
  red:    '',
  blue:   '',
};

const PROG_SIZE: Record<string, string> = {
  xs: 'h-0.5',
  sm: 'h-1',
  md: 'h-1.5',
};

export function ProgressBar({ value, max = 100, color = 'green', size = 'sm', showGlow = false, label, className = '' }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={className}>
      {label && <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-g-muted">{label}</span>
        <span className="text-[11px] text-g-muted font-mono">{Math.round(pct)}%</span>
      </div>}
      <div className={`w-full bg-g-border/40 rounded-full overflow-hidden ${PROG_SIZE[size]}`}>
        <div
          className={`${PROG_SIZE[size]} rounded-full transition-all duration-500 ${PROG_COLOR[color]} ${showGlow ? PROG_GLOW[color] : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


// ── TabBar ────────────────────────────────────────────────────────────────────
// Standardized tab navigation. Replaces 7+ inline tab implementations.

interface Tab {
  id: string;
  label: string;
  badge?: string | number;
}

interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function TabBar({ tabs, active, onChange, className = '', size = 'md' }: TabBarProps) {
  const btnBase = size === 'sm'
    ? 'px-3 py-1.5 text-[11px]'
    : 'px-4 py-2 text-xs';
  return (
    <div className={`flex items-center gap-1 border-b border-g-border/50 ${className}`}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`${btnBase} font-bold transition-all flex items-center gap-1.5 border-b-2 -mb-px ${
            active === tab.id
              ? 'text-g-green border-g-green'
              : 'text-g-muted border-transparent hover:text-g-text'
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && (
            <span className={`text-[11px] px-1 rounded font-bold border ${
              active === tab.id ? 'text-g-green border-g-green/30 bg-g-green/10' : 'text-g-muted border-g-border'
            }`}>{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}


// ── Toggle ────────────────────────────────────────────────────────────────────
// Standard on/off switch. Replaces 5+ local Toggle implementations.

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Toggle({ value, onChange, disabled = false, size = 'md' }: ToggleProps) {
  const track = size === 'sm' ? 'w-7 h-4' : 'w-9 h-5';
  const thumb = size === 'sm' ? 'w-2.5 h-2.5 translate-x-0.5' : 'w-3.5 h-3.5 translate-x-0.5';
  const active = size === 'sm' ? 'translate-x-3' : 'translate-x-4';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => !disabled && onChange(!value)}
      className={`relative inline-flex flex-shrink-0 ${track} rounded-full border transition-colors duration-200 focus-visible:outline-none ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${value ? 'bg-g-green/20 border-g-green/50' : 'bg-g-bg border-g-border'}`}
    >
      <span
        className={`pointer-events-none inline-block ${thumb} rounded-full shadow-sm transform transition-transform duration-200 mt-px ${
          value ? `${active} bg-g-green` : 'bg-g-muted'
        }`}
      />
    </button>
  );
}


// ── SettingsRow ───────────────────────────────────────────────────────────────
// Label + optional hint on the left, control on the right.

interface SettingsRowProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsRow({ label, hint, children, className = '' }: SettingsRowProps) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 border-b border-g-border/30 last:border-b-0 ${className}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-g-text">{label}</p>
        {hint && <p className="text-[11px] text-g-muted mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}


// ── FilterBar ─────────────────────────────────────────────────────────────────
// Chip-style filter row. Replaces 7+ inline filter implementations.

interface FilterBarProps {
  filters: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function FilterBar({ filters, active, onChange, className = '' }: FilterBarProps) {
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {filters.map(f => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          className={`px-3 py-1 rounded-lg text-[11px] font-bold border transition-all ${
            active === f.id
              ? 'bg-g-green/10 text-g-green border-g-green/30'
              : 'bg-transparent text-g-muted border-g-border hover:text-g-text hover:border-g-border/80'
          }`}
        >
          {f.label}
          {f.count !== undefined && (
            <span className="ml-1.5 opacity-60">{f.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}


// ── ConfirmDialog ─────────────────────────────────────────────────────────────
// Replaces browser confirm() calls. Renders as a centered modal overlay.
// Usage:
//   const [confirm, setConfirm] = useState<ConfirmState | null>(null);
//   <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
//   setConfirm({ title: '…', message: '…', onConfirm: () => doThing() });

export interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => void;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmDialogProps {
  state: ConfirmState | null;
  onClose: () => void;
}

export function ConfirmDialog({ state, onClose }: ConfirmDialogProps) {
  if (!state) return null;
  const handleConfirm = () => { state.onConfirm(); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-g-card border border-g-border rounded-2xl p-6 max-w-sm w-full shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-black text-g-text mb-2">{state.title}</p>
        <p className="text-xs text-g-muted leading-relaxed mb-5">{state.message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-g-border rounded-lg text-xs font-bold text-g-muted hover:text-g-text transition-all"
          >
            {state.cancelLabel ?? 'Avbryt'}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 border rounded-lg text-xs font-bold transition-all ${
              state.danger
                ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                : 'bg-g-green/10 border-g-green/30 text-g-green hover:bg-g-green/20'
            }`}
          >
            {state.confirmLabel ?? 'Bekreft'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Skeleton ──────────────────────────────────────────────────────────────────

export function Skeleton({ className = '', height = 'h-4' }: { className?: string; height?: string }) {
  return <div className={`bg-g-border/40 rounded animate-pulse ${height} ${className}`} />;
}

export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <Card className={className}>
      <div className="space-y-2.5">
        <Skeleton height="h-3" className="w-24" />
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} height="h-4" className={i === lines - 1 ? 'w-3/4' : 'w-full'} />
        ))}
      </div>
    </Card>
  );
}


// ── EmptyState ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ title, description, icon, action, compact = false, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-10'} ${className}`}>
      {icon && <p className={`${compact ? 'text-xl mb-2' : 'text-2xl mb-3'} opacity-30`}>{icon}</p>}
      <p className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-g-muted`}>{title}</p>
      {description && <p className="text-[11px] text-g-muted/60 mt-1 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}


// ── ErrorState ────────────────────────────────────────────────────────────────

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({ message = 'Kunne ikke hente data.', onRetry, compact = false }: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-4' : 'py-8'}`}>
      <p className="text-sm text-red-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-4 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-text transition-all font-bold"
        >
          Prøv igjen
        </button>
      )}
    </div>
  );
}


// ── Button ────────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta';
type ButtonSize    = 'xs' | 'sm' | 'md' | 'lg';

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-g-green/10 border-g-green/25 text-g-green hover:bg-g-green/20 hover:border-g-green/40 hover:shadow-[0_0_12px_rgba(0,255,65,0.1)]',
  secondary: 'bg-transparent border-g-border text-g-muted hover:text-g-text hover:border-g-border/80',
  ghost:     'bg-transparent border-transparent text-g-muted hover:text-g-text',
  danger:    'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/15',
  cta:       'bg-g-green border-g-green text-black hover:bg-g-green/80',
};

const BTN_SIZE: Record<ButtonSize, string> = {
  xs: 'px-2   py-1    text-[11px]',
  sm: 'px-3   py-1    text-xs',
  md: 'px-4   py-1.5  text-xs',
  lg: 'px-5   py-2    text-sm',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, className = '', children, disabled, icon, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-1.5 border rounded-lg font-medium transition-all duration-200 ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />}
      {!loading && icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
}


// ── CollapseSection ───────────────────────────────────────────────────────────

interface CollapseSectionProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  className?: string;
}

export function CollapseSection({ label, children, defaultOpen = false, badge, className = '' }: CollapseSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={`border border-g-border/40 rounded-2xl overflow-hidden ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 bg-g-bg/30 hover:bg-g-bg/50 transition-all text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-g-muted uppercase tracking-widest font-semibold">{label}</span>
          {badge}
        </div>
        <span className={`text-[11px] text-g-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="p-5 space-y-4 bg-g-bg/10">
          {children}
        </div>
      )}
    </div>
  );
}


// ── Divider ───────────────────────────────────────────────────────────────────

export function Divider({ className }: { className?: string }) {
  return <div className={`border-t border-g-border/40 ${className ?? ''}`} />;
}


// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sz = size === 'sm' ? 'w-4 h-4 border' : size === 'lg' ? 'w-10 h-10 border-2' : 'w-6 h-6 border-2';
  return (
    <span className={`${sz} border-g-green/20 border-t-g-green rounded-full animate-spin inline-block ${className}`} />
  );
}
