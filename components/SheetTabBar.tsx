"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import type { CsvVariant } from "@/lib/csvToFlow";

export type SheetType = "blank" | "swimlane";

export interface Sheet {
  id: string;
  name: string;
  type: SheetType;
  lanes?: string[];
  laneHeights?: number[];
  /** CSV 스키마 variant — actor / system / role 라벨을 결정. 미지정 시 doosan-hr-4 */
  variant?: CsvVariant;
}

interface Props {
  sheets: Sheet[];
  activeSheetId: string;
  onSelect: (id: string) => void;
  /** swimlane 추가 시 lanes 와 함께 variant 도 전달 (없으면 doosan-hr-4) */
  onAdd: (type: SheetType, lanes?: string[], variant?: CsvVariant) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
}

export default function SheetTabBar({
  sheets,
  activeSheetId,
  onSelect,
  onAdd,
  onDelete,
  onRename,
  onDuplicate,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const addMenuDivRef = useRef<HTMLDivElement>(null);
  const [showCustomDialog, setShowCustomDialog] = useState(false);
  const [customInputs, setCustomInputs] = useState<string[]>(["", "", "", ""]);

  /* Scroll state */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollButtons);
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateScrollButtons); ro.disconnect(); };
  }, [updateScrollButtons, sheets]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeTab = el.querySelector(`[data-sheet-id="${activeSheetId}"]`) as HTMLElement | null;
    if (activeTab) { activeTab.scrollIntoView({ block: "nearest", inline: "nearest" }); setTimeout(updateScrollButtons, 50); }
  }, [activeSheetId, updateScrollButtons]);

  const scrollTabs = useCallback((dir: -1 | 1) => {
    scrollRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) setCtxMenu(null); };
    if (ctxMenu) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ctxMenu]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (addBtnRef.current && !addBtnRef.current.contains(t) && addMenuDivRef.current && !addMenuDivRef.current.contains(t)) setAddMenuOpen(false);
    };
    if (addMenuOpen) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [addMenuOpen]);

  useEffect(() => {
    if (editingId && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editingId]);

  const startRename = useCallback((id: string, name: string) => { setEditingId(id); setEditName(name); setCtxMenu(null); }, []);
  const commitRename = useCallback(() => {
    if (editingId && editName.trim()) onRename(editingId, editName.trim());
    setEditingId(null);
  }, [editingId, editName, onRename]);

  return (
    <div className="flex items-stretch bg-gray-100 border-t border-gray-200 select-none h-8 min-w-0 overflow-hidden">

      {/* 왼쪽 화살표 */}
      <button
        onClick={() => scrollTabs(-1)}
        disabled={!canScrollLeft}
        className={"flex-shrink-0 w-5 flex items-center justify-center border-r border-gray-200 text-xs transition-colors " + (canScrollLeft ? "text-gray-500 hover:bg-gray-200 cursor-pointer" : "text-gray-300 cursor-default")}
      >‹</button>

      {/* 탭 스크롤 영역 — + 버튼도 이 안에 포함 */}
      <div
        ref={scrollRef}
        className="flex-1 min-w-0 flex items-center gap-0.5 px-1 overflow-x-auto"
        style={{ scrollbarWidth: "none" } as React.CSSProperties}
      >
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeSheetId;
          const isEditing = editingId === sheet.id;
          return (
            <div
              key={sheet.id}
              data-sheet-id={sheet.id}
              className={
                "flex-shrink-0 flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-t-md cursor-pointer transition-colors " +
                (isActive
                  ? "bg-white text-gray-800 border border-b-0 border-gray-200 shadow-sm h-full"
                  : "bg-gray-50 text-gray-500 hover:bg-gray-200/60 border border-transparent")
              }
              onClick={() => onSelect(sheet.id)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ id: sheet.id, x: e.clientX, y: e.clientY }); }}
              onDoubleClick={() => startRename(sheet.id, sheet.name)}
            >
              <span className="text-[10px]">{sheet.type === "swimlane" ? "🏊" : "📄"}</span>
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="text-[11px] w-20 px-1 py-0 border border-blue-400 rounded outline-none bg-white"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[100px]">{sheet.name}</span>
              )}
            </div>
          );
        })}

        {/* + 버튼: 마지막 탭 바로 옆 */}
        <div className="flex-shrink-0 relative flex items-center ml-1">
          <button
            ref={addBtnRef}
            onClick={() => setAddMenuOpen((v) => !v)}
            className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors text-sm font-bold"
            title="새 시트 추가"
          >+</button>

          {addMenuOpen && addBtnRef.current && (() => {
            const rect = addBtnRef.current!.getBoundingClientRect();
            return (
              <div
                ref={addMenuDivRef}
                className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 w-44 z-[9999]"
                style={{ left: rect.left, bottom: window.innerHeight - rect.top + 4 }}
              >
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                  onClick={() => { onAdd("blank"); setAddMenuOpen(false); }}>
                  <span>📄</span>
                  <div><div className="font-semibold text-gray-700">빈 시트 (격자)</div><div className="text-[9px] text-gray-400">흰 도화지 + 격자선</div></div>
                </button>
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                  onClick={() => { onAdd("swimlane"); setAddMenuOpen(false); }}>
                  <span>🏊</span>
                  <div><div className="font-semibold text-gray-700">4분할 시트</div><div className="text-[9px] text-gray-400">현업 임원 · 팀장 · HR 담당자 · 구성원</div></div>
                </button>
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                  onClick={() => { onAdd("swimlane", ["현업 임원", "현업 팀장", "HR 임원", "HR 담당자", "현업 구성원", "그 외"]); setAddMenuOpen(false); }}>
                  <span>🏊</span>
                  <div><div className="font-semibold text-gray-700">6분할 시트</div><div className="text-[9px] text-gray-400">현업 임원 · 현업 팀장 · HR 임원 · HR 담당자 · 현업 구성원 · 그 외</div></div>
                </button>
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-emerald-50 transition-colors flex items-center gap-2"
                  onClick={() => {
                    onAdd(
                      "swimlane",
                      [
                        "큐벡스 총무/복리후생 담당자",
                        "큐벡스 구매 담당자",
                        "큐벡스 급여 담당자",
                        "큐벡스 관리자(중역)",
                        "계열사 임직원",
                        "계열사 주관부서(현업 포함)",
                        "그 외",
                      ],
                      "qvex-affairs-6",
                    );
                    setAddMenuOpen(false);
                  }}>
                  <span>🟢</span>
                  <div><div className="font-semibold text-gray-700">7분할 시트 (복리후생)</div><div className="text-[9px] text-gray-400">큐벡스 총무·구매·급여·관리자 + 계열사 임직원·주관부서 + 그 외</div></div>
                </button>
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-emerald-50 transition-colors flex items-center gap-2"
                  onClick={() => {
                    onAdd(
                      "swimlane",
                      [
                        "큐벡스 총무/복리후생 담당자",
                        "큐벡스 구매 담당자",
                        "큐벡스 급여 담당자",
                        "큐벡스 관리자(중역)",
                        "계열사 임직원",
                        "계열사 주관부서(현업 포함)",
                        "그 외",
                      ],
                      "qvex-affairs-6",
                    );
                    setAddMenuOpen(false);
                  }}>
                  <span>🟢</span>
                  <div><div className="font-semibold text-gray-700">7분할 시트 (총무)</div><div className="text-[9px] text-gray-400">큐벡스 총무·구매·급여·관리자 + 계열사 임직원·주관부서 + 그 외</div></div>
                </button>
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-emerald-50 transition-colors flex items-center gap-2"
                  onClick={() => {
                    onAdd(
                      "swimlane",
                      [
                        "큐벡스PS 실무담당자",
                        "팀장",
                        "큐벡스BS",
                        "계열사 HR/ER",
                        "계열사 회계/세무/재무",
                        "계열사 임직원",
                        "대외 담당자",
                        "그 외",
                      ],
                      "qvex-payroll-7",
                    );
                    setAddMenuOpen(false);
                  }}>
                  <span>🟢</span>
                  <div><div className="font-semibold text-gray-700">8분할 시트 (급여)</div><div className="text-[9px] text-gray-400">큐벡스PS·팀장·BS + 계열사 HR/ER·회계·임직원 + 대외 + 그 외</div></div>
                </button>
                <button className="w-full text-left px-3 py-2 text-[11px] hover:bg-blue-50 transition-colors flex items-center gap-2"
                  onClick={() => { setCustomInputs(["", "", "", ""]); setShowCustomDialog(true); setAddMenuOpen(false); }}>
                  <span>✏️</span>
                  <div><div className="font-semibold text-gray-700">커스텀 시트</div><div className="text-[9px] text-gray-400">레인 개수·이름 직접 설정</div></div>
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 오른쪽 화살표 */}
      <button
        onClick={() => scrollTabs(1)}
        disabled={!canScrollRight}
        className={"flex-shrink-0 w-5 flex items-center justify-center border-l border-gray-200 text-xs transition-colors " + (canScrollRight ? "text-gray-500 hover:bg-gray-200 cursor-pointer" : "text-gray-300 cursor-default")}
      >›</button>

      {/* 커스텀 다이얼로그 */}
      {showCustomDialog && (
        <div className="fixed inset-0 bg-black/30 z-[9999] flex items-center justify-center" onMouseDown={() => setShowCustomDialog(false)}>
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-5 w-80" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="text-[13px] font-bold text-gray-800 mb-3">커스텀 Swim Lane 설정</h3>
            <p className="text-[10px] text-gray-400 mb-3">레인 이름을 입력하세요 (2~10개)</p>
            <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto mb-3">
              {customInputs.map((val, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 w-4 text-right">{i + 1}</span>
                  <input
                    className="flex-1 text-[11px] px-2 py-1 border border-gray-200 rounded outline-none focus:border-blue-400"
                    placeholder={`레인 ${i + 1} 이름`}
                    value={val}
                    onChange={(e) => setCustomInputs((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                  />
                  {customInputs.length > 2 && (
                    <button className="text-[11px] text-red-400 hover:text-red-600 px-1"
                      onClick={() => setCustomInputs((prev) => prev.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
            </div>
            {customInputs.length < 10 && (
              <button className="w-full text-[11px] text-blue-500 hover:text-blue-700 py-1 mb-3 border border-dashed border-blue-200 rounded hover:border-blue-400 transition-colors"
                onClick={() => setCustomInputs((prev) => [...prev, ""])}>+ 레인 추가</button>
            )}
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-100 rounded transition-colors"
                onClick={() => setShowCustomDialog(false)}>취소</button>
              <button className="px-3 py-1.5 text-[11px] bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                onClick={() => { onAdd("swimlane", customInputs.map((v, i) => v.trim() || `레인 ${i + 1}`)); setShowCustomDialog(false); }}>만들기</button>
            </div>
          </div>
        </div>
      )}

      {/* 컨텍스트 메뉴 */}
      {ctxMenu && (
        <div ref={menuRef} className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-36 z-50"
          style={{ left: ctxMenu.x, top: ctxMenu.y - 120 }}>
          <button className="w-full text-left px-3 py-1.5 text-[11px] text-gray-700 hover:bg-blue-50 transition"
            onClick={() => startRename(ctxMenu.id, sheets.find((s) => s.id === ctxMenu.id)?.name || "")}>✏️ 이름 변경</button>
          <button className="w-full text-left px-3 py-1.5 text-[11px] text-gray-700 hover:bg-blue-50 transition"
            onClick={() => { onDuplicate(ctxMenu.id); setCtxMenu(null); }}>📋 복제</button>
          {sheets.length > 1 && (
            <button className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 transition"
              onClick={() => { onDelete(ctxMenu.id); setCtxMenu(null); }}>🗑️ 삭제</button>
          )}
        </div>
      )}
    </div>
  );
}
