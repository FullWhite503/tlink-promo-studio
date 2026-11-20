// 개인정보 가리기(모자이크) — 외부 AI 전송 전에 사진 속 이름·전화번호·얼굴을 드래그로 픽셀화
// app.js 다음에 로드되는 클래식 스크립트. app.js의 전역 state / renderThumbs를 사용한다.
// 어떤 오류가 나도 기존 앱 흐름이 멈추지 않도록 모든 진입점을 try/catch로 감싼다.
(function () {
  "use strict";

  const HINT_TEXT = "업로드 전에 개인정보를 가릴 수 있습니다 — 가린 사진만 외부 AI로 전송";
  const GUIDE_TEXT = "이름·전화번호·얼굴을 드래그해 가리세요. 가린 사진만 AI로 전송되고 카드뉴스에도 쓰입니다.";

  function isRunning() {
    return document.body.classList.contains("running");
  }
  function getPhotos() {
    try {
      // app.js의 const state는 전역 렉시컬 스코프에 있으므로 이름으로 접근
      return typeof state !== "undefined" && state && Array.isArray(state.photos) ? state.photos : [];
    } catch (e) {
      return [];
    }
  }

  // ---------- 스타일 주입 ----------
  function injectStyle() {
    if (document.getElementById("tm-style")) return;
    const css = `
.thumb .tm-btn { position: absolute; left: auto; top: auto; right: 3px; bottom: 3px; border: 0; background: var(--blue, #1f5eff); color: #fff;
  font-size: 10px; line-height: 1.4; padding: 1px 5px; border-radius: 6px; cursor: pointer; font-weight: 700; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.thumb .tm-btn:hover { background: var(--navy, #0b1f4b); }
.thumb .tm-btn:disabled { opacity: .45; cursor: not-allowed; }
.thumb .tm-badge { position: absolute; left: 4px; top: 22px; background: #0f9d58; color: #fff; font-size: 10px; font-weight: 700;
  padding: 1px 5px; border-radius: 6px; line-height: 1.4; }
.thumb.tm-masked { border: 2px solid #0f9d58; }
body.running .thumb .tm-btn { pointer-events: none; opacity: .45; }
.tm-hint { margin: -2px 0 8px; font-size: 12px; color: var(--navy, #0b1f4b); background: #eef3ff; border-left: 3px solid var(--blue, #1f5eff);
  padding: 6px 8px; border-radius: 6px; }
.tm-overlay { position: fixed; inset: 0; background: rgba(11,31,75,.72); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.tm-modal { background: #fff; border-radius: 14px; padding: 16px; max-width: 94vw; max-height: 94vh; display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 10px 40px rgba(0,0,0,.35); }
.tm-modal h3 { margin: 0; font-size: 16px; color: var(--navy, #0b1f4b); }
.tm-guide { margin: 0; font-size: 13px; color: #33415c; }
.tm-stage { display: flex; justify-content: center; background: #f2f4f8; border-radius: 8px; padding: 6px; }
.tm-canvas { display: block; cursor: crosshair; touch-action: none; user-select: none; }
.tm-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.tm-actions .tm-count { margin-right: auto; font-size: 12px; color: #5a6680; }
.tm-actions button { border: 1px solid var(--line, #dfe4ee); background: #fff; color: var(--navy, #0b1f4b); padding: 8px 14px; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer; }
.tm-actions button.tm-apply { background: var(--blue, #1f5eff); border-color: var(--blue, #1f5eff); color: #fff; }
.tm-actions button:disabled { opacity: .45; cursor: not-allowed; }
`;
    const s = document.createElement("style");
    s.id = "tm-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- ③ 사진 단계 안내 한 줄 ----------
  function insertHint() {
    if (document.getElementById("tm-hint")) return;
    const thumbs = document.getElementById("thumbs");
    const step = thumbs && thumbs.closest(".step");
    if (!step) return;
    const head = step.querySelector(".step-head");
    const p = document.createElement("p");
    p.id = "tm-hint";
    p.className = "tm-hint";
    p.textContent = HINT_TEXT;
    if (head && head.nextSibling) step.insertBefore(p, head.nextSibling);
    else step.insertBefore(p, step.firstChild);
  }

  // ---------- 썸네일에 버튼·배지 ----------
  function addMaskButtons() {
    const box = document.getElementById("thumbs");
    if (!box) return;
    const photos = getPhotos();
    const running = isRunning();
    Array.from(box.querySelectorAll(".thumb")).forEach((el, i) => {
      const p = photos[i];
      if (!p || el.querySelector(".tm-btn")) return;
      if (p.masked) {
        el.classList.add("tm-masked");
        const badge = document.createElement("span");
        badge.className = "tm-badge";
        badge.textContent = "가림 ✓";
        el.appendChild(badge);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tm-btn";
      btn.textContent = "가리기";
      btn.title = "이름·전화번호·얼굴을 모자이크로 가리기";
      btn.disabled = running;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (isRunning()) return;
          openEditor(p);
        } catch (err) {
          console.error("[mask] 편집기 열기 실패", err);
          alert("가리기 편집기를 여는 중 오류가 발생했습니다: " + (err && err.message ? err.message : err));
        }
      });
      el.appendChild(btn);
    });
  }

  // 실행 상태(body.running)가 바뀌면 버튼 disabled 동기화
  function watchRunning() {
    try {
      new MutationObserver(() => {
        const running = isRunning();
        document.querySelectorAll(".thumb .tm-btn").forEach((b) => (b.disabled = running));
      }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {
      console.error("[mask] running 감시 실패", e);
    }
  }

  // ---------- 픽셀화 (원본 해상도 캔버스에서 블록 평균색) ----------
  function pixelate(ctx, x, y, w, h, block) {
    const img = ctx.getImageData(x, y, w, h);
    const d = img.data;
    for (let by = 0; by < h; by += block) {
      for (let bx = 0; bx < w; bx += block) {
        const bw = Math.min(block, w - bx);
        const bh = Math.min(block, h - by);
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = by; yy < by + bh; yy++) {
          let o = (yy * w + bx) * 4;
          for (let xx = 0; xx < bw; xx++, o += 4) {
            r += d[o]; g += d[o + 1]; b += d[o + 2]; a += d[o + 3]; n++;
          }
        }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
        for (let yy = by; yy < by + bh; yy++) {
          let o = (yy * w + bx) * 4;
          for (let xx = 0; xx < bw; xx++, o += 4) {
            d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
          }
        }
      }
    }
    ctx.putImageData(img, x, y);
  }

  // ---------- 모달 편집기 ----------
  let openState = null;

  function openEditor(photo) {
    if (!photo || !photo.url || openState) return;
    const img = new Image();
    img.onload = () => {
      try {
        buildEditor(photo, img);
      } catch (err) {
        console.error("[mask] 편집기 생성 실패", err);
        closeEditor();
        alert("가리기 편집기를 만들지 못했습니다: " + (err && err.message ? err.message : err));
      }
    };
    img.onerror = () => alert("사진을 불러오지 못했습니다.");
    img.src = photo.url;
  }

  function buildEditor(photo, img) {
    const W = img.naturalWidth || photo.w;
    const H = img.naturalHeight || photo.h;
    if (!W || !H) throw new Error("사진 크기를 알 수 없습니다");

    // 원본 해상도 오프스크린 캔버스 (실제 처리는 여기서)
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(img, 0, 0, W, H);
    const block = Math.max(8, Math.round(Math.min(W, H) / 40));

    // 화면 표시 캔버스 (화면 크기에 맞춤)
    const maxW = Math.min(960, window.innerWidth * 0.9 - 40);
    const maxH = window.innerHeight * 0.94 - 170;
    const scale = Math.min(1, maxW / W, Math.max(120, maxH) / H);
    const view = document.createElement("canvas");
    view.className = "tm-canvas";
    view.width = Math.max(1, Math.round(W * scale));
    view.height = Math.max(1, Math.round(H * scale));
    const vctx = view.getContext("2d");

    const overlay = document.createElement("div");
    overlay.className = "tm-overlay";
    overlay.innerHTML = `
      <div class="tm-modal" role="dialog" aria-modal="true" aria-label="개인정보 가리기">
        <h3>개인정보 가리기 · ${escText(photo.name || "사진")}</h3>
        <p class="tm-guide">${GUIDE_TEXT}</p>
        <div class="tm-stage"></div>
        <div class="tm-actions">
          <span class="tm-count">가린 영역 0곳</span>
          <button type="button" class="tm-undo" disabled>되돌리기(마지막 1회)</button>
          <button type="button" class="tm-cancel">취소</button>
          <button type="button" class="tm-apply">적용</button>
        </div>
      </div>`;
    overlay.querySelector(".tm-stage").appendChild(view);
    document.body.appendChild(overlay);

    const undoBtn = overlay.querySelector(".tm-undo");
    const countEl = overlay.querySelector(".tm-count");
    let count = 0;
    let undo = null; // { x, y, data }
    let drag = null; // { x0, y0, x1, y1 } (표시 캔버스 좌표)

    function redraw() {
      vctx.imageSmoothingEnabled = true;
      vctx.clearRect(0, 0, view.width, view.height);
      vctx.drawImage(off, 0, 0, view.width, view.height);
      if (drag) {
        const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
        vctx.fillStyle = "rgba(31,94,255,.18)";
        vctx.fillRect(x, y, w, h);
        vctx.setLineDash([6, 4]);
        vctx.lineWidth = 2;
        vctx.strokeStyle = "#1f5eff";
        vctx.strokeRect(x + 0.5, y + 0.5, w, h);
        vctx.setLineDash([]);
      }
    }
    function updateUi() {
      countEl.textContent = `가린 영역 ${count}곳`;
      undoBtn.disabled = !undo;
    }
    function toView(e) {
      const r = view.getBoundingClientRect();
      const x = ((e.clientX - r.left) * view.width) / r.width;
      const y = ((e.clientY - r.top) * view.height) / r.height;
      return { x: Math.max(0, Math.min(view.width, x)), y: Math.max(0, Math.min(view.height, y)) };
    }

    view.addEventListener("pointerdown", (e) => {
      try {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const p = toView(e);
        drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        try { view.setPointerCapture(e.pointerId); } catch (_) {}
        redraw();
      } catch (err) { console.error("[mask]", err); }
    });
    view.addEventListener("pointermove", (e) => {
      if (!drag) return;
      try {
        const p = toView(e);
        drag.x1 = p.x;
        drag.y1 = p.y;
        redraw();
      } catch (err) { console.error("[mask]", err); }
    });
    function finishDrag() {
      if (!drag) return;
      const d = drag;
      drag = null;
      try {
        // 표시 좌표 → 원본 좌표
        const k = W / view.width;
        let x = Math.floor(Math.min(d.x0, d.x1) * k);
        let y = Math.floor(Math.min(d.y0, d.y1) * k);
        let x2 = Math.ceil(Math.max(d.x0, d.x1) * k);
        let y2 = Math.ceil(Math.max(d.y0, d.y1) * k);
        x = Math.max(0, x); y = Math.max(0, y);
        x2 = Math.min(W, x2); y2 = Math.min(H, y2);
        const w = x2 - x, h = y2 - y;
        if (w >= 3 && h >= 3) {
          undo = { x, y, data: octx.getImageData(x, y, w, h) };
          pixelate(octx, x, y, w, h, block);
          count++;
        }
      } catch (err) {
        console.error("[mask] 픽셀화 실패", err);
      }
      redraw();
      updateUi();
    }
    view.addEventListener("pointerup", finishDrag);
    view.addEventListener("pointercancel", finishDrag);
    view.addEventListener("lostpointercapture", finishDrag);

    undoBtn.addEventListener("click", () => {
      try {
        if (!undo) return;
        octx.putImageData(undo.data, undo.x, undo.y);
        undo = null;
        count = Math.max(0, count - 1);
        redraw();
        updateUi();
      } catch (err) { console.error("[mask] 되돌리기 실패", err); }
    });
    overlay.querySelector(".tm-cancel").addEventListener("click", closeEditor);
    overlay.querySelector(".tm-apply").addEventListener("click", () => {
      try {
        if (isRunning()) {
          alert("콘텐츠 생성 중에는 사진을 바꿀 수 없습니다.");
          return;
        }
        if (count > 0) {
          const photos = getPhotos();
          const idx = photos.indexOf(photo);
          if (idx < 0) throw new Error("사진이 목록에서 삭제되었습니다");
          const url = off.toDataURL("image/jpeg", 0.85);
          photo.url = url;
          photo.data = url.split(",")[1];
          photo.media_type = "image/jpeg";
          photo.w = W;
          photo.h = H;
          photo.masked = true;
        }
        closeEditor();
        if (typeof window.renderThumbs === "function") window.renderThumbs();
      } catch (err) {
        console.error("[mask] 적용 실패", err);
        alert("가린 사진을 적용하지 못했습니다: " + (err && err.message ? err.message : err));
      }
    });

    const onKey = (e) => {
      if (e.key === "Escape") closeEditor();
    };
    document.addEventListener("keydown", onKey);
    openState = { overlay, onKey };
    redraw();
    updateUi();
  }

  function closeEditor() {
    if (!openState) return;
    try {
      document.removeEventListener("keydown", openState.onKey);
      openState.overlay.remove();
    } catch (e) {
      console.error("[mask]", e);
    }
    openState = null;
  }

  function escText(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 설치 ----------
  try {
    injectStyle();
    insertHint();
    watchRunning();
    const orig = window.renderThumbs;
    if (typeof orig === "function" && !orig.__tmWrapped) {
      const wrapped = function (...a) {
        const r = orig.apply(this, a);
        try {
          addMaskButtons();
        } catch (e) {
          console.error("[mask] 버튼 추가 실패", e);
        }
        return r;
      };
      wrapped.__tmWrapped = true;
      window.renderThumbs = wrapped;
    }
    addMaskButtons(); // 이미 올라온 사진이 있으면 바로 버튼 표시
  } catch (e) {
    console.error("[mask] 초기화 실패 — 기존 앱은 그대로 동작합니다", e);
  }
})();
