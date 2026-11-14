import { useEffect, useRef } from 'react';

interface ParticleWaveCanvasProps {
  colorRgb: string;
  cols?: number;
  rows?: number;
  tiltX?: number;
  className?: string;
}

export function ParticleWaveCanvas({
  colorRgb,
  cols = 58,
  rows = 18,
  tiltX = 38,
  className = '',
}: ParticleWaveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let w = 0;
    let h = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    let lastDraw = 0;
    const drawFrame = (now: number) => {
      if (prefersReduced || now - lastDraw >= 50) {
        lastDraw = now;
        if (w > 0 && h > 0) {
          ctx.clearRect(0, 0, w, h);
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const nx = (c / cols) * 2 - 1;
              const nz = (r / rows) * 2 - 1;
              const wave =
                Math.sin(nx * 4.2 + t) * Math.cos(nz * 3.1 - t * 0.7) * 24 +
                Math.sin((nx + nz) * 5 + t * 1.1) * 8;

              const x3 = nx * (w * 0.56);
              const y3 = wave + nz * tiltX;
              const z3 = nz * 140 + 220;

              const scale = 240 / z3;
              const sx = w * 0.56 + x3 * scale;
              const sy = h * 0.48 + y3 * scale;
              if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;

              const alpha = Math.max(0.05, Math.min(0.75, (1 - Math.abs(nz)) * 0.7 * scale));
              const radius = Math.max(0.8, 1.7 * scale);
              ctx.fillStyle = `rgba(${colorRgb}, ${alpha.toFixed(2)})`;
              ctx.beginPath();
              ctx.arc(sx, sy, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        t += 0.04;
      }

      if (!prefersReduced) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    rafId = requestAnimationFrame(drawFrame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [colorRgb, cols, rows, tiltX]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block ${className}`}
    />
  );
}
