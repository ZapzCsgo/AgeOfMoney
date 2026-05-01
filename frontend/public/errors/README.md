# Error / status page assets

Branded full-screen images shown on the error / status pages.
Style guide : noir profond `#0A0A14`, or `#D4B896` / `#FFC857`,
ivoire `#F5F0E8`, motif fleur-de-lys + grid topographique.

## Wiring (current)

| File | Wired by | Title (in image) | Subtext |
|------|----------|------------------|---------|
| `404-errors.png` | `app/not-found.tsx`         | DEFEAT             | Territory uncharted |
| `500-errors.png` | `app/error.tsx`             | FORTRESS UNDER SIEGE | Castle being repaired |
| `403-errors.png` | `app/forbidden/page.tsx`    | FORBIDDEN          | No permission to enter this realm |
| `503-errors.png` | `app/maintenance/page.tsx`  | FORGING UPGRADES   | Platform being upgraded (HTTP 503 = planned downtime) |
| `nodata-errors.png` | _not wired yet_           | NO DATA            | Reserved for empty states (matches list, leaderboard, history, etc.) |

## Specs (for future regenerations)

- Format : PNG (or AVIF / WebP — `next.config.js` already includes those).
- Aspect ratio : 16:9 minimum, ideally 21:9 (covers ultra-wide laptops via `object-cover`).
- Resolution : ≥ 1920×1080 (`next/image` will scale down per device DPR).
- File size : aim under 1 MB each. Current files are 1.5–2.7 MB — fine for a one-shot bleed but can be re-encoded smaller before launch if Lighthouse complains.

## Layout assumption

`<ErrorPage>` (`components/ErrorPage.tsx`) renders the image with
`next/image fill className="object-cover"`. The CTA button sits at
`bottom-12` centered. Make sure the image's bottom 200 px don't carry
critical text — the gold CTA pill will overlay it.

## How the page renders

`<ErrorPage>` mounts as `position: fixed; inset: 0; z-index: 9999` and
locks body scroll, so the image covers the entire viewport including
the global Navbar / LeftSidebar / Footer. No route-group setup needed.

## Wiring `nodata-errors.png` later

Empty states are component-level, not route-level. Pattern :

```tsx
import Image from 'next/image';
{matches.length === 0 && (
  <div className="relative w-full h-96">
    <Image src="/errors/nodata-errors.png" alt="No data" fill className="object-contain" />
  </div>
)}
```

`object-contain` (not `object-cover`) for inline placement so the image
keeps its proportions inside the slot.

## Adding a new error page

1. Drop the image in this folder named `<status>-errors.png`.
2. Either reuse `app/error.tsx` / `app/not-found.tsx` (special-cased by
   the App Router) or create `app/<name>/page.tsx`. Use
   `<ErrorPage imageSrc="/errors/<status>-errors.png" ... />`.
