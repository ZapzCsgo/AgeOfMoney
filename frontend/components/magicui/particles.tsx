'use client';
import React, { useEffect, useRef, useState } from 'react';

function hexToRgb(hex: string): number[] {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const hexInt = parseInt(hex, 16);
  return [(hexInt >> 16) & 255, (hexInt >> 8) & 255, hexInt & 255];
}

interface MousePosition { x: number; y: number; }
function useMousePosition(): MousePosition {
  const [pos, setPos] = useState<MousePosition>({ x: 0, y: 0 });
  useEffect(() => {
    const h = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);
  return pos;
}

export interface ParticlesProps {
  className?: string;
  quantity?: number;
  staticity?: number;
  ease?: number;
  size?: number;
  color?: string;
  vx?: number;
  vy?: number;
}

export function Particles({
  className = '',
  quantity = 80,
  staticity = 50,
  ease = 50,
  size = 0.4,
  color = '#ffc542',
  vx = 0,
  vy = 0,
}: ParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null>(null);

  type Circle = {
    x: number; y: number; translateX: number; translateY: number;
    size: number; alpha: number; targetAlpha: number;
    dx: number; dy: number; magnetism: number;
  };

  const circles = useRef<Circle[]>([]);
  const mousePos = useMousePosition();
  const mouse = useRef({ x: 0, y: 0 });
  const canvasSize = useRef({ w: 0, h: 0 });
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const rgb = hexToRgb(color);
  const rafId = useRef<number>(0);

  const circleParams = (): Circle => ({
    x: Math.floor(Math.random() * canvasSize.current.w),
    y: Math.floor(Math.random() * canvasSize.current.h),
    translateX: 0,
    translateY: 0,
    size: Math.floor(Math.random() * 2) + size,
    alpha: 0,
    targetAlpha: parseFloat((Math.random() * 0.5 + 0.1).toFixed(1)),
    dx: (Math.random() - 0.5) * 0.08,
    dy: (Math.random() - 0.5) * 0.08,
    magnetism: 0.1 + Math.random() * 4,
  });

  const drawCircle = (c: Circle, update = false) => {
    if (!ctx.current) return;
    ctx.current.translate(c.translateX, c.translateY);
    ctx.current.beginPath();
    ctx.current.arc(c.x, c.y, c.size, 0, 2 * Math.PI);
    ctx.current.fillStyle = `rgba(${rgb.join(',')},${c.alpha})`;
    ctx.current.fill();
    ctx.current.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!update) circles.current.push(c);
  };

  const remap = (v: number, s1: number, e1: number, s2: number, e2: number) =>
    Math.max(0, ((v - s1) * (e2 - s2)) / (e1 - s1) + s2);

  const animate = () => {
    if (!ctx.current) return;
    ctx.current.clearRect(0, 0, canvasSize.current.w, canvasSize.current.h);
    circles.current.forEach((c, i) => {
      const edge = [
        c.x + c.translateX - c.size,
        canvasSize.current.w - c.x - c.translateX - c.size,
        c.y + c.translateY - c.size,
        canvasSize.current.h - c.y - c.translateY - c.size,
      ];
      const closest = Math.min(...edge);
      const remapped = parseFloat(remap(closest, 0, 20, 0, 1).toFixed(2));
      if (remapped > 1) {
        c.alpha = Math.min(c.alpha + 0.02, c.targetAlpha);
      } else {
        c.alpha = c.targetAlpha * remapped;
      }
      c.x += c.dx + vx;
      c.y += c.dy + vy;
      c.translateX += (mouse.current.x / (staticity / c.magnetism) - c.translateX) / ease;
      c.translateY += (mouse.current.y / (staticity / c.magnetism) - c.translateY) / ease;
      drawCircle(c, true);
      if (
        c.x < -c.size || c.x > canvasSize.current.w + c.size ||
        c.y < -c.size || c.y > canvasSize.current.h + c.size
      ) {
        circles.current.splice(i, 1);
        drawCircle(circleParams());
      }
    });
    rafId.current = requestAnimationFrame(animate);
  };

  const init = () => {
    if (!containerRef.current || !canvasRef.current || !ctx.current) return;
    circles.current = [];
    canvasSize.current.w = containerRef.current.offsetWidth;
    canvasSize.current.h = containerRef.current.offsetHeight;
    canvasRef.current.width = canvasSize.current.w * dpr;
    canvasRef.current.height = canvasSize.current.h * dpr;
    canvasRef.current.style.width = `${canvasSize.current.w}px`;
    canvasRef.current.style.height = `${canvasSize.current.h}px`;
    ctx.current.scale(dpr, dpr);
    for (let i = 0; i < quantity; i++) drawCircle(circleParams());
  };

  useEffect(() => {
    if (canvasRef.current) ctx.current = canvasRef.current.getContext('2d');
    init();
    rafId.current = requestAnimationFrame(animate);
    window.addEventListener('resize', init);
    return () => {
      cancelAnimationFrame(rafId.current);
      window.removeEventListener('resize', init);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, quantity]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { w, h } = canvasSize.current;
    const x = mousePos.x - rect.left - w / 2;
    const y = mousePos.y - rect.top - h / 2;
    if (Math.abs(x) < w / 2 && Math.abs(y) < h / 2) {
      mouse.current.x = x;
      mouse.current.y = y;
    }
  }, [mousePos]);

  return (
    <div className={className} ref={containerRef} aria-hidden="true">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}
