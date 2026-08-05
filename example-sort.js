// Bubble sort — completely ordinary code, nothing added for the visualizer.
// Blue box = being read, orange box = just written.

const arr = [5, 3, 8, 1, 9, 2, 7, 4, 6];

for (let i = 0; i < arr.length; i++) {
  for (let j = 0; j < arr.length - i - 1; j++) {
    if (arr[j] > arr[j + 1]) {
      const t = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = t;
    }
  }
}
