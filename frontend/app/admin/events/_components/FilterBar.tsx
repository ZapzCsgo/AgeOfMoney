'use client';

import { RefreshCw, Zap, Droplets } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RuleType, RULE_LABELS } from './types';

export function FilterBar({
  status, onStatus,
  priority, onPriority,
  ruleType, onRuleType,
  onRefresh,
  onScanNow,
  onLaunchManualRain,
  rainActive,
  refreshing,
  scanning,
  lastUpdatedAt,
}: {
  status: 'all' | 'NEW' | 'SEEN';
  onStatus: (v: 'all' | 'NEW' | 'SEEN') => void;
  priority: 'all' | 'LOW' | 'MEDIUM' | 'HIGH';
  onPriority: (v: 'all' | 'LOW' | 'MEDIUM' | 'HIGH') => void;
  ruleType: 'all' | RuleType;
  onRuleType: (v: 'all' | RuleType) => void;
  onRefresh: () => void;
  onScanNow: () => void;
  onLaunchManualRain: () => void;
  rainActive: boolean;
  refreshing: boolean;
  scanning: boolean;
  lastUpdatedAt: number | null;
}) {
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ago = lastUpdatedAt
    ? (() => {
        const diff = now - lastUpdatedAt;
        if (diff < 10_000) return "à l'instant";
        if (diff < 60_000) return `il y a ${Math.round(diff / 1000)}s`;
        if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
        return `il y a ${Math.round(diff / 3_600_000)} h`;
      })()
    : '—';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={status}
        onChange={(e) => onStatus(e.target.value as typeof status)}
        className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-colors"
        style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
      >
        <option value="all">Tous statuts</option>
        <option value="NEW">Nouveaux</option>
        <option value="SEEN">Vus</option>
      </select>

      <select
        value={priority}
        onChange={(e) => onPriority(e.target.value as typeof priority)}
        className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-colors"
        style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
      >
        <option value="all">Toutes priorités</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </select>

      <select
        value={ruleType}
        onChange={(e) => onRuleType(e.target.value as typeof ruleType)}
        className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-colors"
        style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
      >
        <option value="all">Tous types</option>
        {(Object.keys(RULE_LABELS) as RuleType[]).map((t) => (
          <option key={t} value={t}>{RULE_LABELS[t]}</option>
        ))}
      </select>

      <div className="flex items-center gap-2 ml-auto flex-wrap">
        <button
          onClick={onLaunchManualRain}
          disabled={rainActive}
          title={rainActive ? 'Already 1 rain active' : 'Lancer un rain manuel (test ou action non motivée par une card)'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'transparent', border: '1px solid rgba(255,197,66,0.45)', color: '#ffd97a' }}
          aria-label="lancer un rain manuel"
        >
          <Droplets size={12} />
          Launch Manual Rain
        </button>

        <button
          onClick={onScanNow}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: 'rgba(255,197,66,0.12)', border: '1px solid rgba(255,197,66,0.35)', color: '#ffd97a' }}
          aria-label="lancer un scan"
        >
          <Zap size={12} />
          {scanning ? 'Scan…' : 'Scan now'}
        </button>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}
          aria-label="refresh"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>

        <span className="text-[10px]" style={{ color: '#6b6488' }}>
          Données · {ago}
        </span>
      </div>
    </div>
  );
}
