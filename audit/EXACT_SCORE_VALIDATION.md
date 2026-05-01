# Exact-score calibration validation (2026-05-01)

Snapshot : 2026-05-01T20:51:44.445Z
Predictions : 143 (BO3=18, BO5=119, BO7=6)


## Format ALL — n=143 matchs

ECE analytical : **0.0193**
ECE monteCarlo : **0.0192**

| Bucket | n | p̂ analytical | obs | gap | p̂ MC | obs | gap |
|--------|---|---------------|-----|-----|-------|-----|-----|
|  0-10% | 85 | 0.078 | 0.094 | -0.016 | 0.077 | 0.092 | -0.015 |
| 10-20% | 524 | 0.160 | 0.149 | 0.011 | 0.159 | 0.144 | 0.015 |
| 20-30% | 214 | 0.227 | 0.196 | 0.031 | 0.227 | 0.205 | 0.022 |
| 30-40% | 10 | 0.330 | 0.500 | -0.170 | 0.331 | 0.500 | -0.169 |
| 50-60% | 1 | 0.536 | 0.000 | 0.536 | 0.539 | 0.000 | 0.539 |

## Format BO3 — n=18 matchs

ECE analytical : **0.0889**
ECE monteCarlo : **0.0887**

| Bucket | n | p̂ analytical | obs | gap | p̂ MC | obs | gap |
|--------|---|---------------|-----|-----|-------|-----|-----|
|  0-10% | 1 | 0.072 | 0.000 | 0.072 | 0.073 | 0.000 | 0.073 |
| 10-20% | 13 | 0.177 | 0.154 | 0.023 | 0.176 | 0.083 | 0.093 |
| 20-30% | 47 | 0.251 | 0.170 | 0.081 | 0.249 | 0.188 | 0.062 |
| 30-40% | 10 | 0.330 | 0.500 | -0.170 | 0.331 | 0.500 | -0.169 |
| 50-60% | 1 | 0.536 | 0.000 | 0.536 | 0.539 | 0.000 | 0.539 |

## Format BO5 — n=119 matchs

ECE analytical : **0.0136**
ECE monteCarlo : **0.0132**

| Bucket | n | p̂ analytical | obs | gap | p̂ MC | obs | gap |
|--------|---|---------------|-----|-----|-------|-----|-----|
|  0-10% | 70 | 0.081 | 0.100 | -0.019 | 0.079 | 0.096 | -0.017 |
| 10-20% | 477 | 0.160 | 0.149 | 0.012 | 0.159 | 0.145 | 0.014 |
| 20-30% | 167 | 0.221 | 0.204 | 0.017 | 0.221 | 0.211 | 0.010 |

## Format BO7 — n=6 matchs

ECE analytical : **0.0030**
ECE monteCarlo : **0.0084**

| Bucket | n | p̂ analytical | obs | gap | p̂ MC | obs | gap |
|--------|---|---------------|-----|-----|-------|-----|-----|
|  0-10% | 14 | 0.066 | 0.071 | -0.005 | 0.064 | 0.077 | -0.013 |
| 10-20% | 34 | 0.149 | 0.147 | 0.002 | 0.146 | 0.147 | -0.001 |
| 20-30% | 0 | 0.000 | 0.000 | 0.000 | 0.203 | 0.000 | 0.203 |

## Distribution observed vs predicted (all formats)

| Score | Observed n | Observed % | Predicted (ana) % | Predicted (mc) % | Δ ana | Δ mc |
|-------|------------|------------|-------------------|------------------|-------|------|
| 0-2 | 2 | 1.4% | 2.5% | 2.6% | 1.1 | 1.2 |
| 0-3 | 5 | 3.5% | 9.1% | 8.9% | 5.6 | 5.4 |
| 0-4 | 0 | 0.0% | 0.3% | 0.3% | 0.3 | 0.3 |
| 1-2 | 1 | 0.7% | 2.7% | 2.7% | 2.0 | 2.0 |
| 1-3 | 13 | 9.1% | 13.9% | 13.9% | 4.8 | 4.8 |
| 1-4 | 1 | 0.7% | 0.5% | 0.5% | -0.2 | -0.2 |
| 2-0 | 8 | 5.6% | 3.9% | 3.9% | -1.7 | -1.7 |
| 2-1 | 4 | 2.8% | 3.4% | 3.4% | 0.6 | 0.6 |
| 2-3 | 8 | 5.6% | 14.4% | 15.0% | 8.8 | 9.4 |
| 2-4 | 2 | 1.4% | 0.7% | 0.7% | -0.7 | -0.7 |
| 3-0 | 46 | 32.2% | 12.6% | 12.0% | -19.6 | -20.2 |
| 3-1 | 27 | 18.9% | 17.3% | 17.6% | -1.6 | -1.3 |
| 3-2 | 15 | 10.5% | 16.0% | 15.9% | 5.5 | 5.4 |
| 3-4 | 2 | 1.4% | 0.6% | 0.7% | -0.8 | -0.7 |
| 4-0 | 1 | 0.7% | 0.3% | 0.3% | -0.4 | -0.4 |
| 4-1 | 5 | 3.5% | 0.5% | 0.5% | -3.0 | -3.0 |
| 4-2 | 2 | 1.4% | 0.6% | 0.6% | -0.8 | -0.8 |
| 4-3 | 1 | 0.7% | 0.6% | 0.6% | -0.1 | -0.1 |

## Verdict

- ECE total analytical = 0.0193
- ECE total monteCarlo = 0.0192
- Diff |ana - mc| = 0.0001 → MC est une estimation bruitée (10k sims) du closed-form analytical, sans information ajoutée.

✅ ECE ana < 0.05 — modèle bien calibré pour la prod telle quelle.

## Recommandation prod

1. **Utiliser `analyticalExactScore` en prod** — zéro variance, ~100× plus rapide que MC@10k, mêmes outputs (ECE diff < 0.005).
2. **Garder `simulateExactScore` côté harness** — devient utile UNIQUEMENT quand le pipeline data per-game (civ, map) sera en place pour exploiter `perMapProb`.
3. **Calibration isotonique post-hoc** : si ECE > 0.10, fitter une fonction monotone f(p) sur les buckets et l'appliquer avant publication des odds.
4. **Augmenter le sample BO3** : 18 BO3 dans le snapshot — peu pour calibrer ce format spécifique. Attendre 2-3 mois de tournois supplémentaires avant de tirer des conclusions BO3-spécifiques.