"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  base: number;
  twinkle: number;
  speed: number;
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sparse starfield + nebula for the homepage hero.
 * Meant to read like Codex: dark space with depth, not a sci-fi wallpaper.
 */
export function HeroGalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
    let raf = 0;
    let time = 0;
    let running = true;

    const paint = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      for (const star of stars) {
        const pulse = reduceMotion
          ? 1
          : 0.55 + 0.45 * Math.sin(time * star.speed + star.twinkle);
        const alpha = star.base * pulse;
        if (star.r > 1.2) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(160, 195, 255, ${alpha * 0.18})`;
          ctx.arc(star.x, star.y, star.r * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(236, 242, 255, ${alpha})`;
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const seedStars = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const rand = mulberry32(20260830);
      const count = Math.round(Math.min(240, Math.max(90, (w * h) / 8500)));
      stars = Array.from({ length: count }, () => {
        const bright = rand() < 0.07;
        return {
          x: rand() * w,
          y: rand() * h,
          r: bright ? 1.15 + rand() * 1.15 : 0.35 + rand() * 0.85,
          base: bright ? 0.55 + rand() * 0.4 : 0.18 + rand() * 0.45,
          twinkle: rand() * Math.PI * 2,
          speed: 0.35 + rand() * 1.15
        };
      });
      paint();
    };

    const tick = () => {
      if (!running) return;
      time += 0.018;
      paint();
      raf = requestAnimationFrame(tick);
    };

    seedStars();
    if (!reduceMotion) raf = requestAnimationFrame(tick);

    const observer = new ResizeObserver(seedStars);
    observer.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className="hero-galaxy pointer-events-none absolute inset-x-0 -top-16 bottom-0 overflow-hidden"
      aria-hidden
    >
      <div className="hero-galaxy-nebula" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="hero-galaxy-fade" />
    </div>
  );
}
