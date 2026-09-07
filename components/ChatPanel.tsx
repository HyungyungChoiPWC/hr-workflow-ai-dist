"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MarkerType, type Node, type Edge } from "@xyflow/react";

/** Ensure every edge has a visible arrowhead marker */
function ensureArrowMarkers(edges: Edge[]): Edge[] {
  return edges.map((e) => ({
    ...e,
    type: e.type || "smoothstep",
    style: e.style || { stroke: "#d95578", strokeWidth: 2.5 },
    markerEnd: e.markerEnd || {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: (e.style as Record<string, unknown>)?.stroke as string || "#d95578",
    },
  }));
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  nodes: Node[];
  edges: Edge[];
  onApplyWorkflow: (nodes: Node[], edges: Edge[]) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** L3 process summary text for initial AI generation */
  processData?: string;
  /** Called after processData has been consumed (sent to AI) */
  onProcessDataConsumed?: () => void;
}

export default function ChatPanel({
  nodes,
  edges,
  onApplyWorkflow,
  isOpen,
  onToggle,
  processData,
  onProcessDataConsumed,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "system",
      content:
        "안녕하세요! AI Workflow 도우미입니다.\n\n• 🤖 AI Workflow 버튼 → 자동 워크플로우 생성\n• 이후 채팅으로 수정 요청 가능\n\n예: \"순서를 바꿔줘\", \"병렬 구조로 변경\", \"단계 추가해줘\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const processDataConsumedRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  /* ── Auto-trigger AI generation when processData is provided ── */
  useEffect(() => {
    if (!isOpen || !processData || processDataConsumedRef.current || loading) return;
    processDataConsumedRef.current = true;

    const autoGenerate = async () => {
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: "📋 선택된 L3 프로세스의 최적 워크플로우를 생성해주세요.",
          timestamp: new Date(),
        },
      ]);
      setLoading(true);
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            processData,
            prompt: "논리적 순서에 맞게 배치하고 연결해주세요.",
          }),
        });
        if (!res.ok) throw new Error("API 호출 실패");
        const data = await res.json();
        if (data.nodes && data.edges) {
          const fixedEdges = ensureArrowMarkers(data.edges);
          onApplyWorkflow(data.nodes, fixedEdges);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `✅ 워크플로우가 생성되었습니다!\n📦 노드: ${data.nodes.length}개 · 🔗 엣지: ${fixedEdges.length}개\n\n수정하고 싶으시면 아래에 입력해주세요.`,
              timestamp: new Date(),
            },
          ]);
        } else {
          throw new Error("응답 형식 오류");
        }
      } catch (err) {
        console.error(err);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "❌ 워크플로우 생성에 실패했습니다. API 키를 확인하거나 다시 시도해주세요.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
        onProcessDataConsumed?.();
      }
    };
    autoGenerate();
  }, [isOpen, processData, loading, onApplyWorkflow, onProcessDataConsumed]);

  /* Reset consumed flag when processData changes */
  useEffect(() => {
    if (processData) {
      processDataConsumedRef.current = false;
    }
  }, [processData]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (nodes.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, timestamp: new Date() },
        {
          role: "assistant",
          content:
            "⚠️ 캔버스에 노드가 없습니다. 먼저 좌측에서 항목을 추가하거나 🤖 AI Workflow 버튼으로 생성해주세요.",
          timestamp: new Date(),
        },
      ]);
      setInput("");
      return;
    }

    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          currentWorkflow: { nodes, edges },
          mode: "chat",
        }),
      });

      if (!res.ok) throw new Error("API 호출 실패");
      const data = await res.json();

      if (data.nodes && data.edges) {
        const fixedEdges = ensureArrowMarkers(data.edges);
        onApplyWorkflow(data.nodes, fixedEdges);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              data.message ||
              `✅ 워크플로우가 수정되었습니다.\n📦 노드: ${data.nodes.length}개 · 🔗 엣지: ${fixedEdges.length}개`,
            timestamp: new Date(),
          },
        ]);
      } else if (data.message) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message, timestamp: new Date() },
        ]);
      } else {
        throw new Error("응답 형식 오류");
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "❌ 수정에 실패했습니다. API 키를 확인하거나 다시 시도해주세요.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, nodes, edges, onApplyWorkflow]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-110 flex items-center justify-center text-2xl"
        title="AI 채팅 열기"
      >
        💬
      </button>
    );
  }

  return (
    <div className="w-[380px] border-l border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-indigo-600">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <span>🤖</span> AI Workflow Chat
          </h3>
          <p className="text-[10px] text-purple-200 mt-0.5">
            워크플로우 생성 · 수정 · 최적화
          </p>
        </div>
        <button
          onClick={onToggle}
          className="text-purple-200 hover:text-white text-lg transition-colors"
          title="닫기"
        >
          ✕
        </button>
      </div>

      {/* Current state badge */}
      <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50">
        <div className="flex gap-2 text-[10px] text-gray-500">
          <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
            📦 노드 {nodes.length}
          </span>
          <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
            🔗 엣지 {edges.length}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-md"
                  : msg.role === "system"
                    ? "bg-purple-50 text-purple-800 border border-purple-100 rounded-bl-md"
                    : "bg-gray-100 text-gray-700 rounded-bl-md"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
              <div
                className={`text-[9px] mt-1.5 ${
                  msg.role === "user" ? "text-indigo-200" : "text-gray-400"
                }`}
              >
                {msg.timestamp.toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span
                  className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 p-3 bg-gray-50/30">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="워크플로우 수정 요청을 입력하세요..."
            rows={1}
            className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-300 placeholder-gray-400 bg-white"
            style={{ maxHeight: "80px" }}
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="self-end px-3.5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl text-xs font-medium hover:from-purple-700 hover:to-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "⏳" : "➤"}
          </button>
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {[
            "순서 변경",
            "병렬 구조로",
            "단계 최적화",
            "설명 추가",
            "불필요 단계 제거",
          ].map((q) => (
            <button
              key={q}
              onClick={() => setInput(q)}
              className="text-[10px] px-2.5 py-1 bg-white border border-gray-200 rounded-full text-gray-500 hover:bg-purple-50 hover:border-purple-200 hover:text-purple-600 transition-colors shadow-sm"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
