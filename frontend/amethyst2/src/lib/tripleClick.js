// A separate counter belongs to each rendered task, not to the page.
export function createTripleClickCounter(interval = 500) {
  let count = 0;
  let previous = 0;
  return {
    reset() { count = 0; previous = 0; },
    click(now = Date.now()) {
      count = now - previous <= interval ? count + 1 : 1;
      previous = now;
      if (count !== 3) return false;
      count = 0; previous = 0;
      return true;
    },
  };
}
