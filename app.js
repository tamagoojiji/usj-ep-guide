(function () {
  "use strict";

  // 状態管理
  var currentQuestionIndex = 0;
  var answers = []; // 各質問の回答（シングル: choiceオブジェクト, マルチ: choiceオブジェクト配列）
  var multiSelected = []; // Q4用の選択中インデックス
  var isTransitioning = false; // シングル選択の自動遷移中フラグ

  // DOM要素
  var screens = {
    top: document.getElementById("top-screen"),
    quiz: document.getElementById("quiz-screen"),
    result: document.getElementById("result-screen")
  };

  // === 画面遷移 ===
  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.add("hidden");
    });
    screens[name].classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  // === プログレスバー更新 ===
  function updateProgress() {
    var num = currentQuestionIndex + 1;
    var total = QUESTIONS.length;
    document.getElementById("question-number").textContent = num;
    document.getElementById("total-questions").textContent = total;
    document.getElementById("progress-fill").style.width = (num / total * 100) + "%";
  }

  // === カード要素を生成 ===
  function createCard(choice, index, isMulti) {
    var card = document.createElement("button");
    card.className = "card-choice";
    card.setAttribute("type", "button");

    card.innerHTML =
      '<span class="card-emoji">' + choice.emoji + '</span>' +
      '<div class="card-text">' +
        '<div class="card-title">' + choice.title + '</div>' +
        '<div class="card-sub">' + choice.sub + '</div>' +
      '</div>' +
      '<div class="card-check"><span class="card-check-icon">&#10003;</span></div>';

    if (isMulti) {
      card.addEventListener("click", function () {
        handleMultiSelect(index, card);
      });
    } else {
      card.addEventListener("click", function () {
        handleSingleSelect(index, card);
      });
    }

    return card;
  }

  // === 質問を描画 ===
  function renderQuestion() {
    var q = QUESTIONS[currentQuestionIndex];
    var isMulti = q.type === "multi";

    updateProgress();

    // 質問文
    document.getElementById("question-text").textContent = q.question;

    // 補足テキスト
    var noteEl = document.getElementById("question-note");
    if (q.note) {
      noteEl.textContent = q.note;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }

    // 選択肢を描画
    var container = document.getElementById("choices-container");
    container.innerHTML = "";

    multiSelected = [];

    q.choices.forEach(function (choice, i) {
      var card = createCard(choice, i, isMulti);
      container.appendChild(card);
    });

    // 次へボタン（マルチ選択時のみ表示）
    var nextBtn = document.getElementById("next-btn");
    if (isMulti) {
      nextBtn.classList.remove("hidden");
      nextBtn.disabled = false;
    } else {
      nextBtn.classList.add("hidden");
    }

    // フェードインアニメーション
    var quizBody = document.querySelector(".quiz-body");
    quizBody.classList.remove("fade-in");
    void quizBody.offsetWidth; // reflow
    quizBody.classList.add("fade-in");
  }

  // === シングル選択 ===
  function handleSingleSelect(index, cardEl) {
    if (isTransitioning) return; // 遷移中は無視

    var q = QUESTIONS[currentQuestionIndex];

    // 全カードの選択状態をリセット
    var cards = document.querySelectorAll(".card-choice");
    cards.forEach(function (c) { c.classList.remove("selected"); });

    // 選択状態をセット
    cardEl.classList.add("selected");
    cardEl.classList.add("just-selected");

    // 回答を記録
    answers[currentQuestionIndex] = q.choices[index];

    // 0.4秒後に自動遷移
    isTransitioning = true;
    setTimeout(function () {
      isTransitioning = false;
      goToNext();
    }, 400);
  }

  // === 複数選択 ===
  function handleMultiSelect(index, cardEl) {
    var pos = multiSelected.indexOf(index);
    if (pos === -1) {
      multiSelected.push(index);
      cardEl.classList.add("selected");
      cardEl.classList.add("just-selected");
    } else {
      multiSelected.splice(pos, 1);
      cardEl.classList.remove("selected");
    }
  }

  // === 次の質問へ ===
  function goToNext() {
    var q = QUESTIONS[currentQuestionIndex];

    // マルチ選択の回答を記録
    if (q.type === "multi") {
      var selectedChoices = multiSelected.map(function (i) { return q.choices[i]; });
      answers[currentQuestionIndex] = selectedChoices;
    }

    currentQuestionIndex++;

    if (currentQuestionIndex >= QUESTIONS.length) {
      showResult();
    } else {
      renderQuestion();
    }
  }

  // === 結果画面を表示 ===
  function showResult() {
    var result = calculateResult(answers);
    var r = result.result;
    var selectedAttractions = result.selectedAttractions;

    showScreen("result");

    // カードの色
    var card = document.getElementById("result-card");
    card.style.borderColor = r.borderColor;
    card.style.background = r.colorBg;

    // バッジ
    var badge = document.getElementById("result-badge");
    badge.textContent = r.shortName;
    badge.style.background = r.color;

    // パス名・価格・説明
    document.getElementById("result-name").textContent = r.name;
    var priceEl = document.getElementById("result-price");
    priceEl.textContent = r.price;
    priceEl.style.color = r.color;
    document.getElementById("result-desc").textContent = r.description;

    // アトラクションリスト
    var listEl = document.getElementById("attractions-list");
    listEl.innerHTML = "";
    var attractionsSection = document.getElementById("attractions-section");

    if (r.attractions.length > 0) {
      attractionsSection.classList.remove("hidden");
      // ユーザーが選んだアトラクション名のセット
      var selectedNames = selectedAttractions.map(function (c) { return c.title; });

      r.attractions.forEach(function (name) {
        var li = document.createElement("li");
        var isMatched = selectedNames.some(function (sn) { return name.indexOf(sn) !== -1; });
        li.className = "attraction-tag" + (isMatched ? " matched" : "");
        li.textContent = name;
        listEl.appendChild(li);
      });
    } else {
      attractionsSection.classList.add("hidden");
    }

    // エリア入場確約
    document.getElementById("area-text").textContent = r.areaEntryText;

    // アドバイス
    document.getElementById("advice-text").textContent = r.advice;
  }

  // === 初期化 ===
  function init() {
    // スタートボタン
    document.getElementById("start-btn").addEventListener("click", function () {
      currentQuestionIndex = 0;
      answers = [];
      multiSelected = [];
      showScreen("quiz");
      renderQuestion();
    });

    // 次へボタン（Q4用）
    document.getElementById("next-btn").addEventListener("click", function () {
      goToNext();
    });

    // もう一度やる
    document.getElementById("retry-btn").addEventListener("click", function () {
      currentQuestionIndex = 0;
      answers = [];
      multiSelected = [];
      showScreen("quiz");
      renderQuestion();
    });
  }

  init();
})();
