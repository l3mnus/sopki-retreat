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
   Форма заявки

   Проверка полей своя, на русском, под полем — как в первом проекте.
   Отправки нет: sendRequest — заглушка, которая через секунду отвечает
   успехом. Настоящий адрес обработчика подставляется в FORM_ENDPOINT.
   -------------------------------------------------------------------------- */

(function initBookingForm() {
  var form = document.getElementById('booking-form');
  if (!form) return;

  var nameField = document.getElementById('booking-name');
  var cabinField = document.getElementById('booking-cabin');
  var trapField = document.getElementById('booking-company');

  var nameError = document.getElementById('booking-name-error');
  var cabinError = document.getElementById('booking-cabin-error');
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

  function validateName() {
    if (nameField.value.trim().length < 2) {
      showError(nameField, nameError, 'Укажите имя — не короче двух букв.');
      return false;
    }
    clearError(nameField, nameError);
    return true;
  }

  function validateCabin() {
    if (cabinField.value === '') {
      showError(cabinField, cabinError, 'Выберите тип домика.');
      return false;
    }
    clearError(cabinField, cabinError);
    return true;
  }

  // Ошибку убираем сразу, как только человек начал исправлять поле,
  // но заново не показываем — не мешаем заполнять
  nameField.addEventListener('input', function () {
    if (nameError.textContent) clearError(nameField, nameError);
  });

  cabinField.addEventListener('change', function () {
    if (cabinError.textContent) clearError(cabinField, cabinError);
  });

  function setSending(isSending) {
    submitButton.disabled = isSending;
    submitButton.textContent = isSending ? 'Отправляем…' : 'Отправить заявку';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    // Ловушка сработала: поле заполнено, значит это бот. Молча не отправляем.
    if (trapField.value !== '') return;

    formError.hidden = true;

    // Проверяем оба поля, а не только первое: человек сразу видит все ошибки
    var nameOk = validateName();
    var cabinOk = validateCabin();

    if (!nameOk || !cabinOk) {
      (nameOk ? cabinField : nameField).focus();
      return;
    }

    setSending(true);

    sendRequest({
      name: nameField.value.trim(),
      cabin: cabinField.value
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
})();
