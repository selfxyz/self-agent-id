// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useEffect, useRef } from "react";

const CHARS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const FONT_SIZE = 12;
const COL_SPEED_MIN = 0.3;
const COL_SPEED_MAX = 0.8;

interface CardMatrixOverlayProps {
  active: boolean;
  /** How long the rain plays before fading (ms) */
  duration?: number;
  /** How long the fade-out takes (ms) */
  fadeOut?: number;
}

/**
 * Plays a matrix rain animation over its parent for `duration` ms,
 * then fades out over `fadeOut` ms to reveal the content underneath.
 * Does NOT replace any content — it's purely an overlay.
 */
export default function CardMatrixOverlay({
  active,
  duration = 2000,
  fadeOut = 800,
}: CardMatrixOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Show container BEFORE reading dimensions (display:none returns 0x0)
    container.style.display = "block";
    canvas.style.opacity = "1";
    canvas.style.transition = "";

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const cols = Math.ceil(canvas.width / FONT_SIZE);
    const drops: number[] = Array.from({ length: cols }, () => Math.random() * -15);
    const speeds: number[] = Array.from({ length: cols }, () =>
      COL_SPEED_MIN + Math.random() * (COL_SPEED_MAX - COL_SPEED_MIN)
    );

    let animId = 0;

    const draw = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < cols; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * FONT_SIZE;
        const y = drops[i] * FONT_SIZE;

        if (Math.random() > 0.9) {
          ctx.fillStyle = "#ffffff";
          ctx.font = `bold ${FONT_SIZE}px monospace`;
        } else {
          const g = 140 + Math.floor(Math.random() * 115);
          ctx.fillStyle = `rgb(0, ${g}, ${Math.floor(g * 0.3)})`;
          ctx.font = `${FONT_SIZE}px monospace`;
        }

        ctx.fillText(char, x, y);
        drops[i] += speeds[i];

        if (y > canvas.height && Math.random() > 0.95) {
          drops[i] = Math.random() * -10;
          speeds[i] = COL_SPEED_MIN + Math.random() * (COL_SPEED_MAX - COL_SPEED_MIN);
        }
      }

      animId = requestAnimationFrame(draw);
    };

    // Fill black so rain is visible
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    draw();

    // Fade out after duration
    const fadeTimer = setTimeout(() => {
      canvas.style.transition = `opacity ${fadeOut}ms ease-out`;
      canvas.style.opacity = "0";
    }, duration);

    // Hide container entirely after fade completes
    const hideTimer = setTimeout(() => {
      cancelAnimationFrame(animId);
      container.style.display = "none";
    }, duration + fadeOut);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
      }
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
      observer.disconnect();
    };
  }, [active, duration, fadeOut]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none z-10"
      style={{ display: "none" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 1 }}
      />
    </div>
  );
}
