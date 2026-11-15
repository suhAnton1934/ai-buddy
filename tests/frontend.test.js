
import {
    beforeEach,
    afterEach,
    test,
    expect,
    vi
} from "vitest";

// Тестовые задачи
const initialTasks = [
    { id: 1, title: "Настроить Git", status: "pending" },
    { id: 2, title: "Изучить документацию", status: "completed" }
];

function makeResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data
    };
}

// Создаём HTML-элементы, которые использует app.js
function createPage() {
    document.body.innerHTML = `
        <div id="tasks-list"></div>
        <span id="progress-percent"></span>
        <div id="progress-bar"></div>
        <p id="progress-description"></p>
        <span id="task-count"></span>

        <div id="messages"></div>

        <form id="chat-form">
            <input id="chat-input">
            <button id="send-button" type="submit">
                Отправить
            </button>
        </form>

        <button class="suggestion"
                data-message="Какие у меня задачи?">
            Мои задачи
        </button>
    `;
}

beforeEach(() => {
    vi.resetModules();
    createPage();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// 1. Проверка загрузки задач
test("Загружает задачи из backend", async () => {
    const fetchMock = vi.fn(async () =>
        makeResponse({ tasks: initialTasks })
    );

    vi.stubGlobal("fetch", fetchMock);

    await import("../frontend/app.js");

    await vi.waitFor(() => {
        expect(
            document.getElementById("tasks-list").textContent
        ).toContain("Настроить Git");
    });

    expect(fetchMock).toHaveBeenCalledWith("/users/1/tasks");
});

// 2. Проверка прогресса
test("Правильно вычисляет прогресс", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
        makeResponse({ tasks: initialTasks })
    ));

    await import("../frontend/app.js");

    await vi.waitFor(() => {
        expect(
            document.getElementById("progress-percent").textContent
        ).toBe("50%");
    });

    expect(
        document.getElementById("progress-description").textContent
    ).toBe("Выполнено 1 из 2 задач");
});

// 3. Проверка изменения статуса
test("Меняет статус задачи через PATCH", async () => {
    let tasks = initialTasks.map(task => ({ ...task }));

    const fetchMock = vi.fn(async (url, options = {}) => {
        if (options.method === "PATCH") {
            const id = Number(url.split("/").pop());
            const { status } = JSON.parse(options.body);

            tasks = tasks.map(task =>
                task.id === id ? { ...task, status } : task
            );

            return makeResponse({ task: tasks.find(t => t.id === id) });
        }

        return makeResponse({ tasks });
    });

    vi.stubGlobal("fetch", fetchMock);

    await import("../frontend/app.js");

    await vi.waitFor(() => {
        expect(
            document.getElementById("tasks-list").textContent
        ).toContain("Настроить Git");
    });

    const buttons = document.querySelectorAll(".task-button");
    buttons[0].click();

    await vi.waitFor(() => {
        expect(
            document.getElementById("progress-percent").textContent
        ).toBe("100%");
    });

    expect(fetchMock).toHaveBeenCalledWith(
        "/tasks/1",
        expect.objectContaining({ method: "PATCH" })
    );
});

// 4. Проверка отправки сообщения
test("Отправляет сообщение в чат", async () => {
    const fetchMock = vi.fn(async (url) => {
        if (url === "/chat") {
            return makeResponse({
                answer: "Привет от AI-buddy!",
                task_updated: false
            });
        }

        return makeResponse({ tasks: initialTasks });
    });

    vi.stubGlobal("fetch", fetchMock);

    await import("../frontend/app.js");

    const input = document.getElementById("chat-input");
    input.value = "Привет";

    document.getElementById("chat-form").dispatchEvent(
        new Event("submit", {
            bubbles: true,
            cancelable: true
        })
    );

    await vi.waitFor(() => {
        expect(
            document.getElementById("messages").textContent
        ).toContain("Привет от AI-buddy!");
    });

    expect(fetchMock).toHaveBeenCalledWith(
        "/chat",
        expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
                message: "Привет",
                user_context: {
                    role: "Не указана",
                    team: "Не указана",
                    stage: "Первая неделя"
                }
            })
        })
    );
});

// 5. После действия AI обновляется прогресс
test("Обновляет задачи после действия AI", async () => {
    let completed = false;

    vi.stubGlobal("fetch", vi.fn(async (url) => {
        if (url === "/chat") {
            completed = true;
            return makeResponse({
                answer: "Задача выполнена",
                task_updated: true
            });
        }

        return makeResponse({
            tasks: [
                {
                    id: 1,
                    title: "Настроить Git",
                    status: completed ? "completed" : "pending"
                }
            ]
        });
    }));

    await import("../frontend/app.js");

    await vi.waitFor(() => {
        expect(
            document.getElementById("progress-percent").textContent
        ).toBe("0%");
    });

    document.getElementById("chat-input").value =
        "Отметь настройку Git выполненной";

    document.getElementById("chat-form").dispatchEvent(
        new Event("submit", {
            bubbles: true,
            cancelable: true
        })
    );

    await vi.waitFor(() => {
        expect(
            document.getElementById("progress-percent").textContent
        ).toBe("100%");
    });
});

// 6. Проверка ошибки backend
test("Показывает ошибку загрузки задач", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
        makeResponse({ error: "Ошибка сервера" }, 500)
    ));

    await import("../frontend/app.js");

    await vi.waitFor(() => {
        expect(
            document.getElementById("tasks-list").textContent
        ).toContain("Не удалось загрузить задачи");
    });
});
