import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(
    resolve(process.cwd(), "frontend", "index.html"),
    "utf8"
);
const pageBody = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const demoTasks = [
    { id: 1, title: "Настроить Git", status: "pending" },
    { id: 2, title: "Изучить документацию", status: "completed" },
    { id: 3, title: "Познакомиться с наставником", status: "pending" }
];

function response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function setupFetch(tasks = demoTasks) {
    let currentTasks = tasks.map(task => ({ ...task }));
    const fetchMock = vi.fn(async (url, options = {}) => {
        if (options.method === "PATCH") {
            const id = Number(url.split("/").pop());
            const { status } = JSON.parse(options.body);
            currentTasks = currentTasks.map(task => task.id === id ? { ...task, status } : task);
            return response({ task: currentTasks.find(task => task.id === id) });
        }
        if (url === "/chat") {
            return response({ answer: "Ответ по базе знаний", task_updated: false, sources: [{ file: "knowledge/guide.txt" }] });
        }
        return response({ tasks: currentTasks });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = pageBody;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

test("Профиль действительно открывается из бокового меню", async () => {
    setupFetch();
    await import("../frontend/app.js");
    document.querySelector('.nav-link[data-view="profile"]').click();
    expect(document.getElementById("profile-view").hidden).toBe(false);
    expect(document.getElementById("app-layout").classList.contains("view-profile")).toBe(true);
    expect(document.getElementById("page-title").textContent).toBe("Мой профиль");
});

test("Редактирование профиля сохраняет имя, роль и заметки", async () => {
    setupFetch();
    await import("../frontend/app.js");
    document.getElementById("profile-name").value = "Ксюша";
    document.getElementById("profile-role").value = "Backend-разработчик";
    document.getElementById("profile-notes").value = "Проверить доступ к Jira";
    document.getElementById("profile-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(document.getElementById("sidebar-name").textContent).toBe("Ксюша");
    expect(document.getElementById("top-avatar").textContent).toBe("К");
    expect(document.getElementById("greeting-name").textContent).toBe("Ксюша");
    expect(JSON.parse(localStorage.getItem("ai-buddy.demo-profile.v1"))).toMatchObject({
        name: "Ксюша", role: "Backend-разработчик", notes: "Проверить доступ к Jira"
    });
});

test("Профиль восстанавливается из localStorage при загрузке", async () => {
    localStorage.setItem("ai-buddy.demo-profile.v1", JSON.stringify({
        name: "Мария", role: "Frontend", team: "Разработка", stage: "Первый месяц", notes: "Мои заметки"
    }));
    setupFetch();
    await import("../frontend/app.js");
    expect(document.getElementById("profile-display-name").textContent).toBe("Мария");
    expect(document.getElementById("profile-stage").value).toBe("Первый месяц");
    expect(document.getElementById("profile-notes").value).toBe("Мои заметки");
});

test("Поиск фильтрует реальные задачи по названию", async () => {
    setupFetch();
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelectorAll(".task")).toHaveLength(3));
    const input = document.getElementById("task-search");
    input.value = "Git";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelectorAll(".task")).toHaveLength(1);
    expect(document.getElementById("tasks-list").textContent).toContain("Настроить Git");
});

test("Фильтры различают выполненные и ожидающие задачи", async () => {
    setupFetch();
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelectorAll(".task")).toHaveLength(3));
    const completed = document.querySelector('[data-task-filter="completed"]');
    completed.click();
    expect(document.querySelectorAll(".task")).toHaveLength(1);
    expect(document.getElementById("tasks-list").textContent).toContain("Изучить документацию");
    const pending = document.querySelector('[data-task-filter="pending"]');
    pending.click();
    expect(document.querySelectorAll(".task")).toHaveLength(2);
    expect(pending.getAttribute("aria-pressed")).toBe("true");
});

test("Карточка следующего шага открывает незавершённые задачи", async () => {
    setupFetch();
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.getElementById("focus-title").textContent).toBe("Настроить Git"));
    document.getElementById("focus-action").click();
    expect(document.getElementById("app-layout").classList.contains("view-tasks")).toBe(true);
    expect(document.querySelectorAll(".task")).toHaveLength(2);
});

test("Когда все задачи выполнены, виден прогресс 100%", async () => {
    setupFetch(demoTasks.map(task => ({ ...task, status: "completed" })));
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.getElementById("progress-percent").textContent).toBe("100%"));
    expect(document.getElementById("focus-action").disabled).toBe(true);
    expect(document.getElementById("profile-progress-value").textContent).toBe("100%");
});

test("Для пустого списка показывается понятное сообщение", async () => {
    setupFetch([]);
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.getElementById("tasks-list").textContent).toContain("Задач пока нет"));
    expect(document.getElementById("progress-percent").textContent).toBe("0%");
});

test("Неизвестная задача в поиске показывает пустое состояние", async () => {
    setupFetch();
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelectorAll(".task")).toHaveLength(3));
    const input = document.getElementById("task-search");
    input.value = "несуществующая";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("tasks-list").textContent).toContain("не найдено");
});

test("Чат отображает файл-источник ответа", async () => {
    setupFetch();
    await import("../frontend/app.js");
    document.getElementById("chat-input").value = "Как настроить Git?";
    document.getElementById("chat-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("messages").textContent).toContain("knowledge/guide.txt"));
});

test("Ошибка изменения задачи не обновляет процент и показывает уведомление", async () => {
    const mock = vi.fn(async (url, options = {}) => {
        if (options.method === "PATCH") return response({ error: "Ошибка" }, 500);
        return response({ tasks: demoTasks });
    });
    vi.stubGlobal("fetch", mock);
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelectorAll(".task")).toHaveLength(3));
    document.querySelector(".task-button").click();
    await vi.waitFor(() => expect(document.getElementById("toast").textContent).toContain("Не удалось обновить задачу"));
    expect(document.getElementById("progress-percent").textContent).toBe("33%");
});

test("Ошибка чата отображается в переписке", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => url === "/chat"
        ? response({ error: "Сервис недоступен" }, 503)
        : response({ tasks: demoTasks })));
    await import("../frontend/app.js");
    document.getElementById("chat-input").value = "Привет";
    document.getElementById("chat-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("messages").textContent).toContain("Сервис недоступен"));
});
