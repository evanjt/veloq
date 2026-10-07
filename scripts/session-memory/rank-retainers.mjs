#!/usr/bin/env node
// Rank a heap snapshot by constructor: count, self size and retained size.
// Given a second snapshot, print the change in each from the first.
//
// Retained size is what the dominator tree attributes to every object of that
// constructor, outermost only, so a list holding a thousand records is not
// counted a thousand times over. Weak edges do not retain.
//
//   node scripts/session-memory/rank-retainers.mjs <a.heapsnapshot> [b.heapsnapshot] [top]

import { readFileSync } from 'node:fs';

function load(path) {
  const snap = JSON.parse(readFileSync(path, 'utf8'));
  const meta = snap.snapshot.meta;
  const nf = meta.node_fields.length;
  const ef = meta.edge_fields.length;
  const nType = meta.node_fields.indexOf('type');
  const nName = meta.node_fields.indexOf('name');
  const nSelf = meta.node_fields.indexOf('self_size');
  const nEdges = meta.node_fields.indexOf('edge_count');
  const eType = meta.edge_fields.indexOf('type');
  const eTo = meta.edge_fields.indexOf('to_node');
  const nodeTypes = meta.node_types[nType];
  const edgeTypes = meta.edge_types[eType];
  const weak = edgeTypes.indexOf('weak');
  const nodes = snap.nodes;
  const edges = snap.edges;
  const strings = snap.strings;
  const count = nodes.length / nf;

  const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) {
    firstEdge[i] = e;
    e += nodes[i * nf + nEdges] * ef;
    firstEdge[i + 1] = e;
  }
  const succ = (v, fn) => {
    for (let e = firstEdge[v]; e < firstEdge[v + 1]; e += ef) {
      if (edges[e + eType] === weak) continue;
      fn(edges[e + eTo] / nf);
    }
  };

  // Postorder from the root, iteratively.
  const order = new Int32Array(count).fill(-1);
  const post = [];
  const stack = [0];
  const cursor = new Uint32Array(count);
  const seen = new Uint8Array(count);
  seen[0] = 1;
  for (let i = 0; i < count; i++) cursor[i] = firstEdge[i];
  while (stack.length) {
    const v = stack[stack.length - 1];
    let pushed = false;
    while (cursor[v] < firstEdge[v + 1]) {
      const e = cursor[v];
      cursor[v] += ef;
      if (edges[e + eType] === weak) continue;
      const w = edges[e + eTo] / nf;
      if (!seen[w]) {
        seen[w] = 1;
        stack.push(w);
        pushed = true;
        break;
      }
    }
    if (!pushed) {
      stack.pop();
      order[v] = post.length;
      post.push(v);
    }
  }

  const preds = Array.from({ length: count }, () => []);
  for (const v of post) succ(v, (w) => order[w] >= 0 && preds[w].push(v));

  // Cooper, Harvey and Kennedy's iterative dominators over the postorder.
  const idom = new Int32Array(count).fill(-1);
  idom[0] = 0;
  const intersect = (a, b) => {
    while (a !== b) {
      while (order[a] < order[b]) a = idom[a];
      while (order[b] < order[a]) b = idom[b];
    }
    return a;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = post.length - 2; i >= 0; i--) {
      const v = post[i];
      let dom = -1;
      for (const p of preds[v]) {
        if (idom[p] === -1) continue;
        dom = dom === -1 ? p : intersect(p, dom);
      }
      if (dom !== -1 && idom[v] !== dom) {
        idom[v] = dom;
        changed = true;
      }
    }
  }

  const retained = new Float64Array(count);
  for (const v of post) retained[v] += nodes[v * nf + nSelf];
  for (const v of post) if (v !== 0) retained[idom[v]] += retained[v];

  const label = (v) => {
    const type = nodeTypes[nodes[v * nf + nType]];
    const name = strings[nodes[v * nf + nName]];
    return type === 'object' || type === 'native' ? name : `(${type})`;
  };

  // A constructor's retained size counts only its outermost instances.
  const byName = new Map();
  for (const v of post) {
    const name = label(v);
    let row = byName.get(name);
    if (!row) byName.set(name, (row = { count: 0, self: 0, retained: 0 }));
    row.count++;
    row.self += nodes[v * nf + nSelf];
    let d = idom[v];
    let outer = true;
    while (d !== 0 && d !== -1) {
      if (label(d) === name) {
        outer = false;
        break;
      }
      d = idom[d];
    }
    if (outer) row.retained += retained[v];
  }
  return { byName, total: retained[0], count: post.length };
}

const [a, b, topArg] = process.argv.slice(2);
const top = Number(topArg ?? (b && !b.endsWith('.heapsnapshot') ? b : 30));
const first = load(a);
const mb = (n) => (n / 1048576).toFixed(2);
console.log(`${a}: ${first.count} reachable objects, ${mb(first.total)} MB`);

if (b && b.endsWith('.heapsnapshot')) {
  const second = load(b);
  console.log(`${b}: ${second.count} reachable objects, ${mb(second.total)} MB`);
  const rows = [...second.byName].map(([name, s]) => {
    const f = first.byName.get(name) ?? { count: 0, self: 0, retained: 0 };
    return {
      name,
      count: s.count - f.count,
      self: s.self - f.self,
      retained: s.retained,
      was: f.retained,
    };
  });
  rows.sort((x, y) => y.self - x.self);
  console.log('constructor\tcount_change\tself_change_mb\tretained_mb_before\tretained_mb_after');
  for (const r of rows.slice(0, top)) {
    console.log(`${r.name}\t${r.count}\t${mb(r.self)}\t${mb(r.was)}\t${mb(r.retained)}`);
  }
} else {
  const rows = [...first.byName].sort((x, y) => y[1].retained - x[1].retained);
  console.log('constructor\tcount\tself_mb\tretained_mb');
  for (const [name, r] of rows.slice(0, top)) {
    console.log(`${name}\t${r.count}\t${mb(r.self)}\t${mb(r.retained)}`);
  }
}
