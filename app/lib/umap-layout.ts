import { UMAP } from "umap-js";

import type { StoredEmbedding } from "./embedding-store";

export type ProjectedEmbedding = StoredEmbedding & {
  position: [number, number, number];
};

function seededRandom(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function normalize(points: number[][]): [number, number, number][] {
  const mins = [Infinity, Infinity, Infinity];
  const maxes = [-Infinity, -Infinity, -Infinity];

  for (const point of points) {
    for (let index = 0; index < 3; index += 1) {
      mins[index] = Math.min(mins[index], point[index] ?? 0);
      maxes[index] = Math.max(maxes[index], point[index] ?? 0);
    }
  }

  const center = mins.map((min, index) => (min + maxes[index]) / 2);
  const span = Math.max(
    ...maxes.map((max, index) => Math.max(max - mins[index], 1)),
  );
  const scale = 6 / span;

  return points.map((point) => [
    ((point[0] ?? 0) - center[0]) * scale,
    ((point[1] ?? 0) - center[1]) * scale,
    ((point[2] ?? 0) - center[2]) * scale,
  ]);
}

export function projectEmbeddings(items: StoredEmbedding[]): ProjectedEmbedding[] {
  if (items.length === 0) {
    return [];
  }

  if (items.length === 1) {
    return [{ ...items[0], position: [0, 0, 0] }];
  }

  if (items.length === 2) {
    return [
      { ...items[0], position: [-1.5, 0, 0] },
      { ...items[1], position: [1.5, 0, 0] },
    ];
  }

  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: Math.min(15, Math.max(2, items.length - 1)),
    minDist: 0.12,
    spread: 1.25,
    random: seededRandom(),
  });

  const projected = normalize(umap.fit(items.map((item) => item.embedding)));

  return items.map((item, index) => ({
    ...item,
    position: projected[index] ?? [0, 0, 0],
  }));
}
