import { useEffect, useMemo, useState } from "react";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import type { ProjectedEmbedding } from "~/lib/umap-layout";

type EmbeddingSceneProps = {
  points: ProjectedEmbedding[];
};

type PointNodeProps = {
  point: ProjectedEmbedding;
  color: string;
  isDimmed: boolean;
  isSelected: boolean;
  isSimilar: boolean;
  onSelect: () => void;
};

const POINT_COLORS = ["#0f766e", "#b45309", "#1d4ed8", "#be123c", "#6d28d9"];

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

function lineWidthForSimilarity(similarity: number) {
  const normalized = Math.max(0, Math.min(1, (similarity + 1) / 2));
  return 0.7 + normalized * normalized * 5.6;
}

function PointNode({
  point,
  color,
  isDimmed,
  isSelected,
  isSimilar,
  onSelect,
}: PointNodeProps) {
  const opacity = isDimmed ? 0.16 : 1;
  const labelOpacity = isDimmed ? 0.3 : 1;
  const scale = isSelected ? 1.48 : isSimilar ? 1.18 : 1;

  return (
    <group position={point.position}>
      <mesh
        scale={scale}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
      >
        <sphereGeometry args={[0.16, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isDimmed ? 0.04 : 0.3}
          transparent
          opacity={opacity}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>
      <mesh scale={scale}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isDimmed ? 0.03 : isSelected ? 0.3 : 0.14}
          depthWrite={false}
        />
      </mesh>
      <Html position={[0.38, 0.18, 0]} center pointerEvents="none">
        <span
          className="whitespace-nowrap rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium text-foreground backdrop-blur-md"
          style={{ opacity: labelOpacity }}
        >
          {point.word}
        </span>
      </Html>
    </group>
  );
}

export function EmbeddingScene({ points }: EmbeddingSceneProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && !points.some((point) => point.id === selectedId)) {
      setSelectedId(null);
    }
  }, [points, selectedId]);

  const selectedPoint = useMemo(
    () => points.find((point) => point.id === selectedId) ?? null,
    [points, selectedId],
  );

  const similarityLinks = useMemo(() => {
    if (!selectedPoint) {
      return [];
    }

    return points
      .filter((point) => point.id !== selectedPoint.id)
      .map((point) => ({
        point,
        similarity: cosineSimilarity(selectedPoint.embedding, point.embedding),
      }))
      .sort((left, right) => right.similarity - left.similarity);
  }, [points, selectedPoint]);

  const topSimilarIds = useMemo(
    () => new Set(similarityLinks.slice(0, 5).map((link) => link.point.id)),
    [similarityLinks],
  );

  return (
    <div className="fixed inset-0 embedding-grid">
      <Canvas
        camera={{ position: [0, 0, 10], fov: 48 }}
        dpr={[1, 1.8]}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => setSelectedId(null)}
      >
        <ambientLight intensity={2.2} />
        <pointLight position={[8, 8, 8]} intensity={24} />
        <gridHelper args={[12, 12, "#b4b09f", "#d4d0bf"]} />
        <axesHelper args={[3]} />

        {selectedPoint
          ? similarityLinks.map((link) => {
              const isTopSimilar = topSimilarIds.has(link.point.id);

              return (
                <Line
                  key={`${selectedPoint.id}-${link.point.id}`}
                  points={[selectedPoint.position, link.point.position]}
                  color={isTopSimilar ? "#0f766e" : "#8f8a78"}
                  lineWidth={lineWidthForSimilarity(link.similarity)}
                  transparent
                  opacity={isTopSimilar ? 0.76 : 0.14}
                />
              );
            })
          : null}

        {points.map((point, index) => {
          const isSelected = selectedId === point.id;
          const isSimilar = topSimilarIds.has(point.id);
          const isDimmed = Boolean(selectedPoint) && !isSelected && !isSimilar;

          return (
            <PointNode
              key={point.id}
              point={point}
              color={POINT_COLORS[index % POINT_COLORS.length]}
              isDimmed={isDimmed}
              isSelected={isSelected}
              isSimilar={isSimilar}
              onSelect={() => setSelectedId(point.id)}
            />
          );
        })}

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={3}
          maxDistance={22}
        />
      </Canvas>
    </div>
  );
}
