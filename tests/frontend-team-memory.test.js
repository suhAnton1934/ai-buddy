import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'frontend', 'index.html'), 'utf8');
const pageBody = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const ok = data => ({ ok: true, json: async () => data });
let entries;
let fetched;

beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = pageBody;
    entries = [];
    fetched = vi.fn(async (url, options) => {
        if (url === '/team-memory/entries' && !options) return ok({ entries });
        if (url === '/team-memory/publish') {
            const id = JSON.parse(options.body).question_id;
            const entry = { id: 9, question_id: id, question: 'Как получить доступ?', answer: 'Создать заявку', approved_at: '2026-11-15' };
            entries = [entry];
            return ok({ entry });
        }
        if (url === '/team-memory/entries/9' && options?.method === 'DELETE') {
            entries = [];
            return ok({ ok: true });
        }
        throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetched);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

function mentorAnswer() {
    document.getElementById('mentor-question-list').innerHTML = '<article class="mentor-item"></article>';
    document.dispatchEvent(new CustomEvent('ai-buddy:mentor-questions-loaded', {
        detail: { questions: [{ id: 7, text: 'Как получить доступ?', reply: 'Создать заявку', status: 'answered' }] }
    }));
}

test('answered mentor question gets an explicit publish action', async () => {
    await import('../frontend/team_memory.js');
    mentorAnswer();
    await vi.waitFor(() => expect(document.querySelector('.tm-publish')).not.toBeNull());
    expect(fetched).not.toHaveBeenCalledWith('/team-memory/publish', expect.anything());
    document.querySelector('.tm-publish').click();
    await vi.waitFor(() => expect(document.getElementById('team-memory-count').textContent).toBe('1'));
    expect(fetched).toHaveBeenCalledWith('/team-memory/publish', expect.objectContaining({ method: 'POST' }));
    expect(document.querySelector('.tm-entry').textContent).toContain('Создать заявку');
});

test('published knowledge can be revoked', async () => {
    entries = [{ id: 9, question_id: 7, question: 'Как получить доступ?', answer: 'Создать заявку' }];
    await import('../frontend/team_memory.js');
    mentorAnswer();
    await vi.waitFor(() => expect(document.querySelector('.tm-link')).not.toBeNull());
    document.querySelector('.tm-link').click();
    await vi.waitFor(() => expect(document.getElementById('team-memory-count').textContent).toBe('0'));
    expect(fetched).toHaveBeenCalledWith('/team-memory/entries/9', expect.objectContaining({ method: 'DELETE' }));
});

test('already published question cannot be reapproved by mistake', async () => {
    entries = [{ id: 9, question_id: 7, question: 'Как получить доступ?', answer: 'Создать заявку' }];
    await import('../frontend/team_memory.js');
    mentorAnswer();
    await vi.waitFor(() => expect(document.querySelector('.tm-approved')).not.toBeNull());
    expect(document.querySelector('.tm-publish')).toBeNull();
});

test('unanswered question has no publish button', async () => {
    await import('../frontend/team_memory.js');
    document.getElementById('mentor-question-list').innerHTML = '<article class="mentor-item"></article>';
    document.dispatchEvent(new CustomEvent('ai-buddy:mentor-questions-loaded', {
        detail: { questions: [{ id: 2, text: 'Вопрос', reply: null, status: 'open' }] }
    }));
    await Promise.resolve();
    expect(document.querySelector('.tm-publish')).toBeNull();
});
