// 티링크 프로모 스튜디오 — 읽기 전용 정적 데모용 shim (GitHub Pages)
// 원본 위치: scripts/static-shim.js → scripts/build_static_demo.py 가 docs/static-shim.js 로 복사한다.
// app.js 보다 먼저 로드되어 /api/* 요청을 가로채고, static-data.js 에 담긴 "저장된 실제 생성 결과"를 화면에 띄운다.
// 이 페이지에는 서버도 AI 호출도 없다. 어떤 오류가 나도 페이지가 멈추지 않도록 모든 진입점을 try/catch 로 감싼다.
(function () {
  "use strict";

  var REPO_URL = "https://github.com/FullWhite503/tlink-promo-studio";
  var READONLY_MSG =
    "이 페이지는 저장된 실제 생성 결과를 보여 주는 읽기 전용 데모입니다. 새로 생성하려면 GitHub README의 실행 방법대로 로컬에서 실행해 주세요.";
  var DATA = null;
  try {
    DATA = window.__STATIC_DEMO__ || null;
  } catch (e) {}

  function warn(where, e) {
    try {
      console.warn("[static-shim] " + where, e);
    } catch (_) {}
  }

  // ---------- 1) fetch 가로채기 ----------
  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  function endsWith(path, tail) {
    return path.slice(-tail.length) === tail;
  }
  // app.js 는 절대 경로 fetch("/api/...") 를 쓴다. GitHub Pages 하위 경로(/tlink-promo-studio/)에서도
  // 가로챌 수 있도록 pathname 의 "끝"이 일치하는지만 본다.
  function pathOf(input) {
    var raw = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    try {
      return new URL(raw, location.href).pathname.replace(/\/+$/, "");
    } catch (e) {
      return String(raw).split(/[?#]/)[0].replace(/\/+$/, "");
    }
  }
  function methodOf(input, init) {
    var m = (init && init.method) || (input && typeof input === "object" && input.method) || "GET";
    return String(m).toUpperCase();
  }
  function route(path, method) {
    if (endsWith(path, "/api/status")) return jsonResponse({ hasKey: false, model: "claude-opus-5-5", static: true });
    if (endsWith(path, "/api/samples")) return jsonResponse((DATA && DATA.samples) || { product: "", guideline: "" });
    if (endsWith(path, "/api/last-run")) {
      if (method === "POST") return jsonResponse({ ok: true }); // 읽기 전용: 저장하지 않는다
      if (DATA && DATA.lastRun) return jsonResponse(DATA.lastRun);
      return jsonResponse({ error: "저장된 결과가 없습니다." }, 404);
    }
    if (endsWith(path, "/api/analyze") || endsWith(path, "/api/generate")) return jsonResponse({ error: READONLY_MSG }, 400);
    return null; // 그 밖의 요청은 원래 fetch 로
  }
  try {
    var origFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
      try {
        var res = route(pathOf(input), methodOf(input, init));
        if (res) return Promise.resolve(res);
      } catch (e) {
        warn("fetch", e);
      }
      if (origFetch) return origFetch(input, init);
      return Promise.reject(new TypeError("fetch를 사용할 수 없습니다."));
    };
  } catch (e) {
    warn("fetch 설치", e);
  }

  // ---------- 2) 저장 결과 자동 표시 + 읽기 전용 표시 ----------
  function el(id) {
    return document.getElementById(id);
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  // 저장 시각은 방문자의 시간대와 무관하게 한국 시간(KST, UTC+9)으로 고정해 보여 준다(정적 요약과 같은 값).
  function kstText(iso) {
    try {
      var t = new Date(iso);
      if (!iso || isNaN(t.getTime())) return "";
      var k = new Date(t.getTime() + 9 * 3600 * 1000);
      return (
        k.getUTCFullYear() + "-" + pad(k.getUTCMonth() + 1) + "-" + pad(k.getUTCDate()) + " " + pad(k.getUTCHours()) + ":" + pad(k.getUTCMinutes())
      );
    } catch (e) {
      return "";
    }
  }
  // app.js 의 요약 카드와 같은 계산: (분석 + 생성).toFixed(0)
  function aiSeconds(run) {
    try {
      var t = (run && run.timings) || {};
      var s = (Number(t.analyze) || 0) + (Number(t.generate) || 0);
      return s > 0 ? s.toFixed(0) : "";
    } catch (e) {
      return "";
    }
  }
  // 빌드 스크립트가 공개용으로 흐리게 처리한 사진 수(AI 분석이 '개인정보 주의'로 표시한 사진)
  function blurredCount() {
    try {
      var ps = (DATA && DATA.lastRun && DATA.lastRun.photos) || [];
      var n = 0;
      for (var i = 0; i < ps.length; i++) if (ps[i] && ps[i].publicBlur) n++;
      return n;
    } catch (e) {
      return 0;
    }
  }
  function bannerText() {
    var run = (DATA && DATA.lastRun) || {};
    var when = kstText(run.savedAt);
    var sec = aiSeconds(run);
    var nb = blurredCount();
    return (
      "읽기 전용 데모 — " +
      (when ? when + "에 실제로 생성한 결과입니다" : "실제로 생성해 저장한 결과입니다") +
      (sec ? "(AI 생성 " + sec + "초)" : "") +
      ". 탭·검수표·승인 패널·사진 가리기·PNG 다운로드를 직접 눌러 볼 수 있습니다. 새로 생성하려면 GitHub README대로 로컬에서 실행하세요." +
      (nb ? " AI가 '개인정보 주의'로 표시한 사진 " + nb + "장은 공개용으로 흐리게 처리했습니다." : "")
    );
  }
  // fix.js 는 검수표를 그릴 때마다 #fixBtn(미충족 미션 보완 재생성)을 새로 만든다.
  // 이 페이지에서는 /api/generate 가 막혀 있으므로, 눌러도 반응이 없어 보이지 않게 처음부터 잠가 둔다.
  var FIX_LOCK_TEXT = "보완 재생성은 로컬 실행 필요 (읽기 전용 데모)";
  function lockFixBtn() {
    try {
      var b = el("fixBtn");
      if (!b) return;
      if (b.disabled && b.textContent === FIX_LOCK_TEXT) return; // 이미 잠근 상태(관찰자 재진입 방지)
      b.disabled = true;
      b.textContent = FIX_LOCK_TEXT;
      b.title = READONLY_MSG;
      b.style.cursor = "not-allowed";
    } catch (e) {
      warn("fixBtn", e);
    }
  }
  var fixWatched = false;
  function watchFixBtn() {
    try {
      if (!fixWatched && typeof MutationObserver === "function" && document.body) {
        new MutationObserver(lockFixBtn).observe(document.body, { childList: true, subtree: true });
        fixWatched = true;
      }
    } catch (e) {
      warn("observer", e);
    }
    lockFixBtn();
  }
  function applyStaticUi() {
    try {
      var pill = el("keyStatus");
      if (pill) {
        pill.textContent = "● 읽기 전용 데모 (저장된 실제 결과)";
        pill.classList.remove("bad");
        pill.classList.remove("ok");
      }
    } catch (e) {
      warn("keyStatus", e);
    }
    try {
      var run = el("run");
      if (run) {
        run.disabled = true;
        run.textContent = "새 생성은 로컬 실행 필요 (읽기 전용 데모)";
        run.title = READONLY_MSG;
        run.style.cursor = "not-allowed";
      }
    } catch (e) {
      warn("run", e);
    }
    try {
      // app.js 의 checkLastRun 이 hidden 클래스를 떼어도 다시 보이지 않도록 인라인 스타일로 숨긴다
      var rp = el("replay");
      if (rp) rp.style.display = "none";
    } catch (e) {
      warn("replay", e);
    }
  }
  function setBanner(ok) {
    try {
      var b = el("replayBanner");
      if (!b) return;
      b.textContent = ok
        ? bannerText()
        : "읽기 전용 데모 — 저장된 결과를 화면에 자동으로 띄우지 못했습니다. 같은 내용을 페이지 아래의 정적 요약에서 볼 수 있습니다.";
      try {
        var a = document.createElement("a");
        a.href = REPO_URL;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "GitHub 저장소 열기";
        b.appendChild(document.createTextNode(" "));
        b.appendChild(a);
      } catch (e2) {}
      b.classList.remove("hidden");
    } catch (e) {
      warn("banner", e);
    }
  }
  function waitFor(cond, timeoutMs, done) {
    var t0 = Date.now();
    (function tick() {
      var ok = false;
      try {
        ok = !!cond();
      } catch (e) {}
      if (ok) return done(true);
      if (Date.now() - t0 >= timeoutMs) return done(false);
      setTimeout(tick, 50);
    })();
  }
  function initDone() {
    // app.js 의 init() 은 마지막에 #keyStatus 에 ok/bad 클래스를 붙인다
    var p = el("keyStatus");
    return !!p && (p.classList.contains("ok") || p.classList.contains("bad"));
  }
  function replayDone() {
    // #replay 핸들러는 모든 탭을 그린 뒤 마지막에 #replayBanner 를 보이게 한다
    var s = el("summary");
    var b = el("replayBanner");
    return !!s && !s.classList.contains("hidden") && !!b && !b.classList.contains("hidden");
  }
  function fillSamplesIfEmpty() {
    // init() 이 실패했을 때의 대비: 검수 로직(runChecks)이 가이드라인 원문을 읽으므로 비어 있으면 채운다
    var sm = (DATA && DATA.samples) || {};
    ["product", "guideline"].forEach(function (id) {
      var ta = el(id);
      if (ta && !ta.value && sm[id]) ta.value = sm[id];
    });
  }
  function start() {
    // DOMContentLoaded 시점이면 app.js·mask.js·approve.js·fix.js 가 모두 실행돼 렌더 함수 감싸기가 끝나 있다
    waitFor(initDone, 6000, function () {
      try {
        fillSamplesIfEmpty();
      } catch (e) {
        warn("samples", e);
      }
      applyStaticUi();
      watchFixBtn();
      try {
        var rp = el("replay");
        if (rp) rp.click(); // app.js 의 "저장된 마지막 실제 결과 보기" 흐름을 그대로 사용
      } catch (e) {
        warn("replay click", e);
      }
      waitFor(replayDone, 20000, function (ok) {
        applyStaticUi();
        lockFixBtn();
        setBanner(ok);
      });
    });
  }
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        try {
          start();
        } catch (e) {
          warn("start", e);
        }
      });
    } else {
      setTimeout(function () {
        try {
          start();
        } catch (e) {
          warn("start", e);
        }
      }, 0);
    }
  } catch (e) {
    warn("설치", e);
  }
})();
