"use client";

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";

/**
 * 직교(Orthogonal) 화살표 엣지
 * - 같은 행(|ΔY| ≤ 40px): 직선 수평 연결
 * - 다른 행: 오른쪽 중앙 → 중간 X → 수직 이동 → 왼쪽 중앙 (꺾인 선)
 */
export default function OrthoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  markerStart,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps) {
  const SAME_ROW_THRESHOLD = 40;

  let path: string;
  if (Math.abs(sourceY - targetY) <= SAME_ROW_THRESHOLD) {
    // 같은 행: 직선
    path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  } else {
    // 다른 행: 꺾인 선 (엘보우)
    const midX = (sourceX + targetX) / 2;
    path = [
      `M ${sourceX},${sourceY}`,
      `H ${midX}`,
      `V ${targetY}`,
      `H ${targetX}`,
    ].join(" ");
  }

  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={style}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              background: "white",
              padding: `${(labelBgPadding as [number, number])?.[1] ?? 4}px ${(labelBgPadding as [number, number])?.[0] ?? 6}px`,
              borderRadius: labelBgBorderRadius ?? 4,
              fontSize: 11,
              fontWeight: 700,
              ...(labelBgStyle as React.CSSProperties || {}),
              ...(labelStyle as React.CSSProperties || {}),
            }}
            className="nodrag nopan"
          >
            {label as React.ReactNode}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// React import needed for JSX
import React from "react";
