'use client';

/**
 * GLENVEX shared UI primitives.
 * Single source of truth for cards, badges, skeletons, empty states, and page headers.
 * All design tokens come from tailwind.config.js (g-card, g-border, g-green, etc.)
 */

import React from 'react';

// ── Card ─────────────────────────────────────────────────────────────────────
// Standard card: bg-g-card border border-g-border rounded-2xl
// All main-content cards use this. Nested cards use CardInner.

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const CARD_PADDING = {
  none: '',
  sm:   'p-4',
  md:   'p-5',
  lg:   'p-6',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={`bg-g-card border border-g-border rounded-2xl ${CARD_PADDING[padding]} ${className}`}>
      {children}
    </div>
  );
}

// Nested card (inside a main Card)
export function CardInner({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-g-sidebar border border-g-border/50 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────
// Standardized section label / card header

export function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[10px] text-g-muted uppercase tracking-widest font-bold ${className}`}>
      {children}
    </p>
  );
}

// ── PageHeader ───────────────────────────────────────────────────────────────
// Consistent page title + optional subtitle

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode; // right-side actions
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">{title}</h1>
        {subtitle && <p className="text-xs text-g-muted mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-shrink-0">{children}</div>}
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────
// Status and type badges with consistent sizing

type BadgeVariant = 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'gray' | 'outline';
type BadgeSize    = 'sm' | 'md';

const BADGE_VARIANT: Record<BadgeVariant, string> = {
  green:   'text-g-green  border-g-green/30  bg-g-green/10',
  yellow:  'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  red:     'text-red-400  border-red-400/30  bg-red-400/10',
  blue:    'text-blue-400 border-blue-400/30 bg-blue-400/10',
  purple:  'text-purple-400 border-purple-400/30 bg-purple-400/10',
  gray:    'text-g-muted/70 border-g-border/40',
  outline: 'text-g-muted  border-g-border',
};

const BADGE_SIZE: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[9px]',
  md: 'px-2   py-0.5 text-[10px]',
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

// ── StatusDot ────────────────────────────────────────────────────────────────
// Colored dot for status indicators

type DotColor = 'green' | 'yellow' | 'red' | 'gray';

const DOT_COLOR: Record<DotColor, string> = {
  green:  'bg-g-green',
  yellow: 'bg-yellow-400',
  red:    'bg-red-400',
  gray:   'bg-g-muted/30',
};

export function StatusDot({ color, pulse = false }: { color: DotColor; pulse?: boolean }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_COLOR[color]} ${pulse ? 'animate-pulse' : ''}`} />
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
// Consistent skeleton loading placeholders

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

// ── EmptyState ───────────────────────────────────────────────────────────────
// Consistent empty state with icon, message, and optional action

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string; // unicode symbol or emoji
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-10 text-center ${className}`}>
      {icon && <p className="text-2xl mb-3 opacity-40">{icon}</p>}
      <p className="text-sm font-semibold text-g-muted">{title}</p>
      {description && <p className="text-xs text-g-muted/60 mt-1 max-w-xs leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── ErrorState ───────────────────────────────────────────────────────────────

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Kunne ikke hente data.', onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <p className="text-sm text-red-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-4 py-1.5 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-text hover:border-g-border/80 transition-all"
        >
          Prøv igjen
        </button>
      )}
    </div>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize    = 'sm' | 'md';

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-g-green/10 border-g-green/30 text-g-green hover:bg-g-green/20',
  secondary: 'bg-transparent border-g-border text-g-muted hover:text-g-text hover:border-g-border/80',
  ghost:     'bg-transparent border-transparent text-g-muted hover:text-g-text',
  danger:    'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20',
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1    text-[10px]',
  md: 'px-4 py-1.5  text-xs',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, className = '', children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-1.5 border rounded-lg font-bold transition-all ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {loading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />}
      {children}
    </button>
  );
}

// ── CollapseSection ───────────────────────────────────────────────────────────
// Consistent collapsible section pattern

interface CollapseSectionProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}

export function CollapseSection({ label, children, defaultOpen = false, badge }: CollapseSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border border-g-border/40 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 bg-g-bg/30 hover:bg-g-bg/50 transition-all text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-g-muted uppercase tracking-widest font-bold">{label}</span>
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
