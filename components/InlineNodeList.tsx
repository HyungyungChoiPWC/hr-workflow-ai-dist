"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { Node } from "@xyflow/react";

/* ═══ Types ═══ */
interface RowData {
  nodeId: string;
  level: "L2" | "L3" | "L4" | "L5";
  displayId: string;
  name: string;
  description: string;
  role: string;
  memo: string;
  isManual: boolean;
}

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  L2: { bg: "#A62121", text: "#FFFFFF", border: "#8A1B1B" },
  L3: { bg: "#D95578", text: "#FFFFFF", border: "#C44466" },
  L4: { bg: "#DEDEDE", text: "#333333", border: "#BBBBBB" },
  L5: { bg: "#FFFFFF", text: "#333333", border: "#DEDEDE" },
};

const LEVEL_OPTIONS = ["L2", "L3", "L4", "L5"] as const;

function nodeToRow(n: Node): RowData {
  const d = (n.data || {}) as Record<string, unknown>;
  return {
    nodeId: n.id,
    level: ((d.level as string) || "L4") as RowData["level"],
    displayId: (d.id as string) || n.id,
    name: (d.label as string) || (d.name as string) || "",
    description: (d.description as string) || "",
    role: (d.role as string) || "",
    memo: (d.memo as string) || "",
    isManual: !!(d.isManual),
  };
}

/* ═══ ID 재번호 ═══ */
function renumberIds(nodes: Node[], setNodes: React.Dispatch<React.SetStateAction<Node[]>>) {
  const levelDepth: Record<string, number> = { L2: 1, L3: 2, L4: 3, L5: 4 };

  /* ① 올바른 계층 ID(숫자+점)인지 확인 */
  const isValidHierarchyId = (id: string) => /^\d+(\.\d+)*$/.test(id);

  /* ② 유효한 계층 ID 순으로 정렬 → 그 다음 level 기준 정렬
   *    "1" < "1.1" < "1.1.1" < "1.1.1.1" < "1.1.2" < "1.2" < "2" …
   *    이 순서가 곧 깊이 우선(DFS) 순서이므로 renumber가 정확해짐 */
  const sortedNodes = [...nodes].sort((a, b) => {
    const da = (a.data || {}) as Record<string, unknown>;
    const db = (b.data || {}) as Record<string, unknown>;
    const idA = (da.id as string) || "";
    const idB = (db.id as string) || "";
    const validA = isValidHierarchyId(idA);
    const validB = isValidHierarchyId(idB);

    if (validA && !validB) return -1;   // 유효 ID 먼저
    if (!validA && validB) return 1;
    if (!validA && !validB) {
      // 둘 다 비정상 ID → level 깊이 순
      const depthA = levelDepth[((da.level as string) || "").toUpperCase()] || 99;
      const depthB = levelDepth[((db.level as string) || "").toUpperCase()] || 99;
      return depthA - depthB;
    }
    return idA.localeCompare(idB, undefined, { numeric: true });
  });

  const rows = sortedNodes.map(nodeToRow);
  const idMap = new Map<string, string>();
  const currentParentId: Record<number, string> = {};
  const childCounters: Record<string, number> = {};

  for (const row of rows) {
    const depth = levelDepth[row.level] || 4;
    if (depth === 1) {
      const key = "root";
      childCounters[key] = (childCounters[key] || 0) + 1;
      const newId = `${childCounters[key]}`;
      idMap.set(row.nodeId, newId);
      currentParentId[1] = newId;
    } else {
      const parentDepth = depth - 1;
      const parentId = currentParentId[parentDepth] || "";
      if (parentId) {
        const key = `p-${parentId}`;
        childCounters[key] = (childCounters[key] || 0) + 1;
        const newId = `${parentId}.${childCounters[key]}`;
        idMap.set(row.nodeId, newId);
        currentParentId[depth] = newId;
      } else {
        /* 부모가 없는 경우: 가장 가까운 상위 레벨에 붙임 */
        let foundParentId = "";
        for (let pd = parentDepth - 1; pd >= 1; pd--) {
          if (currentParentId[pd]) { foundParentId = currentParentId[pd]; break; }
        }
        const key = foundParentId ? `p-${foundParentId}` : `orphan-${depth}`;
        childCounters[key] = (childCounters[key] || 0) + 1;
        const newId = foundParentId
          ? `${foundParentId}.${childCounters[key]}`
          : `${childCounters[key]}`;
        idMap.set(row.nodeId, newId);
        currentParentId[depth] = newId;
      }
    }
    for (let d = depth + 1; d <= 4; d++) delete currentParentId[d];
  }

  setNodes((nds: Node[]) =>
    nds.map((n) => {
      const newDisplayId = idMap.get(n.id);
      if (!newDisplayId) return n;
      return { ...n, data: { ...(n.data as Record<string, unknown>), id: newDisplayId } };
    })
  );
}

/* ═══ Props ═══ */
interface Props {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
}

export default function InlineNodeList({ nodes, setNodes }: Props) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    level: string; displayId: string; name: string; description: string; role: string;
  } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [addAfterIdx, setAddAfterIdx] = useState<number | null>(null);
  const [addForm, setAddForm] = useState({ level: "L4" as string, displayId: "", name: "", description: "", role: "" });
  const [toast, setToast] = useState<string | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => nodes.map(nodeToRow), [nodes]);

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 2000); return () => clearTimeout(t); }
  }, [toast]);

  /* ── Edit ── */
  const startEdit = useCallback((idx: number) => {
    const r = rows[idx];
    setEditingIdx(idx);
    setEditForm({ level: r.level, displayId: r.displayId, name: r.name, description: r.description, role: r.role });
  }, [rows]);

  const saveEdit = useCallback(() => {
    if (editingIdx === null || !editForm) return;
    const targetNodeId = rows[editingIdx].nodeId;
    setNodes((nds: Node[]) =>
      nds.map((n) => {
        if (n.id !== targetNodeId) return n;
        const existing = (n.data || {}) as Record<string, unknown>;
        return {
          ...n,
          type: editForm.level.toLowerCase() as "l2" | "l3" | "l4" | "l5",
          data: {
            ...existing,
            level: editForm.level,
            id: editForm.displayId,
            label: editForm.name,
            description: editForm.description,
            role: editForm.role,
          },
        };
      })
    );
    setEditingIdx(null);
    setEditForm(null);
    setToast("✅ 수정 완료");
  }, [editingIdx, editForm, rows, setNodes]);

  const cancelEdit = useCallback(() => { setEditingIdx(null); setEditForm(null); }, []);

  /* ── Delete ── */
  const deleteRow = useCallback((idx: number) => {
    const r = rows[idx];
    if (!confirm(`"${r.name || r.displayId}" 삭제?`)) return;
    setNodes((nds: Node[]) => nds.filter((n) => n.id !== r.nodeId));
    setToast("🗑️ 삭제 완료");
  }, [rows, setNodes]);

  /* ── Add After ── */
  const startAddAfter = useCallback((idx: number) => {
    const r = rows[idx];
    let defaultLevel = r.level;
    if (r.level === "L4") defaultLevel = "L5";
    let nextId = "";
    if (r.displayId) {
      const parts = r.displayId.split(".");
      if (defaultLevel === r.level) {
        const last = parseInt(parts[parts.length - 1]) || 0;
        nextId = [...parts.slice(0, -1), (last + 1).toString()].join(".");
      } else {
        nextId = r.displayId + ".1";
      }
    }
    setAddForm({ level: defaultLevel, displayId: nextId, name: "", description: "", role: "" });
    setAddAfterIdx(idx);
    setAddMode(true);
  }, [rows]);

  const addRow = useCallback(() => {
    if (!addForm.name.trim()) { alert("이름을 입력해주세요."); return; }
    const levelKey = addForm.level.toLowerCase() as "l2" | "l3" | "l4" | "l5";
    const newId = levelKey + "-mgr-" + Date.now();
    let x = 400, y = 300;
    if (addAfterIdx !== null && addAfterIdx < rows.length) {
      const refNode = nodes.find(n => n.id === rows[addAfterIdx].nodeId);
      if (refNode) { x = refNode.position.x; y = refNode.position.y + 200; }
    }
    const newNode: Node = {
      id: newId,
      type: levelKey,
      position: { x, y },
      data: {
        label: addForm.name.trim(),
        level: addForm.level,
        id: addForm.displayId.trim() || addForm.level + "-" + Date.now(),
        description: addForm.description.trim(),
        role: addForm.role,
        isManual: true,
      },
    };
    if (addAfterIdx !== null && addAfterIdx < rows.length) {
      const afterNodeId = rows[addAfterIdx].nodeId;
      setNodes((nds: Node[]) => {
        const i = nds.findIndex(n => n.id === afterNodeId);
        if (i === -1) return [...nds, newNode];
        const copy = [...nds];
        copy.splice(i + 1, 0, newNode);
        return copy;
      });
    } else {
      setNodes((nds: Node[]) => [...nds, newNode]);
    }
    setToast(`✅ "${addForm.name.trim()}" 추가`);
    setAddForm({ level: "L4", displayId: "", name: "", description: "", role: "" });
    setAddMode(false);
    setAddAfterIdx(null);
  }, [addForm, addAfterIdx, rows, nodes, setNodes]);

  /* ── Drag Reorder ── */
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragFromRef.current = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    if (dragFromRef.current === null) return; // 외부 드래그(팔레트 등) 무시
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
    const orderedIds = rows.map(r => r.nodeId);
    const [moved] = orderedIds.splice(fromIdx, 1);
    // fromIdx < dropIdx이면 제거 후 인덱스가 1 줄어드므로 보정
    orderedIds.splice(fromIdx < dropIdx ? dropIdx - 1 : dropIdx, 0, moved);
    setNodes((nds: Node[]) => {
      const map = new Map(nds.map(n => [n.id, n]));
      const reordered: Node[] = [];
      for (const id of orderedIds) {
        const nd = map.get(id);
        if (nd) { reordered.push(nd); map.delete(id); }
      }
      map.forEach(nd => reordered.push(nd));
      return reordered;
    });
    setToast("↕️ 순서 변경");
  }, [rows, setNodes]);

  /* ── Actions ── */
  const handleRenumber = useCallback(() => {
    renumberIds(nodes, setNodes);
    setToast("🔢 재번호 완료");
  }, [nodes, setNodes]);

  const handleSort = useCallback(() => {
    setNodes((nds: Node[]) =>
      [...nds].sort((a, b) => {
        const idA = (a.data?.id as string) || "";
        const idB = (b.data?.id as string) || "";
        return idA.localeCompare(idB, undefined, { numeric: true });
      })
    );
    setToast("🔀 정렬 완료");
  }, [setNodes]);

  const exportCsv = useCallback(() => {
    const esc = (s: string) => {
      if (!s) return "";
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const header = ["Level", "ID", "이름", "설명", "수행주체", "구분"];
    const csvRows = rows.map(r =>
      [r.level, r.displayId, r.name, r.description, r.role, r.isManual ? "수동 추가" : "원본"].map(esc).join(",")
    );
    const bom = "\uFEFF";
    const blob = new Blob([bom + [header.join(","), ...csvRows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nodes-" + Date.now() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast("📥 CSV 완료");
  }, [rows]);

  /* ═══ Render ═══ */
  const indentPx: Record<string, number> = { L2: 0, L3: 12, L4: 24, L5: 36 };

  return (
    <div className="flex flex-col h-full relative">
      {/* Toolbar */}
      <div className="px-3 py-2 flex items-center gap-1 border-b border-gray-100 bg-gray-50/50 flex-none">
        <button
          onClick={() => { setAddMode(!addMode); setAddAfterIdx(null); }}
          className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${
            addMode ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-blue-500 text-white hover:bg-blue-600"
          }`}
        >
          {addMode ? "✕ 취소" : "➕ 추가"}
        </button>
        <button onClick={handleRenumber} className="px-2 py-1 text-[10px] font-medium bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors" title="리스트 순서 기반 ID 재번호">
          🔢
        </button>
        <button onClick={handleSort} className="px-2 py-1 text-[10px] font-medium bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors" title="ID 기준 계층 정렬">
          🔀
        </button>
        <button onClick={exportCsv} className="px-2 py-1 text-[10px] font-medium bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors" title="CSV 내보내기">
          📥
        </button>
        <span className="ml-auto text-[9px] text-gray-400 font-medium">{rows.length}개</span>
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-[10px] font-medium px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Add Form */}
      {addMode && (
        <div className="px-3 py-2 border-b border-blue-100 bg-blue-50/50 flex-none space-y-1.5">
          {addAfterIdx !== null && rows[addAfterIdx] && (
            <div className="text-[9px] text-blue-600 font-medium truncate">
              📍 &ldquo;{rows[addAfterIdx].name}&rdquo; 뒤에 삽입
            </div>
          )}
          <div className="flex gap-1">
            <select
              value={addForm.level}
              onChange={(e) => setAddForm({ ...addForm, level: e.target.value })}
              className="w-14 border border-gray-200 rounded px-1 py-1 text-[10px]"
            >
              {LEVEL_OPTIONS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
            </select>
            <input
              value={addForm.displayId}
              onChange={(e) => setAddForm({ ...addForm, displayId: e.target.value })}
              placeholder="ID"
              className="w-14 border border-gray-200 rounded px-1 py-1 text-[10px]"
            />
            <input
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") addRow(); }}
              placeholder="이름 *"
              className="flex-1 border border-gray-200 rounded px-1.5 py-1 text-[10px]"
              autoFocus
            />
            <button onClick={addRow} className="px-2 py-1 text-[10px] font-bold bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
              ✓
            </button>
          </div>
        </div>
      )}

      {/* Node List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-center">
            <div className="text-2xl mb-2">📦</div>
            <p className="text-xs text-gray-400">캔버스에 노드가 없습니다</p>
            <p className="text-[10px] text-gray-300 mt-1">📂 데이터 탭에서 항목 클릭 또는 위 ➕ 추가 버튼 사용</p>
          </div>
        ) : (
          rows.map((row, idx) => {
            const isEditing = editingIdx === idx;
            const lc = LEVEL_COLORS[row.level] || LEVEL_COLORS.L4;
            const isDragOver = dragOverIdx === idx;
            const indent = indentPx[row.level] || 0;

            if (isEditing && editForm) {
              return (
                <div key={row.nodeId} className="px-2 py-2 border-b border-yellow-200 bg-yellow-50 space-y-1">
                  <div className="flex gap-1">
                    <select
                      value={editForm.level}
                      onChange={(e) => setEditForm({ ...editForm, level: e.target.value })}
                      className="w-14 border border-yellow-300 rounded px-1 py-1 text-[10px] bg-yellow-50"
                    >
                      {LEVEL_OPTIONS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                    <input
                      value={editForm.displayId}
                      onChange={(e) => setEditForm({ ...editForm, displayId: e.target.value })}
                      className="w-14 border border-yellow-300 rounded px-1 py-1 text-[10px] bg-yellow-50"
                    />
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                      className="flex-1 border border-yellow-300 rounded px-1 py-1 text-[10px] bg-yellow-50"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-1">
                    <input
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      placeholder="설명"
                      className="flex-1 border border-yellow-300 rounded px-1 py-1 text-[10px] bg-yellow-50"
                    />
                    <button onClick={saveEdit} className="px-2 py-1 text-[10px] font-bold bg-green-500 text-white rounded hover:bg-green-600 transition-colors">✓</button>
                    <button onClick={cancelEdit} className="px-2 py-1 text-[10px] font-bold bg-gray-300 text-gray-600 rounded hover:bg-gray-400 transition-colors">✕</button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={row.nodeId}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={(e) => {
                  // child 요소로 이동하는 경우 하이라이트 유지
                  if (e.currentTarget.contains(e.relatedTarget as globalThis.Node)) return;
                  setDragOverIdx(null);
                }}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-1 py-1.5 border-b transition-colors group ${
                  isDragOver ? "bg-blue-50 border-b-2 border-b-blue-400" : "border-gray-100 hover:bg-gray-50/60"
                }`}
                style={{ paddingLeft: `${8 + indent}px`, paddingRight: "8px" }}
              >
                <span className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-[10px] shrink-0">⠿</span>
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold leading-none"
                  style={{ backgroundColor: lc.bg, color: lc.text, border: `1px solid ${lc.border}` }}
                >
                  {row.level}
                </span>
                <span className={`shrink-0 text-[9px] font-mono max-w-[50px] truncate ${row.isManual ? "text-red-400" : "text-gray-400"}`}>{row.displayId}</span>
                <span className={`flex-1 text-[11px] font-medium truncate min-w-0 ${row.isManual ? "text-red-600" : "text-gray-800"}`} title={`${row.name}${row.description ? " — " + row.description : ""}${row.isManual ? " (수동 추가)" : ""}`}>
                  {row.isManual && <span className="text-[8px] mr-0.5">🔴</span>}
                  {row.name}
                </span>
                <div className="shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startAddAfter(idx)} className="p-0.5 text-[9px] text-blue-500 hover:bg-blue-100 rounded transition-colors" title="사이 삽입">➕</button>
                  <button onClick={() => startEdit(idx)} className="p-0.5 text-[9px] text-yellow-600 hover:bg-yellow-100 rounded transition-colors" title="수정">✏️</button>
                  <button onClick={() => deleteRow(idx)} className="p-0.5 text-[9px] text-red-500 hover:bg-red-100 rounded transition-colors" title="삭제">🗑️</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-gray-100 text-[8px] text-gray-400 flex-none bg-gray-50/30">
        💡 ⠿ 드래그→순서 변경 · ➕ 사이 삽입 · hover로 편집 버튼
      </div>
    </div>
  );
}
