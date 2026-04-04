'use client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface MeteorsProps {
  number?: number;
  className?: string;
}

export function Meteors({ number = 12, className }: MeteorsProps) {
  const [styles, setStyles] = useState<React.CSSProperties[]>([]);

  useEffect(() => {
    setStyles(
      Array.from({ length: number }, () => ({
        top: -5,
        left: `${Math.floor(Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 1200))}px`,
        animationDelay: `${Math.random() * 2 + 0.2}s`,
        animationDuration: `${Math.floor(Math.random() * 8 + 4)}s`,
      }))
    );
  }, [number]);

  return (
    <>
      {styles.map((style, i) => (
        <span
          key={i}
          className={cn(
            'pointer-events-none absolute size-0.5 rotate-[215deg] animate-meteor rounded-full shadow-[0_0_0_1px_#d4a01720]',
            className
          )}
          style={{
            ...style,
            background: 'linear-gradient(90deg, #d4a017, transparent)',
          }}
        >
          <div className="pointer-events-none absolute top-1/2 -z-10 h-px w-[60px] -translate-y-1/2 bg-gradient-to-r from-aoe-gold to-transparent opacity-60" />
        </span>
      ))}
    </>
  );
}
