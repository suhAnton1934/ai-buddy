/* AI-buddy: отдельные UI-фичи поверх существующих Flask API.
 * Не изменяет базу, не отправляет сообщения AI и не обращается к LLM.
 */
(() => {
    "use strict";

    const byId = id => document.getElementById(id);
    const dayList = byId("my-day-list");
    const dayDate = byId("my-day-date");
    const daySummary = byId("my-day-summary");
    const attentionList = byId("mentor-attention-list");
    const attentionSummary = byId("mentor-attention-summary");
    const attentionCount = byId("mentor-attention-count");
    let mentorTasks = null;
    let mentorQuestions = null;

    function todayISO() {
        const date = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function dayNumber(iso) {
        if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
        const [y, m, d] = iso.split("-").map(Number);
        const utc = Date.UTC(y, m - 1, d);
        const date = new Date(utc);
        if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return null;
        return Math.round(utc / 86400000);
    }

    function daysLeft(iso) {
        const due = dayNumber(iso);
        const current = dayNumber(todayISO());
        return due === null || current === null ? null : due - current;
    }

    function formatDate(iso) {
        if (dayNumber(iso) === null) return "Без срока";
        const [year, month, day] = iso.split("-");
        return `${day}.${month}.${year}`;
    }

    function node(tag, css, text) {
        const el = document.createElement(tag);
        if (css) el.className = css;
        if (text !== undefined) el.textContent = String(text);
        return el;
    }

    function statusLabel(task) {
        const days = daysLeft(task.due_date);
        if (days === null) return { text: "Без дедлайна", css: "neutral" };
        if (days < 0) return { text: `Просрочено на ${Math.abs(days)} дн.`, css: "danger" };
        if (days === 0) return { text: "Срок сегодня", css: "warning" };
        if (days === 1) return { text: "Срок завтра", css: "warning" };
        return { text: `До ${formatDate(task.due_date)}`, css: "neutral" };
    }

    function sortedOpenTasks(tasks) {
        return tasks.filter(t => t && t.status !== "completed")
            .sort((a, b) => {
                const aDays = daysLeft(a.due_date);
                const bDays = daysLeft(b.due_date);
                if (aDays === null && bDays !== null) return 1;
                if (bDays === null && aDays !== null) return -1;
                if (aDays !== null && bDays !== null && aDays !== bDays) return aDays - bDays;
                return String(a.title || "").localeCompare(String(b.title || ""), "ru");
            });
    }

    function renderMyDay(tasks) {
        if (!dayList) return;
        const open = sortedOpenTasks(tasks);
        const overdue = open.filter(t => daysLeft(t.due_date) !== null && daysLeft(t.due_date) < 0).length;
        const today = open.filter(t => daysLeft(t.due_date) === 0).length;
        if (dayDate) dayDate.textContent = new Intl.DateTimeFormat("ru-RU", {
            day: "numeric", month: "long", weekday: "long"
        }).format(new Date());
        if (daySummary) {
            daySummary.textContent = open.length === 0 ? "Все задачи выполнены" :
                `${open.length} в работе · ${today} на сегодня · ${overdue} просрочено`;
        }
        dayList.replaceChildren();
        if (!open.length) {
            dayList.appendChild(node("div", "productivity-empty", "На сегодня всё готово. Отличная работа!"));
            return;
        }
        for (const task of open.slice(0, 3)) {
            const item = node("article", "day-item");
            const left = node("div", "day-item-content");
            left.append(node("strong", "", task.title || "Без названия"));
            const badge = statusLabel(task);
            left.append(node("span", `day-deadline ${badge.css}`, badge.text));
            const go = node("button", "day-task-button", "К задаче →");
            go.type = "button";
            go.setAttribute("aria-label", `Перейти к задаче: ${task.title || "Без названия"}`);
            go.addEventListener("click", () => {
                document.querySelector('.nav-link[data-view="tasks"]')?.click();
                const search = byId("task-search");
                if (search) {
                    search.value = String(task.title || "");
                    search.dispatchEvent(new Event("input", { bubbles: true }));
                }
                document.querySelector('[data-task-filter="all"]')?.click();
            });
            item.append(left, go);
            dayList.appendChild(item);
        }
    }

    function renderAttention() {
        if (!attentionList) return;
        attentionList.replaceChildren();
        if (mentorTasks === null || mentorQuestions === null) {
            if (attentionSummary) attentionSummary.textContent = "Загружаем данные...";
            return;
        }
        const open = sortedOpenTasks(mentorTasks);
        const overdue = open.filter(t => {
            const days = daysLeft(t.due_date);
            return days !== null && days < 0;
        });
        const soon = open.filter(t => {
            const days = daysLeft(t.due_date);
            return days !== null && days >= 0 && days <= 2;
        });
        const unanswered = mentorQuestions.filter(q => q && q.status !== "answered" && !q.reply);
        const total = overdue.length + soon.length + unanswered.length;
        if (attentionCount) attentionCount.textContent = String(total);
        if (attentionSummary) attentionSummary.textContent = total
            ? `${total} пунктов требуют внимания` : "Срочных задач и вопросов нет";
        if (!total) {
            attentionList.appendChild(node("p", "productivity-empty", "Все обращения разобраны, ближайших просрочек нет."));
            return;
        }
        for (const task of overdue.slice(0, 3)) {
            attentionList.appendChild(attentionItem("Просрочена задача", task.title, "danger"));
        }
        for (const task of soon.slice(0, 3)) {
            attentionList.appendChild(attentionItem(daysLeft(task.due_date) === 0 ? "Дедлайн сегодня" : "Скоро дедлайн", task.title, "warning"));
        }
        for (const q of unanswered.slice(0, 3)) {
            attentionList.appendChild(attentionItem("Нет ответа наставника", q.text, "question"));
        }
        if (total > 9) attentionList.appendChild(node("p", "attention-more", `И ещё ${total - 9} пунктов ниже в кабинете.`));
    }

    function attentionItem(tag, title, type) {
        const item = node("div", "attention-item");
        item.append(node("span", `attention-tag ${type}`, tag));
        item.append(node("p", "", title || "Без названия"));
        return item;
    }

    document.addEventListener("ai-buddy:tasks-loaded", event => {
        if (Array.isArray(event.detail?.tasks)) renderMyDay(event.detail.tasks);
    });
    document.addEventListener("ai-buddy:mentor-tasks-loaded", event => {
        if (!Array.isArray(event.detail?.tasks)) return;
        mentorTasks = event.detail.tasks;
        renderAttention();
    });
    document.addEventListener("ai-buddy:mentor-questions-loaded", event => {
        if (!Array.isArray(event.detail?.questions)) return;
        mentorQuestions = event.detail.questions;
        renderAttention();
    });
})();
