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
  CameraIcon,
  Loader2Icon,
  SettingsIcon,
} from "lucide-react";

import type { FaceMatch } from "~/lib/face-recognition";
import { readStoredFaces, type StoredFace } from "~/lib/face-store";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import type { Route } from "./+types/faces";

const FRAME_INTERVAL_MS = 150;

type Status = "idle" | "loading" | "ready" | "error";

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
    const label =
      face.group === "blocked" && face.reason
        ? `${face.name} · ${confidence} · ${face.reason}`
        : `${face.name} · ${confidence}`;
    const labelX = x;
    const labelY = Math.max(12, y - 30);
    const labelHeight = 26;
    context.font = "600 13px Geist, sans-serif";
    const labelWidth = Math.min(
      rect.width - labelX - 12,
      context.measureText(label).width + 20,
    );

    context.fillStyle = color;
    context.beginPath();
    context.roundRect(labelX, labelY, labelWidth, labelHeight, 8);
    context.fill();
    context.fillStyle = face.group === "verified" ? "#062027" : "#fff";
    context.fillText(label, labelX + 10, labelY + 17, labelWidth - 20);
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
  const [status, setStatus] = useState<Status>("idle");
  const [statusText, setStatusText] = useState("카메라와 모델을 준비하는 중입니다.");
  const [registeredCount, setRegisteredCount] = useState(0);
  const [detectedCount, setDetectedCount] = useState(0);

  const handleStatusText = useCallback((message: string) => {
    setStatus("error");
    setStatusText(message);
  }, []);

  useCamera(videoRef, handleStatusText);

  useEffect(() => {
    facesRef.current = readStoredFaces();
    setRegisteredCount(facesRef.current.length);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let frameHandle = 0;
    let timeoutHandle = 0;
    let isProcessing = false;

    async function startRecognitionLoop() {
      setStatus("loading");

      try {
        const { loadFaceRecognitionEngine } = await import(
          "~/lib/face-recognition"
        );
        const engine = await loadFaceRecognitionEngine();
        if (!isMounted) {
          return;
        }

        setStatus("ready");
        setStatusText("브라우저 로컬에서 얼굴을 인식하고 있습니다.");

        const tick = async () => {
          if (!isMounted) {
            return;
          }

          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video && canvas && !isProcessing && video.videoWidth > 0) {
            isProcessing = true;
            try {
              const matches = await engine.recognize(video, facesRef.current);
              setDetectedCount(matches.length);
              drawOverlay(canvas, video, matches);
            } catch (error) {
              setStatus("error");
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
        setStatus("error");
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

      <section className="absolute right-4 top-4 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 text-sm font-medium backdrop-blur-md">
          {status === "loading" ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : (
            <CameraIcon data-icon="inline-start" />
          )}
          {statusText}
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">{registeredCount} registered</Badge>
          <Badge variant="outline" className="border-white/35 text-white">
            {detectedCount} detected
          </Badge>
        </div>
      </section>
    </main>
  );
}
