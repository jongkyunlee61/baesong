// Vercel 서버 함수: 배송표 사진 -> 업체별 수량(JSON). API 키는 Vercel 환경변수에만 둡니다.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 가능합니다." });

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." });

  var code = process.env.ACCESS_CODE;
  if (code && req.headers["x-access-code"] !== code) return res.status(401).json({ error: "접속 코드가 맞지 않습니다." });

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body.image !== "string" || !Array.isArray(body.names)) return res.status(400).json({ error: "요청 형식이 올바르지 않습니다." });

  var m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.image);
  if (!m) return res.status(400).json({ error: "이미지 형식이 올바르지 않습니다." });
  var names = body.names.slice(0, 80).map(String);

  var prompt =
    "이 사진은 한국어 도시락 배송표(표)입니다. 열은 '일반', '많이'(=양많이), '특양많이', '스페셜', '밑반/샐러드'(=샐러드), '초등/학생(일반·많이)', '어린이 / 기타사항' 순서이고, '바트'는 칸이 아니라 글자로 적힌 경우가 많습니다(예: '바트1').\n" +
    "각 거래처 행에서 손으로 쓰거나 인쇄된 수량 숫자를 읽어 JSON으로만 답하세요.\n" +
    "규칙:\n" +
    "- name은 아래 목록 중 가장 일치하는 이름을 글자 그대로 쓰세요. 목록에 없으면 null.\n" +
    "- 수량 숫자도 결제금액도 없는 행은 rows에 넣지 마세요.\n" +
    "- 표 오른쪽의 '결제금액' 칸에 손으로 쓴 금액이 있으면 해당 거래처 행의 '금액'(원 단위 정수, 쉼표 제거)로 넣으세요. 사진이 옆으로 누워 있어도 열 머리글(결제금액)과 같은 행의 거래처를 정확히 맞추세요. 금액이 없으면 0. 금액을 읽기 어려우면 가장 가능성 높은 값을 넣으세요.\n" +
    "- 숫자는 해당 열에 맞게 넣으세요. 보이지 않는 열은 0.\n" +
    "- '어린이 / 기타사항' 열에 적힌 숫자(예: 31, 10)는 해당 행의 '어린이'로 넣으세요. 이 열은 반드시 확인하세요.\n" +
    "- 비고/메모 글자에 '수저국자 1통', '밥 6통', '옛날도시락 5개'처럼 품목과 수량이 명확히 적혀 있으면 해당 행의 '수저국자', '밥', '옛날도시락'으로 넣으세요. 명확하지 않으면 0.\n" +
    "- '특양많이'는 별도 수량 칸이 있을 때만 숫자를 넣고, 글자로만 적혀 있고 숫자가 없으면 0입니다.\n" +
    "- 시간(예: 11:30, 10:50), 빨간 '+서비스', '특양많이' 같은 글자는 수량이 아닙니다. '바트1, 국통1'이면 바트=1.\n" +
    "- '기사님 식사' 행의 숫자는 일반으로 넣으세요.\n" +
    "- 표 맨 아래 합계 숫자(일반/많이/스페셜/어린이 순서)가 있으면 totals에 넣으세요. 없으면 null.\n" +
    "- date는 표 위쪽 날짜를 YYYY-MM-DD로, 모르면 null.\n" +
    "형식: {\"date\":\"2026-11-05\",\"rows\":[{\"name\":\"...\",\"일반\":0,\"양많이\":0,\"특양많이\":0,\"스페셜\":0,\"샐러드\":0,\"바트\":0,\"어린이\":0,\"수저국자\":0,\"밥\":0,\"옛날도시락\":0,\"금액\":0}],\"totals\":{\"일반\":0,\"양많이\":0,\"스페셜\":0,\"어린이\":0}}\n" +
    "이름 목록:\n" + names.map(function (n) { return "- " + n; }).join("\n");

  try {
    var r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 3000,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
          { type: "text", text: prompt }
        ] }]
      })
    });
    var j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "AI 호출 실패: " + ((j && j.error && j.error.message) || r.status) });
    var text = (j.content || []).map(function (c) { return c.text || ""; }).join("");
    var a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b < a) return res.status(502).json({ error: "결과를 해석하지 못했습니다. 다시 촬영해 주세요." });
    var data = JSON.parse(text.slice(a, b + 1));
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "처리 중 오류: " + (e && e.message ? e.message : e) });
  }
};
