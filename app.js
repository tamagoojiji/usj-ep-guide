(function () {
  "use strict";

  // === LIFF設定 ===
  var LIFF_ID = "2009540998-GQHSSunc";
  var GAS_URL = "https://script.google.com/macros/s/AKfycbzeFQtwr0M_UsMDjXg-lv7KtUkVossqeuqeJzjfYorMmYhsk4ccyhIYNif0F0kLgKxF/exec";
  var USER_MASTER_URL = "https://script.google.com/macros/s/AKfycbylb9DgElCxvX8P42y_Vu6EBDlRpxaeaOUF8Jw-kToTxXxpJ-8TKpAnLumn0WBahePI/exec";

  // === ユーザー情報 ===
  var lineUid = null;
  var lineDisplayName = null;
  var userRegistered = false;

  // === 診断状態管理 ===
  var selectedDate = null;
  var selectedHeight = 0;
  var selectedTags = [];
  var selectedBudget = null;
  var currentMonth = 3;
  var isTransitioning = false;

  // === 画面ID ===
  var screenIds = [
    "screen-loading", "screen-liff-error", "screen-register",
    "screen-top", "screen-date", "screen-height",
    "screen-attractions", "screen-budget", "screen-result",
    "screen-history", "screen-expired"
  ];

  // === 画面遷移 ===
  function showScreen(id) {
    screenIds.forEach(function (sid) {
      var el = document.getElementById(sid);
      if (el) el.classList.add("hidden");
    });
    document.getElementById(id).classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  // ============================================================
  //  LIFF初期化
  // ============================================================
  function initLiff() {
    liff.init({ liffId: LIFF_ID }).then(function () {
      if (!liff.isLoggedIn()) {
        // LINE内ブラウザならログインを促す、外部ブラウザなら登録なしで進む
        if (liff.isInClient()) {
          liff.login();
          return;
        }
        // 外部ブラウザ → 登録なしで診断のみ利用可能
        startWithoutLogin();
        return;
      }
      return liff.getProfile();
    }).then(function (profile) {
      if (!profile) return;
      lineUid = profile.userId;
      lineDisplayName = profile.displayName;

      // 期限切れチェック
      if (isExpired()) {
        showScreen("screen-expired");
        return;
      }

      // localStorage旧キー移行（ep_ → tamago_）
      var oldReg = localStorage.getItem("ep_registered_" + lineUid);
      var oldUser = localStorage.getItem("ep_user_" + lineUid);
      if (oldReg && !localStorage.getItem("tamago_registered_" + lineUid)) {
        localStorage.setItem("tamago_registered_" + lineUid, oldReg);
      }
      if (oldUser && !localStorage.getItem("tamago_user_" + lineUid)) {
        localStorage.setItem("tamago_user_" + lineUid, oldUser);
      }

      // リセットモード（?reset=true で登録画面に戻す）
      var params = new URLSearchParams(window.location.search);
      if (params.get("reset") === "true") {
        localStorage.removeItem("tamago_user_" + lineUid);
        localStorage.removeItem("tamago_registered_" + lineUid);
        localStorage.removeItem("ep_user_" + lineUid);
        localStorage.removeItem("ep_registered_" + lineUid);
        userRegistered = false;
        showRegisterScreen();
        return;
      }

      // ユーザー登録チェック
      checkUserRegistration();
    }).catch(function (err) {
      console.error("LIFF init error:", err);
      // LIFF初期化失敗 → 登録なしで診断のみ利用可能
      startWithoutLogin();
    });
  }

  // LIFF未使用時（外部ブラウザ or LIFF初期化失敗）→ 登録なしで診断に直接進む
  function startWithoutLogin() {
    if (isExpired()) {
      showScreen("screen-expired");
      return;
    }
    showScreen("screen-top");
  }

  // ============================================================
  //  ユーザー登録チェック（キャッシュ優先 + GASバックグラウンド確認）
  // ============================================================
  function checkUserRegistration() {
    // キャッシュから即座に判定（GAS呼び出しを待たない）
    var cachedRegistered = localStorage.getItem("tamago_registered_" + lineUid);
    var localUser = localStorage.getItem("tamago_user_" + lineUid);

    if (cachedRegistered === "true" || localUser) {
      userRegistered = true;
      showTopScreen();

      // バックグラウンドでユーザーマスターと同期
      if (USER_MASTER_URL) {
        fetch(USER_MASTER_URL + "?action=checkUser&uid=" + encodeURIComponent(lineUid))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (!data.registered) {
              localStorage.removeItem("tamago_registered_" + lineUid);
            }
          })
          .catch(function () { /* バックグラウンドなので無視 */ });
      }
      return;
    }

    // キャッシュなし → ユーザーマスターに問い合わせ
    if (!USER_MASTER_URL) {
      showRegisterScreen();
      return;
    }

    fetch(USER_MASTER_URL + "?action=checkUser&uid=" + encodeURIComponent(lineUid))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.registered) {
          userRegistered = true;
          localStorage.setItem("tamago_registered_" + lineUid, "true");
          showTopScreen();
        } else {
          showRegisterScreen();
        }
      })
      .catch(function () {
        showRegisterScreen();
      });
  }

  // ============================================================
  //  登録画面
  // ============================================================
  function showRegisterScreen() {
    showScreen("screen-register");

    // ウェルカムメッセージ
    var welcomeEl = document.getElementById("register-welcome");
    if (lineDisplayName) {
      welcomeEl.textContent = lineDisplayName + "さん、ようこそ！";
    }

    // 生年月日プルダウン生成
    var yearSelect = document.getElementById("reg-year");
    var monthSelect = document.getElementById("reg-month");
    var daySelect = document.getElementById("reg-day");

    if (yearSelect.options.length <= 1) {
      var currentYear = new Date().getFullYear();
      for (var y = currentYear; y >= 1930; y--) {
        var opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y + "年";
        yearSelect.appendChild(opt);
      }
      for (var m = 1; m <= 12; m++) {
        var opt2 = document.createElement("option");
        opt2.value = m;
        opt2.textContent = m + "月";
        monthSelect.appendChild(opt2);
      }
      for (var d = 1; d <= 31; d++) {
        var opt3 = document.createElement("option");
        opt3.value = d;
        opt3.textContent = d + "日";
        daySelect.appendChild(opt3);
      }
    }

    // 性別ボタン
    var selectedGender = null;
    var genderBtns = document.querySelectorAll(".gender-btn");
    genderBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        genderBtns.forEach(function (b) { b.classList.remove("selected"); });
        btn.classList.add("selected");
        selectedGender = btn.getAttribute("data-gender");
        updateRegisterBtn();
      });
    });

    // バリデーション
    var registerBtn = document.getElementById("register-btn");
    var privacyCheckbox = document.getElementById("privacy-checkbox");

    function updateRegisterBtn() {
      var valid = yearSelect.value && monthSelect.value && daySelect.value
        && selectedGender && privacyCheckbox.checked;
      registerBtn.disabled = !valid;
    }

    yearSelect.addEventListener("change", updateRegisterBtn);
    monthSelect.addEventListener("change", updateRegisterBtn);
    daySelect.addEventListener("change", updateRegisterBtn);
    privacyCheckbox.addEventListener("change", updateRegisterBtn);

    // 登録ボタン
    registerBtn.addEventListener("click", function () {
      if (registerBtn.disabled) return;

      var birthday = yearSelect.value + "-" +
        String(monthSelect.value).padStart(2, "0") + "-" +
        String(daySelect.value).padStart(2, "0");

      var userData = {
        uid: lineUid,
        name: lineDisplayName,
        birthday: birthday,
        gender: selectedGender,
        registeredAt: new Date().toISOString()
      };

      // ローカル保存（共通キー）
      localStorage.setItem("tamago_user_" + lineUid, JSON.stringify(userData));
      localStorage.setItem("tamago_registered_" + lineUid, "true");
      userRegistered = true;

      // ユーザーマスターGASに送信
      if (USER_MASTER_URL) {
        fetch(USER_MASTER_URL, {
          method: "POST",
          body: JSON.stringify({ action: "registerUser", data: userData })
        }).catch(function (err) {
          console.error("User master register error:", err);
        });
      }

      showTopScreen();
    });

    // プライバシーポリシーリンク
    var privacyLinkReg = document.getElementById("privacy-link-reg");
    if (privacyLinkReg) {
      privacyLinkReg.addEventListener("click", function (e) {
        e.preventDefault();
        document.getElementById("privacy-modal").classList.remove("hidden");
      });
    }
  }

  // ============================================================
  //  プライバシーポリシーモーダル
  // ============================================================
  function initPrivacyModal() {
    var modal = document.getElementById("privacy-modal");
    var closeBtn = document.getElementById("modal-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        modal.classList.add("hidden");
      });
    }
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) modal.classList.add("hidden");
      });
    }
  }

  // ============================================================
  //  トップ画面表示
  // ============================================================
  function showTopScreen() {
    showScreen("screen-top");

    // 登録済みなら履歴ボタン表示
    var historyBtn = document.getElementById("history-btn");
    if (userRegistered && historyBtn) {
      historyBtn.classList.remove("hidden");
    }
  }

  // ============================================================
  //  診断結果をGASに保存
  // ============================================================
  function saveDiagnosisResult(result) {
    var logData = {
      uid: lineUid,
      name: lineDisplayName,
      date: selectedDate,
      height: selectedHeight,
      tags: selectedTags.join(","),
      budget: selectedBudget,
      resultPassId: result.main ? result.main.pass.id : "",
      resultPassName: result.main ? result.main.pass.shortName : "",
      resultPrice: result.main ? result.main.price : 0,
      diagnosedAt: new Date().toISOString()
    };

    // ローカル保存（lineUidがある場合のみ）
    if (lineUid) {
      var historyKey = "ep_history_" + lineUid;
      var history = JSON.parse(localStorage.getItem(historyKey) || "[]");
      history.unshift(logData);
      if (history.length > 20) history = history.slice(0, 20);
      localStorage.setItem(historyKey, JSON.stringify(history));
    }

    // GASに送信（lineUidがある場合のみ）
    if (GAS_URL && lineUid) {
      fetch(GAS_URL, {
        method: "POST",
        body: JSON.stringify({ action: "saveDiagnosis", data: logData })
      }).catch(function (err) {
        console.error("GAS save error:", err);
      });
    }
  }

  // ============================================================
  //  履歴表示
  // ============================================================
  function showHistory() {
    showScreen("screen-history");
    var listEl = document.getElementById("history-list");

    var historyKey = "ep_history_" + lineUid;
    var history = JSON.parse(localStorage.getItem(historyKey) || "[]");

    if (history.length === 0) {
      listEl.innerHTML =
        '<div class="no-result">' +
          '<p class="no-result-text">まだ診断履歴がありません</p>' +
          '<p class="no-result-sub">診断を受けると、ここに結果が保存されます。</p>' +
        '</div>';
      return;
    }

    var html = "";
    history.forEach(function (item) {
      var d = new Date(item.diagnosedAt);
      var dateStr = d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
      var timeStr = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

      var heightLabel = getHeightLabel(item.height);
      var tagsLabel = item.tags.split(",").map(function (t) {
        return ATTRACTION_TAGS[t] || t;
      }).join("、");
      var budgetLabel = item.budget === "time" ? "お金より時間" :
        item.budget === "balance" ? "コスパよく" : "節約";

      html += '<div class="history-card">';
      html += '<div class="history-date">' + dateStr + ' ' + timeStr + '</div>';
      html += '<div class="history-result">' + (item.resultPassName || "該当なし") + '</div>';
      if (item.resultPrice) {
        html += '<div class="history-price">¥' + Number(item.resultPrice).toLocaleString() + '</div>';
      }
      html += '<div class="history-details">';
      html += '<span>訪問日: ' + item.date + '</span>';
      html += '<span>身長: ' + heightLabel + '</span>';
      html += '<span>予算: ' + budgetLabel + '</span>';
      html += '</div>';
      html += '</div>';
    });

    listEl.innerHTML = html;
  }

  function getHeightLabel(height) {
    if (height >= 132) return "132cm以上";
    if (height >= 122) return "122〜132cm";
    if (height >= 107) return "107〜122cm";
    if (height >= 102) return "102〜107cm";
    if (height >= 92) return "92〜102cm";
    return "92cm未満";
  }

  // ============================================================
  //  カレンダー・選択肢（既存ロジック）
  // ============================================================

  // priceRangeData: APIから取得した販売期間情報（通年パス予測判定に使用）
  var priceRangeData = null;

  function hasAnyPassOnDate(dateStr) {
    return PASSES.some(function (p) {
      if (p.pricing[dateStr] !== undefined) return true;
      // ローチケの販売期間内であれば有効（salesToがあればそれを上限、なければperformanceTo）
      if (p.lawson && p.lawson.performanceFrom) {
        var upperDate = p.lawson.salesTo || p.lawson.performanceTo;
        if (upperDate && dateStr >= p.lawson.performanceFrom && dateStr <= upperDate) return true;
      }
      // 通年型パス → priceRange内で販売見込み
      if (isRegularPass(p) && priceRangeData && priceRangeData.to && dateStr <= priceRangeData.to) {
        return true;
      }
      return false;
    });
  }

  function renderCalendar(month) {
    currentMonth = month;
    var container = document.getElementById("calendar-container");
    var year = 2026;

    var weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    var html = '<div class="calendar-header">';
    weekdays.forEach(function (wd, i) {
      var cls = "calendar-weekday";
      if (i === 0) cls += " sun";
      if (i === 6) cls += " sat";
      html += '<div class="' + cls + '">' + wd + '</div>';
    });
    html += '</div>';

    html += '<div class="calendar-grid">';

    var firstDay = new Date(year, month - 1, 1).getDay();
    var daysInMonth = new Date(year, month, 0).getDate();

    for (var e = 0; e < firstDay; e++) {
      html += '<div class="calendar-cell empty"></div>';
    }

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

    var tabs = document.querySelectorAll(".month-tab");
    tabs.forEach(function (tab) {
      tab.classList.remove("active");
      if (parseInt(tab.getAttribute("data-month")) === month) {
        tab.classList.add("active");
      }
    });

    var cells = container.querySelectorAll(".calendar-cell:not(.disabled):not(.empty)");
    cells.forEach(function (cell) {
      cell.addEventListener("click", function () {
        if (isTransitioning) return;
        var allCells = container.querySelectorAll(".calendar-cell");
        allCells.forEach(function (c) { c.classList.remove("selected"); });
        cell.classList.add("selected");
        selectedDate = cell.getAttribute("data-date");

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
    { emoji: "🦈", title: "ジョーズ", sub: "", tag: "jaws" },
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
          var allCards = container.querySelectorAll(".card-choice");
          allCards.forEach(function (c) { c.classList.remove("selected"); });
          card.classList.add("selected");
          selectedTags = ["any"];
        } else {
          var anyCard = container.querySelector('[data-tag="any"]');
          if (anyCard) anyCard.classList.remove("selected");
          selectedTags = selectedTags.filter(function (t) { return t !== "any"; });

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

  // ============================================================
  //  結果表示
  // ============================================================
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
    if (result.attractionMismatch) {
      warningHtml =
        '<div class="height-warning">' +
          '<p>⚠️ 選んだアトラクションを含むパスは、お子さまの身長制限により表示できませんでした。' +
          '代わりに身長条件に合うおすすめパスを表示しています。</p>' +
        '</div>';
    } else if (result.heightWarning) {
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

    // 予告パスセクション
    var upcomingContainer = document.getElementById("upcoming-results");
    var upcomingCards = document.getElementById("upcoming-cards");
    if (upcomingContainer && upcomingCards) {
      if (UPCOMING_PASSES && UPCOMING_PASSES.length > 0) {
        var upHtml = "";
        UPCOMING_PASSES.forEach(function (up) {
          upHtml += '<div class="upcoming-card">';
          upHtml += '<div class="upcoming-card-name">' + (up.passName || "") + '</div>';

          // 販売状況バッジ
          if (up.salesStatus === "販売予定") {
            if (up.salesFrom) {
              var sfp = up.salesFrom.split('-');
              var sfMonth = parseInt(sfp[1], 10);
              var sfDay = parseInt(sfp[2], 10);
              upHtml += '<span class="sales-badge sales-badge--upcoming">' + sfMonth + '月' + sfDay + '日〜販売開始予定</span>';
            } else {
              upHtml += '<span class="sales-badge sales-badge--upcoming">販売予定</span>';
            }
          } else if (up.salesStatus === "販売中") {
            upHtml += '<span class="sales-badge sales-badge--active">ローチケで販売中</span>';
          } else if (up.salesStatus === "受付終了") {
            upHtml += '<span class="sales-badge sales-badge--ended">受付終了</span>';
          } else if (up.salesStatus) {
            upHtml += '<span class="sales-badge sales-badge--upcoming">' + up.salesStatus + '</span>';
          }

          // 価格
          if (up.minPrice) {
            upHtml += '<div class="upcoming-card-price">¥' + up.minPrice.toLocaleString() + '~</div>';
            upHtml += '<p class="price-annotation">※日別価格は販売開始後に確定します</p>';
          }

          // メタ情報
          upHtml += '<div class="upcoming-card-meta">';
          if (up.performanceFrom && up.performanceTo) {
            var pfp = up.performanceFrom.split('-');
            var ptp = up.performanceTo.split('-');
            upHtml += '<span>利用期間: ' + parseInt(pfp[1], 10) + '/' + parseInt(pfp[2], 10) + '〜' + parseInt(ptp[1], 10) + '/' + parseInt(ptp[2], 10) + '</span>';
          }
          upHtml += '</div>';

          upHtml += '</div>';
        });
        upcomingCards.innerHTML = upHtml;
        upcomingContainer.style.display = "block";
      } else {
        upcomingContainer.style.display = "none";
      }
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

    // 人数セレクター初期化
    updateFamilyTotal();
    var peopleSelect = document.getElementById("people-count");
    if (peopleSelect) {
      peopleSelect.removeEventListener("change", updateFamilyTotal);
      peopleSelect.addEventListener("change", updateFamilyTotal);
    }

    // 診断結果をGASに保存
    saveDiagnosisResult(result);
  }

  // === 結果カードHTML生成 ===
  function buildResultCard(item, isMain) {
    var p = item.pass;
    var price = item.price;
    var cardClass = isMain ? "result-card" : "sub-result-card";

    // 予測パス判定（カードクラスに反映するため先に判定）
    var hasDailyPrice = price && price > 0;
    var hasLawsonCoverage = p.lawson && p.lawson.performanceFrom && (function () {
      var upper = p.lawson.salesTo || p.lawson.performanceTo;
      return upper && selectedDate >= p.lawson.performanceFrom && selectedDate <= upper;
    })();
    var isPredicted = !hasDailyPrice && !hasLawsonCoverage && isRegularPass(p);

    if (isPredicted) {
      cardClass += " result-card--predicted";
    }

    var html = '<div class="' + cardClass + '"';
    if (isMain) {
      html += ' style="border-color:' + p.borderColor + '; background:' + p.colorBg + '"';
    }
    html += '>';

    html += '<div class="result-card-badge" style="background:' + p.color + '">' + p.shortName + '</div>';
    html += '<h3 class="result-card-name">' + p.name + '</h3>';

    if (hasDailyPrice) {
      html += '<p class="result-card-price" data-unit-price="' + price + '" style="color:' + p.color + '">¥' + price.toLocaleString() + '<span class="price-per-person">/人</span></p>';
      html += '<p class="family-total-price" style="color:' + p.color + '"></p>';
    } else if (p.lawson && p.lawson.minPrice) {
      html += '<p class="result-card-price" data-unit-price="' + p.lawson.minPrice + '" data-price-approx="true" style="color:' + p.color + '">¥' + p.lawson.minPrice.toLocaleString() + '~<span class="price-per-person">/人</span></p>';
      html += '<p class="family-total-price" style="color:' + p.color + '"></p>';
      html += '<p class="price-annotation">※日別価格は販売開始後に確定します</p>';
    } else if (isPredicted && p.historicalMinPrice) {
      html += '<p class="result-card-price price-predicted" data-unit-price="' + p.historicalMinPrice + '" data-price-approx="true" style="color:' + p.color + '">¥' + p.historicalMinPrice.toLocaleString() + '~<span class="price-per-person">/人</span></p>';
      html += '<p class="family-total-price" style="color:' + p.color + '"></p>';
      html += '<p class="price-annotation">※過去の販売実績に基づく参考価格です</p>';
    } else if (p.historicalMinPrice) {
      html += '<p class="result-card-price" data-unit-price="' + p.historicalMinPrice + '" data-price-approx="true" style="color:' + p.color + '">¥' + p.historicalMinPrice.toLocaleString() + '~<span class="price-per-person">/人</span></p>';
      html += '<p class="family-total-price" style="color:' + p.color + '"></p>';
      html += '<p class="price-annotation">※直近の最低価格です。日によって変動します</p>';
    } else {
      html += '<p class="result-card-price price-undecided">価格未定</p>';
      html += '<p class="price-annotation">※価格は販売開始後に確定します</p>';
    }

    html += buildSalesBadge(p, hasDailyPrice, isPredicted);
    html += '<p class="result-card-desc">' + p.description + '</p>';

    // 付き添い注記（身長に応じて動的生成）
    var companionNotes = [];
    var allFixed = p.attractions ? (p.attractions.fixed || []) : [];
    for (var ci = 0; ci < allFixed.length; ci++) {
      var aName = allFixed[ci];
      var hInfo = ATTRACTION_COMPANION_HEIGHTS[aName];
      if (!hInfo) continue;
      var shortAName = aName.replace(/〜.*?〜/g, "").replace(/・ザ・リアル.*$/, "").replace(/・ザ・ライド$/, "");
      if (selectedHeight < hInfo.companion) {
        companionNotes.push(shortAName + "は身長" + hInfo.companion + "cm以上必要");
      } else if (selectedHeight < hInfo.solo && hInfo.companion < hInfo.solo) {
        companionNotes.push(shortAName + "は付き添いが必要");
      }
    }
    if (companionNotes.length > 0) {
      html += '<div class="companion-note">※' + companionNotes.join('<br>※') + '</div>';
    }

    if (isMain) {
      html += buildAttractionsSection(p);
      html += buildAreaSection(p);
      html += buildAdviceSection(p);
    } else {
      html += buildSimpleAttractions(p);
    }

    html += '</div>';
    return html;
  }

  // === 販売状況バッジ ===
  function buildSalesBadge(pass, hasDailyPrice, isPredicted) {
    var html = '';

    // ローチケデータがある場合はそちらを優先
    if (pass.lawson && pass.lawson.salesStatus) {
      var status = pass.lawson.salesStatus;
      if (status === "販売中") {
        // 日別価格がない（5月以降等）→ 販売予定として表示
        if (!hasDailyPrice) {
          html += '<span class="sales-badge sales-badge--upcoming">随時販売予定</span>';
        } else if (pass.lawson.salesTo) {
          var tp = pass.lawson.salesTo.split('-');
          var tMonth = parseInt(tp[1], 10);
          var tDay = parseInt(tp[2], 10);
          html += '<span class="sales-badge sales-badge--active">ローチケで' + tMonth + '月' + tDay + '日まで販売</span>';
        } else {
          html += '<span class="sales-badge sales-badge--active">ローチケで販売中</span>';
        }
      } else if (status === "販売予定") {
        if (pass.lawson.salesFrom) {
          var fp = pass.lawson.salesFrom.split('-');
          var fMonth = parseInt(fp[1], 10);
          var fDay = parseInt(fp[2], 10);
          html += '<span class="sales-badge sales-badge--upcoming">' + fMonth + '月' + fDay + '日〜販売開始予定</span>';
        } else {
          html += '<span class="sales-badge sales-badge--upcoming">販売予定</span>';
        }
      } else if (status === "受付終了") {
        html += '<span class="sales-badge sales-badge--ended">受付終了</span>';
      }
      return html;
    }

    // ローチケデータなし → 既存ロジック（価格データの最終日を表示）
    if (!pass.pricing) {
      if (isPredicted) {
        return '<span class="sales-badge sales-badge--predicted">販売見込み</span>';
      }
      return '';
    }
    var dates = Object.keys(pass.pricing).sort();
    if (dates.length === 0) {
      if (isPredicted) {
        return '<span class="sales-badge sales-badge--predicted">販売見込み</span>';
      }
      return '';
    }
    var lastDate = dates[dates.length - 1];
    var parts = lastDate.split('-');
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);

    // 選択日が価格データ範囲外 → 予測パスなら「販売見込み」
    if (isPredicted && selectedDate > lastDate) {
      return '<span class="sales-badge sales-badge--predicted">販売見込み</span>';
    }

    return '<span class="sales-badge sales-badge--active">' + month + '月' + day + '日まで販売</span>';
  }

  // === アトラクションが時間指定かどうか ===
  function isTimeDesignated(pass, attractionName) {
    if (!pass.timeDesignated || pass.timeDesignated.length === 0) return false;
    return pass.timeDesignated.some(function (td) {
      return attractionName === td;
    });
  }

  // === アトラクションタグHTML生成 ===
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

    if (pass.timeDesignated && pass.timeDesignated.length > 0) {
      html += '<div class="td-legend">';
      html += '<span class="td-legend-item"><span class="td-icon">🕐</span> = 体験時間が指定されます</span>';
      html += '</div>';
    } else if (pass.type === "premium" || pass.type === "ep7") {
      html += '<div class="td-legend td-legend-free">';
      html += '<span class="td-legend-item">全アトラクション時間指定なし（いつでも利用可能）</span>';
      html += '</div>';
    }

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

    if (pass.attractions.selectable1.length > 0) {
      html += '<p class="selectable-label">△1 以下から1つ選べます</p>';
      html += '<ul class="attractions-list">';
      pass.attractions.selectable1.forEach(function (name) {
        html += buildAttractionTag(pass, name);
      });
      html += '</ul>';
    }

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
      jaws: ["ジョーズ"],
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

  // === 家族人数セレクター：合計金額更新 ===
  function updateFamilyTotal() {
    var count = parseInt(document.getElementById("people-count").value, 10) || 1;
    // /人 表示切替
    var perPersonEls = document.querySelectorAll(".price-per-person");
    for (var i = 0; i < perPersonEls.length; i++) {
      perPersonEls[i].style.display = count <= 1 ? "none" : "inline";
    }
    // 合計行更新
    var totalEls = document.querySelectorAll(".family-total-price");
    for (var j = 0; j < totalEls.length; j++) {
      var el = totalEls[j];
      var priceEl = el.previousElementSibling;
      while (priceEl && !priceEl.getAttribute("data-unit-price")) {
        priceEl = priceEl.previousElementSibling;
      }
      if (!priceEl) { el.style.display = "none"; continue; }
      var unitPrice = parseInt(priceEl.getAttribute("data-unit-price"), 10);
      if (!unitPrice || count <= 1) { el.style.display = "none"; continue; }
      var total = unitPrice * count;
      var approx = priceEl.getAttribute("data-price-approx") === "true";
      el.textContent = count + "人分合計: ¥" + total.toLocaleString() + (approx ? "~" : "");
      el.style.display = "block";
    }
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
    var expiry = new Date(2027, 3, 1);
    return now >= expiry;
  }

  // ============================================================
  //  パスデータをAPI取得（キャッシュ優先 + フォールバック付き）
  // ============================================================
  var PASS_CACHE_KEY = "ep_pass_cache_v6";
  var PASS_CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6時間

  function loadPassData(callback) {
    // フォールバック適用
    function applyFallback() {
      if (!PASS_DATA_LOADED && typeof FALLBACK_PASSES !== "undefined" && FALLBACK_PASSES.length > 0) {
        PASSES = FALLBACK_PASSES;
        ATTRACTION_TAGS = FALLBACK_ATTRACTION_TAGS;
        PASS_DATA_LOADED = true;
        console.log("パスデータ: フォールバック使用 (" + PASSES.length + "件)");
      }
      callback();
    }

    // キャッシュから即座に読み込み
    var cacheUsed = false;
    try {
      var cached = localStorage.getItem(PASS_CACHE_KEY);
      if (cached) {
        var cacheData = JSON.parse(cached);
        if (cacheData.passes && cacheData.passes.length > 0 &&
            Date.now() - cacheData.cachedAt < PASS_CACHE_MAX_AGE) {
          PASSES = cacheData.passes;
          ATTRACTION_TAGS = cacheData.attractionTags;
          UPCOMING_PASSES = cacheData.upcoming || [];
          PASS_DATA_LOADED = true;
          priceRangeData = cacheData.priceRange;
          updateLastUpdatedLabels(cacheData.lastUpdated, cacheData.priceRange);
          console.log("パスデータ: キャッシュ使用 (" + PASSES.length + "件)");
          cacheUsed = true;
          callback(); // 即座にコールバック
        }
      }
    } catch (e) { /* キャッシュ読み込み失敗は無視 */ }

    // APIからバックグラウンドで取得（キャッシュ更新 or 初回取得）
    fetch(GAS_URL + "?action=getPassData")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error || !data.passes || data.passes.length === 0) {
          console.warn("API応答エラー:", data.error || "パスデータなし");
          if (!cacheUsed) applyFallback();
          return;
        }
        PASSES = data.passes;
        ATTRACTION_TAGS = data.attractionTags;
        UPCOMING_PASSES = data.upcoming || [];
        PASS_DATA_LOADED = true;
        priceRangeData = data.priceRange;
        console.log("パスデータ: API取得成功 (" + PASSES.length + "件, 予告" + UPCOMING_PASSES.length + "件)");
        updateLastUpdatedLabels(data.lastUpdated, data.priceRange);

        // キャッシュ保存
        try {
          localStorage.setItem(PASS_CACHE_KEY, JSON.stringify({
            passes: data.passes,
            upcoming: data.upcoming || [],
            attractionTags: data.attractionTags,
            lastUpdated: data.lastUpdated,
            priceRange: data.priceRange,
            cachedAt: Date.now()
          }));
        } catch (e) { /* localStorage容量不足は無視 */ }

        if (!cacheUsed) callback();
      })
      .catch(function (err) {
        console.warn("パスデータAPI取得失敗:", err);
        if (!cacheUsed) applyFallback();
      });
  }

  /**
   * 最終データ更新日と価格データ期間を画面に反映
   */
  function updateLastUpdatedLabels(lastUpdated, priceRange) {
    var els = document.querySelectorAll("[data-auto-update]");
    if (!els.length) return;

    var parts = [];
    if (lastUpdated) {
      var d = lastUpdated.split("-");
      parts.push("最終データ更新: " + Number(d[1]) + "月" + Number(d[2]) + "日");
    }
    if (priceRange && priceRange.to) {
      var t = priceRange.to.split("-");
      parts.push("対応期間: " + Number(t[1]) + "月" + Number(t[2]) + "日まで");
    }

    var text = parts.join(" / ");
    els.forEach(function (el) { el.textContent = text; });
  }

  // ============================================================
  //  初期化
  // ============================================================
  function init() {
    initPrivacyModal();

    // パスデータとLIFFを並列で初期化（GASコールドスタートの待ち時間を短縮）
    loadPassData(function () {
      // パスデータ読み込み完了（バックグラウンド）
    });
    initLiff(); // LIFFは即座に開始（パスデータを待たない）

    // スタートボタン
    document.getElementById("start-btn").addEventListener("click", function () {
      if (!PASS_DATA_LOADED) {
        // パスデータ未取得 → ローディング表示して待機
        var btn = this;
        btn.disabled = true;
        btn.textContent = "データ読み込み中...";
        var checkInterval = setInterval(function () {
          if (PASS_DATA_LOADED) {
            clearInterval(checkInterval);
            btn.disabled = false;
            btn.textContent = "診断スタート";
            resetAll();
            showScreen("screen-date");
            renderCalendar(3);
            renderHeightChoices();
            renderAttractionChoices();
            renderBudgetChoices();
          }
        }, 200);
        return;
      }
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

    // 戻るボタン
    document.getElementById("back-to-top").addEventListener("click", function () {
      showTopScreen();
    });
    document.getElementById("back-to-date").addEventListener("click", function () {
      showScreen("screen-date");
    });
    document.getElementById("back-to-height").addEventListener("click", function () {
      showScreen("screen-height");
    });
    document.getElementById("back-to-attractions").addEventListener("click", function () {
      showScreen("screen-attractions");
    });

    // アトラクション「次へ」ボタン
    document.getElementById("attraction-next-btn").addEventListener("click", function () {
      if (selectedTags.length === 0) {
        selectedTags = ["any"];
      }
      showScreen("screen-budget");
    });

    // エクスプレス・パス診断に戻る
    document.getElementById("retry-btn").addEventListener("click", function () {
      resetAll();
      showScreen("screen-date");
      renderCalendar(3);
      renderHeightChoices();
      renderAttractionChoices();
      renderBudgetChoices();
    });


    // 履歴ボタン
    document.getElementById("history-btn").addEventListener("click", function () {
      showHistory();
    });

    // 履歴→トップに戻る
    document.getElementById("history-back-btn").addEventListener("click", function () {
      showTopScreen();
    });
  }

  // ============================================================
  //  アンケート
  // ============================================================
  var surveyInitialized = false;

  function initSurvey() {
    if (surveyInitialized) return;
    surveyInitialized = true;

    var surveySection = document.getElementById("survey-section");
    var submitBtn = document.getElementById("survey-submit-btn");
    var thanksMsg = document.getElementById("survey-thanks");
    var q3Textarea = document.getElementById("survey-q3");

    var q1Answer = null;
    var q2Answers = [];

    // Q1: 単一選択（イベント委譲）
    document.getElementById("survey-q1").addEventListener("click", function (e) {
      var btn = e.target.closest(".survey-option");
      if (!btn) return;
      this.querySelectorAll(".survey-option").forEach(function (b) {
        b.classList.remove("selected");
      });
      btn.classList.add("selected");
      q1Answer = btn.getAttribute("data-value");
      submitBtn.disabled = false;
    });

    // Q2: 複数選択（イベント委譲）
    document.getElementById("survey-q2").addEventListener("click", function (e) {
      var btn = e.target.closest(".survey-option");
      if (!btn) return;
      btn.classList.toggle("selected");
      var val = btn.getAttribute("data-value");
      var idx = q2Answers.indexOf(val);
      if (idx === -1) {
        q2Answers.push(val);
      } else {
        q2Answers.splice(idx, 1);
      }
    });

    // 送信
    submitBtn.addEventListener("click", function () {
      if (!q1Answer) return;

      var surveyData = {
        uid: lineUid,
        q1: q1Answer,
        q2: q2Answers.join(","),
        q3: q3Textarea.value.trim(),
        submittedAt: new Date().toISOString()
      };

      // ローカル保存
      var surveyKey = "ep_survey_" + lineUid;
      var surveys = JSON.parse(localStorage.getItem(surveyKey) || "[]");
      surveys.push(surveyData);
      localStorage.setItem(surveyKey, JSON.stringify(surveys));

      // GASに送信
      if (GAS_URL) {
        fetch(GAS_URL, {
          method: "POST",
          body: JSON.stringify({ action: "saveSurvey", data: surveyData })
        }).catch(function (err) {
          console.error("GAS survey error:", err);
        });
      }

      // UI更新
      surveySection.classList.add("submitted");
      thanksMsg.classList.remove("hidden");
    });
  }

  init();
  initSurvey();
})();
