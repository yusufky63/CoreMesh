'use client';

import { useEffect, useRef } from 'react';

interface InteractiveGridProps {
  squareSize?: number;
  gridColor?: string;
  hoverColor?: string;
  className?: string;
}

export function InteractiveGrid({
  squareSize = 40,
  gridColor = 'rgba(255, 255, 255, 0.025)',
  hoverColor = 'rgba(0, 180, 216, 0.15)',
  className = '',
}: InteractiveGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const litCells = new Map<string, number>();

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    resize();
    window.addEventListener('resize', resize);

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mouseRef.current = { x, y };

      const col = Math.floor(x / squareSize);
      const row = Math.floor(y / squareSize);

      // Light up 3x3 surrounding cells with decay
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${col + dx},${row + dy}`;
          const strength = dx === 0 && dy === 0 ? 1 : 0.6;
          litCells.set(key, Math.max(litCells.get(key) || 0, strength));
        }
      }
    };

    const handleMouseLeave = () => {
      mouseRef.current = null;
    };

    canvas.parentElement?.addEventListener('mousemove', handleMouseMove);
    canvas.parentElement?.addEventListener('mouseleave', handleMouseLeave);

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      const cols = Math.ceil(width / squareSize);
      const rows = Math.ceil(height / squareSize);

      // Draw standard grid
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;

      for (let x = 0; x <= width; x += squareSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      for (let y = 0; y <= height; y += squareSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw decaying illuminated cells
      litCells.forEach((intensity, key) => {
        if (intensity <= 0.02) {
          litCells.delete(key);
          return;
        }

        const [col, row] = key.split(',').map(Number);
        if (col >= 0 && col < cols && row >= 0 && row < rows) {
          ctx.fillStyle = hoverColor.replace(
            '0.15',
            (intensity * 0.18).toFixed(3),
          );
          ctx.fillRect(
            col * squareSize + 1,
            row * squareSize + 1,
            squareSize - 1,
            squareSize - 1,
          );

          // Subtle bright border
          ctx.strokeStyle = `rgba(0, 180, 216, ${(intensity * 0.35).toFixed(3)})`;
          ctx.strokeRect(
            col * squareSize + 1,
            row * squareSize + 1,
            squareSize - 1,
            squareSize - 1,
          );
        }

        litCells.set(key, intensity * 0.94);
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      canvas.parentElement?.removeEventListener('mousemove', handleMouseMove);
      canvas.parentElement?.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [squareSize, gridColor, hoverColor]);

  return (
    <canvas
      ref={canvasRef}
      className={`interactive-grid-canvas ${className}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
