// 담당자 승인 단계 — 블로거 직접 체험 메모 + 협찬 표시 확인 후에만 게시 승인
// app.js 다음에 로드. renderCheck / renderBlog 를 감싸 패널·상태 띠를 덧붙인다(원래 렌더는 그대로).
(function () {
  "use strict";
  var EXP_HEADING = "직접 써 본 경험";
  var MIN_MEMO = 15;
  var A = { content: null, memo: "", checks: { warn: false, miss: false, photo: false } };

  function S() {
    try { return typeof state !== "undefined" ? state : null; } catch (e) { return null; }
  }
  function h(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hhmm(iso) {
    var t = iso ? new Date(iso) : new Date();
    return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  }
  // 새 실행(state.content 참조가 바뀜)이면 승인 상태 초기화
  function sync() {
    var s = S();
    if (!s) return;
    if (s.content !== A.content) {
      A.content = s.content;
      A.memo = "";
      A.checks = { warn: false, miss: false, photo: false };
      s.approved = null;
    }
  }

  function injectStyle() {
    if (document.getElementById("ap-style")) return;
    var css = [
      ".ap-panel{--navy:#0b1f4b;--blue:#1f5eff;--green:#0f9d58;--red:#d93025;border:2px solid var(--navy);border-radius:12px;padding:16px 18px;margin:0 0 20px;background:#fff;color:var(--navy)}",
      ".ap-panel h3{margin:0 0 4px;font-size:18px;color:var(--navy)}",
      ".ap-panel .ap-sub{margin:0 0 12px;font-size:13px;color:#4a5878}",
      ".ap-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 14px;padding:0;list-style:none}",
      ".ap-flow li{padding:6px 10px;border-radius:999px;font-size:13px;font-weight:700;background:#eef1f7;color:#6b7690;border:1px solid #d5dbe8}",
      ".ap-flow li.done{background:#e6f4ec;color:#0f9d58;border-color:#0f9d58}",
      ".ap-flow li.now{background:#1f5eff;color:#fff;border-color:#1f5eff}",
      ".ap-flow .ap-arrow{background:none;border:0;padding:0 2px;color:#9aa3b8;font-weight:400}",
      ".ap-memo-label{display:block;font-weight:800;margin:0 0 6px}",
      ".ap-memo-label em{font-style:normal;color:#d93025}",
      ".ap-memo{width:100%;box-sizing:border-box;min-height:72px;padding:10px;border:1.5px solid #c3cbe0;border-radius:8px;font:inherit;font-size:14px;resize:vertical}",
      ".ap-memo:focus{outline:none;border-color:#1f5eff}",
      ".ap-count{font-size:12px;color:#6b7690;text-align:right;margin:2px 0 10px}",
      ".ap-count.ok{color:#0f9d58}",
      ".ap-checks{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}",
      ".ap-checks li{display:flex;align-items:flex-start;gap:8px;font-size:14px}",
      ".ap-checks label{display:flex;align-items:flex-start;gap:8px;cursor:pointer}",
      ".ap-checks input{margin-top:3px;width:16px;height:16px}",
      ".ap-checks small{display:block;color:#6b7690;font-size:12px}",
      ".ap-block{color:#d93025;font-weight:800}",
      ".ap-auto{color:#0f9d58;font-weight:700;font-size:12px;margin-left:4px}",
      ".ap-btn{background:#0f9d58;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:15px;font-weight:800;cursor:pointer}",
      ".ap-btn:disabled{background:#c7ccd8;color:#fff;cursor:not-allowed}",
      ".ap-why{font-size:12px;color:#d93025;margin:6px 0 0}",
      ".ap-done{margin:10px 0 0;padding:8px 12px;border-radius:8px;background:#e6f4ec;color:#0f9d58;font-weight:800}",
      ".ap-band{padding:10px 14px;border-radius:8px;margin:0 0 14px;font-weight:800;font-size:14px}",
      ".ap-band.draft{background:#fff4d6;color:#7a5600;border:1px solid #f0d58a}",
      ".ap-band.ok{background:#e6f4ec;color:#0f9d58;border:1px solid #0f9d58}",
    ].join("\n");
    var st = document.createElement("style");
    st.id = "ap-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function facts() {
    var s = S() || {};
    var blog = (s.content && s.content.blog) || {};
    var ck = s.check || {};
    var photos = Array.isArray(s.photos) ? s.photos : [];
    var warnings = Array.isArray(ck.warnings) ? ck.warnings : (s.content && s.content.warnings) || [];
    var missions = Array.isArray(ck.missions) ? ck.missions : [];
    return {
      disclosure: String(blog.disclosure || "").trim(),
      warnN: warnings.length,
      missN: missions.filter(function (m) { return m && m.met === false; }).length,
      photoN: photos.length,
      maskedN: photos.filter(function (p) { return p && p.masked; }).length,
      approved: s.approved || null,
    };
  }

  function blockers(f) {
    var why = [];
    var len = A.memo.trim().length;
    if (!f.disclosure) why.push("협찬 표시 누락");
    if (len < MIN_MEMO) why.push("체험 메모 " + MIN_MEMO + "자 이상 필요 (현재 " + len + "자)");
    if (!A.checks.warn) why.push("확인 필요 경고 검토 체크");
    if (!A.checks.miss) why.push("미충족 미션 검토 체크");
    if (!A.checks.photo) why.push("사진 개인정보 확인 체크");
    return why;
  }

  function flowHtml(approved) {
    var steps = [
      ["① AI 생성 ✓", "done"],
      ["② 코드 검사 ✓", "done"],
      ["③ AI 미션 판정 ✓", "done"],
      [approved ? "④ 담당자 확인 ✓" : "④ 담당자 확인", approved ? "done" : "now"],
      [approved ? "⑤ 게시 승인 ✓" : "⑤ 게시 승인", approved ? "done" : ""],
    ];
    return '<ol class="ap-flow">' + steps.map(function (st, i) {
      return (i ? '<li class="ap-arrow" aria-hidden="true">→</li>' : "") + '<li class="' + st[1] + '">' + st[0] + "</li>";
    }).join("") + "</ol>";
  }

  function panelHtml() {
    var f = facts();
    var discLi = f.disclosure
      ? '<li><label><input type="checkbox" checked disabled> <span>협찬(경제적 이해관계) 표시 포함<span class="ap-auto">자동 확인</span><small>' + h(f.disclosure) + "</small></span></label></li>"
      : '<li><label><input type="checkbox" disabled> <span>협찬(경제적 이해관계) 표시 포함 <span class="ap-block">협찬 표시 누락 → 승인 차단</span></span></label></li>';
    return (
      '<section class="ap-panel" id="apPanel">' +
      "<h3>담당자 승인</h3>" +
      '<p class="ap-sub">AI 초안은 블로거의 실제 체험 메모와 담당자 확인이 더해져야 게시용 원고로 완성됩니다.</p>' +
      flowHtml(!!f.approved) +
      '<label class="ap-memo-label" for="apMemo">블로거 직접 체험 메모 <em>(필수)</em></label>' +
      '<textarea class="ap-memo" id="apMemo" placeholder="실제로 써 본 경험을 1~2문장으로 적어 주세요. 이 내용이 블로그 본문에 \'직접 써 본 경험\' 단락으로 들어갑니다.">' + h(A.memo) + "</textarea>" +
      '<div class="ap-count" id="apCount"></div>' +
      '<ul class="ap-checks">' +
      discLi +
      '<li><label><input type="checkbox" id="apWarn"' + (A.checks.warn ? " checked" : "") + "> <span>확인 필요 경고 " + f.warnN + "건 검토함</span></label></li>" +
      '<li><label><input type="checkbox" id="apMiss"' + (A.checks.miss ? " checked" : "") + "> <span>미충족 미션 " + f.missN + "건 검토함</span></label></li>" +
      '<li><label><input type="checkbox" id="apPhoto"' + (A.checks.photo ? " checked" : "") + "> <span>사진 개인정보 확인함 (가림 처리 " + f.maskedN + "/" + f.photoN + "장)</span></label></li>" +
      "</ul>" +
      '<button type="button" class="ap-btn" id="apBtn">' + (f.approved ? "메모 수정 반영해 다시 승인" : "게시 승인") + "</button>" +
      '<p class="ap-why" id="apWhy"></p>' +
      (f.approved ? '<p class="ap-done">승인됨 ' + hhmm(f.approved.at) + " · 블로거 체험 단락 추가됨</p>" : "") +
      "</section>"
    );
  }

  function refreshButton() {
    var btn = document.getElementById("apBtn");
    if (!btn) return;
    var why = blockers(facts());
    btn.disabled = why.length > 0;
    var w = document.getElementById("apWhy");
    if (w) w.textContent = why.length ? "승인 불가: " + why.join(" · ") : "";
    var c = document.getElementById("apCount");
    if (c) {
      var len = A.memo.trim().length;
      c.textContent = len + "자 / 최소 " + MIN_MEMO + "자";
      c.classList.toggle("ok", len >= MIN_MEMO);
    }
  }

  function approve() {
    var s = S();
    if (!s || !s.content || !s.content.blog) return;
    if (blockers(facts()).length) return; // 버튼 비활성 우회 방지
    var blog = s.content.blog;
    if (!Array.isArray(blog.sections)) blog.sections = [];
    var sec = { heading: EXP_HEADING, body: A.memo.trim(), photo_indexes: [], _blogger: true };
    var idx = -1;
    blog.sections.forEach(function (x, i) { if (x && (x._blogger || x.heading === EXP_HEADING)) idx = i; });
    if (idx >= 0) blog.sections[idx] = sec; else blog.sections.push(sec);
    s.approved = { at: new Date().toISOString() };
    try { if (typeof renderBlog === "function") renderBlog(); } catch (e) { console.warn("[approve] renderBlog", e); }
    mountPanel();
  }

  function mountPanel() {
    var tab = document.getElementById("tab-check");
    var s = S();
    if (!tab || !s || !s.content || !s.check) return;
    var old = document.getElementById("apPanel");
    if (old) old.remove();
    tab.insertAdjacentHTML("afterbegin", panelHtml());
    var memo = document.getElementById("apMemo");
    memo.addEventListener("input", function () { A.memo = memo.value; refreshButton(); });
    [["apWarn", "warn"], ["apMiss", "miss"], ["apPhoto", "photo"]].forEach(function (p) {
      var el = document.getElementById(p[0]);
      if (el) el.addEventListener("change", function () { A.checks[p[1]] = el.checked; refreshButton(); });
    });
    document.getElementById("apBtn").addEventListener("click", function () {
      try { approve(); } catch (e) { console.warn("[approve] approve", e); }
    });
    refreshButton();
  }

  function mountBand() {
    var tab = document.getElementById("tab-blog");
    var s = S();
    if (!tab || !s || !s.content) return;
    var old = document.getElementById("apBand");
    if (old) old.remove();
    var html = s.approved
      ? '<div class="ap-band ok" id="apBand">승인된 원고 · ' + hhmm(s.approved.at) + "</div>"
      : '<div class="ap-band draft" id="apBand">초안 — 담당자 승인 전 (⑤ 검수표에서 체험 메모 입력 후 승인)</div>';
    tab.insertAdjacentHTML("afterbegin", html);
  }

  function wrap(name, after) {
    var orig = window[name];
    if (typeof orig !== "function" || orig._apWrapped) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { sync(); after(); } catch (e) { console.warn("[approve] " + name, e); }
      return r;
    };
    wrapped._apWrapped = true;
    window[name] = wrapped;
  }

  try {
    injectStyle();
    wrap("renderCheck", mountPanel);
    wrap("renderBlog", mountBand);
    // 이미 결과가 그려진 상태에서 로드된 경우에도 즉시 반영
    var s0 = S();
    if (s0 && s0.content) {
      sync();
      if (document.getElementById("tab-check") && document.getElementById("tab-check").innerHTML.trim()) mountPanel();
      if (document.getElementById("tab-blog") && document.getElementById("tab-blog").innerHTML.trim()) mountBand();
    }
  } catch (e) {
    console.warn("[approve] init", e);
  }
})();
