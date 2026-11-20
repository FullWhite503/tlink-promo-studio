// 티링크 프로모 스튜디오 — 화면 로직
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const state = { samples: null, photos: [], pdf: null, analysis: null, content: null, check: null, timings: {} };

// ---------- 초기화 ----------
init();
async function init() {
  const [status, samples] = await Promise.all([
    fetch("/api/status").then((r) => r.json()),
    fetch("/api/samples").then((r) => r.json()),
  ]);
  state.samples = samples;
  $("#product").value = samples.product;
  $("#guideline").value = samples.guideline;
  const pill = $("#keyStatus");
  pill.textContent = status.hasKey ? `● ${status.model} 연결됨` : "● API 키 없음 (.env 설정 필요)";
  pill.classList.add(status.hasKey ? "ok" : "bad");
}
$$("[data-reset]").forEach((b) =>
  b.addEventListener("click", () => ($("#" + b.dataset.reset).value = state.samples[b.dataset.reset]))
);
$$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
function showTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-body").forEach((b) => b.classList.toggle("hidden", b.id !== "tab-" + name));
}

// ---------- 입력: 사진 ----------
const drop = $("#drop");
$("#photos").addEventListener("change", (e) => addPhotos(e.target.files));
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over"))));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", (e) => (e.preventDefault(), addPhotos(e.dataTransfer.files)));

async function addPhotos(files) {
  if (document.body.classList.contains("running")) return; // 실행 중에는 사진 번호가 바뀌지 않게 잠금
  // 파일 선택 창이 돌려주는 순서는 일정하지 않으므로 파일 이름 순(1_, 2_, …)으로 정렬해 사진 번호를 고정한다
  const sorted = [...files].filter((f) => f.type.startsWith("image/")).sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));
  for (const f of sorted) {
    if (state.photos.length >= 5) break;
    state.photos.push(await resizeImage(f, 1280)); // 느린 네트워크 대비: 업로드 용량·이미지 토큰 축소
  }
  renderThumbs();
  $("#photos").value = "";
}
function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.8);
      URL.revokeObjectURL(img.src);
      resolve({ name: file.name, media_type: "image/jpeg", data: url.split(",")[1], url, w: c.width, h: c.height });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function renderThumbs() {
  $("#thumbs").innerHTML = state.photos
    .map((p, i) => `<div class="thumb"><img src="${p.url}" alt=""><b>사진${i + 1}</b><button data-rm="${i}">✕</button></div>`)
    .join("");
  $$("[data-rm]").forEach((b) =>
    b.addEventListener("click", () => {
      state.photos.splice(Number(b.dataset.rm), 1);
      renderThumbs();
    })
  );
}
$("#pdf").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    state.pdf = { name: f.name, data: r.result.split(",")[1] };
    $("#pdfName").textContent = `첨부됨: ${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`;
  };
  r.readAsDataURL(f);
});

// ---------- 실행 ----------
$("#run").addEventListener("click", run);
async function run() {
  const btn = $("#run");
  btn.disabled = true;
  document.body.classList.add("running");
  $("#replayBanner").classList.add("hidden");
  $("#error").classList.add("hidden");
  $("#progress").classList.remove("hidden");
  $$("#progress li").forEach((li) => (li.className = "", (li.querySelector("em").textContent = "")));
  const product = $("#product").value;
  const guideline = $("#guideline").value;
  try {
    const a = await step("analyze", () =>
      api("/api/analyze", {
        product,
        guideline,
        pdf: state.pdf,
        images: state.photos.map(({ media_type, data }) => ({ media_type, data })),
      })
    );
    state.analysis = a.data;
    state.timings.analyze = a.meta.seconds;
    state.defaultGuideline = Boolean(a.meta.defaultGuideline);
    renderDiff();
    renderPhotos();
    $("#empty").classList.add("hidden");
    showTab("diff");

    const g = await step("generate", () => api("/api/generate", { analysis: state.analysis, product, guideline }));
    state.content = g.data;
    state.timings.generate = g.meta.seconds;
    state.retried = Boolean(g.meta.retried);
    if (g.meta.missing?.length) {
      $("#error").textContent = `일부 항목이 비어 있습니다(${g.meta.missing.join(", ")}). 다시 생성하면 채워질 수 있습니다.`;
      $("#error").classList.remove("hidden");
    }

    await step("check", async () => {
      state.check = runChecks(state.analysis.guideline, state.content);
      return { meta: { seconds: 0 } };
    });
    await renderResults();
    showTab("blog");
    saveLastRun(); // 네트워크 장애 대비: 이번 실제 결과를 저장
  } catch (err) {
    $("#error").textContent = err.message;
    $("#error").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    document.body.classList.remove("running");
  }
}
async function renderResults() {
  renderDiff();
  renderPhotos();
  renderBlog();
  await renderCards();
  renderCheck();
  renderSummary();
  $("#empty").classList.add("hidden");
}

// ---------- 저장된 마지막 실제 결과 (네트워크 장애 대비) ----------
async function saveLastRun() {
  try {
    await fetch("/api/last-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savedAt: new Date().toISOString(),
        timings: state.timings,
        retried: state.retried,
        defaultGuideline: state.defaultGuideline,
        analysis: state.analysis,
        content: state.content,
        photos: state.photos.map(({ name, url }) => ({ name, url })),
      }),
    });
    $("#replay").classList.remove("hidden");
  } catch {}
}
async function checkLastRun() {
  const r = await fetch("/api/last-run").catch(() => null);
  if (r?.ok) $("#replay").classList.remove("hidden");
}
checkLastRun();
$("#replay").addEventListener("click", async () => {
  const r = await fetch("/api/last-run");
  if (!r.ok) return;
  const s = await r.json();
  Object.assign(state, { analysis: s.analysis, content: s.content, timings: s.timings || {}, retried: s.retried, defaultGuideline: s.defaultGuideline, photos: s.photos || [] });
  renderThumbs();
  state.check = runChecks(state.analysis.guideline, state.content);
  await renderResults();
  const t = new Date(s.savedAt);
  const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  const sec = ((s.timings?.analyze || 0) + (s.timings?.generate || 0)).toFixed(0);
  $("#replayBanner").textContent = `저장된 실제 생성 결과를 다시 보여 주는 중입니다 · ${hhmm}에 생성 · AI 생성 ${sec}초 (네트워크 장애 대비 재표시)`;
  $("#replayBanner").classList.remove("hidden");
  $("#error").classList.add("hidden");
  showTab("blog");
});

async function step(name, fn) {
  const li = $(`#progress li[data-step="${name}"]`);
  li.className = "active";
  const t0 = performance.now();
  const timer = setInterval(() => (li.querySelector("em").textContent = `${((performance.now() - t0) / 1000).toFixed(0)}초`), 500);
  try {
    const r = await fn();
    li.className = "done";
    li.querySelector("em").textContent = `${((performance.now() - t0) / 1000).toFixed(1)}초`;
    return r;
  } catch (e) {
    li.className = "";
    throw e;
  } finally {
    clearInterval(timer);
  }
}
async function api(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `서버 오류 (${r.status})` }));
  if (!r.ok) throw new Error(j.error || `서버 오류 (${r.status})`);
  return j;
}

// ---------- 유틸 ----------
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s = "") => String(s).toLowerCase().replace(/\s+/g, "");
const has = (text, kw) => norm(text).includes(norm(kw));
const stripEv = (s = "") => String(s).replace(/\s?⟦[^⟧]*⟧/g, "");
const photoUrl = (i) => state.photos[i - 1]?.url;

// 필수/제목 키워드 하이라이트 + 근거 태그 배지
function decorate(text) {
  const kws = [...new Set([...(state.analysis.guideline.required_keywords || []), ...(state.analysis.guideline.title_keywords || [])])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  let html = esc(text);
  for (const kw of kws) {
    const pattern = esc(kw).split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
    html = html.replace(new RegExp(`(${pattern})`, "gi"), "<mark>$1</mark>");
  }
  html = html.replace(/⟦([^⟧]*)⟧/g, '<span class="ev">$1</span>');
  return html.replace(/\n/g, "<br>");
}

// ---------- ① 차별점 ----------
function renderDiff() {
  const a = state.analysis;
  $("#tab-diff").innerHTML = `
    <div class="positioning"><b>${esc(a.product_name)}</b> — ${esc(a.positioning)}</div>
    <div class="diff-grid">${a.differentiators
      .map(
        (d, i) => `<div class="diff">
        <h4>${i + 1}. ${esc(d.title)}</h4>
        <div class="row"><label>기술 특징</label>${esc(d.feature)}</div>
        <div class="row"><label>고객 이익</label>${esc(d.benefit)}</div>
        <div class="row evidence"><label>근거</label>“${esc(d.evidence)}”</div>
        <span class="badge ${d.evidence_source === "확인 필요" ? "warn" : ""}">${esc(d.evidence_source)}</span>
      </div>`
      )
      .join("")}</div>
    <h3 class="sub">일반적인 방식 vs 티링크</h3>
    <table><tr><th>관점</th><th>일반적인 방식</th><th>티링크</th></tr>
      ${a.comparison.map((c) => `<tr><td><b>${esc(c.aspect)}</b></td><td>${esc(c.typical)}</td><td>${esc(c.tlink)}</td></tr>`).join("")}
    </table>`;
}

// ---------- ② 사진 ----------
// "없음", "해당 없음", "-" 같은 값은 개인정보 주의 사항이 없는 것으로 본다
const hasPrivacy = (note) => {
  const s = String(note || "").trim().replace(/[.\s]/g, "");
  if (!s || /^(없음|해당없음|-|none|n\/a)$/i.test(s)) return false;
  // "특이 개인정보 없음", "익명 처리됨"처럼 문제가 없다는 메모는 경고로 보지 않는다
  if (/필요|노출|주의|보임|보입니다|가려야/.test(s)) return true;
  return !/없음|익명처리|해당없/.test(s);
};
function renderPhotos() {
  const ps = state.analysis.photos;
  const structure = state.analysis.guideline.structure || [];
  $("#tab-photo").innerHTML = ps.length
    ? ps
        .map(
          (p) => `<div class="photo-row">
        <div class="photo-thumb">
          ${photoUrl(p.index) ? `<img src="${photoUrl(p.index)}" alt="${esc(p.alt_text)}">` : ""}
          ${hasPrivacy(p.privacy_note) ? `<span class="privacy-badge">개인정보 주의</span>` : ""}
        </div>
        <div>
          <h4>사진${p.index} · ${esc(p.screen_type)}</h4>
          <div class="row"><label>보이는 것</label>${esc(p.what_is_visible)}</div>
          <div class="row"><label>증명</label>${p.proves.map((t) => `<span class="badge">${esc(t)}</span>`).join(" ") || "-"}</div>
          <div class="row"><label>미션 증거</label>${(p.missions || []).map((n) => `<span class="badge">미션 ${n}</span>`).join(" ") || '<span class="badge warn">해당 미션 화면 아님</span>'}</div>
          <div class="row"><label>배치</label>블로그 ${p.blog_section}단락${structure[p.blog_section - 1] ? ` · ${esc(structure[p.blog_section - 1])}` : ""}</div>
          <div class="row"><label>캡션</label>${esc(p.caption)}</div>
          <div class="row"><label>대체텍스트</label>${esc(p.alt_text)}</div>
          ${hasPrivacy(p.privacy_note) ? `<div class="privacy">⚠ ${esc(p.privacy_note)}</div>` : ""}
        </div></div>`
        )
        .join("")
    : `<p class="hint">올린 사진이 없어 사진 분석을 건너뛰었습니다. 현장사진을 올리면 사진별 증명 포인트와 배치 위치를 제안합니다.</p>`;
}

// ---------- ③ 블로그 ----------
function blogPlainText() {
  const b = state.content.blog;
  const parts = [b.title, "", ...(b.disclosure ? [b.disclosure, ""] : []), stripEv(b.intro), ""];
  b.sections.forEach((s) => {
    parts.push(`■ ${s.heading}`);
    s.photo_indexes.forEach((i) => parts.push(`[사진${i}: ${state.analysis.photos.find((p) => p.index === i)?.caption || ""}]`));
    parts.push(stripEv(s.body), "");
  });
  parts.push(stripEv(b.conclusion), "", b.footer, "", b.tags.map((t) => "#" + t.replace(/^#/, "")).join(" "));
  return parts.join("\n");
}
function renderBlog() {
  const b = state.content.blog;
  const fig = (i) => {
    const p = state.analysis.photos.find((x) => x.index === i);
    return photoUrl(i) ? `<figure><img src="${photoUrl(i)}" alt="${esc(p?.alt_text)}"><figcaption>사진${i} · ${esc(p?.caption)}</figcaption></figure>` : "";
  };
  $("#tab-blog").innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="copyBlog">본문 복사 (근거 태그 제외)</button>
      <label><input type="checkbox" id="tEv" checked> 근거 태그 표시</label>
      <label><input type="checkbox" id="tMark" checked> 필수·제목 키워드 강조</label>
    </div>
    <article class="blog" id="blogView">
      <h2>${decorate(b.title)}</h2>
      ${b.disclosure ? `<p class="disclosure">${esc(b.disclosure)}</p>` : ""}
      <p>${decorate(b.intro)}</p>
      ${b.sections.map((s) => `<h3>${decorate(s.heading)}</h3>${s.photo_indexes.map(fig).join("")}<p>${decorate(s.body)}</p>`).join("")}
      <p><b>${decorate(b.conclusion)}</b></p>
      <div class="footer">${esc(b.footer)}</div>
      <p class="tags">${b.tags.map((t) => "#" + esc(t.replace(/^#/, ""))).join(" ")}</p>
    </article>`;
  $("#tEv").onchange = (e) => $("#blogView").classList.toggle("no-ev", !e.target.checked);
  $("#tMark").onchange = (e) => $("#blogView").classList.toggle("no-mark", !e.target.checked);
  $("#copyBlog").onclick = async () => {
    await navigator.clipboard.writeText(blogPlainText());
    $("#copyBlog").textContent = "복사됨 ✓";
    setTimeout(() => ($("#copyBlog").textContent = "본문 복사 (근거 태그 제외)"), 1500);
  };
}

// ---------- ④ 카드뉴스 (Canvas 렌더링) ----------
async function renderCards() {
  const cards = state.content.cardnews.slice(0, 4);
  try {
    await document.fonts.load('800 64px "Pretendard"');
  } catch {}
  $("#tab-cards").innerHTML = `
    <div class="toolbar"><button class="btn primary" id="dlAll">4장 모두 PNG 다운로드</button><span class="hint">1080×1080 · 인스타그램 피드 규격</span></div>
    <div class="cards">${cards.map((_, i) => `<figure><canvas id="card${i}" width="1080" height="1080"></canvas><figcaption>${i + 1} / ${cards.length}<button class="btn" data-dl="${i}">PNG</button></figcaption></figure>`).join("")}</div>
    <div class="caption-box"><b>인스타그램 캡션</b>\n${esc(state.content.instagram_caption)}</div>`;
  for (let i = 0; i < cards.length; i++) await drawCard($("#card" + i), cards[i], i, cards.length);
  $$("[data-dl]").forEach((b) => (b.onclick = () => download(Number(b.dataset.dl))));
  $("#dlAll").onclick = async () => {
    for (let i = 0; i < cards.length; i++) {
      download(i);
      await new Promise((r) => setTimeout(r, 300));
    }
  };
}
function download(i) {
  const a = document.createElement("a");
  a.href = $("#card" + i).toDataURL("image/png");
  a.download = `tlink_cardnews_${i + 1}.png`;
  a.click();
}
function loadImg(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}
async function drawCard(canvas, card, i, total) {
  const ctx = canvas.getContext("2d");
  const W = 1080, H = 1080;
  const FONT = '"Pretendard", "Malgun Gothic", sans-serif';
  const img = card.photo_index > 0 && photoUrl(card.photo_index) ? await loadImg(photoUrl(card.photo_index)) : null;
  if (img) {
    const s = Math.max(W / img.width, H / img.height);
    ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(11,31,75,0.35)");
    g.addColorStop(0.45, "rgba(11,31,75,0.55)");
    g.addColorStop(1, "rgba(11,31,75,0.95)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0b1f4b");
    g.addColorStop(1, "#1f5eff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 상단 브랜드 · 페이지 (알약 폭은 텍스트 폭 + 좌우 패딩 24px)
  // 브랜드·연락처는 분석 결과(제품명)와 가이드라인 하단 정보에서 가져온다 → 다른 제품에도 그대로 적용
  const BRAND = (state.analysis?.product_name || "PRODUCT").slice(0, 18);
  // 가이드라인 하단 정보 → 없으면 제품 자료에서 연락처를 찾는다
  const footerText = (state.analysis?.guideline?.footer_items || []).join(" ") + " " + ($("#product")?.value || "");
  const site = (footerText.match(/www\.[\w.-]+\.[a-z]{2,}/i) || [""])[0];
  const phone = (footerText.match(/\d{2,4}-\d{3,4}-\d{4}|\d{4}-\d{4}/) || [""])[0];
  ctx.font = `700 30px ${FONT}`;
  const pillW = Math.ceil(ctx.measureText(BRAND).width) + 48;
  ctx.fillStyle = "#1f5eff";
  roundRect(ctx, 60, 60, pillW, 64, 32);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(BRAND, 84, 93);
  ctx.textAlign = "right";
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(`${i + 1} / ${total}`, W - 60, 93);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // 본문 (아래에서 위로 배치)
  ctx.font = `500 42px ${FONT}`;
  const bodyLines = wrap(ctx, card.body, W - 140);
  ctx.font = `800 76px ${FONT}`;
  const headLines = wrap(ctx, card.headline, W - 140);
  let y = H - 120 - bodyLines.length * 60;
  y -= headLines.length * 92 + 30;
  ctx.fillStyle = "#ffffff";
  headLines.forEach((l) => ((y += 92), ctx.fillText(l, 70, y)));
  y += 30;
  ctx.font = `500 42px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  bodyLines.forEach((l) => ((y += 60), ctx.fillText(l, 70, y)));
  // 하단 정보
  ctx.font = `500 26px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(i === total - 1 && phone ? `상담 ${phone}${site ? " · " + site : ""}` : site, 70, H - 56);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text || "").split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width <= maxW) line = test;
      else if (ctx.measureText(word).width > maxW) {
        for (const ch of word) {
          if (ctx.measureText(line + ch).width > maxW) (lines.push(line), (line = ch));
          else line += ch;
        }
      } else (lines.push(line), (line = word));
    }
    lines.push(line);
  }
  return lines.filter((l, idx) => l || idx === 0);
}

// ---------- ⑤ 자동 검수 (규칙 기반 + AI 판정) ----------
// 가이드라인 원문에서 "필수:", "서브:", "태그:" 줄을 코드가 직접 읽는다 → AI가 뽑은 목록에 빠진 항목을 보충
function parseGuidelineText(text = "") {
  const grab = (label) => (text.match(new RegExp(`^\\s*${label}\\s*[:：]\\s*(.+)$`, "m")) || [, ""])[1];
  const list = (s) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  const tags = (grab("태그").match(/#[^#]+/g) || []).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
  return { required_keywords: list(grab("필수")), sub_keywords: list(grab("서브")), tags };
}
function mergeLists(ai = [], parsed = []) {
  const out = [...ai];
  const seen = new Set(ai.map((x) => norm(String(x).replace(/^#/, ""))));
  const added = [];
  parsed.forEach((p) => {
    if (!seen.has(norm(p))) (seen.add(norm(p)), out.push(p), added.push(p));
  });
  return { list: out, added };
}
// 하단 정보 항목에서 URL·전화번호를 뽑아 하단 영역에 모두 있는지 본다 (없으면 문구 전체로 비교)
function footerItemPass(item, footer) {
  const tokens = String(item).match(/(https?:\/\/)?(www\.)?[\w-]+(\.[\w-]+)+(\/[\w./-]*)?|\d{2,4}-\d{3,4}(-\d{4})?/g) || [];
  return tokens.length ? tokens.every((t) => has(footer, t.replace(/^https?:\/\//, ""))) : has(footer, item);
}
function runChecks(gl0, c) {
  // AI가 구조화한 가이드라인 + 원문 직접 파싱 결과를 합친다
  const parsed = parseGuidelineText($("#guideline")?.value || "");
  const req = mergeLists(gl0.required_keywords, parsed.required_keywords);
  const sub = mergeLists(gl0.sub_keywords, parsed.sub_keywords);
  const tg = mergeLists(gl0.tags, parsed.tags);
  const gl = { ...gl0, required_keywords: req.list, sub_keywords: sub.list, tags: tg.list };
  const supplemented = [...req.added, ...sub.added, ...tg.added];
  const b = c.blog;
  const title = b.title;
  const intro = b.intro;
  const body = [b.intro, ...b.sections.map((s) => s.heading + " " + s.body), b.conclusion].join("\n");
  const all = [title, body, b.footer].join("\n");
  const blogTags = b.tags.map((t) => norm(t.replace(/^#/, "")));
  // 가이드라인 조건 = 필수 키워드 + 서브 키워드 + 태그 + 추천 구성 + 하단 정보(코드 검사) + 미션(AI 판정)
  // 묶음 행은 count(조건 수)와 passed(충족 수)를 따로 가져 조건 하나하나를 점수에 반영한다.
  const rules = [];
  const add = (group, item, passed, count, detail = "") => rules.push({ group, item, passed, count, pass: passed === count, detail });

  (gl.required_keywords || []).forEach((k) => {
    const t = has(title, k), bd = has(body, k);
    add("필수 키워드", `"${k}" 제목·본문 모두 포함`, t && bd ? 1 : 0, 1, `제목 ${t ? "✓" : "✗"} · 본문 ${bd ? "✓" : "✗"}`);
  });
  const subs = gl.sub_keywords || [];
  const subHit = subs.filter((k) => has(all, k));
  add("서브 키워드", `${subHit.length} / ${subs.length}개 사용`, subHit.length, subs.length, { hit: subHit, miss: subs.filter((k) => !has(all, k)) });
  const tagsGl = gl.tags || [];
  const inTags = (t) => blogTags.includes(norm(t.replace(/^#/, "")));
  const tagHit = tagsGl.filter(inTags);
  add("태그", `${tagHit.length} / ${tagsGl.length}개 포함`, tagHit.length, tagsGl.length, { hit: tagHit, miss: tagsGl.filter((t) => !inTags(t)) });
  (gl.structure || []).forEach((s, i) =>
    add("추천 본문 구성", `${i + 1}단락: ${s}`, b.sections[i] ? 1 : 0, 1, b.sections[i] ? `생성된 단락: ${b.sections[i].heading} (내용 일치는 담당자 확인)` : "단락 없음")
  );
  (gl.footer_items || []).forEach((f) => add("하단 정보", f, footerItemPass(f, b.footer) ? 1 : 0, 1, "하단 영역에서 URL·전화번호 대조"));

  // 미션 응답이 일부 빠져도 분모가 줄지 않도록 가이드라인의 미션 수를 기준으로 한다
  const missions = [...(c.mission_check || [])];
  for (let i = missions.length; i < (gl.missions || []).length; i++) missions.push({ mission: gl.missions[i], met: false, quote: "AI 판정 누락 → 담당자 확인 필요" });
  const ruleCount = rules.reduce((n, r) => n + r.count, 0);
  const rulePassed = rules.reduce((n, r) => n + r.passed, 0);
  const missionScore = missions.filter((m) => m.met).length;
  const total = ruleCount + missions.length;

  // 추가 점검 (점수 미반영): 제목·첫 문단 키워드, 사진 배치, 협찬 표시, 최상급·단정 표현 스캔
  const extras = [];
  (gl.title_keywords || []).forEach((k) => {
    const t = has(title, k), f = has(intro, k);
    extras.push({ item: `제목과 첫 문단에 "${k}"`, pass: t && f, detail: `제목 ${t ? "✓" : "✗"} · 첫 문단 ${f ? "✓" : "✗"}` });
  });
  if (state.photos.length) {
    const used = new Set(b.sections.flatMap((s) => s.photo_indexes));
    extras.push({ item: `현장사진 본문 배치 ${used.size} / ${state.photos.length}장`, pass: used.size >= state.photos.length });
  }
  extras.push({ item: "협찬(경제적 이해관계) 표시 문구", pass: Boolean(b.disclosure && b.disclosure.trim()) });
  extras.push({
    item: "가이드라인 원문 직접 대조 (AI 목록 누락 보충)",
    pass: true,
    detail: supplemented.length ? `AI 목록에 없던 ${supplemented.length}개를 원문에서 보충: ${supplemented.join(", ")}` : "AI가 뽑은 키워드·태그 목록이 원문과 일치",
  });
  const plain = stripEv(all);
  const superlatives = [...new Set(plain.match(/(국내|업계|세계)\s?(최고|최초|1위|유일)|최고의?|1위|유일한?|완벽(한|하게)?|100\s?%|무조건|반드시\s?(성공|해결)/g) || [])];
  extras.push({ item: "최상급·단정 표현 (코드 스캔)", pass: superlatives.length === 0, detail: superlatives.length ? `발견: ${superlatives.join(", ")} → 자료 근거 확인 필요` : "발견 없음" });

  return {
    rules, missions, extras, warnings: c.warnings || [],
    score: total ? Math.round(((rulePassed + missionScore) / total) * 100) : 0,
    ruleScore: rulePassed, ruleCount, missionScore, total, passed: rulePassed + missionScore,
  };
}
function renderCheck() {
  const ck = state.check;
  const detail = (d) =>
    d && typeof d === "object"
      ? `<div class="chips">${d.hit.map((k) => `<span class="chip">${esc(k)}</span>`).join("")}${d.miss.map((k) => `<span class="chip miss">${esc(k)}</span>`).join("")}</div>`
      : esc(d);
  $("#tab-check").innerHTML = `
    ${state.defaultGuideline ? `<p class="replay-banner">가이드라인을 입력하지 않아 내장 기본 가이드라인(5단 구성·기본 미션 5개·제품 자료 연락처)으로 생성·검수했습니다.</p>` : ""}
    <p class="hint">가이드라인 조건 ${ck.total}개 = 코드 검사 ${ck.ruleCount}개(키워드·태그·구성·하단 정보, AI가 가이드라인에서 뽑은 목록을 코드가 하나씩 대조) + 미션 ${ck.missions.length}개(AI가 본문 인용과 함께 판정). 최종 승인은 담당자가 합니다.</p>
    <h3 class="sub">규칙 검수 (코드) · ${ck.ruleScore} / ${ck.ruleCount} 조건 충족</h3>
    <table class="check-table rules"><tr><th class="c-group">구분</th><th class="c-item">항목</th><th class="c-result">결과</th><th>상세</th></tr>
      ${ck.rules.map((r) => `<tr><td class="c-group">${esc(r.group)}</td><td class="c-item">${esc(r.item)}</td><td class="c-result ${r.pass ? "ok" : "no"}">${r.pass ? "통과" : "보완 필요"}</td><td>${detail(r.detail)}</td></tr>`).join("")}
    </table>
    <h3 class="sub">미션 충족 (AI 판정) · ${ck.missionScore} / ${ck.missions.length}</h3>
    <table class="check-table missions"><tr><th class="c-num">#</th><th class="c-mission">미션</th><th class="c-result">결과</th><th>근거 인용</th></tr>
      ${ck.missions.map((m, i) => `<tr class="${m.met ? "" : "miss-row"}"><td class="c-num">${i + 1}</td><td class="c-mission">${esc(m.mission)}</td><td class="c-result ${m.met ? "ok" : "no"}">${m.met ? "충족" : "미충족"}</td><td class="quote">${esc(m.quote)}</td></tr>`).join("")}
    </table>
    <h3 class="sub">추가 점검 (점수 미반영)</h3>
    <table class="check-table rules"><tr><th class="c-item">항목</th><th class="c-result">결과</th><th>상세</th></tr>
      ${ck.extras.map((x) => `<tr><td class="c-item">${esc(x.item)}</td><td class="c-result ${x.pass ? "ok" : "no"}">${x.pass ? "통과" : "확인 필요"}</td><td>${esc(x.detail || "")}</td></tr>`).join("")}
    </table>
    <h3 class="sub">확인 필요 경고 (AI) · ${ck.warnings.length}건</h3>
    ${ck.warnings.length ? `<table><tr><th>문장</th><th>이유</th></tr>${ck.warnings.map((w) => `<tr><td>${esc(w.text)}</td><td>${esc(w.reason)}</td></tr>`).join("")}</table>` : `<p class="hint">근거 없는 수치·최상급 표현이 발견되지 않았습니다.</p>`}`;
}
function renderSummary() {
  const ck = state.check;
  const t = (state.timings.analyze || 0) + (state.timings.generate || 0);
  $("#summary").innerHTML = `
    <div class="stat big"><b>${ck.score}%</b><span>${state.defaultGuideline ? "기본 가이드라인" : "가이드라인"} ${ck.total}개 조건 중 ${ck.passed}개 충족</span><small>코드 검사 ${ck.ruleScore}/${ck.ruleCount} · AI 미션 ${ck.missionScore}/${ck.missions.length}</small></div>
    <div class="stat"><b>${state.analysis.differentiators.length}</b><span>차별점 카드</span></div>
    <div class="stat"><b>${state.analysis.photos.length}장</b><span>사진 분석·배치</span></div>
    <div class="stat"><b>${ck.warnings.length}건</b><span>확인 필요 경고</span></div>
    <div class="stat"><b>${t.toFixed(0)}초</b><span>AI 생성 시간${state.retried ? " (빈칸 감지 → 자동 재생성 1회 포함)" : ""}</span></div>`;
  $("#summary").classList.remove("hidden");
}
