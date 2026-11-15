// AI-buddy frontend: серверные задачи + локальный демонстрационный профиль.
// Для совместимости сохраняем существующие маршруты Flask.
const USER_ID = 1;
const PROFILE_STORAGE_KEY = "ai-buddy.demo-profile.v1";

const tasksList = document.getElementById("tasks-list");
const progressPercent = document.getElementById("progress-percent");
const progressBar = document.getElementById("progress-bar");
const progressDescription = document.getElementById("progress-description");
const taskCount = document.getElementById("task-count");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendButton = document.getElementById("send-button");

let allTasks = [];
let activeFilter = "all";
let searchQuery = "";
let toastTimer = null;

const DEFAULT_PROFILE = {
    name: "Стажёр",
    role: "Не указана",
    team: "Не указана",
    stage: "Первая неделя",
    notes: ""
};

function element(id) {
    return document.getElementById(id);
}

function readProfile() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
            const profile = { ...DEFAULT_PROFILE };
            for (const key of Object.keys(DEFAULT_PROFILE)) {
                if (typeof saved[key] === "string") {
                    profile[key] = saved[key].slice(0, key === "notes" ? 2000 : 80);
                }
            }
            return profile;
        }
    } catch (_) {
        // Сайт продолжает работать, если localStorage недоступен.
    }
    return { ...DEFAULT_PROFILE };
}

let profile = readProfile();

function setText(id, value) {
    const target = element(id);
    if (target) target.textContent = value;
}

function getInitial(name) {
    return (name.trim().charAt(0) || "С").toLocaleUpperCase("ru-RU");
}

function refreshProfile() {
    setText("sidebar-name", profile.name || "Стажёр");
    setText("sidebar-role", profile.role || "Тестовый профиль");
    setText("sidebar-avatar", getInitial(profile.name));
    setText("top-avatar", getInitial(profile.name));
    setText("profile-big-avatar", getInitial(profile.name));
    setText("profile-display-name", profile.name || "Стажёр");
    setText("greeting-name", (profile.name || "стажёр").trim().split(/\s+/)[0]);

    for (const [key, id] of Object.entries({
        name: "profile-name", role: "profile-role", team: "profile-team",
        stage: "profile-stage", notes: "profile-notes"
    })) {
        const field = element(id);
        if (field) field.value = profile[key];
    }
}

function showToast(text) {
    const toast = element("toast");
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

const pageData = {
    home: { title: "Твой старт в команде", description: "Здесь всё, что нужно для спокойной и понятной адаптации.", crumb: "Обзор" },
    tasks: { title: "Чек-лист адаптации", description: "Управляй задачами и отмечай то, что уже сделано.", crumb: "Чек-лист" },
    chat: { title: "AI-помощник", description: "Задавай вопросы и получай ответы по адаптации.", crumb: "AI-помощник" },
    profile: { title: "Мой профиль", description: "Твои данные, заметки и текущий прогресс.", crumb: "Профиль" }
};

function showView(view) {
    if (!pageData[view]) return;
    const layout = element("app-layout");
    if (layout) {
        layout.classList.remove("view-home", "view-tasks", "view-chat", "view-profile");
        layout.classList.add(`view-${view}`);
    }
    const profileView = element("profile-view");
    if (profileView) profileView.hidden = view !== "profile";

    setText("page-title", pageData[view].title);
    setText("page-description", pageData[view].description);
    setText("breadcrumb-current", pageData[view].crumb);

    document.querySelectorAll(".nav-link[data-view]").forEach(button => {
        const selected = button.dataset.view === view;
        button.classList.toggle("active", selected);
        if (selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });

    if (view === "chat" && chatInput) chatInput.focus();
    if (view === "profile") refreshProfile();
    document.documentElement.scrollTop = 0;
}

function updateProgress(tasks) {
    const total = tasks.length;
    const completed = tasks.filter(task => task.status === "completed").length;
    const pending = total - completed;
    const percent = total === 0 ? 0 : Math.round(completed / total * 100);

    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressDescription) progressDescription.textContent = `Выполнено ${completed} из ${total} задач`;
    if (taskCount) taskCount.textContent = `${total} задач`;
    setText("metric-total", String(total));
    setText("metric-completed", String(completed));
    setText("metric-pending", String(pending));
    setText("profile-progress-value", `${percent}%`);

    const bar = document.querySelector(".progress-track[role='progressbar']");
    if (bar) bar.setAttribute("aria-valuenow", String(percent));

    const nextTask = tasks.filter(task => task.status !== "completed")
        .sort((a, b) => (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31"))[0];
    setText("focus-title", nextTask ? nextTask.title : "Все задачи выполнены");
    setText("focus-description", nextTask
        ? (nextTask.due_date ? `Дедлайн: ${nextTask.due_date}` : "Твой ближайший шаг в адаптации")
        : "Отличный результат — чек-лист завершён");
    const focusAction = element("focus-action");
    if (focusAction) focusAction.disabled = !nextTask;
}

function createTaskCard(task) {
    const card = document.createElement("article");
    card.className = "task";
    if (task.status === "completed") card.classList.add("completed");

    const info = document.createElement("div");
    info.className = "task-info";
    const check = document.createElement("span");
    check.className = "task-check";
    check.textContent = task.status === "completed" ? "✓" : "○";
    check.setAttribute("aria-hidden", "true");

    const details = document.createElement("div");
    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    const status = document.createElement("div");
    status.className = "task-status";
    status.textContent = task.status === "completed" ? "Выполнено" : "Ожидает выполнения";
    details.append(title, status);
    if (task.description) {
        const desc = document.createElement("div");
        desc.className = "task-description";
        desc.textContent = task.description;
        details.appendChild(desc);
    }
    if (task.due_date) {
        const deadline = document.createElement("div");
        deadline.className = "task-deadline";
        const [year, month, day] = task.due_date.split("-");
        const today = new Date();
        const pad = number => String(number).padStart(2, "0");
        const todayDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const overdue = task.status !== "completed" && task.due_date < todayDate;
        const soon = task.status !== "completed" && task.due_date === todayDate;
        if (overdue) deadline.classList.add("is-overdue");
        if (soon) deadline.classList.add("is-soon");
        deadline.textContent = overdue ? `Просрочено · ${day}.${month}.${year}`
            : soon ? "Дедлайн сегодня" : `Дедлайн · ${day}.${month}.${year}`;
        details.appendChild(deadline);
    }

    info.append(check, details);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-button";
    button.textContent = task.status === "completed" ? "Вернуть" : "Выполнить";
    button.setAttribute("aria-label", `${button.textContent}: ${task.title}`);

    button.addEventListener("click", async () => {
        button.disabled = true;
        const newStatus = task.status === "completed" ? "pending" : "completed";
        try {
            const response = await fetch(`/tasks/${task.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });
            if (!response.ok) throw new Error("Не удалось обновить задачу");
            await loadTasks();
            showToast(newStatus === "completed" ? "Задача отмечена выполненной" : "Задача возвращена в работу");
        } catch (error) {
            button.disabled = false;
            showToast(error.message);
        }
    });
    card.append(info, button);
    return card;
}

function renderTasks(tasks = allTasks) {
    if (!tasksList) return;
    tasksList.replaceChildren();
    const filtered = tasks.filter(task => {
        const byStatus = activeFilter === "all" || task.status === activeFilter;
        const bySearch = task.title.toLocaleLowerCase("ru-RU").includes(searchQuery);
        return byStatus && bySearch;
    });
    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-tasks";
        empty.textContent = tasks.length === 0 ? "Задач пока нет" : "По этому запросу задач не найдено";
        tasksList.appendChild(empty);
        return;
    }
    for (const task of filtered) tasksList.appendChild(createTaskCard(task));
}

async function loadTasks() {
    if (!tasksList) return;
    try {
        const response = await fetch(`/users/${USER_ID}/tasks`);
        if (!response.ok) throw new Error("Не удалось загрузить задачи");
        const data = await response.json();
        if (!Array.isArray(data.tasks)) throw new Error("Некорректный ответ сервера");
        allTasks = data.tasks;
        renderTasks();
        updateProgress(allTasks);
    } catch (error) {
        tasksList.textContent = error.message;
    }
}

function addMessage(text, role, sources = []) {
    if (!messages) return;
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    const content = document.createElement("div");
    content.textContent = String(text);
    bubble.appendChild(content);

    if (role === "assistant" && Array.isArray(sources) && sources.length > 0) {
        const files = sources.map(source => typeof source === "string" ? source : source?.file)
            .filter(Boolean).slice(0, 3);
        if (files.length) {
            const footer = document.createElement("div");
            footer.className = "message-sources";
            footer.textContent = `Источники: ${files.join(", ")}`;
            bubble.appendChild(footer);
        }
    }
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
}

async function sendMessage(text) {
    const message = String(text || "").trim();
    if (!message || !sendButton || sendButton.disabled) return;
    addMessage(message, "user");
    if (chatInput) chatInput.value = "";
    sendButton.disabled = true;
    const originalButtonText = sendButton.textContent;
    sendButton.textContent = "Думает...";
    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ошибка сервера");
        addMessage(data.answer || "Ответ получен без текста", "assistant", data.sources);
        // Обновляем задачи после любого ответа: совместимо и с demo_chat,
        // и с AI-реализацией, если она не возвращает task_updated.
        await loadTasks();
    } catch (error) {
        addMessage(`Ошибка: ${error.message}`, "assistant");
    } finally {
    sendButton.disabled = false;
    sendButton.textContent = originalButtonText;
    if (chatInput) chatInput.focus();
    }
}

// События привязываются один раз при загрузке страницы.
if (chatForm) chatForm.addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(chatInput?.value || "");
});

document.querySelectorAll(".suggestion[data-message]").forEach(button => {
    button.addEventListener("click", () => sendMessage(button.dataset.message));
});

document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => showView(button.dataset.view));
});

const openChatButton = element("open-chat-button");
if (openChatButton) openChatButton.addEventListener("click", () => showView("chat"));

const taskSearch = element("task-search");
if (taskSearch) taskSearch.addEventListener("input", () => {
    searchQuery = taskSearch.value.trim().toLocaleLowerCase("ru-RU");
    renderTasks();
});

document.querySelectorAll("[data-task-filter]").forEach(button => {
    button.addEventListener("click", () => {
        activeFilter = button.dataset.taskFilter;
        document.querySelectorAll("[data-task-filter]").forEach(filterButton => {
            const selected = filterButton === button;
            filterButton.classList.toggle("selected", selected);
            filterButton.setAttribute("aria-pressed", String(selected));
        });
        renderTasks();
    });
});

const focusAction = element("focus-action");
if (focusAction) focusAction.addEventListener("click", () => {
    activeFilter = "pending";
    const filterButton = document.querySelector('[data-task-filter="pending"]');
    if (filterButton) filterButton.click();
    if (taskSearch) { taskSearch.value = ""; searchQuery = ""; }
    showView("tasks");
    renderTasks();
});

const profileToTasks = element("profile-to-tasks");
if (profileToTasks) profileToTasks.addEventListener("click", () => showView("tasks"));

const profileForm = element("profile-form");
if (profileForm) profileForm.addEventListener("submit", event => {
    event.preventDefault();
    profile = {
        name: (element("profile-name")?.value || "").trim().slice(0, 60) || "Стажёр",
        role: (element("profile-role")?.value || "").trim().slice(0, 80),
        team: (element("profile-team")?.value || "").trim().slice(0, 80),
        stage: element("profile-stage")?.value || "Первая неделя",
        notes: (element("profile-notes")?.value || "").trim().slice(0, 2000)
    };
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
        showToast("Профиль и заметки сохранены в этом браузере");
    } catch (_) {
        showToast("Не удалось сохранить в браузере. Проверь настройки хранилища.");
    }
    refreshProfile();
});

refreshProfile();
loadTasks();
document.addEventListener("ai-buddy:tasks-changed", () => {
    loadTasks();
});
