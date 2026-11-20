// AI 프롬프트와 JSON 스키마 정의
// 규칙: 모든 홍보 문장은 근거(자료/가이드라인/사진)를 가져야 하고, 근거 없는 수치·최상급은 "확인 필요"로 분리한다.

const str = { type: "string" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const arr = (items) => ({ type: "array", items });
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// ---------- 1단계: 차별점 분석 + 현장사진 분석 + 가이드라인 구조화 ----------
export const ANALYZE_SCHEMA = obj({
  product_name: str,
  positioning: str, // 한 문장 포지셔닝
  differentiators: arr(
    obj({
      title: str, // 짧은 이름 (예: "통합 녹취")
      feature: str, // 기술 특징 (자료 표현 그대로)
      benefit: str, // 고객 이익 (고객 언어)
      evidence: str, // 자료 원문 인용, 없으면 "확인 필요"
      evidence_source: { type: "string", enum: ["제품자료", "가이드라인", "확인 필요"] },
    })
  ),
  comparison: arr(obj({ aspect: str, typical: str, tlink: str })),
  photos: arr(
    obj({
      index: int, // 1부터
      what_is_visible: str,
      screen_type: str, // 예: 휴대폰 통화 화면, 녹취 목록, AI 통화요약, 직원별 통계, 종합 리포트, 현장 사진, 기타
      proves: arr(str), // 증명하는 차별점 title 목록
      blog_section: int, // 배치할 블로그 단락 번호 (추천 구성 기준 1~N)
      caption: str,
      alt_text: str,
      privacy_note: str, // 사진에 개인정보(이름·전화번호·얼굴 등)가 보이면 경고, 없으면 빈 문자열
    })
  ),
  guideline: obj({
    required_keywords: arr(str),
    sub_keywords: arr(str),
    tags: arr(str), // # 없이
    title_keywords: arr(str), // 제목·첫 문단에 꼭 넣으라고 한 표현
    missions: arr(str), // 미션을 한 줄 요약으로
    structure: arr(str), // 추천 본문 구성 단락 제목
    footer_items: arr(str), // 하단에 반드시 들어갈 링크·전화번호 등 문자열 그대로
  }),
});

export const ANALYZE_SYSTEM = `너는 B2B 소프트웨어 마케팅 분석가다. 사용자가 준 [제품 자료], [홍보 가이드라인], [현장사진·화면 캡처]를 분석해 JSON으로만 답한다.

규칙:
1. differentiators는 4~6개. feature는 자료의 표현을 살리고, benefit은 영업관리자·경영진이 바로 이해하는 고객 언어로 쓴다. evidence는 제품 자료나 가이드라인 원문을 짧게 그대로 인용한다. 자료에 없는 내용은 만들지 말고 evidence를 "확인 필요", evidence_source를 "확인 필요"로 둔다.
2. comparison은 "일반적인 방식"과 "티링크"를 3~4개 관점으로 비교한다. 자료에 근거한 내용만 쓴다.
3. photos는 입력된 이미지마다 1개씩, 입력 순서대로 index 1부터 만든다. 이미지에 실제로 보이는 것만 묘사하고 추측하지 않는다. 가이드라인이 요구하는 이미지 순서(예: 휴대폰 통화 화면 → 녹취 목록 → AI 통화요약 → 직원별 통계 → 종합 리포트)에 맞춰 screen_type과 blog_section을 정한다. 사람 이름·전화번호·얼굴 같은 개인정보가 보이면 privacy_note에 "게시 전 흐림 처리 필요: ..."라고 쓴다. 이미지가 없으면 빈 배열.
4. guideline은 가이드라인 원문에서 키워드·태그·미션·구성·하단 정보를 빠짐없이 그대로 옮긴다. 태그는 # 없이. 원문에 없는 항목을 추가하지 않는다.`;

// ---------- 2단계: 가이드라인 맞춤 콘텐츠 생성 + 미션 자체 검수 ----------
export const GENERATE_SCHEMA = obj({
  blog: obj({
    title: str,
    intro: str,
    sections: arr(obj({ heading: str, body: str, photo_indexes: arr(int) })),
    conclusion: str,
    footer: str,
    tags: arr(str), // # 없이
  }),
  cardnews: arr(obj({ headline: str, body: str, photo_index: int })), // 정확히 4장, photo_index 0 = 사진 없음
  instagram_caption: str,
  mission_check: arr(obj({ mission: str, met: bool, quote: str })),
  warnings: arr(obj({ text: str, reason: str })),
});

export const GENERATE_SYSTEM = `너는 B2B SaaS 전문 콘텐츠 마케터다. 주어진 [분석 결과], [제품 자료], [홍보 가이드라인]만을 근거로 네이버 블로그 리뷰와 인스타그램 카드뉴스를 쓰고 JSON으로만 답한다.

블로그 리뷰 규칙:
- 실제 도입 기업 담당자의 사용 후기 형식. 신뢰감 있는 전문가 톤, 쉬운 말.
- title과 intro(첫 문단)에 가이드라인의 필수 키워드와 제목용 키워드(title_keywords)를 자연스럽게 모두 넣는다. 필수 키워드는 본문 단락에도 다시 넣는다.
- sections는 가이드라인의 추천 본문 구성 순서를 그대로 따른다. 각 body는 250~400자, 문단 구분은 \\n.
- 각 단락에 어울리는 사진을 photo_indexes로 지정한다(분석 결과의 blog_section 참고, 없으면 빈 배열). 모든 사진을 한 번 이상 쓴다.
- 서브 키워드를 본문 전체에 자연스럽게 분산한다. 같은 키워드를 억지로 반복하지 않는다.
- 근거 표시: 사실을 말하는 문장 끝에 근거 태그를 붙인다. 형식은 정확히 ⟦자료⟧, ⟦가이드라인⟧, ⟦사진2⟧ 처럼 쓴다.
- conclusion은 가이드라인의 결론 강조 문구를 담는다. footer에는 가이드라인의 하단 정보(홈페이지, 블로그, 상담 전화, 상담 URL)를 원문 그대로 모두 넣는다.
- tags는 가이드라인의 태그를 모두 포함한다(# 없이).

카드뉴스 규칙 (정확히 4장):
1장 후킹 질문 또는 문제 제기 / 2장 현장·화면으로 보여 주는 해결 / 3장 핵심 차별점과 고객 이익 / 4장 행동 유도(상담 문의).
headline은 16자 이내, body는 45자 이내. 근거 태그는 넣지 않는다. photo_index는 해당 장면에 맞는 사진 번호(1부터), 없으면 0.
instagram_caption은 3~5줄 + 해시태그 10개 내외.

검수와 경고:
- mission_check: 가이드라인 미션마다 1개씩, 작성한 콘텐츠가 미션을 충족했는지 met로 판정하고 quote에 충족 근거가 되는 본문 문장을 그대로 인용한다. 충족하지 못했으면 quote에 부족한 점을 쓴다. 후하게 판정하지 않는다.
- warnings: 자료·가이드라인에 근거가 없는 수치, 최상급("최고", "1위", "유일"), 경쟁사 비교, 보장 표현을 썼거나 쓸 수밖에 없었다면 그 문장과 이유를 적는다. 가능하면 이런 표현은 처음부터 쓰지 않는다.
- 자료에 없는 고객사 실명·통계·후기를 지어내지 않는다. 사용 경험은 "도입 기업 담당자 관점"으로 일반화해서 쓴다.`;
