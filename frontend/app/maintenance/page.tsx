// Replaces the previous SVG-crown maintenance card with the branded
// "Forging Upgrades" image (HTTP 503 = Service Unavailable, semantically
// correct for planned downtime). The standalone layout.tsx in this same
// directory still bypasses the root Navbar/Sidebar/Footer (kept).
import { ErrorPage } from '@/components/ErrorPage';

export default function Maintenance() {
  return (
    <ErrorPage
      imageSrc="/errors/503-errors.png"
      imageAlt="Forging upgrades"
      showCta={false}
    />
  );
}
