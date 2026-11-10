// Seeded random numbers, so the same seed always produces the same world.

// Returns a function that yields numbers in [0, 1), like Math.random.
// Its getState() and setState() let a saved world pick up the same sequence.
export function mulberry32(seed) {
  let state = seed >>> 0;
  function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  random.getState = () => state;
  random.setState = (value) => { state = value >>> 0; };
  return random;
}

// A fresh seed for "New world".
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296);
}
