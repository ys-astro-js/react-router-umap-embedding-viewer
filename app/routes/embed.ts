import type { Route } from "./+types/embed";

const MODEL_ID = "dragonkue/multilingual-e5-small-ko-v2";
const HF_FEATURE_EXTRACTION_URL = `https://router.huggingface.co/hf-inference/models/${MODEL_ID}/pipeline/feature-extraction`;

type EmbedSuccess = {
  ok: true;
  word: string;
  embedding: number[];
};

type EmbedFailure = {
  ok: false;
  error: string;
};

export type EmbedActionData = EmbedSuccess | EmbedFailure;

function json(payload: EmbedActionData, init?: ResponseInit) {
  return Response.json(payload, init);
}

function flattenEmbedding(output: unknown): number[] | null {
  if (!Array.isArray(output)) {
    return null;
  }

  if (output.every((value) => typeof value === "number")) {
    return output as number[];
  }

  if (
    output.length === 1 &&
    Array.isArray(output[0]) &&
    output[0].every((value) => typeof value === "number")
  ) {
    return output[0] as number[];
  }

  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const token = process.env.HF_TOKEN;

  if (!token) {
    return json(
      {
        ok: false,
        error: "HF_TOKEN 환경변수가 설정되어 있지 않습니다.",
      },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const rawWord = formData.get("word");
  const word = typeof rawWord === "string" ? rawWord.trim() : "";

  if (!word) {
    return json(
      {
        ok: false,
        error: "단어를 입력한 뒤 제출하세요.",
      },
      { status: 400 },
    );
  }

  const response = await fetch(HF_FEATURE_EXTRACTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: `query: ${word}`,
      options: {
        wait_for_model: true,
      },
    }),
  });

  if (!response.ok) {
    let message = "Hugging Face inference 요청에 실패했습니다.";

    try {
      const errorBody = (await response.json()) as { error?: string };
      if (errorBody.error) {
        message = errorBody.error;
      }
    } catch {
      message = `${message} (${response.status})`;
    }

    return json({ ok: false, error: message }, { status: response.status });
  }

  const output: unknown = await response.json();
  const embedding = flattenEmbedding(output);

  if (!embedding || embedding.length !== 384) {
    return json(
      {
        ok: false,
        error: "모델 응답에서 384차원 embedding을 찾지 못했습니다.",
      },
      { status: 502 },
    );
  }

  return json({ ok: true, word, embedding });
}
