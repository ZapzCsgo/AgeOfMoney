'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, AlertTriangle, Play } from 'lucide-react';
import { ScraperLog } from '@/types';
import { getScraperLogs, triggerScraper } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function ScraperStatus() {
  const [logs, setLogs] = useState<ScraperLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await getScraperLogs({ limit: 20 });
      setLogs(res.data);
      setError(null);
    } catch (err) {
      setError('Impossible de charger les logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const handleTrigger = async (source: 'tournaments' | 'aoe4world' | 'enrich') => {
    setTriggering(source);
    try {
      await triggerScraper(source);
      setTimeout(fetchLogs, 2000);
    } catch (err) {
      setError(`Erreur lors du déclenchement: ${err instanceof Error ? err.message : 'Inconnue'}`);
    } finally {
      setTriggering(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle size={15} className="text-emerald-400 flex-shrink-0" />;
      case 'error': return <AlertCircle size={15} className="text-red-400 flex-shrink-0" />;
      case 'partial': return <AlertTriangle size={15} className="text-amber-400 flex-shrink-0" />;
      default: return null;
    }
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'success': return 'text-emerald-400';
      case 'error': return 'text-red-400';
      case 'partial': return 'text-amber-400';
      default: return 'text-aoe-parchment-muted';
    }
  };

  // Get last run for each source
  const lastTournaments = logs.find((l) => l.source === 'tournaments');
  const lastAoe4world = logs.find((l) => l.source === 'aoe4world');
  const lastEnrich = logs.find((l) => l.source === 'enrich');

  return (
    <div className="space-y-4">
      {/* Scraper control cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { id: 'tournaments' as const, name: 'Tournois aoe4world', last: lastTournaments, desc: 'Matchs à venir depuis aoe4world API' },
          { id: 'enrich' as const, name: 'Enrichir cotes', last: lastEnrich, desc: 'Recalculer H2H + cotes' },
          { id: 'aoe4world' as const, name: 'Stats joueurs', last: lastAoe4world, desc: 'MAJ ELO et winrate' },
        ].map((scraper) => (
          <div key={scraper.id} className="aoe-card p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-cinzel font-bold text-sm text-aoe-parchment">{scraper.name}</h4>
                <p className="text-aoe-parchment-muted text-xs mt-0.5">{scraper.desc}</p>
              </div>
              <button
                onClick={() => handleTrigger(scraper.id)}
                disabled={triggering === scraper.id}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-cinzel border transition-all',
                  'border-aoe-gold text-aoe-gold bg-aoe-gold/10 hover:bg-aoe-gold/20',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {triggering === scraper.id ? (
                  <span className="w-3 h-3 border border-aoe-gold border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                Lancer
              </button>
            </div>

            {scraper.last ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  {getStatusIcon(scraper.last.status)}
                  <span className={cn('text-xs font-cinzel font-semibold', getStatusStyle(scraper.last.status))}>
                    {scraper.last.status === 'success' ? 'Succès' :
                     scraper.last.status === 'error' ? 'Erreur' : 'Partiel'}
                  </span>
                  <span className="text-aoe-parchment-muted text-xs">
                    {formatRelativeTime(scraper.last.createdAt)}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-aoe-parchment-muted">
                  <span>{scraper.last.matchesFound} matchs trouvés</span>
                  {scraper.last.duration && (
                    <span>{(scraper.last.duration / 1000).toFixed(1)}s</span>
                  )}
                </div>
                {scraper.last.error && (
                  <p className="text-red-400 text-xs bg-red-900/20 border border-red-800/30 rounded px-2 py-1">
                    {scraper.last.error}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-aoe-parchment-muted text-xs">Aucune exécution enregistrée</p>
            )}
          </div>
        ))}
      </div>

      {/* Logs table */}
      <div className="aoe-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-aoe-border">
          <h3 className="font-cinzel font-bold text-sm text-aoe-gold">JOURNAUX DES SCRAPERS</h3>
          <button
            onClick={fetchLogs}
            className="text-aoe-parchment-muted hover:text-aoe-parchment transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="p-3 m-3 bg-red-900/20 border border-red-800/50 rounded text-red-400 text-xs">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 flex justify-center">
            <div className="w-6 h-6 border-2 border-aoe-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-aoe-parchment-muted font-cinzel text-sm">
            Aucun log disponible
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-aoe-border">
                  {['Source', 'Statut', 'Matchs', 'Durée', 'Date', 'Erreur'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-aoe-parchment-muted font-cinzel uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr
                    key={log.id}
                    className={cn(
                      'border-b border-aoe-border/50 hover:bg-aoe-stone/30 transition-colors',
                      i % 2 === 0 ? 'bg-aoe-stone/10' : ''
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-cinzel font-semibold text-aoe-parchment capitalize">{log.source}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(log.status)}
                        <span className={cn('font-cinzel', getStatusStyle(log.status))}>
                          {log.status === 'success' ? 'OK' : log.status === 'error' ? 'Erreur' : 'Partiel'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-aoe-parchment-dim">
                      {log.matchesFound}
                    </td>
                    <td className="px-4 py-2.5 text-aoe-parchment-dim">
                      {log.duration ? `${(log.duration / 1000).toFixed(1)}s` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-aoe-parchment-muted whitespace-nowrap">
                      {formatRelativeTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      {log.error ? (
                        <span className="text-red-400 truncate max-w-[200px] block" title={log.error}>
                          {log.error.substring(0, 50)}{log.error.length > 50 ? '...' : ''}
                        </span>
                      ) : (
                        <span className="text-aoe-parchment-muted"></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
