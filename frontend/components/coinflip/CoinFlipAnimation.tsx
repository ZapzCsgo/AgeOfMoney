'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';

export type CoinSide = 'crown' | 'shield';

interface CoinFlipAnimationProps {
  /** Which side the coin should land on */
  result?: CoinSide;
  /** Whether the animation is currently running */
  isFlipping: boolean;
  /** Called when the flip animation completes */
  onComplete?: () => void;
  /** Size of the coin in px (default 180) */
  size?: number;
}

// Gold sparkle particle
function Sparkle({ delay, x, y, size }: { delay: number; x: number; y: number; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle, #f5c842 0%, #d4a017 40%, transparent 70%)',
        left: '50%',
        top: '50%',
        filter: 'blur(0.5px)',
      }}
      initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        x: x,
        y: y,
        scale: [0, 1.2, 0.8, 0],
      }}
      transition={{
        duration: 0.8,
        delay,
        ease: 'easeOut',
      }}
    />
  );
}

export function CoinFlipAnimation({
  result,
  isFlipping,
  onComplete,
  size = 180,
}: CoinFlipAnimationProps) {
  const controls = useAnimation();
  const [showSparkles, setShowSparkles] = useState(false);
  const [currentRotation, setCurrentRotation] = useState(0);
  const hasFlippedRef = useRef(false);

  // Generate sparkle positions once
  const sparkles = useRef(
    Array.from({ length: 16 }).map((_, i) => ({
      id: i,
      delay: Math.random() * 0.3,
      x: (Math.random() - 0.5) * size * 1.8,
      y: (Math.random() - 0.5) * size * 1.8,
      size: 3 + Math.random() * 5,
    }))
  ).current;

  useEffect(() => {
    if (!isFlipping || !result) return;
    if (hasFlippedRef.current) return;
    hasFlippedRef.current = true;

    const runAnimation = async () => {
      setShowSparkles(false);

      // Phase 1: Anticipation — coin lifts up
      await controls.start({
        y: -30,
        scale: 1.1,
        rotateX: currentRotation,
        transition: { duration: 0.3, ease: 'easeOut' },
      });

      // Phase 2: Spin — 5 or 5.5 rotations
      // Crown result = 1800deg (5 full), Shield = 1980deg (5.5)
      const targetRotation = result === 'crown' ? 1800 : 1980;

      await controls.start({
        rotateX: targetRotation,
        y: 0,
        scale: 1,
        transition: {
          duration: 2.5,
          ease: [0.15, 0.6, 0.35, 1], // custom deceleration
        },
      });

      setCurrentRotation(targetRotation % 360);

      // Phase 3: Landing bounce
      await controls.start({
        scale: [1.05, 0.97, 1],
        y: [0, 2, 0],
        transition: {
          duration: 0.4,
          ease: 'easeInOut',
        },
      });

      // Sparkle burst
      setShowSparkles(true);

      onComplete?.();
    };

    runAnimation();
  }, [isFlipping, result]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when not flipping
  useEffect(() => {
    if (!isFlipping) {
      hasFlippedRef.current = false;
    }
  }, [isFlipping]);

  const half = size / 2;
  const edgeLayers = 16;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Glow behind coin */}
      <div
        className="absolute rounded-full"
        style={{
          width: size * 1.3,
          height: size * 1.3,
          background: 'radial-gradient(circle, rgba(212,160,23,0.15) 0%, transparent 70%)',
          filter: 'blur(20px)',
        }}
      />

      {/* 3D Coin container */}
      <div style={{ perspective: '1000px', width: size, height: size }}>
        <motion.div
          animate={controls}
          style={{
            width: size,
            height: size,
            transformStyle: 'preserve-3d',
            position: 'relative',
          }}
        >
          {/* Front face — Crown (gold) */}
          <div
            className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{
              backfaceVisibility: 'hidden',
              background: `radial-gradient(ellipse at 35% 30%, #f5c842 0%, #d4a017 40%, #b8860b 80%, #8b6914 100%)`,
              boxShadow: `
                inset 0 -4px 12px rgba(0,0,0,0.4),
                inset 0 4px 8px rgba(255,230,120,0.3),
                0 0 30px rgba(212,160,23,0.3)
              `,
              border: '2px solid #c4960f',
            }}
          >
            {/* Inner ring */}
            <div
              className="absolute rounded-full"
              style={{
                width: size - 20,
                height: size - 20,
                border: '1.5px solid rgba(255,230,120,0.3)',
              }}
            />
            {/* Fleur-de-lis symbol */}
            <span
              className="select-none"
              style={{
                fontSize: size * 0.4,
                color: '#8b6914',
                textShadow: '0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(245,200,66,0.2)',
                filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))',
                lineHeight: 1,
              }}
            >
              ⚜
            </span>
            {/* Subtle shine overlay */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)',
              }}
            />
          </div>

          {/* Back face — Shield (silver) */}
          <div
            className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateX(180deg)',
              background: `radial-gradient(ellipse at 35% 30%, #c0c0c0 0%, #8a8a9a 40%, #6a6a7a 80%, #4a4a5a 100%)`,
              boxShadow: `
                inset 0 -4px 12px rgba(0,0,0,0.4),
                inset 0 4px 8px rgba(200,200,220,0.3),
                0 0 30px rgba(138,138,154,0.2)
              `,
              border: '2px solid #7a7a8a',
            }}
          >
            {/* Inner ring */}
            <div
              className="absolute rounded-full"
              style={{
                width: size - 20,
                height: size - 20,
                border: '1.5px solid rgba(200,200,220,0.2)',
              }}
            />
            {/* Shield symbol */}
            <span
              className="select-none"
              style={{
                fontSize: size * 0.35,
                color: '#4a4a5a',
                textShadow: '0 1px 2px rgba(0,0,0,0.3), 0 0 6px rgba(200,200,220,0.15)',
                filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))',
                lineHeight: 1,
              }}
            >
              🛡
            </span>
            {/* Subtle shine overlay */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 50%, rgba(0,0,0,0.08) 100%)',
              }}
            />
          </div>

          {/* Edge — stacked thin layers for 3D thickness */}
          {Array.from({ length: edgeLayers }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: size - 4,
                height: size - 4,
                left: 2,
                top: 2,
                transform: `translateZ(${i * 0.5 - (edgeLayers * 0.5) / 2}px)`,
                background: `linear-gradient(180deg, #c4960f ${10 + i * 2}%, #8b6914 ${60 + i}%, #6b5010 100%)`,
                backfaceVisibility: 'hidden',
              }}
            />
          ))}
        </motion.div>
      </div>

      {/* Gold sparkle particles on result */}
      <AnimatePresence>
        {showSparkles && (
          <div className="absolute inset-0 pointer-events-none">
            {sparkles.map((s) => (
              <Sparkle key={s.id} delay={s.delay} x={s.x} y={s.y} size={s.size} />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
