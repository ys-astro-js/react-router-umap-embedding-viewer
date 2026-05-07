export type FaceGroup = "verified" | "blocked";

export type StoredFace = {
  id: string;
  name: string;
  group: FaceGroup;
  reason?: string;
  embedding: number[];
  thumbnailDataUrl?: string;
  createdAt: number;
};

const STORAGE_KEY = "umap-embedding-viewer:faces";

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function isFaceGroup(value: unknown): value is FaceGroup {
  return value === "verified" || value === "blocked";
}

export function readStoredFaces() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as StoredFace[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item) =>
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        isFaceGroup(item.group) &&
        Array.isArray(item.embedding) &&
        item.embedding.length === 512 &&
        item.embedding.every((value) => typeof value === "number") &&
        typeof item.createdAt === "number",
    );
  } catch {
    return [];
  }
}

export function writeStoredFaces(items: StoredFace[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function createStoredFace(
  face: Omit<StoredFace, "id" | "createdAt">,
): StoredFace {
  return {
    ...face,
    reason: face.group === "blocked" ? face.reason?.trim() : undefined,
    id: createId(),
    createdAt: Date.now(),
  };
}
