# v46 — Ensemble voting result (2026-05-01)

Snapshot : 2026-05-01T21:20:19.078Z
Top-N constituents : 5 (inverse-Brier weighting)

## Constituents

| Rank | Variant | Brier | Voting weight |
|------|---------|-------|---------------|
| 1 | `v45-bayes-weak-h2h` | 0.1897 | 0.203 |
| 2 | `s2-combo-h2h-priority` | 0.1909 | 0.202 |
| 3 | `v40-anti-farm-h2h` | 0.1909 | 0.202 |
| 4 | `v44-combo-h2h-tier-streak` | 0.1959 | 0.197 |
| 5 | `form-weight-0` | 0.1960 | 0.197 |

## Ensemble metrics (n=153 non-draw)

| Metric | Ensemble | Baseline | Δ |
|--------|----------|----------|---|
| Brier ↓ | 0.1921 | 0.2061 | -0.0140 |
| Log loss ↓ | 0.5700 | 0.6007 | -0.0307 |
| ECE ↓ | 0.1977 | 0.2121 | -0.0144 |
| Accuracy ↑ | 73.2% | 71.9% | 1.3% |

## Verdict

Ensemble Brier 0.1921 is **better** than baseline 0.2061 by 0.0140.
Compared to the single-best constituent `v45-bayes-weak-h2h` (Brier 0.1897) :
- Ensemble is **worse than** the single best by 0.0025. Diversification didn't help — prefer the single winner `v45-bayes-weak-h2h`.