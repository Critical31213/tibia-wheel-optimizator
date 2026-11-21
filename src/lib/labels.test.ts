import { describe, expect, it } from 'vitest';
import { clamp, cx, gemName, modifierKind, priorityLabel } from './labels';

describe('modifierKind', () => {
  it('classifies element modifiers', () => {
    expect(modifierKind(0)).toBe('immune');
    expect(modifierKind(80)).toBe('resistance');
    expect(modifierKind(100)).toBe('neutral');
    expect(modifierKind(115)).toBe('weakness');
  });
});

describe('priorityLabel', () => {
  it('names the slider ends and middle', () => {
    expect(priorityLabel(0)).toBe('Max DPS');
    expect(priorityLabel(50)).toBe('Balanced');
    expect(priorityLabel(100)).toBe('Max Survivability');
  });
});

describe('clamp / cx', () => {
  it('clamps and handles NaN', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(Number.NaN, 0, 3)).toBe(0);
  });
  it('joins truthy class names', () => {
    expect(cx('a', false, null, 'b', undefined)).toBe('a b');
  });
});

describe('gemName', () => {
  it('uses the planner gem names per vocation and quality', () => {
    expect(gemName('sorcerer', 'greater')).toBe('Greater Sage Gem');
    expect(gemName('druid', 'lesser')).toBe('Lesser Mystic Gem');
    expect(gemName('knight', 'regular')).toBe('Guardian Gem');
    expect(gemName('monk', 'greater')).toBe('Greater Spiritualist Gem');
    expect(gemName('paladin', 'lesser')).toBe('Lesser Marksman Gem');
  });
});

describe('snapPriority (D91)', () => {
  it('snaps to the five steps', async () => {
    const { snapPriority } = await import('./labels');
    expect([0, 10, 13, 37, 50, 62, 63, 90, 100, 150, NaN].map(snapPriority)).toEqual([0, 0, 25, 25, 50, 50, 75, 100, 100, 100, 50]);
  });
});
