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
  CardDescription,
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
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import type { Route } from "./+types/faces.manage";

type ModelStatus = "idle" | "loading" | "ready" | "error";

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

export default function FaceManagement() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<StoredFace[]>([]);
  const [name, setName] = useState("");
  const [group, setGroup] = useState<FaceGroup>("verified");
  const [reason, setReason] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const persistFaces = useCallback((nextFaces: StoredFace[]) => {
    setFaces(nextFaces);
    writeStoredFaces(nextFaces);
  }, []);

  useEffect(() => {
    setFaces(readStoredFaces());
  }, []);

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
              <p className="text-sm text-muted-foreground">
                이 브라우저에 저장된 로컬 얼굴 임베딩
              </p>
            </div>
          </div>
          <Badge variant="secondary">{faces.length} faces</Badge>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="overflow-hidden rounded-lg border bg-black">
          <video
            ref={videoRef}
            className="aspect-video size-full object-cover"
            playsInline
            muted
            autoPlay
            aria-label="얼굴 등록 카메라 미리보기"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>등록 현황</CardTitle>
            <CardDescription>
              인증됨은 cyan, 금지됨은 red 라벨로 인식 화면에 표시됩니다.
            </CardDescription>
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
            <Separator />
            <p className="text-sm text-muted-foreground">
              {cameraError ??
                (modelStatus === "loading"
                  ? "모델을 불러오는 중입니다."
                  : "우측 하단 추가 버튼으로 현재 카메라의 얼굴을 등록합니다.")}
            </p>
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
                      <CardDescription>{formatDate(face.createdAt)}</CardDescription>
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
              <p className="text-sm text-muted-foreground">
                현재 카메라 프레임에서 가장 큰 얼굴을 등록합니다.
              </p>
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
