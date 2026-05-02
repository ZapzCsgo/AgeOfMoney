// HTTP 503 = Service Unavailable, semantically correct for planned downtime.
// The standalone layout.tsx in this same directory still bypasses the root
// Navbar/Sidebar/Footer (kept).
import { ErrorPage } from '@/components/ErrorPage';

export default function Maintenance() {
  return (
    <ErrorPage
      errorCode="503"
      title="FORGING UPGRADES"
      subtitle="We're upgrading the platform. Back in a few moments."
      showCta={false}
    />
  );
}
