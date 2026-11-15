/* Team Memory UI: mentor approves a reply before it becomes searchable.
 * Uses current mentor events; does not change existing chat/task handlers.
 */
(() => {
    'use strict';
    const byId = id => document.getElementById(id);
    const list = byId('team-memory-list');
    const counter = byId('team-memory-count');
    const info = byId('team-memory-status');
    const mentorCards = byId('mentor-question-list');
    if (!list || !mentorCards) return;

    const node = (tag, cls, text) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = String(text);
        return el;
    };

    async function api(url, options) {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Запрос не выполнен');
        return data;
    }

    function notify(message) {
        if (info) info.textContent = message;
    }

    let latestQuestions = [];

    async function loadMemory() {
        const data = await api('/team-memory/entries');
        const entries = Array.isArray(data.entries) ? data.entries : [];
        list.replaceChildren();
        if (counter) counter.textContent = String(entries.length);
        if (!entries.length) {
            list.appendChild(node('p', 'tm-empty', 'Пока нет подтверждённых инструкций. Ответь на вопрос стажёра и опубликуй его здесь.'));
        }
        for (const entry of entries) {
            const card = node('article', 'tm-entry');
            card.appendChild(node('strong', '', entry.question));
            card.appendChild(node('p', '', entry.answer));
            const footer = node('div', 'tm-entry-footer');
            footer.appendChild(node('span', 'tm-approved', '✓ Проверено наставником'));
            const revoke = node('button', 'tm-link', 'Отозвать');
            revoke.type = 'button';
            revoke.setAttribute('aria-label', `Отозвать знание: ${entry.question}`);
            revoke.addEventListener('click', async () => {
                revoke.disabled = true;
                try {
                    await api(`/team-memory/entries/${entry.id}`, { method: 'DELETE' });
                    notify('Знание отозвано. AI больше не использует этот ответ.');
                    await attachPublishActions(latestQuestions);
                } catch (error) {
                    notify(error.message);
                    revoke.disabled = false;
                }
            });
            footer.appendChild(revoke);
            card.appendChild(footer);
            list.appendChild(card);
        }
        return entries;
    }

    async function attachPublishActions(questions) {
        // Existing mentor.js renders question cards in the same order.
        const cards = [...mentorCards.querySelectorAll(':scope > .mentor-item')];
        let entries;
        try { entries = await loadMemory(); }
        catch (error) { notify(error.message); return; }
        const published = new Map(entries.map(entry => [entry.question_id, entry]));
        for (let index = 0; index < questions.length; index++) {
            const question = questions[index];
            const card = cards[index];
            if (!card || !question?.reply || question.status !== 'answered') continue;
            // Avoid modifying a card if it was replaced while loading.
            if (!mentorCards.contains(card)) continue;
            const old = card.querySelector('.tm-publish-area');
            if (old) old.remove();
            const area = node('div', 'tm-publish-area');
            const approved = published.get(question.id);
            if (approved && approved.answer === question.reply && approved.question === question.text) {
                area.appendChild(node('span', 'tm-approved', '✓ Добавлено в Team Memory'));
            } else {
                const publish = node('button', 'tm-publish', '✦ Добавить в Team Memory');
                publish.type = 'button';
                publish.setAttribute('aria-label', `Опубликовать ответ на обращение ${question.id}`);
                publish.addEventListener('click', async () => {
                    publish.disabled = true;
                    try {
                        await api('/team-memory/publish', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ question_id: question.id })
                        });
                        publish.replaceWith(node('span', 'tm-approved', '✓ Добавлено в Team Memory'));
                        notify('Ответ опубликован. Следующий стажёр получит проверенную инструкцию.');
                        await loadMemory();
                    } catch (error) {
                        notify(error.message);
                        publish.disabled = false;
                    }
                });
                area.appendChild(publish);
            }
            card.appendChild(area);
        }
    }

    document.addEventListener('ai-buddy:mentor-questions-loaded', event => {
        if (Array.isArray(event.detail?.questions)) {
            latestQuestions = event.detail.questions;
            attachPublishActions(latestQuestions);
        }
    });

    byId('team-memory-refresh')?.addEventListener('click', async () => {
        try { await loadMemory(); notify('Список знаний обновлён.'); }
        catch (error) { notify(error.message); }
    });
})();
