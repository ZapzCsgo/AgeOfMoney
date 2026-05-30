'use client';

import { RefreshCw, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RuleType, RULE_LABELS } from './types';

/**
 * Filter + action bar above the suggestions list.
 *
 * On tft.money the manual-rain button is omitted (rain feature not shipped);
 * only Scan now + Refresh remain.
 */
export function FilterBar({
  status, onStatus,
  priority, onPriority,
  ruleType, onRuleType,
  onRefresh,
  onScanNow,
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
        className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-colors bg-tft-bg-card border border-tft-border text-tft-text font-ui"
      >
        <option value="all">Tous statuts</option>
        <option value="NEW">Nouveaux</option>
        <option value="SEEN">Vus</option>
      </select>

      <select
        value={priority}
        onChange={(e) => onPriority(e.target.value as typeof priority)}
        className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-colors bg-tft-bg-card border border-tft-border text-tft-text font-ui"
      >
        <option value="all">Toutes priorités</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </select>

      <select
        value={ruleType}
        onChange={(e) => onRuleType(e.target.value as typeof ruleType)}
        className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-colors bg-tft-bg-card border border-tft-border text-tft-text font-ui"
      >
        <option value="all">Tous types</option>
        {(Object.keys(RULE_LABELS) as RuleType[]).map((t) => (
          <option key={t} value={t}>{RULE_LABELS[t]}</option>
        ))}
      </select>

      <div className="flex items-center gap-2 ml-auto flex-wrap">
        <button
          onClick={onScanNow}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-50 font-ui bg-tft-purple/15 border border-tft-purple/40 text-tft-purple-bright"
          aria-label="lancer un scan"
        >
          <Zap size={12} />
          {scanning ? 'Scan…' : 'Scan now'}
        </button>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-50 font-ui bg-tft-bg-card border border-tft-border text-tft-text-dim"
          aria-label="refresh"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>

        <span className="text-[10px] text-tft-text-muted">
          Données · {ago}
        </span>
      </div>
    </div>
  );
}
