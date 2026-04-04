import { enrichAllUpcomingMatches } from '../src/scrapers/aoe4worldScraper';

enrichAllUpcomingMatches()
  .then(() => {
    console.log('[Enrich] Complete');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[Enrich] Error:', e);
    process.exit(1);
  });
