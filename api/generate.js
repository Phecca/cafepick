// /api/generate.js
// Vercel Serverless Function
// 브라우저가 아니라 서버에서 Anthropic API를 호출하므로
// API 키가 노출되지 않고, CORS/404 문제가 발생하지 않습니다.

// ---------- 트렌드 패턴 가이드 ----------
// 한국 카페 인스타 릴스/포스팅에서 반응이 좋은 5가지 구조 패턴.
// 이 목록은 "카페 릴스 문구 가이드"에서 정리한 내용을 프롬프트에 주입해
// 일반 챗봇에 그냥 물어봤을 때보다 더 구체적이고 실전적인 결과를 유도합니다.
const TREND_PATTERNS = `
[참고할 5가지 검증된 카피 패턴 — 상황에 맞게 1개 이상 활용]
1. 후킹형: 첫 줄에서 궁금증/호기심을 자극 (예: "이 메뉴, 단골만 아는 거 아세요?")
2. 비교형: Before/After 또는 A vs B 구조로 차이를 보여줌
3. 공감형: 보는 사람의 일상/감정에 먼저 공감한 뒤 메뉴로 연결
4. 정보형: 원두, 재료, 조합 등 구체적 정보를 리스트나 한 가지 사실로 제공
5. CTA형: 저장/댓글/방문을 유도하는 명확한 행동 한 줄로 마무리

[금지 표현 — 절대 사용하지 말 것]
"오늘의 한 잔", "조용히 준비했어요", "특별한 하루", "행복한 하루 보내세요" 같은
어떤 카페에든 붙여도 말이 되는 뻔한 문구는 절대 쓰지 않는다.
대신 사진에서 실제로 보이는 디테일(색, 질감, 라떼아트 모양, 조명, 좌석, 그릇 등)을
최소 1개 이상 구체적으로 언급해서, 이 사진이 아니면 나올 수 없는 문장을 만든다.
`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 가능합니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'API 키가 설정되지 않았어요. Vercel 프로젝트 Settings → Environment Variables 에서 ANTHROPIC_API_KEY를 추가해주세요.'
    });
  }

  const { image, mediaType, mood, seed, likedCopies } = req.body || {};
  if (!image || !mediaType || !mood) {
    return res.status(400).json({ error: '사진 또는 분위기 정보가 누락되었어요.' });
  }

  // ---------- 피드백 누적: 좋아했던 카피를 few-shot으로 주입 ----------
  let styleMemoryBlock = '';
  if (Array.isArray(likedCopies) && likedCopies.length > 0) {
    const examples = likedCopies
      .slice(-6)
      .map((c, i) => `예시 ${i + 1} (분위기: ${c.mood || '미지정'})\n"${c.text}"`)
      .join('\n\n');

    styleMemoryBlock = `
[이 카페 사장님이 실제로 복사해서 사용했던 카피들 — 이 스타일/어휘/리듬을 참고할 것]
${examples}

위 예시들의 공통적인 말투, 문장 길이, 어휘 선택 경향을 분석해서
이번 카피에도 비슷한 느낌을 자연스럽게 반영해줘.
단, 문장을 그대로 베끼거나 재사용하지는 말고, 새로운 사진에 맞게 새로 써야 해.
`;
  }

  const prompt = `너는 한국 개인 카페 사장님을 위한 인스타그램 카피라이터야.
첨부된 사진은 카페의 메뉴, 음료, 또는 매장 공간 사진이야.
사진을 자세히 보고, 색감/구도/분위기/메뉴 종류를 파악해서
"${mood}" 분위기로 인스타그램 게시글 카피 3가지(버전 A, B, C)를 만들어줘.

${TREND_PATTERNS}
${styleMemoryBlock}

규칙:
- 각 버전은 분위기는 같지만 표현 방식과 길이가 서로 달라야 해 (하나는 짧고 담백하게, 하나는 조금 더 길고 서술적으로, 하나는 질문형이나 대화체 등 변주를 줄 것)
- 각 버전은 위 5가지 패턴 중 서로 다른 패턴을 활용해서 변주를 줄 것 (예: A=공감형, B=정보형, C=후킹형)
- 사진 속 구체적인 디테일(색, 재료, 분위기, 빛 등)을 카피에 반영해줘
- 줄바꿈을 적절히 활용해서 인스타그램 감성 줄글 형태로 작성
- 각 버전마다 어울리는 해시태그 5개를 추천해줘 (카페/지역/메뉴 관련, 한글 위주)
- 변주 시드값: ${seed || 'none'} (이 값이 다르면 결과도 달라져야 함)

아래 JSON 형식으로만 응답해. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력해:
{
  "versions": [
    { "tone": "짧고 담백하게", "pattern": "활용한 패턴명", "text": "...", "hashtags": ["...", "...", "...", "...", "..."] },
    { "tone": "서술적으로", "pattern": "활용한 패턴명", "text": "...", "hashtags": ["...", "...", "...", "...", "..."] },
    { "tone": "대화체로", "pattern": "활용한 패턴명", "text": "...", "hashtags": ["...", "...", "...", "...", "..."] }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: image }
              },
              { type: 'text', text: prompt }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data?.error?.message || `Anthropic API 오류 (${response.status})`;
      return res.status(response.status).json({ error: msg });
    }

    const rawText = data.content?.find(c => c.type === 'text')?.text || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: 'AI 응답을 해석하지 못했어요. 다시 시도해주세요.' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: '서버 요청 중 오류가 발생했어요: ' + err.message });
  }
}
