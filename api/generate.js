// /api/generate.js
// Vercel Serverless Function
// 브라우저가 아니라 서버에서 Anthropic API를 호출하므로
// API 키가 노출되지 않고, CORS/404 문제가 발생하지 않습니다.
//
// [업그레이드 버전]
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
2. 정보형: '이 카페만 아는 사실' 1개를 강의하지 말고 혼잣말처럼 슬쩍 흘리기
3. 공감형: 보는 사람의 구체적 상황을 먼저 찌르고 메뉴로 연결 (막연한 위로 X)
4. 비교형: A vs B / Before vs After / 남들과 다른 점을 대비로 보여줌
5. CTA형: 저장·방문·댓글 중 딱 하나의 행동을 자연스럽게 유도
`;

// ---------- 릴스/인스타 캡션 구조 규칙 ----------
const STRUCTURE_RULES = `
[캡션 작성 구조 — 짧고 임팩트 있게. 이게 핵심 방향이다]
- 무조건 짧게. 카피 1개당 최대 3줄. 길게 늘어놓지 마라. 짧을수록 좋다.
- 1번째 줄 = '키워드 한 방'. 이 사진의 핵심을 명사 중심으로 딱 박아라. 한 줄 안에 강조 포인트 하나만.
  (예: "딸기 크루아상, 여기서만." / "이 집 시그니처는 흑임자 크림." / "갓 구운 거만 진열함.")
- 인사말·서론 금지. 첫 줄부터 바로 핵심.
- 강조는 '하나만'. 한 카피에 강조 포인트를 2개 이상 넣지 마라. 딱 하나 꽂고 끝.
- 강요/권유체("~하세요", "오세요", "놓치면 손해") 자제. 세련되게 툭 던지는 단정형이 더 낫다.
- 마무리는 (필요할 때만) 짧게. 대부분은 키워드 한 방 + 디테일 한 줄이면 충분.
- 해시태그 = 3~5개. 지역태그 + 메뉴태그 위주로, 실제로 검색될 구체 태그만.
  (#성수카페 #딸기크루아상 O / #카페스타그램 #일상 #감성 같은 광범위 스팸 태그 X)
`;

// ---------- 사람처럼 쓰기 규칙 (AI 티 제거) ----------
const HUMAN_VOICE_RULES = `
[사람처럼 쓰기 — 이게 제일 중요. AI 냄새가 나면 무조건 실패다]
- 너는 카피라이터가 아니라, 이 카페를 직접 하는 사장님이 폰으로 인스타에 쓱 올리는 글이야. 잘 쓰려고 하지 마. 오히려 살짝 덜 다듬어.
- 모든 문장을 완결형으로 쓰지 마. 명사로 끝내거나, 말 중간에 끊거나, 말줄임(...)도 섞어.
- 구어체로. 혼잣말하듯, 단골한테 말 걸듯. "아", "근데", "암튼", "ㅋㅋ", "진짜", "솔직히" 같은 추임새를 1~2개 정도 자연스럽게 섞어도 좋아 (남발은 금지).
- 정보를 강의하지 마. "로스팅 직후 48시간, 가스가 가장 많이 빠져나오는..." 이런 설명조 절대 금지. 대신 "이거 오늘 갈았는데 김 올라오는 거 봐바" 처럼 흘리듯.
- 감정을 예쁘게 포장하지 마. 솔직하고 날것의 결을 허용해 ("비 와서 한가함", "이거 사실 실수로 만든 메뉴").
- 이모지는 0~2개. 줄마다 박지 마.
- 같은 단어(특히 '커피', '맛', '향')를 3번 이상 반복하지 마.
`;

// ---------- AI 문장 구조 금지 (단어가 아니라 '구조'를 막는다) ----------
const AI_TELLS = `
[AI가 쓴 티 나는 '문장 구조' — 아래 패턴이 보이면 그 문장은 다시 써]
- 대시(—) 또는 콜론으로 멋부린 동격 설명 ("그 김 — 갓 내린 증거")
- "~뿐만 아니라", "~이자", "동시에", "~함으로써" 같은 문어체 접속
- 너무 깔끔하게 균형 잡힌 3단 구성 (도입-전개-마무리가 반듯한 것)
- 모든 문장이 같은 길이로 또박또박 떨어지는 것
- "여러분", "당신" 같은 불특정 호칭으로 훈계하듯 말하는 것
- 과한 미사여구·형용사 나열 ("진하고 깊고 그윽한")
- 결론을 친절하게 요약해주는 마무리 ("결국 이것이 우리의 자부심입니다")
`;

// ---------- 사람이 실제로 쓴 느낌의 예시 (이 거칠기/말투를 기준으로) ----------
// 내용을 베끼지 말고, '얼마나 안 다듬는지' 그 수준만 참고할 것.
const HUMAN_EXAMPLES = `
[참고용 — 진짜 사람이 쓴 카페 글의 '거칠기' 샘플. 내용 말고 톤·완성도만 참고]
샘플1: "이거 오늘 딱 두 판 구웠어요. 식기 전에 와야 함ㅎ"
샘플2: "비 와서 손님 없을 줄 알았는데 창가 자리 다 찼네 ㅋㅋ 이런 날 라떼가 잘 나가더라고요"
샘플3: "메뉴판에 없는 거 하나 있어요. 아는 사람만 시키는 거. 힌트는 초록색"
샘플4: "솔직히 오늘 원두 좀 과하게 볶음. 근데 이게 더 맛있다는 분들 있어서 당분간 이대로 감"
→ 보면 알겠지만 문장이 짧고, 끊기고, 완벽하지 않아. 이 정도 결이어야 진짜 같다.
→ 단, 거칠기는 위 '톤 가이드'에 맞춰 조절해라. 친근·발랄·드립이면 위 샘플처럼 ㅋㅋ·반말 OK,
   시크·고급·담백이면 ㅋㅋ 같은 건 빼고 더 절제하되 — 그래도 광고 문구처럼 매끄럽게는 쓰지 마.`;

// ---------- 톤별 가이드 (분위기 선택값에 따라 결을 잡아줌) ----------
// 프론트에서 보내는 mood 값과 매칭. 매칭 안 되면 그냥 단어만 사용.
const TONE_HINTS = {
  '잔잔하게': '차분하고 조용한 톤. 과장 없이 담담하게.',
  '담백하게': '짧고 깔끔하게. 군더더기 빼고 핵심만.',
  '고급지게': '정중하고 절제된 프리미엄 톤. 과한 수식어 대신 품격으로 승부.',
  '힙하게': '성수·브루클린식 힙스터 감성. 꾸밈없는 자신감과 인디 무드. 트렌디하되 억지 유행어·해시태그 남발은 금지.',
  '시크하게': '꾸안꾸·미니멀·무심한 도시 톤. 말 아끼고, 감정 과잉 없이 시크하게.',
  '인증샷용': '"여기 사진 찍으러 와야 함" 느낌. 포토존·비주얼 포인트를 콕 집어 박제 욕구를 자극.',
  '제철감 있게': '"지금 아니면 못 먹는" 시즌·계절 한정 느낌을 강조. 희소성과 타이밍으로 방문을 유도.',
  '친근하게': '다정한 반말체. 친한 단골에게 말 걸듯 편하게.',
  '발랄하게': '밝고 신나는 에너지. 리듬감 있게, 통통 튀게.',
  '드립있게': '위트·드립을 살짝. 과몰입·밈 감성 OK, 단 억지스럽거나 오글거리면 실패. 센스만큼만 쓸 것.',
};

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
  const toneHint = TONE_HINTS[mood] ? `\n(톤 가이드: ${TONE_HINTS[mood]})` : '';

  const prompt = `너는 한국 개인 카페의 인스타그램을 직접 운영하는 사장님 본인이야. 대행사도 챗봇도 아니야.
첨부된 사진은 이 카페의 메뉴/음료/공간 사진이야.

[STEP 0 — 사진 점검 (제일 먼저 할 것)]
첨부된 사진이 '카페와 관련된 사진'인지 판단해.
- 카페 관련 = 음료/커피/차/디저트/베이커리/매장 내부·외부/테이블·좌석/카페 인테리어/메뉴 등.
- 명백히 카페와 무관한 사진이면 (인물 셀카, 풍경, 동물, 추상 이미지·그림, 문서·스크린샷, 무관한 제품 등)
  → 카피를 절대 지어내지 말고, 아래 JSON '한 줄만' 출력하고 즉시 끝내:
  {"notCafe": true}
- 단, 애매하면(카페일 가능성이 조금이라도 있으면) 그냥 카페로 보고 진행해. '무관함이 확실할 때만' 거절.

[그 다음 — 출력에는 쓰지 말고 머릿속으로만]
사진을 보고, '이 사진이 아니면 절대 나올 수 없는 구체적 디테일' 1가지를 먼저 찾아.
(예: 막연한 "예쁜 라떼" X → "라떼 표면에 흑임자가 한쪽으로 치우쳐 뿌려진 결" O)
이 디테일을 모든 카피의 중심에 둬.

타겟/톤 방향: "${mood}"${toneHint}

${profileBlock}
${TREND_PATTERNS}
${STRUCTURE_RULES}
${HUMAN_VOICE_RULES}
${AI_TELLS}
${HUMAN_EXAMPLES}
${styleMemoryBlock}

[규칙 충돌 시 우선순위 — 매우 중요]
위 규칙들이 서로 부딪히면, 항상 '진짜 사람이 쓴 것 같은 자연스러움'이 이긴다.
구조의 완결성이나 정보 전달보다, 사장님이 장사하다 말고 폰으로 툭 올린 듯한 결이 우선이다.
완벽하게 잘 쓴 글보다, 살짝 허술해도 진짜 같은 글이 100배 낫다.

[절대 금지 단어/표현]
아래 표현은 어떤 카페에든 붙는 클리셰라 한 개도 쓰지 마:
${bannedList}
이 중 하나라도 들어갔으면 그 문장은 실패한 거야. 다시 써.

[버전 3개 — 셋 다 짧게. 접근 방식만 다르게]
- 세 버전 모두 짧고 임팩트 있게 (각 최대 3줄). 길게 쓰는 버전은 없다.
- 접근 각도를 다르게:
  · A = 키워드 강조형: 핵심을 명사로 딱 박기 ("딸기 크루아상, 여기서만.")
  · B = 단정형: 단언하는 한마디 ("이 집은 크림이 다르다.")
  · C = 위트/질문 한 방 (댓글 유발형): 짧은 질문·반전으로 보는 사람이 '댓글 달고 싶게' 만들기.
    단순 감상이 아니라 반응을 부르는 한 줄. ("이거 보고 침 고이면 ㅇㅈ?" / "이 조합 나만 좋아함?" / "여기 어딘지 맞히는 사람?")
    공감·동의·선택을 유도하되, 억지 밈·유행어 남발은 금지. 자연스럽게.
- 셋을 나란히 읽었을 때 "같은 말 세 번"이 아니라 접근이 확연히 달라야 한다.
- 변주 시드값: ${seed || 'none'} (값이 다르면 결과도 달라져야 함)

아래 JSON 형식으로만 응답해. 마크다운 코드블록 없이 순수 JSON만.
(단, STEP 0에서 카페 사진이 아니라고 확실히 판단했으면 versions 대신 {"notCafe": true} 만 출력)
{
  "versions": [
    { "tone": "키워드 강조", "pattern": "사용한 패턴명", "text": "...", "hashtags": ["...","...","..."] },
    { "tone": "단정형", "pattern": "사용한 패턴명", "text": "...", "hashtags": ["...","...","..."] },
    { "tone": "위트/질문", "pattern": "사용한 패턴명", "text": "...", "hashtags": ["...","...","..."] }
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

    // 카페와 무관한 사진인 경우: 카피를 지어내지 않고 안내
    if (parsed && parsed.notCafe === true) {
      return res.status(422).json({
        error: '카페 사진(음료·디저트·매장 공간 등)을 올려주세요! 이 사진으로는 카피를 만들기 어려워요.'
      });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: '서버 요청 중 오류가 발생했어요: ' + err.message });
  }
}
