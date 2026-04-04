import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  variant?: 'default' | 'gold' | 'green' | 'red';
  trend?: 'up' | 'down' | 'neutral';
}

export function StatsCard({ label, value, subValue, icon: Icon, variant = 'default', trend }: StatsCardProps) {
  const variantColors = {
    default: {
      card: 'aoe-card',
      icon: 'text-aoe-parchment-dim',
      iconBg: 'bg-aoe-stone',
      value: 'text-aoe-parchment',
    },
    gold: {
      card: 'aoe-card-gold',
      icon: 'text-aoe-gold',
      iconBg: 'bg-aoe-gold/10',
      value: 'text-aoe-gold',
    },
    green: {
      card: 'aoe-card',
      icon: 'text-emerald-400',
      iconBg: 'bg-emerald-900/20',
      value: 'text-emerald-400',
    },
    red: {
      card: 'aoe-card',
      icon: 'text-red-400',
      iconBg: 'bg-red-900/20',
      value: 'text-red-400',
    },
  };

  const colors = variantColors[variant];

  return (
    <div className={cn(colors.card, 'p-4 flex items-center gap-4')}>
      {/* Icon */}
      <div className={cn(
        'w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0',
        colors.iconBg
      )}>
        <Icon size={20} className={colors.icon} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-aoe-parchment-muted text-xs uppercase tracking-wider font-cinzel mb-1">
          {label}
        </p>
        <div className="flex items-end gap-2">
          <span className={cn('font-cinzel font-bold text-xl leading-none', colors.value)}>
            {value}
          </span>
          {trend && (
            <span className={cn(
              'text-xs mb-0.5',
              trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-aoe-parchment-muted'
            )}>
              {trend === 'up' ? '▲' : trend === 'down' ? '▼' : ''}
            </span>
          )}
        </div>
        {subValue && (
          <p className="text-aoe-parchment-muted text-xs mt-0.5">{subValue}</p>
        )}
      </div>
    </div>
  );
}
