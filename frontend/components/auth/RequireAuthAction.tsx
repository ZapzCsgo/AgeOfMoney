'use client';

import { useAuth } from '@/hooks/useAuth';

/**
 * Wraps an action that requires sign-in. Two usage shapes :
 *
 * A) As a button-like wrapper :
 *    <RequireAuthAction onAuthedClick={() => placeBet()} className="...">
 *      Place bet
 *    </RequireAuthAction>
 *
 * B) As a render-prop adapter for existing buttons :
 *    <RequireAuthAction onAuthedClick={() => placeBet()}>
 *      {(handleClick) => <button onClick={handleClick}>Place bet</button>}
 *    </RequireAuthAction>
 *
 * When the user is not authenticated, the click triggers Steam sign-in
 * with `callbackUrl = current path`. No silent no-op, no "nothing happens"
 * — the gold standard for "did the click do something?" UX.
 */
interface Props {
  onAuthedClick: () => void;
  children: React.ReactNode | ((handleClick: () => void) => React.ReactNode);
  /**
   * Path to return to after sign-in. Defaults to the current path so the
   * user lands back where they clicked.
   */
  returnTo?: string;
  /** Optional className for the wrapper button (mode A only). */
  className?: string;
  /** Optional title attribute (mode A only). */
  title?: string;
  /** Disable the wrapper entirely (mode A only) — passed through to <button>. */
  disabled?: boolean;
  /** Optional `type` (mode A only). Defaults to 'button'. */
  type?: 'button' | 'submit' | 'reset';
}

export function RequireAuthAction({
  onAuthedClick,
  children,
  returnTo,
  className,
  title,
  disabled,
  type = 'button',
}: Props) {
  const { isAuthenticated, signInWithSteam } = useAuth();

  const handleClick = () => {
    if (isAuthenticated) {
      onAuthedClick();
    } else {
      signInWithSteam(returnTo);
    }
  };

  // Render-prop mode : caller controls the markup.
  if (typeof children === 'function') {
    return <>{children(handleClick)}</>;
  }

  // Button-wrapper mode.
  return (
    <button
      type={type}
      onClick={handleClick}
      className={className}
      title={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
