#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""티링크 프로모 스튜디오 — 읽기 전용 정적 데모(docs/) 빌드 스크립트.

GitHub Pages(/docs)에 올릴 수 있는 정적 사이트를 만든다. 서버·AI 호출 없이
data/last_run.json(마지막 실제 생성 결과)을 화면에 다시 보여 준다.

실행:  python scripts\\build_static_demo.py
필요:  Python 3 표준 라이브러리 + Pillow

하는 일
  1. data/last_run.json 을 읽고 사진을 긴 변 최대 520px JPEG(quality 72)로 줄인다(공개용 안전장치 + 용량 축소).
     AI 분석이 '개인정보 주의'로 표시한 사진은 통째로 흐리게 처리한다(public/app.js 의 hasPrivacy 와 같은 규칙).
     --keep-flagged 를 붙이면 흐리게 하지 않는다(사용자가 그 사진의 공개를 승인했을 때만 쓴다).
  2. public/ 의 화면 파일 7개만 docs/ 로 복사한다(public/_demo/ 는 복사하지 않는다).
  3. docs/static-data.js (샘플 자료 + 저장 결과), docs/static-shim.js (/api/* 가로채기)를 만든다.
  4. docs/index.html 에 두 스크립트와, 자바스크립트 없이도 읽을 수 있는 정적 요약을 넣는다.

여러 번 실행해도 안전하다(매번 docs/ 내용을 비우고 같은 입력에서 같은 결과를 다시 만든다. builtAt 만 달라진다).
입력이 잘못되면 docs/ 를 건드리기 전에 멈춘다. API 키·.env 는 읽지 않는다.
"""
import base64
import html
import io
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import unquote, unquote_to_bytes

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DEMO_DIR = PUBLIC / "_demo"
DATA_DIR = ROOT / "data"
DOCS = ROOT / "docs"
SHIM_SRC = ROOT / "scripts" / "static-shim.js"

COPY_FILES = ["index.html", "style.css", "app.js", "mask.js", "approve.js", "fix.js", "demo.js"]
GENERATED_FILES = ["static-data.js", "static-shim.js", ".nojekyll"]
MAX_SIDE = 380  # 공개용: 캡처 속 작은 글씨(통화 내용, 번호 앞자리)가 읽히지 않는 크기
JPEG_QUALITY = 72
REPO_URL = "https://github.com/FullWhite503/tlink-promo-studio"
KST = timezone(timedelta(hours=9))
# 공개 산출물에 들어가면 안 되는 문자열(키·개인 메일·사용자 폴더 경로)
FORBIDDEN = ["sk-ant", "ANTHROPIC_API_KEY=", "@gmail", "C:\\Users", "C:/Users", "\\\\Users\\\\"]
# 아래 검사(사용자 이름·OneDrive·이메일·휴대폰 번호)는 사진 base64 본문을 뺀 글자에만 한다(우연히 맞는 일을 막기 위해)
DATA_URL_RE = re.compile(r"data:image/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
MOBILE_RE = re.compile(r"(?<![\d.])01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)")
GENERIC_USER_NAMES = {"user", "admin", "administrator", "owner", "public", "default", "guest"}
# AI 가 '개인정보 주의'로 표시한 사진을 흐리게 하는 세기: 가우시안 반경 = 긴 변 / BLUR_DIVISOR (최소 BLUR_MIN_RADIUS)
BLUR_DIVISOR = 90
BLUR_MIN_RADIUS = 5.0

SCRIPT_ANCHOR = '<script src="app.js"></script>'
MAIN_ANCHOR = "</main>"


class BuildError(Exception):
    pass


def out(*args):
    print(*args, flush=True)


def read_text(path: Path) -> str:
    if not path.is_file():
        raise BuildError(f"필요한 파일이 없습니다: {path.relative_to(ROOT)}")
    return path.read_bytes().decode("utf-8-sig")


# ---------- 사진 ----------
def load_photo_bytes(url: str) -> bytes:
    """photos[].url → 원본 이미지 바이트. data: URL 또는 /_demo/<파일> 만 허용한다."""
    if not isinstance(url, str) or not url:
        raise BuildError("사진 url 이 비어 있습니다.")
    if url.startswith("data:"):
        head, sep, payload = url.partition(",")
        if not sep:
            raise BuildError("data URL 형식이 올바르지 않습니다.")
        if ";base64" in head.lower():
            return base64.b64decode(payload)
        return unquote_to_bytes(payload)
    path_part = url.split("?", 1)[0].split("#", 1)[0]
    if path_part.startswith("/_demo/"):
        name = unquote(path_part[len("/_demo/"):])
        target = (DEMO_DIR / name).resolve()
        if target.parent != DEMO_DIR.resolve() or not target.is_file():
            raise BuildError(f"사진 파일을 찾을 수 없습니다: public/_demo/{name}")
        return target.read_bytes()
    raise BuildError(f"지원하지 않는 사진 url 형식입니다: {url[:40]}")


def has_privacy(note) -> bool:
    """public/app.js 의 hasPrivacy 와 같은 규칙. AI 메모가 '조치 필요'를 말하면 True(화면의 '개인정보 주의' 배지와 같은 판정)."""
    s = re.sub(r"[.\s]", "", str(note or "").strip())
    if not s or re.fullmatch(r"(없음|해당없음|-|none|n/a)", s, re.IGNORECASE):
        return False
    if re.search(r"(?<!불)필요|가려야|주의", s):
        return True
    if re.search(r"불필요|없음|익명|해당없", s):
        return False
    return bool(re.search(r"노출|보임|보입니다", s))


def flagged_photo_indexes(analysis: dict, photo_count: int) -> set:
    """AI 분석이 '개인정보 주의'로 표시한 사진 번호(1부터)."""
    flagged = set()
    for pos, p in enumerate(as_list(analysis.get("photos")), 1):
        if not isinstance(p, dict):
            continue
        idx = p.get("index")
        if not isinstance(idx, int) or isinstance(idx, bool):
            idx = pos
        if 1 <= idx <= photo_count and has_privacy(p.get("privacy_note")):
            flagged.add(idx)
    return flagged


def shrink_photo(raw: bytes, blur: bool = False):
    """긴 변 최대 MAX_SIDE 로 줄여 JPEG 로 다시 인코딩. (원본 크기, 새 크기, JPEG 바이트)를 돌려준다.
    blur=True 면 줄인 뒤 글자가 읽히지 않도록 통째로 흐리게 한다."""
    img = Image.open(io.BytesIO(raw))
    img.load()
    img = ImageOps.exif_transpose(img)  # 휴대폰 사진의 회전 정보를 픽셀에 반영(EXIF 는 저장하지 않는다)
    original = img.size
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    if has_alpha:
        rgba = img.convert("RGBA")
        canvas = Image.new("RGB", rgba.size, (255, 255, 255))  # 투명 영역은 흰 배경으로
        canvas.paste(rgba, mask=rgba.split()[-1])
        img = canvas
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)  # 줄이기만 하고 키우지는 않는다
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(radius=max(BLUR_MIN_RADIUS, max(img.size) / BLUR_DIVISOR)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return original, img.size, buf.getvalue()


def process_photos(photos, blur_indexes=frozenset()):
    result, stats = [], []
    for i, ph in enumerate(photos, 1):
        if not isinstance(ph, dict):
            raise BuildError(f"사진{i} 항목 형식이 올바르지 않습니다.")
        raw = load_photo_bytes(ph.get("url"))
        blur = i in blur_indexes
        try:
            original, size, jpeg = shrink_photo(raw, blur=blur)
        except BuildError:
            raise
        except Exception as e:  # 깨진 이미지 등
            raise BuildError(f"사진{i} 을(를) 처리하지 못했습니다: {e}")
        if max(size) > MAX_SIDE:
            raise BuildError(f"사진{i} 축소 실패: {size}")
        name = str(ph.get("name") or f"사진{i}")
        item = {"name": name, "url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")}
        if blur:
            # masked: 화면이 읽는 표시(썸네일 '가림 ✓', 승인 패널 '가림 처리 n/m장'). publicBlur: 빌드 단계에서 흐리게 했다는 표시(배너 문구용).
            item["masked"] = True
            item["publicBlur"] = True
        result.append(item)
        stats.append({"index": i, "name": name, "original": original, "size": size, "bytes_in": len(raw), "bytes_out": len(jpeg), "blurred": blur})
    return result, stats


# ---------- 표시용 값 ----------
def kst_text(iso: str) -> str:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.astimezone(KST).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def js_fixed0(x: float) -> str:
    """자바스크립트 Number.prototype.toFixed(0) 과 같은 반올림(화면의 'AI 생성 n초'와 같은 값)."""
    return str(int(Decimal(x).quantize(Decimal("1"), rounding=ROUND_HALF_UP)))


def esc(s) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def esc_ml(s) -> str:
    return esc(s).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")


def as_list(v):
    return v if isinstance(v, list) else []


# ---------- 정적 요약(자바스크립트 없이 읽는 방문자·AI용) ----------
SUMMARY_STYLE = """
#staticSummary { max-width: 900px; margin: 0 auto 48px; padding: 0 20px; color: #16203a; font-size: 14px; line-height: 1.7; }
#staticSummary .ss-box { border: 1px solid #c9ced8; border-radius: 12px; background: #fff; padding: 16px 20px; margin: 0 0 16px; }
#staticSummary h2 { font-size: 18px; margin: 0 0 8px; color: #0b1f4b; }
#staticSummary h3 { font-size: 15px; margin: 18px 0 6px; }
#staticSummary p { margin: 6px 0; }
#staticSummary ul, #staticSummary ol { margin: 6px 0; padding-left: 22px; }
#staticSummary table { width: 100%; border-collapse: collapse; font-size: 13px; }
#staticSummary th, #staticSummary td { border: 1px solid #c9ced8; padding: 6px 8px; text-align: left; vertical-align: top; }
#staticSummary th { background: #f4f6fb; }
#staticSummary .ss-note { color: #5c6782; font-size: 12.5px; }
#staticSummary .ss-draft { border-left: 3px solid #c9ced8; padding-left: 14px; }
#staticSummary a { color: #1f5eff; word-break: break-all; }
""".strip()


def build_summary(last_run: dict, photo_count: int, blurred=()) -> str:
    analysis = last_run.get("analysis") or {}
    content = last_run.get("content") or {}
    blog = content.get("blog") or {}
    timings = last_run.get("timings") or {}
    t_analyze, t_generate = num(timings.get("analyze")), num(timings.get("generate"))
    when = kst_text(last_run.get("savedAt"))
    missions = [m for m in as_list(content.get("mission_check")) if isinstance(m, dict)]
    met = sum(1 for m in missions if m.get("met") is True)
    guideline_missions = len(as_list((analysis.get("guideline") or {}).get("missions")))
    warnings = as_list(content.get("warnings"))
    diffs = as_list(analysis.get("differentiators"))
    analyzed_photos = as_list(analysis.get("photos"))
    cards = [c for c in as_list(content.get("cardnews")) if isinstance(c, dict)][:4]
    sections = [s for s in as_list(blog.get("sections")) if isinstance(s, dict)]
    tags = [str(t) for t in as_list(blog.get("tags"))]

    p = []
    p.append('<section id="staticSummary" aria-label="읽기 전용 데모 안내와 저장 결과 요약">')
    p.append("<style>\n" + SUMMARY_STYLE + "\n</style>")

    # 1) 이 페이지가 무엇인지
    p.append('<div class="ss-box">')
    p.append("<h2>이 페이지 안내 — 읽기 전용 데모 (정적 요약)</h2>")
    when_txt = f"{esc(when)}(한국 시간)에 " if when else ""
    p.append(
        "<p>이 페이지는 <b>티링크 프로모 스튜디오</b>(제품 자료 + 홍보 가이드라인 + 현장사진 → 홍보 콘텐츠 생성·자동 검수 웹앱)의 "
        f"<b>읽기 전용 데모</b>입니다. 서버와 AI 호출 없이, {when_txt}Claude API로 실제 생성해 저장한 결과를 그대로 불러와 보여 줍니다.</p>"
    )
    if t_analyze + t_generate > 0:
        retried = " 빈칸 감지에 따른 자동 재생성 1회가 포함된 시간입니다." if last_run.get("retried") else ""
        p.append(
            f"<p>AI 생성 시간: <b>{esc(js_fixed0(t_analyze + t_generate))}초</b> "
            f"(분석 {esc(f'{t_analyze:g}')}초 + 콘텐츠 생성 {esc(f'{t_generate:g}')}초, 서버가 잰 값).{retried}</p>"
        )
    p.append(f'<p>소스 코드와 실행 방법(GitHub 저장소): <a href="{esc(REPO_URL)}">{esc(REPO_URL)}</a></p>')
    blur_txt = ""
    if blurred:
        blur_names = "·".join(f"사진{i}" for i in blurred)
        blur_txt = (
            f"AI 분석이 '개인정보 주의'로 표시한 {len(blurred)}장({esc(blur_names)})은 공개용으로 통째로 흐리게 처리했습니다"
            "(빌드 단계에서 한 처리이며, AI 분석은 흐리게 하기 전 사진으로 했습니다. "
            "화면의 썸네일 '가림 ✓'와 승인 패널의 '가림 처리' 수는 이 처리를 센 값입니다). "
        )
    p.append(
        f'<p class="ss-note">공개용으로 사진은 긴 변 최대 {MAX_SIDE}px로 줄여 넣었습니다. {blur_txt}'
        "아래 내용은 자바스크립트를 실행하지 않아도 읽을 수 있도록 빌드할 때 같은 저장 결과에서 만든 요약입니다.</p>"
    )
    p.append("<h3>사용 방법</h3>")
    p.append("<ul>")
    p.append("<li>탭 5개(① 차별점 카드 · ② 사진 분석·배치 · ③ 블로그 리뷰 · ④ 카드뉴스 · ⑤ 가이드라인 검수표)를 눌러 결과를 봅니다.</li>")
    p.append("<li>검수표(⑤ 탭): 가이드라인 조건을 코드 검사(키워드·태그·구성·하단 정보)와 AI 미션 판정으로 나눠 보여 줍니다.</li>")
    p.append("<li>승인 패널(⑤ 탭 맨 위): 블로거 체험 메모(15자 이상)와 확인 체크를 채워야 '게시 승인' 버튼이 켜집니다.</li>")
    p.append("<li>사진 가리기: 왼쪽 사진 썸네일의 '가리기' 버튼을 누르고 드래그하면 그 영역이 모자이크 처리됩니다.</li>")
    p.append("<li>PNG 다운로드: ④ 카드뉴스 탭에서 카드 4장을 1080×1080 PNG로 내려받습니다.</li>")
    p.append("<li>새로 생성(AI 호출)과 '미충족 미션 보완 재생성'은 이 페이지에서 동작하지 않습니다. GitHub README의 실행 방법대로 로컬에서 실행해야 합니다.</li>")
    p.append("</ul>")
    p.append("</div>")

    # 2) 이 저장 결과의 사실
    p.append('<div class="ss-box">')
    p.append("<h2>이 저장 결과의 사실</h2>")
    p.append("<ul>")
    p.append(f"<li>차별점 카드: {len(diffs)}개</li>")
    photo_note = "" if len(analyzed_photos) == photo_count else f" (AI가 분석한 사진 {len(analyzed_photos)}장)"
    p.append(f"<li>현장사진: {photo_count}장{photo_note}</li>")
    mission_note = ""
    if guideline_missions > len(missions):
        mission_note = f" (가이드라인 미션 {guideline_missions}개 중 AI 판정이 없는 {guideline_missions - len(missions)}개는 화면 검수표에서 미충족으로 처리)"
    p.append(f"<li>미션 충족: {met} / {len(missions)} — AI 자체 판정{mission_note}</li>")
    p.append(f"<li>확인 필요 경고(AI가 스스로 표시): {len(warnings)}건</li>")
    p.append("<li>가이드라인 조건 충족 수: 브라우저의 검수 로직이 계산하므로 위 화면의 검수표에서 확인</li>")
    p.append("</ul>")
    p.append("</div>")

    # 3) 블로그 초안
    p.append('<div class="ss-box">')
    p.append("<h2>블로그 리뷰 초안 (AI 생성 원문)</h2>")
    p.append('<p class="ss-note">⟦…⟧ 는 문장별 근거 출처 태그입니다. 담당자 승인 전의 초안입니다.</p>')
    p.append('<div class="ss-draft">')
    p.append(f"<h3>제목</h3><p><b>{esc(blog.get('title'))}</b></p>")
    if str(blog.get("disclosure") or "").strip():
        p.append(f"<h3>협찬 표시</h3><p>{esc_ml(blog.get('disclosure'))}</p>")
    p.append(f"<h3>첫 문단</h3><p>{esc_ml(blog.get('intro'))}</p>")
    for i, s in enumerate(sections, 1):
        p.append(f"<h3>{i}단락 · {esc(s.get('heading'))}</h3>")
        idx = [str(x) for x in as_list(s.get("photo_indexes"))]
        if idx:
            p.append(f'<p class="ss-note">배치 사진: {esc(", ".join("사진" + x for x in idx))}</p>')
        p.append(f"<p>{esc_ml(s.get('body'))}</p>")
    if str(blog.get("conclusion") or "").strip():
        p.append(f"<h3>맺음말</h3><p>{esc_ml(blog.get('conclusion'))}</p>")
    if str(blog.get("footer") or "").strip():
        p.append(f"<h3>하단 정보</h3><p>{esc_ml(blog.get('footer'))}</p>")
    if tags:
        p.append(f"<h3>태그</h3><p>{esc(' '.join('#' + t.lstrip('#') for t in tags))}</p>")
    p.append("</div>")
    p.append("</div>")

    # 4) 카드뉴스
    p.append('<div class="ss-box">')
    p.append(f"<h2>카드뉴스 {len(cards)}장 문구</h2>")
    p.append("<ol>")
    for c in cards:
        pi = c.get("photo_index")
        bg = f"배경 사진: 사진{esc(pi)}" if isinstance(pi, int) and pi > 0 else "배경 사진 없음"
        p.append(f'<li><b>{esc_ml(c.get("headline"))}</b><br>{esc_ml(c.get("body"))}<br><span class="ss-note">{bg}</span></li>')
    p.append("</ol>")
    if str(content.get("instagram_caption") or "").strip():
        p.append(f"<h3>인스타그램 캡션</h3><p>{esc_ml(content.get('instagram_caption'))}</p>")
    p.append("</div>")

    # 5) 미션 판정 표
    p.append('<div class="ss-box">')
    p.append(f"<h2>미션 판정 표 — AI 자체 판정 ({met} / {len(missions)} 충족)</h2>")
    p.append("<table>")
    p.append("<tr><th>#</th><th>미션</th><th>충족 여부</th><th>본문 인용(근거)</th></tr>")
    for i, m in enumerate(missions, 1):
        verdict = "충족" if m.get("met") is True else "미충족"
        p.append(f"<tr><td>{i}</td><td>{esc_ml(m.get('mission'))}</td><td>{verdict}</td><td>{esc_ml(m.get('quote'))}</td></tr>")
    p.append("</table>")
    p.append('<p class="ss-note">미션 판정은 AI가 본문 인용과 함께 스스로 내린 것이며, 최종 승인은 담당자가 합니다.</p>')
    p.append("</div>")

    p.append("</section>")
    return "\n".join(p)


# ---------- 산출물 만들기 ----------
def build_index_html(summary_html: str) -> str:
    src = read_text(PUBLIC / "index.html")
    if src.count(SCRIPT_ANCHOR) != 1:
        raise BuildError(f"public/index.html 에서 {SCRIPT_ANCHOR} 를 정확히 1개 찾지 못했습니다.")
    if src.count(MAIN_ANCHOR) != 1:
        raise BuildError("public/index.html 에서 </main> 을 정확히 1개 찾지 못했습니다.")
    src = src.replace(
        SCRIPT_ANCHOR,
        '<script src="static-data.js"></script><script src="static-shim.js"></script>' + SCRIPT_ANCHOR,
    )
    src = src.replace(
        MAIN_ANCHOR,
        MAIN_ANCHOR + "\n\n  <!-- 정적 요약: scripts/build_static_demo.py 가 빌드할 때 저장 결과에서 만든다 -->\n" + summary_html + "\n",
    )
    return src


def build_static_data(samples: dict, last_run: dict, built_at: str) -> str:
    payload = {"samples": samples, "lastRun": last_run, "builtAt": built_at}
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    text = text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return (
        "// 읽기 전용 정적 데모 데이터 — scripts/build_static_demo.py 가 만든 파일(직접 고치지 않는다)\n"
        "// samples: 기본 제품 자료·가이드라인, lastRun: 마지막 실제 생성 결과(사진은 축소본), builtAt: 빌드 시각\n"
        "window.__STATIC_DEMO__ = " + text + ";\n"
    )


def local_user_names() -> set:
    """이 PC 의 사용자 이름(환경변수·홈 폴더 이름). 스크립트에 이름을 적어 두지 않고 실행할 때 읽는다."""
    names = set()
    for cand in (os.environ.get("USERNAME"), os.environ.get("USER"), Path.home().name):
        cand = (cand or "").strip().lower()
        if len(cand) >= 3 and cand not in GENERIC_USER_NAMES:
            names.add(cand)
    return names


def check_forbidden(outputs: dict):
    users = local_user_names()
    tail = "docs/ 는 바꾸지 않았습니다."
    for name, data in outputs.items():
        text = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else data
        for bad in FORBIDDEN:
            if bad.lower() in text.lower():
                raise BuildError(f"공개하면 안 되는 문자열({bad!r})이 {name} 에 들어 있습니다. {tail}")
        plain = DATA_URL_RE.sub("", text)  # 사진 base64 본문 제외
        low = plain.lower()
        if any(u in low for u in users):
            raise BuildError(f"이 PC 의 사용자 이름이 {name} 에 들어 있습니다. {tail}")
        if "onedrive" in low:
            raise BuildError(f"'OneDrive' 경로로 보이는 문자열이 {name} 에 들어 있습니다. {tail}")
        # 오류 메시지에는 찾은 값을 그대로 찍지 않고 앞 3글자만 보여 준다
        m = EMAIL_RE.search(plain)
        if m:
            raise BuildError(f"이메일 주소로 보이는 문자열({m.group(0)[:3]}…)이 {name} 에 들어 있습니다. {tail}")
        m = MOBILE_RE.search(plain)
        if m:
            raise BuildError(f"휴대폰 번호로 보이는 문자열({m.group(0)[:3]}…)이 {name} 에 들어 있습니다. {tail}")


def clear_docs(force: bool):
    """docs/ 내용을 비운다(폴더 자체는 유지). 이 스크립트가 만든 폴더가 아니면 --force 없이는 지우지 않는다."""
    if DOCS.exists():
        if not DOCS.is_dir():
            raise BuildError("docs 가 폴더가 아닙니다.")
        entries = list(DOCS.iterdir())
        if entries and not (DOCS / "static-data.js").exists() and not force:
            raise BuildError("docs/ 에 이 스크립트가 만들지 않은 내용이 있습니다. 확인 후 --force 를 붙여 다시 실행하세요.")
        for entry in entries:
            for attempt in range(6):
                try:
                    if entry.is_dir() and not entry.is_symlink():
                        shutil.rmtree(entry)
                    else:
                        entry.unlink()
                    break
                except FileNotFoundError:
                    break
                except OSError:
                    if attempt == 5:
                        raise BuildError(f"docs/{entry.name} 을(를) 지우지 못했습니다(다른 프로그램이 사용 중일 수 있습니다).")
                    time.sleep(0.5)
    DOCS.mkdir(parents=True, exist_ok=True)


def photo_sizes_in(data_js: str):
    """만들어진 static-data.js 를 다시 읽어 임베드된 사진의 실제 크기를 잰다(최종 확인)."""
    start = data_js.index("window.__STATIC_DEMO__ = ") + len("window.__STATIC_DEMO__ = ")
    payload = json.loads(data_js[start:].rstrip().rstrip(";"))
    sizes = []
    for ph in payload["lastRun"]["photos"]:
        raw = base64.b64decode(ph["url"].split(",", 1)[1])
        with Image.open(io.BytesIO(raw)) as im:
            sizes.append((im.format, im.size, bool(ph.get("publicBlur"))))
    return sizes


def main(argv):
    try:
        sys.stdout.reconfigure(errors="backslashreplace")
    except Exception:
        pass
    force = "--force" in argv
    keep_flagged = "--keep-flagged" in argv  # AI 가 개인정보 주의로 표시한 사진도 흐리게 하지 않는다(사용자 승인이 있을 때만)

    # 1) 입력을 모두 읽고 메모리에서 산출물을 만든다(여기서 실패하면 docs/ 는 그대로다)
    for name in COPY_FILES:
        if not (PUBLIC / name).is_file():
            raise BuildError(f"필요한 파일이 없습니다: public/{name}")
    try:
        last_run = json.loads(read_text(DATA_DIR / "last_run.json"))
    except json.JSONDecodeError as e:
        raise BuildError(f"data/last_run.json 을 해석하지 못했습니다(저장 중일 수 있습니다. 잠시 뒤 다시 실행): {e}")
    if not isinstance(last_run, dict) or not isinstance(last_run.get("analysis"), dict) or not isinstance(last_run.get("content"), dict):
        raise BuildError("data/last_run.json 에 analysis / content 가 없습니다.")
    photo_list = as_list(last_run.get("photos"))
    ai_flagged = sorted(flagged_photo_indexes(last_run["analysis"], len(photo_list)))
    blurred = [] if keep_flagged else ai_flagged
    photos, stats = process_photos(photo_list, frozenset(blurred))
    last_run = dict(last_run)
    last_run["photos"] = photos

    samples = {
        "product": read_text(DATA_DIR / "samples" / "product.md"),
        "guideline": read_text(DATA_DIR / "samples" / "guideline.md"),
    }
    built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    outputs = {name: (PUBLIC / name).read_bytes() for name in COPY_FILES if name != "index.html"}
    outputs["index.html"] = build_index_html(build_summary(last_run, len(photos), blurred)).encode("utf-8")
    outputs["static-data.js"] = build_static_data(samples, last_run, built_at).encode("utf-8")
    outputs["static-shim.js"] = read_text(SHIM_SRC).encode("utf-8")
    outputs[".nojekyll"] = b""  # GitHub Pages 가 Jekyll 처리 없이 파일을 그대로 올리게 한다
    check_forbidden(outputs)

    # 2) docs/ 를 비우고 새로 쓴다
    clear_docs(force)
    for name, data in outputs.items():
        (DOCS / name).write_bytes(data)

    # 3) 최종 확인: 파일 목록이 정확히 기대한 것뿐인지, 임베드된 사진이 모두 MAX_SIDE 이하인지
    expected = sorted(COPY_FILES + GENERATED_FILES)
    actual = sorted(str(f.relative_to(DOCS)).replace("\\", "/") for f in DOCS.rglob("*"))
    if actual != expected:
        raise BuildError(f"docs/ 내용이 기대와 다릅니다: {actual}")
    embedded = photo_sizes_in((DOCS / "static-data.js").read_bytes().decode("utf-8"))
    if any(max(size) > MAX_SIDE or fmt != "JPEG" for fmt, size, _b in embedded):
        raise BuildError(f"임베드된 사진 크기 확인 실패: {embedded}")
    if [i for i, (_f, _s, b) in enumerate(embedded, 1) if b] != blurred:
        raise BuildError("임베드된 사진의 흐림 처리 표시가 기대와 다릅니다.")

    # 4) 보고
    out(f"[build_static_demo] docs/ 생성 완료  (builtAt {built_at})")
    out(f"  저장 결과: savedAt {last_run.get('savedAt')}  = {kst_text(last_run.get('savedAt'))} KST")
    out("  파일:")
    total = 0
    for name in expected:
        size = (DOCS / name).stat().st_size
        total += size
        out(f"    docs/{name:<16} {size:>9,} bytes")
    out(f"    합계 {total:,} bytes")
    out(f"  사진 {len(stats)}장 (긴 변 최대 {MAX_SIDE}px, JPEG quality {JPEG_QUALITY}):")
    for s, (_fmt, size, _b) in zip(stats, embedded):
        out(
            f"    사진{s['index']} {s['name']}: {s['original'][0]}x{s['original'][1]} -> {size[0]}x{size[1]}, "
            f"{s['bytes_in']:,} -> {s['bytes_out']:,} bytes" + ("  [AI 개인정보 주의 -> 흐림 처리]" if s["blurred"] else "")
        )
    out(f"  AI가 '개인정보 주의'로 표시한 사진: {ai_flagged or '없음'} / 흐림 처리한 사진: {blurred or '없음'}")
    if keep_flagged and ai_flagged:
        out("  주의: --keep-flagged 로 실행해 위 사진을 흐리게 하지 않았습니다. 사용자가 공개를 승인한 경우에만 게시하세요.")
    content = last_run.get("content") or {}
    missions = [m for m in as_list(content.get("mission_check")) if isinstance(m, dict)]
    timings = last_run.get("timings") or {}
    t_a, t_g = num(timings.get("analyze")), num(timings.get("generate"))
    out(
        f"  수치(README 7장 표에 옮길 값): 분석 {t_a:g}초 + 생성 {t_g:g}초 = {t_a + t_g:.1f}초, "
        f"미션 {sum(1 for m in missions if m.get('met') is True)}/{len(missions)}(AI 판정), "
        f"경고 {len(as_list(content.get('warnings')))}건, 자동 재생성 {'있음' if last_run.get('retried') else '없음'}"
    )
    out("  확인: public/_demo 미복사, 금지 문자열(키·경로·사용자 이름·OneDrive·이메일·휴대폰 번호) 없음, 사진 전부 긴 변 %dpx 이하" % MAX_SIDE)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BuildError as e:
        print(f"[build_static_demo] 실패: {e}", file=sys.stderr)
        sys.exit(1)
