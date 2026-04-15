'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { apiClient, setAuthToken } from '@/lib/api';

type DebugReport = {
  player: { id: string; name: string; game: string };
  totals: {
    totalRecords: number;
    withScore: number;
    withOpponentId: number;
    confidenceOk: number;
  };
  byFormat: Record<string, { raw: number; withScore: number; withOpponentId: number }>;
  bo5Analysis: {
    rawCount: number;
    effectiveSampleAfterRecencyDecay: number;
    wouldGetFullBlendWeight: boolean;
    distribution: Record<string, { raw: string; weighted: string }>;
  };
  recentRecords: Array<{
    date: string | null;
    opponent: string;
    opponentIdPresent: boolean;
    score: string | null;
    won: boolean;
    format: string | null;
    confidence: number;
    recencyWeight: number;
    source: string;
  }>;
};

export default function PlayerDebugPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DebugReport | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user.isAdmin) { router.push('/'); return; }
    if (session.user.accessToken) setAuthToken(session.user.accessToken);
  }, [session, status, router]);

  const runDebug = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await apiClient.get(`/admin/players/${encodeURIComponent(trimmed)}/records-debug`);
      setData(res.data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading' && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="w-8 h-8 border-2 border-[#d4a017] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold font-cinzel mb-2" style={{ color: '#d4a017' }}>
          Player Records Debug
        </h1>
        <p className="text-[12px] mb-6" style={{ color: '#6b6488' }}>
          Voir exactement ce que l&apos;algorithme de cotes exact score utilise pour un joueur donné.
        </p>

        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runDebug()}
            placeholder="Nom du joueur (ex: IBUYPOWER, Heartt, Kasva)"
            className="flex-1 px-4 py-2.5 rounded-lg text-[13px] outline-none"
            style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e8e2f5' }}
          />
          <button
            onClick={runDebug}
            disabled={loading || !name.trim()}
            className="px-6 py-2.5 rounded-lg font-bold text-[13px] disabled:opacity-40"
            style={{ background: '#d4a017', color: '#07060f' }}
          >
            {loading ? 'Chargement...' : 'Analyser'}
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-lg text-[12px]" style={{ background: '#be123c22', border: '1px solid #be123c55', color: '#f87171' }}>
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-5">
            {/* Player header */}
            <div className="p-4 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
              <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-bold font-cinzel" style={{ color: '#e8e2f5' }}>{data.player.name}</h2>
                <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: '#1a1630', color: '#9990b8' }}>
                  {data.player.game}
                </span>
                <span className="text-[10px] font-mono" style={{ color: '#4a4468' }}>{data.player.id}</span>
              </div>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Total records" value={data.totals.totalRecords} />
              <StatCard label="Avec score" value={data.totals.withScore} />
              <StatCard label="Avec opponentId (H2H ready)" value={data.totals.withOpponentId} />
              <StatCard label="Confidence >= 0.5" value={data.totals.confidenceOk} />
            </div>

            {/* By format */}
            <div className="p-4 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
              <h3 className="text-[11px] uppercase tracking-widest mb-3" style={{ color: '#6b6488' }}>Par format</h3>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ color: '#6b6488' }}>
                    <th className="text-left pb-1">Format</th>
                    <th className="text-right pb-1">Total</th>
                    <th className="text-right pb-1">Avec score</th>
                    <th className="text-right pb-1">Avec opponentId</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byFormat).map(([fmt, v]) => (
                    <tr key={fmt} style={{ borderTop: '1px solid #1e1a3033' }}>
                      <td className="py-1.5 text-[#e8e2f5]">{fmt}</td>
                      <td className="py-1.5 text-right text-[#d4a017] font-bold">{v.raw}</td>
                      <td className="py-1.5 text-right text-[#e8e2f5]">{v.withScore}</td>
                      <td className="py-1.5 text-right text-[#e8e2f5]">{v.withOpponentId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* BO5 analysis */}
            <div className="p-4 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
              <h3 className="text-[11px] uppercase tracking-widest mb-3" style={{ color: '#6b6488' }}>Analyse BO5</h3>
              <div className="flex gap-6 mb-4 text-[12px]">
                <div>
                  <span style={{ color: '#6b6488' }}>Raw count: </span>
                  <span className="font-bold" style={{ color: '#e8e2f5' }}>{data.bo5Analysis.rawCount}</span>
                </div>
                <div>
                  <span style={{ color: '#6b6488' }}>Effective sample (après recency): </span>
                  <span className="font-bold" style={{ color: '#d4a017' }}>
                    {data.bo5Analysis.effectiveSampleAfterRecencyDecay}
                  </span>
                </div>
                <div>
                  <span style={{ color: '#6b6488' }}>Full blend weight: </span>
                  <span className="font-bold" style={{ color: data.bo5Analysis.wouldGetFullBlendWeight ? '#10b981' : '#f87171' }}>
                    {data.bo5Analysis.wouldGetFullBlendWeight ? 'OUI' : 'NON (< 15)'}
                  </span>
                </div>
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ color: '#6b6488' }}>
                    <th className="text-left pb-1">Score</th>
                    <th className="text-right pb-1">Raw</th>
                    <th className="text-right pb-1">Pondéré (recency)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.bo5Analysis.distribution).map(([score, v]) => (
                    <tr key={score} style={{ borderTop: '1px solid #1e1a3033' }}>
                      <td className="py-1.5 font-mono" style={{ color: '#d4a017' }}>{score}</td>
                      <td className="py-1.5 text-right text-[#9990b8]">{v.raw}</td>
                      <td className="py-1.5 text-right text-[#e8e2f5]">{v.weighted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Recent records */}
            <div className="p-4 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
              <h3 className="text-[11px] uppercase tracking-widest mb-3" style={{ color: '#6b6488' }}>30 records les plus récents</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ color: '#6b6488' }}>
                      <th className="text-left pb-1">Date</th>
                      <th className="text-left pb-1">Adversaire</th>
                      <th className="text-right pb-1">H2H id</th>
                      <th className="text-center pb-1">Score</th>
                      <th className="text-center pb-1">Won</th>
                      <th className="text-left pb-1">Format</th>
                      <th className="text-right pb-1">Conf.</th>
                      <th className="text-right pb-1">Weight</th>
                      <th className="text-left pb-1">Src</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRecords.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #1e1a3033' }}>
                        <td className="py-1 text-[#9990b8]">{r.date ? new Date(r.date).toISOString().slice(0, 10) : '—'}</td>
                        <td className="py-1 text-[#e8e2f5]">{r.opponent}</td>
                        <td className="py-1 text-right">{r.opponentIdPresent ? '✓' : '—'}</td>
                        <td className="py-1 text-center font-mono" style={{ color: '#d4a017' }}>{r.score ?? '—'}</td>
                        <td className="py-1 text-center" style={{ color: r.won ? '#10b981' : '#f87171' }}>{r.won ? 'W' : 'L'}</td>
                        <td className="py-1 text-[#9990b8]">{r.format ?? '—'}</td>
                        <td className="py-1 text-right text-[#9990b8]">{r.confidence.toFixed(2)}</td>
                        <td className="py-1 text-right" style={{ color: r.recencyWeight > 0.5 ? '#10b981' : r.recencyWeight > 0 ? '#d4a017' : '#4a4468' }}>
                          {r.recencyWeight.toFixed(2)}
                        </td>
                        <td className="py-1 text-[#6b6488]">{r.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
      <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#6b6488' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: '#d4a017', fontFamily: 'Cinzel, serif' }}>
        {value}
      </p>
    </div>
  );
}
