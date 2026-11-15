import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "frontend/index.html"), "utf8");
const pageBody = html.match(/<body>([\s\S]*?)<\/body>/i)[1];

function response(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function setup() {
    let tasks = [{ id: 1, user_id: 1, title: "Настроить Git", status: "pending", due_date: null, description: "" }];
    let questions = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
        if (url === "/users/1/tasks") return response({ tasks });
        if (url === "/mentor/tasks?user_id=1") return response({ tasks });
        if (url === "/mentor/questions?user_id=1") return response({ questions });
        if (url === "/mentor/tasks" && options.method === "POST") {
            const payload = JSON.parse(options.body);
            const task = { ...payload, id: tasks.length + 1, status: "pending" };
            tasks = [task, ...tasks];
            return response({ task }, 201);
        }
        if (url === "/mentor/questions" && options.method === "POST") {
            const payload = JSON.parse(options.body);
            const question = { ...payload, id: questions.length + 1, status: "open", reply: null };
            questions = [question, ...questions];
            return response({ question }, 201);
        }
        if (typeof url === "string" && url.endsWith("/reply") && options.method === "POST") {
            const id = Number(url.split("/")[3]);
            questions = questions.map(q => q.id === id ? { ...q, reply: JSON.parse(options.body).reply, status: "answered" } : q);
            return response({ question: questions[0] });
        }
        return response({ answer: "Из базы знаний", sources: [] });
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

async function start() {
    await import("../frontend/app.js");
    await import("../frontend/mentor.js");
}

test("кабинет наставника открывается и показывает задачи", async () => {
    setup();
    await start();
    document.querySelector('[data-mentor-view="mentor"]').click();
    expect(document.getElementById("mentor-view").hidden).toBe(false);
    expect(document.getElementById("app-layout").classList.contains("view-mentor")).toBe(true);
    await vi.waitFor(() => expect(document.getElementById("mentor-task-list").textContent).toContain("Настроить Git"));
});

test("созданная задача появляется у стажёра с дедлайном", async () => {
    const fetchMock = setup();
    await start();
    document.querySelector('[data-mentor-view="mentor"]').click();
    document.getElementById("mentor-task-title").value = "Изучить документацию";
    document.getElementById("mentor-task-due").value = "2027-12-30";
    document.getElementById("mentor-task-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("tasks-list").textContent).toContain("Изучить документацию"));
    expect(document.getElementById("tasks-list").textContent).toContain("30.12.2027");
    expect(fetchMock).toHaveBeenCalledWith("/mentor/tasks", expect.objectContaining({ method: "POST" }));
});

test("стажёр задаёт вопрос, наставник отвечает, ответ виден в истории", async () => {
    setup();
    await start();
    document.querySelector('[data-mentor-view="questions"]').click();
    document.getElementById("student-question-text").value = "Кому написать про доступ?";
    document.getElementById("student-question-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("student-question-list").textContent).toContain("Кому написать про доступ?"));
    document.querySelector('[data-mentor-view="mentor"]').click();
    await vi.waitFor(() => expect(document.querySelector(".mentor-reply textarea")).not.toBeNull());
    document.querySelector(".mentor-reply textarea").value = "Напиши своему наставнику";
    document.querySelector(".mentor-reply").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("mentor-question-list").textContent).toContain("Напиши своему наставнику"));
    document.querySelector('[data-mentor-view="questions"]').click();
    await vi.waitFor(() => expect(document.getElementById("student-question-list").textContent).toContain("Напиши своему наставнику"));
});

test("обычная навигация закрывает кабинет наставника", async () => {
    setup();
    await start();
    document.querySelector('[data-mentor-view="mentor"]').click();
    document.querySelector('.nav-link[data-view="profile"]').click();
    expect(document.getElementById("mentor-view").hidden).toBe(true);
    expect(document.getElementById("profile-view").hidden).toBe(false);
    expect(document.getElementById("app-layout").classList.contains("view-mentor")).toBe(false);
});

test("кнопка передачи вопроса предлагает наставнику последний вопрос из AI-чата", async () => {
    setup();
    await start();
    const message = document.createElement("div");
    message.className = "message user";
    message.textContent = "Как получить доступ к Jira?";
    document.getElementById("messages").appendChild(message);
    document.getElementById("escalate-question").click();
    expect(document.getElementById("questions-view").hidden).toBe(false);
    expect(document.getElementById("student-question-text").value).toBe("Как получить доступ к Jira?");
});

test("в кабинете наставника отображается просроченная задача", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => {
        if (url === "/mentor/tasks?user_id=1" || url === "/users/1/tasks") {
            return response({ tasks: [{ id: 1, title: "Проверить доступы", status: "pending", due_date: "2020-01-01", description: "" }] });
        }
        return response({ questions: [] });
    }));
    await start();
    document.querySelector('[data-mentor-view="mentor"]').click();
    await vi.waitFor(() => expect(document.getElementById("mentor-overdue").textContent).toBe("1"));
    expect(document.getElementById("tasks-list").textContent).toContain("Просрочено");
});

test("ошибка создания задачи не добавляет задачу в список", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
        if (url === "/mentor/tasks" && options.method === "POST") return response({ error: "Некорректный дедлайн" }, 400);
        if (url === "/mentor/tasks?user_id=1" || url === "/users/1/tasks") return response({ tasks: [] });
        if (url === "/mentor/questions?user_id=1") return response({ questions: [] });
        return response({});
    }));
    await start();
    document.querySelector('[data-mentor-view="mentor"]').click();
    document.getElementById("mentor-task-title").value = "Тест";
    document.getElementById("mentor-task-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById("toast").textContent).toContain("Некорректный дедлайн"));
    expect(document.getElementById("tasks-list").textContent).not.toContain("Тест");
});
