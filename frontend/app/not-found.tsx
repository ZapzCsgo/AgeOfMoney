import { ErrorPage } from '@/components/ErrorPage';

export default function NotFound() {
  return (
    <ErrorPage
      errorCode="404"
      title="DEFEAT"
      subtitle="This territory is uncharted. Return to your base."
      ctaText="← Return to your base"
      ctaHref="/"
    />
  );
}
