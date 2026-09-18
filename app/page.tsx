"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { L2Node, L3Node, L4Node, L5Node, DecisionNode, MemoNode } from "@/components/LevelNode";
import OrthoEdge from "@/components/OrthoEdge";
import ExportToolbar from "@/components/ExportToolbar";
import NodeDetailPanel, { type NodeMeta } from "@/components/NodeDetailPanel";
import SheetTabBar, { type Sheet, type SheetType } from "@/components/SheetTabBar";
import SwimLaneOverlay from "@/components/SwimLaneOverlay";
import AppLogo from "@/components/AppLogo";

/* ═══ 수동 추가 데이터 항목 (폼 타입) ═══ */
export interface ManualItem {
  id: string;
  name: string;
  description: string;
  level: "L4" | "L5";
  role: string;
}
import {
  buildTemplateCsvString,
  parseCsv,
  extractL2List,
  extractL3ByL2,
  extractL4ByL3,
  extractL5ByL4,
  createNodeFromItem,
  getCsvVariantFromRows,
  getDefaultLanesForVariant,
  type CsvRow,
  type CsvVariant,
  type L2Item,
  type L3Item,
  type L4Item,
  type L5Item,
} from "@/lib/csvToFlow";
import type { XlsxExportMeta } from "@/lib/xlsxToFlow";

/* ═══ Sheet data store (nodes + edges per sheet) ═══ */
interface SheetData {
  nodes: Node[];
  edges: Edge[];
}

/* ═══════════════════════════════════════════════ */
export default function Home() {
  /* ── nodeTypes ─────────────────────────────── */
  const nodeTypes = useMemo(
    () => ({ l2: L2Node, l3: L3Node, l4: L4Node, l5: L5Node, decision: DecisionNode, memo: MemoNode }),
    []
  );
  const edgeTypes = useMemo(() => ({ ortho: OrthoEdge }), []);

  /* ── Data State ────────────────────────────── */
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  /* 엑셀(.xlsx) 가져오기 시 원본 양식 라운드트립 내보내기용 보관 */
  const [xlsxTemplate, setXlsxTemplate] = useState<{
    buffer: ArrayBuffer;
    meta: XlsxExportMeta;
    variant: CsvVariant;
    fileName: string;
  } | null>(null);
  const [l2List, setL2List] = useState<L2Item[]>([]);
  const [expandedL2, setExpandedL2] = useState<string | null>(null);
  const [l3Map, setL3Map] = useState<Record<string, L3Item[]>>({});
  const [selectedL3, setSelectedL3] = useState<string | null>(null);
  const [l4List, setL4List] = useState<L4Item[]>([]);
  const [l5Map, setL5Map] = useState<Record<string, L5Item[]>>({});
  const [expandedL4, setExpandedL4] = useState<string | null>(null);
  const [l3PanelCollapsed, setL3PanelCollapsed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  /* ── Canvas State ──────────────────────────── */
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodeCountRef = useRef(0);
  const clipboardRef = useRef<Node[]>([]);
  const nodesRef = useRef<Node[]>([]);

  /* ── Undo / Redo ───────────────────────────── */
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const isRestoringRef = useRef(false);
  const currentSnapRef = useRef<string>("");  // 항상 최신 상태 (키보드 핸들러용)
  const historyBaseRef = useRef<string>("");  // 마지막으로 히스토리에 커밋된 상태
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // nodesRef: always up to date (for keyboard handlers)
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Guard: remove duplicate canvas nodes by data.id (safety net)
  // L5 노드는 의도적 복제(같은 항목 여러 레인에 배치)를 허용하므로 중복 제거 제외
  useEffect(() => {
    const seen = new Set<string>();
    let hasDups = false;
    for (const n of nodes) {
      const d = n.data as Record<string, unknown>;
      const dataId = d.id as string;
      const level = (d.level as string)?.toUpperCase();
      if (!dataId || level === "L5") continue; // L5는 중복 허용
      if (seen.has(dataId)) { hasDups = true; break; }
      seen.add(dataId);
    }
    if (!hasDups) return;
    setNodes((nds) => {
      const seenIds = new Set<string>();
      return nds.filter((n) => {
        const d = n.data as Record<string, unknown>;
        const dataId = d.id as string;
        const level = (d.level as string)?.toUpperCase();
        if (!dataId || level === "L5") return true; // L5는 중복 허용
        if (seenIds.has(dataId)) return false;
        seenIds.add(dataId);
        return true;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  /* ── 캔버스 → 팔레트 역방향 동기화 (label/description만) ── */
  const nodeDataSig = useMemo(
    () =>
      nodes
        .filter((n) => ((n.data as Record<string, unknown>).level as string)?.toUpperCase() === "L5")
        .map((n) => {
          const d = n.data as Record<string, unknown>;
          return `${d.id}|${d.label}|${d.description ?? ""}`;
        })
        .join("\n"),
    [nodes]
  );
  useEffect(() => {
    setL5Map((prev) => {
      let changed = false;
      const next: Record<string, typeof prev[string]> = {};
      for (const [l4Id, items] of Object.entries(prev)) {
        // Dedup by id (guard against any duplicate entries)
        const seen = new Set<string>();
        const deduped = items.filter((item) => {
          if (seen.has(item.id)) { changed = true; return false; }
          seen.add(item.id);
          return true;
        });
        next[l4Id] = deduped.map((item) => {
          const canvasNode = nodesRef.current.find((n) => {
            const d = n.data as Record<string, unknown>;
            return (d.id as string) === item.id;
          });
          if (canvasNode) {
            const d = canvasNode.data as Record<string, unknown>;
            const newName = (d.label as string) || item.name;
            const newDesc = (d.description as string) ?? item.description ?? "";
            if (newName !== item.name || newDesc !== (item.description ?? "")) {
              changed = true;
              return { ...item, name: newName, description: newDesc };
            }
          }
          return item;
        });
      }
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeDataSig]);

  // Track current state + debounced history push
  useEffect(() => {
    if (isRestoringRef.current) return;
    const snap = JSON.stringify({ nodes, edges });
    currentSnapRef.current = snap; // 항상 최신 상태 유지
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      // historyBaseRef: 이전 커밋 기준으로 비교해야 debounce가 올바르게 동작
      if (historyBaseRef.current && snap !== historyBaseRef.current) {
        undoStackRef.current.push(historyBaseRef.current);
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
      historyBaseRef.current = snap;
    }, 500);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [nodes, edges]);

  // Keyboard handler: Ctrl+Z / Ctrl+Y / ⌘+Z / ⌘+Shift+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // contentEditable도 skip
      if ((e.target as HTMLElement)?.isContentEditable) return;
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      const key = e.key.toLowerCase();

      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        // Flush pending debounce
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        // Push current to redo
        redoStackRef.current.push(currentSnapRef.current);
        // Pop previous
        const prev = stack.pop()!;
        currentSnapRef.current = prev;
        historyBaseRef.current = prev;
        const parsed = JSON.parse(prev);
        isRestoringRef.current = true;
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        setTimeout(() => { isRestoringRef.current = false; }, 600);
      }
      if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        const stack = redoStackRef.current;
        if (stack.length === 0) return;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        undoStackRef.current.push(currentSnapRef.current);
        const next = stack.pop()!;
        currentSnapRef.current = next;
        historyBaseRef.current = next;
        const parsed = JSON.parse(next);
        isRestoringRef.current = true;
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        setTimeout(() => { isRestoringRef.current = false; }, 600);
      }

      // Ctrl+A: 전체 선택
      if (key === "a") {
        e.preventDefault();
        e.stopPropagation();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
      }

      // Ctrl+C: 선택된 노드 복사
      if (key === "c") {
        e.preventDefault();
        e.stopPropagation();
        const selected = nodesRef.current.filter((n) => n.selected);
        if (selected.length > 0) clipboardRef.current = selected;
      }

      // Ctrl+V: 복사된 노드 붙여넣기 (오프셋 +40px)
      if (key === "v") {
        const copied = clipboardRef.current;
        if (copied.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const offset = 40;
        const now = Date.now();
        const newNodes: Node[] = copied.map((n, i) => ({
          ...n,
          id: `${n.id}_copy_${now}_${i}`,
          position: { x: n.position.x + offset, y: n.position.y + offset },
          selected: true,
        }));
        setNodes((nds) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...newNodes,
        ]);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setNodes, setEdges]);

  /* ── Sheet (multi-tab) State ───────────────── */
  const [sheets, setSheets] = useState<Sheet[]>([
    { id: "sheet-1", name: "시트 1", type: "blank" },
  ]);
  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const sheetDataRef = useRef<Record<string, SheetData>>({});
  const sheetCountRef = useRef(1);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  /* Switch to a different sheet */
  const handleSelectSheet = useCallback(
    (id: string) => {
      if (id === activeSheetId) return;
      // Save current sheet data
      sheetDataRef.current[activeSheetId] = { nodes, edges };
      // Load new sheet data
      const data = sheetDataRef.current[id] || { nodes: [], edges: [] };
      setNodes(data.nodes);
      setEdges(data.edges);
      nodeCountRef.current = data.nodes.length;
      setActiveSheetId(id);
      setSelectedNode(null);
    },
    [activeSheetId, nodes, edges, setNodes, setEdges]
  );

  /* Add a new sheet */
  const handleAddSheet = useCallback(
    (type: SheetType, customLanes?: string[], variant?: CsvVariant) => {
      // Save current sheet first
      sheetDataRef.current[activeSheetId] = { nodes, edges };
      // Create new
      sheetCountRef.current++;
      const newId = `sheet-${Date.now()}`;
      /* variant 가 명시되면 해당 variant 의 기본 lane 라벨 사용, 아니면 doosan-hr-4 4분할 */
      const defaultLanes = variant
        ? getDefaultLanesForVariant(variant)
        : ["현업 임원", "팀장", "HR 담당자", "구성원"];
      const lanes = type === "swimlane" ? (customLanes || defaultLanes) : undefined;
      const label = type === "swimlane"
        ? `${lanes?.length ?? 4}분할 시트`
        : "빈 시트";
      const newSheet: Sheet = {
        id: newId,
        name: `${label} ${sheetCountRef.current}`,
        type,
        ...(lanes ? { lanes } : {}),
        ...(variant ? { variant } : {}),
      };
      setSheets((prev) => [...prev, newSheet]);
      sheetDataRef.current[newId] = { nodes: [], edges: [] };
      // Switch to new
      setNodes([]);
      setEdges([]);
      nodeCountRef.current = 0;
      setActiveSheetId(newId);
      setSelectedNode(null);
      // Center the view on the new sheet after React renders
      setTimeout(() => {
        rfInstanceRef.current?.fitView({ padding: 0.1, maxZoom: 1.5, duration: 300 });
      }, 100);
    },
    [activeSheetId, nodes, edges, setNodes, setEdges]
  );

  /* Update lane heights for active swim lane sheet */
  const handleLaneHeightsChange = useCallback((heights: number[]) => {
    setSheets((prev) => prev.map((s) =>
      s.id === activeSheetId ? { ...s, laneHeights: heights } : s
    ));
  }, [activeSheetId]);

  /* Delete a sheet */
  const handleDeleteSheet = useCallback(
    (id: string) => {
      if (sheets.length <= 1) return;
      const remaining = sheets.filter((s) => s.id !== id);
      delete sheetDataRef.current[id];
      setSheets(remaining);
      if (activeSheetId === id) {
        const nextId = remaining[0].id;
        const data = sheetDataRef.current[nextId] || { nodes: [], edges: [] };
        setNodes(data.nodes);
        setEdges(data.edges);
        nodeCountRef.current = data.nodes.length;
        setActiveSheetId(nextId);
      }
    },
    [sheets, activeSheetId, setNodes, setEdges]
  );

  /* Rename a sheet */
  const handleRenameSheet = useCallback(
    (id: string, name: string) => {
      setSheets((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    },
    []
  );

  /* Duplicate a sheet */
  const handleDuplicateSheet = useCallback(
    (id: string) => {
      // Save current first
      sheetDataRef.current[activeSheetId] = { nodes, edges };
      const src = sheets.find((s) => s.id === id);
      if (!src) return;
      sheetCountRef.current++;
      const newId = `sheet-${Date.now()}`;
      const newSheet: Sheet = { ...src, id: newId, name: `${src.name} (복사)` };
      const srcData = sheetDataRef.current[id] || { nodes: [], edges: [] };
      // Deep copy nodes/edges with new IDs to avoid conflicts
      const newNodes = srcData.nodes.map((n) => ({ ...n }));
      const newEdges = srcData.edges.map((e) => ({ ...e }));
      sheetDataRef.current[newId] = { nodes: newNodes, edges: newEdges };
      setSheets((prev) => [...prev, newSheet]);
      // Switch to copy
      setNodes(newNodes);
      setEdges(newEdges);
      nodeCountRef.current = newNodes.length;
      setActiveSheetId(newId);
    },
    [activeSheetId, sheets, nodes, edges, setNodes, setEdges]
  );

  /* Get current active sheet object */
  const activeSheet = useMemo(
    () => sheets.find((s) => s.id === activeSheetId) || sheets[0],
    [sheets, activeSheetId]
  );

  /* Get sheet data for a specific sheet (used by ExportToolbar JSON save) */
  const getSheetData = useCallback(
    (id: string) => sheetDataRef.current[id] || { nodes: [], edges: [] },
    []
  );


  /* ── Node Detail Panel ─────────────────────── */
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  /* ── React Flow wrapper ref (for export) ───── */
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  /* ── Search ────────────────────────────────── */
  const [searchTerm, setSearchTerm] = useState("");

  /* ── Data Add Form ── */
  const [addDataMode, setAddDataMode] = useState(false);
  const [addDataForm, setAddDataForm] = useState({ level: "L5" as ManualItem["level"], id: "", name: "", description: "", role: "" });

  /* ── Palette Edit Mode ── */
  const [paletteEditMode, setPaletteEditMode] = useState(false);
  const [editingPaletteItem, setEditingPaletteItem] = useState<string | null>(null);
  const [editPaletteForm, setEditPaletteForm] = useState({ name: "", description: "" });
  const [dragSource, setDragSource] = useState<{ type: "l4" | "l5"; l4Id: string; idx: number } | null>(null);

  /* ── 수동 추가 → l4List / l5Map + 캔버스 동시 등록 ── */
  const handleAddManualItem = useCallback(() => {
    if (!addDataForm.name.trim()) { alert("이름을 입력해주세요."); return; }
    const lvl = addDataForm.level;
    if (lvl === "L4") {
      const parentL3 = selectedL3 || "";
      const prefix = l4List.length > 0 ? l4List[0].id.split(".").slice(0, -1).join(".") : parentL3;
      // ID: 팔레트 + 캔버스 양쪽의 최댓값 + 1 (연속 추가 시 stale 방지)
      const paletteMax = l4List.reduce((m, l4) => Math.max(m, parseInt(l4.id.split(".").pop() || "0", 10)), 0);
      const canvasMax = nodesRef.current
        .filter((n) => ((n.data as Record<string, unknown>).level as string)?.toUpperCase() === "L4")
        .reduce((m, n) => Math.max(m, parseInt(((n.data as Record<string, unknown>).id as string || "").split(".").pop() || "0", 10)), 0);
      const newId = addDataForm.id.trim() || `${prefix}.${Math.max(paletteMax, canvasMax) + 1}`;
      const newL4: L4Item = { id: newId, name: addDataForm.name.trim(), description: addDataForm.description.trim(), l3Id: parentL3, isManual: true };
      setL4List((prev) => prev.some((l4) => l4.id === newId) ? prev : [...prev, newL4]);
      setL5Map((prev) => prev[newId] !== undefined ? prev : { ...prev, [newId]: [] });
      // 위치 계산을 setNodes functional update 안에서 → 항상 최신 nds 기준
      const nameL4 = addDataForm.name.trim(); const descL4 = addDataForm.description.trim();
      setNodes((nds) => {
        if (nds.some((n) => ((n.data as Record<string, unknown>).id as string) === newId)) return nds;
        const l4Nds = nds.filter((n) => ((n.data as Record<string, unknown>).level as string)?.toUpperCase() === "L4");
        let x = 200, y = 100;
        if (l4Nds.length > 0) { const last = l4Nds.reduce((a, b) => (a.position.x > b.position.x ? a : b)); x = last.position.x + 280; y = last.position.y; }
        return [...nds, createNodeFromItem("l4", { id: newId, name: nameL4, description: descL4, isManual: true }, { x, y })];
      });
    } else if (lvl === "L5") {
      const targetL4Id = expandedL4 || (l4List.length > 0 ? l4List[l4List.length - 1].id : null);
      if (!targetL4Id) { alert("L4가 없습니다. 먼저 L4를 추가해주세요."); return; }
      // ID: 팔레트 + 캔버스 양쪽의 최댓값 + 1 (연속 추가 시 stale 방지)
      const paletteMaxL5 = (l5Map[targetL4Id] || []).reduce((m, l5) => Math.max(m, parseInt(l5.id.split(".").pop() || "0", 10)), 0);
      const canvasMaxL5 = nodesRef.current
        .filter((n) => { const d = n.data as Record<string, unknown>; return ((d.level as string)?.toUpperCase() === "L5") && (d.id as string)?.startsWith(targetL4Id + "."); })
        .reduce((m, n) => Math.max(m, parseInt(((n.data as Record<string, unknown>).id as string || "").split(".").pop() || "0", 10)), 0);
      const newId = addDataForm.id.trim() || `${targetL4Id}.${Math.max(paletteMaxL5, canvasMaxL5) + 1}`;
      const roleVal = addDataForm.role.trim() || undefined;
      const newL5: L5Item = { id: newId, name: addDataForm.name.trim(), description: addDataForm.description.trim(), l4Id: targetL4Id, isManual: true };
      setL5Map((prev) => {
        const existing = prev[targetL4Id] || [];
        if (existing.some((item) => item.id === newId)) return prev;
        return { ...prev, [targetL4Id]: [...existing, newL5] };
      });
      setExpandedL4(targetL4Id);
      // 위치 계산을 setNodes functional update 안에서 → 항상 최신 nds 기준
      const nameL5 = addDataForm.name.trim(); const descL5 = addDataForm.description.trim(); const tgtL4 = targetL4Id;
      setNodes((nds) => {
        if (nds.some((n) => ((n.data as Record<string, unknown>).id as string) === newId)) return nds;
        const siblings = nds.filter((n) => { const d = n.data as Record<string, unknown>; return ((d.level as string)?.toUpperCase() === "L5") && (d.id as string)?.startsWith(tgtL4 + "."); });
        let x = 200, y = 400;
        if (siblings.length > 0) { const last = siblings.reduce((a, b) => (a.position.x > b.position.x ? a : b)); x = last.position.x + 220; y = last.position.y; }
        else { const l4Nd = nds.find((n) => ((n.data as Record<string, unknown>).id as string) === tgtL4); if (l4Nd) { x = l4Nd.position.x; y = l4Nd.position.y + 250; } }
        return [...nds, createNodeFromItem("l5", { id: newId, name: nameL5, description: descL5, l4Id: tgtL4, isManual: true, ...(roleVal ? { role: roleVal } : {}) }, { x, y })];
      });
    } else {
      alert(`${lvl} 레벨은 팔레트에서 직접 추가할 수 없습니다. L4 또는 L5만 추가 가능합니다.`);
      return;
    }
    setAddDataForm({ level: "L5", id: "", name: "", description: "", role: "" });
    setAddDataMode(false);
  }, [addDataForm, selectedL3, l4List, l5Map, expandedL4, setNodes]);

  /* ═══ 캔버스 노드 x좌표 기준 ID 재번호 + 팔레트 동기화 ═══ */
  const handleRenumberByPosition = useCallback(() => {
    // 1) 현재 캔버스 노드로부터 renumber 결과를 계산
    const currentNodes = nodes;
    const l4Nodes = currentNodes.filter((n) => n.type === "l4").sort((a, b) => a.position.x - b.position.x);
    const l5Nodes = currentNodes.filter((n) => n.type === "l5").sort((a, b) => a.position.x - b.position.x);

    if (l4Nodes.length === 0 && l5Nodes.length === 0) {
      alert("캔버스에 L4/L5 노드가 없습니다.");
      return;
    }

    // oldDataId → newDataId 매핑 (data.id 기준)
    const idRemap = new Map<string, string>();
    const updatedMap = new Map<string, Record<string, unknown>>();

    const getParentPrefix = (id: string): string | null => {
      const parts = id.split(".");
      if (parts.length >= 2 && parts.every((p) => /^\d+$/.test(p))) {
        return parts.slice(0, -1).join(".");
      }
      return null;
    };

    // ── L4 재번호 ──
    if (l4Nodes.length > 0) {
      const l4Parents: Record<string, typeof l4Nodes> = {};
      let defaultL4Parent = selectedL3 || null;
      for (const n of l4Nodes) {
        const d = n.data as Record<string, unknown>;
        const id = (d.id as string) || "";
        const parent = getParentPrefix(id);
        if (parent) {
          if (!l4Parents[parent]) l4Parents[parent] = [];
          l4Parents[parent].push(n);
          if (!defaultL4Parent) defaultL4Parent = parent;
        } else {
          const key = defaultL4Parent || "_manual";
          if (!l4Parents[key]) l4Parents[key] = [];
          l4Parents[key].push(n);
        }
      }
      for (const [parent, group] of Object.entries(l4Parents)) {
        if (parent === "_manual") continue;
        group.forEach((n, i) => {
          const d = n.data as Record<string, unknown>;
          const oldId = (d.id as string) || "";
          const newId = `${parent}.${i + 1}`;
          updatedMap.set(n.id, { id: newId });
          if (oldId) idRemap.set(oldId, newId);
        });
      }
    }

    // ── L5 재번호 ──
    if (l5Nodes.length > 0) {
      const l5Parents: Record<string, typeof l5Nodes> = {};
      let defaultL5Parent: string | null = null;
      for (const n of l5Nodes) {
        const d = n.data as Record<string, unknown>;
        const id = (d.id as string) || "";
        const parent = getParentPrefix(id);
        // L5의 parent가 L4인데 L4가 remap 되었으면 새 ID 사용
        const remappedParent = parent ? (idRemap.get(parent) || parent) : null;
        if (remappedParent) {
          if (!l5Parents[remappedParent]) l5Parents[remappedParent] = [];
          l5Parents[remappedParent].push(n);
          if (!defaultL5Parent) defaultL5Parent = remappedParent;
        } else {
          let inferredParent: string | null = null;
          let minDist = Infinity;
          for (const other of l5Nodes) {
            if (other.id === n.id) continue;
            const otherId = ((other.data as Record<string, unknown>).id as string) || "";
            const otherParent = getParentPrefix(otherId);
            if (otherParent) {
              const remapped = idRemap.get(otherParent) || otherParent;
              const dist = Math.abs(other.position.x - n.position.x);
              if (dist < minDist) { minDist = dist; inferredParent = remapped; }
            }
          }
          const key = inferredParent || defaultL5Parent || "_manual";
          if (!l5Parents[key]) l5Parents[key] = [];
          l5Parents[key].push(n);
        }
      }
      for (const [parent, group] of Object.entries(l5Parents)) {
        if (parent === "_manual") continue;
        group.forEach((n, i) => {
          const d = n.data as Record<string, unknown>;
          const oldId = (d.id as string) || "";
          const newId = `${parent}.${i + 1}`;
          const existing = updatedMap.get(n.id) || {};
          updatedMap.set(n.id, { ...existing, id: newId });
          if (oldId) idRemap.set(oldId, newId);
        });
      }
    }

    if (updatedMap.size === 0) {
      alert("재번호할 수 있는 노드가 없습니다.");
      return;
    }

    // 2) 캔버스 노드 업데이트
    setNodes((nds) =>
      nds.map((n) => {
        const updates = updatedMap.get(n.id);
        if (!updates) return n;
        const d = { ...(n.data as Record<string, unknown>) };
        if (updates.id) d.id = updates.id;
        return { ...n, data: d };
      })
    );

    // 3) 팔레트 (l4List / l5Map) 동기화 — 같은 idRemap 적용
    if (idRemap.size > 0) {
      setL4List((prev) =>
        prev.map((l4) => {
          const newId = idRemap.get(l4.id);
          return newId ? { ...l4, id: newId } : l4;
        })
      );
      setL5Map((prev) => {
        const updated: Record<string, L5Item[]> = {};
        for (const [oldKey, items] of Object.entries(prev)) {
          const newKey = idRemap.get(oldKey) || oldKey;
          updated[newKey] = items.map((l5) => {
            const newId = idRemap.get(l5.id);
            return newId ? { ...l5, id: newId, l4Id: idRemap.get(l5.l4Id) || l5.l4Id } : l5;
          });
        }
        return updated;
      });
      // expandedL4도 갱신
      if (expandedL4) {
        const newExp = idRemap.get(expandedL4);
        if (newExp) setExpandedL4(newExp);
      }
    }

    const count = updatedMap.size;
    alert(`✅ ${count}개 노드 ID가 x좌표 순서로 재번호되었습니다. (팔레트 동기화 완료)`);
  }, [nodes, selectedL3, expandedL4, setNodes]);

  /* ═══ 팔레트 ID 재번호 (현재 l4List/l5Map 순서 기준) ═══ */
  const renumberPaletteIds = useCallback(
    (srcL4: L4Item[], srcL5: Record<string, L5Item[]>) => {
      const idRemap = new Map<string, string>();
      if (srcL4.length === 0) return { l4s: srcL4, l5m: srcL5, idRemap };
      const firstId = srcL4[0].id;
      const parts = firstId.split(".");
      const prefix = parts.length >= 2 ? parts.slice(0, -1).join(".") : "1";
      const l4s: L4Item[] = [];
      const l5m: Record<string, L5Item[]> = {};
      srcL4.forEach((l4, i) => {
        const newL4Id = `${prefix}.${i + 1}`;
        if (l4.id !== newL4Id) idRemap.set(l4.id, newL4Id);
        l4s.push({ ...l4, id: newL4Id });
        const l5s = srcL5[l4.id] || [];
        l5m[newL4Id] = l5s.map((l5, j) => {
          const newL5Id = `${newL4Id}.${j + 1}`;
          if (l5.id !== newL5Id) idRemap.set(l5.id, newL5Id);
          return { ...l5, id: newL5Id, l4Id: newL4Id };
        });
      });
      return { l4s, l5m, idRemap };
    },
    []
  );

  /* ═══ 팔레트 ID 변경을 캔버스 노드에 동기화 ═══ */
  const syncIdsToCanvas = useCallback(
    (idRemap: Map<string, string>) => {
      if (idRemap.size === 0) return;
      setNodes((nds) =>
        nds.map((n) => {
          const d = n.data as Record<string, unknown>;
          const oldId = (d.id as string) || "";
          const newId = idRemap.get(oldId);
          if (!newId) return n;
          return { ...n, data: { ...d, id: newId } };
        })
      );
    },
    [setNodes]
  );

  /* ═══ L4 드래그 순서 변경 ═══ */
  const handleL4Reorder = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      const list = [...l4List];
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      const { l4s, l5m, idRemap } = renumberPaletteIds(list, l5Map);
      setL4List(l4s);
      setL5Map(l5m);
      syncIdsToCanvas(idRemap);
      if (expandedL4) {
        const oldL4 = l4List[fromIdx];
        const newL4 = l4s.find((l) => l.name === oldL4?.name);
        if (newL4 && expandedL4 === oldL4?.id) setExpandedL4(newL4.id);
      }
    },
    [l4List, l5Map, expandedL4, renumberPaletteIds, syncIdsToCanvas]
  );

  /* ═══ L5 드래그 순서 변경 (같은 L4 내 또는 L4 간 이동) ═══ */
  const handleL5Reorder = useCallback(
    (fromL4Id: string, fromIdx: number, toL4Id: string, toIdx: number) => {
      const updatedL5Map = { ...l5Map };
      if (fromL4Id === toL4Id) {
        const items = [...(updatedL5Map[fromL4Id] || [])];
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        updatedL5Map[fromL4Id] = items;
      } else {
        const fromItems = [...(updatedL5Map[fromL4Id] || [])];
        const toItems = [...(updatedL5Map[toL4Id] || [])];
        const [moved] = fromItems.splice(fromIdx, 1);
        toItems.splice(toIdx, 0, moved);
        updatedL5Map[fromL4Id] = fromItems;
        updatedL5Map[toL4Id] = toItems;
      }
      const { l4s, l5m, idRemap } = renumberPaletteIds(l4List, updatedL5Map);
      setL4List(l4s);
      setL5Map(l5m);
      syncIdsToCanvas(idRemap);
    },
    [l4List, l5Map, renumberPaletteIds, syncIdsToCanvas]
  );

  /* ═══ 팔레트 항목 수정 시작 ═══ */
  const handleStartPaletteEdit = useCallback(
    (id: string, name: string, desc: string) => {
      setEditingPaletteItem(id);
      setEditPaletteForm({ name, description: desc });
    },
    []
  );

  /* ═══ 팔레트 항목 수정 저장 ═══ */
  const handleSavePaletteEdit = useCallback(() => {
    if (!editingPaletteItem) return;
    const { name, description } = editPaletteForm;
    const isL4 = l4List.some((l4) => l4.id === editingPaletteItem);
    if (isL4) {
      setL4List((prev) =>
        prev.map((l4) =>
          l4.id === editingPaletteItem ? { ...l4, name, description } : l4
        )
      );
    } else {
      setL5Map((prev) => {
        const m = { ...prev };
        for (const key of Object.keys(m)) {
          m[key] = m[key].map((l5) =>
            l5.id === editingPaletteItem ? { ...l5, name, description } : l5
          );
        }
        return m;
      });
    }
    // 캔버스 노드에도 이름/설명 동기화
    const editId = editingPaletteItem;
    setNodes((nds) =>
      nds.map((n) => {
        const d = n.data as Record<string, unknown>;
        if ((d.id as string) === editId) {
          return { ...n, data: { ...d, label: name, description } };
        }
        return n;
      })
    );
    setEditingPaletteItem(null);
  }, [editingPaletteItem, editPaletteForm, l4List, setNodes]);

  /* ═══ 팔레트 항목 삭제 ═══ */
  const handleDeletePaletteItem = useCallback(
    (id: string, type: "l4" | "l5") => {
      if (type === "l4") {
        const newL4 = l4List.filter((l4) => l4.id !== id);
        const newL5Map = { ...l5Map };
        delete newL5Map[id];
        const { l4s, l5m, idRemap } = renumberPaletteIds(newL4, newL5Map);
        setL4List(l4s);
        setL5Map(l5m);
        // 캔버스에서 해당 L4 노드 + 하위 L5 노드 제거 후 나머지 ID 동기화
        setNodes((nds) => nds.filter((n) => {
          const d = n.data as Record<string, unknown>;
          const nid = (d.id as string) || "";
          return nid !== id && !nid.startsWith(id + ".");
        }));
        syncIdsToCanvas(idRemap);
      } else {
        const newL5Map = { ...l5Map };
        for (const key of Object.keys(newL5Map)) {
          newL5Map[key] = newL5Map[key].filter((l5) => l5.id !== id);
        }
        const { l4s, l5m, idRemap } = renumberPaletteIds(l4List, newL5Map);
        setL4List(l4s);
        setL5Map(l5m);
        // 캔버스에서 해당 L5 노드 제거 후 나머지 ID 동기화
        setNodes((nds) => nds.filter((n) => {
          const d = n.data as Record<string, unknown>;
          return (d.id as string) !== id;
        }));
        syncIdsToCanvas(idRemap);
      }
    },
    [l4List, l5Map, renumberPaletteIds, syncIdsToCanvas, setNodes]
  );

  /* ═══════════════════════════════════════════════
   * CSV Load
   * ═══════════════════════════════════════════════ */
  /* 파싱된 CsvRow[] 를 화면에 반영 — CSV/엑셀 공통 코어.
   * customLanes 가 주어지면(엑셀: 수행주체+그 외) 활성 swimlane 시트의 lanes 를 강제 동기화. */
  const applyRows = useCallback(
    (rows: CsvRow[], name: string, customLanes?: string[]) => {
      setCsvRows(rows);
      setFileName(name);
      const detectedVariant = getCsvVariantFromRows(rows);
      const hasCustomLanes = !!(customLanes && customLanes.length > 0);
      setSheets((prev) =>
        prev.map((s) =>
          s.id === activeSheetId
            ? {
                ...s,
                variant: detectedVariant,
                /* 엑셀(맞춤형 레인 제공): 활성 시트를 swimlane 으로 전환 + 감지 레인 적용 → 드롭 즉시 구조 확인 */
                type: hasCustomLanes ? "swimlane" : s.type,
                lanes: hasCustomLanes
                  ? customLanes
                  : s.type === "swimlane"
                    ? !s.lanes || s.lanes.length === 0
                      ? getDefaultLanesForVariant(detectedVariant)
                      : s.lanes
                    : s.lanes,
              }
            : s,
        ),
      );
      const l2s = extractL2List(rows);
      setL2List(l2s);
      const m: Record<string, L3Item[]> = {};
      for (const l2 of l2s) {
        m[l2.id] = extractL3ByL2(rows, l2.id);
      }
      setL3Map(m);
      if (l2s.length > 0) setExpandedL2(l2s[0].id);
      setSelectedL3(null);
      setL4List([]);
      setL5Map({});
      setExpandedL4(null);
      setNodes([]);
      setEdges([]);
    },
    [setNodes, setEdges, activeSheetId],
  );

  /* 빈 양식 CSV 내려받기 — 컬럼 구성 + 예시 1행 */
  const handleDownloadTemplate = useCallback(() => {
    const header = (buildTemplateCsvString([]).split("\n")[0] || "").replace("두산 L2", "L2 Name"); // 양식은 고객사 표기 없이
    const cols = header.split(",").length;
    const example = ["L2-01", "인사관리", "L3-01", "채용", "L4-01", "채용 계획 수립", "연간 채용 계획을 수립한다", "L4-01-01", "부서별 수요 취합", "각 부서 채용 수요를 메일로 받아 정리"];
    while (example.length < cols) example.push("");
    const csv = "\uFEFF" + header + "\n" + example.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "AsIs_분석_양식.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const loadCsvText = useCallback(
    (text: string, name: string) => {
      setXlsxTemplate(null); // CSV 로드 시 엑셀 템플릿 해제
      applyRows(parseCsv(text), name);
    },
    [applyRows],
  );

  /* ── 엑셀(.xlsx) Load — As-Is 분석 양식 직접 인식 ───── */
  const loadXlsxBuffer = useCallback(
    async (buf: ArrayBuffer, name: string) => {
      try {
        const { parseXlsxArrayBuffer } = await import("@/lib/xlsxToFlow");
        const { rows, lanes, variant, exportMeta } = await parseXlsxArrayBuffer(buf);
        if (rows.length === 0) {
          alert("엑셀에서 데이터 행을 찾지 못했습니다. 양식을 확인해주세요.");
          return;
        }
        applyRows(rows, name, lanes);
        /* 원본 양식 라운드트립 내보내기용 — 버퍼 복사본 보관 */
        setXlsxTemplate({ buffer: buf.slice(0), meta: exportMeta, variant, fileName: name });
      } catch (err) {
        console.error(err);
        alert(`엑셀 파싱에 실패했습니다.\n${err instanceof Error ? err.message : ""}`);
      }
    },
    [applyRows],
  );

  /* CSV 자동 로드 제거 — 사용자가 직접 업로드해야 함 */

  /* ── JSON Load (워크플로우 파일 직접 열기) ───── */
  const loadJsonText = useCallback(
    (text: string, name: string) => {
      try {
        const data = JSON.parse(text);
        setXlsxTemplate(null); // JSON 로드 시 엑셀 템플릿 해제
        if (data.version === "2.0" && Array.isArray(data.sheets)) {
          window.dispatchEvent(
            new CustomEvent("loadWorkflow", { detail: { sheets: data.sheets } }),
          );
        } else if (data.nodes && data.edges) {
          window.dispatchEvent(
            new CustomEvent("loadWorkflow", {
              detail: { nodes: data.nodes, edges: data.edges },
            }),
          );
        } else {
          alert("유효하지 않은 워크플로우 JSON 파일입니다.");
          return;
        }
        setFileName(name);
      } catch {
        alert("JSON 파싱에 실패했습니다.");
      }
    },
    [],
  );

  /* 확장자에 따라 CSV / JSON / 엑셀 분기 로드 */
  const loadFile = useCallback(
    (file: File) => {
      const lower = file.name.toLowerCase();
      const reader = new FileReader();
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        reader.onload = (ev) => loadXlsxBuffer(ev.target?.result as ArrayBuffer, file.name);
        reader.readAsArrayBuffer(file);
        return;
      }
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (lower.endsWith(".json")) loadJsonText(text, file.name);
        else loadCsvText(text, file.name);
      };
      reader.readAsText(file, "utf-8");
    },
    [loadCsvText, loadJsonText, loadXlsxBuffer],
  );

  /* ═══ 자동저장 (localStorage) + 복원 + 닫기 경고 ═══
     새로고침·탭 닫기로 작업이 통째로 날아가던 문제 대응. JSON 저장(v2.0)과 같은 형식으로
     1.5초 디바운스 저장, 다음 방문 때 복원 배너. 팔레트(csvRows)까지 같이 저장한다. */
  const AUTOSAVE_KEY = "hrwf:autosave:v2";
  const [autosavedAt, setAutosavedAt] = useState<string>("");
  const [restoreCandidate, setRestoreCandidate] = useState<{ savedAt: string; fileName?: string; sheetCount: number; nodeCount: number } | null>(null);
  const restoreCheckedRef = useRef(false);

  const buildSnapshot = useCallback(() => {
    const sheetPayloads = sheets.map((s) => {
      const sd = s.id === activeSheetId ? { nodes, edges } : (sheetDataRef.current[s.id] || { nodes: [], edges: [] });
      return { id: s.id, name: s.name, type: s.type, lanes: s.lanes, laneHeights: s.laneHeights, variant: s.variant, nodes: sd.nodes, edges: sd.edges };
    });
    return { version: "2.0", savedAt: new Date().toISOString(), fileName, csvRows, sheets: sheetPayloads };
  }, [sheets, activeSheetId, nodes, edges, fileName, csvRows]);

  const hasWork =
    nodes.length > 0 || csvRows.length > 0 || sheets.length > 1 ||
    Object.values(sheetDataRef.current).some((d) => (d?.nodes?.length ?? 0) > 0);

  /* 최초 1회: 복원 후보 확인 */
  useEffect(() => {
    if (restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as { savedAt: string; fileName?: string; csvRows?: unknown[]; sheets?: { nodes?: unknown[] }[] };
      const nodeCount = (snap.sheets || []).reduce((n, sh) => n + (sh.nodes?.length || 0), 0);
      const rows = snap.csvRows?.length || 0;
      if (nodeCount === 0 && rows === 0) return;
      setRestoreCandidate({ savedAt: snap.savedAt, fileName: snap.fileName, sheetCount: (snap.sheets || []).length, nodeCount });
    } catch { /* 저장소 접근 불가 — 무시 */ }
  }, []);

  /* 디바운스 자동저장 (복원 여부를 결정하기 전에는 덮어쓰지 않음) */
  useEffect(() => {
    if (!restoreCheckedRef.current || restoreCandidate || !hasWork) return;
    const t = setTimeout(() => {
      try {
        const snap = buildSnapshot();
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snap));
        setAutosavedAt(snap.savedAt);
      } catch { /* quota 초과 등 — 무시 */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [buildSnapshot, hasWork, restoreCandidate]);

  const handleRestore = useCallback(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) { setRestoreCandidate(null); return; }
      const snap = JSON.parse(raw) as { fileName?: string; csvRows?: CsvRow[]; sheets?: unknown[] };
      if (snap.csvRows && snap.csvRows.length > 0) applyRows(snap.csvRows, snap.fileName || "복원된 작업");
      setTimeout(() => {
        if (snap.sheets && snap.sheets.length > 0) {
          window.dispatchEvent(new CustomEvent("loadWorkflow", { detail: { sheets: snap.sheets } }));
        }
        if (snap.fileName) setFileName(snap.fileName);
      }, 50);
      setRestoreCandidate(null);
    } catch {
      alert("이전 작업을 복원하지 못했습니다.");
      setRestoreCandidate(null);
    }
  }, [applyRows]);

  const handleDiscardRestore = useCallback(() => {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
    setRestoreCandidate(null);
  }, []);

  /* 닫기·새로고침 경고 */
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (hasWork) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [hasWork]);

  /* ── File Upload ───────────────────────────── */
  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      loadFile(file);
      e.target.value = ""; // 같은 파일 재업로드 허용
    },
    [loadFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      const lower = file?.name.toLowerCase();
      if (!file || !(lower?.endsWith(".csv") || lower?.endsWith(".json") || lower?.endsWith(".xlsx") || lower?.endsWith(".xls"))) return;
      loadFile(file);
    },
    [loadFile]
  );

  /* ═══ L3 Select → load L4/L5 ═══ */
  const handleSelectL3 = useCallback(
    (l3Id: string) => {
      setSelectedL3(l3Id);
      const l4s = extractL4ByL3(csvRows, l3Id);
      setL4List(l4s);
      const m5: Record<string, L5Item[]> = {};
      for (const l4 of l4s) {
        m5[l4.id] = extractL5ByL4(csvRows, l4.id);
      }
      setL5Map(m5);
      setExpandedL4(null);
      setL3PanelCollapsed(true); // L3 선택 시 아코디언 자동 접기
    },
    [csvRows]
  );

  /* ═══ 노드 배치 규칙 — 겹치지 않는 다음 자리 ═══
     기존: 뷰포트 중앙 + 랜덤 오프셋 → 매번 겹쳐서 손으로 떼어내야 했음.
     변경: L5는 부모 L4 오른쪽에 순서대로, 그 외는 같은 열 맨 아래로. 그래도 겹치면 아래로 밀어냄. */
  const NODE_W: Record<string, number> = { l2: 720, l3: 650, l4: 580, l5: 300, decision: 220, memo: 220 };
  const NODE_H: Record<string, number> = { l2: 200, l3: 200, l4: 200, l5: 150, decision: 220, memo: 160 };
  const GAP_X = 40, GAP_Y = 24;
  const nodeSize = (n: Node) => ({
    w: n.measured?.width ?? NODE_W[n.type || "l4"] ?? 300,
    h: n.measured?.height ?? NODE_H[n.type || "l4"] ?? 110,
  });
  const overlapsAny = (x: number, y: number, w: number, h: number, nds: Node[]) =>
    nds.some((n) => { const sz = nodeSize(n); return !(x + w <= n.position.x || n.position.x + sz.w <= x || y + h <= n.position.y || n.position.y + sz.h <= y); });
  const viewportCenter = () => {
    let x = 400, y = 300;
    if (rfInstanceRef.current) {
      const vp = rfInstanceRef.current.getViewport();
      const wrapper = document.querySelector(".react-flow") as HTMLElement | null;
      if (wrapper) { const rect = wrapper.getBoundingClientRect(); x = (rect.width / 2 - vp.x) / vp.zoom; y = (rect.height / 2 - vp.y) / vp.zoom; }
    }
    return { x, y };
  };
  const nextFreePosition = (level: string, item: { [key: string]: unknown }, nds: Node[], center: { x: number; y: number }) => {
    const w = NODE_W[level] ?? 300, h = NODE_H[level] ?? 110;
    let x: number | undefined, y = 0;
    if (level === "l5" && item.l4Id) {
      const parent = nds.find((n) => n.type === "l4" && (n.data as Record<string, unknown>).id === item.l4Id);
      if (parent) {
        const ps = nodeSize(parent);
        x = parent.position.x + ps.w + GAP_X;
        const px = x;
        const sibs = nds.filter((n) => n.type === "l5" && Math.abs(n.position.x - px) < 20 && n.position.y >= parent.position.y - 1);
        y = sibs.length ? Math.max(...sibs.map((n) => n.position.y + nodeSize(n).h)) + GAP_Y / 2 : parent.position.y;
      }
    }
    if (x === undefined) {
      if (nds.length === 0) { x = center.x - w / 2; y = center.y - h / 2; }
      else {
        const same = nds.filter((n) => n.type === level);
        const ref = same.length ? same[same.length - 1] : nds[nds.length - 1];
        x = ref.position.x;
        const cx = x;
        const col = nds.filter((n) => Math.abs(n.position.x - cx) < w / 2);
        const pool = col.length ? col : nds;
        y = Math.max(...pool.map((n) => n.position.y + nodeSize(n).h)) + GAP_Y;
      }
    }
    let guard = 0;
    while (overlapsAny(x, y, w, h, nds) && guard++ < 300) y += GAP_Y;
    return { x, y };
  };

  /* 렌더 직후 실측 크기로 한 번 더 정리 — 추정 높이와 실제가 달라 겹치는 경우 대비 */
  const settleNodes = (ids: string[]) => {
    setTimeout(() => {
      setNodes((nds) => {
        const out = nds.map((n) => ({ ...n, position: { ...n.position } }));
        for (const id of ids) {
          const me = out.find((n) => n.id === id);
          if (!me) continue;
          const sz = nodeSize(me);
          const others = out.filter((n) => n.id !== id);
          let guard = 0;
          while (overlapsAny(me.position.x, me.position.y, sz.w, sz.h, others) && guard++ < 300) me.position.y += GAP_Y;
        }
        return out;
      });
    }, 150);
  };
  const settleRows = (rows: { l4: string; l5s: string[] }[]) => {
    setTimeout(() => {
      setNodes((nds) => {
        const out = nds.map((n) => ({ ...n, position: { ...n.position } }));
        const byId = new Map(out.map((n) => [n.id, n]));
        let top = Number.NaN;
        for (const r of rows) {
          const l4 = byId.get(r.l4);
          if (!l4) continue;
          if (Number.isNaN(top)) top = l4.position.y;
          l4.position.y = top;
          let y: number = top;
          for (const id of r.l5s) {
            const n5 = byId.get(id);
            if (!n5) continue;
            n5.position.y = y;
            y += nodeSize(n5).h + 12;
          }
          top = Math.max(top + nodeSize(l4).h, y) + GAP_Y * 1.5;
        }
        return out;
      });
      setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.1, maxZoom: 1.2, duration: 300 }), 50);
    }, 150);
  };

  /* ═══ 하위 전체 추가 — 선택한 L3의 L4·L5를 한 번에 배치 + 순서대로 연결 ═══
     인트라넷 설치판에는 AI 챗이 없어서 초안 작성 속도가 여기서 결정된다. */
  const mkEdge = (source: string, target: string, toL5: boolean): Edge => ({
    id: `e-${source}-${target}`,
    source, target, type: "ortho", animated: false,
    sourceHandle: toL5 ? "right" : "bottom",
    targetHandle: toL5 ? "t-left" : "t-top",
    style: { stroke: toL5 ? "#555555" : "#000000", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: toL5 ? "#555555" : "#000000" },
  });
  const addL3SubtreeToCanvas = useCallback(() => {
    if (l4List.length === 0) return;
    const center = viewportCenter();
    const existing = nodes;
    const has = (type: string, id: string) => existing.find((n) => n.type === type && (n.data as Record<string, unknown>).id === id);
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const rows: { l4: string; l5s: string[] }[] = [];
    const l4X = existing.some((n) => n.type === "l4")
      ? Math.min(...existing.filter((n) => n.type === "l4").map((n) => n.position.x))
      : center.x - NODE_W.l4 / 2;
    let yCursor = existing.length ? Math.max(...existing.map((n) => n.position.y + nodeSize(n).h)) + GAP_Y * 2 : center.y - NODE_H.l4 / 2;
    let prevL4Id: string | null = null;
    for (const l4 of l4List) {
      let l4Node = has("l4", l4.id);
      const l5s = l5Map[l4.id] || [];
      if (!l4Node) {
        l4Node = createNodeFromItem("l4", { ...l4 }, { x: l4X, y: yCursor });
        newNodes.push(l4Node);
      }
      const baseY = l4Node.position.y;
      const l5X = l4Node.position.x + NODE_W.l4 + GAP_X;
      const row = { l4: l4Node.id, l5s: [] as string[] };
      let j = 0;
      for (const l5 of l5s) {
        const ex = has("l5", l5.id);
        if (ex) { row.l5s.push(ex.id); continue; }
        const n5 = createNodeFromItem("l5", { ...l5, l4Name: l4.name }, { x: l5X, y: baseY + j * (NODE_H.l5 + 12) });
        newNodes.push(n5);
        newEdges.push(mkEdge(l4Node.id, n5.id, true));
        row.l5s.push(n5.id);
        j++;
      }
      rows.push(row);
      if (prevL4Id) newEdges.push(mkEdge(prevL4Id, l4Node.id, false));
      prevL4Id = l4Node.id;
      const rowH = Math.max(NODE_H.l4, l5s.length * (NODE_H.l5 + 12));
      if (!has("l4", l4.id) || newNodes.includes(l4Node)) yCursor = baseY + rowH + GAP_Y * 1.5;
    }
    if (newNodes.length === 0) { alert("이미 캔버스에 모두 추가돼 있습니다."); return; }
    nodeCountRef.current += newNodes.length;
    setNodes((nds) => [...nds, ...newNodes]);
    setEdges((eds) => [...eds, ...newEdges.filter((e) => !eds.some((x) => x.id === e.id))]);
    settleRows(rows);
  }, [l4List, l5Map, nodes, setNodes, setEdges]);

  /* ═══ Add node to canvas (click) — place at viewport center ═══ */
  const addNodeToCanvas = useCallback(
    (
      level: "l2" | "l3" | "l4" | "l5",
      item: { id: string; name: string; description?: string; [key: string]: unknown }
    ) => {
      nodeCountRef.current++;
      const center = viewportCenter();
      let newId = "";
      setNodes((nds) => {
        const pos = nextFreePosition(level, item, nds, center);
        const node = createNodeFromItem(level, item, pos);
        newId = node.id;
        return [...nds, node];
      });
      setTimeout(() => { if (newId) settleNodes([newId]); }, 0);
    },
    [setNodes]
  );

  /* ═══ Add Decision (판정 로직) node to canvas ═══ */
  const decisionCountRef = useRef(0);
  const addDecisionNode = useCallback(() => {
    decisionCountRef.current++;
    const dId = `decision-${decisionCountRef.current}`;

    // viewport center
    let x = 400, y = 300;
    if (rfInstanceRef.current) {
      const vp = rfInstanceRef.current.getViewport();
      const wrapper = document.querySelector('.react-flow') as HTMLElement;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        x = (rect.width / 2 - vp.x) / vp.zoom;
        y = (rect.height / 2 - vp.y) / vp.zoom;
      }
    }
    x += (Math.random() - 0.5) * 80;
    y += (Math.random() - 0.5) * 60;

    const promptName = prompt("판정 로직 이름을 입력하세요:", "판정 조건");
    if (promptName === null) return; // cancelled

    const decisionNode: Node = {
      id: dId,
      type: "decision",
      position: { x, y },
      data: {
        label: promptName || "판정 조건",
        level: "DECISION",
        id: dId,
        description: "",
      },
    };

    setNodes((nds) => [...nds, decisionNode]);
    nodeCountRef.current++;
  }, [setNodes]);

  /* ═══ Add Memo (포스트잇) node to canvas ═══ */
  const memoCountRef = useRef(0);
  const addMemoNode = useCallback(() => {
    memoCountRef.current++;
    const mId = `memo-${memoCountRef.current}`;

    let x = 400, y = 300;
    if (rfInstanceRef.current) {
      const vp = rfInstanceRef.current.getViewport();
      const wrapper = document.querySelector('.react-flow') as HTMLElement;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        x = (rect.width / 2 - vp.x) / vp.zoom;
        y = (rect.height / 2 - vp.y) / vp.zoom;
      }
    }
    x += (Math.random() - 0.5) * 80;
    y += (Math.random() - 0.5) * 60;

    const promptText = prompt("메모 내용을 입력하세요:", "");
    if (promptText === null) return;

    const memoNode: Node = {
      id: mId,
      type: "memo",
      position: { x, y },
      data: {
        label: promptText || "",
        text: promptText || "",
        level: "MEMO",
        id: mId,
      },
    };

    setNodes((nds) => [...nds, memoNode]);
  }, [setNodes]);

  /* ═══ Edge connect (drag handles) ═══ */
  const onConnect = useCallback(
    (connection: Connection) => {
      // 연결 대상 노드의 레벨에 따라 선 색상 결정 (L5=회색, 나머지=검정)
      const targetNode = nodes.find((n) => n.id === connection.target);
      const targetLevel = targetNode ? ((targetNode.data as Record<string, unknown>).level as string) : "";
      const edgeColor = targetLevel === "L5" ? "#555555" : "#000000";

      // DECISION 노드에서 나가는 연결이면 자동으로 라벨 입력 프롬프트
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const sourceLevel = sourceNode ? ((sourceNode.data as Record<string, unknown>).level as string) : "";
      let edgeLabel: string | undefined;
      let edgeLabelStyle: Record<string, unknown> | undefined;
      let edgeLabelBgStyle: Record<string, unknown> | undefined;
      let edgeLabelBgPadding: [number, number] | undefined;
      let edgeLabelBgBorderRadius: number | undefined;

      if (sourceLevel === "DECISION") {
        const lbl = prompt("분기 라벨을 입력하세요 (예: Yes / No / 승인 / 반려):", "");
        if (lbl && lbl.trim()) {
          edgeLabel = lbl.trim();
          edgeLabelStyle = { fontWeight: 700, fontSize: 13, fill: "#d32f2f" };
          edgeLabelBgStyle = { fill: "#fff8e1", fillOpacity: 0.95, stroke: "#d32f2f", strokeWidth: 1 };
          edgeLabelBgPadding = [8, 6];
          edgeLabelBgBorderRadius = 6;
        }
      }

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "ortho",
            animated: false,
            style: { stroke: edgeColor, strokeWidth: 1.5 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: edgeColor,
            },
            ...(edgeLabel ? {
              label: edgeLabel,
              labelStyle: edgeLabelStyle,
              labelBgStyle: edgeLabelBgStyle,
              labelBgPadding: edgeLabelBgPadding,
              labelBgBorderRadius: edgeLabelBgBorderRadius,
            } : {}),
          },
          eds
        )
      );
    },
    [setEdges, nodes]
  );

  /* ═══ Edge double-click → edit label (사용자 정의 라벨) ═══ */
  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const currentLabel = (edge.label as string) || "";
      const newLabel = prompt("엣지 라벨을 입력하세요 (비워두면 삭제):", currentLabel);
      if (newLabel === null) return; // cancelled

      // DECISION 노드에서 나가는 엣지면 빨간 글씨 + 노란 배경
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const isFromDecision = sourceNode ? ((sourceNode.data as Record<string, unknown>).level as string) === "DECISION" : false;
      const color = ((edge.style as Record<string, unknown>)?.stroke as string) || "#000000";

      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edge.id) return e;
          if (newLabel.trim() === "") {
            // 라벨 삭제
            const { label: _, labelStyle: _ls, labelBgStyle: _lbs, labelBgPadding: _lbp, labelBgBorderRadius: _lbr, ...rest } = e;
            return rest;
          }
          if (isFromDecision) {
            return {
              ...e,
              label: newLabel.trim(),
              labelStyle: { fontWeight: 700, fontSize: 13, fill: "#d32f2f" },
              labelBgStyle: { fill: "#fff8e1", fillOpacity: 0.95, stroke: "#d32f2f", strokeWidth: 1 },
              labelBgPadding: [8, 6] as [number, number],
              labelBgBorderRadius: 6,
            };
          }
          return {
            ...e,
            label: newLabel.trim(),
            labelStyle: { fontWeight: 700, fontSize: 12, fill: color },
            labelBgStyle: { fill: "white", fillOpacity: 0.9 },
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 4,
          };
        })
      );
    },
    [setEdges, nodes]
  );

  /* ═══ Toggle edge direction (right-click) ═══ */
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== edge.id) return e;
          const hasBoth = !!e.markerStart;
          const color = ((e.style as Record<string, unknown>)?.stroke as string) || "#000000";
          if (hasBoth) {
            // bidirectional → one-way (remove markerStart)
            const { markerStart: _, ...rest } = e;
            return { ...rest, data: { ...((e.data || {}) as Record<string, unknown>), bidirectional: false } };
          } else {
            // one-way → bidirectional (add markerStart)
            return {
              ...e,
              markerStart: { type: MarkerType.ArrowClosed, width: 20, height: 20, color },
              data: { ...((e.data || {}) as Record<string, unknown>), bidirectional: true },
            };
          }
        })
      );
    },
    [setEdges]
  );

  /* ═══ Node click → open detail panel ═══ */
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // 메모 노드는 인라인 편집으로 처리 — NodeDetailPanel 열지 않음
      if (node.type === "memo") return;
      setSelectedNode(node);
    },
    []
  );

  /* ═══ Update node metadata ═══ */
  const updateNodeMeta = useCallback(
    (nodeId: string, meta: NodeMeta) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const level = (n.data as Record<string, unknown>).level as string;
          // MEMO 노드: memo 필드를 text/label에도 동기화
          const extra: Record<string, unknown> = {};
          if (level === "MEMO" && meta.memo) {
            extra.text = meta.memo;
            extra.label = meta.memo;
          }
          return {
            ...n,
            data: {
              ...(n.data as Record<string, unknown>),
              ...meta,
              ...extra,
            },
          };
        })
      );
      setSelectedNode(null);
    },
    [setNodes]
  );

  /* ═══ Clear canvas ═══ */
  const handleClearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    nodeCountRef.current = 0;
  }, [setNodes, setEdges]);


  /* ═══ Listen for JSON load events (from ExportToolbar) ═══ */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sheets && Array.isArray(detail.sheets)) {
        /* ── Multi-sheet JSON format ── */
        const loadedSheets: Sheet[] = detail.sheets.map((s: { id: string; name: string; type: SheetType; lanes?: string[]; laneHeights?: number[]; variant?: CsvVariant }) => ({
          id: s.id,
          name: s.name,
          type: s.type || "blank",
          lanes: s.lanes,
          laneHeights: s.laneHeights,
          variant: s.variant,
        }));
        // 1) sheetDataRef 멃저 채우기 (ref는 동기)
        for (const sd of detail.sheets as { id: string; nodes: Node[]; edges: Edge[] }[]) {
          sheetDataRef.current[sd.id] = { nodes: sd.nodes || [], edges: sd.edges || [] };
        }
        // 2) 첫 번째 시트 데이터
        const firstId = loadedSheets[0].id;
        const firstData = sheetDataRef.current[firstId] || { nodes: [], edges: [] };
        // 3) React 상태 일괄 업데이트
        setSheets(loadedSheets);
        setActiveSheetId(firstId);
        setNodes(firstData.nodes);
        setEdges(firstData.edges);
        nodeCountRef.current = firstData.nodes.length;
        setSelectedNode(null);
        // 4) 렌더 후 fitView
        setTimeout(() => {
          rfInstanceRef.current?.fitView({ padding: 0.08, maxZoom: 1.5, duration: 300 });
        }, 150);
      } else if (detail?.nodes && detail?.edges) {
        /* ── Legacy single-sheet JSON format ── */
        setNodes(detail.nodes);
        setEdges(detail.edges);
        nodeCountRef.current = detail.nodes.length;
        setSelectedNode(null);
        setTimeout(() => {
          rfInstanceRef.current?.fitView({ padding: 0.08, maxZoom: 1.5, duration: 300 });
        }, 150);
      }
    };
    window.addEventListener("loadWorkflow", handler);
    return () => window.removeEventListener("loadWorkflow", handler);
  }, [setNodes, setEdges]);

  /* ═══ Current L3 / L2 derivation (for breadcrumb) ═══ */
  const currentL3Item = useMemo(() => {
    if (!selectedL3) return null;
    return Object.values(l3Map).flat().find((l3) => l3.id === selectedL3) || null;
  }, [selectedL3, l3Map]);

  const currentL2Item = useMemo(() => {
    if (!selectedL3) return null;
    for (const l2 of l2List) {
      if (l3Map[l2.id]?.some((l3) => l3.id === selectedL3)) return l2;
    }
    return null;
  }, [selectedL3, l3Map, l2List]);

  /* ═══ Search filter ═══ */
  const filteredL4 = useMemo(() => {
    if (!searchTerm.trim()) return l4List;
    const t = searchTerm.toLowerCase();
    return l4List.filter(
      (i) => i.name.toLowerCase().includes(t) || i.id.includes(t)
    );
  }, [l4List, searchTerm]);

  /* ═══════════════════════════════════════════════
   * RENDER
   * ═══════════════════════════════════════════════ */
  const canvasReady = csvRows.length > 0 || nodes.length > 0;

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* ═══════════ LEFT PANEL ═══════════ */}
      <div className="w-[340px] min-w-[300px] border-r border-gray-200 flex flex-col bg-white">
        {/* Header + File Upload */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <AppLogo width={44} height={44} />
            <div>
              <h1 className="text-[15px] font-bold text-gray-900 leading-tight">
                프로세스맵 빌더
              </h1>
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
                As-Is · To-Be 업무 흐름도 작성 도구
              </p>
            </div>
          </div>
          <div
            className="mt-3 border-2 border-dashed border-gray-200 rounded-lg p-3 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById("csv-upload")?.click()}
          >
            <input
              id="csv-upload"
              type="file"
              accept=".csv,.json,.xlsx,.xls"
              className="hidden"
              onChange={handleFileUpload}
            />
            {fileName ? (
              <div className="text-xs text-gray-600">
                <span className="font-medium text-blue-600">
                  {(() => {
                    const f = fileName.toLowerCase();
                    const icon = f.endsWith(".json") ? "🗂️ " : f.endsWith(".xlsx") || f.endsWith(".xls") ? "📊 " : "📄 ";
                    return icon + fileName;
                  })()}
                </span>
                {!fileName.toLowerCase().endsWith(".json") && (
                  <span className="text-gray-400 ml-1">
                    {"· " + csvRows.length + "행"}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-400">
                CSV · 엑셀 · JSON 파일을 드래그하거나 클릭하여 업로드
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1.5">
          {[
            { l: "L2", c: "bg-[#A62121] text-white" },
            { l: "L3", c: "bg-[#D95578] text-white" },
            { l: "L4", c: "bg-[#DEDEDE] text-black font-bold" },
            { l: "L5", c: "bg-white text-black font-bold border border-[#DEDEDE]" },
            { l: "◇ 판정", c: "bg-[#F2A0AF] text-[#3B0716] font-bold border border-[#D95578]" },
          ].map((i) => (
            <span
              key={i.l}
              className={
                "text-[9px] font-bold px-2 py-0.5 rounded-full " + i.c
              }
            >
              {i.l}
            </span>
          ))}
        </div>

        {/* L2 → L3 Accordion — L3 선택 시 breadcrumb으로 접힘 */}
        {l3PanelCollapsed && selectedL3 ? (
          /* ── Collapsed: 한 줄 breadcrumb ── */
          <div className="flex-none border-b border-gray-100 bg-[#FFF5F7]">
            <button
              onClick={() => setL3PanelCollapsed(false)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50/60 transition-colors text-left group"
              title="L3 목록으로 돌아가기"
            >
              <span className="flex-none text-[11px] text-gray-400 group-hover:text-[#A62121] transition-colors">☰</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  {currentL2Item && (
                    <>
                      <span className="text-[8px] text-gray-400 font-mono truncate max-w-[60px]">{currentL2Item.name}</span>
                      <span className="text-[8px] text-gray-300">›</span>
                    </>
                  )}
                  <span className="text-[9px] font-mono bg-[#F2DCE0] text-[#A62121] px-1 py-0.5 rounded flex-none">{selectedL3}</span>
                </div>
                <div className="text-[11px] font-semibold text-[#A62121] truncate leading-tight">
                  {currentL3Item?.name || selectedL3}
                </div>
              </div>
              <span className="flex-none text-[9px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded group-hover:border-[#D95578] group-hover:text-[#A62121] transition-colors whitespace-nowrap">변경 ▾</span>
            </button>
          </div>
        ) : (
          /* ── Expanded: 전체 아코디언 ── */
          <div className="flex-none max-h-[35%] overflow-y-auto border-b border-gray-100">
            {selectedL3 && l2List.length > 0 && (
              <div className="sticky top-0 z-10 bg-white/95 border-b border-gray-100 px-3 py-1 flex justify-end">
                <button
                  onClick={() => setL3PanelCollapsed(true)}
                  className="text-[9px] text-gray-400 hover:text-[#A62121] px-2 py-0.5 rounded hover:bg-red-50 transition-colors"
                >
                  ▲ 접기
                </button>
              </div>
            )}
            {l2List.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400 leading-relaxed">
                As-Is 분석 엑셀(.xlsx)·CSV 또는<br />저장해 둔 JSON을 위에 올리세요
              </div>
            ) : (
              l2List.map((l2) => (
                <div key={l2.id}>
                  <div className="flex items-stretch">
                    <button
                      className={
                        "flex-1 text-left px-4 py-2.5 text-sm font-bold flex items-center justify-between transition-colors " +
                        (expandedL2 === l2.id
                          ? "bg-[#A62121] text-white"
                          : "bg-red-50/50 text-gray-700 hover:bg-red-50")
                      }
                      onClick={() =>
                        setExpandedL2(expandedL2 === l2.id ? null : l2.id)
                      }
                    >
                      <span>
                        <span className="text-[10px] opacity-60 mr-1">
                          {l2.id + "."}
                        </span>
                        {l2.name}
                      </span>
                      <span className="text-xs opacity-60">
                        {expandedL2 === l2.id ? "▼" : "▶"}
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addNodeToCanvas("l2", { ...l2 });
                      }}
                      className={
                        "px-2 text-[10px] font-bold transition-colors " +
                        (expandedL2 === l2.id
                          ? "bg-[#8A1B1B] text-red-200 hover:text-white hover:bg-[#A62121]"
                          : "bg-red-50/50 text-gray-400 hover:text-[#A62121] hover:bg-red-100")
                      }
                      title="캔버스에 추가"
                    >
                      +
                    </button>
                  </div>
                  {expandedL2 === l2.id && l3Map[l2.id] && (
                    <div className="bg-gray-50">
                      {l3Map[l2.id].map((l3) => (
                        <div key={l3.id} className="flex items-stretch">
                          <button
                            onClick={() => handleSelectL3(l3.id)}
                            className={
                              "flex-1 text-left px-6 py-2 text-xs transition-colors border-l-[3px] " +
                              (selectedL3 === l3.id
                                ? "bg-red-50 text-[#A62121] border-l-[#A62121] font-semibold"
                                : "text-gray-600 hover:bg-gray-100 border-l-transparent")
                            }
                          >
                            <span className="text-[9px] text-gray-400 font-mono mr-1">
                              {l3.id}
                            </span>
                            {l3.name}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addNodeToCanvas("l3", {
                                id: l3.id,
                                name: l3.name,
                              });
                            }}
                            className={
                              "px-2 text-[10px] font-bold transition-colors " +
                              (selectedL3 === l3.id
                                ? "bg-red-50 text-[#D95578] hover:text-[#A62121]"
                                : "text-gray-300 hover:text-[#A62121] hover:bg-red-50")
                            }
                            title="캔버스에 추가"
                          >
                            +
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* L4 / L5 Palette */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedL3 ? (
            <>
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="L4/L5 검색..."
                  className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="px-4 py-2 border-b border-gray-100 flex gap-1.5">
                <button
                  onClick={() => {
                    const entering = !paletteEditMode;
                    setPaletteEditMode(entering);
                    setEditingPaletteItem(null);
                    if (entering) { setAddDataMode(false); setAddDataForm({ level: "L5", id: "", name: "", description: "", role: "" }); }
                  }}
                  className={`text-[10px] font-medium rounded px-2 py-1.5 transition ${
                    paletteEditMode
                      ? "bg-orange-500 text-white hover:bg-orange-600 ring-2 ring-orange-300"
                      : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                  }`}
                  title="팔레트 항목 수정/순서변경/삭제 모드"
                >
                  {"✏️ 팔레트 수정"}
                </button>
                <span className="text-[9px] text-gray-400 self-center">판정·메모·ID 재번호·비우기는 상단 툴바</span>
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {paletteEditMode ? (
                  /* ═══ EDIT MODE ═══ */
                  <>
                    <div className="flex items-center justify-between px-2 mb-2">
                      <p className="text-[10px] font-bold text-orange-600 flex items-center gap-1">
                        ✏️ 수정 모드 <span className="font-normal text-orange-400">— 드래그로 순서 변경</span>
                      </p>
                      <button
                        onClick={() => { setPaletteEditMode(false); setEditingPaletteItem(null); }}
                        className="text-[10px] font-bold bg-orange-500 text-white rounded px-2 py-0.5 hover:bg-orange-600 transition"
                      >
                        ✓ 완료
                      </button>
                    </div>
                    {l4List.map((l4, l4Idx) => (
                      <div key={l4.id} className="mb-2">
                        {/* ── L4 Header (draggable) ── */}
                        <div
                          draggable
                          onDragStart={(e) => {
                            setDragSource({ type: "l4", l4Id: l4.id, idx: l4Idx });
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-t-2", "border-t-orange-400"); }}
                          onDragLeave={(e) => { e.currentTarget.classList.remove("border-t-2", "border-t-orange-400"); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove("border-t-2", "border-t-orange-400");
                            if (dragSource?.type === "l4") {
                              handleL4Reorder(dragSource.idx, l4Idx);
                            }
                            setDragSource(null);
                          }}
                          className="flex items-center gap-1 group cursor-grab active:cursor-grabbing"
                        >
                          <span className="text-gray-400 text-[10px] flex-none select-none">☰</span>
                          {editingPaletteItem === l4.id ? (
                            <div className="flex-1 flex gap-1 items-center">
                              <input
                                value={editPaletteForm.name}
                                onChange={(e) => setEditPaletteForm({ ...editPaletteForm, name: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Enter") handleSavePaletteEdit(); if (e.key === "Escape") setEditingPaletteItem(null); }}
                                className="flex-1 text-[11px] font-bold border border-orange-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                                autoFocus
                              />
                              <button onClick={handleSavePaletteEdit} className="text-[9px] text-white bg-orange-500 rounded px-1.5 py-0.5 hover:bg-orange-600">저장</button>
                              <button onClick={() => setEditingPaletteItem(null)} className="text-[9px] text-gray-500 hover:text-gray-700">취소</button>
                            </div>
                          ) : (
                            <>
                              <div className={`flex-1 min-w-0 px-2 py-1.5 text-[11px] font-bold border rounded truncate ${
                                l4.isManual
                                  ? "text-red-700 bg-red-50 border-red-200"
                                  : "text-black bg-[#DEDEDE] border-[#BBBBBB]"
                              }`}>
                                <span className={`text-[8px] font-mono mr-1 ${l4.isManual ? "text-red-400" : "text-gray-500"}`}>{l4.id}</span>
                                {l4.isManual && <span className="text-[7px] text-red-300 mr-1">•수동</span>}
                                {l4.name}
                              </div>
                              <button
                                onClick={() => handleStartPaletteEdit(l4.id, l4.name, l4.description || "")}
                                className="text-[9px] text-orange-500 hover:text-orange-700 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                                title="수정"
                              >✏️</button>
                              <button
                                onClick={() => { if (confirm(`L4 "${l4.name}" 및 하위 L5를 삭제하시겠습니까?`)) handleDeletePaletteItem(l4.id, "l4"); }}
                                className="text-[9px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                                title="삭제"
                              >🗑️</button>
                            </>
                          )}
                        </div>
                        {/* ── L5 items (always expanded in edit mode, draggable) ── */}
                        <div className="ml-4 mt-0.5 space-y-0.5">
                          {(l5Map[l4.id] || []).map((l5, l5Idx) => (
                            <div
                              key={l5.id}
                              draggable
                              onDragStart={(e) => {
                                setDragSource({ type: "l5", l4Id: l4.id, idx: l5Idx });
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-t-2", "border-t-blue-400"); }}
                              onDragLeave={(e) => { e.currentTarget.classList.remove("border-t-2", "border-t-blue-400"); }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove("border-t-2", "border-t-blue-400");
                                if (dragSource?.type === "l5") {
                                  handleL5Reorder(dragSource.l4Id, dragSource.idx, l4.id, l5Idx);
                                }
                                setDragSource(null);
                              }}
                              className="flex items-center gap-1 group cursor-grab active:cursor-grabbing"
                            >
                              <span className="text-gray-300 text-[9px] flex-none select-none">⠿</span>
                              {editingPaletteItem === l5.id ? (
                                <div className="flex-1 space-y-0.5">
                                  <input
                                    value={editPaletteForm.name}
                                    onChange={(e) => setEditPaletteForm({ ...editPaletteForm, name: e.target.value })}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSavePaletteEdit(); if (e.key === "Escape") setEditingPaletteItem(null); }}
                                    className="w-full text-[10px] border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    autoFocus
                                    placeholder="이름"
                                  />
                                  <div className="flex gap-1">
                                    <input
                                      value={editPaletteForm.description}
                                      onChange={(e) => setEditPaletteForm({ ...editPaletteForm, description: e.target.value })}
                                      className="flex-1 text-[9px] border border-gray-200 rounded px-1 py-0.5"
                                      placeholder="설명"
                                    />
                                    <button onClick={handleSavePaletteEdit} className="text-[8px] text-white bg-blue-500 rounded px-1 py-0.5">저장</button>
                                    <button onClick={() => setEditingPaletteItem(null)} className="text-[8px] text-gray-500">취소</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className={`flex-1 min-w-0 px-2 py-1 text-[10px] font-semibold border rounded truncate ${
                                    l5.isManual
                                      ? "text-red-700 bg-red-50 border-red-200"
                                      : "text-black bg-white border-[#DEDEDE]"
                                  }`}>
                                    <span className={`text-[8px] font-mono mr-1 ${l5.isManual ? "text-red-400" : "text-gray-400"}`}>{l5.id}</span>
                                    {l5.isManual && <span className="text-[7px] text-red-300 mr-1">•수동</span>}
                                    {l5.name}
                                  </div>
                                  <button
                                    onClick={() => handleStartPaletteEdit(l5.id, l5.name, l5.description || "")}
                                    className="text-[8px] text-orange-500 hover:text-orange-700 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                                  >✏️</button>
                                  <button
                                    onClick={() => { if (confirm(`"${l5.name}" 삭제?`)) handleDeletePaletteItem(l5.id, "l5"); }}
                                    className="text-[8px] text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity flex-none"
                                  >🗑️</button>
                                </>
                              )}
                            </div>
                          ))}
                          {/* Drop zone at the end of L5 list */}
                          <div
                            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-t-2", "border-t-blue-400"); }}
                            onDragLeave={(e) => { e.currentTarget.classList.remove("border-t-2", "border-t-blue-400"); }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.currentTarget.classList.remove("border-t-2", "border-t-blue-400");
                              if (dragSource?.type === "l5") {
                                const toIdx = (l5Map[l4.id] || []).length;
                                handleL5Reorder(dragSource.l4Id, dragSource.idx, l4.id, toIdx);
                              }
                              setDragSource(null);
                            }}
                            className="h-2 rounded"
                          />
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  /* ═══ NORMAL MODE ═══ */
                  <>
                {filteredL4.length > 0 && (
                  <button
                    onClick={addL3SubtreeToCanvas}
                    className="mb-1.5 w-full rounded-md bg-[#A62121] px-2 py-1.5 text-[11px] font-bold text-white hover:bg-[#8A1B1B] transition-colors"
                    title="이 L3의 L4·L5를 한 번에 캔버스에 배치하고 순서대로 연결합니다 (이미 있는 항목은 건너뜀)"
                  >
                    ➕ 하위 전체 추가 (L4 {l4List.length} · L5 {l4List.reduce((n, l4) => n + (l5Map[l4.id]?.length || 0), 0)})
                  </button>
                )}
                <p className="text-[9px] text-gray-400 px-2 mb-1">
                  💡 항목 클릭 → 캔버스 추가 · Handle 드래그 → 화살표 연결
                </p>
                {filteredL4.map((l4) => (
                  <div key={l4.id} className="mb-1">
                    <div className="flex items-stretch">
                      <button
                        onClick={() => addNodeToCanvas("l4", { ...l4 })}
                        className={`flex-1 text-left px-3 py-2.5 text-sm font-bold rounded-l-lg hover:brightness-95 transition-colors ${
                          l4.isManual
                            ? "text-red-700 bg-red-50 border-2 border-red-200"
                            : "text-black bg-[#DEDEDE] border-2 border-[#BBBBBB] hover:bg-[#CCCCCC] hover:border-[#888888]"
                        }`}
                        title={l4.description || l4.name}
                      >
                        <span className={`text-[9px] font-mono mr-1.5 px-1 py-0.5 rounded ${l4.isManual ? "text-red-400 bg-red-100/60" : "text-gray-600 bg-white/60"}`}>
                          {l4.id}
                        </span>
                        {l4.isManual && <span className="text-[8px] text-red-300 mr-1">•수동</span>}
                        {l4.name}
                        {l4.description && (
                          <span className="block text-[10px] text-gray-400 mt-0.5 line-clamp-1">
                            {l4.description}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() =>
                          setExpandedL4(
                            expandedL4 === l4.id ? null : l4.id
                          )
                        }
                        className={`px-2 border-y-2 border-r-2 rounded-r-lg text-[10px] transition-colors ${
                          l4.isManual
                            ? "bg-red-50 border-red-200 text-red-400 hover:text-red-700 hover:bg-red-100"
                            : "bg-[#DEDEDE] border-[#BBBBBB] text-gray-500 hover:text-black hover:bg-[#CCCCCC]"
                        }`}
                      >
                        {expandedL4 === l4.id
                          ? "▼ 접기"
                          : "L5 " + (l5Map[l4.id] || []).length + "개"}
                      </button>
                    </div>
                    {expandedL4 === l4.id && l5Map[l4.id] && (
                      <div className="ml-3 mt-0.5 space-y-0.5">
                        {l5Map[l4.id].map((l5) => (
                          <button
                            key={l5.id}
                            onClick={() => addNodeToCanvas("l5", { ...l5, l4Name: l4.name })}
                            className={`w-full text-left px-2.5 py-1.5 text-[11px] font-semibold rounded transition-colors ${
                              l5.isManual
                                ? "text-red-700 bg-red-50 border border-red-200 hover:bg-red-100"
                                : "text-black bg-white border border-[#DEDEDE] hover:bg-[#F5F5F5] hover:border-[#AAAAAA]"
                            }`}
                            title={l5.description || l5.name}
                          >
                            <span className={`text-[9px] font-mono mr-1 ${l5.isManual ? "text-red-400" : "text-gray-500"}`}>
                              {l5.id}
                            </span>
                            {l5.isManual && <span className="text-[8px] text-red-300 mr-1">•수동</span>}
                            {l5.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* ── 데이터 추가 버튼 / 폼 ── */}
                <div className="mt-3 pt-2 border-t border-gray-200">
                  {addDataMode ? (
                    <div className="space-y-1.5 bg-blue-50/50 rounded-lg p-2 border border-blue-100">
                      <p className="text-[9px] font-bold text-blue-600">➕ 새 데이터 추가 {expandedL4 ? `(→ ${expandedL4} 하위)` : ""}</p>
                      <div className="flex gap-1">
                        <select
                          value={addDataForm.level}
                          onChange={(e) => setAddDataForm({ ...addDataForm, level: e.target.value as ManualItem["level"] })}
                          className="w-14 border border-gray-200 rounded px-1 py-1 text-[10px] text-gray-900"
                        >
                          <option value="L4">L4</option>
                          <option value="L5">L5</option>
                        </select>
                        <input
                          value={addDataForm.id}
                          onChange={(e) => setAddDataForm({ ...addDataForm, id: e.target.value })}
                          placeholder="ID (자동)"
                          className="w-16 border border-gray-200 rounded px-1 py-1 text-[10px] text-gray-900"
                        />
                        <input
                          value={addDataForm.name}
                          onChange={(e) => setAddDataForm({ ...addDataForm, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddManualItem(); }}
                          placeholder="이름 *"
                          className="flex-1 border border-gray-200 rounded px-1.5 py-1 text-[10px] text-gray-900"
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-1">
                        <input
                          value={addDataForm.description}
                          onChange={(e) => setAddDataForm({ ...addDataForm, description: e.target.value })}
                          placeholder="설명"
                          className="flex-1 border border-gray-200 rounded px-1.5 py-1 text-[10px] text-gray-900"
                        />
                        <input
                          value={addDataForm.role}
                          onChange={(e) => setAddDataForm({ ...addDataForm, role: e.target.value })}
                          placeholder="수행주체"
                          className="w-20 border border-gray-200 rounded px-1.5 py-1 text-[10px] text-gray-900"
                        />
                      </div>
                      <div className="flex gap-1">
                        <button onClick={handleAddManualItem} className="flex-1 px-2 py-1 text-[10px] font-bold bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                          ✓ 추가
                        </button>
                        <button onClick={() => { setAddDataMode(false); setAddDataForm({ level: "L5", id: "", name: "", description: "", role: "" }); }} className="px-2 py-1 text-[10px] font-bold bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors">
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddDataMode(true)}
                      className="w-full text-center px-2 py-2 text-[10px] font-bold text-blue-600 bg-blue-50 border border-dashed border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      ➕ 데이터 추가
                    </button>
                  )}
                </div>
                </>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex items-center justify-center px-4">
                <div className="text-center">
                  <p className="text-xs text-gray-400">
                    ← L3 프로세스를 선택하면
                    <br />
                    하위 L4·L5 목록이 표시됩니다
                  </p>
                  <p className="text-[10px] text-gray-300 mt-2">
                    L3 선택 후 ‘➕ 데이터 추가’로 직접 항목 추가 가능
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-2 border-t border-gray-100 text-[9px] text-gray-300 text-center">
          {"프로세스맵 빌더 · " + csvRows.length + "행 로드"}
        </div>
      </div>

      {/* ═══════════ RIGHT PANEL — CANVAS + TABS + CHAT ═══════════ */}
      <div className="flex-1 min-w-0 flex relative overflow-hidden">
        {/* Canvas area + SheetTabBar */}
        <div className="flex-1 min-w-0 flex flex-col relative">
          {/* ═══ 상단 툴바 — 캔버스 액션 + 저장/내보내기 (항상 보임) ═══ */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 bg-white border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-gray-400 mr-1">캔버스</span>
              <button onClick={addDecisionNode} disabled={!canvasReady} className="text-[11px] font-medium bg-[#F2A0AF] text-[#3B0716] rounded px-2 py-1 hover:bg-[#D95578] hover:text-white transition border border-[#D95578] disabled:opacity-40 disabled:cursor-not-allowed" title="판정 로직(마름모) 노드 추가">◇ 판정 추가</button>
              <button onClick={addMemoNode} disabled={!canvasReady} className="text-[11px] font-medium bg-[#FFF9C4] text-[#6D4C00] rounded px-2 py-1 hover:bg-[#FFF176] transition border border-[#FBC02D] disabled:opacity-40 disabled:cursor-not-allowed" title="메모(포스트잇) 추가">📝 메모 추가</button>
              <button onClick={handleRenumberByPosition} disabled={nodes.length === 0} className="text-[11px] font-medium bg-amber-500 text-white rounded px-2 py-1 hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed" title="캔버스 노드를 x좌표(왼→오) 순서로 ID 재번호">🔢 ID 재번호</button>
              <button onClick={handleClearCanvas} disabled={nodes.length === 0} className="text-[11px] font-medium bg-gray-200 text-gray-600 rounded px-2 py-1 hover:bg-gray-300 transition disabled:opacity-40 disabled:cursor-not-allowed" title="현재 시트의 노드·화살표 전부 삭제">🗑️ 비우기</button>
            </div>
            <div className="w-px h-5 bg-gray-200 hidden sm:block" />
            <ExportToolbar
              nodes={nodes}
              edges={edges}
              sheets={sheets}
              getSheetData={getSheetData}
              activeSheetId={activeSheetId}
              csvRows={csvRows}
              xlsxTemplate={xlsxTemplate}
            />
          </div>
          {/* Canvas */}
          <div className="flex-1 relative" ref={reactFlowWrapper}>
            {csvRows.length === 0 && nodes.length === 0 ? (
              <div
                className="flex items-center justify-center h-full text-gray-400"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div className="text-center max-w-md">
                  <div className="text-6xl mb-4">📂</div>
                  <p className="text-lg font-medium text-gray-500">As-Is 분석 파일을 올리면 시작됩니다</p>
                  <p className="text-sm mt-1 text-gray-400">
                    엑셀(.xlsx) · CSV · 이 도구에서 저장한 JSON — 좌측 패널이나 이 영역에 끌어다 놓으세요
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <button
                      onClick={() => document.getElementById("csv-upload")?.click()}
                      className="text-xs font-bold bg-[#A62121] text-white rounded px-3 py-1.5 hover:bg-[#8A1B1B] transition"
                    >
                      파일 선택
                    </button>
                    <button
                      onClick={handleDownloadTemplate}
                      className="text-xs font-medium bg-white text-gray-600 border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50 transition"
                      title="컬럼 구성이 들어 있는 빈 양식(CSV, 엑셀에서 열림)을 내려받습니다"
                    >
                      📄 양식 내려받기
                    </button>
                  </div>
                  <p className="text-[11px] mt-3 text-gray-300">
                    양식 열: L2 ID·이름 → L3 ID·이름 → L4 ID·이름·설명 → L5 ID·이름·설명 → 수행주체 → 사용 시스템 → Pain Point → Input/Output
                  </p>
                </div>
              </div>
            ) : (
              <div className="w-full h-full relative">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeContextMenu={onEdgeContextMenu}
                onEdgeDoubleClick={onEdgeDoubleClick}
                onNodeDoubleClick={onNodeDoubleClick}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                multiSelectionKeyCode="Control"
                snapToGrid={true}
                snapGrid={[20, 20]}
                onInit={(instance) => {
                  rfInstanceRef.current = instance;
                  // fitView only when there are existing nodes (not when canvas is empty)
                  if (nodes.length > 0) {
                    setTimeout(() => instance.fitView({ padding: 0.05, maxZoom: 1.5, duration: 200 }), 50);
                  }
                }}
                defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
                minZoom={0.02}
                maxZoom={3}
                connectionLineStyle={{ stroke: "#000000", strokeWidth: 1.5 }}
                defaultEdgeOptions={{
                  type: "ortho",
                  animated: false,
                  style: { stroke: "#000000", strokeWidth: 1.5 },
                }}
                deleteKeyCode={["Backspace", "Delete"]}
              >
                {/* Background: grid for blank, dots for swimlane */}
                {activeSheet.type === "swimlane" ? (
                  <Background key="bg" color="#f1f5f9" gap={40} size={0.5} />
                ) : (
                  <Background key="bg" variant={"lines" as never} color="#e2e8f0" gap={20} size={0.5} lineWidth={0.5} />
                )}

                {/* Swimlane overlay — uses useViewport(), must be inside ReactFlow */}
                {activeSheet.type === "swimlane" && (
                  <SwimLaneOverlay
                    key="swimlane"
                    lanes={activeSheet.lanes}
                    laneHeights={activeSheet.laneHeights}
                    onLaneHeightsChange={handleLaneHeightsChange}
                    canvasRef={reactFlowWrapper}
                  />
                )}

                <Controls key="controls" position="bottom-right" />
                <MiniMap
                  key="minimap"
                  nodeColor={(node) => {
                    switch (node.type) {
                      case "l2":
                        return "#A62121";
                      case "l3":
                        return "#D95578";
                      case "l4":
                        return "#DEDEDE";
                      case "l5":
                        return "#FFFFFF";
                      case "decision":
                        return "#F2A0AF";
                      case "memo":
                        return "#FFF9C4";
                      default:
                        return "#d1d5db";
                    }
                  }}
                  maskColor="rgba(0,0,0,0.08)"
                  position="bottom-left"
                  style={
                    activeSheet.type === "swimlane"
                      ? (() => {
                          const n = activeSheet.lanes?.length || 4;
                          const pct = 100 / n;
                          const stops = Array.from({ length: n }, (_, i) => {
                            const c = i % 2 === 0 ? "rgba(180,180,190,0.12)" : "rgba(200,200,210,0.07)";
                            return `${c} ${(i * pct).toFixed(1)}% ${((i + 1) * pct).toFixed(1)}%`;
                          }).join(", ");
                          return { background: `linear-gradient(to bottom, ${stops})` };
                        })()
                      : undefined
                  }
                />
                <Panel key="info" position="top-right">
                  {showHelp ? (
                    <div className="bg-white/95 backdrop-blur rounded-lg shadow-md border border-gray-200 px-3 py-2 text-[10px] text-gray-500 space-y-0.5 w-56">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-gray-700">사용 팁</span>
                        <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-700 px-1" title="닫기">✕</button>
                      </div>
                      <div>{"📦 노드 " + nodes.length + " · 🔗 화살표 " + edges.length}</div>
                      <div>{"📋 시트: " + activeSheet.name + (activeSheet.type === "swimlane" ? ` (${activeSheet.lanes?.length || 4}분할)` : " (격자)")}</div>
                      <div className="border-t border-gray-100 my-1" />
                      <div>💡 노드 가장자리 점을 드래그 → 화살표 연결</div>
                      <div>🖱️ 노드 더블클릭 → 메모/메타 편집</div>
                      <div>🔄 화살표 우클릭 → 양방향 전환</div>
                      <div>⌫ Delete 키 → 선택 항목 삭제</div>
                      <div>➕ 좌측 L3 선택 → ‘하위 전체 추가’로 초안 한 번에</div>
                      <div>💾 새로고침해도 마지막 작업은 자동 복원</div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowHelp(true)}
                      className="w-7 h-7 rounded-full bg-white/90 backdrop-blur shadow border border-gray-200 text-gray-500 text-[12px] font-bold hover:bg-gray-50 hover:text-gray-800"
                      title={`사용 팁 · 노드 ${nodes.length} · 화살표 ${edges.length}`}
                    >
                      ?
                    </button>
                  )}
                </Panel>
              </ReactFlow>

              {/* Node Detail Panel (overlay) */}
              {selectedNode && (
                <NodeDetailPanel
                  node={selectedNode}
                  variant={activeSheet.variant ?? csvRows[0]?._variant ?? "doosan-hr-4"}
                  onClose={() => setSelectedNode(null)}
                  onUpdate={updateNodeMeta}
                />
              )}
              </div>
            )}
          </div>

          {/* ═══ Sheet Tab Bar (bottom of canvas) ═══ */}
          <SheetTabBar
            sheets={sheets}
            activeSheetId={activeSheetId}
            onSelect={handleSelectSheet}
            onAdd={handleAddSheet}
            onDelete={handleDeleteSheet}
            onRename={handleRenameSheet}
            onDuplicate={handleDuplicateSheet}
          />
        </div>

        {/* 자동저장 복원 배너 */}
        {restoreCandidate && (
          <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 shadow-lg flex items-center gap-3 text-[12px] text-amber-900">
            <span>
              💾 이전 작업이 자동 저장돼 있습니다
              {restoreCandidate.fileName ? ` — ${restoreCandidate.fileName}` : ""} · 시트 {restoreCandidate.sheetCount}개 · 노드 {restoreCandidate.nodeCount}개
              · {new Date(restoreCandidate.savedAt).toLocaleString("ko-KR", { hour12: false })}
            </span>
            <button onClick={handleRestore} className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700">복원</button>
            <button onClick={handleDiscardRestore} className="rounded border border-amber-300 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100">삭제</button>
          </div>
        )}
        {autosavedAt && !restoreCandidate && (
          <div className="fixed bottom-2 right-3 z-40 rounded bg-white/90 px-2 py-0.5 text-[10px] text-gray-400 border border-gray-200" title="브라우저에 자동 저장됨 (새로고침·재방문 시 복원 가능). 다른 PC로 옮기려면 JSON 저장을 쓰세요.">
            자동저장 {new Date(autosavedAt).toLocaleTimeString("ko-KR", { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>

    </div>
  );
}
