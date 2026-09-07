"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { Node } from "@xyflow/react";
import {
  buildTemplateCsvString,
  type CsvVariant,
  getRoleOptionsForVariant,
  getActorDefsForVariant,
  getSystemDefsForVariant,
} from "@/lib/csvToFlow";
import { displayRole } from "@/lib/roleDisplay";

/* ═══ 타입 ═══ */
interface RowData {
  nodeId: string;
  level: "L2" | "L3" | "L4" | "L5";
  displayId: string;
  name: string;
  description: string;
  role: string;
  memo: string;
  parentLevel?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  /** 활성 시트의 CSV variant — role 라벨, 확장 메타 요약 라벨 결정 */
  variant?: CsvVariant;
}

/* ═══ 레벨 색상 ═══ */
const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  L2: { bg: "#A62121", text: "#FFFFFF", border: "#8A1B1B" },
  L3: { bg: "#D95578", text: "#FFFFFF", border: "#C44466" },
  L4: { bg: "#DEDEDE", text: "#000000", border: "#BBBBBB" },
  L5: { bg: "#FFFFFF", text: "#000000", border: "#DEDEDE" },
};

const LEVEL_OPTIONS = ["L2", "L3", "L4", "L5"] as const;

/* ═══ 유틸 ═══ */
function getNodeData(n: Node): Record<string, unknown> {
  return (n.data || {}) as Record<string, unknown>;
}

function nodeToRow(n: Node): RowData {
  const d = getNodeData(n);
  return {
    nodeId: n.id,
    level: ((d.level as string) || "L4").toUpperCase() as RowData["level"],
    displayId: (d.id as string) || "",
    name: (d.label as string) || "",
    description: (d.description as string) || "",
    role: (d.role as string) || "",
    memo: (d.memo as string) || "",
  };
}

/* ═══ 플랫 행 목록 (노드 배열 순서 그대로, 드래그 순서 유지) ═══ */
function buildFlatRows(nodes: Node[]): RowData[] {
  return nodes.map(nodeToRow);
}

/* ═══ ID 자동 재번호 (플랫 리스트 기반) ═══ */
function renumberIds(nodes: Node[], setNodes: React.Dispatch<React.SetStateAction<Node[]>>) {
  const rows = buildFlatRows(nodes);
  const idMap = new Map<string, string>();
  const levelDepth: Record<string, number> = { L2: 1, L3: 2, L4: 3, L5: 4 };

  // 각 레벨의 "현재 부모 ID"와 "해당 레벨 카운터"를 추적
  const currentParentId: Record<number, string> = {}; // depth → 해당 depth의 최근 할당 ID
  const childCounters: Record<string, number> = {};   // parentId → child counter

  for (const row of rows) {
    const depth = levelDepth[row.level] || 4;

    if (depth === 1) {
      // L2: 최상위
      const key = "root";
      childCounters[key] = (childCounters[key] || 0) + 1;
      const newId = `${childCounters[key]}`;
      idMap.set(row.nodeId, newId);
      currentParentId[1] = newId;
    } else {
      // L3~L5: 바로 위 레벨의 "현재 ID"를 부모로 사용
      const parentDepth = depth - 1;
      const parentId = currentParentId[parentDepth] || "";

      if (parentId) {
        const key = `p-${parentId}`;
        childCounters[key] = (childCounters[key] || 0) + 1;
        const newId = `${parentId}.${childCounters[key]}`;
        idMap.set(row.nodeId, newId);
        currentParentId[depth] = newId;
      } else {
        // 부모가 없으면 해당 depth 기준 단독 번호
        const key = `orphan-${depth}`;
        childCounters[key] = (childCounters[key] || 0) + 1;
        const newId = `${childCounters[key]}`;
        idMap.set(row.nodeId, newId);
        currentParentId[depth] = newId;
      }
    }

    // 더 깊은 레벨의 카운터 리셋 (새 부모가 바뀌었으므로)
    for (let d = depth + 1; d <= 4; d++) {
      delete currentParentId[d];
    }
  }

  setNodes((nds) =>
    nds.map((n) => {
      const newId = idMap.get(n.id);
      if (!newId) return n;
      return { ...n, data: { ...getNodeData(n), id: newId } };
    })
  );
}

/* ═══ 확장 메타 요약 (variant 별 actor / system 키 사용) ═══ */
function getExtMetaSummary(n: Node, variant: CsvVariant): string {
  const d = getNodeData(n);
  const parts: string[] = [];
  const actors = d.actors as Record<string, string> | undefined;
  if (actors) {
    const ap: string[] = [];
    for (const def of getActorDefsForVariant(variant)) {
      const v = actors[def.key];
      if (v) ap.push(`${def.laneLabel}:${v}`);
    }
    if (ap.length) parts.push("수행(" + ap.join(",") + ")");
  }
  if (d.mainPerson) parts.push("주담당:" + d.mainPerson);
  if (d.avgTime) parts.push("소요:" + d.avgTime);
  const sys = d.systems as Record<string, string> | undefined;
  if (sys) {
    const sp: string[] = [];
    for (const def of getSystemDefsForVariant(variant)) {
      if (sys[def.key]?.trim()) sp.push(def.displayLabel);
    }
    if (sp.length) parts.push("시스템(" + sp.join(",") + ")");
  }
  const pp = d.painPoints as Record<string, string> | undefined;
  if (pp) {
    const cnt = Object.values(pp).filter(v => v?.trim()).length;
    if (cnt > 0) parts.push("PP:" + cnt + "건");
  }
  return parts.join(" · ");
}

/* ═══ 메인 컴포넌트 ═══ */
export default function NodeManagerPanel({ isOpen, onClose, nodes, setNodes, variant = "doosan-hr-4" }: Props) {
  /* variant 의 역할 라벨 + 빈값/그 외 */
  const ROLE_OPTIONS = useMemo(
    () => ["", ...getRoleOptionsForVariant(variant), "그 외"],
    [variant],
  );
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<RowData | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addForm, setAddForm] = useState<Omit<RowData, "nodeId">>({
    level: "L4", displayId: "", name: "", description: "", role: "", memo: "",
  });
  const [addAfterIdx, setAddAfterIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const rows: RowData[] = useMemo(() => buildFlatRows(nodes), [nodes]);

  /* ── 토스트 자동 닫기 ── */
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 2000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const startEdit = useCallback((idx: number) => {
    setEditingIdx(idx);
    setEditForm({ ...rows[idx] });
  }, [rows]);

  /* ── 편집 저장 (기존 확장 메타 보존) ── */
  const saveEdit = useCallback(() => {
    if (editingIdx === null || !editForm) return;
    const targetNodeId = rows[editingIdx].nodeId;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== targetNodeId) return n;
        const existing = getNodeData(n);
        return {
          ...n,
          type: editForm.level.toLowerCase(),
          data: {
            ...existing,
            level: editForm.level,
            id: editForm.displayId,
            label: editForm.name,
            description: editForm.description,
            role: editForm.role,
            memo: editForm.memo,
          },
        };
      })
    );
    setEditingIdx(null);
    setEditForm(null);
    setToast("✅ 수정 완료");
  }, [editingIdx, editForm, rows, setNodes]);

  const cancelEdit = useCallback(() => { setEditingIdx(null); setEditForm(null); }, []);

  const deleteRow = useCallback((idx: number) => {
    const targetNodeId = rows[idx].nodeId;
    if (!confirm(`"${rows[idx].name || rows[idx].displayId}" 노드를 삭제하시겠습니까?`)) return;
    setNodes((nds: Node[]) => nds.filter((n) => n.id !== targetNodeId));
    setToast("🗑️ 삭제 완료");
  }, [rows, setNodes]);

  const startAddAfter = useCallback((idx: number) => {
    const row = rows[idx];
    let defaultLevel = row.level;
    if (row.level === "L4") defaultLevel = "L5";
    let nextId = "";
    if (row.displayId) {
      const parts = row.displayId.split(".");
      if (defaultLevel === row.level) {
        const last = parseInt(parts[parts.length - 1]) || 0;
        nextId = [...parts.slice(0, -1), (last + 1).toString()].join(".");
      } else {
        nextId = row.displayId + ".1";
      }
    }
    setAddForm({ level: defaultLevel as RowData["level"], displayId: nextId, name: "", description: "", role: "", memo: "" });
    setAddAfterIdx(idx);
    setAddMode(true);
  }, [rows]);

  const addRow = useCallback(() => {
    if (!addForm.name.trim()) { alert("이름을 입력해주세요."); return; }
    const levelKey = addForm.level.toLowerCase() as "l2" | "l3" | "l4" | "l5";
    const newId = levelKey + "-mgr-" + Date.now();
    let x = 400, y = 300;
    if (addAfterIdx !== null && addAfterIdx < rows.length) {
      const refNodeId = rows[addAfterIdx].nodeId;
      const refNode = nodes.find(n => n.id === refNodeId);
      if (refNode) {
        x = refNode.position.x + (addForm.level === rows[addAfterIdx].level ? 0 : 200);
        y = refNode.position.y + 200;
      }
    }
    const newNode: Node = {
      id: newId, type: levelKey,
      position: { x, y },
      data: {
        label: addForm.name.trim(), level: addForm.level,
        id: addForm.displayId.trim() || addForm.level + "-" + Date.now(),
        description: addForm.description.trim(), role: addForm.role, memo: addForm.memo.trim(),
      },
    };
    if (addAfterIdx !== null && addAfterIdx < rows.length) {
      const afterNodeId = rows[addAfterIdx].nodeId;
      setNodes((nds: Node[]) => {
        const i = nds.findIndex(n => n.id === afterNodeId);
        if (i === -1) return [...nds, newNode];
        const copy = [...nds]; copy.splice(i + 1, 0, newNode); return copy;
      });
    } else {
      setNodes((nds: Node[]) => [...nds, newNode]);
    }
    const addedName = addForm.name.trim();
    setAddForm({ level: "L4", displayId: "", name: "", description: "", role: "", memo: "" });
    setAddMode(false); setAddAfterIdx(null);
    setToast(`✅ "${addedName}" 추가 완료`);
    // 스크롤 아래로 (새 행 보이게)
    setTimeout(() => {
      if (addAfterIdx !== null) {
        // 삽입 위치 근처로 스크롤
        const targetRow = tableRef.current?.querySelector(`[data-row-index="${addAfterIdx + 1}"]`);
        targetRow?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        tableRef.current?.scrollTo({ top: tableRef.current.scrollHeight, behavior: "smooth" });
      }
    }, 100);
  }, [addForm, addAfterIdx, rows, nodes, setNodes]);

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragFromRef.current = idx;
    e.dataTransfer.effectAllowed = "move";
    // setData required for Firefox
    e.dataTransfer.setData("text/plain", String(idx));
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    if (dragFromRef.current === null) return; // 외부 드래그 무시
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }, []);
  const handleDragEnd = useCallback(() => {
    dragFromRef.current = null;
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromIdx = dragFromRef.current;
    dragFromRef.current = null;
    setDragOverIdx(null);
    if (fromIdx === null || fromIdx === dropIdx) return;
    const orderedIds = rows.map((r) => r.nodeId);
    const [moved] = orderedIds.splice(fromIdx, 1);
    // fromIdx < dropIdx이면 제거 후 인덱스가 1 줄어드므로 보정
    orderedIds.splice(fromIdx < dropIdx ? dropIdx - 1 : dropIdx, 0, moved);
    setNodes((nds: Node[]) => {
      const map = new Map(nds.map((n) => [n.id, n]));
      const reordered: Node[] = [];
      for (const id of orderedIds) { const nd = map.get(id); if (nd) { reordered.push(nd); map.delete(id); } }
      map.forEach((nd) => reordered.push(nd));
      return reordered;
    });
    setToast("↕️ 순서 변경 완료");
  }, [rows, setNodes]);

  /* ── 계층 정렬 (ID 기반 트리 순서로 재정렬) ── */
  const handleSortByHierarchy = useCallback(() => {
    setNodes((nds: Node[]) => {
      const sorted = [...nds].sort((a, b) => {
        const levelOrder: Record<string, number> = { l2: 0, l3: 1, l4: 2, l5: 3 };
        const la = levelOrder[(a.data?.level as string)?.toLowerCase()] ?? 9;
        const lb = levelOrder[(b.data?.level as string)?.toLowerCase()] ?? 9;
        const idA = (a.data?.id as string) || "";
        const idB = (b.data?.id as string) || "";
        return idA.localeCompare(idB, undefined, { numeric: true }) || (la - lb);
      });
      return sorted;
    });
    setToast("🔀 계층 정렬 완료");
  }, [setNodes]);

  /* ── 캔버스 배치 순서로 정렬 (좌→우, 상→하) ── */
  const handleSortByCanvas = useCallback(() => {
    setNodes((nds: Node[]) => {
      const ROW_TOLERANCE = 60; // Y좌표 차이가 이 이내면 같은 행으로 간주
      const sorted = [...nds].sort((a, b) => {
        const ay = a.position?.y ?? 0;
        const by = b.position?.y ?? 0;
        // 같은 행이면 X좌표 기준 왼→오
        if (Math.abs(ay - by) < ROW_TOLERANCE) {
          return (a.position?.x ?? 0) - (b.position?.x ?? 0);
        }
        // 다른 행이면 Y좌표 기준 위→아래
        return ay - by;
      });
      return sorted;
    });
    setToast("📐 캔버스 순서 정렬 완료");
  }, [setNodes]);

  const handleRenumber = useCallback(() => {
    if (!confirm("현재 보이는 리스트 순서 기반으로 모든 ID를 재번호 매기시겠습니까?")) return;
    renumberIds(nodes, setNodes);
    setToast("🔢 ID 재번호 완료");
  }, [nodes, setNodes]);

  const exportCsv = useCallback(() => {
    if (nodes.length === 0) { alert("캔버스에 노드가 없습니다."); return; }
    const csvContent = buildTemplateCsvString(nodes);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `HR_Template_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast("📥 원본 양식 CSV 내보내기 완료 (44-컬럼)");
  }, [nodes]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-[960px] max-w-[95vw] max-h-[85vh] flex flex-col border border-gray-200">
        {/* Header */}
        <div className="px-6 py-4 rounded-t-xl bg-gradient-to-r from-[#A62121] to-[#D95578] text-white flex items-center justify-between flex-none">
          <div>
            <h2 className="text-lg font-bold">📋 노드 관리</h2>
            <p className="text-xs opacity-80 mt-0.5">계층 구조 · 추가 · 수정 · 삭제 · 드래그 정렬 · ID 재번호 · 엑셀 내보내기</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRenumber} className="px-3 py-1.5 text-xs font-bold bg-white/20 hover:bg-white/30 rounded-lg transition-colors" title="계층 순서 기반 ID 자동 재번호">🔢 ID 재번호</button>
            <button onClick={exportCsv} className="px-3 py-1.5 text-xs font-bold bg-white/20 hover:bg-white/30 rounded-lg transition-colors" title="CSV 내보내기">📥 엑셀</button>
            <button onClick={onClose} className="text-2xl font-light opacity-70 hover:opacity-100 transition-opacity ml-2">×</button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-none bg-gray-50/50">
          <button onClick={() => { setAddMode(!addMode); setAddAfterIdx(null); }} className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${addMode ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-blue-500 text-white hover:bg-blue-600"}`}>
            {addMode ? "✕ 추가 취소" : "➕ 새 노드 추가"}
          </button>
          <button onClick={handleSortByHierarchy} className="px-3 py-2 text-xs font-medium bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors" title="ID 기준 계층 정렬">🔀 계층 정렬</button>
          <button onClick={handleSortByCanvas} className="px-3 py-2 text-xs font-medium bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors" title="캔버스 배치(좌→우, 상→하) 순서로 정렬">📐 캔버스 순서</button>
          <span className="text-xs text-gray-400">총 {rows.length}개 노드 · ⠿ 드래그로 순서 변경 · ➕ 행 사이 삽입 가능</span>
        </div>

        {/* Add Form */}
        {addMode && (
          <div className="px-6 py-3 border-b border-blue-100 bg-blue-50/50 flex-none">
            {addAfterIdx !== null && (
              <div className="text-[10px] text-blue-600 font-medium mb-2">
                📍 &ldquo;{rows[addAfterIdx]?.name}&rdquo; ({rows[addAfterIdx]?.displayId}) 뒤에 삽입
              </div>
            )}
            <div className="flex items-end gap-2 flex-wrap">
              <div className="w-[80px]">
                <label className="block text-[10px] font-semibold text-gray-500 mb-1">레벨</label>
                <select value={addForm.level} onChange={(e) => setAddForm({ ...addForm, level: e.target.value as RowData["level"] })} className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs">
                  {LEVEL_OPTIONS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                </select>
              </div>
              <div className="w-[100px]">
                <label className="block text-[10px] font-semibold text-gray-500 mb-1">ID</label>
                <input value={addForm.displayId} onChange={(e) => setAddForm({ ...addForm, displayId: e.target.value })} placeholder="자동" className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs" />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-semibold text-gray-500 mb-1">이름 *</label>
                <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") addRow(); }} placeholder="노드 이름" className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs" autoFocus />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[10px] font-semibold text-gray-500 mb-1">설명</label>
                <input value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} placeholder="설명" className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs" />
              </div>
              <div className="w-[110px]">
                <label className="block text-[10px] font-semibold text-gray-500 mb-1">수행주체</label>
                <select value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })} className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs">
                  <option value="">선택</option>
                  {ROLE_OPTIONS.filter(Boolean).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button onClick={addRow} className="px-4 py-1.5 text-xs font-bold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition whitespace-nowrap">✓ 추가</button>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-xs font-medium px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto" ref={tableRef}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="w-8 py-2 px-1 text-center text-gray-400 font-medium">⠿</th>
                <th className="w-[60px] py-2 px-2 text-left font-semibold text-gray-600">Level</th>
                <th className="w-[90px] py-2 px-2 text-left font-semibold text-gray-600">ID</th>
                <th className="min-w-[140px] py-2 px-2 text-left font-semibold text-gray-600">이름</th>
                <th className="min-w-[120px] py-2 px-2 text-left font-semibold text-gray-600">설명</th>
                <th className="w-[90px] py-2 px-2 text-left font-semibold text-gray-600">수행주체</th>
                <th className="min-w-[140px] py-2 px-2 text-left font-semibold text-gray-600">메타</th>
                <th className="w-[100px] py-2 px-2 text-center font-semibold text-gray-600">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400">캔버스에 노드가 없습니다.</td></tr>
              ) : (
                rows.map((row, idx) => {
                  const isEditing = editingIdx === idx;
                  const lc = LEVEL_COLORS[row.level] || LEVEL_COLORS.L4;
                  const isDragOver = dragOverIdx === idx;
                  const indentLevel = { L2: 0, L3: 1, L4: 2, L5: 3 }[row.level] || 0;
                  const nd = nodes.find(n => n.id === row.nodeId);
                  const extSummary = nd ? getExtMetaSummary(nd, variant) : "";

                  return (
                    <tr
                      key={row.nodeId}
                      data-row-index={idx}
                      draggable={!isEditing}
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as globalThis.Node)) return;
                        setDragOverIdx(null);
                      }}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`border-b border-gray-100 transition-colors ${isDragOver ? "bg-blue-50 border-t-2 border-t-blue-400" : "hover:bg-gray-50/50"} ${isEditing ? "bg-yellow-50" : ""}`}
                    >
                      <td className="py-2 px-1 text-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none">⠿</td>

                      {isEditing && editForm ? (
                        <>
                          <td className="py-1.5 px-2">
                            <select value={editForm.level} onChange={(e) => setEditForm({ ...editForm, level: e.target.value as RowData["level"] })} className="w-full border border-yellow-300 rounded px-1.5 py-1 text-xs bg-yellow-50">
                              {LEVEL_OPTIONS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 px-2"><input value={editForm.displayId} onChange={(e) => setEditForm({ ...editForm, displayId: e.target.value })} className="w-full border border-yellow-300 rounded px-1.5 py-1 text-xs bg-yellow-50" /></td>
                          <td className="py-1.5 px-2"><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full border border-yellow-300 rounded px-1.5 py-1 text-xs bg-yellow-50" autoFocus /></td>
                          <td className="py-1.5 px-2"><input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="w-full border border-yellow-300 rounded px-1.5 py-1 text-xs bg-yellow-50" /></td>
                          <td className="py-1.5 px-2">
                            <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} className="w-full border border-yellow-300 rounded px-1.5 py-1 text-xs bg-yellow-50">
                              <option value="">선택</option>
                              {ROLE_OPTIONS.filter(Boolean).map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>
                          <td className="py-1.5 px-2 text-[10px] text-gray-400">(보존됨)</td>
                          <td className="py-1.5 px-2 text-center">
                            <div className="flex gap-1 justify-center">
                              <button onClick={saveEdit} className="px-2 py-1 text-[10px] font-bold bg-green-500 text-white rounded hover:bg-green-600 transition">✓</button>
                              <button onClick={cancelEdit} className="px-2 py-1 text-[10px] font-bold bg-gray-300 text-gray-600 rounded hover:bg-gray-400 transition">✕</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 px-2">
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: lc.bg, color: lc.text, border: `1px solid ${lc.border}`, marginLeft: `${indentLevel * 12}px` }}>
                              {row.level}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-mono text-gray-500">{row.displayId}</td>
                          <td className="py-2 px-2 font-medium text-gray-800" style={{ paddingLeft: `${8 + indentLevel * 16}px` }}>{row.name}</td>
                          <td className="py-2 px-2 text-gray-500 truncate max-w-[200px]" title={row.description}>{row.description || <span className="text-gray-300">—</span>}</td>
                          <td className="py-2 px-2 text-gray-500">{row.role ? displayRole(row.role) : <span className="text-gray-300">—</span>}</td>
                          <td className="py-2 px-2">
                            {extSummary ? (
                              <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded" title={extSummary}>
                                📋 {extSummary.length > 30 ? extSummary.slice(0, 30) + "…" : extSummary}
                              </span>
                            ) : row.memo ? (
                              <span className="text-[10px] text-gray-500" title={row.memo}>📝 {row.memo.slice(0, 20)}{row.memo.length > 20 ? "…" : ""}</span>
                            ) : (
                              <span className="text-gray-300 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="flex gap-0.5 justify-center">
                              <button onClick={() => startAddAfter(idx)} className="px-1.5 py-1 text-[10px] font-bold bg-blue-50 text-blue-500 rounded hover:bg-blue-100 transition" title="이 행 뒤에 삽입">➕</button>
                              <button onClick={() => startEdit(idx)} className="px-1.5 py-1 text-[10px] font-bold bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition" title="수정">✏️</button>
                              <button onClick={() => deleteRow(idx)} className="px-1.5 py-1 text-[10px] font-bold bg-red-100 text-red-600 rounded hover:bg-red-200 transition" title="삭제">🗑️</button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between flex-none bg-gray-50/50">
          <span className="text-[10px] text-gray-400">💡 ⠿ 드래그→순서 변경 · ➕ 행 사이 삽입 · 🔢 ID 재번호→리스트 순서 기반 자동 번호 · 메타데이터 편집 시 보존</span>
          <div className="flex gap-2">
            <button onClick={handleRenumber} className="px-4 py-2 text-xs font-medium bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition">🔢 ID 재번호</button>
            <button onClick={exportCsv} className="px-4 py-2 text-xs font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 transition">📥 엑셀(CSV)</button>
            <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition">닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
