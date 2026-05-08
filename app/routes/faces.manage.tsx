import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeftIcon,
  CameraIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { FaceDetection } from "~/lib/face-recognition";
import {
  createStoredFace,
  readStoredFaces,
  writeStoredFaces,
  type FaceGroup,
  type StoredFace,
} from "~/lib/face-store";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { Route } from "./+types/faces.manage";

type ModelStatus = "idle" | "loading" | "ready" | "error";
const PREVIEW_INTERVAL_MS = 220;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Face Registry" },
    {
      name: "description",
      content: "Register and manage local face embeddings.",
    },
  ];
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function groupLabel(group: FaceGroup) {
  return group === "verified" ? "인증됨" : "금지됨";
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

function drawRegistrationOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  detection: FaceDetection | null,
  group: FaceGroup,
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

  if (!detection) {
    return;
  }

  context.save();
  context.scale(dpr, dpr);
  const cover = fitCoverRect(
    video.videoWidth,
    video.videoHeight,
    rect.width,
    rect.height,
  );
  const color = group === "verified" ? "#22d3ee" : "#ef4444";
  const x = cover.offsetX + detection.box.x * cover.scale;
  const y = cover.offsetY + detection.box.y * cover.scale;
  const boxWidth = detection.box.width * cover.scale;
  const boxHeight = detection.box.height * cover.scale;

  context.strokeStyle = color;
  context.lineWidth = 3;
  context.strokeRect(x, y, boxWidth, boxHeight);
  context.restore();
}

export default function FaceManagement() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [faces, setFaces] = useState<StoredFace[]>([]);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<FaceGroup>("verified");
  const [reason, setReason] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [previewDetection, setPreviewDetection] = useState<FaceDetection | null>(
    null,
  );

  const persistFaces = useCallback((nextFaces: StoredFace[]) => {
    setFaces(nextFaces);
    writeStoredFaces(nextFaces);
  }, []);

  useEffect(() => {
    setFaces(readStoredFaces());
  }, []);

  useEffect(() => {
    let isMounted = true;
    let timeoutHandle = 0;
    let frameHandle = 0;
    let isProcessing = false;

    async function startPreviewLoop() {
      try {
        const { loadFaceRecognitionEngine } = await import(
          "~/lib/face-recognition"
        );
        const engine = await loadFaceRecognitionEngine();
        if (!isMounted) {
          return;
        }

        const tick = async () => {
          if (!isMounted) {
            return;
          }

          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && !isProcessing && video.videoWidth > 0) {
            isProcessing = true;
            try {
              const detections = await engine.detect(video);
              const largest =
                detections
                  .slice()
                  .sort(
                    (left, right) =>
                      right.box.width * right.box.height -
                      left.box.width * left.box.height,
                  )[0] ?? null;
              setPreviewDetection(largest);
              drawRegistrationOverlay(canvas, video, largest, group);
            } catch {
              setPreviewDetection(null);
              drawRegistrationOverlay(canvas, video, null, group);
            } finally {
              isProcessing = false;
            }
          }

          timeoutHandle = window.setTimeout(() => {
            frameHandle = window.requestAnimationFrame(tick);
          }, PREVIEW_INTERVAL_MS);
        };

        frameHandle = window.requestAnimationFrame(tick);
      } catch {
        setPreviewDetection(null);
      }
    }

    void startPreviewLoop();

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutHandle);
      window.cancelAnimationFrame(frameHandle);
    };
  }, [group]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let isMounted = true;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("이 브라우저는 카메라 접근을 지원하지 않습니다.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 960 },
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
        setCameraError(
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
  }, []);

  async function handleCapture() {
    const trimmedName = name.trim();
    const trimmedReason = reason.trim();

    if (!trimmedName) {
      toast.error("이름을 입력하세요.");
      return;
    }

    if (group === "blocked" && !trimmedReason) {
      toast.error("금지됨 그룹에는 사유가 필요합니다.");
      return;
    }

    if (!videoRef.current || videoRef.current.videoWidth === 0) {
      toast.error("카메라 영상이 아직 준비되지 않았습니다.");
      return;
    }

    setIsCapturing(true);
    setModelStatus((current) => (current === "ready" ? current : "loading"));

    try {
      const { loadFaceRecognitionEngine } = await import(
        "~/lib/face-recognition"
      );
      const engine = await loadFaceRecognitionEngine();
      setModelStatus("ready");
      const capture = await engine.captureRegistration(videoRef.current);

      if (!capture) {
        toast.error("등록할 얼굴을 찾지 못했습니다.");
        return;
      }

      const nextFace = createStoredFace({
        name: trimmedName,
        group,
        reason: group === "blocked" ? trimmedReason : undefined,
        embedding: capture.embedding,
        thumbnailDataUrl: capture.thumbnailDataUrl,
      });
      persistFaces([nextFace, ...faces]);
      setName("");
      setReason("");
      setGroup("verified");
      setIsPopoverOpen(false);
      toast.success(`${trimmedName} 얼굴을 등록했습니다.`);
    } catch (error) {
      setModelStatus("error");
      toast.error(
        error instanceof Error
          ? error.message
          : "얼굴 등록 처리에 실패했습니다.",
      );
    } finally {
      setIsCapturing(false);
    }
  }

  function deleteFace(faceId: string) {
    persistFaces(faces.filter((face) => face.id !== faceId));
    toast.info("등록 얼굴을 삭제했습니다.");
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/82 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="icon" aria-label="얼굴 인식으로 이동">
              <Link to="/faces">
                <ArrowLeftIcon data-icon="inline-start" />
              </Link>
            </Button>
            <div>
              <h1 className="text-lg font-semibold">얼굴 등록 관리</h1>
            </div>
          </div>
          <Badge variant="secondary">{faces.length} faces</Badge>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video
            ref={videoRef}
            className="aspect-video size-full object-cover"
            playsInline
            muted
            autoPlay
            aria-label="얼굴 등록 카메라 미리보기"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 size-full"
            aria-hidden
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>등록 현황</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold text-cyan-600">
                  {faces.filter((face) => face.group === "verified").length}
                </div>
                <div className="text-sm text-muted-foreground">인증됨</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold text-red-600">
                  {faces.filter((face) => face.group === "blocked").length}
                </div>
                <div className="text-sm text-muted-foreground">금지됨</div>
              </div>
            </div>
            {cameraError || modelStatus === "error" ? (
              <p className="text-sm text-muted-foreground">{cameraError}</p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pb-24">
        {faces.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card text-center">
            <UserRoundIcon className="size-9 text-muted-foreground" />
            <div>
              <p className="font-medium">등록된 얼굴이 없습니다.</p>
              <p className="text-sm text-muted-foreground">
                추가 버튼을 눌러 첫 얼굴을 등록하세요.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {faces.map((face) => (
              <Card key={face.id}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {face.thumbnailDataUrl ? (
                        <img
                          src={face.thumbnailDataUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <UserRoundIcon className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate">{face.name}</CardTitle>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(face.createdAt)}
                      </div>
                    </div>
                    <Badge
                      variant={face.group === "blocked" ? "destructive" : "secondary"}
                      className={
                        face.group === "verified"
                          ? "bg-cyan-100 text-cyan-950"
                          : undefined
                      }
                    >
                      {groupLabel(face.group)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="min-h-10 text-sm text-muted-foreground">
                    {face.group === "blocked" ? face.reason : "인증된 얼굴입니다."}
                  </p>
                </CardContent>
                <CardFooter className="justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => deleteFace(face.id)}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    삭제
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            className="fixed bottom-6 right-6 shadow-lg"
            aria-label="얼굴 추가"
          >
            <PlusIcon data-icon="inline-start" />
            추가
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(23rem,calc(100vw-2rem))]">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold">얼굴 추가</h2>
              {previewDetection ? (
                <p className="text-sm text-muted-foreground">
                  score {Math.round(previewDetection.score * 100)}%
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="face-name">이름</Label>
              <Input
                id="face-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 김민수"
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label id="face-group">그룹</Label>
              <ToggleGroup
                type="single"
                value={group}
                onValueChange={(value) => {
                  if (value === "verified" || value === "blocked") {
                    setGroup(value);
                  }
                }}
                aria-labelledby="face-group"
              >
                <ToggleGroupItem value="verified">인증됨</ToggleGroupItem>
                <ToggleGroupItem value="blocked">금지됨</ToggleGroupItem>
              </ToggleGroup>
            </div>
            {group === "blocked" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="face-reason">사유</Label>
                <Textarea
                  id="face-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="예: 도서관 3일 연속 연체"
                />
              </div>
            ) : null}
            <Button type="button" onClick={handleCapture} disabled={isCapturing}>
              {isCapturing ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <CameraIcon data-icon="inline-start" />
              )}
              캡처 등록
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </main>
  );
}
