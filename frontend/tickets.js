/* Ticket organization without replacing mentor.js, Team Memory, or AI analysis. */
(() => {
    'use strict';
    const USER_ID = 1;
    const PAGE_SIZE = 7;
    const sections = [
        { name: 'student', list: document.getElementById('student-question-list'), filter: 'active', query: '', limit: PAGE_SIZE },
        { name: 'mentor', list: document.getElementById('mentor-question-list'), filter: 'active', query: '', limit: PAGE_SIZE },
    ].filter(section => section.list);
    if (!sections.length) return;

    let questions = [];
    let closedIds = new Set();
    let ready = false;
    let seq = 0;
    let feedback = '';
    const make = (tag, cls, text) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = String(text);
        return el;
    };

    const filters = [
        ['active', 'Активные'],
        ['open', 'Ждут ответа'],
        ['answered', 'С ответом'],
        ['closed', 'Архив'],
    ];

    for (const section of sections) {
        const toolbar = make('div', 'ticket-toolbar');
        const filterBox = make('div', 'ticket-filters');
        const buttons = new Map();
        for (const [key, title] of filters) {
            const button = make('button', 'ticket-filter', title);
            button.type = 'button';
            button.dataset.ticketFilter = key;
            button.addEventListener('click', () => {
                section.filter = key;
                section.limit = PAGE_SIZE;
                renderAll();
            });
            filterBox.appendChild(button);
            buttons.set(key, button);
        }
        const search = make('input', 'ticket-search');
        search.type = 'search';
        search.placeholder = 'Поиск по вопросам и ответам...';
        search.setAttribute('aria-label', `Поиск обращений: ${section.name === 'student' ? 'стажёр' : 'наставник'}`);
        search.addEventListener('input', () => {
            section.query = search.value.trim().toLocaleLowerCase('ru');
            section.limit = PAGE_SIZE;
            renderAll();
        });
        const note = make('span', 'ticket-toolbar-note', 'Загружаем обращения...');
        toolbar.append(filterBox, search, note);
        section.list.parentNode.insertBefore(toolbar, section.list);

        const pager = make('div', 'ticket-pager');
        const count = make('p');
        const more = make('button', 'ticket-action', 'Показать ещё');
        more.type = 'button';
        more.addEventListener('click', () => {
            section.limit += PAGE_SIZE;
            renderAll();
        });
        const empty = make('div', 'ticket-empty-match');
        empty.hidden = true;
        pager.append(count, more, empty);
        section.list.parentNode.insertBefore(pager, section.list.nextSibling);
        Object.assign(section, { buttons, note, count, more, empty });
    }

    const statusOf = q => closedIds.has(q.id) ? 'closed' : (q.status === 'answered' || q.reply ? 'answered' : 'open');
    const counts = () => {
        const sum = { active: 0, open: 0, answered: 0, closed: 0 };
        for (const q of questions) {
            const status = statusOf(q);
            sum[status] += 1;
            if (status !== 'closed') sum.active += 1;
        }
        return sum;
    };

    async function changeTicket(question, close, control) {
        control.disabled = true;
        try {
            const action = close ? 'close' : 'reopen';
            const response = await fetch(`/mentor/tickets/${question.id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: USER_ID }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Не удалось изменить обращение');
            if (result.closed) closedIds.add(question.id);
            else closedIds.delete(question.id);
            feedback = result.closed ? `Обращение №${question.id} помещено в архив` : `Обращение №${question.id} снова активно`;
            renderAll();
            document.dispatchEvent(new CustomEvent('ai-buddy:tickets-updated', {
                detail: { closedIds: [...closedIds] },
            }));
        } catch (error) {
            feedback = `Не удалось изменить обращение: ${error.message}`;
            renderAll();
        } finally {
            if (control.isConnected) control.disabled = false;
        }
    }

    function decorate(card, question, section) {
        const state = statusOf(question);
        const isStudent = section.name === 'student';
        let actions = card.querySelector(':scope > .ticket-actions');
        if (actions) actions.remove();
        actions = make('div', 'ticket-actions');
        const marker = make('span', state === 'closed' ? 'ticket-closed-marker' : 'ticket-ticketstate',
            state === 'closed' ? '✓ Закрыто' : state === 'answered' ? '● Ответ получен' : '● Ожидает ответа');
        actions.appendChild(marker);

        if (state === 'answered' || state === 'closed') {
            const expand = make('button', 'ticket-action', card.classList.contains('ticket-collapsed') ? 'Показать детали' : 'Свернуть детали');
            expand.type = 'button';
            expand.addEventListener('click', () => {
                const nowCollapsed = card.classList.toggle('ticket-collapsed');
                expand.textContent = nowCollapsed ? 'Показать детали' : 'Свернуть детали';
            });
            actions.appendChild(expand);
        }
        const toggle = make('button', 'ticket-action', state === 'closed' ? 'Открыть снова' : 'Закрыть обращение');
        toggle.type = 'button';
        toggle.disabled = !ready;
        toggle.setAttribute('aria-label', `${state === 'closed' ? 'Повторно открыть' : 'Закрыть'} обращение №${question.id}`);
        toggle.addEventListener('click', () => changeTicket(question, state !== 'closed', toggle));
        actions.appendChild(toggle);
        card.appendChild(actions);

        // A closed ticket stays in its original DB row; no removal or reordering.
        // When first rendered, collapse long resolved cards, but never collapse pending reply form.
        if (state === 'answered' || state === 'closed') {
            if (card.dataset.ticketSeen !== '1') card.classList.add('ticket-collapsed');
        } else {
            card.classList.remove('ticket-collapsed');
        }
        card.dataset.ticketSeen = '1';
        // Set button label after initial collapse.
        const details = actions.querySelector('button');
        if (details && (state === 'answered' || state === 'closed')) {
            details.textContent = card.classList.contains('ticket-collapsed') ? 'Показать детали' : 'Свернуть детали';
        }
        if (isStudent) {
            const caption = card.querySelector('.thread-caption');
            if (caption) caption.textContent = `Обращение №${question.id} · ${state === 'closed' ? 'Закрыто' : state === 'answered' ? 'Есть ответ' : 'Ожидает ответа'}`;
        }
    }

    function matches(question, section) {
        const status = statusOf(question);
        if (section.filter === 'active' ? status === 'closed' : status !== section.filter) return false;
        if (!section.query) return true;
        return (`${question.id} ${question.text || ''} ${question.reply || ''}`)
            .toLocaleLowerCase('ru').includes(section.query);
    }

    function renderAll() {
        const totals = counts();
        for (const section of sections) {
            for (const [key, title] of filters) {
                const button = section.buttons.get(key);
                button.textContent = `${title} · ${totals[key]}`;
                button.classList.toggle('is-active', section.filter === key);
                button.setAttribute('aria-pressed', String(section.filter === key));
            }
            section.note.textContent = feedback || (ready ? 'Закрытые обращения сохранены в архиве, переписка не удаляется.' : 'Проверяем архив обращений...');
            const cards = [...section.list.children].filter(el => el.matches('article.mentor-item'));
            let matched = 0;
            let visible = 0;
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                const card = cards[i];
                if (!card) continue;
                decorate(card, q, section);
                const eligible = matches(q, section);
                if (eligible) matched++;
                const show = eligible && matched <= section.limit;
                card.classList.toggle('ticket-hidden', !show);
                if (show) visible++;
            }
            section.count.textContent = `Показано ${visible} из ${matched}`;
            section.more.hidden = matched <= section.limit;
            section.empty.hidden = matched !== 0 || questions.length === 0;
            if (!section.empty.hidden) section.empty.textContent = 'По этому фильтру обращений нет.';
        }
    }

    document.addEventListener('ai-buddy:mentor-questions-loaded', async event => {
        if (!Array.isArray(event.detail?.questions)) return;
        const current = ++seq;
        questions = event.detail.questions;
        ready = false;
        feedback = '';
        try {
            const response = await fetch(`/mentor/tickets?user_id=${USER_ID}`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Архив недоступен');
            if (seq !== current) return;
            closedIds = new Set((result.closed || []).map(item => item.question_id));
            ready = true;
        } catch (error) {
            if (seq !== current) return;
            feedback = `Архив временно недоступен: ${error.message}`;
        }
        renderAll();
        if (ready) document.dispatchEvent(new CustomEvent('ai-buddy:tickets-updated', {
            detail: { closedIds: [...closedIds] },
        }));
    });
})();
