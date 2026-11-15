import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "frontend", "index.html"), "utf8");
const pageBody = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const tasks = [{ id: 1, title: "Настроить Git", status: "pending" }];
const response = data => ({ ok: true, json: async () => data });

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

function submitMessage(text) {
    document.getElementById("chat-input").value = text;
    document.getElementById("chat-form").dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
    );
}

test("Передаёт только роль, команду и этап профиля в AI", async () => {
    localStorage.setItem("ai-buddy.demo-profile.v1", JSON.stringify({
        name: "Стажёр", role: "Backend", team: "Платформа", stage: "Первая неделя",
        notes: "Это приватная заметка"
    }));
    const fetchMock = vi.fn(async url => url === "/chat"
        ? response({ answer: "Готово", mode: "rag" })
        : response({ tasks }));
    vi.stubGlobal("fetch", fetchMock);
    await import("../frontend/app.js");
    submitMessage("Что сегодня делать?");
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(call => call[0] === "/chat")).toBe(true));
    const payload = JSON.parse(fetchMock.mock.calls.find(call => call[0] === "/chat")[1].body);
    expect(payload).toEqual({
        message: "Что сегодня делать?",
        user_context: { role: "Backend", team: "Платформа", stage: "Первая неделя" }
    });
    expect(JSON.stringify(payload)).not.toContain("приватная заметка");
});

test("Предлагает действие и выполняет его только после подтверждения", async () => {
    let completed = false;
    const fetchMock = vi.fn(async (url, options = {}) => {
        if (url === "/chat") return response({
            answer: "Могу отметить задачу после подтверждения.", mode: "rag",
            proposed_action: { type: "complete_task", task_id: 1, task_title: "Настроить Git" }
        });
        if (url === "/tasks/1" && options.method === "PATCH") {
            completed = true;
            return response({ task: { ...tasks[0], status: "completed" } });
        }
        return response({ tasks: tasks.map(task => ({ ...task, status: completed ? "completed" : "pending" })) });
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("../frontend/app.js");
    submitMessage("Отметь задачу «Настроить Git» выполненной");
    await vi.waitFor(() => expect(document.querySelector(".chat-confirm-action")).not.toBeNull());
    expect(completed).toBe(false);
    
    document.querySelector(".chat-confirm-action").click();

    await vi.waitFor(() => {
        expect(completed).toBe(true);
        expect(document.getElementById("progress-percent").textContent).toBe("100%");
    });

    expect(fetchMock).toHaveBeenCalledWith(
        "/tasks/1",
        expect.objectContaining({ method: "PATCH" })
    );

});

test("Демочат не создаёт кнопку подтверждения", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => url === "/chat"
        ? response({ answer: "Ответ", mode: "demo", proposed_action: null })
        : response({ tasks })));
    await import("../frontend/app.js");
    submitMessage("Как настроить Git?");
    await vi.waitFor(() => expect(document.getElementById("messages").textContent).toContain("Ответ"));
    expect(document.querySelector(".chat-confirm-action")).toBeNull();
});
