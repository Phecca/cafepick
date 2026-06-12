// /api/generate.js
// Vercel Serverless Function
// 브라우저가 아니라 서버에서 Anthropic API를 호출하므로
// API 키가 노출되지 않고, CORS/404 문제가 발생하지 않습니다.

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

  const { image, mediaType, mood, seed } = req.body || {};

  if (!image || !mediaType || !mood) {
    return res.status(400).json({ error: '사진 또는 분위기 정보가 누락되었어요.' });
  }

  const prompt = `너는 한국 개인 카페 사장님을 위한 인스타그램 카피라이터야.

첨부된 사진은 카페의 메뉴, 음료, 또는 매장 공간 사진이야.
사진을 자세히 보고, 색감/구도/분위기/메뉴 종류를 파악해서
"${mood}" 분위기로 인스타그램 게시글 카피 3가지(버전 A, B, C)를 만들어줘.

규칙:
- 각 버전은 분위기는 같지만 표현 방식과 길이가 서로 달라야 해 (하나는 짧고 담백하게, 하나는 조금 더 길고 서술적으로, 하나는 질문형이나 대화체 등 변주를 줄 것)
- 사진 속 구체적인 디테일(색, 재료, 분위기, 빛 등)을 카피에 반영해줘
- 줄바꿈을 적절히 활용해서 인스타그램 감성 줄글 형태로 작성
- 각 버전마다 어울리는 해시태그 5개를 추천해줘 (카페/지역/메뉴 관련, 한글 위주)
- 절대 이전에 만든 적 있는 듯한 뻔한 문구("오늘의 한 잔", "조용히 준비했어요" 등)는 피하고, 사진에서 본 내용을 구체적으로 반영한 새로운 문구를 써줘
- 변주 시드값: ${seed || 'none'} (이 값이 다르면 결과도 달라져야 함)

아래 JSON 형식으로만 응답해. 다른 텍스트나 마크다운 코드블록 없이 순수 JSON만 출력해:

{
  "versions": [
    { "tone": "짧고 담백하게", "text": "...", "hashtags": ["...", "...", "...", "...", "..."] },
    { "tone": "서술적으로", "text": "...", "hashtags": ["...", "...", "...", "...", "..."] },
    { "tone": "대화체로", "text": "...", "hashtags": ["...", "...", "...", "...", "..."] }
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
