import type { Route } from "./+types/jina-embed";

const JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings";
const MODEL_ID = "jina-embeddings-v5-omni-small";
const EMBEDDING_DIMENSIONS = 512;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type EmbedSuccess = {
  ok: true;
  items: Array<{
    kind: "text" | "image";
    label: string;
    embedding: number[];
  }>;
};

type EmbedFailure = {
  ok: false;
  error: string;
};

export type JinaEmbedActionData = EmbedSuccess | EmbedFailure;

function json(payload: JinaEmbedActionData, init?: ResponseInit) {
  return Response.json(payload, init);
}

function isKind(value: unknown): value is "text" | "image" {
  return value === "text" || value === "image";
}

function taskForMode(value: FormDataEntryValue | null) {
  return value === "search" ? "retrieval.query" : "retrieval.passage";
}

function extractEmbeddings(output: unknown): number[][] | null {
  if (
    !output ||
    typeof output !== "object" ||
    !("data" in output) ||
    !Array.isArray(output.data)
  ) {
    return null;
  }

  const entries: Array<{ index: number | null; embedding: number[] }> = [];

  for (const item of output.data) {
    if (
      !item ||
      typeof item !== "object" ||
      !("embedding" in item) ||
      !Array.isArray(item.embedding) ||
      !item.embedding.every((value: unknown) => typeof value === "number")
    ) {
      return null;
    }

    entries.push({
      index:
        "index" in item && typeof item.index === "number" ? item.index : null,
      embedding: item.embedding as number[],
    });
  }

  if (entries.every((entry) => entry.index !== null)) {
    entries.sort((left, right) => Number(left.index) - Number(right.index));
  }

  return entries.map((entry) => entry.embedding);
}

function errorMessageFromBody(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  if ("message" in body && typeof body.message === "string") {
    return body.message;
  }

  if ("error" in body && typeof body.error === "string") {
    return body.error;
  }

  if ("detail" in body && typeof body.detail === "string") {
    return body.detail;
  }

  if ("errors" in body && Array.isArray(body.errors)) {
    const first = body.errors[0] as unknown;
    if (first && typeof first === "object" && "message" in first) {
      const message = first.message;
      if (typeof message === "string") {
        return message;
      }
    }
  }

  return fallback;
}

async function imageFileToBase64(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function action({ request }: Route.ActionArgs) {
  const apiKey = process.env.JINA_API_KEY;

  if (!apiKey) {
    return json(
      {
        ok: false,
        error: "JINA_API_KEY 환경변수가 설정되어 있지 않습니다.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const rawKind = formData.get("kind");
  const mode = formData.get("mode");

  if (!isKind(rawKind)) {
    return json(
      {
        ok: false,
        error: "텍스트 또는 이미지 입력 방식을 선택하세요.",
      },
      { status: 400 },
    );
  }

  let labels: string[] = [];
  let input: string | { image: string } | Array<{ image: string }>;

  if (rawKind === "text") {
    const rawText = formData.get("text");
    const text = typeof rawText === "string" ? rawText.trim() : "";

    if (!text) {
      return json(
        {
          ok: false,
          error: "텍스트를 입력하세요.",
        },
        { status: 400 },
      );
    }

    labels = [text.length > 48 ? `${text.slice(0, 48)}...` : text];
    input = text;
  } else {
    const files = formData
      .getAll("image")
      .filter((file): file is File => file instanceof File && file.size > 0);

    if (files.length === 0) {
      return json(
        {
          ok: false,
          error: "이미지 파일을 선택하세요.",
        },
        { status: 400 },
      );
    }

    if (mode === "search" && files.length !== 1) {
      return json(
        {
          ok: false,
          error: "이미지 검색은 한 번에 한 장만 사용할 수 있습니다.",
        },
        { status: 400 },
      );
    }

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return json(
          {
            ok: false,
            error: "이미지 파일만 업로드할 수 있습니다.",
          },
          { status: 400 },
        );
      }

      if (file.size > MAX_IMAGE_BYTES) {
        return json(
          {
            ok: false,
            error: "이미지는 5MB 이하만 업로드할 수 있습니다.",
          },
          { status: 400 },
        );
      }
    }

    labels = files.map((file, index) => file.name || `업로드한 이미지 ${index + 1}`);
    const imageInputs = await Promise.all(
      files.map(async (file) => ({ image: await imageFileToBase64(file) })),
    );
    input = imageInputs.length === 1 ? imageInputs[0] : imageInputs;
  }

  const response = await fetch(JINA_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_ID,
      input,
      task: taskForMode(mode),
      embedding_type: "float",
      normalized: true,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    let body: unknown = null;

    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return json(
      {
        ok: false,
        error: errorMessageFromBody(
          body,
          `Jina embedding 요청에 실패했습니다. (${response.status})`,
        ),
      },
      { status: response.status },
    );
  }

  const body: unknown = await response.json();
  const embeddings = extractEmbeddings(body);

  if (
    !embeddings ||
    embeddings.length !== labels.length ||
    embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)
  ) {
    return json(
      {
        ok: false,
        error: `${EMBEDDING_DIMENSIONS}차원 Jina embedding을 찾지 못했습니다.`,
      },
      { status: 502 },
    );
  }

  return json({
    ok: true,
    items: embeddings.map((embedding, index) => ({
      kind: rawKind,
      label: labels[index] ?? (rawKind === "image" ? "업로드한 이미지" : "텍스트"),
      embedding,
    })),
  });
}
