import { mkdir, copyFile, stat, readdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelDir = join(rootDir, "public", "models", "face");
const ortDir = join(rootDir, "public", "ort");
const ortDistDir = join(rootDir, "node_modules", "onnxruntime-web", "dist");

const downloads = [
  {
    label: "BlazeFace detector",
    url: "https://huggingface.co/garavv/blazeface-onnx/resolve/main/blaze.onnx",
    target: join(modelDir, "blaze.onnx"),
  },
  {
    label: "ArcFace embedder",
    url: "https://huggingface.co/garavv/arcface-onnx/resolve/main/arc.onnx",
    target: join(modelDir, "arc.onnx"),
  },
];

async function fileExists(path) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function downloadFile({ label, url, target }) {
  if (await fileExists(target)) {
    console.log(`${label}: already present`);
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`${label}: download failed (${response.status})`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  let receivedBytes = 0;
  const tempTarget = `${target}.tmp`;
  await rm(tempTarget, { force: true });
  const file = createWriteStream(tempTarget);
  const reader = response.body.getReader();
  let lastReportedPercent = -1;

  console.log(`${label}: downloading`);

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    receivedBytes += value.byteLength;
    file.write(value);

    if (totalBytes > 0) {
      const percent = Math.floor((receivedBytes / totalBytes) * 100);
      if (percent === 100 || percent >= lastReportedPercent + 10) {
        lastReportedPercent = percent;
        console.log(`${label}: ${percent}%`);
      }
    }
  }

  await new Promise((resolveWrite, rejectWrite) => {
    file.end((error) => {
      if (error) {
        rejectWrite(error);
      } else {
        resolveWrite();
      }
    });
  });

  await rename(tempTarget, target);
  console.log(`${label}: ready`);
}

async function copyOrtRuntimeFiles() {
  await mkdir(ortDir, { recursive: true });
  const files = await readdir(ortDistDir);
  const runtimeFiles = files.filter(
    (file) =>
      file.startsWith("ort-wasm-simd-threaded") &&
      (file.endsWith(".wasm") || file.endsWith(".mjs")),
  );

  await Promise.all(
    runtimeFiles.map((file) =>
      copyFile(join(ortDistDir, file), join(ortDir, file)),
    ),
  );

  console.log(`ONNX Runtime: copied ${runtimeFiles.length} wasm runtime files`);
}

await Promise.all(downloads.map(downloadFile));
await copyOrtRuntimeFiles();
