import type { StoredFace } from "~/lib/face-store";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

export const DETECTION_THRESHOLD = 0.65;
export const MATCH_THRESHOLD = 0.55;

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FaceDetection = {
  box: FaceBox;
  score: number;
};

export type FaceMatch = {
  box: FaceBox;
  score: number;
  bestSimilarity?: number;
  face?: StoredFace;
  thumbnailDataUrl?: string;
};

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = import("onnxruntime-web").InferenceSession;

const DETECTOR_SIZE = 128;
const EMBEDDER_SIZE = 112;
const MAX_DETECTIONS = 25n;
const IOU_THRESHOLD = 0.3;
const MODEL_ROOT = "/models/face";

let sharedEnginePromise: Promise<FaceRecognitionEngine> | null = null;

function fitContainRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    scale,
    width,
    height,
    offsetX: (targetWidth - width) / 2,
    offsetY: (targetHeight - height) / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function l2Normalize(values: number[]) {
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;

  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return dot;
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  return canvas;
}

export function createVideoThumbnail(
  video: HTMLVideoElement,
  box: FaceBox,
  size = 144,
) {
  const canvas = makeCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }

  const padding = Math.max(box.width, box.height) * 0.18;
  const sourceX = clamp(box.x - padding, 0, video.videoWidth);
  const sourceY = clamp(box.y - padding, 0, video.videoHeight);
  const sourceWidth = clamp(box.width + padding * 2, 1, video.videoWidth - sourceX);
  const sourceHeight = clamp(
    box.height + padding * 2,
    1,
    video.videoHeight - sourceY,
  );

  context.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    size,
    size,
  );

  return canvas.toDataURL("image/jpeg", 0.78);
}

function getFirstTensor(
  results: Awaited<ReturnType<OrtSession["run"]>>,
  names: readonly string[],
  index: number,
) {
  return results[names[index] ?? Object.keys(results)[index]];
}

async function importOrt() {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  return {
    ort,
    providers: ["wasm"] satisfies string[],
  };
}

async function createSession(
  ort: OrtModule,
  modelPath: string,
  providers: string[],
) {
  try {
    return await ort.InferenceSession.create(modelPath, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });
  } catch (error) {
    if (providers.includes("wasm")) {
      return await ort.InferenceSession.create(modelPath, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    }

    throw error;
  }
}

function videoIsReady(video: HTMLVideoElement) {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0;
}

export class FaceRecognitionEngine {
  private detectorCanvas = makeCanvas(DETECTOR_SIZE, DETECTOR_SIZE);
  private embedderCanvas = makeCanvas(EMBEDDER_SIZE, EMBEDDER_SIZE);

  private constructor(
    private ort: OrtModule,
    private detector: OrtSession,
    private embedder: OrtSession,
  ) {}

  static async create() {
    const { ort, providers } = await importOrt();
    const detector = await createSession(
      ort,
      `${MODEL_ROOT}/blaze.onnx`,
      providers,
    );
    const embedder = await createSession(ort, `${MODEL_ROOT}/arc.onnx`, providers);

    return new FaceRecognitionEngine(ort, detector, embedder);
  }

  async detect(video: HTMLVideoElement) {
    if (!videoIsReady(video)) {
      return [];
    }

    const context = this.detectorCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) {
      return [];
    }

    context.fillStyle = "black";
    context.fillRect(0, 0, DETECTOR_SIZE, DETECTOR_SIZE);
    const detectorRect = fitContainRect(
      video.videoWidth,
      video.videoHeight,
      DETECTOR_SIZE,
      DETECTOR_SIZE,
    );
    context.drawImage(
      video,
      detectorRect.offsetX,
      detectorRect.offsetY,
      detectorRect.width,
      detectorRect.height,
    );
    const imageData = context.getImageData(0, 0, DETECTOR_SIZE, DETECTOR_SIZE);
    const pixels = imageData.data;
    const tensorData = new Float32Array(1 * 3 * DETECTOR_SIZE * DETECTOR_SIZE);
    const planeSize = DETECTOR_SIZE * DETECTOR_SIZE;

    for (let index = 0; index < planeSize; index += 1) {
      const pixelIndex = index * 4;
      tensorData[index] = (pixels[pixelIndex] ?? 0) / 255;
      tensorData[planeSize + index] = (pixels[pixelIndex + 1] ?? 0) / 255;
      tensorData[planeSize * 2 + index] = (pixels[pixelIndex + 2] ?? 0) / 255;
    }

    const feeds: Record<string, import("onnxruntime-web").Tensor> = {
      image: new this.ort.Tensor("float32", tensorData, [
        1,
        3,
        DETECTOR_SIZE,
        DETECTOR_SIZE,
      ]),
      conf_threshold: new this.ort.Tensor(
        "float32",
        new Float32Array([DETECTION_THRESHOLD]),
        [1],
      ),
      max_detections: new this.ort.Tensor(
        "int64",
        new BigInt64Array([MAX_DETECTIONS]),
        [1],
      ),
      iou_threshold: new this.ort.Tensor(
        "float32",
        new Float32Array([IOU_THRESHOLD]),
        [1],
      ),
    };

    const namedFeeds = Object.fromEntries(
      this.detector.inputNames.map((name) => [name, feeds[name] ?? feeds.image]),
    );
    const results = await this.detector.run(namedFeeds);
    const boxesTensor = getFirstTensor(results, this.detector.outputNames, 0);
    const scoresTensor = getFirstTensor(results, this.detector.outputNames, 1);

    if (!boxesTensor) {
      return [];
    }

    const boxes = Array.from(boxesTensor.data as Float32Array);
    const scores = scoresTensor
      ? Array.from(scoresTensor.data as Float32Array)
      : [];
    const dims = boxesTensor.dims;
    const stride = dims[dims.length - 1] ?? 16;
    const count =
      dims.length >= 2 ? boxes.length / stride : Math.floor(boxes.length / 16);
    const detections: FaceDetection[] = [];

    for (let index = 0; index < count; index += 1) {
      const offset = index * stride;
      const score = scores[index] ?? 1;
      if (score < DETECTION_THRESHOLD) {
        continue;
      }

      const topY = clamp(boxes[offset] ?? 0, 0, 1) * DETECTOR_SIZE;
      const topX = clamp(boxes[offset + 1] ?? 0, 0, 1) * DETECTOR_SIZE;
      const bottomY = clamp(boxes[offset + 2] ?? 0, 0, 1) * DETECTOR_SIZE;
      const bottomX = clamp(boxes[offset + 3] ?? 0, 0, 1) * DETECTOR_SIZE;
      const x = clamp(
        (topX - detectorRect.offsetX) / detectorRect.scale,
        0,
        video.videoWidth,
      );
      const y = clamp(
        (topY - detectorRect.offsetY) / detectorRect.scale,
        0,
        video.videoHeight,
      );
      const right = clamp(
        (bottomX - detectorRect.offsetX) / detectorRect.scale,
        0,
        video.videoWidth,
      );
      const bottom = clamp(
        (bottomY - detectorRect.offsetY) / detectorRect.scale,
        0,
        video.videoHeight,
      );
      const width = right - x;
      const height = bottom - y;

      if (width > 0.5 && height > 0.5) {
        detections.push({ box: { x, y, width, height }, score });
      }
    }

    return detections;
  }

  async embed(video: HTMLVideoElement, box: FaceBox) {
    if (!videoIsReady(video)) {
      return null;
    }

    const context = this.embedderCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) {
      return null;
    }

    const padding = Math.max(box.width, box.height) * 0.16;
    const sourceX = clamp(box.x - padding, 0, video.videoWidth);
    const sourceY = clamp(box.y - padding, 0, video.videoHeight);
    const sourceWidth = clamp(box.width + padding * 2, 1, video.videoWidth - sourceX);
    const sourceHeight = clamp(
      box.height + padding * 2,
      1,
      video.videoHeight - sourceY,
    );

    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      EMBEDDER_SIZE,
      EMBEDDER_SIZE,
    );

    const imageData = context.getImageData(0, 0, EMBEDDER_SIZE, EMBEDDER_SIZE);
    const pixels = imageData.data;
    const tensorData = new Float32Array(1 * EMBEDDER_SIZE * EMBEDDER_SIZE * 3);

    for (let index = 0; index < EMBEDDER_SIZE * EMBEDDER_SIZE; index += 1) {
      const pixelIndex = index * 4;
      const tensorIndex = index * 3;
      tensorData[tensorIndex] = ((pixels[pixelIndex] ?? 0) - 127.5) / 128;
      tensorData[tensorIndex + 1] =
        ((pixels[pixelIndex + 1] ?? 0) - 127.5) / 128;
      tensorData[tensorIndex + 2] =
        ((pixels[pixelIndex + 2] ?? 0) - 127.5) / 128;
    }

    const inputName = this.embedder.inputNames[0] ?? "input";
    const outputName = this.embedder.outputNames[0];
    const results = await this.embedder.run({
      [inputName]: new this.ort.Tensor("float32", tensorData, [
        1,
        EMBEDDER_SIZE,
        EMBEDDER_SIZE,
        3,
      ]),
    });
    const embeddingTensor = outputName
      ? results[outputName]
      : results[Object.keys(results)[0]];

    if (!embeddingTensor) {
      return null;
    }

    const embedding = Array.from(embeddingTensor.data as Float32Array);
    if (embedding.length !== 512) {
      return null;
    }

    return l2Normalize(embedding);
  }

  async recognize(video: HTMLVideoElement, faces: StoredFace[]) {
    const detections = await this.detect(video);
    const matches: FaceMatch[] = [];

    for (const detection of detections) {
      const embedding = await this.embed(video, detection.box);
      let bestFace: StoredFace | undefined;
      let bestSimilarity = -1;

      if (embedding) {
        for (const face of faces) {
          const similarity = cosineSimilarity(embedding, face.embedding);
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestFace = face;
          }
        }
      }

      matches.push({
        ...detection,
        bestSimilarity: bestSimilarity >= 0 ? bestSimilarity : undefined,
        face:
          bestFace && bestSimilarity >= MATCH_THRESHOLD ? bestFace : undefined,
        thumbnailDataUrl: createVideoThumbnail(video, detection.box, 112),
      });
    }

    return matches;
  }

  async captureRegistration(video: HTMLVideoElement) {
    const detections = await this.detect(video);
    const largest = detections.sort(
      (left, right) =>
        right.box.width * right.box.height - left.box.width * left.box.height,
    )[0];

    if (!largest) {
      return null;
    }

    const embedding = await this.embed(video, largest.box);
    if (!embedding) {
      return null;
    }

    return {
      embedding,
      thumbnailDataUrl: createVideoThumbnail(video, largest.box),
      detection: largest,
    };
  }
}

export function loadFaceRecognitionEngine() {
  sharedEnginePromise ??= FaceRecognitionEngine.create().catch((error) => {
    sharedEnginePromise = null;
    throw error;
  });
  return sharedEnginePromise;
}
