import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SpatialGrid } from '../static/sim/grid.js';
import { mulberry32 } from '../static/sim/rng.js';

function bruteNearest(items, x, y, maxDistSq, accept) {
  let best = null, bestDistSq = maxDistSq;
  for (const item of items) {
    const d = (item.x - x) ** 2 + (item.y - y) ** 2;
    if (d < bestDistSq && (!accept || accept(item))) {
      bestDistSq = d;
      best = item;
    }
  }
  return best;
}

test('nearest matches a brute-force search, including after moves and removals', () => {
  const random = mulberry32(123);
  const grid = new SpatialGrid(680, 340, 40);
  let items = [];
  for (let i = 0; i < 400; i++) {
    const item = { x: random() * 680, y: random() * 340, even: i % 2 === 0 };
    items.push(item);
    grid.add(item);
  }
  for (let round = 0; round < 300; round++) {
    // Move one item and remove another, then compare a query.
    const mover = items[Math.floor(random() * items.length)];
    const oldX = mover.x, oldY = mover.y;
    mover.x = random() * 680;
    mover.y = random() * 340;
    grid.move(mover, oldX, oldY);
    if (round % 3 === 0) {
      const gone = items[Math.floor(random() * items.length)];
      assert.equal(grid.remove(gone), true);
      items = items.filter((it) => it !== gone);
    }

    const x = random() * 680, y = random() * 340, reach = 5 + random() * 120;
    const accept = round % 2 ? (it) => it.even : undefined;
    assert.equal(grid.nearest(x, y, reach * reach, accept), bruteNearest(items, x, y, reach * reach, accept));
  }
  assert.equal(grid.size, items.length);
  assert.equal([...grid].length, items.length);
});

test('nearest returns null when nothing is in range', () => {
  const grid = new SpatialGrid(680, 340, 40);
  grid.add({ x: 100, y: 100 });
  assert.equal(grid.nearest(300, 300, 50 * 50), null);
  assert.equal(grid.nearest(100, 110, 10 * 10), null); // exactly at the limit is out of range
});

test('removing a missing item reports false and leaves the size alone', () => {
  const grid = new SpatialGrid(680, 340, 40);
  grid.add({ x: 10, y: 10 });
  assert.equal(grid.remove({ x: 10, y: 10 }), false);
  assert.equal(grid.size, 1);
});

test('the seeded generator repeats and stays between 0 and 1', () => {
  const a = mulberry32(99), b = mulberry32(99);
  for (let i = 0; i < 1000; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});
