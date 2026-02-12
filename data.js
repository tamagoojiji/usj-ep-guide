// === 質問データ ===
const QUESTIONS = [
  {
    id: 1,
    question: "誰と行く？",
    type: "single",
    choices: [
      { emoji: "👨‍👩‍👧‍👦", title: "子連れファミリー", sub: "小さい子どもと一緒", scores: { premium: 1, exp7: 3, exp4: 2, nopass: 0 } },
      { emoji: "👫", title: "大人グループ", sub: "友達・家族（大人だけ）", scores: { premium: 3, exp7: 2, exp4: 1, nopass: 0 } },
      { emoji: "💑", title: "カップル", sub: "2人でデート", scores: { premium: 2, exp7: 2, exp4: 2, nopass: 0 } }
    ]
  },
  {
    id: 2,
    question: "いつ行く？",
    type: "single",
    choices: [
      { emoji: "🎌", title: "土日祝・大型連休", sub: "混雑日に行く予定", scores: { premium: 3, exp7: 2, exp4: 1, nopass: -2 } },
      { emoji: "📅", title: "平日", sub: "比較的空いてる日", scores: { premium: 0, exp7: 1, exp4: 2, nopass: 3 } }
    ]
  },
  {
    id: 3,
    question: "予算はどのくらい？",
    type: "single",
    choices: [
      { emoji: "💎", title: "お金より時間！", sub: "全力で楽しみたい", scores: { premium: 5, exp7: 2, exp4: 0, nopass: -3 } },
      { emoji: "⚖️", title: "コスパよく", sub: "バランス重視", scores: { premium: 0, exp7: 3, exp4: 3, nopass: 0 } },
      { emoji: "🪙", title: "できるだけ節約", sub: "チケット代だけで十分", scores: { premium: -3, exp7: -1, exp4: 1, nopass: 5 } }
    ]
  },
  {
    id: 4,
    question: "絶対乗りたいアトラクションは？",
    type: "multi",
    note: "あてはまるものを全部選んでね",
    choices: [
      { emoji: "🏎️", title: "マリオカート", sub: "ニンテンドーエリア", tag: "nintendo", scores: { premium: 2, exp7: 2, exp4: 1, nopass: 0 } },
      { emoji: "🦍", title: "ドンキーコング", sub: "ニンテンドーエリア", tag: "nintendo", scores: { premium: 2, exp7: 2, exp4: 1, nopass: 0 } },
      { emoji: "🧙", title: "ハリポタ", sub: "ウィザーディング・ワールド", tag: "harrypotter", scores: { premium: 2, exp7: 2, exp4: 1, nopass: 0 } },
      { emoji: "🦖", title: "ダイナソー", sub: "ジュラシック・ワールド", tag: "other", scores: { premium: 1, exp7: 1, exp4: 1, nopass: 0 } },
      { emoji: "🍌", title: "ミニオン", sub: "ミニオン・パーク", tag: "other", scores: { premium: 1, exp7: 1, exp4: 1, nopass: 0 } },
      { emoji: "🌊", title: "ジュラシック", sub: "ジュラシック・パーク・ザ・ライド", tag: "other", scores: { premium: 1, exp7: 1, exp4: 1, nopass: 0 } },
      { emoji: "🟢", title: "ヨッシー", sub: "ニンテンドーエリア", tag: "nintendo", scores: { premium: 1, exp7: 1, exp4: 1, nopass: 0 } }
    ]
  },
  {
    id: 5,
    question: "エクスプレスパスで何を重視する？",
    type: "single",
    choices: [
      { emoji: "⚡", title: "待ち時間ゼロ", sub: "とにかく並びたくない", scores: { premium: 5, exp7: 2, exp4: 0, nopass: -2 } },
      { emoji: "🎯", title: "人気だけ押さえたい", sub: "主要アトラクションだけでOK", scores: { premium: 0, exp7: 3, exp4: 3, nopass: 0 } },
      { emoji: "🏰", title: "エリア入場確約", sub: "確実にエリアに入りたい", scores: { premium: 3, exp7: 3, exp4: 0, nopass: -1 } }
    ]
  }
];

// === 結果データ ===
const RESULTS = {
  premium: {
    key: "premium",
    name: "ユニバーサル・エクスプレス・パス〜プレミアム〜",
    shortName: "プレミアム",
    color: "#FFD700",
    colorBg: "#FFF8E1",
    borderColor: "#FFD700",
    price: "35,200〜61,100円",
    description: "全13アトラクションを網羅する最強パス。ニンテンドーエリアもウィザーディング・ワールドも入場確約付き。混雑日でもほぼ待ち時間ゼロで遊べます。",
    attractions: [
      "マリオカート", "ドンキーコング", "ヨッシー",
      "ハリー・ポッター", "ダイナソー", "ミニオン",
      "ジュラシック・パーク", "他6アトラクション"
    ],
    areaEntry: true,
    areaEntryText: "ニンテンドーエリア＋ウィザーディング・ワールド 両方確約",
    advice: "「全部乗りたい！」という方に最適。土日祝や大型連休はこれ一択で、1日を丸ごと満喫できます。"
  },
  exp7: {
    key: "exp7",
    name: "ユニバーサル・エクスプレス・パス 7",
    shortName: "エクスプレス 7",
    color: "#4A90D9",
    colorBg: "#EBF3FB",
    borderColor: "#4A90D9",
    price: "21,800〜32,000円",
    description: "人気7アトラクションを厳選。ニンテンドーエリアとウィザーディング・ワールドの入場確約付きで、主要アトラクションをしっかり押さえられます。",
    attractions: [
      "マリオカート", "ドンキーコング", "ヨッシー",
      "ハリー・ポッター", "ダイナソー", "ミニオン",
      "ジュラシック・パーク"
    ],
    areaEntry: true,
    areaEntryText: "ニンテンドーエリア＋ウィザーディング・ワールド 両方確約",
    advice: "迷ったらコレ！コスパと満足度のバランスが一番良い定番チョイスです。"
  },
  exp4: {
    key: "exp4",
    name: "ユニバーサル・エクスプレス・パス 4",
    shortName: "エクスプレス 4",
    color: "#27AE60",
    colorBg: "#E8F8EF",
    borderColor: "#27AE60",
    price: "9,800〜30,000円",
    description: "4アトラクション分の時短パス。複数バリエーションがあり、乗りたいアトラクションに合わせて選べます。価格も比較的お手頃。",
    attractions: [
      "バリエーションにより異なる",
      "マリオカート含むセットあり",
      "ハリポタ含むセットあり",
      "ドンキーコング含むセットあり"
    ],
    areaEntry: false,
    areaEntryText: "バリエーションにより異なる（一部セットに付属）",
    advice: "「全部は要らないけど、人気どころは押さえたい」方にピッタリ。種類が多いので公式サイトで自分に合うセットをチェック！"
  },
  nopass: {
    key: "nopass",
    name: "買わなくてOK！",
    shortName: "買わなくてOK",
    color: "#F5A623",
    colorBg: "#FFF8EC",
    borderColor: "#F5A623",
    price: "0円",
    description: "平日や空いている日なら、エクスプレスパスなしでも十分楽しめます。朝イチ攻略とシングルライダーを活用すれば、主要アトラクションも制覇可能！",
    attractions: [],
    areaEntry: false,
    areaEntryText: "なし（通常の整理券 or 朝イチ入場で対応）",
    advice: "開園30分前には並ぶのがコツ。シングルライダーも上手に使えば、待ち時間を大幅に短縮できますよ！"
  }
};

// === スコアリング ===
function calculateResult(answers) {
  var scores = { premium: 0, exp7: 0, exp4: 0, nopass: 0 };

  // 回答情報を保持
  var budgetChoice = null;   // Q3
  var dateChoice = null;     // Q2
  var whoChoice = null;      // Q1
  var priorityChoice = null; // Q5
  var selectedAttractions = []; // Q4

  // 各質問の回答スコアを加算
  answers.forEach(function (ans, idx) {
    if (idx === 3) {
      // Q4: 複数選択
      selectedAttractions = ans;
      ans.forEach(function (choice) {
        scores.premium += choice.scores.premium;
        scores.exp7 += choice.scores.exp7;
        scores.exp4 += choice.scores.exp4;
        scores.nopass += choice.scores.nopass;
      });

      // Q4 個数ボーナス
      var count = ans.length;
      if (count >= 5) {
        scores.premium += 3;
      } else if (count >= 3) {
        scores.exp7 += 2;
      } else if (count >= 1) {
        scores.exp4 += 1;
      } else {
        scores.nopass += 3;
      }
    } else {
      // シングル選択
      var choice = ans;
      scores.premium += choice.scores.premium;
      scores.exp7 += choice.scores.exp7;
      scores.exp4 += choice.scores.exp4;
      scores.nopass += choice.scores.nopass;

      if (idx === 0) whoChoice = choice;
      if (idx === 1) dateChoice = choice;
      if (idx === 2) budgetChoice = choice;
      if (idx === 4) priorityChoice = choice;
    }
  });

  // === 特殊条件ルール ===

  // 1. 予算=全力 + 土日祝 → premium+4
  if (budgetChoice && budgetChoice.title === "お金より時間！" &&
      dateChoice && dateChoice.title === "土日祝・大型連休") {
    scores.premium += 4;
  }

  // 2. 予算=節約 + 平日 + 必須2個以下 → nopass+6
  if (budgetChoice && budgetChoice.title === "できるだけ節約" &&
      dateChoice && dateChoice.title === "平日" &&
      selectedAttractions.length <= 2) {
    scores.nopass += 6;
  }

  // 3. 子連れ + エリア確約重視 → exp7+3
  if (whoChoice && whoChoice.title === "子連れファミリー" &&
      priorityChoice && priorityChoice.title === "エリア入場確約") {
    scores.exp7 += 3;
  }

  // 4. ニンテンドーエリア2個以上選択 → premium+2, exp7+2
  var nintendoCount = selectedAttractions.filter(function (c) { return c.tag === "nintendo"; }).length;
  if (nintendoCount >= 2) {
    scores.premium += 2;
    scores.exp7 += 2;
  }

  // 5. ハリポタ選択 → premium+1, exp7+1
  var hasHarryPotter = selectedAttractions.some(function (c) { return c.tag === "harrypotter"; });
  if (hasHarryPotter) {
    scores.premium += 1;
    scores.exp7 += 1;
  }

  // === 判定: スコア最高のカテゴリ（僅差2点以内はexp7優先）===
  var keys = ["premium", "exp7", "exp4", "nopass"];
  var maxScore = Math.max(scores.premium, scores.exp7, scores.exp4, scores.nopass);

  // exp7が最高点と2点以内ならexp7を優先
  if (maxScore - scores.exp7 <= 2 && scores.exp7 > 0) {
    return {
      result: RESULTS.exp7,
      scores: scores,
      selectedAttractions: selectedAttractions
    };
  }

  // それ以外は最高スコアのカテゴリ
  var winner = keys[0];
  for (var i = 1; i < keys.length; i++) {
    if (scores[keys[i]] > scores[winner]) {
      winner = keys[i];
    }
  }

  return {
    result: RESULTS[winner],
    scores: scores,
    selectedAttractions: selectedAttractions
  };
}
