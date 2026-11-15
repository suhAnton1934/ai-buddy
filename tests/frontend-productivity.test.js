import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "frontend", "index.html"), "utf8");
const pageBody = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
function iso(offsetDays) {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + offsetDays);
    const pad = x => String(x).padStart(2, "0");
    return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
const sample = () => [
    { id: 1, title: "Без срока", status: "pending", due_date: null },
    { id: 2, title: "Срочно — вчера", status: "pending", due_date: iso(-1) },
    { id: 3, title: "Выполнено", status: "completed", due_date: iso(-5) },
    { id: 4, title: "Сделать сегодня", status: "pending", due_date: iso(0) },
    { id: 5, title: "На завтра", status: "pending", due_date: iso(1) },
];
const res = data => ({ ok: true, json: async () => data });

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

test("Мой день показывает ближайшие незавершённые задачи по сроку", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ tasks: sample() })));
    await import("../frontend/productivity.js");
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelectorAll("#my-day-list .day-item")).toHaveLength(3));
    const text = [...document.querySelectorAll("#my-day-list .day-item strong")].map(x => x.textContent);
    expect(text).toEqual(["Срочно — вчера", "Сделать сегодня", "На завтра"]);
    expect(document.getElementById("my-day-summary").textContent).toContain("1 просрочено");
});

test("Помоги с задачей открывает чат и подготавливает текст без отправки", async () => {
    const fetchMock = vi.fn(async url => res(url === "/chat" ? { answer: "ответ" } : { tasks: sample() }));
    vi.stubGlobal("fetch", fetchMock);
    await import("../frontend/productivity.js");
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelector(".help-with-task")).not.toBeNull());
    document.querySelector(".help-with-task").click();
    expect(document.getElementById("app-layout").classList.contains("view-chat")).toBe(true);
    expect(document.getElementById("chat-input").value).toContain("Помоги мне выполнить задачу");
    expect(fetchMock.mock.calls.some(call => call[0] === "/chat")).toBe(false);
    // Выполненные задачи не предлагают помощь по завершению.
    expect(document.querySelectorAll(".help-with-task")).toHaveLength(4);
});

test("Кнопка «К задаче» переводит в чек-лист и ищет выбранную задачу", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ tasks: sample() })));
    await import("../frontend/productivity.js");
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.querySelector("#my-day-list .day-task-button")).not.toBeNull());
    document.querySelector("#my-day-list .day-task-button").click();
    expect(document.getElementById("app-layout").classList.contains("view-tasks")).toBe(true);
    expect(document.getElementById("task-search").value).toBe("Срочно — вчера");
    expect(document.querySelectorAll("#tasks-list .task")).toHaveLength(1);
});

test("Наставник видит просрочки, скорые дедлайны и вопросы без ответа", async () => {
    const questions = [
        { id: 10, text: "Как получить доступ?", status: "pending", reply: null },
        { id: 11, text: "Уже ответили", status: "answered", reply: "Смотри инструкцию" },
    ];
    const fetchMock = vi.fn(async url => {
        if (url === "/mentor/tasks?user_id=1") return res({ tasks: sample() });
        if (url === "/mentor/questions?user_id=1") return res({ questions });
        return res({ tasks: sample() });
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../frontend/productivity.js");
    await import("../frontend/app.js");
    await import("../frontend/mentor.js");
    document.querySelector('[data-mentor-view="mentor"]').click();
    await vi.waitFor(() => expect(document.getElementById("mentor-attention-count").textContent).toBe("4"));
    const text = document.getElementById("mentor-attention-list").textContent;
    expect(text).toContain("Срочно — вчера");
    expect(text).toContain("Сделать сегодня");
    expect(text).toContain("На завтра");
    expect(text).toContain("Как получить доступ?");
    expect(text).not.toContain("Уже ответили");
    expect(
        fetchMock.mock.calls.some(
            ([url]) => url === "/mentor/questions?user_id=1"
        )
    ).toBe(true);
});

test("Отсутствие задач отображает спокойное пустое состояние", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ tasks: [] })));
    await import("../frontend/productivity.js");
    await import("../frontend/app.js");
    await vi.waitFor(() => expect(document.getElementById("my-day-summary").textContent).toContain("Все задачи выполнены"));
    expect(document.getElementById("my-day-list").textContent).toContain("На сегодня всё готово");
});
