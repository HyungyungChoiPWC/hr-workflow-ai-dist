import { NextResponse } from "next/server";

/**
 * AI 챗 (워크플로우 초안 생성 / 자연어 수정)
 * 웹 편입판: AX렌즈 백엔드(구독 엔진)로 프록시 — OpenAI 키 불필요.
 * 로컬 설치판: 백엔드가 없으므로 비활성(503). UI 에서도 챗 패널을 숨긴다.
 */
export async function POST(request: Request) {
  const backend = process.env.MAPBUILDER_BACKEND_URL;
  const token = process.env.MAPBUILDER_INTERNAL_TOKEN;
  if (!backend || !token) {
    return NextResponse.json(
      { error: "로컬 설치판에서는 AI 챗을 사용할 수 없습니다. 웹 버전(pwc-ax-lens.com/map)을 이용하세요." },
      { status: 503 }
    );
  }
  try {
    const body = await request.text();
    const res = await fetch(`${backend.replace(/\/$/, "")}/api/mapbuilder/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": token },
      body,
      // 대형 워크플로우 생성은 수십 초 걸릴 수 있음
      signal: AbortSignal.timeout(Number(process.env.MAPBUILDER_TIMEOUT_MS ?? 300000)),
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
    if (!res.ok) {
      const detail = (data as { detail?: string; error?: string }).detail ?? (data as { error?: string }).error ?? "backend error";
      return NextResponse.json({ error: detail }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Failed to generate workflow" }, { status: 500 });
  }
}
