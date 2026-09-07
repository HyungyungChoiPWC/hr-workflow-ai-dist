"use client";

/**
 * SwimLaneOverlay — PPT-proportioned slide frame overlay
 *
 * Visual overlay rendered inside ReactFlow (pointer-events: none).
 * Drag handles rendered via portal to document.body to avoid
 * ReactFlow event interception.
 */

import { useViewport, useNodes, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  lanes?: string[];
  swimHeight?: number;
  laneHeights?: number[];
  onLaneHeightsChange?: (heights: number[]) => void;
  canvasRef?: React.RefObject<HTMLDivElement | null>;
}

const DEFAULT_LANES = ["현업 임원", "팀장", "HR 담당자", "구성원"];
const MIN_LANE_H = 80;

/* ── PPT constants (must match ExportToolbar) ── */
const PPT_W         = 13.33;
const PPT_H         = 7.5;
const PPT_PAD_X     = 1.25;
const PPT_PAD_TOP   = 1.575;
const PPT_PAD_BOT   = 0.35;
const PPT_SL_BOTTOM = PPT_H - PPT_PAD_BOT + 0.05;
const PPT_MAX_SWIM_H = PPT_SL_BOTTOM - 0.65;

/* ── Node canvas sizes ── */
const NS: Record<string, { w: number; h: number }> = {
  L2: { w: 720, h: 260 },
  L3: { w: 660, h: 240 },
  L4: { w: 600, h: 220 },
  L5: { w: 540, h: 389 },
};
const DEF_NS = NS.L4;
const SC_REF = 0.787 / DEF_NS.h;

/* ── Styles ── */
const FRAME_STROKE  = "#94A3B8";
const DIVIDER_COLOR = "#B0B0B0";
const TITLE_FILL    = "rgba(241,245,249,0.5)";
const OVERFLOW_FILL = "rgba(254,226,226,0.15)";
const MARGIN_COLOR  = "#CBD5E1";
const HANDLE_COLOR  = "#6366F1";

export default function SwimLaneOverlay({
  lanes = DEFAULT_LANES,
  swimHeight: swimHeightProp = 2400,
  laneHeights: laneHeightsProp,
  onLaneHeightsChange,
  canvasRef,
}: Props) {
  const { x, y, zoom } = useViewport();
  const allNodes = useNodes();
  const { flowToScreenPosition } = useReactFlow();

  /* ── Effective lane heights ── */
  const defaultH = swimHeightProp / lanes.length;
  const baseHeights: number[] = (laneHeightsProp && laneHeightsProp.length === lanes.length)
    ? laneHeightsProp
    : Array(lanes.length).fill(defaultH);

  const [draggingHeights, setDraggingHeights] = useState<number[] | null>(null);
  const [hoveredDivider, setHoveredDivider] = useState<number | null>(null);
  const laneHeights = draggingHeights || baseHeights;
  const swimHeight = laneHeights.reduce((a, b) => a + b, 0);

  /* Cumulative Y positions (canvas pixels) */
  const cumulativeY: number[] = [];
  let acc = 0;
  for (let i = 0; i < laneHeights.length; i++) {
    cumulativeY.push(acc);
    acc += laneHeights[i];
  }

  /* ── Drag refs ── */
  const dragRef = useRef<{
    dividerIndex: number;
    startY: number;
    startHeights: number[];
  } | null>(null);
  const currentDragHeightsRef = useRef<number[] | null>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const onChangeRef = useRef(onLaneHeightsChange);
  useEffect(() => { onChangeRef.current = onLaneHeightsChange; }, [onLaneHeightsChange]);

  /* Global mouse move/up for drag */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { dividerIndex, startY, startHeights } = dragRef.current;
      const dy = (e.clientY - startY) / zoomRef.current;
      const total = startHeights[dividerIndex] + startHeights[dividerIndex + 1];
      const newAbove = Math.max(MIN_LANE_H, Math.min(total - MIN_LANE_H, startHeights[dividerIndex] + dy));
      const newHeights = [...startHeights];
      newHeights[dividerIndex] = newAbove;
      newHeights[dividerIndex + 1] = total - newAbove;
      currentDragHeightsRef.current = newHeights;
      setDraggingHeights([...newHeights]);
    };

    const onMouseUp = () => {
      if (!dragRef.current) return;
      if (currentDragHeightsRef.current) {
        onChangeRef.current?.(currentDragHeightsRef.current);
      }
      dragRef.current = null;
      currentDragHeightsRef.current = null;
      setDraggingHeights(null);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      dividerIndex: idx,
      startY: e.clientY,
      startHeights: [...laneHeights],
    };
  }, [laneHeights]);

  /* ── Y-axis scale ── */
  const PPT_SWIM_BAND = Math.min(1.535, PPT_MAX_SWIM_H / lanes.length);
  const totalSwimIn = PPT_SWIM_BAND * lanes.length;
  const px1 = swimHeight / totalSwimIn;
  const slTop = PPT_SL_BOTTOM - totalSwimIn;

  /* ── X-axis: compute sc from bbox ── */
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const nd of allNodes) {
    const lv = (nd.data as Record<string, string>)?.level || "L4";
    const s = NS[lv] || DEF_NS;
    bMinX = Math.min(bMinX, nd.position.x);
    bMinY = Math.min(bMinY, nd.position.y);
    bMaxX = Math.max(bMaxX, nd.position.x + s.w);
    bMaxY = Math.max(bMaxY, nd.position.y + s.h);
  }
  if (!isFinite(bMinX)) { bMinX = 0; bMinY = 0; bMaxX = 3000; bMaxY = swimHeight; }
  const bRangeX = (bMaxX - bMinX) || 1;
  const bRangeY = (bMaxY - bMinY) || 1;

  const areaW = PPT_W - 2 * PPT_PAD_X;
  const areaH = PPT_H - PPT_PAD_TOP - PPT_PAD_BOT;
  const scFit = Math.min(areaW / bRangeX, areaH / bRangeY);
  const sc = Math.min(scFit, SC_REF);

  /* ── Frame in canvas coords ── */
  const frameL = bMinX - PPT_PAD_X / sc;
  const frameW = PPT_W / sc;
  const frameT = -(slTop * px1);
  const frameH = PPT_H * px1;

  const titleH = -frameT;
  const contentL = PPT_PAD_X / sc;
  const contentR = (PPT_W - PPT_PAD_X) / sc;
  const extW = frameW + 800;
  const extH = frameH + 300;
  const isDragging = draggingHeights !== null;

  /* ── Screen coords for portal handles ── */
  // flowToScreenPosition converts canvas (flow) coords → viewport (screen) coords
  const handleScreenPositions = cumulativeY.slice(1).map((canvasY) =>
    flowToScreenPosition({ x: frameL + frameW / 2, y: canvasY })
  );
  const frameScreenLeft  = flowToScreenPosition({ x: frameL, y: 0 }).x;
  const frameScreenRight = flowToScreenPosition({ x: frameL + frameW, y: 0 }).x;

  return (
    <>
      {/* ── Visual overlay (non-interactive, inside ReactFlow) ── */}
      <div style={{
        position: "absolute", top: 0, left: 0,
        width: "100%", height: "100%",
        overflow: "hidden", pointerEvents: "none", zIndex: 1,
      }}>
        <div style={{
          position: "absolute", left: 0, top: 0,
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        }}>
          <svg
            width={extW}
            height={extH}
            style={{ position: "absolute", left: frameL, top: frameT }}
          >
            {/* Overflow zones */}
            <rect x={frameW} y={0} width={extW - frameW} height={frameH} fill={OVERFLOW_FILL} />
            <rect x={0} y={frameH} width={extW} height={extH - frameH} fill={OVERFLOW_FILL} />

            {/* Title area */}
            <rect x={1} y={1} width={frameW - 2} height={Math.max(titleH - 1, 0)} fill={TITLE_FILL} />

            {/* Bottom margin */}
            {(() => {
              const botY = titleH + swimHeight;
              const botH = frameH - botY;
              return botH > 1
                ? <rect x={1} y={botY} width={frameW - 2} height={botH - 1} fill={TITLE_FILL} />
                : null;
            })()}

            {/* Slide frame border */}
            <rect x={0} y={0} width={frameW} height={frameH}
              fill="none" stroke={FRAME_STROKE} strokeWidth={2} rx={2} />

            {/* Content margin guides */}
            <line x1={contentL} y1={titleH} x2={contentL} y2={titleH + swimHeight}
              stroke={MARGIN_COLOR} strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />
            <line x1={contentR} y1={titleH} x2={contentR} y2={titleH + swimHeight}
              stroke={MARGIN_COLOR} strokeWidth={1} strokeDasharray="6 4" opacity={0.5} />

            {/* Swim lane dividers */}
            {Array.from({ length: lanes.length + 1 }, (_, i) => {
              const yPos = titleH + (i < lanes.length ? cumulativeY[i] : swimHeight);
              const isInner = i > 0 && i < lanes.length;
              const isHov = isInner && hoveredDivider === i - 1;
              const isAct = isInner && isDragging && dragRef.current?.dividerIndex === i - 1;
              return (
                <line key={`d${i}`}
                  x1={0} y1={yPos} x2={frameW} y2={yPos}
                  stroke={isAct || isHov ? HANDLE_COLOR : DIVIDER_COLOR}
                  strokeWidth={isAct ? 2.5 : isHov ? 2 : 1.5}
                  strokeDasharray={isAct ? "none" : "10 6"}
                />
              );
            })}

            {/* Height labels during drag */}
            {isDragging && laneHeights.map((h, i) => (
              <text key={`ht${i}`}
                x={frameW - 8}
                y={titleH + cumulativeY[i] + h / 2 + 4}
                fontSize={10} fill={HANDLE_COLOR} textAnchor="end"
                fontFamily="'Noto Sans KR',sans-serif" opacity={0.9}>
                {Math.round(h)}px
              </text>
            ))}

            {/* PPT badge */}
            <rect x={6} y={6} width={120} height={20} rx={3} fill="white" fillOpacity={0.9} />
            <text x={12} y={20} fontSize={11} fill="#64748B" fontWeight="600"
              fontFamily="'Noto Sans KR',sans-serif">PPT 슬라이드</text>

            {titleH > 80 && (
              <text x={frameW / 2} y={titleH / 2 + 4} fontSize={12} fill="#94A3B8"
                textAnchor="middle" fontFamily="'Noto Sans KR',sans-serif">제목 영역</text>
            )}
            <text x={frameW + 12} y={titleH + swimHeight / 2} fontSize={11} fill="#EF4444"
              opacity={0.5} fontWeight="500" fontFamily="'Noto Sans KR',sans-serif">
              ← PPT 경계
            </text>
          </svg>

          {/* Lane labels */}
          {lanes.map((label, i) => (
            <div key={`lbl-${i}`} style={{
              position: "absolute",
              left: frameL + 12,
              top: cumulativeY[i] + 10,
              width: 120, height: 30,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#FFF", border: "1.5px solid #B0B0B0", borderRadius: 2,
            }}>
              <span style={{
                fontSize: 13, fontWeight: 500,
                fontFamily: "'Noto Sans KR',sans-serif",
                color: "#333", whiteSpace: "nowrap", lineHeight: 1,
              }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Drag handles: rendered via portal to document.body ── */}
      {/* Portal bypasses ReactFlow's event system entirely */}
      {onLaneHeightsChange && lanes.length > 1 && typeof document !== "undefined" &&
        createPortal(
          <>
            {Array.from({ length: lanes.length - 1 }, (_, i) => {
              const screenY = handleScreenPositions[i]?.y ?? 0;
              const isActive = isDragging && dragRef.current?.dividerIndex === i;
              const isHovered = hoveredDivider === i;
              // 프레임 가로 중앙에 핸들 배치 — 캔버스 경계로 클리핑
              const canvasRect  = canvasRef?.current?.getBoundingClientRect();
              const canvasLeft  = canvasRect?.left   ?? 0;
              const canvasRight = canvasRect?.right  ?? window.innerWidth;
              const canvasTop   = canvasRect?.top    ?? 0;
              const canvasBot   = canvasRect?.bottom ?? window.innerHeight;
              const width = 160;
              const frameCenterX = (frameScreenLeft + frameScreenRight) / 2;
              // 중앙 정렬, 캔버스 안으로 클리핑
              const left = Math.min(
                Math.max(canvasLeft, frameCenterX - width / 2),
                canvasRight - width
              );
              // 캔버스 수직 범위 밖이면 숨김
              const visible = screenY >= canvasTop && screenY <= canvasBot;
              return (
                <div
                  key={`portal-handle-${i}`}
                  style={{
                    position: "fixed",
                    left,
                    top: screenY - 12,
                    width,
                    height: 24,
                    cursor: "row-resize",
                    zIndex: 9999,
                    display: visible ? "flex" : "none",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  onMouseEnter={() => setHoveredDivider(i)}
                  onMouseLeave={() => setHoveredDivider(null)}
                  onMouseDown={(e) => handleDividerMouseDown(e, i)}
                >
                  {/* Grip indicator — always visible, highlights on hover */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "3px 8px",
                    borderRadius: 10,
                    background: isActive ? HANDLE_COLOR : isHovered ? "#818CF8" : "rgba(150,150,150,0.55)",
                    boxShadow: isHovered || isActive ? "0 2px 8px rgba(99,102,241,0.4)" : "none",
                    transition: "all 0.15s",
                    pointerEvents: "none",
                  }}>
                    {[0,1,2,3,4].map(j => (
                      <div key={j} style={{
                        width: 4, height: 4,
                        borderRadius: "50%",
                        background: "#fff",
                      }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </>,
          document.body
        )
      }
    </>
  );
}
