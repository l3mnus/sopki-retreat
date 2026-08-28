/* ==========================================================================
   Sopki Retreat — script.js

   Что появится здесь отдельными задачами:
   - мобильное меню (.nav-toggle / aria-expanded);
   - подсветка активного пункта навигации при скролле;
   - анимации появления секций.
   ========================================================================== */

'use strict';


/* Скорость фонового видео на первом экране: 1 — как снято, меньше — медленнее.
   Значение подбирается на глаз, менять здесь. */
var HERO_PLAYBACK_RATE = 0.6;


/* --------------------------------------------------------------------------
   Фоновое видео первого экрана

   Автозапуск обеспечивают атрибуты muted, playsinline, loop и autoplay
   в разметке — без JavaScript видео тоже играет. Скрипт только замедляет
   воспроизведение и выключает его тем, кто просил меньше движения:
   у видео снимается источник, и браузер показывает постер.
   -------------------------------------------------------------------------- */

(function initHeroVideo() {
  var video = document.querySelector('[data-hero-video]');
  if (!video) return;

  var query = window.matchMedia('(prefers-reduced-motion: reduce)');

  function showPosterOnly() {
    video.pause();
    video.removeAttribute('autoplay');
    video.removeAttribute('src');
    video.load();
  }

  // Часть браузеров сбрасывает скорость при загрузке источника, поэтому
  // выставляем её и на события, а не только один раз
  function applyRate() {
    try {
      video.playbackRate = HERO_PLAYBACK_RATE;
    } catch (error) {
      /* старый браузер не даёт менять скорость — не страшно */
    }
  }

  if (query.matches) {
    showPosterOnly();
    return;
  }

  applyRate();
  video.addEventListener('loadedmetadata', applyRate);
  video.addEventListener('play', applyRate);
})();


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


/* --------------------------------------------------------------------------
   Модальное окно — переиспользуемый компонент

   Разметка: <div class="modal" id="<id>" data-modal hidden> с потомками
   [data-modal-backdrop] и .modal__dialog[role="dialog"][aria-modal="true"].
   Открывает любая кнопка с data-modal-open="<id>", закрывает — кнопка
   с data-modal-close, клик по подложке и Escape.

   Фокус запирается внутри окна, после закрытия возвращается на кнопку,
   которая его открыла. Прокрутка страницы блокируется на время показа.

   Этим же механизмом позже откроем просмотр фото номеров и услуг:
   достаточно добавить разметку окна и кнопку с data-modal-open.
   -------------------------------------------------------------------------- */

var modals = (function () {
  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  var openModal = null;   // сейчас открытое окно
  var lastTrigger = null; // кнопка, с которой его открыли

  // Скрытые элементы в ловушку фокуса не берём
  function focusableIn(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll(FOCUSABLE),
      function (el) {
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
      }
    );
  }

  function open(id, trigger) {
    var modal = document.getElementById(id);
    if (!modal || !modal.hasAttribute('data-modal') || openModal) return;

    openModal = modal;
    lastTrigger = trigger || null;

    modal.hidden = false;
    document.body.classList.add('has-modal-open');

    // Фокус — на кнопку закрытия, иначе на само окно
    var dialog = modal.querySelector('.modal__dialog') || modal;
    var first = modal.querySelector('[data-modal-close]') || focusableIn(dialog)[0];

    if (first) {
      first.focus();
    } else {
      dialog.setAttribute('tabindex', '-1');
      dialog.focus();
    }
  }

  function close() {
    if (!openModal) return;

    openModal.hidden = true;
    document.body.classList.remove('has-modal-open');
    openModal = null;

    // Возвращаем фокус туда, откуда пришли
    if (lastTrigger && document.contains(lastTrigger)) {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  // Ловушка фокуса: Tab по кругу внутри окна
  function trapFocus(event) {
    var dialog = openModal.querySelector('.modal__dialog') || openModal;
    var items = focusableIn(dialog);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }

    var first = items[0];
    var last = items[items.length - 1];
    var current = document.activeElement;

    if (event.shiftKey && (current === first || !dialog.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !dialog.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-modal-open]');
    if (trigger) {
      event.preventDefault();
      open(trigger.getAttribute('data-modal-open'), trigger);
      return;
    }

    if (event.target.closest('[data-modal-close]') || event.target.closest('[data-modal-backdrop]')) {
      close();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (!openModal) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      trapFocus(event);
    }
  });

  return { open: open, close: close };
})();


/* --------------------------------------------------------------------------
   Справочник домиков — общий для календаря и формы заявки.
   base — цена за домик за ночь до надбавок, capacity — сколько гостей
   размещается. Цена от числа гостей не зависит.
   -------------------------------------------------------------------------- */

var CABINS = {
  'aurora-cabin': { name: 'Сияние', base: 24000, capacity: 4 },
  'fjeld-suite': { name: 'Панорама', base: 19000, capacity: 4 },
  'ember-room': { name: 'Очаг', base: 14000, capacity: 2 }
};


/* --------------------------------------------------------------------------
   Демо-календарь бронирования

   Настоящей брони здесь нет: занятость — статичные массивы ниже, заявка
   никуда не уходит (см. CLAUDE.md). Считаем ночи, а не дни: заезд 10-го,
   выезд 12-го — это две ночи, 10-я и 11-я.
   -------------------------------------------------------------------------- */

(function initBookingCalendar() {
  var root = document.querySelector('[data-calendar]');
  if (!root) return;

  /* --- Данные --- */

  // Занятые периоды заданы смещением от сегодняшнего дня, а не абсолютной датой:
  // [через сколько дней начинается, сколько ночей длится]. Сами даты считаются
  // при загрузке, поэтому портфолио выглядит живым и через год.
  var BOOKED_OFFSETS = {
    'aurora-cabin': [[2, 3], [10, 3], [23, 4], [38, 2], [50, 4], [66, 3], [81, 3]],
    'fjeld-suite': [[6, 3], [17, 3], [31, 2], [44, 4], [59, 3], [79, 3]],
    'ember-room': [[1, 2], [14, 3], [28, 3], [40, 4], [65, 2], [83, 3]]
  };

  var MONTHS_NOMINATIVE = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  var MONTHS_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  /* --- Элементы --- */

  var gridEl = root.querySelector('[data-calendar-grid]');
  var monthEl = root.querySelector('[data-calendar-month]');
  var prevBtn = root.querySelector('[data-calendar-prev]');
  var nextBtn = root.querySelector('[data-calendar-next]');
  var messageEl = root.querySelector('[data-calendar-message]');
  var cabinSelect = root.querySelector('[data-calendar-cabin]');

  var checkinEl = document.querySelector('[data-booking-checkin]');
  var checkoutEl = document.querySelector('[data-booking-checkout]');
  var nightsEl = document.querySelector('[data-booking-nights]');
  var cabinEl = document.querySelector('[data-booking-cabin]');
  var totalEl = document.querySelector('[data-booking-total]');
  var hintEl = document.querySelector('[data-booking-hint]');

  // Тот же тип домика выбирается и в форме заявки — держим оба поля в согласии
  var formCabin = document.getElementById('booking-cabin');

  if (!gridEl || !monthEl || !cabinSelect) return;

  /* --- Работа с датами --- */

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function toKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function fromKey(key) {
    var parts = key.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(date, count) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function isSameDay(a, b) {
    return Boolean(a) && Boolean(b) && toKey(a) === toKey(b);
  }

  // Число дней в месяце: нулевой день следующего месяца — последний день текущего,
  // поэтому високосный февраль считается сам собой
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // Понедельник — первый столбец
  function weekdayOffset(year, month) {
    return (new Date(year, month, 1).getDay() + 6) % 7;
  }

  /* --- Занятость --- */

  var today = startOfDay(new Date());

  // Разворачиваем смещения в плоский набор ключей дат: и считается один раз,
  // и проверять принадлежность потом быстрее
  var bookedKeys = {};
  Object.keys(BOOKED_OFFSETS).forEach(function (cabinId) {
    var keys = {};
    BOOKED_OFFSETS[cabinId].forEach(function (period) {
      var start = addDays(today, period[0]);
      for (var night = 0; night < period[1]; night++) {
        keys[toKey(addDays(start, night))] = true;
      }
    });
    bookedKeys[cabinId] = keys;
  });

  function isBooked(cabinId, date) {
    return bookedKeys[cabinId][toKey(date)] === true;
  }

  /* --- Цены ---
     Базовая цена домика умножается на надбавки, надбавки перемножаются:
     пятница и суббота +20%, сентябрь–март +25% (высокий сезон сияния). */

  function priceFor(cabinId, date) {
    var price = CABINS[cabinId].base;
    var weekday = date.getDay();
    var month = date.getMonth();

    if (weekday === 5 || weekday === 6) {
      price *= 1.2;
    }

    if (month >= 8 || month <= 2) {
      price *= 1.25;
    }

    return Math.round(price);
  }

  function groupDigits(value, separator) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  }

  // В панели итога и в подсказках — полный формат
  function formatMoney(value) {
    return groupDigits(value, ' ') + ' ₽';
  }

  // В ячейке дня места мало: тонкий пробел вместо обычного, знак рубля не влезает
  function formatCellPrice(value) {
    return groupDigits(value, ' ');
  }

  function formatDate(date) {
    return date.getDate() + ' ' + MONTHS_GENITIVE[date.getMonth()];
  }

  function formatDateWithYear(date) {
    return formatDate(date) + ' ' + date.getFullYear();
  }

  function nightsWord(count) {
    var tail = count % 10;
    var hundred = count % 100;

    if (tail === 1 && hundred !== 11) return 'ночь';
    if (tail >= 2 && tail <= 4 && (hundred < 10 || hundred >= 20)) return 'ночи';
    return 'ночей';
  }

  /* --- Состояние --- */

  var minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  var maxMonth = new Date(today.getFullYear(), today.getMonth() + 12, 1);

  var viewMonth = new Date(minMonth);
  var cabin = cabinSelect.value || 'aurora-cabin';
  var checkIn = null;
  var checkOut = null;

  /* --- Диапазон --- */

  function nightsBetween(start, end) {
    return Math.round((end - start) / 86400000);
  }

  // Заняты должны быть свободны только ночи: [заезд, выезд - 1].
  // День выезда не ночует, поэтому в проверку не входит.
  function rangeHasBooked(cabinId, start, end) {
    for (var day = new Date(start); day < end; day = addDays(day, 1)) {
      if (isBooked(cabinId, day)) return true;
    }
    return false;
  }

  function totalFor(cabinId, start, end) {
    var sum = 0;
    for (var day = new Date(start); day < end; day = addDays(day, 1)) {
      sum += priceFor(cabinId, day);
    }
    return sum;
  }

  function isInRange(date) {
    if (!checkIn || !checkOut) return false;
    return date > checkIn && date < checkOut;
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = false;
  }

  function clearMessage() {
    messageEl.textContent = '';
    messageEl.hidden = true;
  }

  function handleDayClick(date) {
    clearMessage();

    // Диапазон уже собран — начинаем новый выбор
    if (checkIn && checkOut) {
      checkIn = date;
      checkOut = null;
    } else if (!checkIn) {
      checkIn = date;
    } else if (isSameDay(date, checkIn)) {
      // Повторный клик по дате заезда сбрасывает выбор
      checkIn = null;
      checkOut = null;
    } else if (date < checkIn) {
      // Выезд раньше заезда — считаем это новой датой заезда
      checkIn = date;
    } else if (rangeHasBooked(cabin, checkIn, date)) {
      showMessage('В этом диапазоне есть занятые даты');
    } else {
      checkOut = date;
    }

    render();
  }

  /* --- Отрисовка --- */

  function buildDay(date) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar__day';
    button.setAttribute('data-date', toKey(date));

    var number = document.createElement('span');
    number.className = 'calendar__day-number';
    number.textContent = String(date.getDate());
    button.appendChild(number);

    var past = date < today;
    var booked = isBooked(cabin, date);
    var label = formatDate(date);

    if (past) {
      button.classList.add('is-past');
      button.setAttribute('aria-disabled', 'true');
      label += ', прошедшая дата';
    } else if (booked) {
      button.classList.add('is-busy');
      button.setAttribute('aria-disabled', 'true');
      label += ', занято';
    } else {
      var price = priceFor(cabin, date);

      var priceEl = document.createElement('span');
      priceEl.className = 'calendar__day-price';
      priceEl.textContent = formatCellPrice(price);
      button.appendChild(priceEl);

      label += ', ' + formatMoney(price) + ', свободно';

      if (isSameDay(date, checkIn)) {
        button.classList.add('is-start');
        label += ', дата заезда';
      } else if (isSameDay(date, checkOut)) {
        button.classList.add('is-end');
        label += ', дата выезда';
      } else if (isInRange(date)) {
        button.classList.add('is-in-range');
        label += ', в выбранном диапазоне';
      }
    }

    button.setAttribute('aria-label', label);
    return button;
  }

  function renderMonth() {
    var year = viewMonth.getFullYear();
    var month = viewMonth.getMonth();

    monthEl.textContent = MONTHS_NOMINATIVE[month] + ' ' + year;

    gridEl.textContent = '';

    var offset = weekdayOffset(year, month);
    for (var blank = 0; blank < offset; blank++) {
      var filler = document.createElement('span');
      filler.className = 'calendar__blank';
      filler.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(filler);
    }

    var total = daysInMonth(year, month);
    for (var day = 1; day <= total; day++) {
      gridEl.appendChild(buildDay(new Date(year, month, day)));
    }

    prevBtn.disabled = viewMonth <= minMonth;
    nextBtn.disabled = viewMonth >= maxMonth;
  }

  function renderSummary() {
    cabinEl.textContent = CABINS[cabin].name;

    if (checkIn && checkOut) {
      var nights = nightsBetween(checkIn, checkOut);

      checkinEl.textContent = formatDateWithYear(checkIn);
      checkoutEl.textContent = formatDateWithYear(checkOut);
      nightsEl.textContent = nights + ' ' + nightsWord(nights);
      totalEl.textContent = formatMoney(totalFor(cabin, checkIn, checkOut));
      hintEl.hidden = true;
      return;
    }

    checkinEl.textContent = checkIn ? formatDateWithYear(checkIn) : '—';
    checkoutEl.textContent = '—';
    nightsEl.textContent = '—';
    totalEl.textContent = '—';
    hintEl.hidden = false;
  }

  function render() {
    renderMonth();
    renderSummary();
  }

  /* --- События --- */

  gridEl.addEventListener('click', function (event) {
    var button = event.target.closest('.calendar__day');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;

    handleDayClick(fromKey(button.getAttribute('data-date')));
  });

  // «Выбрать даты» в карточке номера: ставим её тип и пересчитываем цены.
  // Прокрутку к блоку делает сам href="#booking", поэтому не мешаем ссылке.
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-room-select]');
    if (!trigger) return;

    var id = trigger.getAttribute('data-room-select');
    if (!CABINS[id] || id === cabin) return;

    cabinSelect.value = id;
    cabinSelect.dispatchEvent(new Event('change'));
  });

  prevBtn.addEventListener('click', function () {
    if (viewMonth <= minMonth) return;
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    render();
  });

  nextBtn.addEventListener('click', function () {
    if (viewMonth >= maxMonth) return;
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
    render();
  });

  cabinSelect.addEventListener('change', function () {
    cabin = cabinSelect.value;

    // Значение подставляем программно, а такое присваивание событий не шлёт.
    // Шлём change вручную: на него завязан пересчёт вместимости в форме.
    if (formCabin) {
      formCabin.value = cabin;
      formCabin.dispatchEvent(new Event('change'));
    }

    clearMessage();

    // Даты сохраняем. Но если у нового типа домика выбранные ночи заняты,
    // держать такой диапазон нельзя — оставляем заезд и просим выбрать выезд заново.
    if (checkIn && checkOut && rangeHasBooked(cabin, checkIn, checkOut)) {
      checkOut = null;
      showMessage('В этом диапазоне есть занятые даты');
    }

    if (checkIn && isBooked(cabin, checkIn)) {
      checkIn = null;
      checkOut = null;
    }

    render();
  });

  // Тип домика выбирается только здесь. В форме он лежит скрытым полем —
  // держим его в актуальном состоянии, чтобы значение уехало с заявкой.
  if (formCabin) formCabin.value = cabin;

  render();
})();


/* --------------------------------------------------------------------------
   Счётчик «минус — значение — плюс»

   Работает с любой разметкой [data-stepper], внутри которой лежат кнопки
   [data-stepper-dec] / [data-stepper-inc] и поле ввода. Границы берутся
   из min и max самого поля, поэтому менять их можно снаружи — достаточно
   послать полю событие stepper:refresh, чтобы кнопки перерисовались.

   Кнопки шлют полю обычный input, так что вся проверка формы работает
   одинаково и для набора с клавиатуры, и для нажатия на плюс.
   -------------------------------------------------------------------------- */

(function initSteppers() {
  var steppers = document.querySelectorAll('[data-stepper]');
  if (!steppers.length) return;

  Array.prototype.forEach.call(steppers, function (stepper) {
    var input = stepper.querySelector('input');
    var decBtn = stepper.querySelector('[data-stepper-dec]');
    var incBtn = stepper.querySelector('[data-stepper-inc]');
    if (!input || !decBtn || !incBtn) return;

    function limit(attr, fallback) {
      var value = parseInt(input.getAttribute(attr), 10);
      return isFinite(value) ? value : fallback;
    }

    function current() {
      var value = parseInt(input.value, 10);
      return isFinite(value) ? value : limit('min', 0);
    }

    // Кнопку на границе гасим: понятнее, чем молча ничего не делать
    function refresh() {
      var value = current();
      decBtn.disabled = value <= limit('min', 0);
      incBtn.disabled = value >= limit('max', Infinity);
    }

    function step(delta) {
      var min = limit('min', 0);
      var max = limit('max', Infinity);
      var next = current() + delta;

      if (next < min) next = min;
      if (next > max) next = max;
      if (String(next) === input.value) return;

      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      refresh();
    }

    decBtn.addEventListener('click', function () { step(-1); });
    incBtn.addEventListener('click', function () { step(1); });

    input.addEventListener('input', refresh);

    // Значение или границы поменяли снаружи — перерисовываем кнопки
    input.addEventListener('stepper:refresh', refresh);

    refresh();
  });
})();


/* --------------------------------------------------------------------------
   Лайтбокс

   Само окно — общий компонент modals: разметка [data-modal] лежит в конце
   страницы, открытие и закрытие, Escape, клик вне и возврат фокуса уже
   работают там. Здесь только подбор снимков и перелистывание.

   Набор собирается из разметки: все img[data-gallery="<группа>"] в порядке
   следования. У номеров в карточке показан лишь первый снимок, остальные
   перечислены в EXTRA_PHOTOS и дописываются в конец набора.

   Открывает любой элемент с data-gallery-open="<группа>" (и, если нужно,
   data-gallery-index). Слушатель работает на фазе перехвата, чтобы снимок
   подставился раньше, чем окно покажется.
   -------------------------------------------------------------------------- */

(function initLightbox() {
  var SWIPE_THRESHOLD = 40; // px, короче — считаем случайным касанием

  var modal = document.getElementById('modal-lightbox');
  if (!modal) return;

  var imageEl = modal.querySelector('[data-lightbox-image]');
  var stageEl = modal.querySelector('[data-lightbox-stage]');
  var counterEl = modal.querySelector('[data-lightbox-counter]');
  var barEl = modal.querySelector('.lightbox__bar');
  var prevBtn = modal.querySelector('[data-lightbox-prev]');
  var nextBtn = modal.querySelector('[data-lightbox-next]');
  if (!imageEl || !stageEl || !counterEl || !barEl || !prevBtn || !nextBtn) return;

  // Первый снимок каждого номера лежит в разметке карточки — это обложка.
  // Здесь перечислено то, что показывается дальше по порядку.
  var EXTRA_PHOTOS = {
    'aurora-cabin': [
      { src: 'assets/images/aurora-cabin-1.webp', width: 1200, height: 1600,
        alt: 'Спальня с панорамным окном на заснеженную ель' },
      { src: 'assets/images/aurora-cabin-3.webp', width: 1600, height: 2400,
        alt: 'Спальня с тёмно-зелёными стенами и наклонным окном' },
      { src: 'assets/images/aurora-cabin-4.webp', width: 1200, height: 800,
        alt: 'Домик «Сияние» зимним вечером, тёплый свет из дверей' }
    ],
    'fjeld-suite': [
      { src: 'assets/images/fjeld-suite-1.webp', width: 1200, height: 1800,
        alt: 'Светлая гостиная с угловым диваном и видом на лес' },
      { src: 'assets/images/fjeld-suite-2.webp', width: 1200, height: 800,
        alt: 'Вид с террасы на заснеженные ели и горный хребет' },
      { src: 'assets/images/fjeld-suite-3.webp', width: 1200, height: 800,
        alt: 'Зона отдыха с креслом, овчиной и большим окном' }
    ],
    // ember-room-2 из показа убран: кадр не подходит номеру
    'ember-room': [
      { src: 'assets/images/ember-room-1.webp', width: 1200, height: 1800,
        alt: 'Интерьер домика с ванной у панорамного окна' },
      { src: 'assets/images/ember-room-4.webp', width: 1200, height: 1600,
        alt: 'Деревянная комната с винным стеллажом и тёплой гирляндой' }
    ]
  };

  var photos = [];
  var index = 0;

  function collect(group) {
    var fromMarkup = Array.prototype.map.call(
      document.querySelectorAll('img[data-gallery="' + group + '"]'),
      function (img) {
        return {
          src: img.getAttribute('src'),
          alt: img.getAttribute('alt') || '',
          width: img.getAttribute('width'),
          height: img.getAttribute('height')
        };
      }
    );

    return fromMarkup.concat(EXTRA_PHOTOS[group] || []);
  }

  function show(next) {
    if (photos.length === 0) return;

    index = (next % photos.length + photos.length) % photos.length;

    var photo = photos[index];
    imageEl.setAttribute('src', photo.src);
    imageEl.setAttribute('alt', photo.alt);
    if (photo.width) imageEl.setAttribute('width', photo.width);
    if (photo.height) imageEl.setAttribute('height', photo.height);

    counterEl.textContent = (index + 1) + ' / ' + photos.length;

    // Одно фото — перелистывать нечего, прячем и стрелки, и счётчик
    barEl.hidden = photos.length < 2;
  }

  // Перехват: набор должен быть готов до того, как окно откроется
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-gallery-open]');
    if (!trigger) return;

    photos = collect(trigger.getAttribute('data-gallery-open'));
    show(parseInt(trigger.getAttribute('data-gallery-index'), 10) || 0);
  }, true);

  prevBtn.addEventListener('click', function () { show(index - 1); });
  nextBtn.addEventListener('click', function () { show(index + 1); });

  document.addEventListener('keydown', function (event) {
    if (modal.hidden || photos.length < 2) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(index + 1);
    }
  });

  /* --- Свайп на телефоне --- */

  var touchStartX = null;

  stageEl.addEventListener('touchstart', function (event) {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  stageEl.addEventListener('touchend', function (event) {
    if (touchStartX === null) return;

    var shift = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;

    if (photos.length < 2 || Math.abs(shift) < SWIPE_THRESHOLD) return;

    show(shift < 0 ? index + 1 : index - 1);
  }, { passive: true });
})();


/* --------------------------------------------------------------------------
   Форма заявки

   Проверка полей своя, на русском, под полем — как в первом проекте.
   Отправки нет: sendRequest — заглушка, которая через секунду отвечает
   успехом. Настоящий адрес обработчика подставляется в FORM_ENDPOINT.

   Число гостей ограничено вместимостью выбранного домика (CABINS),
   дети считаются внутри общего числа гостей, а не сверх него.
   -------------------------------------------------------------------------- */

(function initBookingForm() {
  var form = document.getElementById('booking-form');
  if (!form) return;

  var nameField = document.getElementById('booking-name');
  var phoneField = document.getElementById('booking-phone');
  var cabinField = document.getElementById('booking-cabin');
  var cabinReadout = document.querySelector('[data-form-cabin]');
  var guestsField = document.getElementById('booking-guests');
  var childrenField = document.getElementById('booking-children');
  var trapField = document.getElementById('booking-company');

  var nameError = document.getElementById('booking-name-error');
  var phoneError = document.getElementById('booking-phone-error');
  var guestsError = document.getElementById('booking-guests-error');
  var childrenError = document.getElementById('booking-children-error');
  var guestsHint = document.getElementById('booking-guests-hint');
  var childrenHint = document.getElementById('booking-children-hint');

  var formError = document.getElementById('booking-form-error');
  var formSuccess = document.getElementById('booking-success');
  var submitButton = form.querySelector('[data-booking-submit]');

  var FORM_ENDPOINT = '';

  function sendRequest(data) {
    // ЗАГЛУШКА: имитируем секундную отправку с успешным результатом.
    return new Promise(function (resolve) {
      setTimeout(resolve, 1000);
    });

    /* НАСТОЯЩАЯ ОТПРАВКА — раскомментировать, когда появится адрес:

    return fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Сервер ответил с ошибкой ' + response.status);
      }
    });

    */
  }

  // Отключаем встроенные подсказки браузера: показываем свои, на русском
  // и под полем. Делаем это из скрипта, а не в разметке: если JavaScript
  // не сработает, проверка браузера останется рабочей.
  form.noValidate = true;

  function showError(field, box, message) {
    box.textContent = message;
    field.classList.add('has-error');
  }

  function clearError(field, box) {
    box.textContent = '';
    field.classList.remove('has-error');
  }

  /* --- Имя --- */

  function validateName() {
    if (nameField.value.trim().length < 2) {
      showError(nameField, nameError, 'Укажите имя — не короче двух букв.');
      return false;
    }
    clearError(nameField, nameError);
    return true;
  }

  /* --- Телефон ---
     Человек вводит только цифры, скобки и тире расставляются сами.
     Код страны +7 всегда стоит в начале и не стирается. */

  function onlyDigits(value) {
    return value.replace(/\D/g, '');
  }

  // Достаём цифры номера без кода страны — максимум 10 штук
  function localDigits(value) {
    var digits = onlyDigits(value.replace(/^\+7/, ''));

    // Если номер вставили из буфера целиком (11 цифр с 7 или 8 в начале),
    // первую цифру считаем кодом страны и отбрасываем
    if (digits.length === 11 && (digits.charAt(0) === '7' || digits.charAt(0) === '8')) {
      digits = digits.slice(1);
    }

    return digits.slice(0, 10);
  }

  // Собираем из цифр вид +7 (921) 123-45-67
  function formatPhone(digits) {
    var result = '+7';

    if (digits.length > 0) {
      result += ' (' + digits.slice(0, 3);
    }
    if (digits.length >= 3) {
      result += ')';
    }
    if (digits.length > 3) {
      result += ' ' + digits.slice(3, 6);
    }
    if (digits.length > 6) {
      result += '-' + digits.slice(6, 8);
    }
    if (digits.length > 8) {
      result += '-' + digits.slice(8, 10);
    }

    return result;
  }

  // Запоминаем, что показано в поле: нужно, чтобы правильно отработал Backspace
  var lastPhoneValue = '';

  // Клик по пустому полю — сразу подставляем код страны
  phoneField.addEventListener('focus', function () {
    if (phoneField.value === '') {
      phoneField.value = '+7 ';
      lastPhoneValue = '+7 ';
    }
  });

  // Ушли из поля, не введя ни одной цифры — очищаем, чтобы вернулась подсказка
  phoneField.addEventListener('blur', function () {
    if (localDigits(phoneField.value).length === 0) {
      phoneField.value = '';
      lastPhoneValue = '';
    }
  });

  function validatePhone() {
    var digits = localDigits(phoneField.value);

    if (digits.length === 0) {
      showError(phoneField, phoneError, 'Укажите телефон для связи.');
      return false;
    }

    // Без кода страны в российском номере ровно 10 цифр
    if (digits.length !== 10) {
      showError(phoneField, phoneError, 'Введите номер полностью: +7 (999) 123-45-67.');
      return false;
    }

    clearError(phoneField, phoneError);
    return true;
  }

  /* --- Гости и дети ---
     Вместимость берётся из общего справочника CABINS: цена от числа
     гостей не зависит, это только ограничение размещения. */

  function capacityFor(cabinId) {
    return CABINS[cabinId] ? CABINS[cabinId].capacity : 1;
  }

  function cabinName(cabinId) {
    return CABINS[cabinId] ? CABINS[cabinId].name : 'без названия';
  }

  function guestsWord(count) {
    var tail = count % 10;
    var hundred = count % 100;
    return (tail === 1 && hundred !== 11) ? 'гостя' : 'гостей';
  }

  // Границы и значение меняем из кода, а такие правки события не шлют.
  // Счётчику нужен сигнал, иначе плюс и минус останутся с прежней блокировкой.
  function refreshStepper(field) {
    field.dispatchEvent(new Event('stepper:refresh'));
  }

  // Дети считаются внутри общего числа гостей, и хотя бы один гость должен быть
  // взрослым — значит, детей не больше, чем гостей минус один. При одном госте
  // детей быть не может. Если гостей стало меньше, опускаем и число детей:
  // иначе форма осталась бы в противоречивом состоянии, которое создали мы сами,
  // а человек узнал бы об этом только при отправке.
  function childrenLimit() {
    var guests = parseInt(guestsField.value, 10);
    if (!isFinite(guests) || guests < 1) return 0;
    return guests - 1;
  }

  function syncChildrenMax() {
    var max = childrenLimit();
    var current = parseInt(childrenField.value, 10);

    childrenField.max = max;
    childrenHint.textContent = '';

    if (isFinite(current) && current > max) {
      childrenField.value = max;
      childrenHint.textContent = max === 0
        ? 'С одним гостем детей указать нельзя: в домике нужен хотя бы один взрослый.'
        : 'В домике нужен хотя бы один взрослый — уменьшили число детей до ' + max + '.';
    }

    refreshStepper(childrenField);
  }

  // Вызывается при смене типа домика, в том числе из календаря
  function applyCabinCapacity() {
    if (!cabinField.value) return;

    var max = capacityFor(cabinField.value);
    var current = parseInt(guestsField.value, 10);

    if (cabinReadout) cabinReadout.textContent = cabinName(cabinField.value);

    guestsField.max = max;
    guestsHint.textContent = '';

    if (isFinite(current) && current > max) {
      guestsField.value = max;
      guestsHint.textContent = 'В домике «' + cabinName(cabinField.value) + '» размещаются не больше '
        + max + ' ' + guestsWord(max) + ' — уменьшили число гостей.';
    }

    refreshStepper(guestsField);
    syncChildrenMax();
  }

  function validateGuests() {
    var max = capacityFor(cabinField.value);
    var value = parseInt(guestsField.value, 10);

    if (!isFinite(value) || value < 1) {
      showError(guestsField, guestsError, 'Укажите число гостей — не меньше одного.');
      return false;
    }

    if (value > max) {
      showError(guestsField, guestsError, 'В домике «' + cabinName(cabinField.value)
        + '» размещаются не больше ' + max + ' ' + guestsWord(max) + '.');
      return false;
    }

    clearError(guestsField, guestsError);
    return true;
  }

  function validateChildren() {
    var raw = childrenField.value.trim();

    // Поле необязательное: пусто — значит детей нет
    if (raw === '') {
      clearError(childrenField, childrenError);
      return true;
    }

    var value = parseInt(raw, 10);

    if (!isFinite(value) || value < 0) {
      showError(childrenField, childrenError, 'Число детей не может быть меньше нуля.');
      return false;
    }

    if (value > childrenLimit()) {
      showError(childrenField, childrenError,
        'В домике нужен хотя бы один взрослый: детей не больше, чем гостей минус один.');
      return false;
    }

    clearError(childrenField, childrenError);
    return true;
  }

  /* --- Реакция на ввод ---
     Ошибку убираем сразу, как только человек начал исправлять поле,
     но заново не показываем — не мешаем заполнять. */

  nameField.addEventListener('input', function () {
    if (nameError.textContent) clearError(nameField, nameError);
  });

  phoneField.addEventListener('input', function (event) {
    var digits = localDigits(phoneField.value);
    var isDeleting = event.inputType && event.inputType.indexOf('delete') === 0;

    // Backspace попал на скобку, пробел или тире: цифры не изменились.
    // Стираем последнюю цифру, иначе разделитель будет возвращаться и поле «залипнет»
    if (isDeleting && formatPhone(digits) === lastPhoneValue) {
      digits = digits.slice(0, -1);
    }

    lastPhoneValue = formatPhone(digits);
    phoneField.value = lastPhoneValue;

    if (phoneError.textContent) clearError(phoneField, phoneError);
  });

  // Скрытому полю change шлёт календарь: сам по себе hidden события не порождает
  cabinField.addEventListener('change', applyCabinCapacity);

  guestsField.addEventListener('input', function () {
    if (guestsError.textContent) clearError(guestsField, guestsError);
    guestsHint.textContent = '';
    syncChildrenMax();
  });

  childrenField.addEventListener('input', function () {
    if (childrenError.textContent) clearError(childrenField, childrenError);
    childrenHint.textContent = '';
  });

  /* --- Отправка --- */

  function setSending(isSending) {
    submitButton.disabled = isSending;
    submitButton.textContent = isSending ? 'Отправляем…' : 'Отправить заявку';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    // Ловушка сработала: поле заполнено, значит это бот. Молча не отправляем.
    if (trapField.value !== '') return;

    formError.hidden = true;

    // Проверяем все поля сразу, а не по одному: человек видит весь список ошибок
    var checks = [
      [validateName(), nameField],
      [validatePhone(), phoneField],
      [validateGuests(), guestsField],
      [validateChildren(), childrenField]
    ];

    var firstBad = null;
    for (var i = 0; i < checks.length; i++) {
      if (!checks[i][0]) {
        firstBad = checks[i][1];
        break;
      }
    }

    if (firstBad) {
      firstBad.focus();
      return;
    }

    setSending(true);

    sendRequest({
      name: nameField.value.trim(),
      phone: phoneField.value.trim(),
      cabin: cabinField.value,
      guests: parseInt(guestsField.value, 10),
      children: childrenField.value.trim() === '' ? 0 : parseInt(childrenField.value, 10)
    })
      .then(function () {
        form.hidden = true;
        formSuccess.hidden = false;
      })
      .catch(function () {
        // Ошибка: форма и всё, что человек ввёл, остаются на месте
        setSending(false);
        formError.hidden = false;
      });
  });

  applyCabinCapacity();
})();
