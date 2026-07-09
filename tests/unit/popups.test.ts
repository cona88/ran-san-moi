// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ScorePopups } from '../../src/ui/popups';

let root: HTMLElement;
let popups: ScorePopups;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  popups = new ScorePopups(root);
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
});
