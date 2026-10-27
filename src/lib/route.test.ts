import { describe, expect, it } from 'vitest';
import { parsePath, pathOf, samePlace, slug, titleOf } from './route';

const names: Record<string, string> = { b1: 'MSc Computer Science', b2: 'Settings', b3: '' };
const nameOf = (id: string) => names[id];

describe("a board's name in its address", () => {
  it('is lower case words joined by dashes', () => {
    expect(slug('MSc Computer Science')).toBe('msc-computer-science');
    expect(slug('  Café: Q4 plans!! ')).toBe('cafe-q4-plans');
  });
  it('is never one of the words the address uses', () => {
    expect(slug('Settings')).toBe('settings-board');
    expect(slug('C')).toBe('c-board');
  });
  it('can be empty', () => expect(slug('★★★')).toBe(''));
});

describe('addresses', () => {
  it('for each place', () => {
    expect(pathOf({ name: 'home' }, null, nameOf)).toBe('/');
    expect(pathOf({ name: 'mycards' }, null, nameOf)).toBe('/my-cards');
    expect(pathOf({ name: 'settings' }, null, nameOf)).toBe('/account');
    expect(pathOf({ name: 'board', id: 'b1' }, null, nameOf)).toBe('/b/b1/msc-computer-science');
    expect(pathOf({ name: 'boardSettings', id: 'b1' }, null, nameOf)).toBe('/b/b1/msc-computer-science/settings');
    expect(pathOf({ name: 'board', id: 'b1' }, { board: 'b1', id: 'k1' }, nameOf)).toBe('/b/b1/msc-computer-science/c/k1');
    expect(pathOf({ name: 'board', id: 'b3' }, null, nameOf)).toBe('/b/b3');
  });
  it('read back to the same place', () => {
    for (const [screen, card] of [
      [{ name: 'home' }, null],
      [{ name: 'mycards' }, null],
      [{ name: 'settings' }, null],
      [{ name: 'board', id: 'b1' }, null],
      [{ name: 'board', id: 'b2' }, null],
      [{ name: 'boardSettings', id: 'b2' }, null],
      [{ name: 'board', id: 'b1' }, { board: 'b1', id: 'k1' }],
      [{ name: 'board', id: 'b3' }, { board: 'b3', id: 'k1' }],
    ] as const) {
      const p = pathOf(screen, card, nameOf);
      if (screen.name === 'home') expect(parsePath(p)).toBeNull();
      else expect(parsePath(p)).toEqual({ screen, card });
    }
  });
  it("for each of board settings' tabs, Look with no word of its own", () => {
    expect(pathOf({ name: 'boardSettings', id: 'b1', tab: 'look' }, null, nameOf)).toBe('/b/b1/msc-computer-science/settings');
    expect(pathOf({ name: 'boardSettings', id: 'b1', tab: 'people' }, null, nameOf)).toBe('/b/b1/msc-computer-science/settings/people');
    expect(parsePath('/b/b1/msc-computer-science/settings/fields')).toEqual({ screen: { name: 'boardSettings', id: 'b1', tab: 'fields' }, card: null });
    expect(parsePath('/b/b1/x/settings/nope')?.screen).toEqual({ name: 'board', id: 'b1' });
    expect(samePlace('/b/b1/x/settings', '/b/b1/x/settings/people')).toBe(true);
  });
  it('without the readable part, or with an old one', () => {
    expect(parsePath('/b/b1')).toEqual({ screen: { name: 'board', id: 'b1' }, card: null });
    expect(parsePath('/b/b1/an-old-name/c/k1')?.card).toEqual({ board: 'b1', id: 'k1' });
    expect(samePlace('/b/b1/an-old-name', '/b/b1/msc-computer-science')).toBe(true);
    expect(samePlace('/b/b1/x', '/b/b1/x/settings')).toBe(false);
  });
  it('nothing for addresses Boardo has no place for', () => {
    expect(parsePath('/')).toBeNull();
    expect(parsePath('/nope')).toBeNull();
    expect(parsePath('/b/bad id!')).toBeNull();
  });
});

describe('titles', () => {
  it('name the place', () => {
    expect(titleOf({ name: 'board', id: 'b1' }, undefined, nameOf)).toBe('MSc Computer Science · Boardo');
    expect(titleOf({ name: 'board', id: 'b1' }, 'M1: Number systems', nameOf)).toBe('M1: Number systems · Boardo');
    expect(titleOf({ name: 'mycards' }, undefined, nameOf)).toBe('My cards · Boardo');
    expect(titleOf({ name: 'home' }, undefined, nameOf)).toBe('Boards · Boardo');
  });
});
