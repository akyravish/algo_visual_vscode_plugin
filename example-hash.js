// Two sum, the slow way and then with a hash map.
// The pair of loops is O(n²) — count the reads at the bottom of the panel, then
// run it again with the Map and watch the same answer cost one pass.

const nums = [2, 7, 11, 15, 3, 6];
const target = 21;

function twoSumSlow(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] + nums[j] === target) {
        return [i, j];
      }
    }
  }
  return [];
}

function twoSumFast(nums, target) {
  const seen = new Map(); // value we have already walked past → where it was

  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) {
      return [seen.get(need), i];
    }
    seen.set(nums[i], i);
  }
  return [];
}

const slow = twoSumSlow(nums, target);
const fast = twoSumFast(nums, target);
