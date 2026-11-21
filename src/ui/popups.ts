import { el } from './dom';

/** Belt-and-braces removal for when CSS animations are disabled (reduced motion). */
const FALLBACK_REMOVE_MS = 1400;
/** Faster fallback cleanup for 700ms rapid-fire chomp popups. */
const CHOMP_FALLBACK_REMOVE_MS = 850;
/** Cleanup timeout for 1120ms celebration popups. */
const CELEBRATE_FALLBACK_REMOVE_MS = 1350;
/** Cap concurrent chomp popups so rapid segment eating stays 60fps. */
const MAX_CHOMP_POPUPS = 10;
/** Cap concurrent celebration popups so bursty AoE/quest combos stay crisp. */
const MAX_CELEBRATE_POPUPS = 8;
/** Cap concurrent frost popups so continuous falling ice stays clean. */
const MAX_FROST_POPUPS = 2;
/** Cleanup timeout for frost popups. */
const FROST_FALLBACK_REMOVE_MS = 1000;
const BASE_CHOMP_FONT_PX = 21;

/**
 * Floating score & event popups ("+10", "Băng Giá!", "Ngoạm! +15") anchored
 * to viewport pixel positions. Each popup animates and removes itself automatically.
 */
export class ScorePopups {
  private readonly layer: HTMLElement;
  private readonly timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(root: HTMLElement) {
    this.layer = el('div', { id: 'popups' });
    root.appendChild(this.layer);
  }

  spawn(x: number, y: number, label = '+1', color?: string): void {
    const node = el('div', { className: 'score-popup', text: label });
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.pointerEvents = 'none';
    if (color) {
      node.style.color = color;
      node.style.textShadow = `0 2px 12px ${color}, 0 0 18px rgba(255, 255, 255, 0.72)`;
    }
    this.mountWithAutoRemove(node, FALLBACK_REMOVE_MS);
  }

  /**
   * Spawn a punchy celebration popup for milestones (level up, butterfly, thunder,
   * AoE blasts, quests, and boosters) with smooth scale-pop keyframes.
   */
  spawnCelebration(x: number, y: number, label: string, color = '#ffd447'): void {
    const active = this.layer.querySelectorAll<HTMLElement>('.celebrate-popup');
    const excess = active.length - (MAX_CELEBRATE_POPUPS - 1);
    for (let i = 0; i < excess; i++) {
      const oldest = active[i];
      if (oldest) this.removeNode(oldest);
    }

    const node = el('div', { className: 'score-popup celebrate-popup', text: label });
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
    node.style.color = color;
    node.style.pointerEvents = 'none';
    node.style.setProperty('--popup-glow', color);
    this.mountWithAutoRemove(node, CELEBRATE_FALLBACK_REMOVE_MS);
  }

  /**
   * Spawn a delicate icy-pink crystal frost popup capped so falling ice never floods the screen.
   */
  spawnFrost(x: number, y: number, label = '❄️ Băng Giá!'): void {
    const activeFrost = this.layer.querySelectorAll<HTMLElement>('.frost-popup');
    const excess = activeFrost.length - (MAX_FROST_POPUPS - 1);
    for (let i = 0; i < excess; i++) {
      const oldest = activeFrost[i];
      if (oldest) this.removeNode(oldest);
    }

    const node = el('div', { className: 'score-popup frost-popup', text: label });
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
    node.style.color = '#7ef8ff';
    node.style.pointerEvents = 'none';
    node.style.setProperty('--popup-glow', '#ff8fd8');
    this.mountWithAutoRemove(node, FROST_FALLBACK_REMOVE_MS);
  }

  /**
   * Spawn a punchy comic-style chomp popup capped at 10 concurrent nodes,
   * with deterministic scatter/tilt and subtle font scaling by streak.
   */
  spawnChomp(x: number, y: number, label: string, color: string, streak: number): void {
    const activeChomps = this.layer.querySelectorAll<HTMLElement>('.chomp-popup');
    const excess = activeChomps.length - (MAX_CHOMP_POPUPS - 1);
    for (let i = 0; i < excess; i++) {
      const oldest = activeChomps[i];
      if (oldest) this.removeNode(oldest);
    }

    const safeStreak = Math.max(1, Math.round(streak));
    const sign = safeStreak % 2 === 0 ? 1 : -1;
    const scatterX = sign * (6 + ((safeStreak * 5) % 9));
    const scatterY = Math.round(Math.cos(safeStreak * 1.7) * 10) - 4;
    const tiltDeg = sign * (2 + (safeStreak % 5));
    const fontScale = Math.min(1.32, Math.max(1, 0.98 + Math.min(8, safeStreak) * 0.042));

    const node = el('div', { className: 'score-popup chomp-popup', text: label });
    node.style.left = `${Math.round(x + scatterX)}px`;
    node.style.top = `${Math.round(y + scatterY)}px`;
    node.style.color = color;
    node.style.fontSize = `${(BASE_CHOMP_FONT_PX * fontScale).toFixed(1)}px`;
    node.style.pointerEvents = 'none';
    node.style.setProperty('--chomp-tilt', `${tiltDeg}deg`);
    node.style.setProperty('--chomp-glow', color);

    this.mountWithAutoRemove(node, CHOMP_FALLBACK_REMOVE_MS);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.layer.remove();
  }

  private mountWithAutoRemove(node: HTMLElement, fallbackMs: number): void {
    const timer = setTimeout(() => this.removeNode(node), fallbackMs);
    this.timers.set(node, timer);
    node.addEventListener('animationend', () => this.removeNode(node), { once: true });
    this.layer.appendChild(node);
  }

  private removeNode(node: HTMLElement): void {
    const timer = this.timers.get(node);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(node);
    }
    node.remove();
  }
}
