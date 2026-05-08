export type MultimodalKind = "text" | "image";

export type StoredMultimodalItem = {
  id: string;
  kind: MultimodalKind;
  label: string;
  text?: string;
  previewDataUrl?: string;
  mimeType?: string;
  embedding: number[];
  createdAt: number;
};

const DATABASE_NAME = "umap-embedding-viewer";
const DATABASE_VERSION = 1;
const STORE_NAME = "multimodal";
const RECORD_KEY = "items";
const LEGACY_STORAGE_KEY = "umap-embedding-viewer:multimodal";

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

function isMultimodalKind(value: unknown): value is MultimodalKind {
  return value === "text" || value === "image";
}

function filterStoredMultimodalItems(items: StoredMultimodalItem[]) {
  return items.filter(
    (item) =>
      typeof item.id === "string" &&
      isMultimodalKind(item.kind) &&
      typeof item.label === "string" &&
      Array.isArray(item.embedding) &&
      item.embedding.length > 0 &&
      item.embedding.every((value) => typeof value === "number") &&
      typeof item.createdAt === "number",
  );
}

function readLegacyStoredMultimodalItems() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue) as StoredMultimodalItem[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return filterStoredMultimodalItems(parsed);
  } catch {
    return [];
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("이 브라우저는 IndexedDB를 지원하지 않습니다."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB를 열지 못했습니다."));
    });
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다."));
    });
  });
}

export async function readStoredMultimodalItems() {
  if (typeof window === "undefined") {
    return [];
  }

  if (typeof indexedDB === "undefined") {
    return readLegacyStoredMultimodalItems();
  }

  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const stored = await requestToPromise<StoredMultimodalItem[] | undefined>(
      transaction.objectStore(STORE_NAME).get(RECORD_KEY),
    );
    database.close();

    if (Array.isArray(stored)) {
      return filterStoredMultimodalItems(stored);
    }

    const legacyItems = readLegacyStoredMultimodalItems();
    if (legacyItems.length > 0) {
      await writeStoredMultimodalItems(legacyItems);
    }

    return legacyItems;
  } catch {
    return readLegacyStoredMultimodalItems();
  }
}

export async function writeStoredMultimodalItems(
  items: StoredMultimodalItem[],
) {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof indexedDB === "undefined") {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(items));
    return;
  }

  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction
      .objectStore(STORE_NAME)
      .put(filterStoredMultimodalItems(items), RECORD_KEY);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB 저장에 실패했습니다."));
    });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("IndexedDB 저장이 중단됐습니다."));
    });
  });

  database.close();
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function createStoredMultimodalItem(
  item: Omit<StoredMultimodalItem, "id" | "createdAt">,
): StoredMultimodalItem {
  return {
    ...item,
    id: createId(),
    createdAt: Date.now(),
  };
}
