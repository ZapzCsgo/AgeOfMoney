'use client';

import { signIn } from 'next-auth/react';
import { ErrorPage } from '@/components/ErrorPage';

export default function Forbidden() {
  return (
    <ErrorPage
      errorCode="403"
      title="FORBIDDEN"
      subtitle="Tu n'as pas la permission d'accéder à cet endroit."
      ctaText="Connexion Steam"
      ctaOnClick={() => signIn('steam', { callbackUrl: '/' })}
    />
  );
}
