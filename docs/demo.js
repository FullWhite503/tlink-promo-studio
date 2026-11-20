// 시연 자막(텔레프롬프터): 주소에 ?demo=1 이 있을 때만 켜진다.
// 화면 상태(사진 업로드, 분석 중, 생성 중, 탭)에 맞는 설명 자막을 화면 아래에 크게 보여 준다.
// 앱 동작에는 영향을 주지 않는다.
(function () {
  try {
    if (!/[?&]demo=1/.test(location.search)) return;

    // 승인 패널에 붙여 넣을 체험 메모 예시 (생성 버튼을 누를 때 클립보드에 복사된다)
    const MEMO = "외근 중 휴대폰으로 통화한 내용이 사무실 PC에 AI 요약으로 바로 올라와, 일일 보고서를 따로 쓰지 않아도 됐습니다.";

    const style = document.createElement("style");
    style.textContent = `
      body { padding-bottom: 170px; }
      #product { height: 110px; } #guideline { height: 100px; }
      #demoBar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(11,31,75,.97); color: #fff; padding: 14px 32px 16px; box-shadow: 0 -6px 24px rgba(0,0,0,.25); }
      #demoBar .say { font-size: 25px; font-weight: 700; line-height: 1.42; }
      #demoBar .next { margin-top: 6px; font-size: 15px; color: #9db8ff; }
      #demoBar .tag { display: inline-block; background: #1f5eff; border-radius: 8px; padding: 1px 10px; margin-right: 10px; font-size: 18px; vertical-align: 2px; }`;
    document.head.appendChild(style);
    const bar = document.createElement("div");
    bar.id = "demoBar";
    bar.innerHTML = `<div class="say"></div><div class="next"></div>`;
    document.body.appendChild(bar);

    const tag = (t) => `<span class="tag">${t}</span>`;
    const C = {
      intro: {
        say: "티링크 프로모 스튜디오 — 현장사진만 올리면 티링크 홍보 블로그와 카드뉴스를 만들고, 가이드라인 51개 조건까지 자동으로 검수합니다.",
        next: "③ 사진 칸을 눌러 현장사진을 올립니다",
      },
      photos: {
        say: "제품 자료와 11월 가이드라인은 기본으로 들어 있습니다. 사진 속 개인정보는 AI로 보내기 전에 먼저 가립니다.",
        next: "사진의 '가리기' → 번호가 보이는 영역 드래그 → 적용",
      },
      masked: {
        say: "가린 사진만 외부 AI로 전송됩니다. 이제 버튼 한 번으로 분석과 생성을 시작합니다.",
        next: "'AI 분석 · 콘텐츠 생성' 클릭",
      },
      analyze1: {
        say: "지금 AI가 제품 자료에서 기술 차별점을 뽑고, 사진마다 무엇을 증명하는지 실제로 분석하고 있습니다.",
        next: "왼쪽 아래 진행 표시의 초가 올라갑니다",
      },
      analyze2: {
        say: "가이드라인 한 건에는 필수 키워드 3, 서브 키워드 10, 태그 19, 미션 11, 본문 구성 5, 하단 정보 3 — 모두 51개 조건이 있습니다.",
        next: "분석이 끝나면 차별점 카드가 먼저 열립니다",
      },
      f1: {
        say: `${tag("1단계 기능 1 · 차별점 분석")}기술 특징을 고객 이익과 자료 원문 근거로 정리하고, 일반적인 방식과 비교합니다.`,
        next: "② 사진 분석·배치 탭 클릭",
      },
      f2: {
        say: `${tag("기능 2 · 현장사진 분석")}사진이 어떤 차별점과 미션의 증거인지 연결하고, 요구한 화면과 다르면 '해당 미션 화면 아님'으로 구분합니다.`,
        next: "생성이 끝나면 블로그 탭이 자동으로 열립니다",
      },
      gen2: {
        say: "지금은 2차 생성 중입니다. AI가 블로그 리뷰와 카드뉴스를 쓰고, 가이드라인 미션 11개를 본문 인용과 함께 스스로 판정합니다.",
        next: "생성이 끝나면 블로그 탭이 자동으로 열립니다",
      },
      blog: {
        say: `${tag("기능 3 · 콘텐츠 생성")}필수 키워드 강조, 근거 출처 태그, 협찬 표시가 들어간 블로그 초안입니다. 승인 전에는 '초안'으로 표시됩니다.`,
        next: "④ 카드뉴스 탭 클릭",
      },
      cards: {
        say: "카드뉴스 4장은 티링크 제안서의 문제 제기로 시작해 상담 문의로 끝납니다. PNG로 바로 내려받습니다.",
        next: "'4장 모두 PNG 다운로드' 클릭 → ⑤ 가이드라인 검수표 탭",
      },
      check: {
        say: `${tag("자동 검수")}40개 조건은 코드가 대조하고, 미션 11개는 AI가 본문 인용과 함께 판정합니다. 체험 메모와 확인 체크가 없으면 게시 승인이 막힙니다.`,
        next: "체험 메모 붙여넣기(Ctrl+V) → 체크 4개 → '게시 승인'",
      },
      approved: {
        say: "블로거의 직접 체험이 본문에 추가되고 승인됐습니다. 미충족 미션은 버튼 하나로 보완 재생성하고, 근거가 없으면 AI가 지어내지 않고 이유를 남깁니다.",
        next: "③ 블로그 리뷰 탭에서 '승인된 원고' 확인",
      },
      fixing: {
        say: "미충족 미션만 짚어 보완 재생성하고 있습니다. 끝나면 51개 조건을 다시 검수합니다.",
        next: "",
      },
      end: {
        say: "1단계에서 약속한 세 기능이 모두 실제로 작동합니다. 코드와 실측 결과는 GitHub에 공개했습니다.",
        next: "",
      },
    };

    let analyzeStart = 0;
    let genStart = 0;
    function pick() {
      const li = (s) => document.querySelector(`#progress li[data-step="${s}"]`);
      const analyzing = Boolean(li("analyze")?.classList.contains("active"));
      const generating = Boolean(li("generate")?.classList.contains("active"));
      const running = document.body.classList.contains("running");
      const tab = document.querySelector(".tab.active")?.dataset.tab;
      const done = Boolean(state.content) && !document.querySelector("#summary").classList.contains("hidden");
      if (analyzing) {
        if (!analyzeStart) analyzeStart = Date.now();
        return Date.now() - analyzeStart < 20000 ? C.analyze1 : C.analyze2;
      }
      analyzeStart = 0;
      if (generating) {
        if (!genStart) genStart = Date.now();
        if (Date.now() - genStart > 32000) return C.gen2; // 기능 1·2 설명이 끝난 뒤의 대기 구간
        return tab === "photo" ? C.f2 : C.f1;
      }
      genStart = 0;
      if (running && done) return C.fixing;
      if (done) {
        if (tab === "diff") return C.f1;
        if (tab === "photo") return C.f2;
        if (tab === "cards") return C.cards;
        if (tab === "check") return state.approved ? C.approved : C.check;
        return state.approved ? C.end : C.blog;
      }
      if (!state.photos.length) return C.intro;
      return state.photos.some((p) => p.masked) ? C.masked : C.photos;
    }

    let shown = null;
    function update() {
      try {
        const c = pick();
        if (c === shown) return;
        shown = c;
        bar.querySelector(".say").innerHTML = c.say;
        bar.querySelector(".next").textContent = c.next ? `다음 ▸ ${c.next}` : "";
      } catch (e) {
        /* 자막 오류는 앱에 영향을 주지 않는다 */
      }
    }
    setInterval(update, 300);
    update();

    document.querySelector("#run").addEventListener("click", () => {
      try {
        navigator.clipboard?.writeText(MEMO).catch(() => {});
      } catch {}
    });
  } catch (e) {
    console.error("[demo]", e);
  }
})();
