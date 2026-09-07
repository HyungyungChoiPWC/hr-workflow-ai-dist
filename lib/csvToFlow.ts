/* ─────────────────────────────────────────────
 * CSV → React Flow Nodes & Edges 변환 유틸리티
 *
 * CSV 스키마 variant:
 *  - doosan-hr-4    : 두산 HR (4 actor + 6 system)
 *  - qvex-affairs-6 : 큐벡스 복리후생/총무 공통 (6 actor + 10 system)
 *  - qvex-payroll-7 : 큐벡스 급여 (7 actor + 6 system)
 *
 * 과거에는 복리후생을 별도 5-actor variant("qvex-welfare-5")로 다뤘으나,
 * 실제 CSV 구조가 총무와 동일(계열사_임직원 포함 6 actor)이라 affairs-6 로 통합.
 * 기존에 저장된 JSON 의 "qvex-welfare-5" 도 동일 config 로 매핑되어 호환 유지.
 *
 * variant 는 CSV 헤더에서 자동 감지(parseCsv) 또는 시트 프리셋에서 명시 설정.
 * VARIANT_CONFIG 를 단일 진실 원천(SoT)으로 사용.
 * ───────────────────────────────────────────── */

import { MarkerType, type Node, type Edge } from "@xyflow/react";

export type CsvVariant = "doosan-hr-4" | "qvex-welfare-5" | "qvex-affairs-6" | "qvex-payroll-7";

/** 각 variant 의 actor 키 목록 (= 노드 actors 객체의 키) */
export type DoosanHrActorKey = "exec" | "hr" | "teamlead" | "member";
export type QvexActorKey =
  // welfare-5 / affairs-6
  | "qvex_welfare"
  | "qvex_purchase"
  | "qvex_payroll"
  | "qvex_manager"
  | "affiliate_employee"
  | "affiliate_dept"
  // payroll-7
  | "qvex_ps"
  | "payroll_teamlead"
  | "qvex_bs"
  | "affiliate_hr_er"
  | "affiliate_finance"
  | "external_partner";
export type AnyActorKey = DoosanHrActorKey | QvexActorKey;

/** 각 variant 의 system 키 목록 (= 노드 systems 객체의 키) */
export type DoosanHrSystemKey = "hr" | "groupware" | "office" | "external" | "manual" | "etc";
export type QvexSystemKey =
  | "pnbs"
  | "doobuy"
  | "portal"
  | "eapproval"
  | "accounting"
  | "ildong"
  | "qvex_manual"
  | "ms_office"
  | "email_phone"
  | "pro_tool";
export type AnySystemKey = DoosanHrSystemKey | QvexSystemKey;

/** variant 별 actor 정의 — key, CSV 헤더, 화면/스왑레인 라벨, NodeDetailPanel 역할 라벨 */
interface ActorDef<K extends string> {
  key: K;
  csvHeader: string;          // CSV 컬럼 헤더 텍스트 (canonical)
  laneLabel: string;          // SwimLane 표시 라벨
  roleLabel: string;          // NodeDetailPanel/AddNodeModal 의 토글 라벨 (저장 포맷 = 라벨 자체)
  /** Optional: variant 내에서 unique 한 매칭 토큰. 정규화된 헤더(normalizeHeader 적용)에
   *  토큰 전부가 substring 으로 포함되면 매칭. 예: "큐벡스 PS", "큐벡스_PS", "큐벡스PS" 모두
   *  ["큐벡스ps"] 로 매칭. csvHeader 와 다른 표기의 헤더도 흡수 가능. */
  matchTokens?: string[];
}

/** variant 별 system 정의 — key, CSV 헤더, 화면 라벨 */
interface SystemDef<K extends string> {
  key: K;
  csvHeader: string;
  displayLabel: string;
  matchTokens?: string[];
}

/** variant 별 메타데이터(공통) — meta/PP/Input/Output/Logic 은 모든 variant 동일 */
const COMMON_META_HEADERS = [
  "관리주체", "담당자 수", "주 담당자", "평균 건당 소요시간", "발생 빈도_건수",
] as const;
const COMMON_PP_HEADERS = [
  "Pain Point_시간_속도", "Pain Point_정확성", "Pain Point_반복/수작업",
  "Pain Point_정보_데이터", "Pain Point_시스템_도구", "Pain Point_의사소통_협업", "Pain Point_기타",
] as const;
const COMMON_INPUT_HEADERS = [
  "Input_시스템 데이터", "Input_문서_서류", "Input_외부 정보", "Input_구두_메일 요청", "Input_기타",
] as const;
const COMMON_OUTPUT_HEADERS = [
  "Output_시스템 반영", "Output_문서_보고서", "Output_커뮤니케이션", "Output_의사결정", "Output_기타",
] as const;
const COMMON_LOGIC_HEADERS = [
  "업무 판단 로직_Rule_based", "업무 판단 로직_사람 판단", "업무 판단 로직_혼합",
] as const;

/** 모든 variant 가 공유하는 hierarchy(L2/L3/L4/L5) 헤더 */
const HIERARCHY_HEADERS = [
  "ID", "두산 L2", "ID", "Name", "ID", "Name", "Description",
  "ID", "Name", "Description",
] as const;

/* ── variant 별 actor/system 정의 ── */
const DOOSAN_HR_ACTORS: ActorDef<DoosanHrActorKey>[] = [
  { key: "exec",     csvHeader: "수행주체_임원",       laneLabel: "현업 임원",   roleLabel: "임원 (=현업 임원)", matchTokens: ["수행주체", "임원"] },
  { key: "hr",       csvHeader: "수행주체_HR",          laneLabel: "HR 담당자",   roleLabel: "HR",                  matchTokens: ["수행주체_hr"] },
  { key: "teamlead", csvHeader: "수행주체_현업 팀장",   laneLabel: "팀장",        roleLabel: "현업 팀장",           matchTokens: ["수행주체", "팀장"] },
  { key: "member",   csvHeader: "수행주체_현업 구성원", laneLabel: "구성원",      roleLabel: "현업 구성원",         matchTokens: ["수행주체", "구성원"] },
];

const DOOSAN_HR_SYSTEMS: SystemDef<DoosanHrSystemKey>[] = [
  { key: "hr",        csvHeader: "사용 시스템_HR 전용시스템",  displayLabel: "HR" },
  { key: "groupware", csvHeader: "사용 시스템_그룹웨어_협업툴", displayLabel: "그룹웨어" },
  { key: "office",    csvHeader: "사용 시스템_오피스_문서도구", displayLabel: "오피스" },
  { key: "external",  csvHeader: "사용 시스템_외부_연동시스템", displayLabel: "외부 연동" },
  { key: "manual",    csvHeader: "사용 시스템_수작업_오프라인", displayLabel: "수작업" },
  { key: "etc",       csvHeader: "사용 시스템_기타 전문 Tool",  displayLabel: "기타" },
];

const QVEX_ACTORS_BASE: ActorDef<QvexActorKey>[] = [
  { key: "qvex_welfare",  csvHeader: "수행주체_큐벡스_총무/복리후생_담당자", laneLabel: "큐벡스 총무/복리후생 담당자", roleLabel: "큐벡스 총무/복리후생 담당자", matchTokens: ["큐벡스", "총무"] },
  { key: "qvex_purchase", csvHeader: "수행주체_큐벡스_구매_담당자",          laneLabel: "큐벡스 구매 담당자",          roleLabel: "큐벡스 구매 담당자" },
  { key: "qvex_payroll",  csvHeader: "수행주체_큐벡스_급여_담당자",          laneLabel: "큐벡스 급여 담당자",          roleLabel: "큐벡스 급여 담당자" },
  { key: "qvex_manager",  csvHeader: "수행주체_큐벡스_관리자(중역)",         laneLabel: "큐벡스 관리자(중역)",         roleLabel: "큐벡스 관리자(중역)" },
];

/** 큐벡스 복리후생 + 총무 공통 — 6 actor (welfare 와 affairs 가 동일한 수행주체 구성을 사용) */
const QVEX_AFFAIRS_ACTORS: ActorDef<QvexActorKey>[] = [
  ...QVEX_ACTORS_BASE,
  { key: "affiliate_employee", csvHeader: "수행주체_계열사_임직원",                   laneLabel: "계열사 임직원",              roleLabel: "계열사 임직원" },
  { key: "affiliate_dept",     csvHeader: "수행주체_계열사_주관부서(현업부서_포함)", laneLabel: "계열사 주관부서(현업 포함)", roleLabel: "계열사 주관부서(현업 포함)" },
];

/** 큐벡스 급여 — 7 actor (큐벡스PS/팀장/큐벡스BS/계열사 HR·ER/계열사 회계·세무·재무/계열사 임직원/대외 담당자).
 *  matchTokens 는 CSV 헤더 표기 변형 흡수용: "큐벡스 PS" / "큐벡스_PS" / "(큐벡스 PS)" 모두 매칭. */
const QVEX_PAYROLL_ACTORS: ActorDef<QvexActorKey>[] = [
  { key: "qvex_ps",            csvHeader: "수행주체_실무담당자(큐벡스PS)",  laneLabel: "큐벡스PS 실무담당자",       roleLabel: "큐벡스PS 실무담당자", matchTokens: ["큐벡스ps"] },
  { key: "payroll_teamlead",   csvHeader: "수행주체_팀장",                    laneLabel: "팀장",                        roleLabel: "팀장",                  matchTokens: ["수행주체", "팀장"] },
  { key: "qvex_bs",            csvHeader: "수행주체_큐벡스BS",                laneLabel: "큐벡스BS",                    roleLabel: "큐벡스BS",              matchTokens: ["큐벡스bs"] },
  { key: "affiliate_hr_er",    csvHeader: "수행주체_계열사_HR_ER",            laneLabel: "계열사 HR/ER",               roleLabel: "계열사 HR/ER",          matchTokens: ["hr_er"] },
  { key: "affiliate_finance",  csvHeader: "수행주체_계열사_회계사_세무_재무", laneLabel: "계열사 회계/세무/재무",       roleLabel: "계열사 회계/세무/재무",  matchTokens: ["회계"] },
  { key: "affiliate_employee", csvHeader: "수행주체_계열사_임직원",            laneLabel: "계열사 임직원",              roleLabel: "계열사 임직원",          matchTokens: ["임직원"] },
  { key: "external_partner",   csvHeader: "수행주체_대외_담당자",             laneLabel: "대외 담당자",                roleLabel: "대외 담당자",            matchTokens: ["대외"] },
];

/** 큐벡스 급여 — 6종 시스템. PnBS 는 welfare/affairs 와 키 공유, 나머지는 doosan-hr-4 와 키 공유.
 *  셀 값은 마커(⬤/O 등)일 수도, 자유 텍스트("Teams, Outlook")일 수도 있는 hybrid.
 *  NodeDetailPanel 에서 셀 단위로 마커/텍스트를 판별해 표시 (isMarkerValue). */
const QVEX_PAYROLL_SYSTEMS: SystemDef<AnySystemKey>[] = [
  { key: "pnbs",      csvHeader: "사용 시스템_PnBS",            displayLabel: "PnBS" },
  { key: "groupware", csvHeader: "사용 시스템_그룹웨어_협업툴", displayLabel: "그룹웨어 협업툴" },
  { key: "office",    csvHeader: "사용 시스템_오피스_문서도구", displayLabel: "오피스 문서도구" },
  { key: "external",  csvHeader: "사용 시스템_외부_연동시스템", displayLabel: "외부 연동시스템" },
  { key: "manual",    csvHeader: "사용 시스템_수작업_오프라인", displayLabel: "수작업" },
  { key: "etc",       csvHeader: "사용 시스템_기타 전문 Tool",  displayLabel: "기타 전문 Tool" },
];

/** 큐벡스 복리후생/총무 둘 다 동일한 10개 system 컬럼 사용 */
const QVEX_SYSTEMS: SystemDef<QvexSystemKey>[] = [
  { key: "pnbs",        csvHeader: "사용 시스템_PnBS",                 displayLabel: "PnBS" },
  { key: "doobuy",      csvHeader: "사용 시스템_구매시스템(DooBuy)",   displayLabel: "구매시스템(DooBuy)" },
  { key: "portal",      csvHeader: "사용 시스템_포탈(공지용)",         displayLabel: "포탈(공지용)" },
  { key: "eapproval",   csvHeader: "사용 시스템_전자결재",             displayLabel: "전자결재" },
  { key: "accounting",  csvHeader: "사용 시스템_회계시스템",           displayLabel: "회계시스템" },
  { key: "ildong",      csvHeader: "사용 시스템_외부/연동시스템(일동)", displayLabel: "외부/연동시스템(일동)" },
  { key: "qvex_manual", csvHeader: "사용 시스템_수기작업",             displayLabel: "수기작업" },
  { key: "ms_office",   csvHeader: "사용 시스템_MS(워드_엑셀_등)",     displayLabel: "MS(워드,엑셀 등)" },
  { key: "email_phone", csvHeader: "사용 시스템_이메일_유선전화_등",   displayLabel: "이메일, 유선전화 등" },
  { key: "pro_tool",    csvHeader: "사용 시스템_기타_전문_Tool",       displayLabel: "기타 전문 Tool" },
];

export interface VariantConfig {
  variant: CsvVariant;
  actors: ActorDef<AnyActorKey>[];
  systems: SystemDef<AnySystemKey>[];
  /** 기본 SwimLane 레인 라벨 — actors.laneLabel 순서와 동일 */
  defaultLanes: string[];
}

export const VARIANT_CONFIG: Record<CsvVariant, VariantConfig> = {
  "doosan-hr-4": {
    variant: "doosan-hr-4",
    actors: DOOSAN_HR_ACTORS as ActorDef<AnyActorKey>[],
    systems: DOOSAN_HR_SYSTEMS as SystemDef<AnySystemKey>[],
    defaultLanes: DOOSAN_HR_ACTORS.map((a) => a.laneLabel),
  },
  /* welfare-5 는 affairs-6 와 동일한 6-actor / 10-system 구조 (legacy variant 명만 보존).
   * 큐벡스 변형은 SwimLane 에 "그 외" 레인을 actor 뒤에 추가 → 복리후생/총무 7분할, 급여 8분할. */
  "qvex-welfare-5": {
    variant: "qvex-welfare-5",
    actors: QVEX_AFFAIRS_ACTORS as ActorDef<AnyActorKey>[],
    systems: QVEX_SYSTEMS as SystemDef<AnySystemKey>[],
    defaultLanes: [...QVEX_AFFAIRS_ACTORS.map((a) => a.laneLabel), "그 외"],
  },
  "qvex-affairs-6": {
    variant: "qvex-affairs-6",
    actors: QVEX_AFFAIRS_ACTORS as ActorDef<AnyActorKey>[],
    systems: QVEX_SYSTEMS as SystemDef<AnySystemKey>[],
    defaultLanes: [...QVEX_AFFAIRS_ACTORS.map((a) => a.laneLabel), "그 외"],
  },
  "qvex-payroll-7": {
    variant: "qvex-payroll-7",
    actors: QVEX_PAYROLL_ACTORS as ActorDef<AnyActorKey>[],
    /* 급여는 텍스트 시스템 5종 — doosan-hr-4 와 동일한 키, 단 external 컬럼 없음 */
    systems: QVEX_PAYROLL_SYSTEMS as SystemDef<AnySystemKey>[],
    defaultLanes: [...QVEX_PAYROLL_ACTORS.map((a) => a.laneLabel), "그 외"],
  },
};

/** variant 의 NodeDetailPanel 역할 토글 라벨 목록 (선택지). "그 외" 는 모든 variant 공통으로 추가됨 */
export function getRoleOptionsForVariant(variant: CsvVariant): string[] {
  return VARIANT_CONFIG[variant].actors.map((a) => a.roleLabel);
}

/** variant 의 system 표시 정보 */
export function getSystemDefsForVariant(variant: CsvVariant): SystemDef<AnySystemKey>[] {
  return VARIANT_CONFIG[variant].systems;
}

/** 사용 시스템 셀 값이 마커(⬤/O/● 등 단일 동그라미 기호)인지 판별 */
export function isSystemMarkerValue(v: string): boolean {
  return /^[O○●⬤◯o]$/.test((v || "").trim());
}

/** systems 키 셋으로 variant 추정 (variant 미명시 노드 fallback) */
function detectVariantFromSystemKeys(sys: Record<string, string>): CsvVariant {
  if ("doobuy" in sys || "portal" in sys || "qvex_manual" in sys || "ms_office" in sys) return "qvex-affairs-6";
  if ("pnbs" in sys) return "qvex-payroll-7";
  return "doosan-hr-4";
}

/** 노드의 사용 시스템 표시 문자열 목록 — variant 무관 + 셀 마커(●)는 displayLabel 로 치환.
 *  flat(d.system) 이 있으면 우선 사용. 캔버스(LevelNode)와 PPT 내보내기가 공유하는 단일 진실. */
export function systemDisplayNames(
  systems: Record<string, string> | undefined,
  variant?: CsvVariant,
  flat?: string,
): string[] {
  if (flat && flat.trim()) return [flat.trim()];
  if (!systems) return [];
  const v = variant ?? detectVariantFromSystemKeys(systems);
  const parts: string[] = [];
  for (const def of VARIANT_CONFIG[v].systems) {
    const val = systems[def.key]?.trim();
    if (!val) continue;
    parts.push(isSystemMarkerValue(val) ? def.displayLabel : val);
  }
  return parts;
}

/** variant 의 actor 표시 정보 */
export function getActorDefsForVariant(variant: CsvVariant): ActorDef<AnyActorKey>[] {
  return VARIANT_CONFIG[variant].actors;
}

/** variant 의 기본 SwimLane 레인 라벨 */
export function getDefaultLanesForVariant(variant: CsvVariant): string[] {
  return VARIANT_CONFIG[variant].defaultLanes;
}

/** roleLabel → actor key 역매핑 (NodeDetailPanel 에서 role 문자열 → actors 객체 변환 시 사용) */
export function actorKeyByRoleLabel(variant: CsvVariant, roleLabel: string): AnyActorKey | undefined {
  return VARIANT_CONFIG[variant].actors.find((a) => a.roleLabel === roleLabel)?.key;
}

/** variant 별 (TEMPLATE 헤더용) 컬럼 헤더 배열 — hierarchy + actors + meta + systems + PP + IO + logic */
function templateHeadersForVariant(variant: CsvVariant): string[] {
  const cfg = VARIANT_CONFIG[variant];
  return [
    ...HIERARCHY_HEADERS,
    ...cfg.actors.map((a) => a.csvHeader),
    ...COMMON_META_HEADERS,
    ...cfg.systems.map((s) => s.csvHeader),
    ...COMMON_PP_HEADERS,
    ...COMMON_INPUT_HEADERS,
    ...COMMON_OUTPUT_HEADERS,
    ...COMMON_LOGIC_HEADERS,
  ];
}

/** 헤더 텍스트 정규화 — 구분자(whitespace · _ · , · /) 제거 + lowercase.
 *  손으로 만든 CSV / 엑셀 양식의 구분자 혼용을 흡수:
 *   "유선전화_등" / "유선전화 등", "기타_전문_Tool" / "기타 전문 Tool",
 *   "MS(워드_엑셀_등)" / "MS(워드, 엑셀 등)", "시간_속도" / "시간/속도" 모두 동일 매칭.
 *  (괄호는 의미 구분에 쓰이므로 유지: "포탈(공지용)" ≠ "포탈") */
function normalizeHeader(h: string): string {
  return (h || "").replace(/[\s_,/]+/g, "").toLowerCase();
}

/** CSV 헤더 라인을 검사하여 variant 자동 감지.
 *  헤더 텍스트의 공백/대소문자 변형에 강건하도록 정규화 후 검사. */
export function detectCsvVariant(headerCells: string[]): CsvVariant {
  // 헤더가 짧으면 기본값
  if (headerCells.length <= 10) return "doosan-hr-4";
  const joinedNorm = headerCells.map(normalizeHeader).join("|");
  /* 1) 큐벡스PS / 큐벡스BS 마커 → 급여(payroll-7) — 다른 큐벡스 variant 보다 먼저 검사.
   *    "큐벡스 PS" 처럼 공백이 끼어 있어도 normalizeHeader 가 공백을 제거하므로 매칭됨. */
  if (/큐벡스ps|큐벡스bs/.test(joinedNorm)) return "qvex-payroll-7";
  /* 2) 그 외 큐벡스 헤더 → 복리후생/총무 공통 (affairs-6 로 단일화) */
  if (/큐벡스/.test(joinedNorm)) return "qvex-affairs-6";
  return "doosan-hr-4";
}

/** rows[0]._variant 으로부터 variant 추출. 비어있으면 기본값. */
export function getCsvVariantFromRows(rows: CsvRow[]): CsvVariant {
  return rows[0]?._variant || "doosan-hr-4";
}

/* ── CsvRow: 모든 variant 의 필드를 optional 로 포함 ──
 *   parser 가 variant 에 해당하는 필드만 채우고 나머지는 빈 문자열.
 *   _variant 디스크리미네이터로 어떤 variant 인지 식별. */
export interface CsvRow {
  L2_ID: string;
  "두산 L2": string;
  L3_ID: string;
  L3_Name: string;
  L4_ID: string;
  L4_Name: string;
  L4_Description: string;
  L5_ID: string;
  L5_Name: string;
  L5_Description: string;
  /** variant 디스크리미네이터 (parseCsv 가 설정) */
  _variant: CsvVariant;
  /* doosan-hr-4 actors */
  actor_exec: string;
  actor_hr: string;
  actor_teamlead: string;
  actor_member: string;
  /* qvex actors (welfare-5 / affairs-6) */
  actor_qvex_welfare: string;
  actor_qvex_purchase: string;
  actor_qvex_payroll: string;
  actor_qvex_manager: string;
  actor_affiliate_employee: string;
  actor_affiliate_dept: string;
  /* qvex actors (payroll-7) */
  actor_qvex_ps: string;
  actor_payroll_teamlead: string;
  actor_qvex_bs: string;
  actor_affiliate_hr_er: string;
  actor_affiliate_finance: string;
  actor_external_partner: string;
  /** "그 외" — variant config 에 없는 수행주체_* 컬럼들을 흡수.
   *  parseCsv 가 미지의 actor 헤더 셀을 "header1::value1\nheader2::value2" 형식으로 인코딩해 저장.
   *  변종 추가나 CSV 컬럼 추가 시 위치 밀림 없이 안전하게 처리하기 위한 보호장치. */
  actor_other: string;
  /* common meta */
  mgr_body: string;
  staff_count: string;
  main_person: string;
  avg_time: string;
  freq_count: string;
  /* doosan-hr-4 systems */
  sys_hr: string;
  sys_groupware: string;
  sys_office: string;
  sys_external: string;
  sys_manual: string;
  sys_etc: string;
  /* qvex systems (동그라미 "O" 또는 빈값) */
  sys_pnbs: string;
  sys_doobuy: string;
  sys_portal: string;
  sys_eapproval: string;
  sys_accounting: string;
  sys_ildong: string;
  sys_qvex_manual: string;
  sys_ms_office: string;
  sys_email_phone: string;
  sys_pro_tool: string;
  /* common PP / IO / Logic */
  pp_speed: string;
  pp_accuracy: string;
  pp_repeat: string;
  pp_data: string;
  pp_system: string;
  pp_comm: string;
  pp_etc: string;
  in_system: string;
  in_doc: string;
  in_external: string;
  in_request: string;
  in_etc: string;
  out_system: string;
  out_doc: string;
  out_comm: string;
  out_decision: string;
  out_etc: string;
  logic_rule: string;
  logic_human: string;
  logic_mixed: string;
}

/* ═══════════════════════════════════════════════
 * 1) 계층 구조 추출 유틸리티
 * ═══════════════════════════════════════════════ */

export interface L2Item {
  id: string;
  name: string;
}
export interface L3Item {
  id: string;
  name: string;
  l2Id: string;
  l2Name: string;
}
export interface L4Item {
  id: string;
  name: string;
  description: string;
  l3Id: string;
  isManual?: boolean;
}
export interface L5Item {
  id: string;
  name: string;
  description: string;
  l4Id: string;
  l3Id?: string;
  l2Id?: string;
  l3Name?: string;
  l2Name?: string;
  isManual?: boolean;
  /** CSV 출처의 variant — 노드 직렬화 시 variant 보존용 */
  variant?: CsvVariant;
  /* ── extended metadata ──
   * actors / systems 키는 variant 마다 다르므로 Record 로 느슨하게 둠.
   * variant 와 함께 보면 어떤 키가 유효한지 판별 가능 (VARIANT_CONFIG 참고). */
  actors?: Record<string, string>;
  mgrBody?: string;
  staffCount?: string;
  mainPerson?: string;
  avgTime?: string;
  freqCount?: string;
  systems?: Record<string, string>;
  painPoints?: { speed: string; accuracy: string; repeat: string; data: string; system: string; comm: string; etc: string };
  inputs?: { system: string; doc: string; external: string; request: string; etc: string };
  outputs?: { system: string; doc: string; comm: string; decision: string; etc: string };
  logic?: { rule: string; human: string; mixed: string };
}

/** L2 목록 추출 */
export function extractL2List(rows: CsvRow[]): L2Item[] {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!map.has(r.L2_ID)) map.set(r.L2_ID, r["두산 L2"]);
  }
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** 특정 L2 아래 L3 목록 추출 */
export function extractL3ByL2(rows: CsvRow[], l2Id: string): L3Item[] {
  const map = new Map<string, L3Item>();
  for (const r of rows) {
    if (r.L2_ID === l2Id && !map.has(r.L3_ID)) {
      map.set(r.L3_ID, {
        id: r.L3_ID,
        name: r.L3_Name,
        l2Id: r.L2_ID,
        l2Name: r["두산 L2"],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

/** 특정 L3 아래 L4 목록 추출 */
export function extractL4ByL3(rows: CsvRow[], l3Id: string): L4Item[] {
  const map = new Map<string, L4Item>();
  for (const r of rows) {
    if (r.L3_ID === l3Id && r.L4_ID && !map.has(r.L4_ID)) {
      map.set(r.L4_ID, {
        id: r.L4_ID,
        name: r.L4_Name,
        description: r.L4_Description,
        l3Id: r.L3_ID,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

/** 특정 L4 아래 L5 목록 추출 */
export function extractL5ByL4(rows: CsvRow[], l4Id: string): L5Item[] {
  const map = new Map<string, L5Item>();
  for (const r of rows) {
    if (r.L4_ID === l4Id && r.L5_ID && !map.has(r.L5_ID)) {
      map.set(r.L5_ID, buildL5Item(r));
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

/* ── CsvRow 의 actor / system 셀 → variant 별 actors / systems 객체로 변환 ── */

/** CSV 컬럼명 (예: "actor_exec") 으로 row 에서 값 읽기 */
function readCsvCell(r: CsvRow, fieldKey: keyof CsvRow): string {
  const v = r[fieldKey];
  return typeof v === "string" ? v : "";
}

/** variant 별 actor key → CsvRow 의 컬럼명 매핑 */
const ACTOR_KEY_TO_CSV_FIELD: Record<AnyActorKey, keyof CsvRow> = {
  exec: "actor_exec",
  hr: "actor_hr",
  teamlead: "actor_teamlead",
  member: "actor_member",
  qvex_welfare: "actor_qvex_welfare",
  qvex_purchase: "actor_qvex_purchase",
  qvex_payroll: "actor_qvex_payroll",
  qvex_manager: "actor_qvex_manager",
  affiliate_employee: "actor_affiliate_employee",
  affiliate_dept: "actor_affiliate_dept",
  // payroll-7 keys
  qvex_ps: "actor_qvex_ps",
  payroll_teamlead: "actor_payroll_teamlead",
  qvex_bs: "actor_qvex_bs",
  affiliate_hr_er: "actor_affiliate_hr_er",
  affiliate_finance: "actor_affiliate_finance",
  external_partner: "actor_external_partner",
};

/** variant 별 system key → CsvRow 의 컬럼명 매핑 */
const SYSTEM_KEY_TO_CSV_FIELD: Record<AnySystemKey, keyof CsvRow> = {
  hr: "sys_hr",
  groupware: "sys_groupware",
  office: "sys_office",
  external: "sys_external",
  manual: "sys_manual",
  etc: "sys_etc",
  pnbs: "sys_pnbs",
  doobuy: "sys_doobuy",
  portal: "sys_portal",
  eapproval: "sys_eapproval",
  accounting: "sys_accounting",
  ildong: "sys_ildong",
  qvex_manual: "sys_qvex_manual",
  ms_office: "sys_ms_office",
  email_phone: "sys_email_phone",
  pro_tool: "sys_pro_tool",
};

/** actor_other 인코딩 문자열을 { header → value } 맵으로 디코드.
 *  parseCsv 가 "header1::value1\nheader2::value2" 형태로 저장. */
export function decodeActorOther(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split("\n")) {
    const idx = part.indexOf("::");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 2).trim();
    if (k) out[k] = v;
  }
  return out;
}

/** variant 의 actor 키 전체에 대해 CsvRow 에서 값을 읽어 actors 객체 생성.
 *  variant 에 없는 수행주체 컬럼은 actors.other 에 "header1: value1; ..." 로 요약 노출 */
function actorsFromRow(r: CsvRow, variant: CsvVariant): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of VARIANT_CONFIG[variant].actors) {
    out[def.key] = readCsvCell(r, ACTOR_KEY_TO_CSV_FIELD[def.key]);
  }
  const other = readCsvCell(r, "actor_other");
  if (other) {
    const decoded = decodeActorOther(other);
    const summary = Object.entries(decoded)
      .map(([header, value]) => `${header}: ${value}`)
      .join("; ");
    if (summary) out.other = summary;
  }
  return out;
}

/** variant 의 system 키 전체에 대해 CsvRow 에서 값을 읽어 systems 객체 생성 */
function systemsFromRow(r: CsvRow, variant: CsvVariant): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of VARIANT_CONFIG[variant].systems) {
    out[def.key] = readCsvCell(r, SYSTEM_KEY_TO_CSV_FIELD[def.key]);
  }
  return out;
}

/** CsvRow → L5Item (모든 메타데이터 포함, variant 자동 적용) */
function buildL5Item(r: CsvRow): L5Item {
  const variant = r._variant || "doosan-hr-4";
  return {
    id: r.L5_ID,
    name: r.L5_Name,
    description: r.L5_Description,
    l4Id: r.L4_ID,
    l3Id: r.L3_ID,
    l2Id: r.L2_ID,
    l3Name: r.L3_Name,
    l2Name: r["두산 L2"],
    variant,
    actors: actorsFromRow(r, variant),
    mgrBody: r.mgr_body || "",
    staffCount: r.staff_count || "",
    mainPerson: r.main_person || "",
    avgTime: r.avg_time || "",
    freqCount: r.freq_count || "",
    systems: systemsFromRow(r, variant),
    painPoints: { speed: r.pp_speed || "", accuracy: r.pp_accuracy || "", repeat: r.pp_repeat || "", data: r.pp_data || "", system: r.pp_system || "", comm: r.pp_comm || "", etc: r.pp_etc || "" },
    inputs: { system: r.in_system || "", doc: r.in_doc || "", external: r.in_external || "", request: r.in_request || "", etc: r.in_etc || "" },
    outputs: { system: r.out_system || "", doc: r.out_doc || "", comm: r.out_comm || "", decision: r.out_decision || "", etc: r.out_etc || "" },
    logic: { rule: r.logic_rule || "", human: r.logic_human || "", mixed: r.logic_mixed || "" },
  };
}

/** CSV 전체에서 L3 목록을 추출 (하위호환) */
export function extractL3List(
  rows: CsvRow[]
): { id: string; name: string; l2Name: string }[] {
  const map = new Map<string, { name: string; l2Name: string }>();
  for (const r of rows) {
    if (!map.has(r.L3_ID)) {
      map.set(r.L3_ID, { name: r.L3_Name, l2Name: r["두산 L2"] });
    }
  }
  return Array.from(map.entries())
    .map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/* ═══════════════════════════════════════════════
 * 2) 개별 노드를 캔버스에 추가하는 함수
 * ═══════════════════════════════════════════════ */

let dropCounter = 0;

/** 캔버스 중앙 부근에 노드 하나를 생성 (모든 메타데이터 포함) */
export function createNodeFromItem(
  level: "l2" | "l3" | "l4" | "l5",
  item: { id: string; name: string; description?: string; [key: string]: unknown },
  position: { x: number; y: number }
): Node {
  dropCounter++;
  // item에서 id, name, description 외의 모든 키를 메타데이터로 spread
  const { id, name, description, ...rest } = item;
  return {
    id: `${level}-${id}-${dropCounter}`,
    type: level,
    position,
    data: {
      label: name,
      level: level.toUpperCase(),
      id,
      description: description ?? "",
      ...rest,
    },
  };
}

/* ═══════════════════════════════════════════════
 * 3) AI 자동 생성용 — L3 데이터를 요약 텍스트로
 * ═══════════════════════════════════════════════ */

/** 선택된 L3 프로세스의 L4→L5 구조를 텍스트로 요약 (AI 입력용) */
export function summarizeL3ForAI(rows: CsvRow[], l3Id: string): string {
  const l3Rows = rows.filter((r) => r.L3_ID === l3Id);
  if (l3Rows.length === 0) return "";

  const first = l3Rows[0];
  let text = `L2: ${first["두산 L2"]} (${first.L2_ID})\n`;
  text += `L3: ${first.L3_Name} (${first.L3_ID})\n\n`;

  const l4s = extractL4ByL3(rows, l3Id);
  for (const l4 of l4s) {
    text += `  L4: ${l4.name} (${l4.id})`;
    if (l4.description) text += ` — ${l4.description}`;
    text += "\n";

    const l5s = extractL5ByL4(rows, l4.id);
    for (const l5 of l5s) {
      text += `    L5: ${l5.name} (${l5.id})`;
      if (l5.description) text += ` — ${l5.description}`;
      // 수행주체 요약 (variant 별 actor key 순회)
      const variant = l5.variant || "doosan-hr-4";
      const actorParts: string[] = [];
      for (const def of VARIANT_CONFIG[variant].actors) {
        const v = l5.actors?.[def.key];
        if (v && v.trim()) actorParts.push(`${def.laneLabel}: ${v}`);
      }
      if (actorParts.length > 0) text += ` [수행주체: ${actorParts.join(", ")}]`;
      if (l5.mainPerson) text += ` [주담당: ${l5.mainPerson}]`;
      if (l5.avgTime) text += ` [소요시간: ${l5.avgTime}]`;
      text += "\n";
    }
  }
  return text;
}

/* ═══════════════════════════════════════════════
 * 4) 전체 트리 자동 배치 (기존 buildFlowFromL3)
 * ═══════════════════════════════════════════════ */

const COL_GAP = 650;
const ROW_GAP = 200;
const START_X = 100;
const START_Y = 100;

export function buildFlowFromL3(
  rows: CsvRow[],
  selectedL3Id: string
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const l3Rows = rows.filter((r) => r.L3_ID === selectedL3Id);
  if (l3Rows.length === 0) return { nodes, edges };

  const first = l3Rows[0];

  // ── L2 ──
  const l2NodeId = `l2-${first.L2_ID}`;
  nodes.push({
    id: l2NodeId,
    type: "l2",
    position: { x: START_X, y: START_Y },
    data: { label: first["두산 L2"], level: "L2", id: first.L2_ID },
  });

  // ── L3 ──
  const l3NodeId = `l3-${first.L3_ID}`;
  nodes.push({
    id: l3NodeId,
    type: "l3",
    position: { x: START_X + COL_GAP, y: START_Y },
    data: { label: first.L3_Name, level: "L3", id: first.L3_ID },
  });
  edges.push({
    id: `e-${l2NodeId}-${l3NodeId}`,
    source: l2NodeId,
    target: l3NodeId,
    type: "ortho",
    animated: false,
    style: { stroke: "#333333", strokeWidth: 2.5 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: "#333333",
    },
  });

  // ── L4들 ──
  const l4Map = new Map<string, { name: string; desc: string }>();
  for (const r of l3Rows) {
    if (r.L4_ID && !l4Map.has(r.L4_ID)) {
      l4Map.set(r.L4_ID, { name: r.L4_Name, desc: r.L4_Description });
    }
  }

  let l4Y = START_Y;
  const l4Ids: string[] = [];
  for (const [l4Id, info] of Array.from(l4Map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  )) {
    const nodeId = `l4-${l4Id}`;
    l4Ids.push(nodeId);
    nodes.push({
      id: nodeId,
      type: "l4",
      position: { x: START_X + COL_GAP * 2, y: l4Y },
      data: { label: info.name, level: "L4", id: l4Id, description: info.desc },
    });
    edges.push({
      id: `e-${l3NodeId}-${nodeId}`,
      source: l3NodeId,
      target: nodeId,
      type: "ortho",
      animated: false,
      style: { stroke: "#333333", strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: "#333333",
      },
    });
    l4Y += ROW_GAP;
  }

  // ── L5들 ──
  const l5ByL4 = new Map<string, CsvRow[]>();
  for (const r of l3Rows) {
    if (!r.L5_ID) continue;
    const arr = l5ByL4.get(r.L4_ID) ?? [];
    arr.push(r);
    l5ByL4.set(r.L4_ID, arr);
  }

  for (const [l4Id, l5Rows] of l5ByL4.entries()) {
    const parentNodeId = `l4-${l4Id}`;
    const parentNode = nodes.find((n) => n.id === parentNodeId);
    if (!parentNode) continue;

    const baseY = parentNode.position.y;
    const seen = new Set<string>();
    let l5Index = 0;
    for (const r of l5Rows) {
      if (seen.has(r.L5_ID)) continue;
      seen.add(r.L5_ID);

      const l5NodeId = `l5-${r.L5_ID}`;
      const l5Item = buildL5Item(r);
      nodes.push({
        id: l5NodeId,
        type: "l5",
        position: { x: START_X + COL_GAP * 3, y: baseY + l5Index * 170 },
        data: {
          label: r.L5_Name,
          level: "L5",
          id: r.L5_ID,
          description: r.L5_Description,
          /* parent info for hierarchy export */
          l4Id: r.L4_ID,
          l4Name: l4Map.get(r.L4_ID)?.name || "",
          l3Id: first.L3_ID,
          l3Name: first.L3_Name,
          l2Id: first.L2_ID,
          l2Name: first["두산 L2"],
          /* variant — LevelNode 시스템 바 / export 가 노드 자체에서 variant 알 수 있게 */
          variant: l5Item.variant,
          /* extended L5 metadata */
          actors: l5Item.actors,
          mgrBody: l5Item.mgrBody,
          staffCount: l5Item.staffCount,
          mainPerson: l5Item.mainPerson,
          avgTime: l5Item.avgTime,
          freqCount: l5Item.freqCount,
          systems: l5Item.systems,
          painPoints: l5Item.painPoints,
          inputs: l5Item.inputs,
          outputs: l5Item.outputs,
          logic: l5Item.logic,
        },
      });
      edges.push({
        id: `e-${parentNodeId}-${l5NodeId}`,
        source: parentNodeId,
        target: l5NodeId,
        type: "ortho",
        animated: false,
        style: { stroke: "#333333", strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: "#333333",
        },
      });
      l5Index++;
    }
  }

  // Y 중앙 정렬
  if (l4Ids.length > 0) {
    const firstL4 = nodes.find((n) => n.id === l4Ids[0]);
    const lastL4 = nodes.find((n) => n.id === l4Ids[l4Ids.length - 1]);
    if (firstL4 && lastL4) {
      const midY = (firstL4.position.y + lastL4.position.y) / 2;
      const l3Node = nodes.find((n) => n.id === l3NodeId);
      if (l3Node) l3Node.position.y = midY;
      const l2Node = nodes.find((n) => n.id === l2NodeId);
      if (l2Node) l2Node.position.y = midY;
    }
  }

  return { nodes, edges };
}

/* ═══════════════════════════════════════════════
 * 4-b) SwimLane 자동 배치 — 수행주체 기반
 *
 * variant 별 레인 순서:
 *   doosan-hr-4    : 임원(0) → HR 담당자(1) → 팀장(2) → 구성원(3) — DOOSAN_HR_ACTORS 순서
 *      ※ 단, 4분할 시트 (현업 임원 / 팀장 / HR 담당자 / 구성원) 와 6분할 (현업 임원 / 현업 팀장 / HR 임원 / HR 담당자 / 현업 구성원 / 그 외) 같은
 *        커스텀 lanes 가 들어오는 경우는 별도 라벨 매핑(determineLaneLegacy) 으로 처리.
 *   qvex-welfare-5 / qvex-affairs-6 : QVEX_AFFAIRS_ACTORS 순서대로 lane 0~5 (공통)
 *   qvex-payroll-7 : QVEX_PAYROLL_ACTORS 순서대로 lane 0~6
 *
 * 수행주체 열이 비어있지 않으면 해당 레인, 여러 레인에 해당하면 정의 순서상 첫 매칭.
 * 모두 비어있으면 기본 레인(HR 또는 마지막 레인).
 * ═══════════════════════════════════════════════ */

const SWIM_LANE_HEIGHT = 2400;

/** 두산 HR 4레인 (커스텀 라벨 lanes 가 없는 기본 시트) */
function determineLaneDoosan4(r: CsvRow): number {
  if (r.actor_exec && r.actor_exec.trim()) return 0;
  if (r.actor_teamlead && r.actor_teamlead.trim()) return 1;
  if (r.actor_hr && r.actor_hr.trim()) return 2;
  if (r.actor_member && r.actor_member.trim()) return 3;
  return 2; // 기본: HR 담당자
}

/** 두산 HR 6레인 (현업 임원 / 현업 팀장 / HR 임원 / HR 담당자 / 현업 구성원 / 그 외) */
function determineLaneDoosan6(r: CsvRow): number {
  if (r.actor_exec && r.actor_exec.trim()) return 0;
  if (r.actor_teamlead && r.actor_teamlead.trim()) return 1;
  if (r.actor_hr && r.actor_hr.trim()) return 3;
  if (r.actor_member && r.actor_member.trim()) return 4;
  return 5; // 기본: 그 외
}

/** variant 의 actor 순서로 lane 결정.
 *  알려진 actor 가 모두 비어있으면 actor 뒤에 추가된 "그 외" 레인(index = defs.length)으로 폴백.
 *  (큐벡스 변형은 defaultLanes 가 [actors..., "그 외"] 구조이므로 defs.length 가 유효 인덱스) */
function determineLaneByVariant(r: CsvRow, variant: CsvVariant): number {
  const defs = VARIANT_CONFIG[variant].actors;
  for (let i = 0; i < defs.length; i++) {
    const v = readCsvCell(r, ACTOR_KEY_TO_CSV_FIELD[defs[i].key]);
    if (v && v.trim()) return i;
  }
  // 알려진 actor 없음 (actor_other 포함) → "그 외" 레인
  return defs.length;
}

/** SwimLane에 맞춰 L5 노드를 배치하는 빌더
 *
 * 레인 매핑 우선순위:
 *   1) row 의 _variant 가 qvex-* 이면 → variant 의 actor 순서대로 매핑
 *   2) lanes 배열 길이로 추정 (4 = doosan-hr-4, 6 = doosan-hr-6 레인 라벨)
 *   3) 폴백: doosan-hr-4
 */
export function buildSwimLaneFlowFromL3(
  rows: CsvRow[],
  selectedL3Id: string,
  lanes?: string[],
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const laneCount = lanes?.length ?? 4;
  const SWIM_LANE_H = SWIM_LANE_HEIGHT / laneCount;

  /* row 단위로 lane 결정 (variant 우선, fallback = laneCount 기반) */
  const determineLane = (r: CsvRow): number => {
    const v = r._variant || "doosan-hr-4";
    if (v === "qvex-welfare-5" || v === "qvex-affairs-6" || v === "qvex-payroll-7") {
      return determineLaneByVariant(r, v);
    }
    // doosan-hr-4: 화면 lane 수에 따라 4분할/6분할 라벨 매핑
    return laneCount <= 4 ? determineLaneDoosan4(r) : determineLaneDoosan6(r);
  };

  /* L4 노드를 배치할 기본 레인 — 변형별 차이를 흡수 */
  const sampleVariant = rows.find((r) => r.L3_ID === selectedL3Id)?._variant || "doosan-hr-4";
  const defaultL4Lane = (() => {
    if (sampleVariant === "qvex-welfare-5" || sampleVariant === "qvex-affairs-6" || sampleVariant === "qvex-payroll-7") {
      // 큐벡스 변형: 첫 번째 lane 아래에 L4 배치
      return 0;
    }
    return laneCount <= 4 ? 2 : 3; // doosan: HR 담당자 레인
  })();

  const l3Rows = rows.filter((r) => r.L3_ID === selectedL3Id);
  if (l3Rows.length === 0) return { nodes, edges };
  const first = l3Rows[0];

  // 수집: L4→L5 데이터 + 레인 정보
  const l4Map = new Map<string, { name: string; desc: string }>();
  const l5ByL4 = new Map<string, CsvRow[]>();
  for (const r of l3Rows) {
    if (r.L4_ID && !l4Map.has(r.L4_ID)) {
      l4Map.set(r.L4_ID, { name: r.L4_Name, desc: r.L4_Description });
    }
    if (r.L5_ID) {
      const arr = l5ByL4.get(r.L4_ID) ?? [];
      arr.push(r);
      l5ByL4.set(r.L4_ID, arr);
    }
  }

  // L4별로 L5를 수평 배치, 각 L5는 자신의 레인(Y좌표)에 배치
  // ※ PPT 슬라이드(13.33"×7.5") 콘텐츠 영역에 맞춘 간격
  // PPT 콘텐츠 영역 너비 = 10.83" × 390.9 px/in ≈ 4233 canvas px
  const L4_COL_WIDTH = 560;       // L4 그룹 간 X 간격
  const NODE_X_GAP = 520;         // 같은 레인 내 L5 간 X 간격
  const L4_START_X = 490;         // PPT PAD_X(1.25") × 390.9 ≈ 489
  const LANE_PAD_TOP = 60;        // 레인 상단 여백
  const L4_NODE_HEIGHT = 220;     // L4 노드 실제 렌더 높이 근사값
  const L5_LANE_OFFSET = 80;      // L5의 레인 내 추가 오프셋 (비-L4 레인)

  // 레인별 다음 X 위치 추적
  const laneNextX: number[] = Array(laneCount).fill(L4_START_X);

  const l4Entries = Array.from(l4Map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true })
  );

  let l4ColX = L4_START_X;

  for (const [l4Id, l4Info] of l4Entries) {
    // L4 노드 — HR 담당자 레인에 기본 배치
    const l4NodeId = `l4-${l4Id}`;
    const l4Y = defaultL4Lane * SWIM_LANE_H + LANE_PAD_TOP;
    nodes.push({
      id: l4NodeId,
      type: "l4",
      position: { x: l4ColX, y: l4Y },
      data: { label: l4Info.name, level: "L4", id: l4Id, description: l4Info.desc },
    });

    // L5 노드들
    const l5Rows = l5ByL4.get(l4Id) ?? [];
    const seen = new Set<string>();
    for (const r of l5Rows) {
      if (seen.has(r.L5_ID)) continue;
      seen.add(r.L5_ID);

      const lane = determineLane(r);
      // HR 담당자 레인은 L4 아래에 배치, 나머지는 레인 상단 기준
      const laneY = lane === defaultL4Lane
        ? defaultL4Lane * SWIM_LANE_H + LANE_PAD_TOP + L4_NODE_HEIGHT + 40
        : lane * SWIM_LANE_H + LANE_PAD_TOP + L5_LANE_OFFSET;
      const x = Math.max(laneNextX[lane], l4ColX);

      const l5NodeId = `l5-${r.L5_ID}`;
      const l5Item = buildL5Item(r);
      nodes.push({
        id: l5NodeId,
        type: "l5",
        position: { x, y: laneY },
        data: {
          label: r.L5_Name,
          level: "L5",
          id: r.L5_ID,
          description: r.L5_Description,
          l4Id: r.L4_ID,
          l4Name: l4Map.get(r.L4_ID)?.name || "",
          l3Id: first.L3_ID,
          l3Name: first.L3_Name,
          l2Id: first.L2_ID,
          l2Name: first["두산 L2"],
          /* variant — LevelNode 시스템 바 / export 가 노드 자체에서 variant 알 수 있게 */
          variant: l5Item.variant,
          actors: l5Item.actors,
          mgrBody: l5Item.mgrBody,
          staffCount: l5Item.staffCount,
          mainPerson: l5Item.mainPerson,
          avgTime: l5Item.avgTime,
          freqCount: l5Item.freqCount,
          systems: l5Item.systems,
          painPoints: l5Item.painPoints,
          inputs: l5Item.inputs,
          outputs: l5Item.outputs,
          logic: l5Item.logic,
        },
      });
      edges.push({
        id: `e-${l4NodeId}-${l5NodeId}`,
        source: l4NodeId,
        target: l5NodeId,
        type: "ortho",
        animated: false,
        style: { stroke: "#333333", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#333333" },
      });

      laneNextX[lane] = x + NODE_X_GAP;
    }
    l4ColX += L4_COL_WIDTH;
  }

  // L3 노드 (좌상단)
  const l3NodeId = `l3-${first.L3_ID}`;
  nodes.push({
    id: l3NodeId,
    type: "l3",
    position: { x: 20, y: 20 },
    data: { label: first.L3_Name, level: "L3", id: first.L3_ID },
  });

  // L3 → L4 연결
  for (const [l4Id] of l4Entries) {
    const l4NodeId = `l4-${l4Id}`;
    edges.push({
      id: `e-${l3NodeId}-${l4NodeId}`,
      source: l3NodeId,
      target: l4NodeId,
      type: "ortho",
      animated: false,
      style: { stroke: "#333333", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#333333" },
    });
  }

  return { nodes, edges };
}

/**
 * CSV 텍스트를 파싱하여 CsvRow[]로 변환
 * 
 * 헤더 순서 기반 매핑 (인덱스 0~9):
 *   0: L2_ID, 1: 두산 L2, 2: L3_ID, 3: L3_Name,
 *   4: L4_ID, 5: L4_Name, 6: L4_Description,
 *   7: L5_ID, 8: L5_Name, 9: L5_Description
 */
const HIERARCHY_KEYS: (keyof CsvRow)[] = [
  "L2_ID", "두산 L2", "L3_ID", "L3_Name",
  "L4_ID", "L4_Name", "L4_Description",
  "L5_ID", "L5_Name", "L5_Description",
];

const COMMON_META_KEYS: (keyof CsvRow)[] = [
  "mgr_body", "staff_count", "main_person", "avg_time", "freq_count",
];
const COMMON_PP_KEYS: (keyof CsvRow)[] = [
  "pp_speed", "pp_accuracy", "pp_repeat", "pp_data", "pp_system", "pp_comm", "pp_etc",
];
const COMMON_INPUT_KEYS: (keyof CsvRow)[] = [
  "in_system", "in_doc", "in_external", "in_request", "in_etc",
];
const COMMON_OUTPUT_KEYS: (keyof CsvRow)[] = [
  "out_system", "out_doc", "out_comm", "out_decision", "out_etc",
];
const COMMON_LOGIC_KEYS: (keyof CsvRow)[] = [
  "logic_rule", "logic_human", "logic_mixed",
];

/** 컬럼 인덱스 → CsvRow 필드 매핑.
 *  kind="field"  : 일반 필드에 값 저장
 *  kind="other"  : variant 에 없는 수행주체_* 컬럼 → actor_other 에 누적
 *  null           : 인식되지 않은 컬럼 (값 무시) */
type ColumnMapping =
  | { kind: "field"; field: keyof CsvRow; header: string }
  | { kind: "other"; header: string }
  | null;

interface KnownHeaderEntry {
  norm: string;
  tokens: string[];
  field: keyof CsvRow;
  source: "actor" | "system" | "meta" | "pp" | "input" | "output" | "logic";
  csvHeader: string;
}

/** variant 별로 매칭 가능한 알려진 헤더 목록 — actors + systems + 공통 meta/PP/IO/logic */
function collectKnownHeaders(variant: CsvVariant): KnownHeaderEntry[] {
  const cfg = VARIANT_CONFIG[variant];
  const entries: KnownHeaderEntry[] = [];

  for (const a of cfg.actors) {
    entries.push({
      norm: normalizeHeader(a.csvHeader),
      tokens: (a.matchTokens || []).map(normalizeHeader).filter((t) => t.length > 0),
      field: ACTOR_KEY_TO_CSV_FIELD[a.key],
      source: "actor",
      csvHeader: a.csvHeader,
    });
  }
  for (const s of cfg.systems) {
    entries.push({
      norm: normalizeHeader(s.csvHeader),
      tokens: (s.matchTokens || []).map(normalizeHeader).filter((t) => t.length > 0),
      field: SYSTEM_KEY_TO_CSV_FIELD[s.key],
      source: "system",
      csvHeader: s.csvHeader,
    });
  }
  const pushCommon = (
    headers: readonly string[],
    keys: readonly (keyof CsvRow)[],
    source: KnownHeaderEntry["source"],
  ) => {
    for (let i = 0; i < headers.length; i++) {
      entries.push({
        norm: normalizeHeader(headers[i]),
        tokens: [],
        field: keys[i],
        source,
        csvHeader: headers[i],
      });
    }
  };
  pushCommon(COMMON_META_HEADERS, COMMON_META_KEYS, "meta");
  pushCommon(COMMON_PP_HEADERS, COMMON_PP_KEYS, "pp");
  pushCommon(COMMON_INPUT_HEADERS, COMMON_INPUT_KEYS, "input");
  pushCommon(COMMON_OUTPUT_HEADERS, COMMON_OUTPUT_KEYS, "output");
  pushCommon(COMMON_LOGIC_HEADERS, COMMON_LOGIC_KEYS, "logic");
  return entries;
}

/** 헤더 셀 배열 → 컬럼별 매핑 배열 생성.
 *  처음 10개는 hierarchy 위치 기반 (ID/Name 처럼 헤더가 중복되기 때문),
 *  이후는 헤더 텍스트 기반 매칭 (정규화 후 exact → tokens fallback). */
function buildColumnFieldMap(
  headerCells: string[],
  variant: CsvVariant,
): { mappings: ColumnMapping[]; matched: Set<keyof CsvRow>; unknown: string[] } {
  const known = collectKnownHeaders(variant);
  const mappings: ColumnMapping[] = new Array(headerCells.length).fill(null);
  const matched = new Set<keyof CsvRow>();
  const unknown: string[] = [];
  const usedField = new Set<keyof CsvRow>();

  // 1) Hierarchy: 처음 10개는 위치 기반 (보통 헤더가 "ID"/"Name" 처럼 중복됨)
  for (let i = 0; i < Math.min(10, headerCells.length); i++) {
    const f = HIERARCHY_KEYS[i];
    mappings[i] = { kind: "field", field: f, header: headerCells[i] || "" };
    matched.add(f);
    usedField.add(f);
  }

  // 2) 인덱스 10부터는 헤더 텍스트로 매칭
  for (let i = 10; i < headerCells.length; i++) {
    const h = headerCells[i] || "";
    if (!h) continue;
    const normH = normalizeHeader(h);
    if (!normH) continue;

    // 2-a) Exact normalized match (이미 사용된 필드는 제외)
    let entry = known.find((e) => e.norm === normH && !usedField.has(e.field));
    // 2-b) Token-based fuzzy match (토큰 전부 substring 포함 + 미사용)
    if (!entry) {
      entry = known.find(
        (e) =>
          e.tokens.length > 0 &&
          e.tokens.every((t) => normH.includes(t)) &&
          !usedField.has(e.field),
      );
    }

    if (entry) {
      mappings[i] = { kind: "field", field: entry.field, header: h };
      matched.add(entry.field);
      usedField.add(entry.field);
    } else if (h.startsWith("수행주체")) {
      // variant 에 없는 수행주체 컬럼 → 그 외(other) 로 흡수 (위치 밀림 방지)
      mappings[i] = { kind: "other", header: h };
    } else {
      mappings[i] = null;
      unknown.push(h);
    }
  }

  return { mappings, matched, unknown };
}

/** CsvRow 의 모든 string 필드 키 — 미초기화 필드를 빈 문자열로 채울 때 사용 */
const ALL_CSV_ROW_STRING_KEYS: (keyof CsvRow)[] = [
  ...HIERARCHY_KEYS,
  ...(Object.values(ACTOR_KEY_TO_CSV_FIELD) as (keyof CsvRow)[]),
  "actor_other",
  ...COMMON_META_KEYS,
  ...(Object.values(SYSTEM_KEY_TO_CSV_FIELD) as (keyof CsvRow)[]),
  ...COMMON_PP_KEYS,
  ...COMMON_INPUT_KEYS,
  ...COMMON_OUTPUT_KEYS,
  ...COMMON_LOGIC_KEYS,
];

/** variant 별 CsvRow 필드 순서 — buildMergedRows() 가 내보내는 컬럼 순서와 동일.
 *  [계층 10] + [actor] + [meta 5] + [system] + [PP 7] + [Input 5] + [Output 5] + [로직 3] */
export function orderedCsvFieldKeys(variant: CsvVariant): (keyof CsvRow)[] {
  const cfg = VARIANT_CONFIG[variant];
  return [
    ...HIERARCHY_KEYS,
    ...cfg.actors.map((a) => ACTOR_KEY_TO_CSV_FIELD[a.key]),
    ...COMMON_META_KEYS,
    ...cfg.systems.map((s) => SYSTEM_KEY_TO_CSV_FIELD[s.key]),
    ...COMMON_PP_KEYS,
    ...COMMON_INPUT_KEYS,
    ...COMMON_OUTPUT_KEYS,
    ...COMMON_LOGIC_KEYS,
  ];
}

/** ● 도팅(복수 선택) 컬럼 필드 집합 — 엑셀 내보내기 시 값 유무를 "●" 로 기록.
 *  수행주체 + 사용 시스템 + Pain Point + 업무 판단 로직 (Input/Output/메타는 텍스트) */
export const CSV_DOTTING_FIELDS: Set<string> = new Set<string>([
  ...(Object.values(ACTOR_KEY_TO_CSV_FIELD) as string[]),
  "actor_other",
  ...(Object.values(SYSTEM_KEY_TO_CSV_FIELD) as string[]),
  ...(COMMON_PP_KEYS as string[]),
  ...(COMMON_LOGIC_KEYS as string[]),
]);

/** 헤더 배열 → 컬럼별 CsvRow 필드명 해석 (엑셀 내보내기 시 엑셀 컬럼 ↔ 필드 정렬용).
 *  반환: 컬럼별 field 문자열 | "__other__"(그 외 수행주체) | null(무시) */
export function resolveColumnFields(headerCells: string[], variant: CsvVariant): (string | null)[] {
  const { mappings } = buildColumnFieldMap(
    headerCells.map((s) => (s ?? "").trim()),
    variant,
  );
  return mappings.map((m) => (m == null ? null : m.kind === "field" ? (m.field as string) : "__other__"));
}

/** 헤더 배열 + 데이터 행렬(값 2차원 배열) → CsvRow[].
 *  CSV 파싱(parseCsv)과 엑셀 파싱(xlsxToFlow)이 공유하는 핵심 매핑 로직.
 *  variant 자동 감지 → 헤더 이름 기반 컬럼 매핑 → 행별 값 채우기 + actor_other 흡수. */
export function buildCsvRowsFromMatrix(
  headerCells: string[],
  dataRows: string[][],
  srcLabel = "parseCsv",
): CsvRow[] {
  const trimmedHeader = headerCells.map((s) => (s ?? "").trim());
  const variant = detectCsvVariant(trimmedHeader);
  const { mappings, matched, unknown } = buildColumnFieldMap(trimmedHeader, variant);

  // 진단 로그 — 콘솔에 매칭 결과 표시 (헤더 mismatch 즉시 확인 가능)
  if (typeof console !== "undefined") {
    const knownAll = collectKnownHeaders(variant);
    const missing = knownAll
      .filter((e) => !matched.has(e.field))
      .map((e) => `${e.csvHeader} (${e.source})`);
    const otherActors = mappings
      .filter((m): m is { kind: "other"; header: string } => m?.kind === "other")
      .map((m) => m.header);
    console.info(
      `[${srcLabel}] variant=${variant} · columns=${trimmedHeader.length} · ` +
        `matched=${matched.size} · unknown=${unknown.length} · ` +
        `otherActors=${otherActors.length} · missing=${missing.length}`,
    );
    if (otherActors.length > 0) {
      console.info(`[${srcLabel}] 그 외 수행주체 컬럼 (actor_other 로 흡수):`, otherActors);
    }
    if (unknown.length > 0) {
      console.info(`[${srcLabel}] 인식 못한 컬럼 (값 무시):`, unknown);
    }
    if (missing.length > 0) {
      console.info(`[${srcLabel}] 데이터에 없는 variant 기본 컬럼 (빈값):`, missing);
    }
  }

  const rows: CsvRow[] = [];
  for (const values of dataRows) {
    /* 모든 가능한 CsvRow 컬럼을 빈 문자열로 초기화 */
    const row: Record<string, string> = {};
    for (const k of ALL_CSV_ROW_STRING_KEYS) {
      row[k as string] = "";
    }

    /* 매핑에 따라 값 채우기 — 위치가 아닌 헤더 이름 기반 */
    const otherParts: string[] = [];
    const len = Math.min(values.length, mappings.length);
    for (let h = 0; h < len; h++) {
      const mapping = mappings[h];
      if (!mapping) continue;
      const value = (values[h] ?? "").trim();
      if (mapping.kind === "field") {
        row[mapping.field as string] = value;
      } else if (mapping.kind === "other" && value) {
        otherParts.push(`${mapping.header}::${value}`);
      }
    }
    if (otherParts.length > 0) {
      row["actor_other"] = otherParts.join("\n");
    }

    /* variant 디스크리미네이터 */
    (row as unknown as CsvRow)._variant = variant;
    rows.push(row as unknown as CsvRow);
  }

  return rows;
}

export function parseCsv(text: string): CsvRow[] {
  // BOM 제거 + 줄바꿈 통일 (\r\n, \r → \n) + 보이지 않는 문자 제거
  const clean = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = clean.split("\n");
  if (lines.length < 2) return [];

  const headerCells = parseCSVLine(lines[0]).map((s) => s.trim());

  // Multi-line CSV 처리 → 데이터 행렬 수집
  const dataRows: string[][] = [];
  let i = 1;
  while (i < lines.length) {
    let line = lines[i];
    // 따옴표가 열려있으면 다음 줄과 합침
    while (countQuotes(line) % 2 !== 0 && i + 1 < lines.length) {
      i++;
      line += "\n" + lines[i];
    }
    i++;
    if (line.trim() === "") continue;
    dataRows.push(parseCSVLine(line));
  }

  return buildCsvRowsFromMatrix(headerCells, dataRows, "parseCsv");
}

function countQuotes(s: string): number {
  let count = 0;
  for (const c of s) if (c === '"') count++;
  return count;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

/* ═══════════════════════════════════════════════
 * 캔버스 노드 → 원본 템플릿 (variant별 컬럼) CSV 문자열 생성
 * ═══════════════════════════════════════════════ */

function nd(n: Node): Record<string, unknown> {
  return (n.data || {}) as Record<string, unknown>;
}

/** csvRows / nodes 로부터 export 시 사용할 variant 추정 (없으면 doosan-hr-4) */
function inferExportVariant(csvRows?: CsvRow[], nodes?: Node[]): CsvVariant {
  const fromRows = csvRows && csvRows.length > 0 ? csvRows[0]._variant : undefined;
  if (fromRows) return fromRows;
  if (nodes) {
    for (const n of nodes) {
      const v = (nd(n).variant as CsvVariant | undefined);
      if (v) return v;
    }
  }
  return "doosan-hr-4";
}

/** variant 별 컬럼 순서대로 actor 값 배열 생성 */
function actorColumnsByVariant(variant: CsvVariant, actors?: Record<string, string>): string[] {
  return VARIANT_CONFIG[variant].actors.map((a) => actors?.[a.key] || "");
}

/** variant 별 컬럼 순서대로 system 값 배열 생성 */
function systemColumnsByVariant(variant: CsvVariant, systems?: Record<string, string>): string[] {
  return VARIANT_CONFIG[variant].systems.map((s) => systems?.[s.key] || "");
}

/** roleStr (콤마 구분 라벨) → variant 별 actor 컬럼 값 배열.
 *  라벨이 매칭되면 기존 actors 값(있으면) 또는 "O" 로 채움. */
function actorColumnsFromRole(
  variant: CsvVariant,
  roleStr: string,
  actors?: Record<string, string>,
): string[] {
  const parts = roleStr.split(",").map((s) => s.trim());
  return VARIANT_CONFIG[variant].actors.map((a) => {
    if (parts.includes(a.roleLabel)) {
      return actors?.[a.key] || "O";
    }
    return "";
  });
}

/** CsvRow → variant 컬럼 순서대로 string[] 데이터 행 (헤더 제외) */
function originalRowAsCsvCols(r: CsvRow): string[] {
  const variant = r._variant || "doosan-hr-4";
  const actorCols = VARIANT_CONFIG[variant].actors.map(
    (a) => readCsvCell(r, ACTOR_KEY_TO_CSV_FIELD[a.key]),
  );
  const systemCols = VARIANT_CONFIG[variant].systems.map(
    (s) => readCsvCell(r, SYSTEM_KEY_TO_CSV_FIELD[s.key]),
  );
  return [
    r.L2_ID, r["두산 L2"], r.L3_ID, r.L3_Name, r.L4_ID, r.L4_Name, r.L4_Description,
    r.L5_ID, r.L5_Name, r.L5_Description,
    ...actorCols,
    r.mgr_body, r.staff_count, r.main_person, r.avg_time, r.freq_count,
    ...systemCols,
    r.pp_speed, r.pp_accuracy, r.pp_repeat, r.pp_data, r.pp_system, r.pp_comm, r.pp_etc,
    r.in_system, r.in_doc, r.in_external, r.in_request, r.in_etc,
    r.out_system, r.out_doc, r.out_comm, r.out_decision, r.out_etc,
    r.logic_rule, r.logic_human, r.logic_mixed,
  ];
}

/**
 * 캔버스 노드 배열을 원본 템플릿 CSV 문자열로 변환 (variant 별 컬럼 수 다름).
 * 계층 관계는 (1) 노드에 저장된 명시적 부모 참조(l4Id, l3Id, l2Id)와
 * (2) ID 접두어(예: "1.1.1" → 부모 "1.1")를 함께 활용하여 복원합니다.
 */
export function buildTemplateCsvString(nodes: Node[], csvRows?: CsvRow[]): string {
  const variant = inferExportVariant(csvRows, nodes);
  const headers = templateHeadersForVariant(variant);
  const totalCols = headers.length;
  const cfg = VARIANT_CONFIG[variant];
  /* ── CSV rows lookup (L4_ID → CsvRow) for parent hierarchy fallback ── */
  const csvByL4 = new Map<string, CsvRow>();
  if (csvRows) {
    for (const r of csvRows) {
      if (r.L4_ID && !csvByL4.has(r.L4_ID)) csvByL4.set(r.L4_ID, r);
    }
  }

  /* ── 레벨별 displayId → Node 맵 ── */
  const byLevel: Record<string, Map<string, Node>> = {
    L2: new Map(), L3: new Map(), L4: new Map(), L5: new Map(),
  };
  for (const n of nodes) {
    const d = nd(n);
    const level = ((d.level as string) || "").toUpperCase();
    const displayId = (d.id as string) || "";
    if (level && displayId && byLevel[level]) {
      byLevel[level].set(displayId, n);
    }
  }

  /* ── 부모 노드 탐색 (명시적 참조 → ID 접두어 폴백) ── */
  const findParent = (
    childDisplayId: string,
    parentLevel: string,
    explicitParentId?: string
  ): Node | undefined => {
    const map = byLevel[parentLevel];
    if (!map) return undefined;
    // 1) 명시적 참조
    if (explicitParentId) {
      const found = map.get(explicitParentId);
      if (found) return found;
    }
    // 2) ID 접두어 (마지막 세그먼트 제거)
    const parts = childDisplayId.split(".");
    parts.pop();
    const prefixId = parts.join(".");
    if (prefixId) return map.get(prefixId);
    return undefined;
  };

  /* ── CSV 이스케이프 ── */
  const esc = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  /* ── L5 → 부모 체인을 통한 행 생성 ── */
  const dataRows: string[][] = [];
  const coveredL4 = new Set<string>();
  const coveredL3 = new Set<string>();
  const coveredL2 = new Set<string>();

  const l5Sorted = Array.from(byLevel.L5.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  for (const [l5Id, l5Node] of l5Sorted) {
    const d5 = nd(l5Node);

    /* ── L4 parent ── */
    const l4Node = findParent(l5Id, "L4", d5.l4Id as string);
    const l4Id = l4Node ? (nd(l4Node).id as string) || "" : (d5.l4Id as string) || "";
    let l4Label = l4Node ? (nd(l4Node).label as string) || "" : (d5.l4Name as string) || "";
    let l4Desc = l4Node ? (nd(l4Node).description as string) || "" : "";

    /* ── L3 parent ── */
    const l3Node = l4Id ? findParent(l4Id, "L3", (d5.l3Id as string)) : undefined;
    let l3Id = l3Node ? (nd(l3Node).id as string) || "" : (d5.l3Id as string) || "";
    let l3Label = l3Node ? (nd(l3Node).label as string) || "" : (d5.l3Name as string) || "";

    /* ── L2 parent ── */
    const l2Node = l3Id ? findParent(l3Id, "L2", (d5.l2Id as string)) : undefined;
    let l2Id = l2Node ? (nd(l2Node).id as string) || "" : (d5.l2Id as string) || "";
    let l2Label = l2Node ? (nd(l2Node).label as string) || "" : (d5.l2Name as string) || "";

    /* ── CSV fallback (l4Id 기반 부모 계층 복원) ── */
    if (l4Id && (!l3Id || !l2Id)) {
      const csvFallback = csvByL4.get(l4Id);
      if (csvFallback) {
        if (!l3Id) { l3Id = csvFallback.L3_ID; l3Label = l3Label || csvFallback.L3_Name; }
        if (!l2Id) { l2Id = csvFallback.L2_ID; l2Label = l2Label || csvFallback["두산 L2"]; }
        if (!l4Label) { l4Label = csvFallback.L4_Name; }
        if (!l4Desc) l4Desc = csvFallback.L4_Description;
      }
    }

    if (l4Id) coveredL4.add(l4Id);
    if (l3Id) coveredL3.add(l3Id);
    if (l2Id) coveredL2.add(l2Id);

    const actors = d5.actors as Record<string, string> | undefined;
    const systems = d5.systems as Record<string, string> | undefined;
    const pp = d5.painPoints as Record<string, string> | undefined;
    const inp = d5.inputs as Record<string, string> | undefined;
    const out = d5.outputs as Record<string, string> | undefined;
    const logic = d5.logic as Record<string, string> | undefined;

    const d4 = l4Node ? nd(l4Node) : {};
    const d3 = l3Node ? nd(l3Node) : {};
    const d2 = l2Node ? nd(l2Node) : {};

    /* variant 별 actor / system 컬럼 — 노드의 variant 가 있으면 우선 사용 */
    const rowVariant = ((d5.variant as CsvVariant | undefined) || variant);
    const actorCols = actorColumnsByVariant(rowVariant, actors);
    const systemCols = systemColumnsByVariant(rowVariant, systems);

    dataRows.push([
      /* 0-1  L2 */ l2Id, l2Label || (d2.label as string) || "",
      /* 2-3  L3 */ l3Id, l3Label || (d3.label as string) || "",
      /* 4-6  L4 */ l4Id, l4Label || (d4.label as string) || "", l4Desc || (d4.description as string) || "",
      /* 7-9  L5 */ l5Id, (d5.label as string) || "", (d5.description as string) || "",
      /* 수행주체 (variant 별) */ ...actorCols,
      /* 관리주체/담당자수/주담당자/소요시간/빈도 */
      (d5.mgrBody as string) || "",
      (d5.staffCount as string) || "",
      (d5.mainPerson as string) || "",
      (d5.avgTime as string) || "",
      (d5.freqCount as string) || "",
      /* 사용 시스템 (variant 별) */ ...systemCols,
      /* PP */     pp?.speed || "", pp?.accuracy || "", pp?.repeat || "", pp?.data || "", pp?.system || "", pp?.comm || "", pp?.etc || "",
      /* Input */  inp?.system || "", inp?.doc || "", inp?.external || "", inp?.request || "", inp?.etc || "",
      /* Output */ out?.system || "", out?.doc || "", out?.comm || "", out?.decision || "", out?.etc || "",
      /* Logic */  logic?.rule || "", logic?.human || "", logic?.mixed || "",
    ]);
  }

  /* ── L4 without L5 children ── */
  for (const [l4Id, l4Node] of Array.from(byLevel.L4.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (coveredL4.has(l4Id)) continue;
    const d4 = nd(l4Node);
    const l3Node = findParent(l4Id, "L3", d4.l3Id as string);
    const d3 = l3Node ? nd(l3Node) : {};
    const l3Id = l3Node ? (nd(l3Node).id as string) || "" : "";
    const l2Node = l3Id ? findParent(l3Id, "L2", d3.l2Id as string) : undefined;
    const d2 = l2Node ? nd(l2Node) : {};
    const l2Id = l2Node ? (nd(l2Node).id as string) || "" : "";
    if (l3Id) coveredL3.add(l3Id);
    if (l2Id) coveredL2.add(l2Id);
    const row: string[] = new Array(totalCols).fill("");
    row[0] = l2Id; row[1] = (d2.label as string) || "";
    row[2] = l3Id; row[3] = (d3.label as string) || "";
    row[4] = l4Id; row[5] = (d4.label as string) || ""; row[6] = (d4.description as string) || "";
    dataRows.push(row);
  }

  /* ── L3 without L4 children ── */
  for (const [l3Id, l3Node] of Array.from(byLevel.L3.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (coveredL3.has(l3Id)) continue;
    const d3 = nd(l3Node);
    const l2Node = findParent(l3Id, "L2", d3.l2Id as string);
    const d2 = l2Node ? nd(l2Node) : {};
    const l2Id = l2Node ? (nd(l2Node).id as string) || "" : "";
    if (l2Id) coveredL2.add(l2Id);
    const row: string[] = new Array(totalCols).fill("");
    row[0] = l2Id; row[1] = (d2.label as string) || "";
    row[2] = l3Id; row[3] = (d3.label as string) || "";
    dataRows.push(row);
  }

  /* ── L2 without any children ── */
  for (const [l2Id, l2Node] of Array.from(byLevel.L2.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (coveredL2.has(l2Id)) continue;
    const d2 = nd(l2Node);
    const row: string[] = new Array(totalCols).fill("");
    row[0] = l2Id; row[1] = (d2.label as string) || "";
    dataRows.push(row);
  }

  /* ── 행 정렬: L2 → L3 → L4 → L5 ID 순 ── */
  dataRows.sort((a, b) => {
    for (const i of [0, 2, 4, 7]) {
      const va = a[i] || "";
      const vb = b[i] || "";
      if (va !== vb) return va.localeCompare(vb, undefined, { numeric: true });
    }
    return 0;
  });

  /* ── BOM + 헤더 + 행 → CSV 문자열 ── */
  const bom = "\uFEFF";
  const lines = [
    headers.map(esc).join(","),
    ...dataRows.map((row) => row.map(esc).join(",")),
  ];
  void cfg; // cfg 는 향후 확장 시 사용 (lint 회피)
  return bom + lines.join("\n");
}

/* ═══════════════════════════════════════════════
 * buildMergedRows: CSV + 캔버스 머지 결과를 행 단위로 반환
 * - unchanged: 원본 CSV 그대로
 * - modified: 캔버스에서 수정된 행 (노란색)
 * - new: 캔버스에서 새로 추가된 L5 노드 (초록색)
 * ═══════════════════════════════════════════════ */
export type RowStatus = "unchanged" | "modified" | "new";
export interface MergedRow { cols: string[]; status: RowStatus; }

export function buildMergedRows(csvRows: CsvRow[], nodes: Node[]): MergedRow[] {
  const nodeByL5Id = new Map<string, Node>();
  const byLevel: Record<string, Map<string, Node>> = {
    L2: new Map(), L3: new Map(), L4: new Map(), L5: new Map(),
  };
  for (const n of nodes) {
    const d = nd(n);
    const level = ((d.level as string) || "").toUpperCase();
    const displayId = (d.id as string) || "";
    const isManual = !!(d.isManual);
    /* isManual 노드는 CSV 행과 매칭하지 않음 — 항상 신규 행으로 처리 */
    if (level === "L5" && displayId && !isManual) nodeByL5Id.set(displayId, n);
    if (level && displayId && byLevel[level]) byLevel[level].set(displayId, n);
  }

  const findParent = (childId: string, parentLevel: string, explicitId?: string): Node | undefined => {
    const map = byLevel[parentLevel];
    if (!map) return undefined;
    if (explicitId) { const f = map.get(explicitId); if (f) return f; }
    const parts = childId.split(".");
    parts.pop();
    const prefix = parts.join(".");
    return prefix ? map.get(prefix) : undefined;
  };

  /* 원본 CSV 행을 variant 별 컬럼 순서로 직렬화 */
  const colsFromCsvRow = (r: CsvRow): string[] => originalRowAsCsvCols(r);

  /* 캔버스 노드 + 원본 CSV 행을 variant 별 컬럼 순서로 머지하여 직렬화 */
  const colsFromNode = (r: CsvRow, n: Node): string[] => {
    const d = nd(n);
    const variant: CsvVariant = (d.variant as CsvVariant | undefined) || r._variant || "doosan-hr-4";
    const cfg = VARIANT_CONFIG[variant];
    const actors = d.actors as Record<string, string> | undefined;
    const systems = d.systems as Record<string, string> | undefined;
    const pp = d.painPoints as Record<string, string> | undefined;
    const inp = d.inputs as Record<string, string> | undefined;
    const out = d.outputs as Record<string, string> | undefined;
    const logic = d.logic as Record<string, string> | undefined;

    /* ── NodeDetailPanel에서 사용자가 직접 편집한 flat 필드 ── */
    const roleStr = d.role as string | null | undefined;
    const systemStr = d.system as string | null | undefined;
    const inputStr = d.inputData as string | null | undefined;
    const outputStr = d.outputData as string | null | undefined;

    /* 수행 주체 컬럼 (variant 순서):
       role 문자열이 있으면 라벨 매칭으로 채우고, 없으면 structured actors → 폴백 CSV row 값 */
    const actorCols: string[] = roleStr != null
      ? actorColumnsFromRole(variant, roleStr, actors)
      : cfg.actors.map((a) => actors?.[a.key] ?? readCsvCell(r, ACTOR_KEY_TO_CSV_FIELD[a.key]));

    /* 사용 시스템 컬럼 (variant 순서):
       structured systems 우선, 없으면 CSV row 폴백.
       추가로 사용자가 flat textarea 로 편집한 systemStr 가 있으면, 텍스트 variant 의 etc 컬럼에 기록
       (doosan-hr-4 / qvex-payroll-7 만 텍스트 모드) */
    const systemCols: string[] = cfg.systems.map(
      (s) => systems?.[s.key] ?? readCsvCell(r, SYSTEM_KEY_TO_CSV_FIELD[s.key]),
    );
    if (systemStr != null && (variant === "doosan-hr-4" || variant === "qvex-payroll-7")) {
      const etcIdx = cfg.systems.findIndex((s) => s.key === "etc");
      if (etcIdx >= 0) systemCols[etcIdx] = systemStr;
    }

    /* Input / Output: 사용자가 편집했으면 in_etc / out_etc에 기록 */
    const inEtc = inputStr != null ? inputStr : (inp?.etc ?? r.in_etc);
    const outEtc = outputStr != null ? outputStr : (out?.etc ?? r.out_etc);

    /* 메타데이터 필드는 ?? (nullish) 사용 — 빈 문자열("")도 노드 자신의 값으로 유지. */
    return [
      r.L2_ID, r["두산 L2"], r.L3_ID, r.L3_Name, r.L4_ID, r.L4_Name, r.L4_Description,
      r.L5_ID, (d.label as string) || r.L5_Name, (d.description as string) || r.L5_Description,
      ...actorCols,
      (d.mgrBody as string) ?? r.mgr_body, (d.staffCount as string) ?? r.staff_count,
      (d.mainPerson as string) ?? r.main_person, (d.avgTime as string) ?? r.avg_time,
      (d.freqCount as string) ?? r.freq_count,
      ...systemCols,
      pp?.speed ?? r.pp_speed, pp?.accuracy ?? r.pp_accuracy, pp?.repeat ?? r.pp_repeat,
      pp?.data ?? r.pp_data, pp?.system ?? r.pp_system, pp?.comm ?? r.pp_comm, pp?.etc ?? r.pp_etc,
      inp?.system ?? r.in_system, inp?.doc ?? r.in_doc, inp?.external ?? r.in_external,
      inp?.request ?? r.in_request, inEtc,
      out?.system ?? r.out_system, out?.doc ?? r.out_doc, out?.comm ?? r.out_comm,
      out?.decision ?? r.out_decision, outEtc,
      logic?.rule ?? r.logic_rule, logic?.human ?? r.logic_human, logic?.mixed ?? r.logic_mixed,
    ];
  };

  const results: MergedRow[] = [];
  /* React Flow 내부 node.id 기준으로 CSV 매칭된 노드 추적
     (display ID 기반 matchedL5Ids 와 달리 동일 display ID 충돌 없음) */
  const matchedNodeIds = new Set<string>();
  /* CSV 매칭에서 처리된 display ID — 캔버스 복제 노드의 Excel 중복 출력 방지용 */
  const matchedDisplayIds = new Set<string>();

  for (const r of csvRows) {
    if (!r.L2_ID && !r.L3_ID && !r.L4_ID && !r.L5_ID) continue;
    const node = r.L5_ID ? nodeByL5Id.get(r.L5_ID) : undefined;
    if (!node) {
      /* 캔버스에 매칭 노드 없음 → 원본 CSV 그대로 포함 (isManual 충돌 포함) */
      results.push({ cols: colsFromCsvRow(r), status: "unchanged" });
    } else {
      matchedNodeIds.add(node.id);
      matchedDisplayIds.add(r.L5_ID);
      const original = colsFromCsvRow(r);
      const merged = colsFromNode(r, node);
      results.push({ cols: merged, status: merged.some((v, i) => v !== original[i]) ? "modified" : "unchanged" });
    }
  }

  /* CSV L4_ID → CsvRow 매핑 (부모 계층 fallback) */
  const csvByL4 = new Map<string, CsvRow>();
  for (const r of csvRows) {
    if (r.L4_ID && !csvByL4.has(r.L4_ID)) csvByL4.set(r.L4_ID, r);
  }

  /* 캔버스에만 있는 새 L5 노드 (CSV 매칭에서 제외된 전체 노드 순회)
     byLevel.L5 대신 nodes 전체 순회 → isManual 노드도 모두 포착 */
  const newNodesSorted = nodes
    .filter(n => {
      const d = nd(n);
      return ((d.level as string) || "").toUpperCase() === "L5" && !matchedNodeIds.has(n.id);
    })
    .sort((a, b) => ((nd(a).id as string) || "").localeCompare((nd(b).id as string) || "", undefined, { numeric: true }));

  /* 새 노드 루프에서 이미 출력된 display ID 추적 — manual/비manual 무관하게 중복 방지 */
  const outputDisplayIds = new Set<string>(matchedDisplayIds);

  for (const l5Node of newNodesSorted) {
    const d5 = nd(l5Node);
    const l5Id = (d5.id as string) || "";
    /* 같은 displayId면 manual 여부 관계없이 1개만 출력 */
    if (l5Id && outputDisplayIds.has(l5Id)) continue;
    if (l5Id) outputDisplayIds.add(l5Id);
    const l4Node = findParent(l5Id, "L4", d5.l4Id as string);
    const l4Id = l4Node ? (nd(l4Node).id as string) || "" : (d5.l4Id as string) || "";
    let l4Label = l4Node ? (nd(l4Node).label as string) || "" : (d5.l4Name as string) || "";
    let l4Desc = l4Node ? (nd(l4Node).description as string) || "" : "";
    const l3Node = l4Id ? findParent(l4Id, "L3", d5.l3Id as string) : undefined;
    let l3Id = l3Node ? (nd(l3Node).id as string) || "" : (d5.l3Id as string) || "";
    let l3Label = l3Node ? (nd(l3Node).label as string) || "" : (d5.l3Name as string) || "";
    const l2Node = l3Id ? findParent(l3Id, "L2", d5.l2Id as string) : undefined;
    let l2Id = l2Node ? (nd(l2Node).id as string) || "" : (d5.l2Id as string) || "";
    let l2Label = l2Node ? (nd(l2Node).label as string) || "" : (d5.l2Name as string) || "";

    /* CSV fallback: L4_ID로 CSV 행에서 부모 계층(L2/L3) 복원 */
    if (l4Id && (!l3Id || !l2Id)) {
      const csvFallback = csvByL4.get(l4Id);
      if (csvFallback) {
        if (!l3Id) { l3Id = csvFallback.L3_ID; l3Label = l3Label || csvFallback.L3_Name; }
        if (!l2Id) { l2Id = csvFallback.L2_ID; l2Label = l2Label || csvFallback["두산 L2"]; }
        if (!l4Label) l4Label = csvFallback.L4_Name;
        if (!l4Desc) l4Desc = csvFallback.L4_Description;
      }
    }
    const actors = d5.actors as Record<string, string> | undefined;
    const systems = d5.systems as Record<string, string> | undefined;
    const pp = d5.painPoints as Record<string, string> | undefined;
    const inp = d5.inputs as Record<string, string> | undefined;
    const out = d5.outputs as Record<string, string> | undefined;
    const logic = d5.logic as Record<string, string> | undefined;

    /* NodeDetailPanel / 추가 폼에서 저장된 flat 필드 처리 */
    const roleStr5 = d5.role as string | null | undefined;
    const systemStr5 = d5.system as string | null | undefined;
    const inputStr5 = d5.inputData as string | null | undefined;
    const outputStr5 = d5.outputData as string | null | undefined;

    /* variant 우선순위: 노드 variant > 부모 csvByL4 row variant > 첫 csvRow > doosan-hr-4 */
    const fallbackVariant: CsvVariant = csvRows[0]?._variant || "doosan-hr-4";
    const newVariant: CsvVariant = (d5.variant as CsvVariant | undefined)
      || (l4Id ? csvByL4.get(l4Id)?._variant : undefined)
      || fallbackVariant;
    const newCfg = VARIANT_CONFIG[newVariant];

    /* 수행 주체 컬럼: role 라벨 매칭 → variant 별 actor 순서대로 채움 */
    const newActorCols: string[] = roleStr5 != null
      ? actorColumnsFromRole(newVariant, roleStr5, actors)
      : newCfg.actors.map((a) => actors?.[a.key] || "");

    /* 사용 시스템 컬럼: structured systems 우선; flat systemStr5 는 텍스트 variant 의 etc 에 기록 */
    const newSystemCols: string[] = newCfg.systems.map((s) => systems?.[s.key] || "");
    if (systemStr5 != null && (newVariant === "doosan-hr-4" || newVariant === "qvex-payroll-7")) {
      const etcIdx = newCfg.systems.findIndex((s) => s.key === "etc");
      if (etcIdx >= 0) newSystemCols[etcIdx] = systemStr5;
    }

    const newInEtc = inputStr5 != null ? inputStr5 : (inp?.etc || "");
    const newOutEtc = outputStr5 != null ? outputStr5 : (out?.etc || "");

    results.push({
      cols: [
        l2Id, l2Label, l3Id, l3Label, l4Id, l4Label, l4Desc,
        l5Id, (d5.label as string) || "", (d5.description as string) || "",
        ...newActorCols,
        (d5.mgrBody as string) || "", (d5.staffCount as string) || "",
        (d5.mainPerson as string) || "", (d5.avgTime as string) || "", (d5.freqCount as string) || "",
        ...newSystemCols,
        pp?.speed || "", pp?.accuracy || "", pp?.repeat || "",
        pp?.data || "", pp?.system || "", pp?.comm || "", pp?.etc || "",
        inp?.system || "", inp?.doc || "", inp?.external || "", inp?.request || "", newInEtc,
        out?.system || "", out?.doc || "", out?.comm || "", out?.decision || "", newOutEtc,
        logic?.rule || "", logic?.human || "", logic?.mixed || "",
      ],
      status: "new",
    });
  }

  /* ── L5 ID 재번호: 새 노드(isManual)가 삽입된 L4 그룹은 순서 기반 재번호 ──
   * 1) L4별로 그룹화  2) "new" 행이 있는 그룹만 재번호
   * 3) 같은 ID면 "new" 우선 → 삽입(insert) 동작 구현 */
  const byL4Group = new Map<string, number[]>();
  results.forEach((row, i) => {
    const l4Key = row.cols[4] || "__none__";
    if (!byL4Group.has(l4Key)) byL4Group.set(l4Key, []);
    byL4Group.get(l4Key)!.push(i);
  });

  for (const [l4Key, idxList] of byL4Group) {
    const hasNew = idxList.some(i => results[i].status === "new");
    if (!hasNew) continue; // 새 노드 없으면 재번호 불필요

    /* L5_ID 기준 정렬, 같은 ID면 "new" 우선 */
    idxList.sort((a, b) => {
      const ia = results[a].cols[7] || "";
      const ib = results[b].cols[7] || "";
      const cmp = ia.localeCompare(ib, undefined, { numeric: true });
      if (cmp !== 0) return cmp;
      const pa = results[a].status === "new" ? 0 : 1;
      const pb = results[b].status === "new" ? 0 : 1;
      return pa - pb;
    });

    /* 순서대로 새 ID 할당: L4_ID.1, L4_ID.2, ... */
    const prefix = l4Key !== "__none__" ? l4Key + "." : "";
    idxList.forEach((idx, pos) => {
      const newL5Id = prefix + (pos + 1);
      const oldL5Id = results[idx].cols[7];
      if (newL5Id === oldL5Id) return;
      const newCols = [...results[idx].cols];
      newCols[7] = newL5Id;
      results[idx] = {
        cols: newCols,
        /* ID가 바뀐 기존 행은 "modified"로 표시 */
        status: results[idx].status === "unchanged" ? "modified" : results[idx].status,
      };
    });
  }

  /* ── 전체 행을 L2→L3→L4→L5 ID 기준으로 정렬 ── */
  results.sort((a, b) => {
    const keyOf = (cols: string[]) =>
      [cols[0] || "", cols[2] || "", cols[4] || "", cols[7] || ""]
        .join("\t");
    return keyOf(a.cols).localeCompare(keyOf(b.cols), undefined, { numeric: true });
  });

  return results;
}

/* ═══════════════════════════════════════════════
 * 원본 CSV 전체 행 기반 + 캔버스 수정 merge → CSV 문자열
 * 캔버스에 없는 L5도 원본 CSV 그대로 포함
 * ═══════════════════════════════════════════════ */
export function buildMergedCsvString(csvRows: CsvRow[], nodes: Node[]): string {
  const variant = inferExportVariant(csvRows, nodes);
  const headers = templateHeadersForVariant(variant);

  /* L5_ID → canvas node map (isManual 노드는 제외 — CSV 행과 충돌 방지) */
  const nodeByL5Id = new Map<string, Node>();
  for (const n of nodes) {
    const d = nd(n);
    const level = ((d.level as string) || "").toUpperCase();
    const nodeId = (d.id as string) || "";
    const isManual = !!(d.isManual);
    if (level === "L5" && nodeId && !isManual) nodeByL5Id.set(nodeId, n);
  }

  /* isManual 노드가 점유한 ID — CSV 행과 중복 방지 */
  const manualL5IdsCsv = new Set<string>();
  for (const n of nodes) {
    const d = nd(n);
    if (((d.level as string) || "").toUpperCase() === "L5" && !!(d.isManual)) {
      const did = (d.id as string) || "";
      if (did) manualL5IdsCsv.add(did);
    }
  }

  const esc = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const dataRows: string[][] = [];
  for (const r of csvRows) {
    if (!r.L2_ID && !r.L3_ID && !r.L4_ID && !r.L5_ID) continue;

    const node = r.L5_ID ? nodeByL5Id.get(r.L5_ID) : undefined;
    if (!node) {
      /* isManual 노드가 같은 ID 점유 → CSV 행 건너뜀 */
      if (r.L5_ID && manualL5IdsCsv.has(r.L5_ID)) continue;
      /* 캔버스에 없는 행: 원본 CSV 그대로 (variant 별 컬럼 순서) */
      dataRows.push(originalRowAsCsvCols(r));
    } else {
      /* 캔버스 노드가 있는 행: 캔버스 값 우선, 없으면 원본 CSV 폴백 (variant 별 컬럼 순서) */
      const d = nd(node);
      const rowVariant: CsvVariant = (d.variant as CsvVariant | undefined) || r._variant || "doosan-hr-4";
      const cfg = VARIANT_CONFIG[rowVariant];
      const actors = d.actors as Record<string, string> | undefined;
      const systems = d.systems as Record<string, string> | undefined;
      const pp = d.painPoints as Record<string, string> | undefined;
      const inp = d.inputs as Record<string, string> | undefined;
      const out = d.outputs as Record<string, string> | undefined;
      const logic = d.logic as Record<string, string> | undefined;

      /* NodeDetailPanel에서 편집한 flat 필드 */
      const roleStr = d.role as string | null | undefined;
      const systemStr = d.system as string | null | undefined;
      const inputStr = d.inputData as string | null | undefined;
      const outputStr = d.outputData as string | null | undefined;

      /* 수행 주체 컬럼: role 라벨 매칭 → variant 별 actor 순서 */
      const actorCols: string[] = roleStr != null
        ? actorColumnsFromRole(rowVariant, roleStr, actors)
        : cfg.actors.map((a) => actors?.[a.key] ?? readCsvCell(r, ACTOR_KEY_TO_CSV_FIELD[a.key]));

      /* 사용 시스템 컬럼: structured systems 우선; flat systemStr 는 텍스트 variant 의 etc 에 기록 */
      const systemCols: string[] = cfg.systems.map(
        (s) => systems?.[s.key] ?? readCsvCell(r, SYSTEM_KEY_TO_CSV_FIELD[s.key]),
      );
      if (systemStr != null && (rowVariant === "doosan-hr-4" || rowVariant === "qvex-payroll-7")) {
        const etcIdx = cfg.systems.findIndex((s) => s.key === "etc");
        if (etcIdx >= 0) systemCols[etcIdx] = systemStr;
      }

      const inEtc = inputStr != null ? inputStr : (inp?.etc ?? r.in_etc);
      const outEtc = outputStr != null ? outputStr : (out?.etc ?? r.out_etc);

      dataRows.push([
        r.L2_ID, r["두산 L2"],
        r.L3_ID, r.L3_Name,
        r.L4_ID, r.L4_Name, r.L4_Description,
        r.L5_ID,
        (d.label as string) || r.L5_Name,
        (d.description as string) || r.L5_Description,
        ...actorCols,
        (d.mgrBody as string) ?? r.mgr_body,
        (d.staffCount as string) ?? r.staff_count,
        (d.mainPerson as string) ?? r.main_person,
        (d.avgTime as string) ?? r.avg_time,
        (d.freqCount as string) ?? r.freq_count,
        ...systemCols,
        pp?.speed ?? r.pp_speed, pp?.accuracy ?? r.pp_accuracy, pp?.repeat ?? r.pp_repeat,
        pp?.data ?? r.pp_data, pp?.system ?? r.pp_system, pp?.comm ?? r.pp_comm, pp?.etc ?? r.pp_etc,
        inp?.system ?? r.in_system, inp?.doc ?? r.in_doc, inp?.external ?? r.in_external,
        inp?.request ?? r.in_request, inEtc,
        out?.system ?? r.out_system, out?.doc ?? r.out_doc, out?.comm ?? r.out_comm,
        out?.decision ?? r.out_decision, outEtc,
        logic?.rule ?? r.logic_rule, logic?.human ?? r.logic_human, logic?.mixed ?? r.logic_mixed,
      ]);
    }
  }

  const bom = "\uFEFF";
  const lines = [
    headers.map(esc).join(","),
    ...dataRows.map((row) => row.map(esc).join(",")),
  ];
  return bom + lines.join("\n");
}
