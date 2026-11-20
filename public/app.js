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
  for (const f of [...files].filter((f) => f.type.startsWith("image/"))) {
    if (state.photos.length >= 5) break;
    state.photos.push(await resizeImage(f, 1568));
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
      const url = c.toDataURL("image/jpeg", 0.86);
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
    renderDiff();
    renderPhotos();
    $("#empty").classList.add("hidden");
    showTab("diff");

    const g = await step("generate", () => api("/api/generate", { analysis: state.analysis, product, guideline }));
    state.content = g.data;
    state.timings.generate = g.meta.seconds;

    await step("check", async () => {
      state.check = runChecks(state.analysis.guideline, state.content);
      return { meta: { seconds: 0 } };
    });
    renderBlog();
    await renderCards();
    renderCheck();
    renderSummary();
    showTab("blog");
  } catch (err) {
    $("#error").textContent = err.message;
    $("#error").classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}
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
  return !!s && !/^(없음|해당없음|-|none|n\/a)$/i.test(s);
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
  const parts = [b.title, "", stripEv(b.intro), ""];
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
  const BRAND = "T·LINK 비즈레코딩";
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
  ctx.fillText(i === total - 1 ? "상담 1877-3836 · www.tlinkcrm.com" : "www.tlinkcrm.com", 70, H - 56);
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
function runChecks(gl, c) {
  const b = c.blog;
  const title = b.title;
  const intro = b.intro;
  const body = [b.intro, ...b.sections.map((s) => s.heading + " " + s.body), b.conclusion].join("\n");
  const all = [title, body, b.footer].join("\n");
  const blogTags = b.tags.map((t) => norm(t.replace(/^#/, "")));
  const rules = [];
  const add = (group, item, pass, detail = "") => rules.push({ group, item, pass, detail });

  (gl.required_keywords || []).forEach((k) => {
    add("필수 키워드", `"${k}" 제목 포함`, has(title, k));
    add("필수 키워드", `"${k}" 본문 포함`, has(body, k));
  });
  (gl.title_keywords || []).forEach((k) => add("제목·첫 문단 키워드", `"${k}"`, has(title + intro, k)));
  const subHit = (gl.sub_keywords || []).filter((k) => has(all, k));
  const subMiss = (gl.sub_keywords || []).filter((k) => !has(all, k));
  add("서브 키워드", `${subHit.length} / ${(gl.sub_keywords || []).length}개 사용`, subMiss.length === 0, { hit: subHit, miss: subMiss });
  const tagHit = (gl.tags || []).filter((t) => blogTags.includes(norm(t.replace(/^#/, ""))));
  const tagMiss = (gl.tags || []).filter((t) => !blogTags.includes(norm(t.replace(/^#/, ""))));
  add("태그", `${tagHit.length} / ${(gl.tags || []).length}개 포함`, tagMiss.length === 0, { hit: tagHit, miss: tagMiss });
  (gl.footer_items || []).forEach((f) => add("하단 정보", f, has(b.footer + all, f)));
  add("추천 본문 구성", `단락 ${b.sections.length}개 / 권장 ${(gl.structure || []).length}개`, b.sections.length >= (gl.structure || []).length);
  if (state.photos.length) {
    const used = new Set(b.sections.flatMap((s) => s.photo_indexes));
    add("현장사진 배치", `${used.size} / ${state.photos.length}장 본문 배치`, used.size >= state.photos.length);
  }
  const missions = c.mission_check || [];
  const ruleScore = rules.filter((r) => r.pass).length;
  const missionScore = missions.filter((m) => m.met).length;
  const total = rules.length + missions.length;
  return { rules, missions, warnings: c.warnings || [], score: total ? Math.round(((ruleScore + missionScore) / total) * 100) : 0, ruleScore, missionScore, total };
}
function renderCheck() {
  const ck = state.check;
  const detail = (d) =>
    d && typeof d === "object"
      ? `<div class="chips">${d.hit.map((k) => `<span class="chip">${esc(k)}</span>`).join("")}${d.miss.map((k) => `<span class="chip miss">${esc(k)}</span>`).join("")}</div>`
      : esc(d);
  $("#tab-check").innerHTML = `
    <p class="hint">규칙 검수는 코드가 정확히 세고(키워드·태그·하단 정보), 미션 충족은 AI가 본문 인용과 함께 판정합니다.</p>
    <h3 class="sub">규칙 검수 · ${ck.ruleScore} / ${ck.rules.length} 통과</h3>
    <table class="check-table rules"><tr><th class="c-group">구분</th><th class="c-item">항목</th><th class="c-result">결과</th><th>상세</th></tr>
      ${ck.rules.map((r) => `<tr><td class="c-group">${esc(r.group)}</td><td class="c-item">${esc(r.item)}</td><td class="c-result ${r.pass ? "ok" : "no"}">${r.pass ? "통과" : "보완 필요"}</td><td>${detail(r.detail)}</td></tr>`).join("")}
    </table>
    <h3 class="sub">미션 충족 (AI 판정) · ${ck.missionScore} / ${ck.missions.length}</h3>
    <table class="check-table missions"><tr><th class="c-num">#</th><th class="c-mission">미션</th><th class="c-result">결과</th><th>근거 인용</th></tr>
      ${ck.missions.map((m, i) => `<tr class="${m.met ? "" : "miss-row"}"><td class="c-num">${i + 1}</td><td class="c-mission">${esc(m.mission)}</td><td class="c-result ${m.met ? "ok" : "no"}">${m.met ? "충족" : "미충족"}</td><td class="quote">${esc(m.quote)}</td></tr>`).join("")}
    </table>
    <h3 class="sub">확인 필요 경고 · ${ck.warnings.length}건</h3>
    ${ck.warnings.length ? `<table><tr><th>문장</th><th>이유</th></tr>${ck.warnings.map((w) => `<tr><td>${esc(w.text)}</td><td>${esc(w.reason)}</td></tr>`).join("")}</table>` : `<p class="hint">근거 없는 수치·최상급 표현이 발견되지 않았습니다.</p>`}`;
}
function renderSummary() {
  const ck = state.check;
  const t = (state.timings.analyze || 0) + (state.timings.generate || 0);
  $("#summary").innerHTML = `
    <div class="stat big"><b>${ck.score}%</b><span>가이드라인 충족률 (${ck.ruleScore + ck.missionScore}/${ck.total} 항목)</span><small>규칙 ${ck.ruleScore}/${ck.rules.length} · AI 미션 ${ck.missionScore}/${ck.missions.length}</small></div>
    <div class="stat"><b>${state.analysis.differentiators.length}</b><span>차별점 카드</span></div>
    <div class="stat"><b>${state.analysis.photos.length}장</b><span>사진 분석·배치</span></div>
    <div class="stat"><b>${ck.warnings.length}건</b><span>확인 필요 경고</span></div>
    <div class="stat"><b>${t.toFixed(0)}초</b><span>AI 생성 시간</span></div>`;
  $("#summary").classList.remove("hidden");
}
