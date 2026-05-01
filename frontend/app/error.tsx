'use client';

import { useEffect } from 'react';
import { ErrorPage } from '@/components/ErrorPage';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // App Router boundary — log to console for browser devtools, server
    // already logged the original throw. Don't surface stack to the user.
    // eslint-disable-next-line no-console
    console.error('[App] Error boundary triggered:', error.message, error.digest ?? '');
  }, [error]);

  return (
    <ErrorPage
      imageSrc="/errors/500-errors.png"
      imageAlt="500 — Fortress under siege"
      ctaText="⚔️ Try again"
      ctaOnClick={reset}
    />
  );
}
