// A binary search tree, built one insert at a time.
// Objects that point at other objects are drawn as nodes and arrows, and each
// recursive call gets its own indented set of variables.

const root = { value: 8, left: null, right: null };

function insert(node, value) {
  if (value < node.value) {
    if (node.left === null) {
      node.left = { value: value, left: null, right: null };
    } else {
      insert(node.left, value);
    }
  } else {
    if (node.right === null) {
      node.right = { value: value, left: null, right: null };
    } else {
      insert(node.right, value);
    }
  }
}

const incoming = [3, 10, 1, 6, 14, 4];

for (const next of incoming) {
  insert(root, next);
}
