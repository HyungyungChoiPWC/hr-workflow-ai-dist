/**
 * xlsxToFlow — As-Is 분석 엑셀(.xlsx) 양식을 직접 인식해 CsvRow[] 로 변환.
 *
 * 엑셀 양식은 CSV 와 달리 다중 행 헤더(그룹 헤더 + 세부 헤더) 구조이고,
 * 수행주체 / 사용 시스템 / Pain Point / 로직 컬럼은 텍스트가 아니라 "●" 도팅(복수 선택)이다.
 * 또한 그룹 헤더는 가로 병합(merge)되어 있어, 병합 범위(master)로 그룹의 컬럼 span 을 잡는다.
 *
 * 전략: 엑셀 2행 헤더를 "그룹 prefix + 세부 라벨" 형태의 단일 헤더로 재구성한 뒤,
 *       CSV 파서와 동일한 buildCsvRowsFromMatrix() 로 넘겨 컬럼 매핑을 100% 재사용한다.
 *       (위치가 아닌 헤더 이름 기반 매칭이라 파일마다 컬럼 위치가 달라도 안전)
 *
 * 추가로, 감지된 "수행주체" 세부 헤더들을 그대로 Swimlane 레인(+"그 외")으로 돌려준다.
 */
import type { CsvRow, CsvVariant } from "./csvToFlow";
import {
  buildCsvRowsFromMatrix,
  resolveColumnFields,
  orderedCsvFieldKeys,
  CSV_DOTTING_FIELDS,
} from "./csvToFlow";

/** 원본 엑셀 양식으로 되돌려 내보내기 위한 메타데이터 */
export interface XlsxExportMeta {
  sheetName: string;
  /** 데이터 컬럼 ↔ CsvRow 필드 (엑셀 1-indexed 컬럼) */
  columns: { excelCol: number; field: string }[];
  /** 가져온 각 데이터 행의 엑셀 행 번호 (1-indexed) — 같은 위치에 되써서 서식 보존 */
  rowExcelIndices: number[];
  /** 새 행 추가 시작 위치 (마지막 데이터 행 다음) */
  appendStartRow: number;
}

export interface XlsxParseResult {
  rows: CsvRow[];
  /** 감지된 수행주체 컬럼 라벨 + "그 외" — 맞춤형 Swimlane 레인 */
  lanes: string[];
  variant: CsvVariant;
  sheetName: string;
  /** 진단용 — 재구성된 비계층 헤더 목록 */
  reconstructedHeaders: string[];
  /** 원본 양식 라운드트립 내보내기용 메타 */
  exportMeta: XlsxExportMeta;
}

/** 그룹 헤더 텍스트에 이 키가 포함되면 해당 prefix 로 세부 컬럼들을 재구성 */
const GROUP_DEFS: { key: string; prefix: string }[] = [
  { key: "수행주체", prefix: "수행주체_" },
  { key: "사용 시스템", prefix: "사용 시스템_" },
  { key: "어려운 점", prefix: "Pain Point_" }, // D-1. 업무 수행 시 어려운 점
  { key: "업무 판단 로직", prefix: "업무 판단 로직_" },
  { key: "Input", prefix: "Input_" },
  { key: "Output", prefix: "Output_" },
];

/** 단일 컬럼 필드 — 그룹 헤더 자체가 곧 컬럼 (세부 헤더 없음) */
const SINGLE_DEFS: { key: string; header: string }[] = [
  { key: "담당자 수", header: "담당자 수" },
  { key: "주 담당자", header: "주 담당자" },
  { key: "평균 건당 소요시간", header: "평균 건당 소요시간" },
  { key: "발생 빈도", header: "발생 빈도_건수" },
];

const HIER_LABELS = new Set(["ID", "Name", "Description", "두산 L2"]);

/* exceljs 셀 → 안전한 문자열 (병합 슬레이브/리치텍스트/수식/하이퍼링크 방어) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellText(cell: any): string {
  if (!cell) return "";
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t: { text?: string }) => t.text ?? "").join("").trim();
    if (typeof v.text === "string") return v.text.trim(); // hyperlink
    if (v.result != null) return String(v.result).trim(); // formula
    if (v.formula) return "";
    return "";
  }
  return "";
}

function clean(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

interface Span {
  min: number;
  max: number;
  text: string;
}

/** 엑셀 ArrayBuffer → CsvRow[] + 감지 레인. exceljs 는 동적 import. */
export async function parseXlsxArrayBuffer(buf: ArrayBuffer): Promise<XlsxParseResult> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("엑셀에 시트가 없습니다.");

  const colMax = Math.min(ws.columnCount || 100, 200);
  const rowMax = ws.rowCount || 0;
  const txt = (r: number, c: number) => cellText(ws.getCell(r, c));

  // 1) 그룹 헤더 행 = "수행주체" 와 "사용 시스템" 을 동시에 포함하는 행 (1-indexed)
  let gr = -1;
  for (let r = 1; r <= Math.min(60, rowMax); r++) {
    let line = "";
    for (let c = 1; c <= colMax; c++) line += txt(r, c) + " ";
    if (line.includes("수행주체") && line.includes("사용 시스템")) {
      gr = r;
      break;
    }
  }
  if (gr < 0) throw new Error("엑셀에서 헤더 행(수행주체/사용 시스템)을 찾지 못했습니다.");

  // 2) 그룹 헤더 행의 병합 span 수집 (master 기준)
  const spans: Span[] = [];
  let curMasterAddr = "";
  for (let c = 1; c <= colMax; c++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const master = (ws.getCell(gr, c) as any).master ?? ws.getCell(gr, c);
    const addr = master.address;
    if (addr !== curMasterAddr) {
      spans.push({ min: c, max: c, text: cellText(master) });
      curMasterAddr = addr;
    } else {
      spans[spans.length - 1].max = c;
    }
  }

  // 3) 계층 컬럼 (ID/Name/Description/두산 L2) — 좌측 10개 single span
  const hierCols: number[] = [];
  for (const s of spans) {
    if (s.min === s.max && HIER_LABELS.has(s.text) && hierCols.length < 10) hierCols.push(s.min);
  }
  if (hierCols.length < 10) throw new Error("엑셀에서 계층(ID/Name) 컬럼 10개를 찾지 못했습니다.");

  // 4) 그룹 / 단일 필드 span 식별
  const groupSpans: { min: number; max: number; prefix: string }[] = [];
  const singleCols: { col: number; header: string }[] = [];
  for (const s of spans) {
    if (!s.text) continue;
    const g = GROUP_DEFS.find((d) => s.text.includes(d.key));
    if (g) {
      groupSpans.push({ min: s.min, max: s.max, prefix: g.prefix });
      continue;
    }
    const sg = SINGLE_DEFS.find((d) => s.text.includes(d.key));
    if (sg) singleCols.push({ col: s.min, header: sg.header });
  }
  const actorGroup = groupSpans.find((g) => g.prefix === "수행주체_");
  if (!actorGroup) throw new Error("엑셀에서 '수행주체' 그룹을 찾지 못했습니다.");

  // 5) 세부 헤더 행 — 그룹 헤더는 세로로도 병합(예: row 9~10)되어 있으므로,
  //    수행주체 그룹 헤더 셀의 세로 병합 바닥 다음 행이 세부 헤더 행이다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gMasterAddr = ((ws.getCell(gr, actorGroup.min) as any).master ?? ws.getCell(gr, actorGroup.min)).address;
  let bottom = gr;
  while (
    bottom + 1 <= rowMax &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (((ws.getCell(bottom + 1, actorGroup.min) as any).master ?? ws.getCell(bottom + 1, actorGroup.min)).address === gMasterAddr)
  ) {
    bottom++;
  }
  const sr = bottom + 1;
  if (sr > rowMax) throw new Error("엑셀에서 세부 헤더 행을 찾지 못했습니다.");

  // 6) 컬럼 매핑 재구성: [계층 10] + [그룹 세부] + [단일 필드]
  const mapCols: number[] = [];
  const headerCells: string[] = [];
  for (const c of hierCols) {
    mapCols.push(c);
    headerCells.push(clean(txt(gr, c)) || "ID");
  }
  const lanes: string[] = [];
  for (const g of groupSpans) {
    for (let c = g.min; c <= g.max; c++) {
      const sub = clean(txt(sr, c));
      if (!sub || sub === "[object Object]") continue;
      mapCols.push(c);
      headerCells.push(g.prefix + sub);
      if (g.prefix === "수행주체_") lanes.push(sub);
    }
  }
  for (const s of singleCols) {
    mapCols.push(s.col);
    headerCells.push(s.header);
  }

  // 7) 데이터 행: 세부 헤더 다음 행부터, L5 ID(계층 8번째 컬럼)가 비어있지 않은 행
  //    (L2/L3/L4 는 세로 병합될 수 있으나 L5 ID 는 task 별로 항상 채워짐)
  const l5IdCol = hierCols[7];
  const dataRows: string[][] = [];
  const rowExcelIndices: number[] = [];
  let lastDataRow = sr;
  for (let r = sr + 1; r <= rowMax; r++) {
    if (!txt(r, l5IdCol)) continue;
    dataRows.push(mapCols.map((c) => txt(r, c)));
    rowExcelIndices.push(r);
    lastDataRow = r;
  }

  // 8) CSV 파서와 동일한 매핑 로직 재사용
  const rows = buildCsvRowsFromMatrix(headerCells, dataRows, "parseXlsx");
  const variant = (rows[0]?._variant as CsvVariant) || "qvex-affairs-6";

  // 9) 내보내기용 컬럼 ↔ 필드 매핑 (계층 10 + 그룹/단일)
  const fields = resolveColumnFields(headerCells, variant);
  const columns: { excelCol: number; field: string }[] = [];
  for (let i = 0; i < mapCols.length; i++) {
    const f = fields[i];
    if (f && f !== "__other__") columns.push({ excelCol: mapCols[i], field: f });
  }

  // 10) 맞춤형 Swimlane 레인 = 감지된 수행주체 컬럼 + "그 외"
  return {
    rows,
    lanes: [...lanes, "그 외"],
    variant,
    sheetName: ws.name || "Sheet1",
    reconstructedHeaders: headerCells.slice(10),
    exportMeta: {
      sheetName: ws.name || "Sheet1",
      columns,
      rowExcelIndices,
      appendStartRow: lastDataRow + 1,
    },
  };
}

/**
 * 원본 엑셀 양식(템플릿)을 복제해 현재 데이터로 되써서 내보낸다.
 * 서식/병합/그룹 헤더는 그대로 보존하고 데이터 행 셀 값만 교체한다.
 *  - 도팅 필드(수행주체/시스템/PainPoint/로직): 값이 있으면 "●", 없으면 빈칸
 *  - 텍스트 필드(계층/메타/Input/Output): 값 그대로
 *
 * @param templateBuf 가져왔던 원본 .xlsx ArrayBuffer
 * @param meta        가져오기 때 산출한 export 메타
 * @param variant     감지된 variant
 * @param mergedRows  buildMergedRows() 결과 (variant 필드 순서의 cols 배열)
 */
export async function exportToXlsxTemplate(
  templateBuf: ArrayBuffer,
  meta: XlsxExportMeta,
  variant: CsvVariant,
  mergedRows: { cols: string[] }[],
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuf);
  const ws = wb.getWorksheet(meta.sheetName) ?? wb.worksheets[0];
  if (!ws) throw new Error("템플릿에 시트가 없습니다.");

  // variant 필드 → merged cols 인덱스
  const fieldKeys = orderedCsvFieldKeys(variant) as string[];
  const fieldIndex = new Map<string, number>();
  fieldKeys.forEach((f, i) => fieldIndex.set(f, i));

  const writeRow = (excelRow: number, cols: string[]) => {
    for (const { excelCol, field } of meta.columns) {
      const idx = fieldIndex.get(field);
      if (idx == null) continue;
      const raw = (cols[idx] ?? "").trim();
      const cell = ws.getCell(excelRow, excelCol);
      if (CSV_DOTTING_FIELDS.has(field)) {
        cell.value = raw ? "●" : null;
      } else {
        cell.value = raw ? raw : null;
      }
    }
  };

  // 1) 기존 위치에 되쓰기 (서식 보존) / 초과분은 마지막 데이터 행 뒤에 추가
  let appendRow = meta.appendStartRow;
  for (let i = 0; i < mergedRows.length; i++) {
    const excelRow = i < meta.rowExcelIndices.length ? meta.rowExcelIndices[i] : appendRow++;
    writeRow(excelRow, mergedRows[i].cols);
  }

  // 2) 원본보다 행이 줄었으면 남은 원본 데이터 행의 매핑 컬럼을 비움
  for (let i = mergedRows.length; i < meta.rowExcelIndices.length; i++) {
    const excelRow = meta.rowExcelIndices[i];
    for (const { excelCol } of meta.columns) ws.getCell(excelRow, excelCol).value = null;
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
