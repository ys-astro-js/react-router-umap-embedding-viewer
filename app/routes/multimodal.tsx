import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  ImageIcon,
  Loader2Icon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { JinaEmbedActionData } from "./jina-embed";
import {
  createStoredMultimodalItem,
  readStoredMultimodalItems,
  writeStoredMultimodalItems,
  type MultimodalKind,
  type StoredMultimodalItem,
} from "~/lib/multimodal-store";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { Route } from "./+types/multimodal";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TOP_RESULT_COUNT = 5;

type QueryState = {
  source: "search" | "item";
  sourceId?: string;
  kind: MultimodalKind;
  label: string;
  embedding: number[];
};

type SearchResult = {
  item: StoredMultimodalItem;
  similarity: number;
  rank: number;
};

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Jina Multimodal Search" },
    {
      name: "description",
      content: "Search local text and image embeddings with Jina AI.",
    },
  ];
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function formatSimilarity(value: number) {
  return `${Math.round(Math.max(-1, Math.min(1, value)) * 100)}%`;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("이미지를 읽지 못했습니다."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error("이미지 미리보기를 만들지 못했습니다.")),
    );
    image.src = dataUrl;
  });
}

async function createImagePreview(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxSide = 360;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  try {
    return canvas.toDataURL("image/webp", 0.78);
  } catch {
    return canvas.toDataURL("image/jpeg", 0.78);
  }
}

function validateImage(file: File) {
  if (!file.type.startsWith("image/")) {
    return "이미지 파일만 업로드할 수 있습니다.";
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return "이미지는 5MB 이하만 업로드할 수 있습니다.";
  }

  return null;
}

function itemLabel(item: StoredMultimodalItem) {
  return item.kind === "text" ? item.text ?? item.label : item.label;
}

function ResultPreview({ item }: { item: StoredMultimodalItem }) {
  if (item.kind === "image" && item.previewDataUrl) {
    return (
      <img
        src={item.previewDataUrl}
        alt={item.label}
        className="size-12 rounded-md object-cover"
      />
    );
  }

  return (
    <div className="flex size-12 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
      <TypeIcon data-icon="inline-start" />
    </div>
  );
}

function ContentTile({
  item,
  rank,
  isDimmed,
  isSelected,
  onSelect,
  onDelete,
}: {
  item: StoredMultimodalItem;
  rank?: number;
  isDimmed: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative aspect-square min-h-0 rounded-lg transition-[opacity,filter]",
        isDimmed && "opacity-18 grayscale",
      )}
    >
      <button
        type="button"
        className={cn(
          "size-full rounded-lg border bg-card text-card-foreground outline-none transition-[border-color]",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          isSelected && "ring-ring ring-3",
          rank && "border-primary",
        )}
        onClick={onSelect}
        aria-label={`${item.label} 유사 항목 보기`}
      >
        {item.kind === "image" && item.previewDataUrl ? (
          <img
            src={item.previewDataUrl}
            alt=""
            className="size-full rounded-lg object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center p-4 text-center text-sm font-semibold leading-snug">
            <span className="line-clamp-5">{item.text ?? item.label}</span>
          </span>
        )}
        {rank ? (
          <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {rank}
          </span>
        ) : null}
      </button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute right-2 bottom-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label={`${item.label} 삭제`}
      >
        <Trash2Icon data-icon="inline-start" />
      </Button>
    </div>
  );
}

function ResultsSidebar({
  query,
  results,
  onSelect,
  onClose,
}: {
  query: QueryState;
  results: SearchResult[];
  onSelect: (item: StoredMultimodalItem) => void;
  onClose: () => void;
}) {
  return (
    <aside className="fixed bottom-32 right-4 top-4 z-20 flex w-80 flex-col rounded-lg border bg-card/90 p-4 text-card-foreground backdrop-blur-md max-lg:bottom-auto max-lg:top-20 max-lg:max-h-[42vh] max-lg:w-[calc(100vw-2rem)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Top 5
          </p>
          <h2 className="truncate text-base font-semibold">{query.label}</h2>
        </div>
        <Badge variant="secondary">
          {query.kind === "image" ? "이미지" : "텍스트"}
        </Badge>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClose}
          aria-label="유사도 목록 닫기"
        >
          <XIcon data-icon="inline-start" />
        </Button>
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {results.map((result) => (
          <button
            type="button"
            key={result.item.id}
            className="flex w-full items-center gap-3 rounded-lg border bg-background/70 p-2 text-left transition-colors hover:bg-secondary/70"
            onClick={() => onSelect(result.item)}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {result.rank}
            </span>
            <ResultPreview item={result.item} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {itemLabel(result.item)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatSimilarity(result.similarity)} ·{" "}
                {formatDate(result.item.createdAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function MultimodalSearch() {
  const searchImageInputRef = useRef<HTMLInputElement>(null);
  const uploadImageInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<StoredMultimodalItem[]>([]);
  const [query, setQuery] = useState<QueryState | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchImageFile, setSearchImageFile] = useState<File | null>(null);
  const [uploadKind, setUploadKind] = useState<MultimodalKind>("text");
  const [uploadText, setUploadText] = useState("");
  const [uploadImageFiles, setUploadImageFiles] = useState<File[]>([]);
  const [uploadImagePreviews, setUploadImagePreviews] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadItems() {
      const storedItems = await readStoredMultimodalItems();
      if (isMounted) {
        setItems(storedItems);
      }
    }

    void loadItems();

    return () => {
      isMounted = false;
    };
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    if (!query) {
      return [];
    }

    return items
      .filter((item) => item.id !== query.sourceId)
      .map((item) => ({
        item,
        similarity: cosineSimilarity(query.embedding, item.embedding),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, TOP_RESULT_COUNT)
      .map((result, index) => ({
        ...result,
        rank: index + 1,
      }));
  }, [items, query]);

  const rankById = useMemo(() => {
    return new Map(results.map((result) => [result.item.id, result.rank]));
  }, [results]);

  async function persistItems(nextItems: StoredMultimodalItem[]) {
    await writeStoredMultimodalItems(nextItems);
    setItems(nextItems);
  }

  function resetUploadInputs() {
    setUploadText("");
    setUploadImageFiles([]);
    setUploadImagePreviews([]);
    if (uploadImageInputRef.current) {
      uploadImageInputRef.current.value = "";
    }
  }

  async function handleUploadImageChange(files: File[]) {
    setUploadImageFiles([]);
    setUploadImagePreviews([]);

    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      const validationError = validateImage(file);
      if (validationError) {
        toast.error(validationError);
        if (uploadImageInputRef.current) {
          uploadImageInputRef.current.value = "";
        }
        return;
      }
    }

    setUploadImageFiles(files);

    try {
      setUploadImagePreviews(await Promise.all(files.map(createImagePreview)));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "이미지 미리보기를 만들지 못했습니다.",
      );
    }
  }

  function handleSearchImageChange(file: File | null) {
    setSearchImageFile(null);

    if (!file) {
      return;
    }

    const validationError = validateImage(file);
    if (validationError) {
      toast.error(validationError);
      if (searchImageInputRef.current) {
        searchImageInputRef.current.value = "";
      }
      return;
    }

    setSearchText("");
    setSearchImageFile(file);
  }

  function clearSearchImage() {
    setSearchImageFile(null);
    if (searchImageInputRef.current) {
      searchImageInputRef.current.value = "";
    }
  }

  function selectItem(item: StoredMultimodalItem) {
    setQuery({
      source: "item",
      sourceId: item.id,
      kind: item.kind,
      label: item.label,
      embedding: item.embedding,
    });
  }

  async function deleteItem(itemId: string) {
    try {
      const nextItems = items.filter((item) => item.id !== itemId);
      await persistItems(nextItems);

      if (query?.sourceId === itemId) {
        setQuery(null);
      }

      toast.info("등록된 항목을 삭제했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "등록된 항목을 삭제하지 못했습니다.",
      );
    }
  }

  async function requestEmbedding(formData: FormData) {
    const response = await fetch("/jina-embed", {
      method: "POST",
      body: formData,
    });

    return (await response.json()) as JinaEmbedActionData;
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (items.length === 0) {
      toast.error("검색할 저장 항목이 없습니다.");
      return;
    }

    const trimmedText = searchText.trim();
    if (!trimmedText && !searchImageFile) {
      toast.error("검색어를 입력하거나 이미지를 선택하세요.");
      return;
    }

    const formData = new FormData();
    formData.set("mode", "search");

    if (trimmedText) {
      formData.set("kind", "text");
      formData.set("text", trimmedText);
    } else if (searchImageFile) {
      formData.set("kind", "image");
      formData.set("image", searchImageFile);
    }

    setIsSearching(true);

    try {
      const result = await requestEmbedding(formData);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const item = result.items[0];
      if (!item) {
        toast.error("Jina embedding 응답이 비어 있습니다.");
        return;
      }

      setQuery({
        source: "search",
        kind: item.kind,
        label: item.label,
        embedding: item.embedding,
      });
      toast.success("검색 결과를 업데이트했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Jina embedding 요청에 실패했습니다.",
      );
    } finally {
      setIsSearching(false);
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData();
    formData.set("mode", "upload");
    formData.set("kind", uploadKind);

    if (uploadKind === "text") {
      const trimmedText = uploadText.trim();
      if (!trimmedText) {
        toast.error("저장할 텍스트를 입력하세요.");
        return;
      }

      formData.set("text", trimmedText);
    } else {
      if (uploadImageFiles.length === 0) {
        toast.error("저장할 이미지 파일을 선택하세요.");
        return;
      }

      for (const file of uploadImageFiles) {
        formData.append("image", file);
      }
    }

    setIsUploading(true);

    try {
      const result = await requestEmbedding(formData);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const nextItems = result.items.map((item, index) =>
        createStoredMultimodalItem({
          kind: item.kind,
          label: item.label,
          text: item.kind === "text" ? uploadText.trim() : undefined,
          previewDataUrl:
            item.kind === "image" ? uploadImagePreviews[index] : undefined,
          mimeType:
            item.kind === "image" ? uploadImageFiles[index]?.type : undefined,
          embedding: item.embedding,
        }),
      );

      await persistItems([...items, ...nextItems]);
      resetUploadInputs();
      setIsUploadOpen(false);
      toast.success(
        nextItems.length > 1
          ? `${nextItems.length}개 항목을 로컬 embedding 저장소에 추가했습니다.`
          : "로컬 embedding 저장소에 추가했습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Jina embedding 생성 또는 로컬 저장에 실패했습니다.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function clearAll() {
    try {
      await persistItems([]);
      setQuery(null);
      setSearchText("");
      clearSearchImage();
      resetUploadInputs();
      toast.info("저장된 멀티모달 항목을 모두 지웠습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "저장된 멀티모달 항목을 지우지 못했습니다.",
      );
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="fixed left-4 top-4 z-30 flex items-center gap-2">
        <Button asChild variant="outline">
          <Link to="/">
            <ArrowLeftIcon data-icon="inline-start" />
            UMAP
          </Link>
        </Button>
      </div>

      <section className="fixed inset-0 overflow-auto embedding-grid px-6 pb-36 pt-24">
        <div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4">
          {items.map((item) => {
            const rank = rankById.get(item.id);
            const isSelected = query?.sourceId === item.id;
            const isDimmed = Boolean(query) && !rank && !isSelected;

            return (
              <ContentTile
                key={item.id}
                item={item}
                rank={rank}
                isDimmed={isDimmed}
                isSelected={isSelected}
                onSelect={() => selectItem(item)}
                onDelete={() => {
                  void deleteItem(item.id);
                }}
              />
            );
          })}
        </div>
      </section>

      {query && results.length > 0 ? (
        <ResultsSidebar
          query={query}
          results={results}
          onSelect={selectItem}
          onClose={() => setQuery(null)}
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2 px-4">
        <form
          className="flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-background/80 p-2 backdrop-blur-md"
          onSubmit={handleSearch}
        >
          <Input
            value={searchText}
            placeholder={
              searchImageFile ? searchImageFile.name : "텍스트로 검색"
            }
            autoComplete="off"
            disabled={isSearching}
            aria-label="검색어"
            className="h-11"
            onChange={(event) => {
              setSearchText(event.target.value);
              if (searchImageFile) {
                setSearchImageFile(null);
                if (searchImageInputRef.current) {
                  searchImageInputRef.current.value = "";
                }
              }
            }}
          />
          <input
            ref={searchImageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) =>
              handleSearchImageChange(event.currentTarget.files?.[0] ?? null)
            }
          />
          <Button
            type="button"
            variant={searchImageFile ? "default" : "outline"}
            size="icon"
            disabled={isSearching}
            aria-label={searchImageFile ? "이미지 선택 취소" : "이미지로 검색"}
            onClick={() => {
              if (searchImageFile) {
                clearSearchImage();
                return;
              }

              searchImageInputRef.current?.click();
            }}
          >
            {searchImageFile ? (
              <XIcon data-icon="inline-start" />
            ) : (
              <ImageIcon data-icon="inline-start" />
            )}
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={isSearching}
            aria-label="검색"
          >
            {isSearching ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <SearchIcon data-icon="inline-start" />
            )}
          </Button>
        </form>
        <span className="rounded-full bg-background/75 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-md">
          {items.length} items
        </span>
      </div>

      <Popover open={isUploadOpen} onOpenChange={setIsUploadOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="icon"
            className="fixed bottom-6 right-6 z-40"
            aria-label="컨텐츠 추가"
          >
            <PlusIcon data-icon="inline-start" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-80 shadow-none">
          <form className="flex flex-col gap-3" onSubmit={handleUpload}>
            <ToggleGroup
              type="single"
              value={uploadKind}
              onValueChange={(value) => {
                if (value === "text" || value === "image") {
                  setUploadKind(value);
                }
              }}
              variant="outline"
              size="sm"
              aria-label="저장할 컨텐츠 종류"
            >
              <ToggleGroupItem value="text">
                <TypeIcon data-icon="inline-start" />
                텍스트
              </ToggleGroupItem>
              <ToggleGroupItem value="image">
                <ImageIcon data-icon="inline-start" />
                이미지
              </ToggleGroupItem>
            </ToggleGroup>

            {uploadKind === "text" ? (
              <Textarea
                value={uploadText}
                onChange={(event) => setUploadText(event.target.value)}
                placeholder="저장할 텍스트"
                disabled={isUploading}
                aria-label="저장할 텍스트"
              />
            ) : (
              <div className="flex items-center gap-3">
                {uploadImagePreviews.length > 0 ? (
                  <div className="flex max-w-24 flex-wrap gap-1">
                    {uploadImagePreviews.slice(0, 4).map((preview, index) => (
                      <img
                        key={`${preview}-${index}`}
                        src={preview}
                        alt=""
                        className="size-10 rounded-md object-cover"
                      />
                    ))}
                    {uploadImagePreviews.length > 4 ? (
                      <span className="flex size-10 items-center justify-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground">
                        +{uploadImagePreviews.length - 4}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex size-12 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <ImageIcon data-icon="inline-start" />
                  </div>
                )}
                <Input
                  ref={uploadImageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={isUploading}
                  aria-label="저장할 이미지"
                  onChange={(event) => {
                    void handleUploadImageChange(
                      Array.from(event.currentTarget.files ?? []),
                    );
                  }}
                />
              </div>
            )}

            <Button type="submit" disabled={isUploading}>
              {isUploading ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <ArrowUpIcon data-icon="inline-start" />
              )}
              저장
            </Button>
          </form>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="fixed right-20 bottom-6 z-40"
        onClick={clearAll}
        disabled={items.length === 0 || isSearching || isUploading}
        aria-label="초기화"
      >
        <RotateCcwIcon data-icon="inline-start" />
      </Button>
    </main>
  );
}
