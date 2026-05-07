import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowUpIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import type { EmbedActionData } from "./embed";
import {
  createEmbeddingRecord,
  readStoredEmbeddings,
  type StoredEmbedding,
  writeStoredEmbeddings,
} from "~/lib/embedding-store";
import { projectEmbeddings } from "~/lib/umap-layout";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Route } from "./+types/home";

const EmbeddingScene = lazy(() =>
  import("~/components/embedding-scene").then((module) => ({
    default: module.EmbeddingScene,
  })),
);

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <div className="fixed inset-0 embedding-grid" />;
    }

    return this.props.children;
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Embedding Map" },
    {
      name: "description",
      content: "Explore word embeddings in a 3D space.",
    },
  ];
}

export default function Home() {
  const formRef = useRef<HTMLFormElement>(null);
  const itemsRef = useRef<StoredEmbedding[]>([]);
  const [items, setItems] = useState<StoredEmbedding[]>([]);
  const [hasMounted, setHasMounted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const storedItems = readStoredEmbeddings();
    itemsRef.current = storedItems;
    setItems(storedItems);
    setHasMounted(true);
  }, []);

  function handleEmbedResult(result: EmbedActionData) {
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const currentItems = itemsRef.current;
    const exists = currentItems.some(
      (item) =>
        item.word.trim().toLocaleLowerCase() ===
        result.word.trim().toLocaleLowerCase(),
    );

    if (exists) {
      toast.info(`이미 추가된 단어입니다: ${result.word}`);
      return;
    }

    try {
      const nextItems = [
        ...currentItems,
        createEmbeddingRecord(result.word, result.embedding),
      ];
      itemsRef.current = nextItems;
      setItems(nextItems);
      writeStoredEmbeddings(nextItems);
      toast.success(`${result.word} embedding을 추가했습니다.`);
      formRef.current?.reset();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "embedding을 브라우저에 저장하지 못했습니다.";
      toast.error(message);
    }
  }

  const projected = useMemo(() => projectEmbeddings(items), [items]);

  function clearAll() {
    itemsRef.current = [];
    setItems([]);
    writeStoredEmbeddings([]);
    toast.info("저장된 단어를 모두 지웠습니다.");
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      {hasMounted ? (
        <SceneErrorBoundary>
          <Suspense fallback={<div className="fixed inset-0 embedding-grid" />}>
            <EmbeddingScene points={projected} />
          </Suspense>
        </SceneErrorBoundary>
      ) : null}

      <div className="fixed inset-x-0 bottom-6 z-10 flex flex-col items-center gap-2 px-4">
        <form
          ref={formRef}
          className="flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-background/80 p-2 backdrop-blur-md"
          onSubmit={async (event) => {
            event.preventDefault();

            const formData = new FormData(event.currentTarget);
            const word = String(formData.get("word") ?? "").trim();
            const exists = itemsRef.current.some(
              (item) =>
                item.word.trim().toLocaleLowerCase() === word.toLocaleLowerCase(),
            );

            if (!word) {
              toast.error("단어를 입력한 뒤 제출하세요.");
              return;
            }

            if (exists) {
              toast.info(`이미 추가된 단어입니다: ${word}`);
              return;
            }

            setIsSubmitting(true);

            try {
              const response = await fetch("/embed", {
                method: "POST",
                body: formData,
              });
              const result = (await response.json()) as EmbedActionData;
              handleEmbedResult(result);
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "embedding 요청에 실패했습니다.";
              toast.error(message);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          <Input
            name="word"
            placeholder="예: 반도체"
            autoComplete="off"
            disabled={isSubmitting}
            aria-label="Embedding을 생성할 단어"
            className="h-11"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isSubmitting}
            aria-label="제출"
          >
            {isSubmitting ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ArrowUpIcon data-icon="inline-start" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={clearAll}
            disabled={items.length === 0 || isSubmitting}
            aria-label="초기화"
          >
            <RotateCcwIcon data-icon="inline-start" />
          </Button>
        </form>
        <span className="rounded-full bg-background/75 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-md">
          {items.length} words
        </span>
      </div>
    </main>
  );
}
