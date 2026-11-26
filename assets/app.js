/* КИТиС · расписание. Vanilla JS, без сборщика и внешних библиотек. */
(function () {
  'use strict';

  const KEYS = {
    favorite: 'kitis-de:fav',
    groups: 'kitis-de:groups',
    theme: 'kitis-de:theme',
    accent: 'kitis-de:accent',
    surface: 'kitis-de:surface'
  };
  const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const TIMELINE_START = 8 * 60;
  const TIMELINE_END = 19 * 60;
  const PIXELS_PER_MINUTE = 1;
  const ORIGINAL_SCHEDULE = JSON.parse(JSON.stringify(window.SCHEDULE || { group: 'ИСр24-1', days: [] }));
  const safeStorage = {
    get(key, fallback) {
      try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
      catch (_) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* storage может быть отключён */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (_) { /* storage может быть отключён */ } }
  };

  function parseLocalDate(value) {
    const parts = String(value || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }
  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function mondayOf(date) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const day = (result.getDay() + 6) % 7;
    result.setDate(result.getDate() - day);
    return result;
  }
  function addDays(date, amount) {
    const result = new Date(date.getTime());
    result.setDate(result.getDate() + amount);
    return result;
  }
  function formatDate(date, options) {
    return new Intl.DateTimeFormat('ru-RU', options || { day: 'numeric', month: 'long' }).format(date);
  }
  function minutesOf(time) {
    const parts = String(time || '00:00').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  function durationMinutes(lesson) { return Math.max(0, minutesOf(lesson.end) - minutesOf(lesson.start)); }
  function durationLabel(total) {
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours && mins) return `${hours} ч ${mins} мин`;
    if (hours) return `${hours} ч`;
    return `${mins} мин`;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function makeEmptyWeek(startDate) {
    return DAY_NAMES.map((weekday, index) => {
      const date = addDays(startDate, index);
      return { weekday, date: dateKey(date), short: DAY_SHORT[index], lessons: [] };
    });
  }
  function normaliseWeek(week, startDate) {
    const empty = makeEmptyWeek(startDate);
    if (!Array.isArray(week)) return empty;
    return empty.map((baseDay, index) => {
      const source = week[index] || {};
      return {
        weekday: source.weekday || baseDay.weekday,
        date: source.date || baseDay.date,
        short: source.short || baseDay.short,
        lessons: Array.isArray(source.lessons) ? source.lessons.map((lesson, lessonIndex) => ({
          id: lesson.id || `lesson-${index}-${lessonIndex}`,
          badge: lesson.badge || String(lessonIndex + 1),
          start: lesson.start || '08:30',
          end: lesson.end || '10:00',
          subject: lesson.subject || 'Новое занятие',
          teacher: lesson.teacher || '',
          room: lesson.room === undefined ? null : lesson.room,
          color: lesson.color || '#8494d6'
        })).sort((a, b) => minutesOf(a.start) - minutesOf(b.start)) : []
      };
    });
  }

  const defaultWeekStart = mondayOf(parseLocalDate((ORIGINAL_SCHEDULE.days[0] && ORIGINAL_SCHEDULE.days[0].date) || '2026-11-16') || new Date(2026, 10, 16));
  const initialGroup = {
    id: 'group-isr24-1',
    name: ORIGINAL_SCHEDULE.group || 'ИСр24-1',
    color: '#7588e7',
    weeks: { [dateKey(defaultWeekStart)]: normaliseWeek(ORIGINAL_SCHEDULE.days, defaultWeekStart) }
  };
  let groups = loadGroups();
  let activeGroupId = safeStorage.get('kitis-de:active-group', groups[0] ? groups[0].id : initialGroup.id);
  let selectedWeekStart = new Date(defaultWeekStart.getTime());
  const nowParameter = new URLSearchParams(window.location.search).get('now');
  const demoTime = nowParameter ? new Date(nowParameter) : null;
  const isDemoTime = Boolean(demoTime && !Number.isNaN(demoTime.getTime()));
  let activeDay = 0;
  let currentView = 'week';
  let searchTerm = '';
  let editingLessonId = null;
  let editingLessonDay = null;
  let toastTimer = null;

  function loadGroups() {
    try {
      const stored = safeStorage.get(KEYS.groups, null);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) {
          return parsed.map((group, index) => ({
            id: group.id || `group-${index}`,
            name: group.name || `Группа ${index + 1}`,
            color: group.color || '#7588e7',
            weeks: group.weeks && typeof group.weeks === 'object' ? group.weeks : {
              [dateKey(defaultWeekStart)]: normaliseWeek(group.days || [], defaultWeekStart)
            }
          }));
        }
      }
    } catch (_) { /* повреждённое значение заменяем начальным набором */ }
    return [JSON.parse(JSON.stringify(initialGroup))];
  }
  function saveGroups() { safeStorage.set(KEYS.groups, JSON.stringify(groups)); }
  function activeGroup() { return groups.find(group => group.id === activeGroupId) || groups[0]; }
  function getCurrentWeekDays(group) {
    const current = group || activeGroup();
    const key = dateKey(selectedWeekStart);
    if (!current.weeks[key]) current.weeks[key] = makeEmptyWeek(selectedWeekStart);
    return current.weeks[key];
  }
  function currentSchedule() {
    const group = activeGroup();
    const schedule = { group: group.name, weekLabel: getWeekLabel(), days: getCurrentWeekDays(group) };
    window.SCHEDULE = schedule;
    return schedule;
  }
  function matchesSearch(lesson) {
    if (!searchTerm) return true;
    const haystack = `${lesson.subject} ${lesson.teacher} ${lesson.room === null ? 'дистант' : lesson.room} ${lesson.badge}`.toLocaleLowerCase('ru-RU');
    return haystack.includes(searchTerm);
  }


  const $ = id => document.getElementById(id);
  const dayButtons = Array.from(document.querySelectorAll('.day-btn'));

  function getWeekLabel() {
    const end = addDays(selectedWeekStart, 6);
    const sameMonth = selectedWeekStart.getMonth() === end.getMonth();
    const startText = sameMonth ? String(selectedWeekStart.getDate()) : formatDate(selectedWeekStart, { day: 'numeric', month: 'short' });
    return `${startText}–${formatDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  function updateWeekHeading() {
    const days = getCurrentWeekDays();
    $('week-label').textContent = getWeekLabel();
    dayButtons.forEach((button, index) => {
      const day = days[index];
      const date = day ? parseLocalDate(day.date) : addDays(selectedWeekStart, index);
      const strong = button.querySelector('strong');
      if (strong) strong.textContent = date ? String(date.getDate()) : String(index + 1);
      button.title = `${DAY_NAMES[index]}, ${date ? formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' }) : ''}`;
      button.classList.toggle('active', index === activeDay);
      button.setAttribute('aria-pressed', index === activeDay ? 'true' : 'false');
    });
  }
  function updateGroupSelector() {
    const select = $('group-select');
    select.innerHTML = groups.map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join('');
    select.value = activeGroupId;
    $('group-list').innerHTML = groups.map(group => {
      const week = group.weeks[dateKey(selectedWeekStart)] || [];
      const count = Array.isArray(week) ? week.reduce((sum, day) => sum + (day.lessons || []).length, 0) : 0;
      const favorite = safeStorage.get(KEYS.favorite, '') === group.name;
      return `<button type="button" class="group-item ${group.id === activeGroupId ? 'active' : ''}" data-group="${escapeHtml(group.id)}"><i class="group-color" style="background:${escapeHtml(group.color)}"></i><span>${escapeHtml(group.name)}</span>${favorite ? '<span aria-label="В избранном">★</span>' : ''}<span class="group-count">${count || '—'}</span></button>`;
    }).join('');
  }

  function renderDay(dayIndex) {
    const schedule = currentSchedule();
    const day = schedule.days[dayIndex];
    activeDay = Math.max(0, Math.min(6, Number(dayIndex) || 0));
    updateWeekHeading();
    const selectedDay = schedule.days[activeDay];
    const date = selectedDay ? parseLocalDate(selectedDay.date) : null;
    $('agenda-heading').textContent = selectedDay ? selectedDay.weekday : DAY_NAMES[activeDay];
    $('agenda-date').textContent = date ? formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    if (!day || !Array.isArray(day.lessons) || !day.lessons.length) {
      $('app').innerHTML = `<h2 class="day-title">${escapeHtml(day ? day.weekday : DAY_NAMES[activeDay])}</h2><div class="empty-state"><strong>Пар нет</strong>На этот день занятий не запланировано.<br>Можно спокойно заняться своими делами.</div>`;
      $('day-lesson-count').textContent = '0 занятий';
      $('day-duration').textContent = '0 мин';
      return;
    }

    const todayMinutes = getNow().getHours() * 60 + getNow().getMinutes();
    const currentDate = dateKeyFromDate(getNow());
    const isCurrentDate = selectedDay.date === currentDate;
    const totalMinutes = day.lessons.reduce((sum, lesson) => sum + durationMinutes(lesson), 0);
    $('day-lesson-count').textContent = `${day.lessons.length} ${plural(day.lessons.length, 'занятие', 'занятия', 'занятий')}`;
    $('day-duration').textContent = durationLabel(totalMinutes);
    const visibleLessons = day.lessons.filter(matchesSearch);
    if (searchTerm && !visibleLessons.length) {
      $('app').innerHTML = `<h2 class="day-title">${escapeHtml(day.weekday)}</h2><div class="empty-state"><strong>Ничего не найдено</strong>Попробуй изменить запрос или выбрать другой день.</div>`;
      return;
    }
    $('app').innerHTML = `<h2 class="day-title">${escapeHtml(day.weekday)}</h2>` + visibleLessons.map(lesson => {
      const isCurrent = isCurrentDate && todayMinutes >= minutesOf(lesson.start) && todayMinutes < minutesOf(lesson.end);
      const room = lesson.room === null ? 'Дистант' : `ауд. ${lesson.room}`;
      const teacher = lesson.teacher ? ` · ${escapeHtml(lesson.teacher)}` : '';
      return `<article class="lesson-card ${isCurrent ? 'current' : ''}" data-lesson="${escapeHtml(lesson.id)}" style="--subject-color:${escapeHtml(lesson.color)}">
        <span class="lesson-num">${escapeHtml(lesson.badge)}</span>
        <div class="lesson-content">
          <div class="lesson-subject">${escapeHtml(lesson.subject)}</div>
          <div class="lesson-meta"><span class="meta-time">${escapeHtml(lesson.start)}–${escapeHtml(lesson.end)}</span>${teacher} · ${escapeHtml(room)}</div>
        </div>
        <button type="button" class="lesson-more" data-edit="${escapeHtml(lesson.id)}" title="Изменить занятие" aria-label="Изменить занятие">···</button>
      </article>`;
    }).join('');
    refreshCurrentClasses();
  }
  window.renderDay = renderDay;

  function dateKeyFromDate(date) { return dateKey(date); }
  function getNow() { return isDemoTime ? new Date(demoTime.getTime()) : new Date(); }
  function plural(number, one, few, many) {
    const n = Math.abs(number) % 100;
    const last = n % 10;
    if (n > 10 && n < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }
  function findLessonAt(day, now) {
    if (!day) return null;
    const time = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    return day.lessons.find(lesson => time >= minutesOf(lesson.start) && time < minutesOf(lesson.end)) || null;
  }
  function findNextLesson(day, now) {
    if (!day) return null;
    const time = now.getHours() * 60 + now.getMinutes();
    return day.lessons.find(lesson => minutesOf(lesson.start) > time) || null;
  }
  function findDateDay(days, date) { return days.find(day => day.date === dateKey(date)) || null; }

  function renderTimer() {
    const now = getNow();
    const days = getCurrentWeekDays();
    const day = findDateDay(days, now);
    const current = findLessonAt(day, now);
    const next = day ? findNextLesson(day, now) : null;
    const dateMatchesSelectedWeek = Boolean(day);
    if (current) {
      const left = Math.max(0, minutesOf(current.end) - (now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60));
      const remainingMinutes = Math.ceil((minutesOf(current.end) * 60 - (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds())) / 60);
      const total = Math.max(1, durationMinutes(current));
      const passed = Math.max(0, now.getHours() * 60 + now.getMinutes() - minutesOf(current.start));
      $('timer-state').textContent = 'ИДЁТ СЕЙЧАС';
      $('timer-title').textContent = current.subject;
      $('timer-description').textContent = `${current.badge === 'К' ? 'Кураторский час' : `${current.badge} пара`} · ${current.start}–${current.end} · ${current.room === null ? 'Дистант' : `ауд. ${current.room}`}`;
      $('timer-label').textContent = 'ДО КОНЦА ПАРЫ';
      $('timer').textContent = `${remainingMinutes} мин`;
      $('timer-progress').style.width = `${Math.min(100, Math.max(0, (passed / total) * 100))}%`;
      $('timer-progress').style.setProperty('--timer-progress', `${Math.min(100, Math.max(0, (passed / total) * 100))}%`);
      $('next-lesson-title').textContent = 'После этой пары';
      $('next-lesson-time').textContent = next ? `${next.start} · ${next.subject}` : 'На сегодня больше нет занятий';
    } else if (next) {
      const minutesLeft = minutesOf(next.start) - (now.getHours() * 60 + now.getMinutes());
      $('timer-state').textContent = 'СЛЕДУЮЩАЯ ПАРА';
      $('timer-title').textContent = next.subject;
      $('timer-description').textContent = `${next.badge === 'К' ? 'Кураторский час' : `${next.badge} пара`} · начало в ${next.start} · ${next.room === null ? 'дистант' : `ауд. ${next.room}`}`;
      $('timer-label').textContent = 'ДО НАЧАЛА ПАРЫ';
      $('timer').textContent = `Через ${durationLabel(minutesLeft)}`;
      $('timer-progress').style.width = '0%';
      $('next-lesson-title').textContent = 'Подготовься заранее';
      $('next-lesson-time').textContent = `Следующая пара в ${next.start}`;
    } else {
      $('timer-state').textContent = dateMatchesSelectedWeek ? 'СЕГОДНЯ' : (isDemoTime ? 'ДЕМО-ВРЕМЯ' : 'ТЕКУЩАЯ ДАТА');
      $('timer-title').textContent = dateMatchesSelectedWeek ? 'На сегодня занятий больше нет' : 'Для этой даты нет расписания';
      $('timer-description').textContent = dateMatchesSelectedWeek ? 'Можно выдохнуть — учебная часть дня завершена.' : 'Доступен учебный срез за 16–22 ноября 2026. Переключись на эту неделю или добавь свои занятия.';
      $('timer-label').textContent = 'ТАЙМЕР';
      $('timer').textContent = dateMatchesSelectedWeek ? 'Пар нет' : '—';
      $('timer-progress').style.width = '0%';
      $('next-lesson-title').textContent = 'Свободное время';
      $('next-lesson-time').textContent = 'Следующих занятий нет';
    }
    refreshCurrentClasses();
  }
  function refreshCurrentClasses() {
    const now = getNow();
    const todayKey = dateKey(now);
    const week = getCurrentWeekDays();
    document.querySelectorAll('.week-event, .lesson-card').forEach(element => {
      const lessonId = element.dataset.lesson || element.dataset.id;
      const dayKey = element.dataset.date;
      const day = week.find(item => item.date === dayKey) || week[activeDay];
      const lesson = day && day.lessons.find(item => item.id === lessonId);
      const isCurrent = Boolean(lesson && day.date === todayKey && now.getHours() * 60 + now.getMinutes() >= minutesOf(lesson.start) && now.getHours() * 60 + now.getMinutes() < minutesOf(lesson.end));
      element.classList.toggle('current', isCurrent);
    });
  }

  function renderCalendar() {
    const group = activeGroup();
    const days = getCurrentWeekDays(group);
    const visibleIndexes = currentView === 'day' ? [activeDay] : [0, 1, 2, 3, 4, 5, 6];
    const timeColumn = $('time-column');
    timeColumn.innerHTML = Array.from({ length: 11 }, (_, i) => `<div class="time-label">${String(8 + i).padStart(2, '0')}:00</div>`).join('');
    const now = getNow();
    const todayKey = dateKey(now);
    const cols = visibleIndexes.map(index => {
      const day = days[index];
      if (!day) return '';
      const visibleLessons = day.lessons.filter(matchesSearch);
      const events = visibleLessons.map(lesson => {
        const start = minutesOf(lesson.start);
        const end = minutesOf(lesson.end);
        const top = Math.max(0, (start - TIMELINE_START) * PIXELS_PER_MINUTE);
        const height = Math.max(36, (end - start) * PIXELS_PER_MINUTE - 2);
        const room = lesson.room === null ? 'Дистант' : `ауд. ${lesson.room}`;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const isCurrent = day.date === todayKey && nowMinutes >= start && nowMinutes < end;
        const isDone = day.date < todayKey || (day.date === todayKey && nowMinutes >= end);
        return `<button type="button" class="week-event ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}" data-open="${escapeHtml(lesson.id)}" data-lesson="${escapeHtml(lesson.id)}" data-date="${escapeHtml(day.date)}" style="--event-color:${escapeHtml(lesson.color)};top:${top}px;height:${height}px" title="${escapeHtml(lesson.subject)} · ${escapeHtml(lesson.start)}–${escapeHtml(lesson.end)}">
          <span class="event-time">${escapeHtml(lesson.start)}–${escapeHtml(lesson.end)}</span><span class="event-title">${escapeHtml(lesson.subject)}</span><span class="event-room">${escapeHtml(room)}</span>
        </button>`;
      }).join('');
      const dayIsToday = day.date === todayKey;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const timeLine = dayIsToday && nowMinutes >= TIMELINE_START && nowMinutes <= TIMELINE_END ? `<div class="current-time-line" style="top:${(nowMinutes - TIMELINE_START) * PIXELS_PER_MINUTE}px"></div>` : '';
      const empty = visibleLessons.length ? '' : `<div class="empty-column">${searchTerm ? 'Нет совпадений' : 'Нет занятий'}</div>`;
      return `<div class="calendar-day-column ${index === activeDay ? 'selected' : ''} ${dayIsToday ? 'today-column' : ''}" data-date="${escapeHtml(day.date)}">${events}${timeLine}${empty}</div>`;
    }).join('');
    $('day-columns').style.gridTemplateColumns = `repeat(${visibleIndexes.length}, minmax(0, 1fr))`;
    $('day-columns').innerHTML = cols;
    $('calendar-grid').style.gridTemplateColumns = '45px minmax(0, 1fr)';
    $('calendar-grid').style.minWidth = currentView === 'day' ? '350px' : '720px';
    $('calendar-scroll').classList.toggle('day-view', currentView === 'day');
    $('calendar-scroll').scrollTop = 0;
    $('week-days').style.opacity = currentView === 'day' ? '1' : '1';
  }

  function renderStats() {
    const days = getCurrentWeekDays(activeGroup());
    const lessons = days.flatMap(day => day.lessons);
    const totalMinutes = lessons.reduce((sum, lesson) => sum + durationMinutes(lesson), 0);
    $('stat-lessons').textContent = lessons.length;
    $('stat-hours').textContent = (totalMinutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
    $('stat-date-range').textContent = getWeekLabel();
  }

  function updateFavorite() {
    const isFavorite = safeStorage.get(KEYS.favorite, '') === activeGroup().name;
    $('fav-btn').setAttribute('aria-pressed', String(isFavorite));
    $('fav-btn').querySelector('span').textContent = isFavorite ? '★' : '☆';
    $('fav-btn').title = isFavorite ? 'Убрать группу из избранного' : 'Добавить группу в избранное';
  }

  function renderAll() {
    currentSchedule();
    updateGroupSelector();
    updateWeekHeading();
    renderCalendar();
    renderDay(activeDay);
    renderStats();
    renderTimer();
    updateFavorite();
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function openLessonModal(lesson) {
    const day = getCurrentWeekDays()[activeDay];
    editingLessonId = lesson ? lesson.id : null;
    editingLessonDay = lesson ? activeDay : null;
    $('modal-title').textContent = lesson ? 'Изменить занятие' : 'Добавить занятие';
    $('modal-eyebrow').textContent = lesson ? 'РЕДАКТИРОВАНИЕ' : 'НОВОЕ ЗАНЯТИЕ';
    $('lesson-id').value = lesson ? lesson.id : '';
    $('lesson-subject').value = lesson ? lesson.subject : '';
    $('lesson-day').innerHTML = getCurrentWeekDays().map((item, index) => `<option value="${index}">${DAY_SHORT[index]} · ${formatDate(parseLocalDate(item.date), { day: 'numeric', month: 'short' })}</option>`).join('');
    $('lesson-day').value = lesson ? String(activeDay) : String(activeDay);
    $('lesson-badge').value = lesson ? lesson.badge : '1';
    $('lesson-start').value = lesson ? lesson.start : '08:30';
    $('lesson-end').value = lesson ? lesson.end : '10:00';
    $('lesson-teacher').value = lesson ? lesson.teacher : '';
    $('lesson-room').value = lesson && lesson.room !== null ? lesson.room : '';
    $('lesson-delete').hidden = !lesson;
    $('modal-backdrop').hidden = false;
    $('lesson-subject').focus();
  }
  function closeLessonModal() { $('modal-backdrop').hidden = true; editingLessonId = null; editingLessonDay = null; }
  function saveLesson(event) {
    event.preventDefault();
    const subject = $('lesson-subject').value.trim();
    const start = $('lesson-start').value;
    const end = $('lesson-end').value;
    if (!subject || !start || !end || minutesOf(end) <= minutesOf(start)) {
      showToast('Проверь предмет и время окончания пары');
      return;
    }
    const group = activeGroup();
    const days = getCurrentWeekDays(group);
    const targetDayIndex = Number($('lesson-day').value);
    const lesson = {
      id: editingLessonId || `custom-${Date.now()}`,
      badge: $('lesson-badge').value,
      start,
      end,
      subject,
      teacher: $('lesson-teacher').value.trim(),
      room: $('lesson-room').value.trim() || null,
      color: subjectColor(subject)
    };
    if (editingLessonId && editingLessonDay !== null) {
      const sourceDay = days[editingLessonDay];
      sourceDay.lessons = sourceDay.lessons.filter(item => item.id !== editingLessonId);
    }
    const targetDay = days[targetDayIndex];
    if (targetDay.lessons.some(item => item.id !== lesson.id && start < item.end && end > item.start)) {
      showToast('В это время уже есть занятие — проверь пересечение');
      if (editingLessonId && editingLessonDay !== null) {
        days[editingLessonDay].lessons.push(lesson);
        days[editingLessonDay].lessons.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
      }
      return;
    }
    targetDay.lessons.push(lesson);
    targetDay.lessons.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    activeDay = targetDayIndex;
    saveGroups();
    closeLessonModal();
    renderAll();
    showToast(editingLessonId ? 'Занятие обновлено' : 'Занятие добавлено в расписание');
  }
  function subjectColor(subject) {
    const text = subject.toLowerCase();
    if (text.includes('дизайн')) return '#C4B478';
    if (text.includes('эконом')) return '#C478C2';
    if (text.includes('физ')) return '#78B5C4';
    if (text.includes('веб') || text.includes('программ')) return '#7C9BCE';
    if (text.includes('практик')) return '#7BAA91';
    return '#8C9AD0';
  }

  function openGroupModal() {
    $('group-modal-backdrop').hidden = false;
    $('group-name').value = '';
    $('group-name').focus();
  }
  function closeGroupModal() { $('group-modal-backdrop').hidden = true; }
  function createGroup(event) {
    event.preventDefault();
    const name = $('group-name').value.trim();
    if (!name) return;
    if (groups.some(group => group.name.toLowerCase() === name.toLowerCase())) {
      showToast('Такая группа уже есть');
      return;
    }
    const id = `group-${Date.now()}`;
    const newGroup = { id, name, color: '#8E9ACB', weeks: { [dateKey(selectedWeekStart)]: makeEmptyWeek(selectedWeekStart) } };
    groups.push(newGroup);
    activeGroupId = id;
    safeStorage.set('kitis-de:active-group', id);
    saveGroups();
    closeGroupModal();
    renderAll();
    showToast(`Группа ${name} создана`);
  }

  function switchGroup(id) {
    if (!groups.some(group => group.id === id)) return;
    activeGroupId = id;
    safeStorage.set('kitis-de:active-group', id);
    renderAll();
  }
  function changeWeek(amount) {
    selectedWeekStart = addDays(selectedWeekStart, amount * 7);
    activeDay = 0;
    renderAll();
    showToast(getCurrentWeekDays().some(day => day.lessons.length) ? 'Неделя загружена' : 'Для этой недели пока нет занятий');
  }
  function goToday() {
    selectedWeekStart = mondayOf(new Date());
    activeDay = (new Date().getDay() + 6) % 7;
    renderAll();
  }

  function exportCalendar() {
    const group = activeGroup();
    const days = getCurrentWeekDays(group);
    const formatIcsDate = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
    const escapeIcs = value => String(value || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
    const events = days.flatMap(day => day.lessons.map(lesson => {
      const stamp = Date.now();
      return [
        'BEGIN:VEVENT',
        `UID:${escapeIcs(lesson.id)}-${escapeIcs(day.date)}@kitis.local`,
        `DTSTAMP:${new Date(stamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
        `DTSTART:${formatIcsDate(day.date, lesson.start)}`,
        `DTEND:${formatIcsDate(day.date, lesson.end)}`,
        `SUMMARY:${escapeIcs(lesson.subject)}`,
        `DESCRIPTION:${escapeIcs(lesson.teacher)}`,
        `LOCATION:${escapeIcs(lesson.room === null ? 'Дистант' : lesson.room)}`,
        'END:VEVENT'
      ].join('\r\n');
    }));
    const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KITIS//Schedule//RU', `X-WR-CALNAME:${escapeIcs(group.name)}`, ...events, 'END:VCALENDAR'].join('\r\n');
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${group.name.replace(/[^\wА-Яа-яЁё-]/g, '_')}-${dateKey(selectedWeekStart)}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Файл календаря подготовлен');
  }

  const ACCENTS = {
    blue: { primary: '#3567e8', strong: '#2855ce' },
    sky: { primary: '#159bd7', strong: '#087daf' },
    azure: { primary: '#2588f4', strong: '#176bc9' },
    indigo: { primary: '#6865e8', strong: '#504bd0' },
    cobalt: { primary: '#174fc5', strong: '#103d9c' },
    sapphire: { primary: '#123e82', strong: '#0c2e63' },
    graphite: { primary: '#4e596b', strong: '#384252' }
  };
  let appearance = ['light', 'dark'].includes(safeStorage.get(KEYS.theme, 'light')) ? safeStorage.get(KEYS.theme, 'light') : 'light';
  let accent = Object.prototype.hasOwnProperty.call(ACCENTS, safeStorage.get(KEYS.accent, 'blue')) ? safeStorage.get(KEYS.accent, 'blue') : 'blue';
  let surface = ['clean', 'soft'].includes(safeStorage.get(KEYS.surface, 'clean')) ? safeStorage.get(KEYS.surface, 'clean') : 'clean';

  function applyAppearance() {
    const dark = appearance === 'dark';
    const colors = ACCENTS[accent] || ACCENTS.blue;
    document.body.classList.toggle('dark', dark);
    document.body.dataset.theme = appearance;
    document.body.dataset.surface = surface;
    document.body.style.setProperty('--primary', colors.primary);
    document.body.style.setProperty('--primary-strong', colors.strong);
    document.body.style.setProperty('--primary-soft', `color-mix(in srgb, ${colors.primary} 11%, var(--surface))`);
    $('theme-icon').textContent = dark ? '☀' : '☾';
    $('theme-toggle').title = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
    $('theme-toggle').setAttribute('aria-label', $('theme-toggle').title);
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === appearance)));
    document.querySelectorAll('[data-accent-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.accentChoice === accent)));
    document.querySelectorAll('[data-surface-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.surfaceChoice === surface)));
    $('surface-clean-label').textContent = dark ? 'Чёрная' : 'Белая';
    $('surface-soft-label').textContent = dark ? 'Графитовая' : 'Светло-серая';
    $('surface-hint').textContent = dark ? 'Глубокий чёрный или графит' : 'Белая или мягко-серая';
    const themeColor = dark ? (surface === 'clean' ? '#080a0f' : '#151a24') : (surface === 'clean' ? '#ffffff' : '#f2f5fa');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', themeColor);
  }
  function persistAppearance() {
    safeStorage.set(KEYS.theme, appearance);
    safeStorage.set(KEYS.accent, accent);
    safeStorage.set(KEYS.surface, surface);
    applyAppearance();
  }
  function initTheme() { applyAppearance(); }
  function toggleTheme() {
    appearance = appearance === 'dark' ? 'light' : 'dark';
    persistAppearance();
  }
  function openSettings() {
    $('settings-backdrop').hidden = false;
    applyAppearance();
  }
  function closeSettings() { $('settings-backdrop').hidden = true; }
  function resetSettings() {
    appearance = 'light'; accent = 'blue'; surface = 'clean';
    persistAppearance();
    showToast('Оформление сброшено');
  }

  function updateLiveDate() {
    const now = new Date();
    $('live-date').textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(now);
  }
  function initDemoDate() {
    if (isDemoTime) {
      selectedWeekStart = mondayOf(demoTime);
      activeDay = (demoTime.getDay() + 6) % 7;
    }
  }
  function tryFetchJson() {
    if (!('fetch' in window) || window.location.protocol === 'file:') {
      $('data-status').textContent = 'Встроенные данные · offline';
      return;
    }
    const dataPath = window.location.pathname.includes('/steps/') ? '../../data/schedule.json' : 'data/schedule.json';
    fetch(dataPath).then(response => {
      if (!response.ok) throw new Error('Не удалось получить JSON');
      return response.json();
    }).then(data => {
      if (!data || !Array.isArray(data.days)) throw new Error('Неверный формат JSON');
      $('data-status').textContent = 'JSON загружен';
      // Используем JSON только для исходной учебной группы и не затираем локальные изменения.
      const seed = groups.find(group => group.id === 'group-isr24-1');
      if (seed && !safeStorage.get(KEYS.groups, null)) {
        seed.weeks[dateKey(defaultWeekStart)] = normaliseWeek(data.days, defaultWeekStart);
        saveGroups();
        if (activeGroupId === seed.id && dateKey(selectedWeekStart) === dateKey(defaultWeekStart)) renderAll();
      }
    }).catch(() => {
      $('data-status').textContent = 'Локальные данные · резерв';
    });
  }

  // Events
  dayButtons.forEach(button => button.addEventListener('click', () => {
    activeDay = Number(button.dataset.day);
    renderAll();
  }));
  document.querySelectorAll('.view-button').forEach(button => button.addEventListener('click', () => {
    currentView = button.dataset.view;
    document.querySelectorAll('.view-button').forEach(item => item.classList.toggle('active', item === button));
    renderCalendar();
  }));
  $('group-select').addEventListener('change', event => switchGroup(event.target.value));
  $('schedule-search').addEventListener('input', event => {
    searchTerm = event.target.value.trim().toLocaleLowerCase('ru-RU');
    renderCalendar();
    renderDay(activeDay);
  });
  $('group-list').addEventListener('click', event => {
    const button = event.target.closest('[data-group]');
    if (button) switchGroup(button.dataset.group);
  });
  $('week-prev').addEventListener('click', () => changeWeek(-1));
  $('week-next').addEventListener('click', () => changeWeek(1));
  $('go-today').addEventListener('click', goToday);
  $('fav-btn').addEventListener('click', () => {
    if (safeStorage.get(KEYS.favorite, '') === activeGroup().name) safeStorage.remove(KEYS.favorite);
    else safeStorage.set(KEYS.favorite, activeGroup().name);
    updateFavorite();
    updateGroupSelector();
    showToast(safeStorage.get(KEYS.favorite, '') === activeGroup().name ? 'Группа добавлена в избранное' : 'Группа удалена из избранного');
  });
  $('app').addEventListener('click', event => {
    const editButton = event.target.closest('[data-edit]');
    if (editButton) {
      const lesson = getCurrentWeekDays()[activeDay].lessons.find(item => item.id === editButton.dataset.edit);
      if (lesson) openLessonModal(lesson);
    }
  });
  $('day-columns').addEventListener('click', event => {
    const eventButton = event.target.closest('[data-open]');
    if (!eventButton) return;
    const date = eventButton.dataset.date;
    const week = getCurrentWeekDays();
    const index = week.findIndex(day => day.date === date);
    if (index >= 0) {
      activeDay = index;
      const lesson = week[index].lessons.find(item => item.id === eventButton.dataset.open);
      renderAll();
      if (lesson) openLessonModal(lesson);
    }
  });
  $('open-add-lesson').addEventListener('click', () => openLessonModal(null));
  $('modal-close').addEventListener('click', closeLessonModal);
  $('modal-cancel').addEventListener('click', closeLessonModal);
  $('modal-backdrop').addEventListener('click', event => { if (event.target === $('modal-backdrop')) closeLessonModal(); });
  $('lesson-form').addEventListener('submit', saveLesson);
  $('lesson-delete').addEventListener('click', () => {
    if (!editingLessonId || editingLessonDay === null) return;
    const days = getCurrentWeekDays();
    days[editingLessonDay].lessons = days[editingLessonDay].lessons.filter(lesson => lesson.id !== editingLessonId);
    saveGroups();
    closeLessonModal();
    renderAll();
    showToast('Занятие удалено');
  });
  $('add-group').addEventListener('click', openGroupModal);
  $('group-modal-close').addEventListener('click', closeGroupModal);
  $('group-cancel').addEventListener('click', closeGroupModal);
  $('group-modal-backdrop').addEventListener('click', event => { if (event.target === $('group-modal-backdrop')) closeGroupModal(); });
  $('group-form').addEventListener('submit', createGroup);
  $('export-ics').addEventListener('click', exportCalendar);
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('settings-open').addEventListener('click', openSettings);
  $('settings-open-sidebar').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-backdrop').addEventListener('click', event => { if (event.target === $('settings-backdrop')) closeSettings(); });
  $('settings-reset').addEventListener('click', resetSettings);
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
    appearance = button.dataset.themeChoice; persistAppearance();
  }));
  document.querySelectorAll('[data-surface-choice]').forEach(button => button.addEventListener('click', () => {
    surface = button.dataset.surfaceChoice; persistAppearance();
  }));
  document.querySelectorAll('[data-accent-choice]').forEach(button => button.addEventListener('click', () => {
    accent = button.dataset.accentChoice; persistAppearance();
  }));
  $('mobile-menu').addEventListener('click', () => { document.body.classList.add('menu-open'); $('mobile-overlay').classList.add('visible'); });
  $('mobile-overlay').addEventListener('click', () => { document.body.classList.remove('menu-open'); $('mobile-overlay').classList.remove('visible'); });
  document.querySelectorAll('[data-nav]').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('[data-nav]').forEach(item => item.classList.toggle('active', item === link));
    if (link.dataset.nav === 'groups') $('group-select').focus();
    if (link.dataset.nav === 'calendar') $('calendar').scrollIntoView({ behavior: 'smooth' });
    document.body.classList.remove('menu-open'); $('mobile-overlay').classList.remove('visible');
  }));

  // Start: use ?now=... for a predictable demo. Without it the page opens Monday,
  // as required by the course contract, while the top clock and timer use real time.
  initDemoDate();
  if (!groups.some(group => group.id === activeGroupId)) activeGroupId = groups[0].id;
  initTheme();
  renderAll();
  updateLiveDate();
  setInterval(() => {
    updateLiveDate();
    renderTimer();
  }, 1000);
  tryFetchJson();
})();
