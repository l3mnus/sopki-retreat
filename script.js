/* ==========================================================================
   Sopki Retreat — script.js

   Что появится здесь отдельными задачами:
   - мобильное меню (.nav-toggle / aria-expanded);
   - демо-календарь бронирования: статичный массив занятых дат,
     отрисовка сетки дней, выбор диапазона, подсчёт ночей
     (реальной отправки заявки нет — см. CLAUDE.md);
   - подсветка активного пункта навигации при скролле;
   - анимации появления секций.
   ========================================================================== */

'use strict';


/* --------------------------------------------------------------------------
   Виджет вероятности сияния

   Источник: NOAA SWPC, планетарный Kp-индекс. Эндпоинт отдаёт
   Access-Control-Allow-Origin: *, поэтому запрос из браузера проходит
   без прокси. Ответ — массив записей с шагом 3 часа, берём последнюю.

   Пороги вероятности: 0–2 низкая, 3–4 средняя, 5+ высокая.
   Любая ошибка (сеть, CORS, пустой или неожиданный ответ) показывается
   в самом виджете, а не в консоли.
   -------------------------------------------------------------------------- */

(function initAuroraWidget() {
  var ENDPOINT = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

  var widget = document.querySelector('[data-aurora]');
  if (!widget) return;

  var stateEl = widget.querySelector('[data-aurora-state]');
  var resultEl = widget.querySelector('[data-aurora-result]');
  var kpEl = widget.querySelector('[data-aurora-kp]');
  var labelEl = widget.querySelector('[data-aurora-label]');
  if (!stateEl || !resultEl || !kpEl || !labelEl) return;

  function showUnavailable() {
    stateEl.textContent = 'Прогноз временно недоступен';
    stateEl.hidden = false;
    resultEl.hidden = true;
  }

  function probabilityLabel(kp) {
    if (kp >= 5) return 'высокая вероятность';
    if (kp >= 3) return 'средняя вероятность';
    return 'низкая вероятность';
  }

  // NOAA у разных продуктов отдаёт то массив объектов, то массив массивов
  // с шапкой в первой строке — разбираем оба варианта.
  function extractLatestKp(data) {
    if (!Array.isArray(data) || data.length === 0) return null;

    var last = data[data.length - 1];
    var raw;

    if (Array.isArray(last)) {
      var header = data[0];
      var index = Array.isArray(header) ? header.indexOf('Kp') : -1;
      raw = last[index === -1 ? 1 : index];
    } else if (last && typeof last === 'object') {
      raw = last.Kp !== undefined ? last.Kp : last.kp_index;
    }

    var kp = parseFloat(raw);
    return isFinite(kp) ? kp : null;
  }

  fetch(ENDPOINT, { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      var kp = extractLatestKp(data);
      if (kp === null) throw new Error('Не удалось разобрать ответ');

      kpEl.textContent = 'Kp ' + kp.toFixed(1);
      labelEl.textContent = probabilityLabel(kp);
      stateEl.hidden = true;
      resultEl.hidden = false;
    })
    .catch(showUnavailable);
})();
