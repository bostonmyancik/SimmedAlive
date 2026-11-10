// A bucket grid for "what is the nearest thing to this point?" lookups.
// Items are any objects with numeric x and y. Looking only at nearby buckets
// keeps searches fast as the world and the population grow.

export class SpatialGrid {
  constructor(width, height, bucketSize) {
    this.bucketSize = bucketSize;
    this.cols = Math.ceil(width / bucketSize);
    this.rows = Math.ceil(height / bucketSize);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    this.size = 0;
  }

  col(x) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.bucketSize)));
  }

  row(y) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.bucketSize)));
  }

  bucketAt(x, y) {
    return this.buckets[this.row(y) * this.cols + this.col(x)];
  }

  clear() {
    for (const bucket of this.buckets) bucket.length = 0;
    this.size = 0;
  }

  add(item) {
    this.bucketAt(item.x, item.y).push(item);
    this.size++;
  }

  // Removes an item that sits at (x, y) in the grid. Returns false if absent.
  remove(item, x = item.x, y = item.y) {
    const bucket = this.bucketAt(x, y);
    const i = bucket.indexOf(item);
    if (i < 0) return false;
    bucket[i] = bucket[bucket.length - 1];
    bucket.pop();
    this.size--;
    return true;
  }

  // Call after changing an item's x or y, passing where it used to be.
  move(item, oldX, oldY) {
    const from = this.bucketAt(oldX, oldY);
    const to = this.bucketAt(item.x, item.y);
    if (from === to) return;
    const i = from.indexOf(item);
    if (i < 0) return;
    from[i] = from[from.length - 1];
    from.pop();
    to.push(item);
  }

  // Nearest item strictly closer than sqrt(maxDistSq), or null.
  // `accept` can filter out items (for example, creatures of the same species).
  nearest(x, y, maxDistSq, accept) {
    const reach = Math.sqrt(maxDistSq);
    const col0 = this.col(x - reach), col1 = this.col(x + reach);
    const row0 = this.row(y - reach), row1 = this.row(y + reach);
    let best = null;
    let bestDistSq = maxDistSq;
    for (let r = row0; r <= row1; r++) {
      for (let c = col0; c <= col1; c++) {
        for (const item of this.buckets[r * this.cols + c]) {
          const dx = item.x - x, dy = item.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq && (!accept || accept(item))) {
            bestDistSq = distSq;
            best = item;
          }
        }
      }
    }
    return best;
  }

  *[Symbol.iterator]() {
    for (const bucket of this.buckets) yield* bucket;
  }
}
