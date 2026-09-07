"use client";

import { useState, useCallback } from "react";
import { type CsvVariant, getRoleOptionsForVariant } from "@/lib/csvToFlow";

/* ── 레벨 스타일 정보 ── */
const LEVEL_OPTIONS = [
  { value: "L2", label: "L2 — 대분류", color: "#A62121", textColor: "white" },
  { value: "L3", label: "L3 — 중분류", color: "#D95578", textColor: "white" },
  { value: "L4", label: "L4 — Task", color: "#DEDEDE", textColor: "black" },
  { value: "L5", label: "L5 — Activity", color: "#FFFFFF", textColor: "black" },
] as const;

export interface NewNodeData {
  level: "L2" | "L3" | "L4" | "L5";
  id: string;
  name: string;
  description: string;
  role: string;
  memo: string;
}

interface AddNodeModalProps {
  isOpen: boolean;
  /** 활성 시트의 CSV variant — role 선택지 결정 */
  variant?: CsvVariant;
  onClose: () => void;
  onAdd: (data: NewNodeData) => void;
}

export default function AddNodeModal({ isOpen, variant = "doosan-hr-4", onClose, onAdd }: AddNodeModalProps) {
  /* variant 의 역할 라벨 + 빈값/그 외 */
  const ROLE_OPTIONS = ["", ...getRoleOptionsForVariant(variant), "그 외"];
  const [level, setLevel] = useState<"L2" | "L3" | "L4" | "L5">("L4");
  const [nodeId, setNodeId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [memo, setMemo] = useState("");

  const selectedStyle = LEVEL_OPTIONS.find((o) => o.value === level)!;

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      alert("노드 이름을 입력해주세요.");
      return;
    }
    onAdd({
      level,
      id: nodeId.trim() || `${level}-new-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      role,
      memo: memo.trim(),
    });
    // Reset
    setNodeId("");
    setName("");
    setDescription("");
    setRole("");
    setMemo("");
    onClose();
  }, [level, nodeId, name, description, role, memo, onAdd, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-[460px] max-h-[90vh] overflow-y-auto border border-gray-200">
        {/* Header */}
        <div
          className="px-6 py-4 rounded-t-xl flex items-center justify-between"
          style={{ backgroundColor: selectedStyle.color, color: selectedStyle.textColor }}
        >
          <div>
            <h2 className="text-lg font-bold">➕ 새 노드 추가</h2>
            <p className="text-xs opacity-80 mt-0.5">캔버스에 새로운 프로세스 노드를 추가합니다</p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl font-light opacity-70 hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Level Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">
              레벨 선택 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {LEVEL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLevel(opt.value)}
                  className={`py-2 px-1 rounded-lg text-xs font-bold transition-all border-2 ${
                    level === opt.value
                      ? "ring-2 ring-offset-1 ring-blue-400 scale-105"
                      : "opacity-60 hover:opacity-90"
                  }`}
                  style={{
                    backgroundColor: opt.color,
                    color: opt.textColor,
                    borderColor: opt.value === "L5" ? "#DEDEDE" : opt.color,
                  }}
                >
                  {opt.value}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {level === "L2" && "대분류 (최상위 프로세스 그룹)"}
              {level === "L3" && "중분류 (프로세스 단위)"}
              {level === "L4" && "Task (세부 업무 단위)"}
              {level === "L5" && "Activity (최하위 실행 단위)"}
            </p>
          </div>

          {/* Node ID */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              ID <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <input
              type="text"
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              placeholder="예: 1.1.5, 2.3.1"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">비워두면 자동 생성됩니다</p>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              이름 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 승인 처리, 결재 요청, 데이터 검증"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              설명 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="프로세스에 대한 상세 설명..."
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              수행 주체 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white"
            >
              <option value="">선택 안함</option>
              {ROLE_OPTIONS.filter(Boolean).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Memo */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              메모 <span className="text-gray-400 font-normal">(선택)</span>
            </label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="참고사항, 특이사항 등..."
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
            />
          </div>

          {/* Preview */}
          <div className="border border-gray-100 rounded-lg p-3 bg-gray-50">
            <p className="text-[10px] text-gray-400 font-semibold mb-2">미리보기</p>
            <div
              className="rounded-lg px-4 py-3 border-2 text-center"
              style={{
                backgroundColor: selectedStyle.color,
                color: selectedStyle.textColor,
                borderColor: level === "L5" ? "#DEDEDE" : selectedStyle.color,
              }}
            >
              <span className="text-[10px] font-bold opacity-60">
                {level} · {nodeId || "auto"}
              </span>
              <div className="font-bold mt-0.5">
                {name || "(이름 입력)"}
              </div>
              {description && (
                <div className="text-xs opacity-70 mt-0.5 line-clamp-1">{description}</div>
              )}
              {role && (
                <div className="text-[10px] mt-1 opacity-60">👤 {role}</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2 text-sm font-bold text-white rounded-lg transition-colors"
            style={{ backgroundColor: selectedStyle.color === "#FFFFFF" ? "#555555" : selectedStyle.color }}
          >
            ➕ 노드 추가
          </button>
        </div>
      </div>
    </div>
  );
}
