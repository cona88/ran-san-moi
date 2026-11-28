import { CASTLE_ROYAL_SETS } from '../core';
import type {
  CastleCosmeticSlot,
  CastleInteriorZone,
  GameState,
  RoyalWardrobeState,
  ShelterKind,
} from '../core/types';
import { el } from './dom';
import type { GameUICallbacks } from './types';

interface SlotCardRefs {
  readonly slot: CastleCosmeticSlot;
  readonly cardEl: HTMLElement;
  readonly prevBtn: HTMLButtonElement;
  readonly nextBtn: HTMLButtonElement;
  readonly emojiEl: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly originEl: HTMLElement;
  readonly equipBtn: HTMLButtonElement;
  selectedKind: ShelterKind | null;
}

const SLOT_META: Readonly<
  Record<
    CastleCosmeticSlot,
    {
      readonly headerVi: string;
      readonly defaultEmoji: string;
      readonly defaultNameVi: string;
    }
  >
> = {
  outfit: {
    headerVi: '👗 Bộ Trang Phục',
    defaultEmoji: '🐍',
    defaultNameVi: 'Trang Phục Mặc Định',
  },
  makeup: {
    headerVi: '💄 Trang Điểm & Vương Miện',
    defaultEmoji: '✨',
    defaultNameVi: 'Vẻ Đẹp Tự Nhiên Mặc Định',
  },
  weapon: {
    headerVi: '⚔️ Vũ Khí Đặc Trưng',
    defaultEmoji: '🌟',
    defaultNameVi: 'Tay Phép Mặc Định',
  },
};

function zonePromptVi(zone: CastleInteriorZone | null): string {
  switch (zone) {
    case 'vanity':
      return '🪞 Gương Hoàng Gia • Ngắm trang phục lung linh!';
    case 'throne':
      return '👑 Ngai Vàng Hoàng Gia!';
    case 'banquet':
      return '🍰 Bàn Đại Tiệc Hoàng Gia!';
    case 'outfit':
      return '👗 Bục Lễ Phục Hoàng Gia • Chạm để mặc thử ngay!';
    case 'makeup':
      return '💄 Bục Trang Điểm & Vương Miện • Tỏa sáng kiêu sa!';
    case 'weapon':
      return '⚔️ Bục Vũ Khí Đặc Trưng • Nhận bảo vật phép thuật!';
    case 'exit':
      return '🚪 Cổng Ánh Sáng • Bước qua hoặc bấm R / ○ để ra Vương Quốc!';
    default:
      return '✨ Chạm bục trưng bày hoặc chọn bên dưới để mặc thử!';
  }
}

function equippedForSlot(
  wardrobe: RoyalWardrobeState,
  slot: CastleCosmeticSlot,
): ShelterKind | null {
  switch (slot) {
    case 'outfit':
      return wardrobe.equippedOutfit;
    case 'makeup':
      return wardrobe.equippedMakeup;
    case 'weapon':
      return wardrobe.equippedWeapon;
  }
}

function itemVisualForSlot(
  slot: CastleCosmeticSlot,
  kind: ShelterKind | null,
): { readonly emoji: string; readonly nameVi: string; readonly originVi: string } {
  if (kind === null) {
    const def = SLOT_META[slot];
    return {
      emoji: def.defaultEmoji,
      nameVi: def.defaultNameVi,
      originVi: 'Phong cách Rắn Tiên nguyên bản',
    };
  }
  const set = CASTLE_ROYAL_SETS[kind];
  switch (slot) {
    case 'outfit':
      return {
        emoji: set.outfitEmoji,
        nameVi: set.outfitNameVi,
        originVi: set.themeTitleVi,
      };
    case 'makeup':
      return {
        emoji: set.makeupEmoji,
        nameVi: set.makeupNameVi,
        originVi: set.themeTitleVi,
      };
    case 'weapon':
      return {
        emoji: set.weaponEmoji,
        nameVi: set.weaponNameVi,
        originVi: set.themeTitleVi,
      };
  }
}

function hexToCss(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Outer-world `#enter-castle-btn` (shown when safe inside a shelter) and
 * luxury `#castle-interior-hud` (Top Palace Header + 3-slot Royal Boutique Wardrobe Bar).
 */
export class CastleInteriorUI {
  private readonly enterBtnEl: HTMLButtonElement;
  private readonly enterEmojiEl: HTMLElement;

  private readonly hudRootEl: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly collectorBadgeEl: HTMLElement;
  private readonly exitBtnEl: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly zonePromptEl: HTMLElement;
  private readonly boutiqueBarEl: HTMLElement;
  private readonly slotCards: readonly SlotCardRefs[];

  private lastEnterKey = '';
  private lastInteriorKey = '';
  private activeShelterId: string | null = null;
  private browsableOptions: readonly (ShelterKind | null)[] = ['castle', null];

  constructor(
    parent: HTMLElement,
    private readonly callbacks: GameUICallbacks,
  ) {
    // 1. Outer-world Enter-Castle Button (#enter-castle-btn)
    this.enterEmojiEl = el('span', { className: 'enter-castle-emoji', text: '🏰' });
    const enterTextWrap = el(
      'span',
      { className: 'enter-castle-text' },
      el('span', { className: 'enter-castle-label', text: 'VÀO LÂU ĐÀI' }),
      el('span', { className: 'enter-castle-hint', text: 'Phím R • L1+Pad' }),
    );
    this.enterBtnEl = el(
      'button',
      {
        id: 'enter-castle-btn',
        className: 'enter-castle-btn hidden',
        type: 'button',
        title: 'Bước vào khám phá Nội Thất Lâu Đài & Tủ Đồ Hoàng Gia (Phím R hoặc L1+Touchpad)',
        ariaLabel: 'Vào khám phá Nội Thất Lâu Đài',
      },
      this.enterEmojiEl,
      enterTextWrap,
    );
    this.enterBtnEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.callbacks.onEnterCastle?.();
    });
    parent.appendChild(this.enterBtnEl);

    // 2. Palace Interior HUD (#castle-interior-hud)
    this.collectorBadgeEl = el('span', {
      className: 'castle-collector-badge',
      text: '🏛️ Đã thăm 1/11 Lâu Đài',
    });
    this.exitBtnEl = el('button', {
      id: 'exit-castle-btn',
      className: 'exit-castle-btn',
      type: 'button',
      text: '🚪 RA VƯƠNG QUỐC (R / ○)',
      title: 'Rời đại sảnh lâu đài quay ra Vương Quốc (Phím R hoặc nút ○)',
      ariaLabel: 'Rời lâu đài quay ra Vương Quốc',
    });
    this.exitBtnEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.callbacks.onExitCastle?.();
    });

    const topRow = el(
      'div',
      { className: 'castle-header-top-row' },
      this.collectorBadgeEl,
      this.exitBtnEl,
    );
    this.titleEl = el('div', { className: 'castle-header-title', text: '' });
    this.subtitleEl = el('div', { className: 'castle-header-subtitle', text: '' });
    this.zonePromptEl = el('div', { className: 'castle-zone-prompt', text: '' });

    this.headerEl = el(
      'div',
      { id: 'castle-interior-header', className: 'castle-interior-header' },
      topRow,
      this.titleEl,
      this.subtitleEl,
      this.zonePromptEl,
    );

    const slots: readonly CastleCosmeticSlot[] = ['outfit', 'makeup', 'weapon'];
    this.slotCards = slots.map((slot) => this.buildSlotCard(slot));
    this.boutiqueBarEl = el(
      'div',
      { id: 'castle-boutique-bar', className: 'castle-boutique-bar' },
      ...this.slotCards.map((c) => c.cardEl),
    );

    this.hudRootEl = el(
      'section',
      {
        id: 'castle-interior-hud',
        className: 'castle-interior-hud hidden',
        ariaLabel: 'Đại Sảnh Nội Thất Lâu Đài & Tủ Đồ Hoàng Gia',
      },
      this.headerEl,
      this.boutiqueBarEl,
    );
    parent.appendChild(this.hudRootEl);
  }

  syncState(state: GameState): void {
    const interior = state.castleInterior ?? null;
    const canShowEnter =
      state.phase === 'playing' &&
      interior === null &&
      state.inShelter &&
      state.currentShelterId !== null;

    const enterKey = `${canShowEnter ? 1 : 0}|${state.currentShelterId ?? ''}`;
    if (enterKey !== this.lastEnterKey) {
      this.lastEnterKey = enterKey;
      this.enterBtnEl.classList.toggle('hidden', !canShowEnter);
      if (canShowEnter) {
        const shelter = state.shelters.find((s) => s.id === state.currentShelterId);
        const set = shelter ? CASTLE_ROYAL_SETS[shelter.kind] : null;
        this.enterEmojiEl.textContent = set ? set.outfitEmoji : '🏰';
      }
    }

    const showInterior = state.phase === 'playing' && interior !== null;
    if (!showInterior || !interior) {
      this.activeShelterId = null;
      if (this.lastInteriorKey !== 'hidden') {
        this.lastInteriorKey = 'hidden';
        this.hudRootEl.classList.add('hidden');
      }
      return;
    }

    const wardrobe = state.wardrobe;
    const unlockedKey = wardrobe.unlockedKinds.join(',');
    const visitedCount = wardrobe.visitedInteriorIds.length;
    const totalShelters = state.shelters.length || 11;

    // When entering a palace, focus all 3 boutique cards on this palace's signature Royal Set.
    if (this.activeShelterId !== interior.shelterId) {
      this.activeShelterId = interior.shelterId;
      for (const card of this.slotCards) {
        card.selectedKind = interior.shelterKind;
      }
      this.lastInteriorKey = '';
    }

    const interiorKey = [
      interior.shelterId,
      interior.shelterKind,
      interior.nearZone ?? 'none',
      visitedCount,
      totalShelters,
      unlockedKey,
      wardrobe.equippedOutfit ?? 'null',
      wardrobe.equippedMakeup ?? 'null',
      wardrobe.equippedWeapon ?? 'null',
      ...this.slotCards.map((c) => c.selectedKind ?? 'null'),
    ].join('|');

    if (interiorKey === this.lastInteriorKey) return;
    this.lastInteriorKey = interiorKey;

    this.hudRootEl.classList.remove('hidden');
    this.hudRootEl.style.setProperty('--palace-accent', hexToCss(interior.accentHex));

    const royalSet = CASTLE_ROYAL_SETS[interior.shelterKind];
    this.titleEl.textContent = interior.shelterNameVi || royalSet.themeTitleVi;
    this.subtitleEl.textContent = royalSet.interiorSubtitleVi;
    this.zonePromptEl.textContent = zonePromptVi(interior.nearZone);
    this.collectorBadgeEl.textContent = `🏛️ Đã thăm ${visitedCount}/${totalShelters} Lâu Đài`;

    const kinds: ShelterKind[] = [interior.shelterKind];
    for (const k of wardrobe.unlockedKinds) {
      if (!kinds.includes(k)) kinds.push(k);
    }
    this.browsableOptions = [...kinds, null];

    this.renderBoutiqueCards(wardrobe);
  }

  dispose(): void {
    this.enterBtnEl.remove();
    this.hudRootEl.remove();
  }

  private buildSlotCard(slot: CastleCosmeticSlot): SlotCardRefs {
    const meta = SLOT_META[slot];
    const slotLabel = el('span', { className: 'boutique-slot-label', text: meta.headerVi });

    const prevBtn = el('button', {
      className: 'boutique-cycle-btn prev',
      type: 'button',
      text: '‹',
      title: 'Xem bộ trước',
      ariaLabel: `${meta.headerVi} trước`,
    });
    const nextBtn = el('button', {
      className: 'boutique-cycle-btn next',
      type: 'button',
      text: '›',
      title: 'Xem bộ tiếp theo',
      ariaLabel: `${meta.headerVi} tiếp theo`,
    });
    const cycleGroup = el('div', { className: 'boutique-cycle-group' }, prevBtn, nextBtn);
    const headRow = el('div', { className: 'boutique-card-head' }, slotLabel, cycleGroup);

    const emojiEl = el('div', { className: 'boutique-item-emoji', text: meta.defaultEmoji });
    const nameEl = el('div', { className: 'boutique-item-name', text: meta.defaultNameVi });
    const originEl = el('div', { className: 'boutique-item-origin', text: '' });
    const infoCol = el('div', { className: 'boutique-item-info' }, nameEl, originEl);
    const itemRow = el('div', { className: 'boutique-item-row' }, emojiEl, infoCol);

    const equipBtn = el('button', {
      className: 'boutique-equip-btn',
      type: 'button',
      text: '✨ Mặc Ngay',
    });

    const cardEl = el('div', { className: 'boutique-card' }, headRow, itemRow, equipBtn);
    cardEl.dataset['slot'] = slot;

    const refs: SlotCardRefs = {
      slot,
      cardEl,
      prevBtn,
      nextBtn,
      emojiEl,
      nameEl,
      originEl,
      equipBtn,
      selectedKind: 'castle',
    };

    prevBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.cycleSlot(refs, -1);
    });
    nextBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.cycleSlot(refs, 1);
    });
    equipBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.callbacks.onEquipCastleItem?.(slot, refs.selectedKind);
    });

    return refs;
  }

  private cycleSlot(refs: SlotCardRefs, delta: -1 | 1): void {
    const opts = this.browsableOptions;
    if (opts.length <= 1) return;
    const idx = opts.indexOf(refs.selectedKind);
    const safeIdx = idx >= 0 ? idx : 0;
    const nextIdx = (safeIdx + delta + opts.length) % opts.length;
    refs.selectedKind = opts[nextIdx] ?? null;
    this.lastInteriorKey = '';
    this.callbacks.onEquipCastleItem?.(refs.slot, refs.selectedKind);
  }

  private renderBoutiqueCards(wardrobe: RoyalWardrobeState): void {
    const canCycle = this.browsableOptions.length > 1;
    for (const refs of this.slotCards) {
      if (!this.browsableOptions.includes(refs.selectedKind)) {
        refs.selectedKind = this.browsableOptions[0] ?? null;
      }
      const visual = itemVisualForSlot(refs.slot, refs.selectedKind);
      const equippedKind = equippedForSlot(wardrobe, refs.slot);
      const isEquipped = equippedKind === refs.selectedKind;

      refs.emojiEl.textContent = visual.emoji;
      refs.nameEl.textContent = visual.nameVi;
      refs.nameEl.title = visual.nameVi;
      refs.originEl.textContent = visual.originVi;
      refs.prevBtn.disabled = !canCycle;
      refs.nextBtn.disabled = !canCycle;

      refs.cardEl.classList.toggle('is-equipped', isEquipped && refs.selectedKind !== null);
      refs.equipBtn.classList.toggle('is-equipped', isEquipped);
      refs.equipBtn.textContent = isEquipped ? '💖 Đang Mặc ✨' : '✨ Mặc Ngay';
    }
  }
}
