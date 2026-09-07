"use client";

import { Handle, Position } from "@xyflow/react";

interface StandardNodeData {
  label: string;
  taskType: string;
}

const taskTypeColors: Record<string, { text: string; bg: string }> = {
  Planning: { text: "text-blue-600", bg: "bg-blue-50" },
  Approval: { text: "text-amber-600", bg: "bg-amber-50" },
  Execution: { text: "text-green-600", bg: "bg-green-50" },
  Review: { text: "text-purple-600", bg: "bg-purple-50" },
};

export default function StandardNode({ data }: { data: StandardNodeData }) {
  const colors = taskTypeColors[data.taskType] ?? {
    text: "text-gray-600",
    bg: "bg-gray-50",
  };

  return (
    <div className="bg-white shadow-md rounded-lg border border-gray-200 min-w-[150px] px-4 py-3">
      {/* Target Handle (top) */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-gray-400"
      />

      {/* Task Type Badge */}
      <div className="mb-1">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${colors.bg} ${colors.text}`}
        >
          {data.taskType}
        </span>
      </div>

      {/* Label */}
      <div className="text-sm font-bold text-gray-800">{data.label}</div>

      {/* Source Handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-gray-400"
      />
    </div>
  );
}
