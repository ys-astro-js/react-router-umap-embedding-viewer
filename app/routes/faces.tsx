import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Link } from "react-router";
import {
  ArrowLeftIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react";

import type { FaceMatch } from "~/lib/face-recognition";
import { readStoredFaces, type StoredFace } from "~/lib/face-store";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/faces";

const FRAME_INTERVAL_MS = 150;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Face Recognition Demo" },
    {
      name: "description",
      content: "Recognize registered faces locally in the browser.",
    },
  ];
}

function fitCoverRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    scale,
    offsetX: (targetWidth - width) / 2,
    offsetY: (targetHeight - height) / 2,
  };
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  matches: FaceMatch[],
) {
  const context = canvas.getContext("2d");
  if (!context || video.videoWidth === 0 || video.videoHeight === 0) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  context.save();
  context.scale(dpr, dpr);

  const cover = fitCoverRect(
    video.videoWidth,
    video.videoHeight,
    rect.width,
    rect.height,
  );

  for (const match of matches) {
    const face = match.face;
    const color =
      face?.group === "verified"
        ? "#22d3ee"
        : face?.group === "blocked"
          ? "#ef4444"
          : "#ffffff";
    const x = cover.offsetX + match.box.x * cover.scale;
    const y = cover.offsetY + match.box.y * cover.scale;
    const boxWidth = match.box.width * cover.scale;
    const boxHeight = match.box.height * cover.scale;

    context.strokeStyle = color;
    context.lineWidth = 3;
    context.setLineDash(face ? [] : [10, 8]);
    context.strokeRect(x, y, boxWidth, boxHeight);
    context.setLineDash([]);

    if (!face || match.bestSimilarity === undefined) {
      continue;
    }

    const confidence = `${Math.round(match.bestSimilarity * 100)}%`;
    context.font = "700 16px Geist, sans-serif";
    const nameWidth = context.measureText(face.name).width + 18;
    context.font = "700 14px Geist, sans-serif";
    const confidenceWidth = context.measureText(confidence).width + 14;
    const reason = face.group === "blocked" ? face.reason : undefined;
    const reasonWidth = reason ? context.measureText(reason).width + 16 : 0;
    const labelWidth = Math.min(
      rect.width - 12,
      Math.max(nameWidth + confidenceWidth, reasonWidth),
    );
    const labelHeight = reason ? 52 : 28;
    const prefersRight = x + boxWidth + labelWidth + 8 <= rect.width;
    const labelX = prefersRight
      ? x + boxWidth + 8
      : clamp(x, 8, Math.max(8, rect.width - labelWidth - 8));
    const labelY = prefersRight
      ? clamp(y, 8, Math.max(8, rect.height - labelHeight - 8))
      : clamp(y + boxHeight + 8, 8, Math.max(8, rect.height - labelHeight - 8));

    context.fillStyle = color;
    context.fillRect(labelX, labelY, Math.min(nameWidth, labelWidth), 28);
    context.fillStyle = "black";
    context.font = "700 16px Geist, sans-serif";
    context.fillText(face.name, labelX + 9, labelY + 20, nameWidth - 18);

    context.fillStyle = "black";
    context.fillRect(
      labelX + Math.min(nameWidth, labelWidth),
      labelY,
      Math.min(confidenceWidth, labelWidth - Math.min(nameWidth, labelWidth)),
      28,
    );
    context.fillStyle = "#fff";
    context.font = "700 14px Geist, sans-serif";
    context.fillText(
      confidence,
      labelX + Math.min(nameWidth, labelWidth) + 7,
      labelY + 19,
      confidenceWidth - 14,
    );

    if (reason) {
      context.fillStyle = "black";
      context.fillRect(labelX, labelY + 32, labelWidth, 20);
      context.fillStyle = "#fff";
      context.font = "600 12px Geist, sans-serif";
      context.fillText(reason, labelX + 8, labelY + 47, labelWidth - 16);
    }
  }

  context.restore();
}

function useCamera(
  videoRef: MutableRefObject<HTMLVideoElement | null>,
  setStatusText: (message: string) => void,
) {
  useEffect(() => {
    let stream: MediaStream | null = null;
    let isMounted = true;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatusText("이 브라우저는 카메라 접근을 지원하지 않습니다.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!isMounted || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      } catch (error) {
        setStatusText(
          error instanceof Error
            ? error.message
            : "카메라 권한을 얻지 못했습니다.",
        );
      }
    }

    void startCamera();

    return () => {
      isMounted = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [setStatusText, videoRef]);
}

export default function Faces() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const facesRef = useRef<StoredFace[]>([]);
  const [statusText, setStatusText] = useState("");
  const [matches, setMatches] = useState<FaceMatch[]>([]);

  const handleStatusText = useCallback((message: string) => {
    setStatusText(message);
  }, []);

  useCamera(videoRef, handleStatusText);

  useEffect(() => {
    facesRef.current = readStoredFaces();
  }, []);

  useEffect(() => {
    let isMounted = true;
    let frameHandle = 0;
    let timeoutHandle = 0;
    let isProcessing = false;

    async function startRecognitionLoop() {
      try {
        const { loadFaceRecognitionEngine } = await import(
          "~/lib/face-recognition"
        );
        const engine = await loadFaceRecognitionEngine();
        if (!isMounted) {
          return;
        }

        setStatusText("");

        const tick = async () => {
          if (!isMounted) {
            return;
          }

          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video && canvas && !isProcessing && video.videoWidth > 0) {
            isProcessing = true;
            try {
              const nextMatches = await engine.recognize(video, facesRef.current);
              setMatches(nextMatches);
              drawOverlay(canvas, video, nextMatches);
            } catch (error) {
              setStatusText(
                error instanceof Error
                  ? error.message
                  : "얼굴 인식 처리에 실패했습니다.",
              );
            } finally {
              isProcessing = false;
            }
          }

          timeoutHandle = window.setTimeout(() => {
            frameHandle = window.requestAnimationFrame(tick);
          }, FRAME_INTERVAL_MS);
        };

        frameHandle = window.requestAnimationFrame(tick);
      } catch (error) {
        setStatusText(
          error instanceof Error
            ? error.message
            : "얼굴 인식 모델을 불러오지 못했습니다.",
        );
      }
    }

    void startRecognitionLoop();

    return () => {
      isMounted = false;
      window.cancelAnimationFrame(frameHandle);
      window.clearTimeout(timeoutHandle);
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        playsInline
        muted
        autoPlay
        aria-label="얼굴 인식 카메라 영상"
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden
      />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.58),rgba(0,0,0,0.08)_32%,rgba(0,0,0,0.58))]" />

      <div className="absolute left-4 top-4 flex items-center gap-2">
        <Button asChild variant="secondary" size="icon" aria-label="UMAP으로 이동">
          <Link to="/">
            <ArrowLeftIcon data-icon="inline-start" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/faces/manage">
            <SettingsIcon data-icon="inline-start" />
            얼굴 관리
          </Link>
        </Button>
      </div>

      <section className="absolute right-4 top-4 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {statusText ? (
          <div className="bg-black/75 px-3 py-2 text-sm font-medium text-white backdrop-blur-md">
            {statusText}
          </div>
        ) : null}
        {matches.map((match, index) => {
          const face = match.face;
          const color =
            face?.group === "verified"
              ? "border-cyan-400 text-cyan-300"
              : face?.group === "blocked"
                ? "border-red-500 text-red-400"
                : "border-white/70 text-white";
          const confidence =
            match.bestSimilarity === undefined
              ? "-"
              : `${Math.round(match.bestSimilarity * 100)}%`;

          return (
            <article
              key={`${index}-${Math.round(match.box.x)}-${Math.round(match.box.y)}`}
              className={`border bg-black/72 p-2 backdrop-blur-md ${color}`}
            >
              <div className="grid grid-cols-2 gap-2">
                <div className="flex aspect-square items-center justify-center overflow-hidden bg-white/10">
                  {match.thumbnailDataUrl ? (
                    <img
                      src={match.thumbnailDataUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserRoundIcon />
                  )}
                </div>
                <div className="flex aspect-square items-center justify-center overflow-hidden bg-white/10">
                  {face?.thumbnailDataUrl ? (
                    <img
                      src={face.thumbnailDataUrl}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserRoundIcon />
                  )}
                </div>
              </div>
              <div className="mt-2 min-w-0">
                <div className="flex items-start">
                  <span className="truncate text-lg font-semibold leading-none">
                    {face?.name ?? "Unknown"}
                  </span>
                  <span className="bg-black px-1.5 text-sm font-semibold leading-none text-white">
                    {confidence}
                  </span>
                </div>
                <div className="mt-1 text-xs text-white/70">
                  {face ? (face.group === "verified" ? "인증됨" : "금지됨") : "미등록"}
                </div>
                {face?.reason ? (
                  <div className="mt-2 bg-black px-2 py-1 text-xs text-white">
                    {face.reason}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
