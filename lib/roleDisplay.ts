/**
 * "수행 주체" 역할 문자열 헬퍼.
 *
 * 저장 포맷:
 *   "팀장, 그 외:%EC%95%84%EB%B9%84" 처럼 콤마 구분 + "그 외:<URI-encoded value>" 형태.
 *   NodeDetailPanel 에서 encodeURIComponent 로 저장하므로, 콤마·공백이 구분자/trim 과 충돌하지 않음.
 *
 * 이 모듈은 화면·PPT 표에 표시할 때 디코딩된 사람 읽기 포맷으로 되돌리는 단일 소스.
 */

/** 커스텀 역할("그 외:xxx" 또는 레거시 "기타:xxx") 본문만 디코딩하여 반환 */
export function extractCustomRole(role?: string | null): string {
  if (!role) return "";
  const parts = role.split(",").map((r) => r.trim());
  const custom = parts.find((r) => r.startsWith("그 외:") || r.startsWith("기타:"));
  if (!custom) return "";
  const raw = custom.startsWith("그 외:") ? custom.slice(4) : custom.slice(3);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 콤마 구분 역할 문자열 전체를 사람 읽기 포맷으로 변환 (커스텀 부분만 디코딩) */
export function displayRole(role?: string | null): string {
  if (!role) return "";
  return role
    .split(",")
    .map((part) => {
      const p = part.trim();
      if (!p) return "";
      if (p.startsWith("그 외:")) {
        try {
          return `그 외:${decodeURIComponent(p.slice(4))}`;
        } catch {
          return p;
        }
      }
      if (p.startsWith("기타:")) {
        try {
          return `기타:${decodeURIComponent(p.slice(3))}`;
        } catch {
          return p;
        }
      }
      return p;
    })
    .filter(Boolean)
    .join(", ");
}

/** role 문자열에 '그 외' 또는 '기타' (본체 또는 값 있는 형태)가 포함되어 있는지 */
export function hasCustomRole(role?: string | null): boolean {
  if (!role) return false;
  return role
    .split(",")
    .map((r) => r.trim())
    .some(
      (r) =>
        r === "그 외" ||
        r.startsWith("그 외:") ||
        r === "기타" ||
        r.startsWith("기타:"),
    );
}
