'use client';
import { useEffect, useRef } from 'react';
import { useInView, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';

export function NumberTicker({
  value,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
}: {
  value: number;
  direction?: 'up' | 'down';
  delay?: number;
  className?: string;
  decimalPlaces?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(direction === 'down' ? value : 0);
  const spring = useSpring(mv, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: '0px' });

  useEffect(() => {
    if (isInView) setTimeout(() => mv.set(direction === 'down' ? 0 : value), delay * 1000);
  }, [isInView, value, direction, delay, mv]);

  useEffect(
    () =>
      spring.on('change', (v) => {
        if (ref.current)
          ref.current.textContent = Intl.NumberFormat('fr-FR').format(
            parseFloat(v.toFixed(decimalPlaces))
          );
      }),
    [spring, decimalPlaces]
  );

  return <span ref={ref} className={cn('inline-block tabular-nums tracking-wider', className)} />;
}
