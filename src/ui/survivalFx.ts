import { isSurvivalChallenge } from '../core/botMagic';
import type { BotMagicKind, GameEvent, GameState } from '../core/types';
import { el } from './dom';

/** Projects a world (x, z) onto viewport pixels; returns false when behind the camera. */
export type WorldProjector = (x: number, z: number, out: { x: number; y: number }) => boolean;

const MAX_ARROWS = 4;
const SCAN_RANGE = 26;
const EDGE_MARGIN_X = 54;
const EDGE_MARGIN_TOP = 150; // keep clear of the top HUD docks
const EDGE_MARGIN_BOTTOM = 130; // keep clear of the skill bar
const ONSCREEN_MARGIN = 28;
const LATERAL_DANGER = 3.2;

const ARROW_COLOR: Readonly<Record<BotMagicKind, string>> = {
  bolt: '#ff5a3c',
  fire_spread: '#ffa21a',
  frost_orb: '#5fe6ff',
  arcane_homing: '#c26bff',
};

interface Arrow {
  readonly node: HTMLElement;
  shown: boolean;
  color: string;
}

/**
 * Screen-space feedback for "Thử Thách Sinh Tồn": red hit flash, frost-slow tint, a low-heart
 * heartbeat edge, and edge arrows pointing at off-screen incoming fire / charging bots so the
 * challenge is hard but learnable. Purely cosmetic and pointer-transparent.
 */
export class SurvivalFx {
  private readonly rootEl: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly frost: HTMLElement;
  private readonly arrows: Arrow[] = [];
  private readonly player = { x: 0, y: 0 };
  private readonly probe = { x: 0, y: 0 };
  private hitTimer: ReturnType<typeof setTimeout> | null = null;
  private frostOn = false;
  private lowOn = false;

  constructor(parent: HTMLElement) {
    this.vignette = el('div', { className: 'survival-vignette' });
    this.frost = el('div', { className: 'survival-frost' });
    this.rootEl = el('div', { id: 'survival-fx', className: 'hidden' }, this.frost, this.vignette);
    for (let i = 0; i < MAX_ARROWS; i++) {
      const node = el('div', { className: 'survival-arrow hidden', text: '▲' });
      this.rootEl.appendChild(node);
      this.arrows.push({ node, shown: false, color: '' });
    }
    parent.appendChild(this.rootEl);
  }

  /** Per logic tick: frost tint & low-heart pulse. */
  syncState(state: GameState): void {
    const active = isSurvivalChallenge(state) && state.phase === 'playing';
    this.rootEl.classList.toggle('hidden', !active && !this.frostOn);
    const frost = active && (state.playerSlowTicks ?? 0) > 0;
    if (frost !== this.frostOn) {
      this.frostOn = frost;
      this.frost.classList.toggle('on', frost);
    }
    const low = active && state.hearts > 0 && state.hearts <= 2;
    if (low !== this.lowOn) {
      this.lowOn = low;
      this.vignette.classList.toggle('low', low);
    }
    if (!active) this.hideArrows(0);
  }

  onEvent(event: GameEvent): void {
    if (event.kind !== 'player_hit_by_magic') return;
    this.rootEl.classList.remove('hidden');
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth; // restart the CSS animation on rapid hits
    this.vignette.classList.add('hit');
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => {
      this.vignette.classList.remove('hit');
      this.hitTimer = null;
    }, 520);
  }

  /** Per frame: point edge arrows at incoming off-screen threats. Allocation-free except tiny string compares. */
  updateThreats(state: GameState, project: WorldProjector): void {
    if (!isSurvivalChallenge(state) || state.phase !== 'playing') return;
    const head = state.snake[0];
    if (!head || state.butterflyAltitude > 0.4) {
      this.hideArrows(0);
      return;
    }
    if (!project(head.x, head.z, this.player)) {
      this.hideArrows(0);
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    let used = 0;

    for (const p of state.hostileProjectiles) {
      if (used >= MAX_ARROWS) break;
      const rx = head.x - p.x;
      const rz = head.z - p.z;
      const dist = Math.hypot(rx, rz);
      if (dist > SCAN_RANGE || dist < 1) continue;
      const vlen = Math.hypot(p.dx, p.dz) || 1;
      const ux = p.dx / vlen;
      const uz = p.dz / vlen;
      const along = rx * ux + rz * uz;
      if (along <= 0) continue; // flying away
      const lateral = Math.abs(rx * uz - rz * ux);
      if (lateral > LATERAL_DANGER) continue; // will miss
      used = this.placeArrow(used, p.x, p.z, p.kind, project, w, h, 1 - dist / SCAN_RANGE);
    }

    for (const bot of state.bots) {
      if (used >= MAX_ARROWS) break;
      if ((bot.magicWarningTicks ?? 0) <= 0) continue;
      const dist = Math.hypot(head.x - bot.head.x, head.z - bot.head.z);
      if (dist > SCAN_RANGE + 6) continue;
      used = this.placeArrow(
        used,
        bot.head.x,
        bot.head.z,
        bot.magicSpell ?? 'bolt',
        project,
        w,
        h,
        0.9,
      );
    }
    this.hideArrows(used);
  }

  private placeArrow(
    index: number,
    wx: number,
    wz: number,
    kind: BotMagicKind,
    project: WorldProjector,
    w: number,
    h: number,
    urgency: number,
  ): number {
    if (!project(wx, wz, this.probe)) return index;
    const px = this.probe.x;
    const py = this.probe.y;
    const onScreen =
      px > ONSCREEN_MARGIN &&
      px < w - ONSCREEN_MARGIN &&
      py > ONSCREEN_MARGIN &&
      py < h - ONSCREEN_MARGIN;
    if (onScreen) return index; // the 3D telegraph/projectile is already visible
    const arrow = this.arrows[index];
    if (!arrow) return index;
    const cx = w / 2;
    const cy = h / 2;
    const dx = px - cx;
    const dy = py - cy;
    const tx = (w / 2 - EDGE_MARGIN_X) / Math.max(Math.abs(dx), 1e-3);
    const edgeY = dy < 0 ? h / 2 - EDGE_MARGIN_TOP : h / 2 - EDGE_MARGIN_BOTTOM;
    const ty = edgeY / Math.max(Math.abs(dy), 1e-3);
    const t = Math.min(tx, ty);
    const ax = cx + dx * t;
    const ay = cy + dy * t;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    const style = arrow.node.style;
    style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) translate(-50%, -50%) rotate(${angle.toFixed(3)}rad) scale(${(0.8 + urgency * 0.6).toFixed(2)})`;
    const color = ARROW_COLOR[kind];
    if (arrow.color !== color) {
      arrow.color = color;
      style.color = color;
    }
    if (!arrow.shown) {
      arrow.shown = true;
      arrow.node.classList.remove('hidden');
    }
    return index + 1;
  }

  private hideArrows(from: number): void {
    for (let i = from; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      if (arrow && arrow.shown) {
        arrow.shown = false;
        arrow.node.classList.add('hidden');
      }
    }
  }

  dispose(): void {
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.rootEl.remove();
  }
}
