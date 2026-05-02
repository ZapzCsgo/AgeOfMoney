import { ErrorPage } from '@/components/ErrorPage';

export default function NotFound() {
  return (
    <ErrorPage
      imageSrc="/errors/404-errors.png"
      imageAlt="404 — Territory uncharted"
      ctaText="← Return to your base"
      ctaHref="/"
      errorCode="404"
      title="DEFEAT"
      subtitle="This territory is uncharted. Return to your base."
    />
  );
}
