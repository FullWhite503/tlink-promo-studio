// 미충족 미션 보완 재생성: 검수표에서 미충족 미션만 짚어 다시 생성하고 재검수한다.
// app.js를 수정하지 않고 renderCheck를 감싸 버튼을 붙인다.
(function () {
  try {
    const style = document.createElement("style");
    style.textContent = `
      .fix-box { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:10px 0 4px; padding:10px 12px; border-radius:10px; background:#eef3ff; border:1px solid #c9d7ff; font-size:13px; }
      .fix-box .btn { background:#1f5eff; color:#fff; border-color:#1f5eff; }
      .fix-box .btn:disabled { background:#93a9e8; border-color:#93a9e8; cursor:wait; }
      .fix-result { font-weight:700; color:#0b1f4b; }
      .fix-note { color:#5c6782; }`;
    document.head.appendChild(style);

    let lastFix = null; // {before, after, seconds, kept}
    const orig = window.renderCheck;
    window.renderCheck = function (...args) {
      orig.apply(this, args);
      try {
        addFixBox();
      } catch (e) {
        console.error("[fix]", e);
      }
    };

    function addFixBox() {
      const ck = state.check;
      if (!ck) return;
      const unmet = ck.missions.filter((m) => !m.met);
      const total = ck.missions.length;
      const host = [...document.querySelectorAll("#tab-check h3.sub")].find((h) => h.textContent.includes("미션 충족"));
      if (!host) return;
      const box = document.createElement("div");
      box.className = "fix-box";
      let result = "";
      if (lastFix) {
        result = lastFix.kept
          ? `<span class="fix-result">보완 재생성 결과가 더 낮아(미션 ${lastFix.after}/${total}) 이전 원고를 유지했습니다 (${lastFix.seconds}초)</span>`
          : `<span class="fix-result">보완 재생성 결과: 미션 ${lastFix.before}/${total} → ${lastFix.after}/${total} (${lastFix.seconds}초)</span>`;
        if (unmet.length)
          result += `<span class="fix-note">남은 미충족은 글 수정만으로 해결되지 않는 항목입니다(사진 교체·자료 확인 필요). AI는 근거 없이 지어내지 않고 이유를 남깁니다.</span>`;
      }
      box.innerHTML = unmet.length
        ? `<span>미충족 미션 ${unmet.length}건을 검토했다면, 이 미션만 짚어 다시 생성하고 재검수할 수 있습니다.</span>
           <button class="btn" id="fixBtn">미충족 ${unmet.length}건 보완해 다시 생성</button>${result}`
        : `<span>모든 미션이 충족됐습니다.</span>${result}`;
      host.insertAdjacentElement("afterend", box);
      const btn = box.querySelector("#fixBtn");
      if (btn) btn.onclick = () => runFix(unmet, btn);
    }

    async function runFix(unmet, btn) {
      if (document.body.classList.contains("running")) return;
      const beforeCheck = state.check;
      const before = beforeCheck.missions.filter((m) => m.met).length;
      btn.disabled = true;
      document.body.classList.add("running");
      const t0 = performance.now();
      const timer = setInterval(() => (btn.textContent = `보완 재생성 중… ${((performance.now() - t0) / 1000).toFixed(0)}초`), 500);
      try {
        const g = await api("/api/generate", {
          analysis: state.analysis,
          product: $("#product").value,
          guideline: $("#guideline").value,
          fixMissions: unmet.map((m) => m.mission),
        });
        const newCheck = runChecks(state.analysis.guideline, g.data);
        const after = newCheck.missions.filter((m) => m.met).length;
        const seconds = ((performance.now() - t0) / 1000).toFixed(0);
        state.timings.generate = (state.timings.generate || 0) + g.meta.seconds;
        if (newCheck.passed < beforeCheck.passed) {
          // 재생성 결과가 더 나쁘면 이전 원고를 유지한다
          lastFix = { before, after, seconds, kept: true };
          renderCheck();
        } else {
          state.content = g.data;
          state.check = newCheck;
          lastFix = { before, after, seconds, kept: false };
          renderBlog();
          await renderCards();
          renderCheck();
          if (typeof saveLastRun === "function") saveLastRun();
        }
        renderSummary();
        showTab("check");
      } catch (err) {
        $("#error").textContent = `보완 재생성 실패: ${err.message}`;
        $("#error").classList.remove("hidden");
        btn.disabled = false;
      } finally {
        clearInterval(timer);
        document.body.classList.remove("running");
      }
    }
  } catch (e) {
    console.error("[fix] 초기화 실패", e);
  }
})();
