/**
 * Global TOTP challenge controller.
 *
 * Problème : le backend renvoie `403 { error: "TOTP_REQUIRED" }` quand un
 * user avec 2FA actif fait une requête depuis une IP non-trusted (ou sur
 * une action sensible type retrait). Au lieu de montrer une erreur brute,
 * on veut une UX fluide : un modal apparaît, le user tape son code 6
 * chiffres, on retry la requête originale avec le code en header, le modal
 * se ferme et il continue son flow.
 *
 * API :
 *   - `requestTotpCode()` → promesse résolue avec le code 6 chiffres, ou
 *     rejetée avec 'cancelled' si le user ferme le modal.
 *   - `subscribeTotpChallenge(listener)` → le modal global s'y abonne
 *     pour savoir quand afficher son UI.
 */

type ChallengeState = {
  open: boolean;
  reason?: 'unknown_ip' | 'sensitive_action';
  invalidAttempt?: boolean;
};

type ChallengeResolver = (code: string) => void;
type ChallengeRejector = (reason: string) => void;

let currentResolver: ChallengeResolver | null = null;
let currentRejector: ChallengeRejector | null = null;
let state: ChallengeState = { open: false };
const listeners = new Set<(s: ChallengeState) => void>();

function emit() {
  listeners.forEach((l) => l(state));
}

export function subscribeTotpChallenge(listener: (s: ChallengeState) => void): () => void {
  listeners.add(listener);
  // Emit current state immediately so the subscriber syncs
  listener(state);
  return () => listeners.delete(listener);
}

export function requestTotpCode(reason: 'unknown_ip' | 'sensitive_action' = 'unknown_ip'): Promise<string> {
  // If a challenge is already open, queue this one behind it by chaining
  // on the same promise — simpler than maintaining an actual queue and the
  // user only ever needs to type one code per burst anyway.
  if (currentResolver) {
    return new Promise((resolve, reject) => {
      const oldResolver = currentResolver!;
      const oldRejector = currentRejector!;
      currentResolver = (code) => { oldResolver(code); resolve(code); };
      currentRejector = (r) => { oldRejector(r); reject(new Error(r)); };
    });
  }
  return new Promise((resolve, reject) => {
    currentResolver = (code) => { resolve(code); };
    currentRejector = (r) => { reject(new Error(r)); };
    state = { open: true, reason };
    emit();
  });
}

export function resolveTotpCode(code: string): void {
  const r = currentResolver;
  currentResolver = null;
  currentRejector = null;
  state = { open: false };
  emit();
  r?.(code);
}

export function rejectTotpCode(reason = 'cancelled'): void {
  const r = currentRejector;
  currentResolver = null;
  currentRejector = null;
  state = { open: false };
  emit();
  r?.(reason);
}

/**
 * Appelé par l'axios interceptor quand le code retourne invalide — on
 * rouvre le modal avec un flag "essaye encore" sans cancel le resolver.
 */
export function markInvalidAttempt(): void {
  state = { ...state, open: true, invalidAttempt: true };
  emit();
}
