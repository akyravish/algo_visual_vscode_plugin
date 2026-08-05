// A min-heap, which is a tree that lives in a flat array: the children of i sit
// at 2i+1 and 2i+2. Push bubbles a value up until its parent is smaller; pop
// moves the last value to the front and sinks it back down.

const heap = [];

function heapPush(value) {
  heap.push(value);
  let i = heap.length - 1;

  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent] <= heap[i]) {
      break;
    }
    const swap = heap[parent];
    heap[parent] = heap[i];
    heap[i] = swap;
    i = parent;
  }
}

function heapPop() {
  const top = heap[0];
  const last = heap.pop();

  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;

    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let small = i;

      if (left < heap.length && heap[left] < heap[small]) {
        small = left;
      }
      if (right < heap.length && heap[right] < heap[small]) {
        small = right;
      }
      if (small === i) {
        break;
      }
      const swap = heap[small];
      heap[small] = heap[i];
      heap[i] = swap;
      i = small;
    }
  }
  return top;
}

for (const value of [7, 3, 9, 1, 8, 2]) {
  heapPush(value);
}

const sorted = [];

while (heap.length > 0) {
  sorted.push(heapPop());
}
