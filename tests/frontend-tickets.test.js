import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = readFileSync(resolve(process.cwd(), 'frontend', 'index.html'), 'utf8');
const pageBody = raw.match(/<body>([\s\S]*?)<\/body>/i)[1];
const ok = data => ({ ok: true, json: async () => data });
let closed;
let requests;
let allQuestions;

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = pageBody;
    closed = new Set();
    allQuestions = [
        { id: 3, status: 'open', text: 'Как настроить SSH?', reply: null },
        { id: 2, status: 'answered', text: 'Как настроить Git?', reply: 'Создать ветку' },
        { id: 1, status: 'open', text: 'Что с доступом?', reply: null },
    ];
    requests = vi.fn(async (url, options) => {
        if (url === '/mentor/tickets?user_id=1') {
            return ok({ closed: [...closed].map(question_id => ({ question_id, closed_at: '2026-11-15' })) });
        }
        const change = String(url).match(/^\/mentor\/tickets\/(\d+)\/(close|reopen)$/);
        if (change && options?.method === 'POST') {
            const id = Number(change[1]);
            if (change[2] === 'close') closed.add(id);
            else closed.delete(id);
            return ok({ question_id: id, closed: closed.has(id), closed_at: closed.has(id) ? '2026-11-15' : null });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', requests);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function loaded() {
    for (const id of ['mentor-question-list', 'student-question-list']) {
        document.getElementById(id).innerHTML = allQuestions.map(q =>
            `<article class="mentor-item question-thread"><span class="thread-caption">№${q.id}</span><div class="thread-my">${q.text}</div>${q.reply ? `<div class="thread-reply">${q.reply}</div>` : ''}</article>`
        ).join('');
    }
    document.dispatchEvent(new CustomEvent('ai-buddy:mentor-questions-loaded', { detail: { questions: allQuestions } }));
}

test('groups unanswered, answered and archive without removing cards', async () => {
    await import('../frontend/tickets.js');
    loaded();
    await vi.waitFor(() => expect(document.querySelector('#student-question-list .ticket-actions')).not.toBeNull());
    expect(document.querySelector('#student-question-list').querySelectorAll('article.mentor-item').length).toBe(3);
    const filter = document.querySelector('#student-question-list').previousElementSibling.querySelector('[data-ticket-filter="open"]');
    filter.click();
    expect(document.querySelectorAll('#student-question-list article:not(.ticket-hidden)').length).toBe(2);
    expect(document.querySelector('#student-question-list .ticket-hidden').textContent).toContain('Git');
});

test('closes a question only after API success, and reopens it later', async () => {
    await import('../frontend/tickets.js');
    loaded();
    await vi.waitFor(() => expect(document.querySelector('#student-question-list .ticket-action[aria-label="Закрыть обращение №3"]')).not.toBeNull());
    document.querySelector('#student-question-list .ticket-action[aria-label="Закрыть обращение №3"]').click();
    await vi.waitFor(() => expect(closed.has(3)).toBe(true));
    await vi.waitFor(() => expect(document.querySelector('#student-question-list article:first-child').classList.contains('ticket-hidden')).toBe(true));
    const archive = document.querySelector('#student-question-list').previousElementSibling.querySelector('[data-ticket-filter="closed"]');
    archive.click();
    expect(document.querySelectorAll('#student-question-list article:not(.ticket-hidden)').length).toBe(1);
    document.querySelector('#student-question-list .ticket-action[aria-label="Повторно открыть обращение №3"]').click();
    await vi.waitFor(() => expect(closed.has(3)).toBe(false));
    expect(requests.mock.calls.some(([url]) => url === '/mentor/tickets/3/reopen')).toBe(true);
});

test('filters by text of answer without deleting history', async () => {
    await import('../frontend/tickets.js');
    loaded();
    await vi.waitFor(() => expect(document.querySelector('#mentor-question-list .ticket-actions')).not.toBeNull());
    const search = document.querySelector('#mentor-question-list').previousElementSibling.querySelector('.ticket-search');
    search.value = 'создать ветку';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('#mentor-question-list article:not(.ticket-hidden)').length).toBe(1);
});

test('closed answered item keeps its original answer and cards', async () => {
    closed.add(2);
    await import('../frontend/tickets.js');
    loaded();
    await vi.waitFor(() => expect(document.querySelector('#student-question-list').previousElementSibling.textContent).toContain('Архив · 1'));
    document.querySelector('#student-question-list').previousElementSibling.querySelector('[data-ticket-filter="closed"]').click();
    expect(document.querySelector('#student-question-list article:nth-child(2)').textContent).toContain('Создать ветку');
    expect(document.querySelectorAll('#student-question-list article').length).toBe(3);
});
