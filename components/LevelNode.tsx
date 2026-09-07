"use client";

import { Handle, Position, useReactFlow } from "@xyflow/react";
import { memo, Fragment, useState, useRef, useCallback } from "react";
import { displayRole, extractCustomRole, hasCustomRole } from "@/lib/roleDisplay";
import { getLaneAccent, getLaneAccentFromActors } from "@/lib/laneColors";
import { type CsvVariant, VARIANT_CONFIG } from "@/lib/csvToFlow";

/* ─────────────────────────────────────────────
 * 레벨별 차별화 디자인 시스템 (진한→연한 그라디언트)
 * L2: #A62121  →  L3: #D95578  →  L4: #F2A0AF  →  L5: #F2DCE0
 * ───────────────────────────────────────────── */
export const LEVEL_STYLES = {
  L2: {
    bg: "bg-gradient-to-br from-[#A62121] to-[#8A1B1B]",
    text: "text-white",
    border: "border-[#D95578]",
    badge: "bg-[#F2A0AF]/40 text-white",
    shadow: "shadow-xl shadow-[#A62121]/30",
    font: "text-4xl font-extrabold tracking-tight",
    descFont: "text-lg",
    minW: "min-w-[720px]",
    maxW: "max-w-[900px]",
    py: "py-14 px-12",
    rounded: "rounded-2xl",
    handleTarget: "!bg-[#F2A0AF]",
    handleSource: "!bg-[#D95578]",
  },
  L3: {
    bg: "bg-gradient-to-br from-[#D95578] to-[#C44466]",
    text: "text-white",
    border: "border-[#F2A0AF]",
    badge: "bg-white/20 text-white",
    shadow: "shadow-lg shadow-[#D95578]/25",
    font: "text-3xl font-bold",
    descFont: "text-base",
    minW: "min-w-[650px]",
    maxW: "max-w-[820px]",
    py: "py-12 px-11",
    rounded: "rounded-xl",
    handleTarget: "!bg-[#F2DCE0]",
    handleSource: "!bg-[#F2A0AF]",
  },
  L4: {
    bg: "bg-[#DEDEDE]",
    text: "text-[#000000]",
    border: "border-[#DEDEDE]",
    badge: "bg-[#A62121] text-white",
    shadow: "shadow-md shadow-[#AAAAAA]/30",
    font: "text-2xl font-bold",
    descFont: "text-base font-medium",
    minW: "min-w-[580px]",
    maxW: "max-w-[760px]",
    py: "py-11 px-10",
    rounded: "rounded-lg",
    handleTarget: "!bg-[#888888]",
    handleSource: "!bg-[#555555]",
  },
  L5: {
    bg: "bg-[#FFFFFF]",
    text: "text-[#000000]",
    border: "border-[#DEDEDE]",
    badge: "bg-[#555555] text-white",
    shadow: "shadow-sm shadow-[#DEDEDE]/60",
    font: "text-[15px] font-bold",
    descFont: "text-sm font-medium",
    minW: "min-w-[300px]",
    maxW: "max-w-[380px]",
    py: "py-0 px-0",
    rounded: "rounded-none",
    handleTarget: "!bg-[#888888]",
    handleSource: "!bg-[#555555]",
  },
} as const;

type LevelKey = keyof typeof LEVEL_STYLES;

interface NodeData {
  label: string;
  level: LevelKey;
  id?: string;
  description?: string;
  /* ── Add-on metadata ── */
  memo?: string;
  role?: string;
  inputData?: string;
  outputData?: string;
  system?: string;
  /** L5 가변 폭 — 기본 1, Senior AI 같은 오케스트레이터는 여러 컬럼 덮기 (예: colSpan=3) */
  colSpan?: number;
  /** CSV 출처의 variant — getL5SystemName 이 variant 별 system 키/라벨 매핑에 사용 */
  variant?: CsvVariant;
  /* ── CSV-parsed systems (L5) — 키 셋은 variant 마다 다름 (Record 로 보관) ── */
  systems?: Record<string, string>;
}

/* extractCustomRole / hasCustomRole / displayRole 은 @/lib/roleDisplay 참조 */

/* helper: check if any metadata exists */
function hasMeta(d: NodeData): boolean {
  return !!(d.memo || d.role || d.inputData || d.outputData || d.system);
}

/** 사용 시스템 셀 값이 마커("⬤", "O" 등 단일 동그라미 기호)인지 판별. */
function isMarkerValue(v: string): boolean {
  return /^[O○●⬤◯o]$/.test(v.trim());
}

/** data.systems 에서 어느 variant 인지 추정 — variant 가 노드에 명시 안 됐을 때 키 셋으로 판별 */
function detectVariantFromSystems(sys: Record<string, string>): CsvVariant {
  // 복리후생/총무 고유 키 (둘 다 동일한 6-actor / 10-system 구조라 affairs-6 로 통합)
  if ("doobuy" in sys || "portal" in sys || "qvex_manual" in sys || "ms_office" in sys) {
    return "qvex-affairs-6";
  }
  // payroll: pnbs + doosan 키 혼합
  if ("pnbs" in sys) return "qvex-payroll-7";
  return "doosan-hr-4";
}

/* ─── Helper: get system display name for L5 (variant-aware + per-cell marker) ── */
function getL5SystemName(data: NodeData): string {
  if (data.system) return data.system;
  if (data.systems) {
    const variant: CsvVariant = data.variant ?? detectVariantFromSystems(data.systems);
    const defs = VARIANT_CONFIG[variant].systems;
    const parts: string[] = [];
    for (const def of defs) {
      const v = data.systems[def.key]?.trim();
      if (!v) continue;
      parts.push(isMarkerValue(v) ? def.displayLabel : v);
    }
    if (parts.length > 0) return parts.join(" / ");
  }
  return ""; // 시스템 데이터 없으면 공란
}

/* ─── L5 전용 2-Box 노드 (위: ID+레이블, 아래: 시스템명) ── */
function L5NodeBase({ data, selected }: { data: NodeData; selected?: boolean }) {
  const s = LEVEL_STYLES.L5;
  const sysName = getL5SystemName(data);
  // lane accent — role 우선, 비어있으면 CSV-파생 actors 사용 (캔버스엔 sheet 컨텍스트 없어서 y 기반은 불가)
  const accent = getLaneAccent(data.role)
    ?? getLaneAccentFromActors((data as unknown as { actors?: { exec?: string; hr?: string; teamlead?: string; member?: string } }).actors);
  const upperStyle: React.CSSProperties = accent
    ? { backgroundColor: `#${accent.bodyBg}`, border: `0.25pt solid #${accent.border}` }
    : { border: '0.25pt solid #DEDEDE' };
  // 컨테이너 테두리: selected > lane accent > 기본값
  const containerClass = selected
    ? 'border-[3px] border-blue-500 shadow-blue-300/60 shadow-lg'
    : accent
    ? 'border'
    : 'border border-[#BFBFBF]';
  // colSpan: 오케스트레이터 노드 가변 폭 (기본 1). 컬럼 피치 440px(Junior AI 간격과 동일) 기준.
  const colSpan = Math.max(1, Math.round(data.colSpan || 1));
  const L5_COL_PITCH = 440; // canvas px — Junior AI x 간격과 동일
  const L5_BASE_W = 380;   // colSpan=1 일 때 현재 max-width 와 동일
  const wideWidth = colSpan > 1 ? L5_BASE_W + (colSpan - 1) * L5_COL_PITCH : undefined;

  const containerInlineStyle: React.CSSProperties = {
    ...(wideWidth ? { width: wideWidth, minWidth: wideWidth, maxWidth: wideWidth } : {}),
    ...(!selected && accent ? { borderColor: `#${accent.border}` } : {}),
  };

  return (
    <div
      className={`${wideWidth ? '' : 'min-w-[300px] max-w-[380px]'} select-none relative shadow-md transition-all hover:shadow-lg rounded-sm ${containerClass}`}
      style={containerInlineStyle}
    >
      {selected && <div className="absolute inset-0 bg-blue-400/10 pointer-events-none z-20 rounded-sm" />}
      {/* ── Target handles ── */}
      <Handle type="target" position={Position.Top} id="t-top" className="!w-5 !h-5 !bg-transparent !border-0 !-top-2.5" />
      <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-5 !h-5 !bg-transparent !border-0 !-bottom-2.5" />
      <Handle type="target" position={Position.Left} id="t-left" className="!w-5 !h-5 !bg-transparent !border-0 !-left-2.5" />
      <Handle type="target" position={Position.Right} id="t-right" className="!w-5 !h-5 !bg-transparent !border-0 !-right-2.5" />

      {/* ── Source handles ── */}
      <Handle type="source" position={Position.Top} id="top" className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-top-2.5 !z-10`} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-bottom-2.5 !z-10`} />
      <Handle type="source" position={Position.Left} id="left" className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-left-2.5 !z-10`} />
      <Handle type="source" position={Position.Right} id="right" className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-right-2.5 !z-10`} />

      {/* ── Column handles — colSpan>1 일 때 top/bottom 각 column 중앙에 자동 배치 ── */}
      {/* Handle ID: top-c{i} / t-top-c{i} / bottom-c{i} / t-bottom-c{i} (i=0..colSpan-1) */}
      {colSpan > 1 && Array.from({ length: colSpan }).map((_, i) => {
        const leftStyle = { left: `${((i + 0.5) / colSpan) * 100}%` };
        return (
          <Fragment key={`col-handles-${i}`}>
            <Handle type="target" position={Position.Top} id={`t-top-c${i}`} style={leftStyle}
              className="!w-4 !h-4 !bg-transparent !border-0 !-top-2" />
            <Handle type="source" position={Position.Top} id={`top-c${i}`} style={leftStyle}
              className={`!w-4 !h-4 ${s.handleSource} !border-2 !border-white !-top-2 !z-10`} />
            <Handle type="target" position={Position.Bottom} id={`t-bottom-c${i}`} style={leftStyle}
              className="!w-4 !h-4 !bg-transparent !border-0 !-bottom-2" />
            <Handle type="source" position={Position.Bottom} id={`bottom-c${i}`} style={leftStyle}
              className={`!w-4 !h-4 ${s.handleSource} !border-2 !border-white !-bottom-2 !z-10`} />
          </Fragment>
        );
      })}

      {/* ── Custom role bar (그 외:value) — 위에 얹기 (0.36cm × 3.15cm) ── */}
      {extractCustomRole(data.role) && (
        <div
          className="bg-sky-100 border border-sky-300 flex items-center justify-center"
          style={{ height: 24, fontSize: 9, fontWeight: 700, color: '#1D4ED8' }}
        >
          {extractCustomRole(data.role)}
        </div>
      )}

      {/* ── 위쪽 박스: ID + 레이블 (lane accent 배경, 0.25pt 테두리) ── */}
      <div className="px-4 py-3 flex flex-col items-center justify-center" style={{ minHeight: 110, ...upperStyle }}>
        <div className="text-[13px] font-bold text-black text-center leading-snug">
          {data.id || ""}
        </div>
        <div className="text-[13px] font-bold text-black text-center leading-snug mt-0.5">
          {data.label}
        </div>
      </div>

      {/* ── 간격: 0.05cm ── */}
      <div style={{ height: 2 }} />

      {/* ── 아래쪽 박스: 시스템명 (연회색 채우기, 선 없음) ── */}
      <div className="bg-[#DEDEDE] px-3 py-1.5 flex items-center justify-center" style={{ minHeight: 36 }}>
        <div className="text-[11px] font-medium text-black text-center">
          {sysName}
        </div>
      </div>

      {/* ── Meta indicator icons ── */}
      {(data.memo || data.role || data.inputData || data.outputData || data.system) && (
        <div className="absolute top-1 left-1 flex items-center gap-1">
          {data.memo && <span className="text-[10px]" title="메모">📝</span>}
          {data.role && !hasCustomRole(data.role) && <span className="text-[10px]" title={`수행: ${displayRole(data.role)}`}>👤</span>}
          {data.inputData && <span className="text-[10px]" title="Input">📥</span>}
          {data.outputData && <span className="text-[10px]" title="Output">📤</span>}
        </div>
      )}

      {/* ── Memo yellow box ── */}
      {data.memo && (
        <div className="mt-1 w-full bg-yellow-100 border border-yellow-300 rounded px-2 py-1 text-[9px] text-yellow-900 leading-snug line-clamp-3">
          📝 {data.memo}
        </div>
      )}
    </div>
  );
}

/* ─── Generic level node with 4-directional handles (L2~L4) ── */
function LevelNodeBase({ data, selected }: { data: NodeData; selected?: boolean }) {
  const s = LEVEL_STYLES[data.level] ?? LEVEL_STYLES.L5;
  const metaPresent = hasMeta(data);

  /* L5는 전용 2-box 노드 사용 */
  if (data.level === "L5") {
    return <L5NodeBase data={data} selected={selected} />;
  }

  return (
    <div
      className={`${s.bg} ${s.border} ${s.shadow} ${s.minW} ${s.maxW} ${s.py} ${s.rounded} border-2 select-none relative transition-all hover:shadow-lg ${selected ? 'ring-[4px] ring-blue-500 ring-offset-0' : ''}`}
    >
      {selected && <div className="absolute inset-0 bg-blue-400/10 pointer-events-none z-20" style={{ borderRadius: 'inherit' }} />}
      {/* 4방향 Handle — target을 먼저, source를 나중에 (source가 위에 와야 드래그 시작 시 올바른 방향) */}

      {/* ── Target handles (invisible, rendered first = below) ── */}
      <Handle
        type="target"
        position={Position.Top}
        id="t-top"
        className="!w-5 !h-5 !bg-transparent !border-0 !-top-2.5"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="t-bottom"
        className="!w-5 !h-5 !bg-transparent !border-0 !-bottom-2.5"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="t-left"
        className="!w-5 !h-5 !bg-transparent !border-0 !-left-2.5"
      />
      <Handle
        type="target"
        position={Position.Right}
        id="t-right"
        className="!w-5 !h-5 !bg-transparent !border-0 !-right-2.5"
      />

      {/* ── Source handles (visible, rendered last = on top) ── */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-top-2.5 !z-10`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-bottom-2.5 !z-10`}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-left-2.5 !z-10`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className={`!w-5 !h-5 ${s.handleSource} !border-2 !border-white !-right-2.5 !z-10`}
      />

      {/* Level badge + meta indicators */}
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`inline-block text-sm font-bold px-4 py-1.5 rounded-full ${s.badge}`}
        >
          {data.level}
          {data.id ? ` · ${data.id}` : ""}
        </span>
        {/* Meta icons */}
        {metaPresent && (
          <div className="flex items-center gap-1.5">
            {data.memo && <span className="text-base" title="메모">📝</span>}
            {data.role && <span className="text-base" title={`수행: ${displayRole(data.role)}`}>👤</span>}
            {data.inputData && <span className="text-base" title="Input">📥</span>}
            {data.outputData && <span className="text-base" title="Output">📤</span>}
            {data.system && <span className="text-base" title={`시스템: ${data.system}`}>🖥️</span>}
          </div>
        )}
      </div>

      {/* Label */}
      <div className={`${s.font} ${s.text} leading-snug`}>{data.label}</div>

      {/* Description */}
      {data.description && (
        <div
          className={`mt-1.5 ${s.descFont} leading-snug ${s.text} line-clamp-2 ${
            data.level === "L2" || data.level === "L3" ? "opacity-80" : "opacity-90"
          }`}
        >
          {data.description}
        </div>
      )}

      {/* Role badge (compact) */}
      {data.role && !hasCustomRole(data.role) && (
        <div className={`mt-3 inline-block text-sm px-3.5 py-1.5 rounded-full font-semibold ${
          data.level === "L4"
            ? "bg-black/10 text-black/70"
            : "bg-white/20 text-white/90"
        }`}>
          👤 {displayRole(data.role)}
        </div>
      )}

      {/* Custom role tag (그 외:value) — top-right overlap */}
      {extractCustomRole(data.role) && (
        <div
          className="absolute z-20 text-[9px] font-semibold px-2.5 py-1 rounded bg-sky-100 text-sky-700 border border-sky-300 shadow-sm whitespace-nowrap"
          style={{ top: -10, right: -10 }}
        >
          {extractCustomRole(data.role)}
        </div>
      )}

      {/* Memo yellow box */}
      {data.memo && (
        <div className="mt-2 w-full bg-yellow-100 border border-yellow-300 rounded px-2 py-1.5 text-[9px] text-yellow-900 leading-snug line-clamp-3">
          📝 {data.memo}
        </div>
      )}
    </div>
  );
}

/* ─── Export individual level nodes for nodeTypes registration ─── */
export const L2Node = memo(({ data, selected }: { data: NodeData; selected?: boolean }) => (
  <LevelNodeBase data={{ ...data, level: "L2" }} selected={selected} />
));
L2Node.displayName = "L2Node";

export const L3Node = memo(({ data, selected }: { data: NodeData; selected?: boolean }) => (
  <LevelNodeBase data={{ ...data, level: "L3" }} selected={selected} />
));
L3Node.displayName = "L3Node";

export const L4Node = memo(({ data, selected }: { data: NodeData; selected?: boolean }) => (
  <LevelNodeBase data={{ ...data, level: "L4" }} selected={selected} />
));
L4Node.displayName = "L4Node";

export const L5Node = memo(({ data, selected }: { data: NodeData; selected?: boolean }) => (
  <LevelNodeBase data={{ ...data, level: "L5" }} selected={selected} />
));
L5Node.displayName = "L5Node";

/* ─── Decision (판정 로직) 마름모 노드 ── */
interface DecisionNodeData {
  label: string;
  description?: string;
  id?: string;
  memo?: string;
  level?: string;
}

function DecisionNodeBase({ data, selected }: { data: DecisionNodeData; selected?: boolean }) {
  /* L3(#D95578) 보다 옅은 색상 */
  const bgColor = "#F2A0AF";        // L3 옅은 톤
  const borderColor = "#D95578";     // L3 기준 테두리
  const textColor = "#3B0716";

  return (
    <div
      className="select-none relative"
      style={{ width: 220, height: 220 }}
    >
      {/* ── Target handles — 꼭짓점에 정확히 위치 (vertex=8px 안쪽, handle 20px → offset=-2) ── */}
      <Handle type="target" position={Position.Top} id="t-top"
        className="!w-5 !h-5 !bg-transparent !border-0"
        style={{ top: -2, left: '50%', transform: 'translateX(-50%)' }}
      />
      <Handle type="target" position={Position.Bottom} id="t-bottom"
        className="!w-5 !h-5 !bg-transparent !border-0"
        style={{ bottom: -2, left: '50%', transform: 'translateX(-50%)' }}
      />
      <Handle type="target" position={Position.Left} id="t-left"
        className="!w-5 !h-5 !bg-transparent !border-0"
        style={{ left: -2, top: '50%', transform: 'translateY(-50%)' }}
      />
      <Handle type="target" position={Position.Right} id="t-right"
        className="!w-5 !h-5 !bg-transparent !border-0"
        style={{ right: -2, top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* ── Source handles ── */}
      <Handle type="source" position={Position.Bottom} id="bottom"
        className="!w-5 !h-5 !bg-[#333333] !border-2 !border-white !z-10"
        style={{ bottom: -2, left: '50%', transform: 'translateX(-50%)' }}
      />
      <Handle type="source" position={Position.Right} id="right"
        className="!w-5 !h-5 !bg-[#333333] !border-2 !border-white !z-10"
        style={{ right: -2, top: '50%', transform: 'translateY(-50%)' }}
      />
      <Handle type="source" position={Position.Top} id="top"
        className="!w-5 !h-5 !bg-[#D95578] !border-2 !border-white !z-10"
        style={{ top: -2, left: '50%', transform: 'translateX(-50%)' }}
      />
      <Handle type="source" position={Position.Left} id="left"
        className="!w-5 !h-5 !bg-[#D95578] !border-2 !border-white !z-10"
        style={{ left: -2, top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* ── Diamond SVG ── */}
      <svg
        viewBox="0 0 220 220"
        width="220"
        height="220"
        className="absolute inset-0 drop-shadow-lg"
      >
        <polygon
          points="110,8 212,110 110,212 8,110"
          fill={bgColor}
          stroke={borderColor}
          strokeWidth="2.5"
        />
      </svg>
      {selected && (
        <svg viewBox="0 0 220 220" width="220" height="220" className="absolute inset-0 pointer-events-none z-20">
          <polygon points="110,8 212,110 110,212 8,110" fill="rgba(59,130,246,0.12)" stroke="#3B82F6" strokeWidth="5" />
        </svg>
      )}

      {/* ── Content overlay ── */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center px-8"
        style={{ color: textColor }}
      >
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">
          ◆ 판정 로직
        </span>
        <div className="text-[14px] font-bold text-center leading-snug">
          {data.label || "판정 조건"}
        </div>
        {data.description && (
          <div className="text-[11px] text-center mt-1 opacity-70 leading-tight line-clamp-2">
            {data.description}
          </div>
        )}
      </div>

      {/* Memo yellow box */}
      {data.memo && (
        <div
          className="absolute bg-yellow-100 border border-yellow-300 rounded px-2 py-1 text-[9px] text-yellow-900 leading-snug"
          style={{ top: 228, left: '50%', transform: 'translateX(-50%)', width: 180, maxHeight: 60, overflow: 'hidden' }}
        >
          📝 {data.memo}
        </div>
      )}
    </div>
  );
}

export const DecisionNode = memo(({ data, selected }: { data: DecisionNodeData; selected?: boolean }) => (
  <DecisionNodeBase data={data} selected={selected} />
));
DecisionNode.displayName = "DecisionNode";

/* ═══════════════════════════════════════════════
 *  MEMO 노드 — 독립 포스트잇 (노란 네모, 9pt)
 * ═══════════════════════════════════════════════ */
interface MemoNodeData {
  label?: string;
  text?: string;
  memo?: string;
  [key: string]: unknown;
}

function MemoNodeBase({ id, data, selected }: { id: string; data: MemoNodeData; selected?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { setNodes } = useReactFlow();

  const text = data.text || data.memo || data.label || "";

  const startEdit = useCallback(() => {
    setEditText(text);
    setEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 30);
  }, [text]);

  const saveEdit = useCallback(() => {
    setEditing(false);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, text: editText, label: editText, memo: editText } }
          : n
      )
    );
  }, [id, editText, setNodes]);

  return (
    <div
      style={{ minWidth: 140, maxWidth: 260 }}
      className="relative"
      onDoubleClick={editing ? undefined : startEdit}
    >
      {/* 연결 핸들 */}
      <Handle type="target" position={Position.Left} id="t-left"
        className="!w-2.5 !h-2.5 !bg-yellow-500 !border-yellow-600" />
      <Handle type="source" position={Position.Right} id="right"
        className="!w-2.5 !h-2.5 !bg-yellow-400 !border-yellow-500" />
      <Handle type="target" position={Position.Top} id="t-top"
        className="!w-2.5 !h-2.5 !bg-yellow-500 !border-yellow-600" />
      <Handle type="source" position={Position.Bottom} id="bottom"
        className="!w-2.5 !h-2.5 !bg-yellow-400 !border-yellow-500" />

      {/* 노란 메모 박스 */}
      <div
        className={`bg-[#FFF9C4] rounded-lg shadow-md px-3 py-2.5 ${selected ? 'border-[2px] border-blue-500 ring-2 ring-blue-400/40' : 'border border-[#FBC02D]'}`}
        style={{ fontSize: 9, lineHeight: '1.5', color: '#6D4C00', wordBreak: 'break-word' }}
      >
        <div className="flex items-center gap-1 mb-1 text-[10px] font-bold text-yellow-700 opacity-70">
          📝 메모{editing && <span className="ml-1 text-blue-500 opacity-100">편집 중 (Blur 저장 · Esc 취소)</span>}
        </div>
        {editing ? (
          <textarea
            ref={textareaRef}
            className="nodrag nowheel w-full bg-transparent resize-none outline-none"
            style={{ fontSize: 9, lineHeight: '1.5', color: '#6D4C00', minHeight: 60, fontFamily: 'inherit' }}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditing(false); }
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', minHeight: 20 }}>
            {text || <span className="italic text-yellow-400">더블클릭해서 내용 입력...</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export const MemoNode = memo(({ id, data, selected }: { id: string; data: MemoNodeData; selected?: boolean }) => (
  <MemoNodeBase id={id} data={data} selected={selected} />
));
MemoNode.displayName = "MemoNode";

export default LevelNodeBase;
