'use client';

import Link from 'next/link';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: EmptyStateAction[];
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, actions, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-10' : 'py-20', className)}>
      {Icon && (
        <div className="relative mb-5">
          {/* Subtle gold halo behind icon */}
          <div className="absolute inset-0 blur-2xl bg-aoe-gold/10 rounded-full scale-150" aria-hidden />
          <div className="relative w-14 h-14 rounded-full bg-aoe-stone border border-aoe-border flex items-center justify-center">
            <Icon size={22} className="text-aoe-gold/70" strokeWidth={1.75} />
          </div>
        </div>
      )}

      <p className="text-base font-semibold text-aoe-parchment tracking-tight">
        {title}
      </p>

      {description && (
        <p className="mt-1.5 text-sm text-aoe-parchment-dim max-w-sm">
          {description}
        </p>
      )}

      {actions && actions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actions.map((a, i) => {
            const base = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all';
            const style = a.variant === 'ghost'
              ? 'text-aoe-parchment-dim hover:text-aoe-parchment border border-transparent hover:border-aoe-border'
              : 'bg-aoe-gold/15 text-aoe-gold border border-aoe-gold/40 hover:bg-aoe-gold/25 hover:border-aoe-gold hover:shadow-gold-sm';
            const className = cn(base, style);
            if (a.href) {
              return <Link key={i} href={a.href} className={className}>{a.label}</Link>;
            }
            return <button key={i} type="button" onClick={a.onClick} className={className}>{a.label}</button>;
          })}
        </div>
      )}
    </div>
  );
}
