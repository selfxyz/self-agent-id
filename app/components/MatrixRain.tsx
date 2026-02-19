"use client";

import { useEffect, useRef } from "react";

interface MatrixRainProps {
  /** How long (ms) the rain is fully visible before fading out */
  duration?: number;
  /** Fade-out duration in ms */
  fadeOut?: number;
  /** Speed multiplier (1 = normal, 2 = double speed, etc.) */
  speed?: number;
  /** Max opacity of the overlay (1 = fully opaque black bg, 0.3 = transparent) */
  maxOpacity?: number;
}

const CHARS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const FONT_SIZE = 14;
const COL_SPEED_MIN = 0.4;
const COL_SPEED_MAX = 1.2;

export default function MatrixRain({
  duration = 3000,
  fadeOut = 1500,
  speed = 1,
  maxOpacity = 1,
}: MatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const cols = Math.ceil(canvas.width / FONT_SIZE);
    const drops: number[] = Array.from({ length: cols }, () => Math.random() * -30);
    const speeds: number[] = Array.from({ length: cols }, () =>
      (COL_SPEED_MIN + Math.random() * (COL_SPEED_MAX - COL_SPEED_MIN)) * speed
    );

    // Trail fade: lower maxOpacity = faster trail fade so chars don't pile up
    const trailAlpha = maxOpacity < 1 ? 0.12 : 0.06;

    let animId: number;
    const draw = () => {
      // Black overlay for trail effect — uses background opacity
      ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < cols; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;

        const isHead = Math.random() > 0.92;
        if (isHead) {
          ctx.fillStyle = "#ffffff";
          ctx.font = `bold ${FONT_SIZE}px monospace`;
        } else {
          const g = 140 + Math.floor(Math.random() * 115);
          ctx.fillStyle = `rgb(0, ${g}, ${Math.floor(g * 0.3)})`;
          ctx.font = `${FONT_SIZE}px monospace`;
        }

        ctx.fillText(char, x, y);
        drops[i] += speeds[i];

        if (y > canvas.height && Math.random() > 0.98) {
          drops[i] = Math.random() * -20;
          speeds[i] = (COL_SPEED_MIN + Math.random() * (COL_SPEED_MAX - COL_SPEED_MIN)) * speed;
        }
      }

      animId = requestAnimationFrame(draw);
    };

    // Start at full maxOpacity
    container.style.opacity = String(maxOpacity);
    draw();

    // Fade out after duration
    const fadeTimer = setTimeout(() => {
      container.style.transition = `opacity ${fadeOut}ms ease-out`;
      container.style.opacity = "0";
    }, duration);

    // Stop animation after fade completes
    const cleanupTimer = setTimeout(() => {
      cancelAnimationFrame(animId);
    }, duration + fadeOut);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(fadeTimer);
      clearTimeout(cleanupTimer);
      window.removeEventListener("resize", resize);
    };
  }, [duration, fadeOut, speed, maxOpacity]);

  // For full-opacity mode, start with black bg so the page is hidden immediately
  // (before React hydration / canvas starts drawing)
  const initialStyle = maxOpacity >= 1
    ? { opacity: 1, backgroundColor: "#000" }
    : { opacity: 0 };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 pointer-events-none"
      style={initialStyle}
    >
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
