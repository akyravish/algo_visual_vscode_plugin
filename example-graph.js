// Breadth-first search over a graph held as an adjacency list.
// The Map is the graph, the array is the frontier: watch the queue swell as a
// level is discovered and drain as it is visited, one level at a time.

const edges = new Map();
edges.set("A", ["B", "C"]);
edges.set("B", ["D"]);
edges.set("C", ["D", "E"]);
edges.set("D", ["F"]);
edges.set("E", ["F"]);
edges.set("F", []);

const seen = new Set();
const order = [];
const queue = ["A"];

seen.add("A");

while (queue.length > 0) {
  const node = queue.shift();
  order.push(node);
  for (const next of edges.get(node)) {
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
}
