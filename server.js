// 티링크 프로모 스튜디오 — 서버
// 실행: npm install → .env에 ANTHROPIC_API_KEY 입력 → npm start → http://localhost:3000
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ANALYZE_SCHEMA, ANALYZE_SYSTEM, GENERATE_SCHEMA, GENERATE_SYSTEM } from "./prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  /* .env 없음: 환경변수에서 읽음 */
}

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);
let client = null;
const getClient = () => (client ??= new Anthropic());

const app = express();
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(__dirname, "public")));

const readSample = (name) => readFileSync(path.join(__dirname, "data", "samples", name), "utf8");

app.get("/api/status", (_req, res) => res.json({ hasKey: hasKey(), model: MODEL }));
app.get("/api/samples", (_req, res) =>
  res.json({ product: readSample("product.md"), guideline: readSample("guideline.md") })
);

// Claude 호출 공통 함수: 스트리밍 + JSON 스키마 구조화 출력
let fallbackSupported = true;
async function callClaude({ system, content, schema, effort, label }) {
  const started = Date.now();
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort, format: { type: "json_schema", schema } },
  };
  let message;
  try {
    if (fallbackSupported) {
      // 안전 분류기가 거절할 경우 서버 측에서 다른 모델로 이어서 처리 (거의 발생하지 않음)
      message = await getClient()
        .beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        .finalMessage();
    } else {
      message = await getClient().messages.stream(params).finalMessage();
    }
  } catch (err) {
    if (fallbackSupported && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      fallbackSupported = false;
      console.warn("[fallback] 미지원 → 기본 호출로 재시도");
      return callClaude({ system, content, schema, effort, label });
    }
    throw err;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[${label}] ${seconds}s, in=${message.usage.input_tokens} out=${message.usage.output_tokens}, stop=${message.stop_reason}`
  );
  if (message.stop_reason === "refusal") throw new Error("AI가 이 요청을 처리하지 않았습니다. 입력 내용을 확인해 주세요.");
  if (message.stop_reason === "max_tokens") throw new Error("결과가 너무 길어 중간에 끊겼습니다. 입력을 줄여 다시 시도해 주세요.");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return { data: JSON.parse(text), meta: { seconds: Number(seconds), usage: message.usage } };
  } catch {
    throw new Error("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.");
  }
}

function errorResponse(res, err) {
  console.error(err);
  let message = err.message || "알 수 없는 오류";
  if (err instanceof Anthropic.AuthenticationError) message = "API 키가 올바르지 않습니다. .env의 ANTHROPIC_API_KEY를 확인해 주세요.";
  else if (err instanceof Anthropic.RateLimitError) message = "요청이 많아 잠시 제한됐습니다. 잠시 후 다시 시도해 주세요.";
  else if (err instanceof Anthropic.APIError) message = `Claude API 오류 (${err.status}): ${err.message}`;
  res.status(500).json({ error: message });
}

const requireKey = (req, res, next) =>
  hasKey()
    ? next()
    : res.status(400).json({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. tlink-note/.env 파일에 키를 넣고 서버를 다시 시작해 주세요." });

// 1) 차별점 분석 + 현장사진 분석 + 가이드라인 구조화
app.post("/api/analyze", requireKey, async (req, res) => {
  try {
    const { product = "", guideline = "", images = [], pdf = null } = req.body;
    if (!product.trim() && !pdf) return res.status(400).json({ error: "제품 자료를 입력하거나 PDF를 올려 주세요." });
    if (!guideline.trim()) return res.status(400).json({ error: "홍보 가이드라인을 입력해 주세요." });

    const content = [];
    if (pdf?.data) {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } });
    }
    images.slice(0, 5).forEach((img, i) => {
      content.push({ type: "text", text: `[사진${i + 1}]` });
      content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
    });
    content.push({
      type: "text",
      text: `[제품 자료]\n${product}\n\n[홍보 가이드라인]\n${guideline}\n\n입력된 현장사진·화면 캡처: ${Math.min(images.length, 5)}장${pdf ? " (첨부 PDF도 제품 자료로 사용)" : ""}`,
    });

    const result = await callClaude({
      system: ANALYZE_SYSTEM,
      content,
      schema: ANALYZE_SCHEMA,
      effort: process.env.ANALYZE_EFFORT || "low",
      label: "analyze",
    });
    res.json(result);
  } catch (err) {
    errorResponse(res, err);
  }
});

// 2) 가이드라인 맞춤 블로그 리뷰 + 카드뉴스 + 미션 자체 검수
app.post("/api/generate", requireKey, async (req, res) => {
  try {
    const { analysis, product = "", guideline = "" } = req.body;
    if (!analysis) return res.status(400).json({ error: "먼저 분석을 실행해 주세요." });
    const content = [
      {
        type: "text",
        text: `[분석 결과]\n${JSON.stringify(analysis, null, 1)}\n\n[제품 자료]\n${product}\n\n[홍보 가이드라인]\n${guideline}\n\n위 내용으로 블로그 리뷰, 카드뉴스 4장, 인스타그램 캡션, 미션 검수, 경고를 작성해 줘.`,
      },
    ];
    const result = await callClaude({
      system: GENERATE_SYSTEM,
      content,
      schema: GENERATE_SCHEMA,
      effort: process.env.GENERATE_EFFORT || "medium",
      label: "generate",
    });
    res.json(result);
  } catch (err) {
    errorResponse(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`티링크 프로모 스튜디오: http://localhost:${PORT}  (model=${MODEL}, API 키 ${hasKey() ? "설정됨" : "없음"})`);
});
