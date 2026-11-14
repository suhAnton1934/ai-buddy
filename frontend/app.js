
const tasksList = document.getElementById("tasks-list");
const progressPercent = document.getElementById("progress-percent");
const progressBar = document.getElementById("progress-bar");
const progressDescription = document.getElementById("progress-description");
const taskCount = document.getElementById("task-count");

const messages = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendButton = document.getElementById("send-button");

const USER_ID = 1;


async function loadTasks() {
    try {
        const response = await fetch(`/users/${USER_ID}/tasks`);

        if (!response.ok) {
            throw new Error("Не удалось загрузить задачи");
        }

        const data = await response.json();
        const tasks = data.tasks;

        renderTasks(tasks);
        updateProgress(tasks);

    } catch (error) {
        tasksList.textContent = error.message;
    }
}


function updateProgress(tasks) {
    const total = tasks.length;

    const completed = tasks.filter(
        task => task.status === "completed"
    ).length;

    const percent = total === 0
        ? 0
        : Math.round(completed / total * 100);

    progressPercent.textContent = `${percent}%`;
    progressBar.style.width = `${percent}%`;

    progressDescription.textContent =
        `Выполнено ${completed} из ${total} задач`;

    taskCount.textContent = `${total} задач`;
}


function renderTasks(tasks) {
    tasksList.replaceChildren();

    if (tasks.length === 0) {
        tasksList.textContent = "Задач пока нет";
        return;
    }

    for (const task of tasks) {
        const card = document.createElement("div");
        card.className = "task";

        if (task.status === "completed") {
            card.classList.add("completed");
        }

        const info = document.createElement("div");

        const title = document.createElement("div");
        title.className = "task-title";
        title.textContent = task.title;

        const status = document.createElement("div");
        status.className = "task-status";
        status.textContent = task.status === "completed"
            ? "✓ Выполнено"
            : "○ Ожидает выполнения";

        info.append(title, status);

        const button = document.createElement("button");
        button.className = "task-button";

        button.textContent = task.status === "completed"
            ? "Вернуть"
            : "Выполнить";

        button.addEventListener("click", async () => {
            button.disabled = true;

            try {
                const newStatus = task.status === "completed"
                    ? "pending"
                    : "completed";

                const response = await fetch(`/tasks/${task.id}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        status: newStatus
                    })
                });

                if (!response.ok) {
                    throw new Error("Не удалось обновить задачу");
                }

                await loadTasks();

            } catch (error) {
                alert(error.message);
                button.disabled = false;
            }
        });

        card.append(info, button);
        tasksList.appendChild(card);
    }
}


function addMessage(text, role) {
    const element = document.createElement("div");

    element.className = `message ${role}`;
    element.textContent = text;

    messages.appendChild(element);
    messages.scrollTop = messages.scrollHeight;
}


async function sendMessage(text) {
    const message = text.trim();

    if (!message || sendButton.disabled) {
        return;
    }

    addMessage(message, "user");

    chatInput.value = "";
    sendButton.disabled = true;

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Ошибка сервера");
        }

        addMessage(data.answer, "assistant");

        if (data.task_updated) {
            await loadTasks();
        }

    } catch (error) {
        addMessage(`Ошибка: ${error.message}`, "assistant");

    } finally {
        sendButton.disabled = false;
        chatInput.focus();
    }
}


chatForm.addEventListener("submit", event => {
    event.preventDefault();
    sendMessage(chatInput.value);
});


document.querySelectorAll(".suggestion").forEach(button => {
    button.addEventListener("click", () => {
        sendMessage(button.dataset.message);
    });
});


loadTasks();
