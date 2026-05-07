export type StoredEmbedding = {
  id: string;
  word: string;
  embedding: number[];
  createdAt: number;
};

const STORAGE_KEY = "umap-embedding-viewer:words";

export function readStoredEmbeddings() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as StoredEmbedding[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item) =>
        typeof item.id === "string" &&
        typeof item.word === "string" &&
        Array.isArray(item.embedding) &&
        item.embedding.every((value) => typeof value === "number"),
    );
  } catch {
    return [];
  }
}

export function writeStoredEmbeddings(items: StoredEmbedding[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function createEmbeddingRecord(
  word: string,
  embedding: number[],
): StoredEmbedding {
  return {
    id: createId(),
    word,
    embedding,
    createdAt: Date.now(),
  };
}
