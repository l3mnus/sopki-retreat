/* ==========================================================================
   Sopki Retreat — script.js

   Что появится здесь отдельными задачами:
   - мобильное меню (.nav-toggle / aria-expanded);
   - подсветка активного пункта навигации при скролле;
   - анимации появления секций.
   ========================================================================== */

'use strict';


/* --------------------------------------------------------------------------
   Язык интерфейса

   Словарь лежит в i18n.js и подключается раньше этого файла. Здесь только
   применение: тексты по data-i18n, атрибуты по data-i18n-alt / -label /
   -placeholder, плюс t() для строк, которые собираются на ходу.

   Выбор запоминается в localStorage. При первом визите язык берётся из
   navigator.language, при отсутствии совпадения — русский.

   Модули, которые рисуют текст сами (календарь, форма, виджет сияния),
   слушают событие i18n:change и перерисовываются.
   -------------------------------------------------------------------------- */

var i18n = (function () {
  var STORAGE_KEY = 'sopki-lang';
  var FALLBACK = 'ru';

  // Для Intl нужен настоящий код языка, а не наша метка вкладки
  var LOCALES = { ru: 'ru', en: 'en', cn: 'zh' };

  var dictionaries = (typeof I18N !== 'undefined') ? I18N : {};
  var current = FALLBACK;

  function t(key, values) {
    var line = dictionaries[current] && dictionaries[current][key];

    if (line === undefined) {
      line = dictionaries[FALLBACK] && dictionaries[FALLBACK][key];
    }
    if (line === undefined) {
      return key;
    }
    if (!values) {
      return line;
    }

    return line.replace(/\{(\w+)\}/g, function (match, name) {
      return values[name] !== undefined ? values[name] : match;
    });
  }

  // Форм множественного числа у языков разное количество: у русского три,
  // у английского две, у китайского одна. Спрашиваем у Intl, а не считаем сами.
  function plural(count, prefix) {
    var form = 'other';

    try {
      form = new Intl.PluralRules(LOCALES[current]).select(count);
    } catch (error) {
      /* нет Intl.PluralRules — обойдёмся общей формой */
    }

    var line = dictionaries[current] && dictionaries[current][prefix + '.' + form];
    return line !== undefined ? line : t(prefix + '.other');
  }

  function detect() {
    var saved = null;

    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      /* приватный режим или запрет хранилища — не страшно */
    }
    if (saved && dictionaries[saved]) return saved;

    var preferred = (navigator.language || '').toLowerCase();
    if (preferred.indexOf('en') === 0) return 'en';
    if (preferred.indexOf('zh') === 0) return 'cn';

    return FALLBACK;
  }

  var SLOTS = [
    ['data-i18n', null],
    ['data-i18n-alt', 'alt'],
    ['data-i18n-label', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder']
  ];

  function applyStatic() {
    document.documentElement.setAttribute('lang', LOCALES[current] || current);

    SLOTS.forEach(function (slot) {
      Array.prototype.forEach.call(
        document.querySelectorAll('[' + slot[0] + ']'),
        function (node) {
          var value = t(node.getAttribute(slot[0]));
          if (slot[1]) {
            node.setAttribute(slot[1], value);
          } else {
            node.textContent = value;
          }
        }
      );
    });

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-lang]'),
      function (button) {
        var active = button.getAttribute('data-lang') === current;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('is-current', active);
      }
    );
  }

  function set(next) {
    if (!dictionaries[next] || next === current) return;

    current = next;

    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      /* не сохранилось — язык всё равно применится на этой странице */
    }

    applyStatic();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: next } }));
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-lang]');
    if (button) set(button.getAttribute('data-lang'));
  });

  function onChange(handler) {
    document.addEventListener('i18n:change', handler);
  }

  current = detect();
  applyStatic();

  return { t: t, plural: plural, set: set, onChange: onChange,
           lang: function () { return current; } };
})();


/* --------------------------------------------------------------------------
   Год в копирайте

   В разметке стоит год выпуска — он виден, пока не отработал скрипт,
   и остаётся, если скрипт не выполнился вовсе. Дальше подставляется
   текущий: иначе подвал протухает 1 января сразу на двух страницах.
   -------------------------------------------------------------------------- */

(function initCopyrightYear() {
  var year = String(new Date().getFullYear());

  Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (node) {
    node.textContent = year;
  });
})();


/* Скорость фонового видео на первом экране: 1 — как снято, меньше — медленнее.
   Значение подбирается на глаз, менять здесь. */
var HERO_PLAYBACK_RATE = 0.6;


/* --------------------------------------------------------------------------
   Фоновое видео первого экрана

   Ролик весит около 2 МБ, и на критическом пути ему делать нечего: сразу
   показывается постер, а адрес видео ждёт своей очереди в data-src.
   Источник подставляется после события load или по первому действию
   человека — что случится раньше.

   Тем, кто просил меньше движения, видео не грузится вообще: остаётся
   постер. Проявляется ролик только когда реально пошло воспроизведение,
   поэтому подмена не мигает.
   -------------------------------------------------------------------------- */

(function initHeroVideo() {
  var video = document.querySelector('[data-hero-video]');
  if (!video) return;

  var source = video.getAttribute('data-src');
  if (!source) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var started = false;

  // Часть браузеров сбрасывает скорость при загрузке источника, поэтому
  // выставляем её и на события, а не только один раз
  function applyRate() {
    try {
      video.playbackRate = HERO_PLAYBACK_RATE;
    } catch (error) {
      /* старый браузер не даёт менять скорость — не страшно */
    }
  }

  function reveal() {
    applyRate();
    video.classList.add('is-ready');
  }

  function start() {
    if (started) return;
    started = true;

    video.addEventListener('loadedmetadata', applyRate);
    video.addEventListener('playing', reveal, { once: true });

    video.setAttribute('src', source);
    video.load();

    // Атрибута autoplay обычно достаточно, но запуск может и не случиться —
    // просим явно и молча принимаем отказ политики автовоспроизведения
    var attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () {});
    }
  }

  if (document.readyState === 'complete') {
    start();
  } else {
    window.addEventListener('load', start, { once: true });
  }

  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (type) {
    window.addEventListener(type, start, { once: true, passive: true });
  });
})();


/* --------------------------------------------------------------------------
   Виджет вероятности сияния

   Источник: NOAA SWPC, планетарный Kp-индекс. Эндпоинт отдаёт
   Access-Control-Allow-Origin: *, поэтому запрос из браузера проходит
   без прокси. Ответ — массив записей с шагом 3 часа, берём последнюю.

   Пороги вероятности: 0–2 низкая, 3–4 средняя, 5+ высокая.
   Любая ошибка (сеть, CORS, пустой или неожиданный ответ) показывается
   в самом виджете, а не в консоли, и рядом появляется «Обновить».

   Запрос ограничен по времени. Соединение может открыться и замолчать —
   тогда fetch не отвалится сам, .catch не сработает никогда и виджет
   навсегда останется в «Загружаем прогноз…». AbortController обрывает
   такой запрос через TIMEOUT.
   -------------------------------------------------------------------------- */

(function initAuroraWidget() {
  var ENDPOINT = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
  var TIMEOUT = 8000;

  var widget = document.querySelector('[data-aurora]');
  if (!widget) return;

  var stateEl = widget.querySelector('[data-aurora-state]');
  var resultEl = widget.querySelector('[data-aurora-result]');
  var kpEl = widget.querySelector('[data-aurora-kp]');
  var labelEl = widget.querySelector('[data-aurora-label]');
  var retryEl = widget.querySelector('[data-aurora-retry]');
  if (!stateEl || !resultEl || !kpEl || !labelEl) return;

  // Состояние держим явно: 'loading' | 'ready' | 'error'. Раньше оно
  // выводилось из hidden-флагов, и загрузку нельзя было отличить от ошибки —
  // при смене языка «Загружаем…» превращалось в «Прогноз недоступен».
  var state = 'loading';
  var lastKp = null;
  var pending = false;

  function probabilityLabel(kp) {
    if (kp >= 5) return i18n.t('aurora.high');
    if (kp >= 3) return i18n.t('aurora.medium');
    return i18n.t('aurora.low');
  }

  function render() {
    if (state === 'ready' && lastKp !== null) {
      kpEl.textContent = i18n.t('aurora.kp', { value: lastKp.toFixed(1) });
      labelEl.textContent = probabilityLabel(lastKp);
      stateEl.hidden = true;
      resultEl.hidden = false;
      if (retryEl) retryEl.hidden = true;
      return;
    }

    stateEl.textContent = i18n.t(state === 'error' ? 'aurora.unavailable' : 'aurora.loading');
    stateEl.hidden = false;
    resultEl.hidden = true;
    if (retryEl) retryEl.hidden = state !== 'error';
  }

  i18n.onChange(render);

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

  function load() {
    if (pending) return;
    pending = true;

    state = 'loading';
    render();

    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) controller.abort();
    }, TIMEOUT);

    // Таймер снимаем здесь, а не раньше: срок отведён на весь запрос,
    // включая чтение тела ответа — оно тоже умеет виснуть.
    function settle(next, kp) {
      window.clearTimeout(timer);
      pending = false;
      state = next;
      if (kp !== undefined) lastKp = kp;
      render();
    }

    var options = { cache: 'no-store' };
    if (controller) options.signal = controller.signal;

    fetch(ENDPOINT, options)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var kp = extractLatestKp(data);
        if (kp === null) throw new Error('Не удалось разобрать ответ');
        settle('ready', kp);
      })
      .catch(function () {
        settle('error');
      });
  }

  if (retryEl) retryEl.addEventListener('click', load);

  load();
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

    // Кнопки-переключатели (бургер) сообщают состояние через aria-expanded
    if (lastTrigger && lastTrigger.hasAttribute('aria-expanded')) {
      lastTrigger.setAttribute('aria-expanded', 'true');
    }

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

    if (lastTrigger && lastTrigger.hasAttribute('aria-expanded')) {
      lastTrigger.setAttribute('aria-expanded', 'false');
    }

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

      // Повторный клик по той же кнопке закрывает окно: так ведут себя
      // переключатели вроде бургера
      if (openModal && openModal.id === trigger.getAttribute('data-modal-open')) {
        close();
      } else {
        open(trigger.getAttribute('data-modal-open'), trigger);
      }
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
   Уведомление о хранении

   Баннер не модальный: фокус не запирается, страница остаётся доступной.
   Закрывается кнопкой «Понятно» — только она считается ответом, поэтому
   переход по «Подробнее» уведомление не гасит.
   -------------------------------------------------------------------------- */

(function initCookieNotice() {
  var STORAGE_KEY = 'sopki-cookie';

  var banner = document.querySelector('[data-cookie]');
  if (!banner) return;

  var answered = null;
  try {
    answered = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    /* хранилище недоступно — покажем уведомление в этот заход */
  }
  if (answered) return;

  banner.hidden = false;

  banner.addEventListener('click', function (event) {
    if (!event.target.closest('[data-cookie-accept]')) return;

    banner.hidden = true;

    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (error) {
      /* не сохранилось — в следующий раз спросим снова */
    }
  });
})();


/* --------------------------------------------------------------------------
   Возврат к началу страницы

   Одной разметкой это не чинится. Раньше id="top" стоял на прилипающей
   шапке, и браузеру было некуда прокручивать. Перенос якоря выше помог
   лишь наполовину: к элементу нулевого размера Chrome тоже не
   прокручивается — хэш меняется, страница стоит.

   Поэтому ссылки на #top обрабатываем сами. Плавность включаем только
   тем, кто не просил уменьшить движение.
   -------------------------------------------------------------------------- */

(function initScrollToTop() {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href="#top"]');
    if (!link) return;

    event.preventDefault();

    window.scrollTo({
      top: 0,
      behavior: reduced.matches ? 'auto' : 'smooth'
    });
  });
})();


/* --------------------------------------------------------------------------
   Мобильное меню

   Своей логики окна здесь нет: панель — обычный [data-modal], её открывает
   и закрывает общий механизм modals (Escape, клик вне, ловушка фокуса,
   возврат фокуса на кнопку, блокировка прокрутки).

   Пункты не дублируются в разметке, а копируются из навигации в шапке:
   список остаётся в одном месте. Каждой копии добавляется data-modal-close,
   поэтому переход к разделу заодно закрывает панель.
   -------------------------------------------------------------------------- */

(function initNavPanel() {
  var panelList = document.querySelector('[data-nav-panel-list]');
  var headerLinks = document.querySelectorAll('.site-nav__list a');
  var toggle = document.querySelector('.nav-toggle');
  if (!panelList || headerLinks.length === 0 || !toggle) return;

  Array.prototype.forEach.call(headerLinks, function (link) {
    var item = document.createElement('li');
    var copy = document.createElement('a');

    copy.setAttribute('href', link.getAttribute('href'));
    copy.setAttribute('data-modal-close', '');
    copy.textContent = link.textContent;

    // Переносим ключ перевода, иначе копия застынет на языке загрузки
    var key = link.getAttribute('data-i18n');
    if (key) copy.setAttribute('data-i18n', key);

    item.appendChild(copy);
    panelList.appendChild(item);
  });

  // Если ширина доросла до десктопной, пока панель открыта, панель пропадёт
  // из вида по CSS — закрываем её сами, иначе прокрутка останется
  // заблокированной, а фокус запертым в невидимом окне.
  //
  // Признак десктопа берём не из копии медиазапроса, а из того, спрятана ли
  // сама кнопка: брейкпоинт остаётся в одном месте — в CSS.
  function closeIfBurgerHidden() {
    var panel = document.getElementById('site-nav-mobile');
    if (!panel || panel.hidden) return;

    if (window.getComputedStyle(toggle).display === 'none') {
      modals.close();
    }
  }

  // Слушаем оба события: браузеры шлют их в разных сочетаниях
  var desktop = window.matchMedia('(min-width: 60rem)');

  if (desktop.addEventListener) {
    desktop.addEventListener('change', closeIfBurgerHidden);
  } else if (desktop.addListener) {
    desktop.addListener(closeIfBurgerHidden);
  }

  window.addEventListener('resize', closeIfBurgerHidden);
})();


/* --------------------------------------------------------------------------
   Справочник домиков — общий для календаря и формы заявки.
   base — цена за домик за ночь до надбавок, capacity — сколько гостей
   размещается. Цена от числа гостей не зависит.
   -------------------------------------------------------------------------- */

/* Разряды и денежный формат нужны и календарю, и карточкам номеров,
   поэтому лежат снаружи обоих модулей. */
function groupDigits(value, separator) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

// В панели итога и в подсказках — полный формат
function formatMoney(value) {
  return i18n.t('money', { value: groupDigits(value, ' ') });
}


var CABINS = {
  'aurora-cabin': { name: 'Сияние', base: 24000, capacity: 4 },
  'fjeld-suite': { name: 'Панорама', base: 19000, capacity: 4 },
  'ember-room': { name: 'Очаг', base: 14000, capacity: 2 }
};


/* --------------------------------------------------------------------------
   Цена за ночь в карточках номеров

   Единственный источник — CABINS выше. Раньше та же цифра лежала ещё и
   строкой в каждом из трёх словарей, и словарь разъехался с календарём:
   в карточке стояло 24 000, а дешевле 30 000 в календаре не выбиралось.

   В подписи «от»: база — это минимум, к которому priceFor() добавляет
   надбавки за выходные и высокий сезон.
   -------------------------------------------------------------------------- */

(function initRoomPrices() {
  var nodes = document.querySelectorAll('[data-room-price]');
  if (!nodes.length) return;

  function render() {
    Array.prototype.forEach.call(nodes, function (node) {
      var cabin = CABINS[node.getAttribute('data-room-price')];
      if (!cabin) return;
      node.textContent = i18n.t('rooms.priceFrom', { value: formatMoney(cabin.base) });
    });
  }

  render();
  i18n.onChange(render);
})();


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

  // Названия месяцев берём из словаря: именительный — для шапки,
  // родительный — для дат вида «15 января»
  function monthName(month) {
    return i18n.t('calendar.month.' + (month + 1));
  }

  function monthGenitive(month) {
    return i18n.t('calendar.monthGen.' + (month + 1));
  }

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

  // В ячейке дня места мало: тонкий пробел вместо обычного, знак рубля не влезает
  function formatCellPrice(value) {
    return groupDigits(value, ' ');
  }

  // Порядок частей даты задан в словаре — у языков он разный
  function formatDate(date) {
    return i18n.t('calendar.dateShort', {
      day: date.getDate(),
      month: monthGenitive(date.getMonth())
    });
  }

  function formatDateWithYear(date) {
    return i18n.t('calendar.dateFull', {
      day: date.getDate(),
      month: monthGenitive(date.getMonth()),
      year: date.getFullYear()
    });
  }

  function nightsWord(count) {
    return i18n.plural(count, 'nights');
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
      showMessage(i18n.t('calendar.conflict'));
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
      label += ', ' + i18n.t('calendar.day.past');
    } else if (booked) {
      button.classList.add('is-busy');
      button.setAttribute('aria-disabled', 'true');
      label += ', ' + i18n.t('calendar.day.busy');
    } else {
      var price = priceFor(cabin, date);

      var priceEl = document.createElement('span');
      priceEl.className = 'calendar__day-price';
      priceEl.textContent = formatCellPrice(price);
      button.appendChild(priceEl);

      label += ', ' + formatMoney(price) + ', ' + i18n.t('calendar.day.free');

      if (isSameDay(date, checkIn)) {
        button.classList.add('is-start');
        label += ', ' + i18n.t('calendar.day.checkin');
      } else if (isSameDay(date, checkOut)) {
        button.classList.add('is-end');
        label += ', ' + i18n.t('calendar.day.checkout');
      } else if (isInRange(date)) {
        button.classList.add('is-in-range');
        label += ', ' + i18n.t('calendar.day.inRange');
      }
    }

    button.setAttribute('aria-label', label);
    return button;
  }

  function renderMonth() {
    var year = viewMonth.getFullYear();
    var month = viewMonth.getMonth();

    monthEl.textContent = i18n.t('calendar.monthTitle', { month: monthName(month), year: year });

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
    cabinEl.textContent = i18n.t('cabins.' + cabin);

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
      showMessage(i18n.t('calendar.conflict'));
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

  i18n.onChange(render);

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

var lightbox = (function initLightbox() {
  var SWIPE_THRESHOLD = 40; // px, короче — считаем случайным касанием
  var FADE_DURATION = 160;  // мс, тот же `--duration-fast`, что и в styles.css
  var REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

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
  // Первый снимок каждого номера лежит в разметке карточки — это обложка.
  // Здесь то, что показывается дальше. Подписи держим ключом словаря:
  // готовая строка застыла бы на языке, который был при загрузке.
  var EXTRA_PHOTOS = {
    'aurora-cabin': [
      { src: 'assets/images/aurora-cabin-1.webp', width: 1200, height: 1600,
        altKey: 'photo.aurora-cabin-1' },
      { src: 'assets/images/aurora-cabin-3.webp', width: 1600, height: 2400,
        altKey: 'photo.aurora-cabin-3' },
      { src: 'assets/images/aurora-cabin-4.webp', width: 1200, height: 800,
        altKey: 'photo.aurora-cabin-4' }
    ],
    'fjeld-suite': [
      { src: 'assets/images/fjeld-suite-1.webp', width: 1200, height: 1800,
        altKey: 'photo.fjeld-suite-1' },
      { src: 'assets/images/fjeld-suite-2.webp', width: 1200, height: 800,
        altKey: 'photo.fjeld-suite-2' },
      { src: 'assets/images/fjeld-suite-3.webp', width: 1200, height: 800,
        altKey: 'photo.fjeld-suite-3' }
    ],
    // ember-room-2 из показа убран: кадр не подходит номеру
    'ember-room': [
      { src: 'assets/images/ember-room-1.webp', width: 1200, height: 1800,
        altKey: 'photo.ember-room-1' },
      { src: 'assets/images/ember-room-4.webp', width: 1200, height: 1600,
        altKey: 'photo.ember-room-4' }
    ]
  };

  var photos = [];
  var index = 0;

  // Наборы собираем один раз, при загрузке. Позже читать разметку нельзя:
  // превью номера листается, и src картинки в карточке меняется — первый
  // снимок «уехал» бы вслед за ним.
  var galleries = (function buildGalleries() {
    var result = {};

    Array.prototype.forEach.call(
      document.querySelectorAll('img[data-gallery]'),
      function (img) {
        var group = img.getAttribute('data-gallery');
        if (!result[group]) result[group] = [];

        result[group].push({
          src: img.getAttribute('src'),
          // Ключ важнее готовой строки: набор собирается один раз, а язык
          // может смениться позже. alt оставляем запасным вариантом.
          altKey: img.getAttribute('data-i18n-alt'),
          alt: img.getAttribute('alt') || '',
          width: img.getAttribute('width'),
          height: img.getAttribute('height')
        });
      }
    );

    Object.keys(EXTRA_PHOTOS).forEach(function (group) {
      result[group] = (result[group] || []).concat(EXTRA_PHOTOS[group]);
    });

    return result;
  })();

  function collect(group) {
    return galleries[group] || [];
  }

  // Подпись берём из словаря, если известен ключ: набор собран один раз,
  // а язык может смениться в любой момент
  function altOf(photo) {
    return photo.altKey ? i18n.t(photo.altKey) : (photo.alt || '');
  }

  var switchTimer = null;

  function show(next) {
    if (photos.length === 0) return;

    var newIndex = (next % photos.length + photos.length) % photos.length;
    // Тот же кадр просят перерисовать при смене языка — там меняется
    // только подпись, гаснуть и загораться заново нечему.
    var samePhoto = newIndex === index;
    index = newIndex;

    var photo = photos[index];

    function apply() {
      imageEl.setAttribute('src', photo.src);
      imageEl.setAttribute('alt', altOf(photo));
      if (photo.width) imageEl.setAttribute('width', photo.width);
      if (photo.height) imageEl.setAttribute('height', photo.height);

      counterEl.textContent = (index + 1) + ' / ' + photos.length;

      // Одно фото — перелистывать нечего, прячем и стрелки, и счётчик
      barEl.hidden = photos.length < 2;
    }

    if (switchTimer) {
      window.clearTimeout(switchTimer);
      switchTimer = null;
    }

    // Затухание — только при реальной смене кадра и только тем, кто не
    // просил меньше движения. На самое первое открытие (src ещё пуст)
    // тоже не распространяется: гаснуть там нечему, только тормозит показ.
    if (!REDUCE_MOTION.matches && !samePhoto && imageEl.getAttribute('src')) {
      imageEl.classList.add('is-switching');
      switchTimer = window.setTimeout(function () {
        switchTimer = null;
        apply();
        imageEl.classList.remove('is-switching');
      }, FADE_DURATION);
    } else {
      apply();
    }
  }

  // Перехват: набор должен быть готов до того, как окно откроется
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-gallery-open]');
    if (!trigger) return;

    photos = collect(trigger.getAttribute('data-gallery-open'));
    show(parseInt(trigger.getAttribute('data-gallery-index'), 10) || 0);
  }, true);

  // Явный .focus(): клик мышью по кнопке не везде переводит на неё фокус
  // сам по себе (например, Safari на macOS по умолчанию этого не делает).
  // Без этой строки фокус оставался там, где был при открытии окна —
  // на кнопке закрытия — и рамка фокуса «прилипала» к ней на каждый клик.
  prevBtn.addEventListener('click', function () { show(index - 1); prevBtn.focus(); });
  nextBtn.addEventListener('click', function () { show(index + 1); nextBtn.focus(); });

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

  // Открытый лайтбокс переобует подпись вместе с языком
  i18n.onChange(function () {
    if (photos.length) show(index);
  });

  return {
    SWIPE_THRESHOLD: SWIPE_THRESHOLD,
    photosFor: collect,
    altOf: altOf
  };
})();


/* --------------------------------------------------------------------------
   Превью номера: точки и переключение кадров

   Под фотографией в карточке — ряд точек по числу снимков набора. Набор
   берётся у лайтбокса, чтобы источник данных остался один.

   Точки только показывают положение: они aria-hidden и не кликаются.
   Листают свайпом по фото и стрелками ←/→, когда превью в фокусе.
   Обычный клик по-прежнему открывает лайтбокс — и открывает его на том
   кадре, который сейчас виден.
   -------------------------------------------------------------------------- */

(function initRoomPreview() {
  var previews = document.querySelectorAll('.room-card__photo[data-gallery-open]');
  if (previews.length === 0 || typeof lightbox === 'undefined') return;

  Array.prototype.forEach.call(previews, function (button) {
    var group = button.getAttribute('data-gallery-open');
    var photos = lightbox.photosFor(group);
    var image = button.querySelector('img');
    var dotsBox = button.querySelector('.room-card__dots');

    // Один снимок — листать нечего, индикатор не выводим вовсе
    if (!image || !dotsBox || photos.length < 2) return;

    // Берём ключ, а не готовую строку: при смене языка подпись пересоберётся
    var labelKey = button.getAttribute('data-i18n-label');
    var index = 0;
    var dots = [];

    photos.forEach(function () {
      var dot = document.createElement('span');
      dot.className = 'room-card__dot';
      dotsBox.appendChild(dot);
      dots.push(dot);
    });

    button.classList.add('is-gallery');

    // На первый показ анимации ещё не было — перезапускать нечего, а
    // принудительный reflow (offsetWidth) на ещё не отрисованной странице
    // стоит дорого: замер показал ~10мс на первой же карточке против
    // долей миллисекунды на следующих, когда layout уже посчитан.
    var hasRendered = false;

    function render() {
      var photo = photos[index];

      image.setAttribute('src', photo.src);
      image.setAttribute('alt', lightbox.altOf(photo));
      if (photo.width) image.setAttribute('width', photo.width);
      if (photo.height) image.setAttribute('height', photo.height);

      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-current', i === index);
      });

      // Лайтбокс откроется на том же кадре, что виден в карточке
      button.setAttribute('data-gallery-index', String(index));
      // Разделитель тоже из словаря: в китайском перечисление отделяется
      // своей запятой, а не латинской
      button.setAttribute('aria-label', i18n.t('lightbox.labelJoin', {
        label: i18n.t(labelKey),
        photo: i18n.t('lightbox.photoOf', { n: index + 1, total: photos.length })
      }));

      // Перезапуск анимации проявления: снимаем класс, заставляем браузер
      // пересчитать стиль, возвращаем. Сама анимация объявлена только для
      // тех, кто не просил уменьшить движение.
      if (hasRendered) {
        image.classList.remove('is-fresh');
        void image.offsetWidth;
      }
      hasRendered = true;
      image.classList.add('is-fresh');
    }

    function step(shift) {
      index = (index + shift + photos.length) % photos.length;
      render();
    }

    button.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    });

    /* --- Свайп --- */

    var startX = null;
    var swiped = false;

    button.addEventListener('touchstart', function (event) {
      startX = event.changedTouches[0].clientX;
      swiped = false;
    }, { passive: true });

    button.addEventListener('touchend', function (event) {
      if (startX === null) return;

      var shift = event.changedTouches[0].clientX - startX;
      startX = null;

      if (Math.abs(shift) < lightbox.SWIPE_THRESHOLD) return;

      swiped = true;
      step(shift < 0 ? 1 : -1);
    }, { passive: true });

    // После свайпа браузер всё равно шлёт click — он открыл бы лайтбокс.
    // Гасим ровно один такой клик, на фазе перехвата, до общего обработчика окна.
    button.addEventListener('click', function (event) {
      if (!swiped) return;

      swiped = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    i18n.onChange(render);

    render();
  });
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
  var arrivalField = document.getElementById('booking-arrival');
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

  // Показанные сообщения помним ключом и подстановками: при смене языка
  // их нужно перерисовать, а не гасить — человек не терял бы контекст.
  // В атрибуте храним только нейтральные значения: идентификатор домика
  // и числа. Название и форму слова пересобираем при каждой отрисовке —
  // иначе после смены языка в строке остался бы кусок прежнего.
  function renderLive(box) {
    var key = box.getAttribute('data-i18n-live');
    if (!key) return;

    var raw = box.getAttribute('data-i18n-vars');
    var values = raw ? JSON.parse(raw) : null;

    if (values) {
      if (values.cabinId) values.cabin = cabinName(values.cabinId);
      if (typeof values.max === 'number') values.word = guestsWord(values.max);
    }

    box.textContent = i18n.t(key, values);
  }

  function showError(field, box, key, values) {
    box.setAttribute('data-i18n-live', key);
    box.setAttribute('data-i18n-vars', values ? JSON.stringify(values) : '');
    renderLive(box);
    field.classList.add('has-error');
  }

  function clearError(field, box) {
    box.removeAttribute('data-i18n-live');
    box.removeAttribute('data-i18n-vars');
    box.textContent = '';
    field.classList.remove('has-error');
  }

  function showHint(box, key, values) {
    box.setAttribute('data-i18n-live', key);
    box.setAttribute('data-i18n-vars', values ? JSON.stringify(values) : '');
    renderLive(box);
  }

  function clearHint(box) {
    box.removeAttribute('data-i18n-live');
    box.removeAttribute('data-i18n-vars');
    box.textContent = '';
  }

  /* --- Имя --- */

  function validateName() {
    if (nameField.value.trim().length < 2) {
      showError(nameField, nameError, 'form.error.name');
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
      showError(phoneField, phoneError, 'form.error.phoneEmpty');
      return false;
    }

    // Без кода страны в российском номере ровно 10 цифр
    if (digits.length !== 10) {
      showError(phoneField, phoneError, 'form.error.phoneShort');
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
    return i18n.t('cabins.' + cabinId);
  }

  function guestsWord(count) {
    return i18n.plural(count, 'guests');
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
    clearHint(childrenHint);

    if (isFinite(current) && current > max) {
      childrenField.value = max;
      showHint(childrenHint, max === 0 ? 'form.hint.childrenNone' : 'form.hint.childrenReduced',
        { max: max });
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
    clearHint(guestsHint);

    if (isFinite(current) && current > max) {
      guestsField.value = max;
      showHint(guestsHint, 'form.hint.guestsReduced',
        { cabinId: cabinField.value, max: max });
    }

    refreshStepper(guestsField);
    syncChildrenMax();
  }

  function validateGuests() {
    var max = capacityFor(cabinField.value);
    var value = parseInt(guestsField.value, 10);

    if (!isFinite(value) || value < 1) {
      showError(guestsField, guestsError, 'form.error.guestsMin');
      return false;
    }

    if (value > max) {
      showError(guestsField, guestsError, 'form.error.guestsMax',
        { cabinId: cabinField.value, max: max });
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
      showError(childrenField, childrenError, 'form.error.childrenNegative');
      return false;
    }

    if (value > childrenLimit()) {
      showError(childrenField, childrenError, 'form.error.childrenMax');
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
    clearHint(guestsHint);
    syncChildrenMax();
  });

  childrenField.addEventListener('input', function () {
    if (childrenError.textContent) clearError(childrenField, childrenError);
    clearHint(childrenHint);
  });

  /* --- Отправка --- */

  function setSending(isSending) {
    submitButton.disabled = isSending;
    submitButton.textContent = i18n.t(isSending ? 'form.sending' : 'form.submit');
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
      children: childrenField.value.trim() === '' ? 0 : parseInt(childrenField.value, 10),
      arrival: arrivalField ? arrivalField.value : ''
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

  // Смена языка: статические подписи обновит общий проход, здесь — то,
  // что скрипт пишет сам.
  //
  // applyCabinCapacity вызывать нельзя: он гасит подсказку, когда ужимать
  // уже нечего, и показанное сообщение пропало бы при переключении языка.
  i18n.onChange(function () {
    if (cabinReadout) cabinReadout.textContent = cabinName(cabinField.value);
    setSending(false);

    Array.prototype.forEach.call(
      form.parentNode.querySelectorAll('[data-i18n-live]'),
      renderLive
    );
  });

  applyCabinCapacity();
})();
