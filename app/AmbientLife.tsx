"use client";

import { useEffect } from "react";

/**
 * Ambient life layer — mounts fixed, pointer-events:none overlays that add
 * motion without touching page layout:
 *   • cursor-follow spotlight (radial glow tracking the mouse)
 *   • drifting particle specks (cyan + violet)
 *   • occasional sonar pulses radiating from random points on the grid
 *
 * All effects respect `prefers-reduced-motion`.
 */
export default function AmbientLife() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── Cursor spotlight ────────────────────────────────────────────
    const spot = document.createElement("div");
    spot.className = "ambient-spotlight";
    spot.setAttribute("aria-hidden", "true");
    document.body.appendChild(spot);
    let raf = 0;
    let pending: { x: number; y: number } | null = null;
    const move = (e: MouseEvent) => {
      pending = { x: e.clientX, y: e.clientY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        if (pending) {
          spot.style.transform = `translate3d(${pending.x - 260}px, ${pending.y - 260}px, 0)`;
        }
        raf = 0;
      });
    };
    if (!reduced) window.addEventListener("pointermove", move);

    // ── Drifting particles ──────────────────────────────────────────
    const particles = document.createElement("div");
    particles.className = "ambient-particles";
    particles.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 22; i += 1) {
      const p = document.createElement("span");
      const violet = i % 3 !== 0;
      const size = 1 + Math.random() * 2;
      const dur = 22 + Math.random() * 26;
      const delay = -Math.random() * dur;
      const left = Math.random() * 100;
      const drift = -30 + Math.random() * 60;
      p.style.setProperty("--drift", `${drift}px`);
      p.style.animationDuration = `${dur}s`;
      p.style.animationDelay = `${delay}s`;
      p.style.left = `${left}%`;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.background = violet ? "#c084fc" : "#22d3ee";
      p.style.boxShadow = `0 0 ${8 + size * 4}px ${violet ? "#c084fc" : "#22d3ee"}`;
      particles.appendChild(p);
    }
    if (!reduced) document.body.appendChild(particles);

    // ── Sonar pulses on the grid ────────────────────────────────────
    let pulseTimer = 0;
    const firePulse = () => {
      const p = document.createElement("div");
      p.className = "ambient-pulse";
      p.setAttribute("aria-hidden", "true");
      // Avoid the extreme edges so it's always partly visible.
      p.style.left = `${10 + Math.random() * 80}%`;
      p.style.top = `${15 + Math.random() * 65}%`;
      p.style.setProperty("--pulse-hue", Math.random() < 0.5 ? "192, 132, 252" : "34, 211, 238");
      document.body.appendChild(p);
      window.setTimeout(() => p.remove(), 2600);
      pulseTimer = window.setTimeout(firePulse, 5500 + Math.random() * 4500);
    };
    if (!reduced) pulseTimer = window.setTimeout(firePulse, 2500);

    return () => {
      window.removeEventListener("pointermove", move);
      window.clearTimeout(pulseTimer);
      if (raf) cancelAnimationFrame(raf);
      spot.remove();
      particles.remove();
      document.querySelectorAll(".ambient-pulse").forEach((el) => el.remove());
    };
  }, []);

  return null;
}
