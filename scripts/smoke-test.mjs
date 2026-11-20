// 실행 중인 서버에 샘플 자료 + 사진 폴더를 넣어 분석·생성을 끝까지 돌려 보고 결과를 요약한다.
// 사용법: node scripts/smoke-test.mjs [사진폴더] [결과저장경로]
// 주의: 실제 Claude API를 2회 호출한다(비용 발생).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const photoDir = process.argv[2];
const outFile = process.argv[3];

const post = async (url, body) => {
  const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${url} ${r.status}: ${j.error}`);
  return j;
};
const norm = (s = "") => s.toLowerCase().replace(/\s+/g, "");
const has = (t, k) => norm(t).includes(norm(k));

const samples = await (await fetch(BASE + "/api/samples")).json();
const images = photoDir
  ? readdirSync(photoDir)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort()
      .slice(0, 5)
      .map((f) => ({ media_type: /\.png$/i.test(f) ? "image/png" : "image/jpeg", data: readFileSync(path.join(photoDir, f)).toString("base64") }))
  : [];

// NO_GUIDELINE=1 이면 가이드라인 없이(현장사진 + 제품 정보만으로) 실행
const guideline = process.env.NO_GUIDELINE ? "" : samples.guideline;
const t0 = Date.now();
const a = await post("/api/analyze", { product: samples.product, guideline, images });
const g = await post("/api/generate", { analysis: a.data, product: samples.product, guideline });
console.log("defaultGuideline:", Boolean(a.meta.defaultGuideline), "/ missions:", a.data.guideline.missions.length, "/ structure:", a.data.guideline.structure.length, "/ footer:", JSON.stringify(a.data.guideline.footer_items));
const total = ((Date.now() - t0) / 1000).toFixed(1);

const gl = a.data.guideline;
const b = g.data.blog;
const body = [b.intro, ...b.sections.map((s) => s.heading + " " + s.body), b.conclusion].join("\n");
const all = [b.title, body, b.footer].join("\n");
const tags = b.tags.map((t) => norm(t.replace(/^#/, "")));
const report = {
  seconds: { analyze: a.meta.seconds, generate: g.meta.seconds, total: Number(total) },
  tokens: { analyze: a.meta.usage, generate: g.meta.usage },
  differentiators: a.data.differentiators.length,
  differentiators_unverified: a.data.differentiators.filter((d) => d.evidence_source === "확인 필요").length,
  photos_in: images.length,
  photos_analyzed: a.data.photos.length,
  photos_placed: new Set(b.sections.flatMap((s) => s.photo_indexes)).size,
  required_in_title: (gl.required_keywords || []).map((k) => [k, has(b.title, k)]),
  required_in_body: (gl.required_keywords || []).map((k) => [k, has(body, k)]),
  sub_keywords: `${(gl.sub_keywords || []).filter((k) => has(all, k)).length}/${(gl.sub_keywords || []).length}`,
  tags: `${(gl.tags || []).filter((t) => tags.includes(norm(t.replace(/^#/, "")))).length}/${(gl.tags || []).length}`,
  footer: (gl.footer_items || []).map((f) => [f, has(all, f)]),
  sections: `${b.sections.length}/${(gl.structure || []).length}`,
  missions_met: `${g.data.mission_check.filter((m) => m.met).length}/${g.data.mission_check.length}`,
  warnings: g.data.warnings.length,
  cardnews: g.data.cardnews.length,
  cardnews_lengths: g.data.cardnews.map((c) => [c.headline.length, c.body.length]),
  blog_chars: (b.intro + b.sections.map((s) => s.body).join("") + b.conclusion).replace(/⟦[^⟧]*⟧/g, "").length,
  evidence_tags: (all.match(/⟦[^⟧]*⟧/g) || []).length,
};
console.log(JSON.stringify(report, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ report, analysis: a.data, content: g.data }, null, 1));
