/*
 * quiz.js — 极简 vanilla 小测组件（可复用，无依赖）
 *
 * 接口约定（后续课程直接复用）：
 *   1. 课程页引本脚本：<script src="../assets/quiz.js"></script>
 *   2. 页面留一个空容器：<div class="quiz" data-quiz></div>
 *   3. 调用 window.renderQuiz(container, questions) 渲染一组题：
 *        renderQuiz(document.querySelector('[data-quiz]'), [q1, q2, ...]);
 *      题对象结构：
 *        {
 *          prompt: '题干（字符串）',
 *          options: ['选项一', '选项二', ...],   // 长度尽量一致，不给格式线索
 *          answer: 2,                            // 正确选项的下标（0 起）
 *          explain: '答错时的一句话点拨'          // 答对也可展示同一句巩固
 *        }
 *      渲染前组件会对 options 做 Fisher–Yates 洗牌，并同步重映射 answer 下标——
 *      题目作者按原文顺序编写即可，正确答案的固定位置不构成格式线索。
 *   4. 一个容器渲染一题；多道题就放多个容器、逐个调用。
 *   5. 样式类名依赖 assets/lesson.css 的 .quiz / .quiz__opt /
 *      .is-correct / .is-wrong / .quiz__feedback。
 *   6. 点选即时判分并锁定该题，不提供重做（想再来一次刷新页面即可）。
 */
(function () {
  'use strict';

  function renderQuiz(container, question) {
    if (!container || !question || !Array.isArray(question.options)) return;

    // Fisher–Yates 洗牌：order[i] 为第 i 个展示位对应的原始下标
    var order = question.options.map(function (_, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }
    var answer = order.indexOf(question.answer);

    var frag = document.createDocumentFragment();
    var prompt = document.createElement('p');
    prompt.className = 'quiz__prompt';
    prompt.textContent = question.prompt;
    frag.appendChild(prompt);

    var opts = document.createElement('div');
    opts.className = 'quiz__opts';

    var buttons = [];
    order.forEach(function (src, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz__opt';
      btn.textContent = question.options[src];
      btn.addEventListener('click', function () { settle(i); });
      buttons.push(btn);
      opts.appendChild(btn);
    });
    frag.appendChild(opts);

    var feedback = document.createElement('p');
    feedback.className = 'quiz__feedback';
    frag.appendChild(feedback);

    container.appendChild(frag);

    function settle(chosen) {
      var correct = chosen === answer;
      buttons.forEach(function (btn, i) {
        btn.disabled = true;
        if (i === answer) btn.classList.add('is-correct');
        else if (i === chosen) btn.classList.add('is-wrong');
      });
      feedback.textContent =
        (correct ? '答对了。' : '差一点。') + (question.explain || '');
      feedback.classList.add('is-visible', correct ? 'is-correct' : 'is-wrong');
    }
  }

  window.renderQuiz = renderQuiz;
})();
