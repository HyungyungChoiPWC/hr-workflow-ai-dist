"use client";

import { useState, useEffect, useCallback } from "react";
import type { Node } from "@xyflow/react";
import { displayRole } from "@/lib/roleDisplay";
import {
  type CsvVariant,
  getRoleOptionsForVariant,
  getActorDefsForVariant,
  getSystemDefsForVariant,
} from "@/lib/csvToFlow";

/** 사용 시스템 셀 값이 마커("⬤", "O" 등 단일 동그라미 기호)인지 판별.
 *  마커면 컬럼 라벨로 표시, 텍스트면 텍스트 값 그대로 표시. */
function isMarkerValue(v: string): boolean {
  return /^[O○●⬤◯o]$/.test(v.trim());
}

export interface NodeMeta {
  memo?: string;
  role?: string;       // 수행 주체 (콤마 구분 다중선택)
  inputData?: string;
  outputData?: string;
  system?: string;
  /* 확장 메타 (편집 가능) */
  mgrBody?: string;
  staffCount?: string;
  mainPerson?: string;
  avgTime?: string;
  freqCount?: string;
  /** L5 가변 폭 (Senior AI 오케스트레이터 전용, 기본 1) */
  colSpan?: number;
}

/* ── L5 확장 메타 (CSV에서 자동 파싱된 읽기전용 데이터) ──
 * actors / systems 키 셋은 variant 마다 다르므로 Record 로 보관 */
interface L5ExtMeta {
  actors?: Record<string, string>;
  mgrBody?: string;
  staffCount?: string;
  mainPerson?: string;
  avgTime?: string;
  freqCount?: string;
  systems?: Record<string, string>;
  painPoints?: { speed: string; accuracy: string; repeat: string; data: string; system: string; comm: string; etc: string };
  inputs?: { system: string; doc: string; external: string; request: string; etc: string };
  outputs?: { system: string; doc: string; comm: string; decision: string; etc: string };
  logic?: { rule: string; human: string; mixed: string };
}

interface NodeDetailPanelProps {
  node: Node | null;
  /** 활성 시트의 CSV variant — role / actor / system 라벨을 결정 */
  variant?: CsvVariant;
  onClose: () => void;
  onUpdate: (nodeId: string, meta: NodeMeta) => void;
}

const INPUT_LABEL_MAP: { key: string; label: string }[] = [
  { key: "system",   label: "시스템" },
  { key: "doc",      label: "문서" },
  { key: "external", label: "외부" },
  { key: "request",  label: "요청" },
  { key: "etc",      label: "기타" },
];

const OUTPUT_LABEL_MAP: { key: string; label: string }[] = [
  { key: "system",   label: "시스템" },
  { key: "doc",      label: "문서" },
  { key: "comm",     label: "커뮤니케이션" },
  { key: "decision", label: "의사결정" },
  { key: "etc",      label: "기타" },
];

/** 객체의 비어있지 않은 값을 "/" 구분으로 조합 (열마다 구분) */
function buildMetaString(data: unknown, labelMap: { key: string; label: string }[]): string {
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, string>;
  const parts: string[] = [];
  for (const { key } of labelMap) {
    const v = obj[key]?.trim();
    if (v) parts.push(v);
  }
  return parts.join(" / ");
}

function getNodeMeta(node: Node, variant: CsvVariant): NodeMeta {
  const d = node.data as Record<string, unknown>;

  /* system 필드: 사용자가 직접 입력한 값이 있으면 우선, 없으면 variant 의 system 키 순서로 값 조합.
     셀 값이 마커(⬤/O 등)면 컬럼 라벨로, 자유 텍스트(예: "Teams, Outlook")면 텍스트 그대로. */
  const sysObj = d.systems as Record<string, string> | undefined;
  let systemVal = (d.system as string) || "";
  if (!systemVal && sysObj) {
    const parts: string[] = [];
    for (const def of getSystemDefsForVariant(variant)) {
      const v = sysObj[def.key]?.trim();
      if (!v) continue;
      parts.push(isMarkerValue(v) ? def.displayLabel : v);
    }
    systemVal = parts.join(" / ");
  }

  /* inputData / outputData */
  const inputVal = (d.inputData as string) || buildMetaString(d.inputs, INPUT_LABEL_MAP);
  const outputVal = (d.outputData as string) || buildMetaString(d.outputs, OUTPUT_LABEL_MAP);

  /* 수행주체: 명시적 role이 없으면 variant 의 actor 라벨로 자동 맵핑 */
  let roleVal = (d.role as string) || "";
  if (!roleVal) {
    const actors = d.actors as Record<string, string> | undefined;
    if (actors) {
      const parts: string[] = [];
      for (const def of getActorDefsForVariant(variant)) {
        if (actors[def.key]?.trim()) parts.push(def.roleLabel);
      }
      roleVal = parts.join(", ");
    }
  }

  return {
    memo: (d.memo as string) || "",
    role: roleVal,
    inputData: inputVal,
    outputData: outputVal,
    system: systemVal,
    mgrBody: (d.mgrBody as string) || "",
    staffCount: (d.staffCount as string) || "",
    mainPerson: (d.mainPerson as string) || "",
    avgTime: (d.avgTime as string) || "",
    freqCount: (d.freqCount as string) || "",
    colSpan: typeof d.colSpan === "number" ? d.colSpan : 1,
  };
}

export default function NodeDetailPanel({ node, variant: propVariant = "doosan-hr-4", onClose, onUpdate }: NodeDetailPanelProps) {
  const [meta, setMeta] = useState<NodeMeta>({});

  /* variant 우선순위: 노드 자체에 저장된 variant > 부모가 넘긴 prop variant.
     (CSV 로드 후 시트 variant 가 prop 으로 들어오지만, 노드가 다른 variant 출처일 수도 있어서) */
  const nodeDataVariant = (node?.data as Record<string, unknown> | undefined)?.variant as
    | CsvVariant
    | undefined;
  const variant: CsvVariant = nodeDataVariant ?? propVariant;

  /* variant 의 역할 토글 라벨 + "그 외" — variant 가 바뀌면 재계산 */
  const ROLE_OPTIONS = [...getRoleOptionsForVariant(variant), "그 외"] as const;

  useEffect(() => {
    if (node) setMeta(getNodeMeta(node, variant));
  }, [node, variant]);

  const handleSave = useCallback(() => {
    if (!node) return;
    onUpdate(node.id, meta);
    onClose();
  }, [node, meta, onUpdate, onClose]);

  if (!node) return null;

  const d = node.data as Record<string, unknown>;
  const level = (d.level as string) || "L4";
  const label = (d.label as string) || "";
  const id = (d.id as string) || node.id;
  const desc = (d.description as string) || "";

  /* L5 확장 메타데이터 (CSV 자동 파싱) */
  const ext: L5ExtMeta | null = level === "L5" ? {
    actors: d.actors as L5ExtMeta["actors"],
    mgrBody: d.mgrBody as string,
    staffCount: d.staffCount as string,
    mainPerson: d.mainPerson as string,
    avgTime: d.avgTime as string,
    freqCount: d.freqCount as string,
    systems: d.systems as L5ExtMeta["systems"],
    painPoints: d.painPoints as L5ExtMeta["painPoints"],
    inputs: d.inputs as L5ExtMeta["inputs"],
    outputs: d.outputs as L5ExtMeta["outputs"],
    logic: d.logic as L5ExtMeta["logic"],
  } : null;

  /* variant 별 actor/system 정의 */
  const actorDefs = getActorDefsForVariant(variant);
  const systemDefs = getSystemDefsForVariant(variant);
  const hasAnyActor = !!actorDefs.find((a) => ext?.actors?.[a.key]?.trim());
  const hasAnySystem = !!systemDefs.find((s) => ext?.systems?.[s.key]?.trim());

  /* 확장 메타 중 데이터가 하나라도 있는지 */
  const hasExt = ext && (
    hasAnyActor ||
    ext.mgrBody || ext.staffCount || ext.mainPerson || ext.avgTime || ext.freqCount ||
    hasAnySystem ||
    ext.painPoints?.speed || ext.painPoints?.accuracy || ext.painPoints?.repeat || ext.painPoints?.data || ext.painPoints?.system || ext.painPoints?.comm || ext.painPoints?.etc ||
    ext.inputs?.system || ext.inputs?.doc || ext.inputs?.external || ext.inputs?.request || ext.inputs?.etc ||
    ext.outputs?.system || ext.outputs?.doc || ext.outputs?.comm || ext.outputs?.decision || ext.outputs?.etc ||
    ext.logic?.rule || ext.logic?.human || ext.logic?.mixed
  );

  const levelColors: Record<string, { bg: string; text: string; border: string }> = {
    L2: { bg: "bg-[#A62121]", text: "text-white", border: "border-[#D95578]" },
    L3: { bg: "bg-[#D95578]", text: "text-white", border: "border-[#F2A0AF]" },
    L4: { bg: "bg-[#F2A0AF]", text: "text-[#3B0716]", border: "border-[#D95578]" },
    L5: { bg: "bg-[#F2DCE0]", text: "text-[#3B0716]", border: "border-[#F2A0AF]" },
    DECISION: { bg: "bg-[#F2A0AF]", text: "text-[#3B0716]", border: "border-[#D95578]" },
  };
  const lc = levelColors[level] || levelColors.L4;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[380px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className={`px-5 py-4 ${lc.bg} ${lc.text} border-b-4 ${lc.border}`}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono opacity-70">{level} · {id}</span>
            <h3 className="text-base font-bold mt-0.5">{label}</h3>
            {desc && <p className="text-[11px] opacity-70 mt-0.5 line-clamp-2">{desc}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-sm transition"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* 메모 */}
        <fieldset>
          <legend className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
            📝 메모
          </legend>
          <textarea
            value={meta.memo || ""}
            onChange={(e) => setMeta({ ...meta, memo: e.target.value })}
            placeholder="이 단계에 대한 메모를 입력하세요..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
            rows={3}
          />
        </fieldset>

        {/* 수행 주체 (다중선택) */}
        <fieldset>
          <legend className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
            👤 수행 주체 <span className="text-[10px] font-normal text-gray-400">(여러 명 선택 가능)</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_OPTIONS.map((role) => {
              const activeRoles = (meta.role || "").split(",").map(r => r.trim()).filter(Boolean);
              const isActive = role === "그 외"
                ? activeRoles.some(r => r === "그 외" || r.startsWith("그 외:"))
                : activeRoles.includes(role);
              return (
                <button
                  key={role}
                  onClick={() => {
                    const currentRoles = (meta.role || "").split(",").map(r => r.trim()).filter(Boolean);
                    let newRoles: string[];
                    if (role === "그 외") {
                      const hasOther = currentRoles.some(r => r === "그 외" || r.startsWith("그 외:"));
                      newRoles = hasOther
                        ? currentRoles.filter(r => r !== "그 외" && !r.startsWith("그 외:"))
                        : [...currentRoles, "그 외"];
                    } else {
                      newRoles = isActive
                        ? currentRoles.filter(r => r !== role)
                        : [...currentRoles, role];
                    }
                    setMeta({ ...meta, role: newRoles.join(", ") });
                  }}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
          {/* 직접입력 필드 (그 외 선택 시만 표시) */}
          {(meta.role || "").split(",").map(r => r.trim()).some(r => r === "그 외" || r.startsWith("그 외:")) && (
            <input
              type="text"
              placeholder="직접 입력... (예: 큐벡스, 재무/IT)"
              className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={(() => {
                const r = (meta.role || "").split(",").map(x => x.trim()).find(x => x.startsWith("그 외:"));
                if (!r) return "";
                try { return decodeURIComponent(r.slice(4)); } catch { return r.slice(4); }
              })()}
              onChange={(e) => {
                const currentRoles = (meta.role || "").split(",").map(r => r.trim()).filter(r => r !== "그 외" && !r.startsWith("그 외:"));
                // 쉼표·공백 등이 split/trim 구분자와 충돌하지 않도록 인코딩해서 저장
                const newOther = e.target.value ? `그 외:${encodeURIComponent(e.target.value)}` : "그 외";
                setMeta({ ...meta, role: [...currentRoles, newOther].join(", ") });
              }}
            />
          )}
          {/* 선택된 주체 태그 미리보기 */}
          {meta.role && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {displayRole(meta.role)
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean)
                .map((r) => (
                  <span key={r} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{r}</span>
                ))}
            </div>
          )}
        </fieldset>

        {/* 확장 폭 (colSpan) — 모든 L5 노드에 노출, 기본 1 (오케스트레이터 같은 경우만 조정) */}
        {level === "L5" && (
          <fieldset>
            <legend className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
              ↔️ 확장 폭 <span className="text-[10px] font-normal text-gray-400">(오케스트레이터가 여러 Junior 덮을 때만 2 이상)</span>
            </legend>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={meta.colSpan ?? 1}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(20, Math.round(Number(e.target.value) || 1)));
                  setMeta({ ...meta, colSpan: n });
                }}
                className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <span className="text-[11px] text-gray-500">컬럼 (1 = 기본 폭, N 이상 = Junior N개 너비)</span>
            </div>
          </fieldset>
        )}

        {/* Input Data */}
        <fieldset>
          <legend className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
            📥 Input Data
          </legend>
          <textarea
            value={meta.inputData || ""}
            onChange={(e) => setMeta({ ...meta, inputData: e.target.value })}
            placeholder="예: 채용 요청서, 직무 기술서, 인력 계획..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
            rows={2}
          />
        </fieldset>

        {/* Output Data */}
        <fieldset>
          <legend className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
            📤 Output Data
          </legend>
          <textarea
            value={meta.outputData || ""}
            onChange={(e) => setMeta({ ...meta, outputData: e.target.value })}
            placeholder="예: 채용 결과 보고서, 합격자 명단..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
            rows={2}
          />
        </fieldset>

        {/* 사용 시스템 및 툴 */}
        <fieldset>
          <legend className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1">
            🖥️ 사용 시스템 및 툴
          </legend>
          <textarea
            value={meta.system || ""}
            onChange={(e) => setMeta({ ...meta, system: e.target.value })}
            placeholder="예: 커리어두산, outlook, teams, SAP..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
            rows={2}
          />
        </fieldset>

        {/* 관리주체 / 담당자 / 주담당자 / 소요시간 / 빈도 (L5) */}
        {(level === "L5" || meta.mgrBody || meta.staffCount || meta.mainPerson || meta.avgTime || meta.freqCount) && (
          <fieldset>
            <legend className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1">
              📊 업무 정보
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">관리주체</label>
                <input
                  value={meta.mgrBody || ""}
                  onChange={(e) => setMeta({ ...meta, mgrBody: e.target.value })}
                  placeholder="관리주체"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">담당자 수</label>
                <input
                  value={meta.staffCount || ""}
                  onChange={(e) => setMeta({ ...meta, staffCount: e.target.value })}
                  placeholder="예: 2명"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">주 담당자</label>
                <input
                  value={meta.mainPerson || ""}
                  onChange={(e) => setMeta({ ...meta, mainPerson: e.target.value })}
                  placeholder="주 담당자"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">평균 소요시간</label>
                <input
                  value={meta.avgTime || ""}
                  onChange={(e) => setMeta({ ...meta, avgTime: e.target.value })}
                  placeholder="예: 30분"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-gray-500 block mb-0.5">발생 빈도_건수</label>
                <input
                  value={meta.freqCount || ""}
                  onChange={(e) => setMeta({ ...meta, freqCount: e.target.value })}
                  placeholder="예: 월 50건"
                  className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
            </div>
          </fieldset>
        )}

        {/* ═══ L5 확장 메타데이터 (CSV 자동 파싱, 읽기전용 세부) ═══ */}
        {hasExt && ext && (
          <div className="border-t border-gray-200 pt-4 mt-2 space-y-3">
            <h4 className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">📋 CSV 자동 파싱 정보</h4>

            {/* 수행주체 (variant 별) */}
            {hasAnyActor && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                <div className="text-[10px] font-bold text-gray-500 uppercase">수행주체</div>
                <div className="flex flex-wrap gap-1.5">
                  {actorDefs.map((def) => {
                    const v = ext.actors?.[def.key]?.trim();
                    if (!v) return null;
                    return (
                      <span key={def.key} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        {def.laneLabel}: {v}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 관리주체 · 담당자 수 · 주 담당자 */}
            {(ext.mgrBody || ext.staffCount || ext.mainPerson) && (
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                {ext.mgrBody && <div className="bg-gray-50 rounded p-2"><span className="text-gray-400 block">관리주체</span><span className="font-medium">{ext.mgrBody}</span></div>}
                {ext.staffCount && <div className="bg-gray-50 rounded p-2"><span className="text-gray-400 block">담당자 수</span><span className="font-medium">{ext.staffCount}</span></div>}
                {ext.mainPerson && <div className="bg-gray-50 rounded p-2"><span className="text-gray-400 block">주 담당자</span><span className="font-medium">{ext.mainPerson}</span></div>}
              </div>
            )}

            {/* 소요시간 · 빈도 */}
            {(ext.avgTime || ext.freqCount) && (
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                {ext.avgTime && <div className="bg-yellow-50 rounded p-2"><span className="text-gray-400 block">⏱ 평균 소요시간</span><span className="font-medium">{ext.avgTime}</span></div>}
                {ext.freqCount && <div className="bg-yellow-50 rounded p-2"><span className="text-gray-400 block">📊 발생 빈도</span><span className="font-medium">{ext.freqCount}</span></div>}
              </div>
            )}

            {/* 사용 시스템 (variant 별) — qvex 변형은 동그라미("O") 마크, doosan-hr-4 는 텍스트 */}
            {hasAnySystem && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                <div className="text-[10px] font-bold text-gray-500 uppercase">사용 시스템</div>
                <div className="flex flex-wrap gap-1.5">
                  {systemDefs.map((def) => {
                    const v = ext.systems?.[def.key]?.trim();
                    if (!v) return null;
                    /* 셀 단위로 마커/텍스트 판별 — 마커면 라벨만, 텍스트면 "라벨: 값" */
                    const marker = isMarkerValue(v);
                    return (
                      <span key={def.key} className="text-[10px] px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                        {marker ? def.displayLabel : `${def.displayLabel}: ${v}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pain Points */}
            {(ext.painPoints?.speed || ext.painPoints?.accuracy || ext.painPoints?.repeat || ext.painPoints?.data || ext.painPoints?.system || ext.painPoints?.comm || ext.painPoints?.etc) && (
              <div className="bg-red-50 rounded-lg p-3 space-y-1.5">
                <div className="text-[10px] font-bold text-red-500 uppercase">⚠️ Pain Points</div>
                <div className="flex flex-wrap gap-1.5">
                  {ext.painPoints?.speed && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">시간/속도: {ext.painPoints.speed}</span>}
                  {ext.painPoints?.accuracy && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">정확성: {ext.painPoints.accuracy}</span>}
                  {ext.painPoints?.repeat && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">반복/수작업: {ext.painPoints.repeat}</span>}
                  {ext.painPoints?.data && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">정보/데이터: {ext.painPoints.data}</span>}
                  {ext.painPoints?.system && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">시스템/도구: {ext.painPoints.system}</span>}
                  {ext.painPoints?.comm && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">의사소통: {ext.painPoints.comm}</span>}
                  {ext.painPoints?.etc && <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700">기타: {ext.painPoints.etc}</span>}
                </div>
              </div>
            )}

            {/* Input / Output */}
            <div className="grid grid-cols-2 gap-2">
              {(ext.inputs?.system || ext.inputs?.doc || ext.inputs?.external || ext.inputs?.request || ext.inputs?.etc) && (
                <div className="bg-green-50 rounded-lg p-2 space-y-1">
                  <div className="text-[10px] font-bold text-green-600">📥 Input</div>
                  <div className="space-y-0.5 text-[9px] text-green-800">
                    {ext.inputs?.system && <div>시스템: {ext.inputs.system}</div>}
                    {ext.inputs?.doc && <div>문서: {ext.inputs.doc}</div>}
                    {ext.inputs?.external && <div>외부: {ext.inputs.external}</div>}
                    {ext.inputs?.request && <div>요청: {ext.inputs.request}</div>}
                    {ext.inputs?.etc && <div>기타: {ext.inputs.etc}</div>}
                  </div>
                </div>
              )}
              {(ext.outputs?.system || ext.outputs?.doc || ext.outputs?.comm || ext.outputs?.decision || ext.outputs?.etc) && (
                <div className="bg-blue-50 rounded-lg p-2 space-y-1">
                  <div className="text-[10px] font-bold text-blue-600">📤 Output</div>
                  <div className="space-y-0.5 text-[9px] text-blue-800">
                    {ext.outputs?.system && <div>시스템: {ext.outputs.system}</div>}
                    {ext.outputs?.doc && <div>문서: {ext.outputs.doc}</div>}
                    {ext.outputs?.comm && <div>커뮤니케이션: {ext.outputs.comm}</div>}
                    {ext.outputs?.decision && <div>의사결정: {ext.outputs.decision}</div>}
                    {ext.outputs?.etc && <div>기타: {ext.outputs.etc}</div>}
                  </div>
                </div>
              )}
            </div>

            {/* 업무 판단 로직 */}
            {(ext.logic?.rule || ext.logic?.human || ext.logic?.mixed) && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                <div className="text-[10px] font-bold text-gray-500 uppercase">🧠 업무 판단 로직</div>
                <div className="flex flex-wrap gap-1.5">
                  {ext.logic?.rule && <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">Rule-based: {ext.logic.rule}</span>}
                  {ext.logic?.human && <span className="text-[10px] px-2 py-0.5 rounded bg-teal-100 text-teal-700">사람 판단: {ext.logic.human}</span>}
                  {ext.logic?.mixed && <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-700">혼합: {ext.logic.mixed}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 text-sm py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
        >
          취소
        </button>
        <button
          onClick={handleSave}
          className="flex-1 text-sm py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
        >
          💾 저장
        </button>
      </div>
    </div>
  );
}
