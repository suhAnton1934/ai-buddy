// Отдельный модуль интерфейса наставника. Не трогает логику AI-чата.
// Роли в MVP демонстрационные: в проекте пока нет авторизации.
(() => {
    "use strict";
    const USER_ID = 1;
    const byId = id => document.getElementById(id);
    const layout = byId("app-layout");
    const mentorView = byId("mentor-view");
    const questionsView = byId("questions-view");
    const mentorTaskList = byId("mentor-task-list");
    const mentorQuestionList = byId("mentor-question-list");
    const studentQuestionList = byId("student-question-list");

    function todayISO() {
        const today = new Date();
        const n = value => String(value).padStart(2, "0");
        return `${today.getFullYear()}-${n(today.getMonth() + 1)}-${n(today.getDate())}`;
    }

    function dueLabel(dateString, status) {
        if (!dateString) return null;
        if (status === "completed") return { text: `Срок: ${formatDate(dateString)}`, type: "done" };
        const today = todayISO();
        if (dateString < today) return { text: `Просрочено · ${formatDate(dateString)}`, type: "overdue" };
        if (dateString === today) return { text: "Дедлайн сегодня", type: "soon" };
        return { text: `До ${formatDate(dateString)}`, type: "normal" };
    }

    function formatDate(dateString) {
        const [year, month, day] = dateString.split("-");
        return `${day}.${month}.${year}`;
    }

    // Для оповещений используем уже существующий toast, если он есть.
    function notify(text) {
        const toast = byId("toast");
        if (!toast) return;
        toast.textContent = text;
        toast.hidden = false;
        clearTimeout(notify.timer);
        notify.timer = setTimeout(() => { toast.hidden = true; }, 3500);
    }

    async function api(path, options) {
        const response = await fetch(path, options);
        let data;
        try { data = await response.json(); }
        catch (_) { throw new Error("Некорректный ответ сервера"); }
        if (!response.ok) throw new Error(data.error || "Сервис временно недоступен");
        return data;
    }

    function jsonPost(body) {
        return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    }

    function node(tag, className, text) {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (text !== undefined) item.textContent = String(text);
        return item;
    }

    function renderMentorTasks(tasks) {
        mentorTaskList.replaceChildren();
        const completed = tasks.filter(task => task.status === "completed").length;
        const overdue = tasks.filter(task => task.status !== "completed" && task.due_date && task.due_date < todayISO()).length;
        byId("mentor-total").textContent = String(tasks.length);
        byId("mentor-completed").textContent = String(completed);
        byId("mentor-overdue").textContent = String(overdue);
        if (!tasks.length) {
            mentorTaskList.appendChild(node("div", "mentor-empty", "Пока нет назначенных задач"));
            return;
        }
        for (const task of tasks) {
            const item = node("article", "mentor-item");
            item.appendChild(node("strong", "", task.title));
            if (task.description) item.appendChild(node("p", "", task.description));
            const meta = node("div", "mentor-meta");
            meta.appendChild(node("span", `mentor-tag ${task.status === "completed" ? "done" : ""}`, task.status === "completed" ? "Выполнена" : "В работе"));
            const due = dueLabel(task.due_date, task.status);
            if (due) meta.appendChild(node("span", `mentor-tag ${due.type}`, due.text));
            item.appendChild(meta);
            mentorTaskList.appendChild(item);
        }
    }

    function renderStudentQuestions(questions) {
        studentQuestionList.replaceChildren();
        if (!questions.length) {
            studentQuestionList.appendChild(node("div", "mentor-empty", "Здесь появятся твои вопросы и ответы наставника"));
            return;
        }
        for (const question of questions) {
            const card = node("article", "mentor-item question-thread");
            card.appendChild(node("span", "thread-caption", `Обращение №${question.id} · ${question.status === "answered" ? "Есть ответ" : "Ожидает ответа"}`));
            card.appendChild(node("div", "thread-my", question.text));
            if (question.reply) {
                card.appendChild(node("span", "thread-caption", "Наставник ответил"));
                card.appendChild(node("div", "thread-reply", question.reply));
            }
            studentQuestionList.appendChild(card);
        }
    }

    function renderMentorQuestions(questions) {
        mentorQuestionList.replaceChildren();
        if (!questions.length) {
            mentorQuestionList.appendChild(node("div", "mentor-empty", "Вопросов от стажёра пока нет"));
            return;
        }
        for (const question of questions) {
            const card = node("article", "mentor-item");
            card.appendChild(node("span", "mentor-tag", question.status === "answered" ? "Отвечено" : "Ожидает ответа"));
            card.appendChild(node("p", "", question.text));
            if (question.reply) {
                card.appendChild(node("span", "mentor-subtitle", "Предыдущий ответ:"));
                card.appendChild(node("p", "", question.reply));
            }
            const form = node("form", "mentor-reply");
            const replyField = node("textarea");
            replyField.placeholder = "Написать ответ стажёру...";
            replyField.maxLength = 2000;
            replyField.required = true;
            replyField.setAttribute("aria-label", `Ответ на обращение ${question.id}`);
            const submit = node("button", "button button-primary", question.reply ? "Обновить ответ" : "Ответить");
            submit.type = "submit";
            form.append(replyField, submit);
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (!replyField.value.trim()) return;
                submit.disabled = true;
                try {
                    await api(`/mentor/questions/${question.id}/reply`, jsonPost({ reply: replyField.value.trim() }));
                    notify("Ответ отправлен стажёру");
                    await loadQuestions();
                } catch (error) {
                    notify(error.message);
                    submit.disabled = false;
                }
            });
            card.appendChild(form);
            mentorQuestionList.appendChild(card);
        }
    }

    async function loadMentorTasks() {
        try {
            const data = await api(`/mentor/tasks?user_id=${USER_ID}`);
            renderMentorTasks(data.tasks);
            document.dispatchEvent(new CustomEvent("ai-buddy:mentor-tasks-loaded", { detail: { tasks: data.tasks } }));
        } catch (error) {
            mentorTaskList.textContent = error.message;
        }
    }

    async function loadQuestions() {
        try {
            const data = await api(`/mentor/questions?user_id=${USER_ID}`);
            renderMentorQuestions(data.questions);
            renderStudentQuestions(data.questions);
            document.dispatchEvent(new CustomEvent("ai-buddy:mentor-questions-loaded", { detail: { questions: data.questions } }));
        } catch (error) {
            mentorQuestionList.textContent = error.message;
            studentQuestionList.textContent = error.message;
        }
    }

    function openMentorPage(section) {
        layout.classList.remove("view-home", "view-tasks", "view-chat", "view-profile", "view-mentor", "view-questions");
        layout.classList.add(`view-${section}`);
        byId("profile-view").hidden = true;
        mentorView.hidden = section !== "mentor";
        questionsView.hidden = section !== "questions";
        document.querySelectorAll(".nav-link").forEach(button => {
            const active = button.dataset.mentorView === section;
            button.classList.toggle("active", active);
            if (active) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
        });
        const title = section === "mentor" ? "Кабинет наставника" : "Вопросы наставнику";
        const description = section === "mentor"
            ? "Назначение задач, дедлайны и обращения стажёра · демонстрационная роль"
            : "Если AI-buddy не нашёл ответ, здесь можно обратиться к наставнику.";
        byId("page-title").textContent = title;
        byId("page-description").textContent = description;
        byId("breadcrumb-current").textContent = section === "mentor" ? "Наставник" : "Вопросы";
        document.documentElement.scrollTop = 0;
        if (section === "mentor") loadMentorTasks();
        loadQuestions();
    }

    document.querySelectorAll("[data-mentor-view]").forEach(button => {
        button.addEventListener("click", () => openMentorPage(button.dataset.mentorView));
    });

    // Обычные кнопки уже привязаны в app.js: только закрываем наши страницы.
    document.querySelectorAll("[data-view]").forEach(button => {
        button.addEventListener("click", () => {
            layout.classList.remove("view-mentor", "view-questions");
            mentorView.hidden = true;
            questionsView.hidden = true;
        });
    });

    const escalate = byId("escalate-question");
    if (escalate) escalate.addEventListener("click", () => {
        const lastQuestion = [...document.querySelectorAll("#messages .message.user")].at(-1);
        const questionField = byId("student-question-text");
        if (lastQuestion && questionField) questionField.value = lastQuestion.textContent.trim().slice(0, 2000);
        openMentorPage("questions");
        questionField?.focus();
    });

    byId("mentor-task-form")?.addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        const body = {
            user_id: USER_ID,
            title: byId("mentor-task-title").value.trim(),
            description: byId("mentor-task-description").value.trim(),
            due_date: byId("mentor-task-due").value || null
        };
        submit.disabled = true;
        try {
            await api("/mentor/tasks", jsonPost(body));
            form.reset();
            notify("Задача назначена стажёру и сохранена в базе");
            await loadMentorTasks();
            // Сообщаем основному интерфейсу, что задачи изменились.
            document.dispatchEvent(new Event("ai-buddy:tasks-changed"));
        } catch (error) {
            notify(error.message);
        } finally {
            submit.disabled = false;
        }
    });

    byId("student-question-form")?.addEventListener("submit", async event => {
        event.preventDefault();
        const field = byId("student-question-text");
        const submit = event.currentTarget.querySelector('button[type="submit"]');
        if (!field.value.trim()) return;
        submit.disabled = true;
        try {
            await api("/mentor/questions", jsonPost({ user_id: USER_ID, text: field.value.trim() }));
            field.value = "";
            notify("Вопрос передан наставнику");
            await loadQuestions();
        } catch (error) {
            notify(error.message);
        } finally {
            submit.disabled = false;
        }
    });

    byId("mentor-refresh")?.addEventListener("click", () => { loadMentorTasks(); loadQuestions(); });
    byId("questions-refresh")?.addEventListener("click", loadQuestions);
})();
