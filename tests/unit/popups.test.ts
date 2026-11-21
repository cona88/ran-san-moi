// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/core';
import type { GameEvent } from '../../src/core/types';
import { GameUI, type GameUICallbacks } from '../../src/ui';
import { ScorePopups } from '../../src/ui/popups';

let root: HTMLElement;
let popups: ScorePopups;

function makeNoopUiCallbacks(): GameUICallbacks {
  return {
    onStartGame: () => {},
    onResumeGame: () => {},
    onRestartGame: () => {},
    onTogglePause: () => {},
    onSelectForm: () => {},
    onActivateBooster: () => {},
    onSelectTheme: () => {},
    onToggleSound: () => {},
    onToggleMusic: () => {},
    onToggleVibration: () => {},
    onConnectWebHid: async () => false,
    onSelectAgeProfile: () => {},
    onCastFairySkill: () => {},
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  popups = new ScorePopups(root);
});

afterEach(() => {
  popups.dispose();
});

describe('ScorePopups', () => {
  it('mounts a popup layer into the root', () => {
    expect(root.querySelector('#popups')).not.toBeNull();
  });

  it('spawns a "+1" popup at the given viewport position', () => {
    popups.spawn(120, 340);
    const node = root.querySelector<HTMLElement>('.score-popup');
    expect(node).not.toBeNull();
    expect(node!.textContent).toBe('+1');
    expect(node!.style.left).toBe('120px');
    expect(node!.style.top).toBe('340px');
  });

  it('removes the popup when its animation ends', () => {
    popups.spawn(0, 0);
    const node = root.querySelector<HTMLElement>('.score-popup')!;
    node.dispatchEvent(new Event('animationend'));
    expect(root.querySelector('.score-popup')).toBeNull();
  });

  it('supports several popups in flight at once', () => {
    popups.spawn(1, 1);
    popups.spawn(2, 2);
    expect(root.querySelectorAll('.score-popup')).toHaveLength(2);
  });

  it('spawns a chomp popup with score-popup chomp-popup classes, styling, and content', () => {
    popups.spawnChomp(420, 300, 'Ngoạm! +15', '#ffe24b', 3);
    const node = root.querySelector<HTMLElement>('#popups .chomp-popup');
    expect(node).not.toBeNull();
    expect(node!.className).toBe('score-popup chomp-popup');
    expect(node!.textContent).toBe('Ngoạm! +15');
    expect(node!.style.pointerEvents).toBe('none');
    expect(node!.style.getPropertyValue('--chomp-tilt')).not.toBe('');
    expect(node!.style.getPropertyValue('--chomp-glow')).toBe('#ffe24b');
    expect(parseFloat(node!.style.fontSize)).toBeGreaterThanOrEqual(21);

    node!.dispatchEvent(new Event('animationend'));
    expect(root.querySelector('#popups .chomp-popup')).toBeNull();
  });

  it('caps concurrent .chomp-popup nodes at 10 while keeping oldest evicted', () => {
    popups.spawn(50, 50, '+10');

    for (let i = 1; i <= 13; i++) {
      popups.spawnChomp(200, 200, `Cắn #${i}`, '#ff7ae0', i);
    }

    const chompNodes = [...root.querySelectorAll<HTMLElement>('#popups .chomp-popup')];
    expect(chompNodes).toHaveLength(10);
    expect(chompNodes[0]!.textContent).toBe('Cắn #4');
    expect(chompNodes[9]!.textContent).toBe('Cắn #13');
    expect(root.querySelectorAll('#popups .score-popup')).toHaveLength(11);
  });
});

describe('GameUI bot_chomp popups', () => {
  it('renders Vietnamese chomp feedback across streak tiers and ignores null screenPos', () => {
    const uiRoot = document.createElement('div');
    document.body.appendChild(uiRoot);
    const ui = new GameUI(uiRoot, makeNoopUiCallbacks(), {
      mode: 'adventure',
      difficulty: 'normal',
      theme: 'honeycomb_arena',
      sound: true,
      music: true,
      vibration: true,
      ageProfile: 'age6' as const,
    });

    try {
      const baseState = createInitialState({ seed: 7 });
      const cases: readonly { streak: number; points: number; expected: RegExp }[] = [
        { streak: 1, points: 15, expected: /^Ngoạm! \+15$/ },
        { streak: 3, points: 21, expected: /^Măm măm! x3/ },
        { streak: 5, points: 27, expected: /^Rốp rốp! x5/ },
        { streak: 8, points: 36, expected: /^ĐẠI TIỆC x8!/ },
      ];

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i]!;
        const event: GameEvent = {
          id: i + 1,
          kind: 'bot_chomp',
          cell: { x: 2, z: 0 },
          form: 'dragon',
          points: c.points,
          chompStreak: c.streak,
        };
        ui.onEvent(event, { ...baseState, chompStreak: c.streak }, { x: 640, y: 400 });
      }

      ui.onEvent(
        { id: 99, kind: 'bot_chomp', cell: { x: 2, z: 0 }, points: 12, chompStreak: 2 },
        baseState,
        null,
      );

      const chompNodes = [...uiRoot.querySelectorAll<HTMLElement>('#popups .chomp-popup')];
      expect(chompNodes).toHaveLength(4);
      expect(chompNodes[0]!.textContent).toMatch(cases[0]!.expected);
      expect(chompNodes[1]!.textContent).toMatch(cases[1]!.expected);
      expect(chompNodes[2]!.textContent).toMatch(cases[2]!.expected);
      expect(chompNodes[3]!.textContent).toMatch(cases[3]!.expected);
    } finally {
      ui.dispose();
    }
  });
});
