"use client";

/**
 * AppLogo — 중립 워크플로우 마크 (브랜드 무관)
 * 연결된 노드 3개로 프로세스 흐름을 상징.
 */
export default function AppLogo({
  width = 44,
  height = 44,
}: {
  width?: number;
  height?: number;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="As-Is Workflow Builder Logo"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#A62121" />
      {/* 연결선 */}
      <path
        d="M16 16 H30 a4 4 0 0 1 4 4 v0 a4 4 0 0 1 -4 4 H18 a4 4 0 0 0 -4 4 v0 a4 4 0 0 0 4 4 H32"
        stroke="#F2A0AF"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* 노드 3개 */}
      <circle cx="15" cy="16" r="4.5" fill="#FFFFFF" />
      <circle cx="33" cy="32" r="4.5" fill="#FFFFFF" />
      <circle cx="33" cy="20" r="3.2" fill="#F2A0AF" />
    </svg>
  );
}
