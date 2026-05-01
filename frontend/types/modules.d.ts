/**
 * Ambient module declarations for packages without bundled or @types
 * declarations available locally. These let `tsc --noEmit` pass even when
 * `npm install` hasn't been run; the actual JS is dynamically imported at
 * runtime, so the lack of types doesn't affect production behavior.
 */
declare module 'canvas-confetti' {
  interface ConfettiOptions {
    particleCount?: number;
    angle?: number;
    spread?: number;
    startVelocity?: number;
    decay?: number;
    gravity?: number;
    drift?: number;
    ticks?: number;
    origin?: { x?: number; y?: number };
    colors?: string[];
    shapes?: Array<'square' | 'circle' | 'star'>;
    scalar?: number;
    zIndex?: number;
    disableForReducedMotion?: boolean;
  }
  interface ConfettiFn {
    (options?: ConfettiOptions): Promise<null> | null;
    reset?: () => void;
  }
  const confetti: ConfettiFn;
  export default confetti;
}

declare module 'react-roulette-pro';
declare module 'react-roulette-pro/dist/index.css';
