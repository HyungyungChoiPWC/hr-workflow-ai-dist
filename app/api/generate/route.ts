import { NextResponse } from "next/server";
import OpenAI from "openai";

// Lazy-init: 빌드 시 env 없어도 안전
let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  }
  return _openai;
}

/* ═══ System prompt for FRESH workflow generation ═══ */
const SYSTEM_PROMPT_GENERATE = `You are an expert HR workflow architect. You receive a structured HR process (L2→L3→L4→L5 hierarchy) and must design the optimal workflow.

You must output ONLY a raw JSON object with two arrays: "nodes" and "edges".

NODES format:
- Each node: { "id": string, "type": "l2"|"l3"|"l4"|"l5", "position": {"x": number, "y": number}, "data": {"label": string, "level": "L2"|"L3"|"L4"|"L5", "id": string, "description": string} }
- Arrange L2/L3 nodes as headers on the left
- Arrange L4 nodes as the main vertical flow (x=300, y increasing by 120)
- Arrange L5 nodes to the right of their parent L4 (x=650, y offset from parent)
- Use actual IDs from the input data

EDGES format:
- Each edge: { "id": string, "source": string, "target": string, "type": "smoothstep", "animated": true/false, "style": {"stroke": string, "strokeWidth": number}, "markerEnd": {"type": "arrowclosed", "width": 20, "height": 20, "color": string}, "label": string (optional) }
- Connect L4 nodes in logical sequential order (the main process flow)
- Connect L4 to its child L5 nodes
- Use animated=true for main flow, animated=false for L4→L5
- Add edge labels like "완료 후", "승인 시", "검토 후" where appropriate to indicate flow logic
- ALWAYS include markerEnd with arrowclosed on every edge for visible arrows

IMPORTANT:
- Think about the logical ORDER of the process steps.
- If steps can happen in parallel, place them at the same Y level with different X positions.
- The main flow edges should use stroke "#a62121" strokeWidth 2.5 with markerEnd color "#a62121"
- L3→L4 edges should use stroke "#d95578" strokeWidth 2 with markerEnd color "#d95578"
- L4→L5 edges should use stroke "#f2a0af" strokeWidth 1.5 with markerEnd color "#f2a0af"`;

/* ═══ System prompt for CHAT-based workflow modification ═══ */
const SYSTEM_PROMPT_CHAT = `You are an expert HR workflow architect. The user has an existing workflow on their canvas and wants you to modify it based on their instructions.

You will receive the current workflow (nodes and edges) and the user's modification request.

You must output a JSON object with:
1. "nodes" — the complete updated array of nodes (including unmodified ones)
2. "edges" — the complete updated array of edges (including unmodified ones) 
3. "message" — A brief Korean explanation of what you changed (1-2 sentences)

RULES:
- Preserve existing node IDs when modifying (don't create new IDs for nodes that still exist)
- When reordering, update the position {x, y} values
- When adding nodes, use type "l4" or "l5" with proper data format: { "label": string, "level": "L4"|"L5", "id": string, "description": string }
- When removing nodes, also remove their connected edges
- Edges format: { "id": string, "source": string, "target": string, "type": "smoothstep", "animated": boolean, "style": {"stroke": "#d95578", "strokeWidth": 2.5}, "markerEnd": {"type": "arrowclosed", "width": 20, "height": 20, "color": "#d95578"}, "label"?: string }
- Keep layout clean: main flow vertically (y += 120), branches to the right
- Edge labels like "완료 후", "승인 시" for logical flow connections
- Always respond with valid JSON

Common modification patterns:
- "순서 변경" → Reorder nodes by updating positions and edge connections
- "병렬 구조" → Place parallel steps at same Y with different X
- "단계 추가" → Insert new nodes and reconnect edges
- "단계 제거" → Remove nodes and bridge remaining edges
- "최적화" → Merge redundant steps, streamline flow
- "설명 추가" → Add/update description fields on nodes`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { processData, prompt, currentWorkflow, mode } = body;

    if (!processData && !prompt) {
      return NextResponse.json(
        { error: "processData or prompt is required" },
        { status: 400 }
      );
    }

    /* ─── Chat mode: modify existing workflow ─── */
    if (mode === "chat" && currentWorkflow) {
      const workflowContext = JSON.stringify(
        {
          nodes: currentWorkflow.nodes.map((n: Record<string, unknown>) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data,
          })),
          edges: currentWorkflow.edges.map((e: Record<string, unknown>) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: (e as Record<string, unknown>).label,
          })),
        },
        null,
        2
      );

      const userMessage = `현재 워크플로우:\n${workflowContext}\n\n사용자 요청: ${prompt}`;

      const completion = await getOpenAI().chat.completions.create({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT_CHAT },
          { role: "user", content: userMessage },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        return NextResponse.json(
          { error: "No response from AI" },
          { status: 500 }
        );
      }

      const data = JSON.parse(content);
      return NextResponse.json(data);
    }

    /* ─── Generate mode: create fresh workflow ─── */
    const userMessage = processData
      ? `다음 HR 프로세스의 최적 워크플로우를 설계해주세요:\n\n${processData}\n\n${prompt || "논리적 순서에 맞게 배치하고 연결해주세요."}`
      : prompt;

    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT_GENERATE },
        { role: "user", content: userMessage },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "No response from AI" },
        { status: 500 }
      );
    }

    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate workflow" },
      { status: 500 }
    );
  }
}
