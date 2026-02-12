(function () {
  "use strict";

  // === 状態管理 ===
  var selectedDate = null;       // "2026-03-15" 形式
  var selectedHeight = 0;        // cm数値（0=制限なし扱い）
  var selectedTags = [];         // ["donkey", "mario", ...]
  var selectedBudget = null;     // "time" | "balance" | "save"
  var currentMonth = 3;          // 表示中の月
  var isTransitioning = false;

  // === 画面ID ===
  var screenIds = ["screen-top", "screen-date", "screen-height", "screen-attractions", "screen-budget", "screen-result", "screen-expired"];

  // === 画面遷移 ===
  function showScreen(id) {
    screenIds.forEach(function (sid) {
      document.getElementById(sid).classList.add("hidden");
    });
    document.getElementById(id).classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  // === 販売日チェック: その日にパスが1つでもあるか ===
  function hasAnyPassOnDate(dateStr) {
    return PASSES.some(function (p) {
      return p.pricing[dateStr] !== undefined;
    });
  }

  // === カレンダー描画 ===
  function renderCalendar(month) {
    currentMonth = month;
    var container = document.getElementById("calendar-container");
    var year = 2026;

    // 曜日ヘッダー
    var weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    var html = '<div class="calendar-header">';
    weekdays.forEach(function (wd, i) {
      var cls = "calendar-weekday";
      if (i === 0) cls += " sun";
      if (i === 6) cls += " sat";
      html += '<div class="' + cls + '">' + wd + '</div>';
    });
    html += '</div>';

    // グリッド
    html += '<div class="calendar-grid">';

    var firstDay = new Date(year, month - 1, 1).getDay();
    var daysInMonth = new Date(year, month, 0).getDate();

    // 空セル
    for (var e = 0; e < firstDay; e++) {
      html += '<div class="calendar-cell empty"></div>';
    }

    // 日付セル
    var today = new Date();
    var todayStr = today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2, "0") + "-" +
      String(today.getDate()).padStart(2, "0");

    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var dayOfWeek = new Date(year, month - 1, d).getDay();
      var available = hasAnyPassOnDate(dateStr);

      var cls = "calendar-cell";
      if (!available) cls += " disabled";
      if (dayOfWeek === 0) cls += " sun";
      if (dayOfWeek === 6) cls += " sat";
      if (dateStr === todayStr) cls += " today";
      if (dateStr === selectedDate) cls += " selected";

      html += '<div class="' + cls + '" data-date="' + dateStr + '">' + d + '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // タブの active 状態
    var tabs = document.querySelectorAll(".month-tab");
    tabs.forEach(function (tab) {
      tab.classList.remove("active");
      if (parseInt(tab.getAttribute("data-month")) === month) {
        tab.classList.add("active");
      }
    });

    // セルのクリックイベント
    var cells = container.querySelectorAll(".calendar-cell:not(.disabled):not(.empty)");
    cells.forEach(function (cell) {
      cell.addEventListener("click", function () {
        if (isTransitioning) return;
        // 選択状態を更新
        var allCells = container.querySelectorAll(".calendar-cell");
        allCells.forEach(function (c) { c.classList.remove("selected"); });
        cell.classList.add("selected");
        selectedDate = cell.getAttribute("data-date");

        // 0.4秒後に自動遷移
        isTransitioning = true;
        setTimeout(function () {
          isTransitioning = false;
          showScreen("screen-height");
        }, 400);
      });
    });
  }

  // === 身長選択肢 ===
  var heightChoices = [
    { emoji: "👶", title: "92cm未満", sub: "ベビーカーの赤ちゃんと", value: 0 },
    { emoji: "🧒", title: "92〜102cm未満", sub: "小さなお子さまと", value: 92 },
    { emoji: "👦", title: "102〜107cm未満", sub: "", value: 102 },
    { emoji: "🧑", title: "107〜122cm未満", sub: "", value: 107 },
    { emoji: "💪", title: "122〜132cm未満", sub: "", value: 122 },
    { emoji: "🎢", title: "132cm以上 / 大人だけ", sub: "全アトラクションOK", value: 132 }
  ];

  function renderHeightChoices() {
    var container = document.getElementById("height-choices");
    container.innerHTML = "";
    heightChoices.forEach(function (choice) {
      var card = createCard(choice.emoji, choice.title, choice.sub);
      card.addEventListener("click", function () {
        if (isTransitioning) return;
        var cards = container.querySelectorAll(".card-choice");
        cards.forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        card.classList.add("just-selected");
        selectedHeight = choice.value;

        isTransitioning = true;
        setTimeout(function () {
          isTransitioning = false;
          showScreen("screen-attractions");
        }, 400);
      });
      container.appendChild(card);
    });
  }

  // === アトラクション選択肢 ===
  var attractionChoices = [
    { emoji: "🦍", title: "ドンキーコング・トロッコ", sub: "ニンテンドーエリア", tag: "donkey" },
    { emoji: "🏎️", title: "マリオカート", sub: "ニンテンドーエリア", tag: "mario" },
    { emoji: "🟢", title: "ヨッシー・アドベンチャー", sub: "ニンテンドーエリア", tag: "yoshi" },
    { emoji: "🧙", title: "ハリー・ポッター", sub: "ウィザーディング・ワールド", tag: "harrypotter" },
    { emoji: "🦖", title: "フライングダイナソー", sub: "絶叫系", tag: "dinosaur" },
    { emoji: "🎢", title: "ハリウッド・ドリーム", sub: "バックドロップ含む", tag: "hollywood" },
    { emoji: "🍌", title: "ミニオン系", sub: "ミニオン・パーク", tag: "minion" },
    { emoji: "🌊", title: "ジュラシック・パーク・ザ・ライド", sub: "", tag: "jurassic" },
    { emoji: "🎬", title: "シアター系（4-Dなど）", sub: "", tag: "theater" },
    { emoji: "❓", title: "特にこだわりなし", sub: "", tag: "any" }
  ];

  function renderAttractionChoices() {
    var container = document.getElementById("attraction-choices");
    container.innerHTML = "";
    selectedTags = [];

    attractionChoices.forEach(function (choice) {
      var card = createCard(choice.emoji, choice.title, choice.sub);
      card.setAttribute("data-tag", choice.tag);
      card.addEventListener("click", function () {
        var tag = choice.tag;

        if (tag === "any") {
          // 「こだわりなし」選択時は他を全解除
          var allCards = container.querySelectorAll(".card-choice");
          allCards.forEach(function (c) { c.classList.remove("selected"); });
          card.classList.add("selected");
          selectedTags = ["any"];
        } else {
          // 「こだわりなし」を解除
          var anyCard = container.querySelector('[data-tag="any"]');
          if (anyCard) anyCard.classList.remove("selected");
          selectedTags = selectedTags.filter(function (t) { return t !== "any"; });

          // トグル
          var pos = selectedTags.indexOf(tag);
          if (pos === -1) {
            selectedTags.push(tag);
            card.classList.add("selected");
          } else {
            selectedTags.splice(pos, 1);
            card.classList.remove("selected");
          }
        }
      });
      container.appendChild(card);
    });
  }

  // === 予算選択肢 ===
  var budgetChoices = [
    { emoji: "💎", title: "お金より時間！", sub: "全力で楽しみたい", value: "time" },
    { emoji: "⚖️", title: "コスパよく", sub: "バランス重視", value: "balance" },
    { emoji: "🪙", title: "できるだけ節約", sub: "安いほどうれしい", value: "save" }
  ];

  function renderBudgetChoices() {
    var container = document.getElementById("budget-choices");
    container.innerHTML = "";
    budgetChoices.forEach(function (choice) {
      var card = createCard(choice.emoji, choice.title, choice.sub);
      card.addEventListener("click", function () {
        if (isTransitioning) return;
        var cards = container.querySelectorAll(".card-choice");
        cards.forEach(function (c) { c.classList.remove("selected"); });
        card.classList.add("selected");
        card.classList.add("just-selected");
        selectedBudget = choice.value;

        isTransitioning = true;
        setTimeout(function () {
          isTransitioning = false;
          showResult();
        }, 400);
      });
      container.appendChild(card);
    });
  }

  // === カード要素を生成 ===
  function createCard(emoji, title, sub) {
    var card = document.createElement("button");
    card.className = "card-choice";
    card.setAttribute("type", "button");
    card.innerHTML =
      '<span class="card-emoji">' + emoji + '</span>' +
      '<div class="card-text">' +
        '<div class="card-title">' + title + '</div>' +
        (sub ? '<div class="card-sub">' + sub + '</div>' : '') +
      '</div>' +
      '<div class="card-check"><span class="card-check-icon">&#10003;</span></div>';
    return card;
  }

  // === 結果表示 ===
  function showResult() {
    var result = calculateResult(selectedDate, selectedHeight, selectedTags, selectedBudget);
    showScreen("screen-result");

    var mainContainer = document.getElementById("main-result");
    var otherContainer = document.getElementById("other-results");
    mainContainer.innerHTML = "";
    otherContainer.innerHTML = "";

    if (!result.main) {
      mainContainer.innerHTML =
        '<div class="no-result">' +
          '<div class="no-result-emoji">😢</div>' +
          '<p class="no-result-text">条件に合うパスが見つかりませんでした</p>' +
          '<p class="no-result-sub">日付や身長の条件を変えて、もう一度お試しください。</p>' +
        '</div>';
      return;
    }

    // 身長警告
    var warningHtml = "";
    if (result.heightWarning) {
      warningHtml =
        '<div class="height-warning">' +
          '<p>⚠️ お子さまの身長では一部のアトラクションに身長制限があります。' +
          '各アトラクションの利用制限は公式サイトでご確認ください。</p>' +
        '</div>';
    }

    // メインカード
    mainContainer.innerHTML = warningHtml + buildResultCard(result.main, true);

    // 他の候補
    if (result.others.length > 0) {
      var othersHtml = '<p class="other-results-heading">他の候補</p>';
      result.others.forEach(function (item) {
        othersHtml += buildResultCard(item, false);
      });
      otherContainer.innerHTML = othersHtml;
    }

    // プランニングCTAのハイライト（節約選択時）
    var planningCta = document.getElementById("planning-cta");
    if (planningCta) {
      if (selectedBudget === "save") {
        planningCta.classList.add("highlight");
      } else {
        planningCta.classList.remove("highlight");
      }
    }
  }

  // === 結果カードHTML生成 ===
  function buildResultCard(item, isMain) {
    var p = item.pass;
    var price = item.price;
    var cardClass = isMain ? "result-card" : "sub-result-card";

    var html = '<div class="' + cardClass + '"';
    if (isMain) {
      html += ' style="border-color:' + p.borderColor + '; background:' + p.colorBg + '"';
    }
    html += '>';

    // バッジ
    html += '<div class="result-card-badge" style="background:' + p.color + '">' + p.shortName + '</div>';

    // パス名
    html += '<h3 class="result-card-name">' + p.name + '</h3>';

    // 価格
    html += '<p class="result-card-price" style="color:' + p.color + '">¥' + price.toLocaleString() + '</p>';

    // 説明
    html += '<p class="result-card-desc">' + p.description + '</p>';

    // アトラクション（メインカードのみ詳細表示）
    if (isMain) {
      html += buildAttractionsSection(p);
      html += buildAreaSection(p);
      html += buildAdviceSection(p);
    } else {
      // サブカードは簡易アトラクション表示
      html += buildSimpleAttractions(p);
    }

    html += '</div>';
    return html;
  }

  // === アトラクションが時間指定かどうか ===
  function isTimeDesignated(pass, attractionName) {
    if (!pass.timeDesignated || pass.timeDesignated.length === 0) return false;
    return pass.timeDesignated.some(function (td) {
      return attractionName === td;
    });
  }

  // === アトラクションタグHTML生成（時間指定・マッチ対応） ===
  function buildAttractionTag(pass, name) {
    var matched = isAttractionMatched(name);
    var timed = isTimeDesignated(pass, name);
    var cls = "attraction-tag";
    if (matched) cls += " matched";
    if (timed) cls += " time-designated";
    var icon = timed ? '<span class="td-icon">🕐</span>' : '';
    return '<li class="' + cls + '">' + icon + name + '</li>';
  }

  // === アトラクションセクション ===
  function buildAttractionsSection(pass) {
    var html = '<div class="info-section">';
    html += '<h4 class="info-title">含まれるアトラクション</h4>';

    // 時間指定の凡例
    if (pass.timeDesignated && pass.timeDesignated.length > 0) {
      html += '<div class="td-legend">';
      html += '<span class="td-legend-item"><span class="td-icon">🕐</span> = 体験時間が指定されます</span>';
      html += '</div>';
    } else if (pass.type === "premium" || pass.type === "ep7") {
      html += '<div class="td-legend td-legend-free">';
      html += '<span class="td-legend-item">全アトラクション時間指定なし（いつでも利用可能）</span>';
      html += '</div>';
    }

    // エリア入場（時間指定の場合）
    if (pass.timeDesignated && pass.timeDesignated.indexOf("スーパー・ニンテンドー・ワールド入場") !== -1) {
      html += '<ul class="attractions-list">';
      html += '<li class="attraction-tag time-designated area-entry-tag"><span class="td-icon">🕐</span>スーパー・ニンテンドー・ワールド入場</li>';
      html += '</ul>';
    }

    html += '<ul class="attractions-list">';
    pass.attractions.fixed.forEach(function (name) {
      html += buildAttractionTag(pass, name);
    });
    html += '</ul>';

    // 選択制1
    if (pass.attractions.selectable1.length > 0) {
      html += '<p class="selectable-label">△1 以下から1つ選べます</p>';
      html += '<ul class="attractions-list">';
      pass.attractions.selectable1.forEach(function (name) {
        html += buildAttractionTag(pass, name);
      });
      html += '</ul>';
    }

    // 選択制2
    if (pass.attractions.selectable2.length > 0) {
      html += '<p class="selectable-label">△2 以下から1つ選べます</p>';
      html += '<ul class="attractions-list">';
      pass.attractions.selectable2.forEach(function (name) {
        html += buildAttractionTag(pass, name);
      });
      html += '</ul>';
    }

    html += '</div>';
    return html;
  }

  // === アトラクション名がユーザー選択に一致するか ===
  function isAttractionMatched(name) {
    var matchMap = {
      donkey: ["ドンキーコング", "トロッコ"],
      mario: ["マリオカート"],
      yoshi: ["ヨッシー"],
      harrypotter: ["ハリー・ポッター", "ヒッポグリフ"],
      dinosaur: ["ダイナソー", "フライング"],
      hollywood: ["ハリウッド・ドリーム", "バックドロップ"],
      minion: ["ミニオン"],
      jurassic: ["ジュラシック・パーク"],
      theater: ["4-D", "コナン", "シアター", "シング"]
    };

    return selectedTags.some(function (tag) {
      if (tag === "any") return false;
      var keywords = matchMap[tag] || [];
      return keywords.some(function (kw) {
        return name.indexOf(kw) !== -1;
      });
    });
  }

  // === エリア入場確約セクション ===
  function buildAreaSection(pass) {
    if (pass.areaEntry.length === 0) {
      return '<div class="info-section"><h4 class="info-title">エリア入場確約</h4><p class="info-text">なし（通常の整理券 or 朝イチ入場で対応）</p></div>';
    }

    var hasHarryPotter = pass.areaEntry.indexOf("harrypotter") !== -1;

    var html = '<div class="info-section"><h4 class="info-title">エリア入場確約</h4><div>';
    pass.areaEntry.forEach(function (area) {
      if (area === "nintendo") {
        html += '<span class="area-badge nintendo">スーパー・ニンテンドー・ワールド</span>';
      } else if (area === "harrypotter") {
        html += '<span class="area-badge harrypotter">ウィザーディング・ワールド</span>';
      }
    });
    html += '</div>';
    if (hasHarryPotter) {
      html += '<p class="area-note">※現在ウィザーディング・ワールド・オブ・ハリー・ポッターの入場規制は行われていません</p>';
    }
    html += '</div>';
    return html;
  }

  // === アドバイスセクション ===
  function buildAdviceSection(pass) {
    return '<div class="info-section advice-section">' +
      '<h4 class="info-title">ワンポイントアドバイス</h4>' +
      '<p class="info-text">' + pass.advice + '</p>' +
    '</div>';
  }

  // === サブカード用簡易アトラクション ===
  function buildSimpleAttractions(pass) {
    var all = pass.attractions.fixed.concat(pass.attractions.selectable1).concat(pass.attractions.selectable2);
    if (all.length === 0) return "";

    var html = '<ul class="sub-attractions">';
    all.slice(0, 5).forEach(function (name) {
      var matched = isAttractionMatched(name);
      html += '<li class="attraction-tag' + (matched ? ' matched' : '') + '">' + name + '</li>';
    });
    if (all.length > 5) {
      html += '<li class="attraction-tag">他' + (all.length - 5) + '件</li>';
    }
    html += '</ul>';
    return html;
  }

  // === リセット ===
  function resetAll() {
    selectedDate = null;
    selectedHeight = 0;
    selectedTags = [];
    selectedBudget = null;
    currentMonth = 3;
    isTransitioning = false;
  }

  // === 期限切れチェック ===
  function isExpired() {
    var now = new Date();
    var expiry = new Date(2026, 3, 16); // 2026年4月16日（月は0始まり）
    return now >= expiry;
  }

  // === 初期化 ===
  function init() {
    // 期限切れの場合はトップ画面を非表示にして期限切れ画面を表示
    if (isExpired()) {
      document.getElementById("screen-top").classList.add("hidden");
      document.getElementById("screen-expired").classList.remove("hidden");
      return;
    }

    // スタートボタン
    document.getElementById("start-btn").addEventListener("click", function () {
      resetAll();
      showScreen("screen-date");
      renderCalendar(3);
      renderHeightChoices();
      renderAttractionChoices();
      renderBudgetChoices();
    });

    // 月タブ
    document.querySelectorAll(".month-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var month = parseInt(tab.getAttribute("data-month"));
        renderCalendar(month);
      });
    });

    // アトラクション「次へ」ボタン
    document.getElementById("attraction-next-btn").addEventListener("click", function () {
      if (selectedTags.length === 0) {
        selectedTags = ["any"];
      }
      showScreen("screen-budget");
    });

    // もう一度やる
    document.getElementById("retry-btn").addEventListener("click", function () {
      resetAll();
      showScreen("screen-date");
      renderCalendar(3);
      renderHeightChoices();
      renderAttractionChoices();
      renderBudgetChoices();
    });
  }

  init();
})();
