import { describe, expect, it } from 'vitest';

import { managerSk, userCompSk, userPk } from 'core/keys';

import { isPriorCopy, planRename } from '../../scripts/maintenance/lib/renamePlan.mjs';

const source = [
  { PK: 'COMP#old', SK: 'META', compId: 'old', name: 'Cup' },
  {
    PK: 'COMP#old',
    SK: 'ATHLETE#a1',
    compId: 'old',
    photoKey: 'photos/old/abc.jpg',
  },
  { PK: 'COMP#old', SK: 'ATHLETE#a2', compId: 'old', photoKey: 'photos/other/x.jpg' },
  { PK: 'COMP#old', SK: managerSk('sub-1'), compId: 'old', sub: 'sub-1', email: 'm@x' },
];

describe('planRename', () => {
  it('re-keys every partition item and moves only photos under the old prefix', () => {
    const plan = planRename(source, 'old', 'new');

    expect(plan.newItems.every((i) => i.PK === 'COMP#new' && i.compId === 'new')).toBe(true);
    expect(plan.newItems.map((i) => i.SK)).toEqual(source.map((i) => i.SK));
    expect(plan.photoMoves).toEqual([
      { oldKey: 'photos/old/abc.jpg', newKey: 'photos/new/abc.jpg' },
    ]);
    expect(plan.foreignPhotos).toBe(1);
    expect(plan.newItems[1].photoKey).toBe('photos/new/abc.jpg');
    expect(plan.newItems[2].photoKey).toBe('photos/other/x.jpg');
  });

  it('keeps photoKey on the old prefix under skipPhotos', () => {
    const plan = planRename(source, 'old', 'new', { skipPhotos: true });

    expect(plan.newItems[1].photoKey).toBe('photos/old/abc.jpg');
  });

  it('moves each manager reverse grant to the new compId', () => {
    const plan = planRename(source, 'old', 'new');

    expect(plan.reverseGrants).toEqual([
      {
        put: { PK: userPk('sub-1'), SK: userCompSk('new'), compId: 'new', sub: 'sub-1' },
        oldKey: { PK: userPk('sub-1'), SK: userCompSk('old') },
      },
    ]);
  });

  it('derives the sub from the SK when a forward grant lacks the attribute', () => {
    const plan = planRename(
      [{ PK: 'COMP#old', SK: managerSk('sub-2'), compId: 'old' }],
      'old',
      'new',
    );

    expect(plan.reverseGrants[0].put.sub).toBe('sub-2');
  });
});

describe('isPriorCopy', () => {
  const { newItems } = planRename(source, 'old', 'new');

  it('accepts a full or partial copy of the same rename, in any key order', () => {
    const reordered = Object.fromEntries(Object.entries(newItems[0]).reverse());

    expect(isPriorCopy(newItems, newItems)).toBe(true);
    expect(isPriorCopy([reordered], newItems)).toBe(true);
  });

  it('refuses a target holding another competition', () => {
    expect(
      isPriorCopy([{ PK: 'COMP#new', SK: 'META', compId: 'new', name: 'Other' }], newItems),
    ).toBe(false);
    expect(isPriorCopy([{ PK: 'COMP#new', SK: 'ATHLETE#zz', compId: 'new' }], newItems)).toBe(
      false,
    );
  });
});
