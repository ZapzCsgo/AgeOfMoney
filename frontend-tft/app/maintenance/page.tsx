// HTTP 503 = Service Unavailable, semantically correct for planned downtime.
import { ErrorPage } from '@/components/ErrorPage';

export default function Maintenance() {
  return (
    <ErrorPage
      errorCode="503"
      title="MAINTENANCE EN COURS"
      subtitle="On bosse pour améliorer la plateforme. On revient vite."
      showCta={false}
    />
  );
}
