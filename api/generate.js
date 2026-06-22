// /api/generate.js
// Vercel Serverless Function
// 브라우저가 아니라 서버에서 Anthropic API를 호출하므로
// API 키가 노출되지 않고, CORS/404 문제가 발생하지 않습니다.
//
// [업그레이드 버전 + CORS]
// 기존 프론트엔드와 100% 호환됩니다.
//  - 받는 값: image, mediaType, mood, seed, likedCopies  (기존과 동일)
//  - 추가(선택): cafeProfile  ← 프론트에서 안 보내도 정상 동작. 보내면 품질 급상승.
//  - 응답 형식: { versions: [{ tone, pattern, text, hashtags }] }  (기존과 동일)

// ---------- 절대 금지 표현 (클리셰 차단) ----------
// 카페 사장님이 ChatGPT에 그냥 물어봤을 때 쏟아지는 "어디든 붙는" 표현들.
// 이걸 막아야 카페픽만의 결과가 나옵니다.
const BANNED = [
  '오늘의 한 잔', '오늘도 수고', '여유 한 잔', '여유로운', '힐링', '소확행',
  '감성', '감성적인', '특별한 하루', '행복한 하루', '행복한 하루 보내세요',
  '조용히 준비했어요', '일상 속', '일상에', '작은 행복', '따뜻한 한 잔',
  '바쁜 일상', '잠시 쉬어가는', '쉼표', '향긋한', '진한 커피 한 잔',
  '커피 한 잔의 여유', '당신을 위한', '오늘 하루도', '마음까지 따뜻',
];

// ---------- 검증된 카피 패턴 ----------
const TREND_PATTERNS = `
[검증된 5가지 카피 패턴 — 버전마다 서로 다른 패턴을 1개씩 사용]
1. 후킹형: 첫 줄에서 궁금증/반전/숫자로 스크롤을 멈추게 함 (예: "이거 단골도 모르는 메뉴")
2. 정보형: 원두·재료·온도·비율 등 '이 카페만 아는 사실' 1개를 콕 집어 전달
3. 공감형: 보는 사람의 구체적 상황을 먼저 찌르고 메뉴로 연결 (막연한 위로 X)
4. 비교형: A vs B / Before vs After / 남들과 다른 점을 대비로 보여줌
5. CTA형: 저장·방문·댓글 중 딱 하나의 행동을 자연스럽게 유도
`;

// ---------- 릴스/인스타 캡션 구조 규칙 ----------
const STRUCTURE_RULES = `
[캡션 작성 구조 — 모든 버전 공통]
- 1번째 줄 = 훅. 인스타에서 "...더보기"로 잘리기 전, 이 한 줄로 승부. 절대 인사말로 시작하지 말 것.
- 본문 = 사진에서 뽑은 '구체적 디테일' + 그게 왜 특별한지 한 가지 이유. 추상적 형용사 나열 금지.
- 마무리 = 행동 유도 한 줄 (저장 / 방문 / 위치 언급 / 운영시간 등 중 1개만).
- 해시태그 = 지역태그 + 메뉴태그 + 상황태그를 섞어서 5개. #카페스타그램 #일상 같은 광범위 스팸 태그 금지. 실제로 검색될 법한 구체 태그로.
`;

// ---------- 사람처럼 쓰기 규칙 (AI 티 제거) ----------
const HUMAN_VOICE_RULES = `
[사람처럼 쓰기 — AI 냄새 제거]
- 브랜드 공식계정 말투 금지. 이 카페를 직접 운영하는 사장님이 폰으로 쓴 느낌.
- 모든 문장을 완결형으로 쓰지 말 것. 짧은 단문, 명사로 끝나는 문장, 말줄임도 섞어 리듬을 줄 것.
- 이모지는 0~2개까지만. 줄마다 박지 말 것.
- "~보세요", "~하세요" 같은 정중한 권유체를 모든 줄에 반복하지 말 것.
- 같은 단어(특히 '커피', '맛')를 3번 이상 반복하지 말 것.
`;

export default async function handler(req, res) {
  // ---------- CORS (토스 앱 등 다른 출처에서 호출 허용) ----------
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 가능합니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'API 키가 설정되지 않았어요. Vercel 프로젝트 Settings → Environment Variables 에서 ANTHROPIC_API_KEY를 추가해주세요.'
    });
  }

  const { image, mediaType, mood, seed, likedCopies, cafeProfile } = req.body || {};
  if (!image || !mediaType || !mood) {
    return res.status(400).json({ error: '사진 또는 분위기 정보가 누락되었어요.' });
  }

  // ---------- (선택) 카페 프로필 주입 — 진짜 차별점이 나오는 핵심 ----------
  // 프론트에서 온보딩으로 아래 정보를 모아 cafeProfile로 넘기면 품질이 크게 올라갑니다.
  // 하나도 안 넘어와도 정상 동작합니다.
  let profileBlock = '';
  if (cafeProfile && typeof cafeProfile === 'object') {
    const p = cafeProfile;
    const lines = [];
    if (p.name) lines.push(`- 카페 이름: ${p.name}`);
    if (p.area) lines.push(`- 동네/위치: ${p.area} (지역 해시태그에 활용)`);
    if (p.signature) lines.push(`- 시그니처 메뉴와 디테일: ${p.signature}`);
    if (p.difference) lines.push(`- 다른 카페와 다른 점: ${p.difference}`);
    if (p.target) lines.push(`- 주 손님층: ${p.target}`);
    if (p.voiceSample) lines.push(`- 사장님 평소 말투 샘플: "${p.voiceSample}" (이 말투의 리듬·어휘를 흉내낼 것)`);
    if (lines.length > 0) {
      profileBlock = `
[이 카페만의 정보 — 반드시 활용해서 '이 카페가 아니면 못 쓰는' 문장을 만들 것]
${lines.join('\n')}
`;
    }
  }

  // ---------- 피드백 누적: 좋아했던 카피를 few-shot으로 주입 ----------
  let styleMemoryBlock = '';
  if (Array.isArray(likedCopies) && likedCopies.length > 0) {
    const examples = likedCopies
      .slice(-6)
      .map((c, i) => `예시 ${i + 1} (분위기: ${c.mood || '미지정'})\n"${c.text}"`)
      .join('\n\n');

    styleMemoryBlock = `
[이 사장님이 실제로 복사해서 사용했던 카피들 — 이 스타일/어휘/리듬을 참고]
${examples}

위 예시들의 말투·문장 길이·어휘 경향을 분석해서 이번에도 비슷한 느낌을 반영해.
단, 그대로 베끼지 말고 새 사진에 맞게 새로 써.
`;
  }

  const bannedList = BANNED.map(w => `"${w}"`).join(', ');

  const prompt = `너는 한국 개인 카페의 인스타그램을 직접 운영하는 사장님 본인이야. 대행사도 챗봇도 아니야.
첨부된 사진은 이 카페의 메뉴/음료/공간 사진이야.

[가장 먼저 할 일 — 출력에는 쓰지 말고 머릿속으로만]
사진을 보고, '이 사진이 아니면 절대 나올 수 없는 구체적 디테일' 1가지를 먼저 찾아.
(예: 막연한 "예쁜 라떼" X → "라떼 표면에 흑임자가 한쪽으로 치우쳐 뿌려진 결" O)
이 디테일을 모든 카피의 중심에 둬.

타겟/톤 방향: "${mood}"

${profileBlock}
${TREND_PATTERNS}
${STRUCTURE_RULES}
${HUMAN_VOICE_RULES}
${styleMemoryBlock}

[절대 금지 단어/표현]
아래 표현은 어떤 카페에든 붙는 클리셰라 한 개도 쓰지 마:
${bannedList}
이 중 하나라도 들어갔으면 그 문장은 실패한 거야. 다시 써.

[버전 3개 — 길이만 다른 게 아니라 '전략'이 달라야 함]
- 버전 A, B, C는 위 5가지 패턴 중 서로 다른 패턴을 사용하고, 접근 각도 자체가 달라야 해.
- 길이/리듬도 서로 다르게 (하나는 짧고 강하게, 하나는 서술적으로, 하나는 질문/대화체).
- 세 버전을 나란히 읽었을 때 "같은 말 세 번"이 아니라 "다른 세 사람이 쓴 글"처럼 느껴져야 해.
- 변주 시드값: ${seed || 'none'} (값이 다르면 결과도 달라져야 함)

아래 JSON 형식으로만 응답해. 마크다운 코드블록 없이 순수 JSON만:
{
  "versions": [
    { "tone": "짧고 강하게", "pattern": "사용한 패턴명", "text": "...", "hashtags": ["...","...","...","...","..."] },
    { "tone": "서술적으로", "pattern": "사용한 패턴명", "text": "...", "hashtags": ["...","...","...","...","..."] },
    { "tone": "대화체로", "pattern": "사용한 패턴명", "text": "...", "hashtags": ["...","...","...","...","..."] }
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
        max_tokens: 2000,
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
