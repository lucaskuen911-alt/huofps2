// Fixed-capacity ring pool. FX (decals, casings, tracers, particles) never allocate during
// combat; the oldest element is recycled when the pool is full.

export class RingPool {
  constructor(capacity, factory) {
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = factory(i);
    this.cursor = 0;
  }
  next() {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    return item;
  }
  forEach(fn) {
    for (let i = 0; i < this.items.length; i++) fn(this.items[i], i);
  }
}
