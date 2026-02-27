// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"use client";

import { useEffect, useRef } from "react";

interface MatrixTextProps {
  text: string;
  className?: string;
  fontSize?: number;
}

const CHARS =
  "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const RAIN_SIZE = 11;

export default function MatrixText({
  text,
  className = "",
  fontSize = 90,
}: MatrixTextProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glowCanvas = glowRef.current;
    if (!canvas || !glowCanvas) return;

    // Wait for Orbitron to load before measuring
    void document.fonts.ready.then(() => {
      const ctx = canvas.getContext("2d");
      const glowCtx = glowCanvas.getContext("2d");
      if (!ctx || !glowCtx) return;

      const dpr = window.devicePixelRatio || 1;
      const font = `900 ${fontSize}px Orbitron, sans-serif`;

      // Measure text
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const glowPad = Math.round(fontSize * 0.5);
      const w = Math.ceil(metrics.width) + Math.round(fontSize * 0.3);
      const h = Math.ceil(fontSize * 1.25);
      const totalW = w + glowPad * 2;
      const totalH = h + glowPad * 2;

      // Size canvases
      for (const c of [canvas, glowCanvas]) {
        c.width = totalW * dpr;
        c.height = totalH * dpr;
        c.style.width = `${totalW}px`;
        c.style.height = `${totalH}px`;
      }
      ctx.scale(dpr, dpr);
      glowCtx.scale(dpr, dpr);

      // --- Offscreen: persistent rain canvas ---
      const rainCanvas = document.createElement("canvas");
      rainCanvas.width = totalW * dpr;
      rainCanvas.height = totalH * dpr;
      const rainCtx = rainCanvas.getContext("2d")!;
      rainCtx.scale(dpr, dpr);
      rainCtx.fillStyle = "#000";
      rainCtx.fillRect(0, 0, totalW, totalH);

      // --- Offscreen: text mask ---
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = totalW * dpr;
      maskCanvas.height = totalH * dpr;
      const maskCtx = maskCanvas.getContext("2d")!;
      maskCtx.scale(dpr, dpr);
      maskCtx.font = font;
      maskCtx.fillStyle = "#fff";
      maskCtx.textBaseline = "middle";
      maskCtx.textAlign = "center";
      maskCtx.fillText(text, totalW / 2, totalH / 2);

      // Rain state
      const cols = Math.ceil(totalW / RAIN_SIZE);
      const drops: number[] = Array.from(
        { length: cols },
        () => Math.random() * -20,
      );
      const speeds: number[] = Array.from(
        { length: cols },
        () => 0.08 + Math.random() * 0.08,
      );

      // --- Static glow (drawn once) ---
      glowCtx.font = font;
      glowCtx.textBaseline = "middle";
      glowCtx.textAlign = "center";
      for (const { blur, alpha } of [
        { blur: 100, alpha: 0.25 },
        { blur: 60, alpha: 0.35 },
        { blur: 35, alpha: 0.5 },
        { blur: 18, alpha: 0.6 },
        { blur: 8, alpha: 0.7 },
      ]) {
        glowCtx.shadowColor = `rgba(0, 255, 65, ${alpha})`;
        glowCtx.shadowBlur = blur;
        glowCtx.strokeStyle = `rgba(0, 255, 65, ${alpha * 0.4})`;
        glowCtx.lineWidth = 2;
        glowCtx.strokeText(text, totalW / 2, totalH / 2);
      }
      glowCtx.shadowBlur = 0;
      glowCtx.strokeStyle = "rgba(0, 255, 65, 0.5)";
      glowCtx.lineWidth = 1.5;
      glowCtx.strokeText(text, totalW / 2, totalH / 2);

      let animId = 0;

      const draw = () => {
        // 1. Update rain on offscreen canvas
        rainCtx.fillStyle = "rgba(0, 0, 0, 0.06)";
        rainCtx.fillRect(0, 0, totalW, totalH);

        for (let i = 0; i < cols; i++) {
          const char = CHARS[Math.floor(Math.random() * CHARS.length)];
          const x = i * RAIN_SIZE;
          const y = drops[i] * RAIN_SIZE;

          if (Math.random() > 0.88) {
            rainCtx.fillStyle = "#fff";
            rainCtx.font = `bold ${RAIN_SIZE}px monospace`;
          } else {
            const g = 160 + Math.floor(Math.random() * 95);
            rainCtx.fillStyle = `rgb(0, ${g}, ${Math.floor(g * 0.2)})`;
            rainCtx.font = `${RAIN_SIZE}px monospace`;
          }
          rainCtx.textBaseline = "top";
          rainCtx.textAlign = "left";
          rainCtx.fillText(char, x, y);

          drops[i] += speeds[i];
          if (y > totalH && Math.random() > 0.95) {
            drops[i] = Math.random() * -10;
            speeds[i] = 0.08 + Math.random() * 0.08;
          }
        }

        // 2. Compose: text mask → clip rain to text shape
        ctx.clearRect(0, 0, totalW, totalH);

        // Draw text mask
        ctx.drawImage(
          maskCanvas,
          0,
          0,
          totalW * dpr,
          totalH * dpr,
          0,
          0,
          totalW,
          totalH,
        );

        // Draw rain clipped to text
        ctx.globalCompositeOperation = "source-in";
        ctx.drawImage(
          rainCanvas,
          0,
          0,
          totalW * dpr,
          totalH * dpr,
          0,
          0,
          totalW,
          totalH,
        );

        ctx.globalCompositeOperation = "source-over";

        animId = requestAnimationFrame(draw);
      };

      draw();

      // Store cleanup ref
      canvas.dataset.animId = String(animId);
    });

    return () => {
      const id = Number(canvas.dataset.animId);
      if (id) cancelAnimationFrame(id);
    };
  }, [text, fontSize]);

  return (
    <div className={`relative inline-block ${className}`}>
      <canvas ref={glowRef} className="absolute inset-0 pointer-events-none" />
      <canvas ref={canvasRef} className="relative" />
    </div>
  );
}
