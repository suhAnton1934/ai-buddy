/* AI-buddy Team Intelligence: explains mentor dialogue, proposes task steps,
   and syncs opt-in documentation. No automatic task creation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const studentList = $('student-question-list');
  const mentorList = $('mentor-question-list');
  const mentorView = $('mentor-view');
  if (!studentList || !mentorList || !mentorView) return;

  const element = (tag, className, label) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (label !== undefined) el.textContent = label;
    return el;
  };
  const api = async (url, options) => {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  };
  const jsonPost = body => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const notice = (where, text) => { where.textContent = text; };

  const planPanel = element('section', 'ti-card ti-proposals');
  planPanel.id = 'ti-proposals';
  planPanel.appendChild(element('h2', '', 'AI-планы на согласовании'));
  const proposalsList = element('div', 'ti-items');
  planPanel.appendChild(proposalsList);
  mentorView.appendChild(planPanel);

  const docsPanel = element('section', 'ti-card ti-docs');
  docsPanel.id = 'ti-docs';
  docsPanel.appendChild(element('h2', '', 'Синхронизация документации'));
  docsPanel.appendChild(element('p', 'ti-muted', 'Учебный корпоративный источник. Данные синхронизируются отдельно от Team Memory.'));
  const docsStatus = element('p', 'ti-muted', 'Проверяем статус...');
  docsStatus.id = 'ti-docs-status';
  const syncButton = element('button', 'button button-primary', 'Синхронизировать сейчас');
  syncButton.type = 'button';
  syncButton.id = 'ti-sync-docs';
  docsPanel.append(syncButton, docsStatus);
  const docsList = element('div', 'ti-documents');
  docsPanel.appendChild(docsList);
  mentorView.appendChild(docsPanel);

  async function loadDocs() {
    try {
      const data = await api('/knowledge-sync/status');
      const suffix = data.last_sync ? `Последняя проверка: ${data.last_sync}` : 'Пока не синхронизировано';
      notice(docsStatus, `${data.count} документов · ${suffix}${data.index_ready ? ' · RAG-индекс обновлён' : ''}`);
      docsList.replaceChildren();
      for (const doc of (data.documents || [])) {
        docsList.appendChild(element('span', 'ti-doc', doc.title || doc.source_id));
      }
    } catch (error) { notice(docsStatus, error.message); }
  }

  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    notice(docsStatus, 'Загружаем изменения документации...');
    try {
      const data = await api('/knowledge-sync/run', jsonPost({}));
      const changeCount = data.updated.length + data.removed.length;
      notice(docsStatus, `Синхронизация завершена: ${changeCount} изменений. ${data.rag_enabled ?
        (data.index_ready ? 'RAG-индекс обновлён.' : 'RAG-индекс не обновился; старая модель остаётся доступна.') :
        'Для ответов по документам включи AI_MODE=rag.'}`);
      docsList.replaceChildren();
      for (const doc of data.documents || []) docsList.appendChild(element('span', 'ti-doc', doc.title));
    } catch (error) { notice(docsStatus, error.message); }
    finally { syncButton.disabled = false; }
  });

  async function loadProposals() {
    try {
      const data = await api('/mentor-ai/proposals?user_id=1');
      proposalsList.replaceChildren();
      if (!data.proposals.length) {
        proposalsList.appendChild(element('p', 'ti-muted', 'Новых AI-планов пока нет.'));
        return;
      }
      for (const proposal of data.proposals) {
        const card = element('article', 'ti-item');
        card.appendChild(element('strong', '', `Обращение №${proposal.question_id}`));
        card.appendChild(element('p', 'ti-muted', proposal.question));
        const list = element('ol');
        for (const step of proposal.steps) list.appendChild(element('li', '', step));
        card.appendChild(list);
        const actions = element('div', 'ti-actions');
        for (const decision of ['approve', 'reject']) {
          const button = element('button', decision === 'approve' ? 'button button-primary' : 'button button-outline',
            decision === 'approve' ? 'Добавить задачи' : 'Отклонить');
          button.type = 'button';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await api(`/mentor-ai/proposals/${proposal.id}/${decision}`, jsonPost({}));
              await loadProposals();
              if (decision === 'approve') {
                document.dispatchEvent(new Event('ai-buddy:tasks-changed'));
                document.getElementById('mentor-refresh')?.click();
              }
            } catch (error) {
              card.appendChild(element('p', 'ti-error', error.message));
              button.disabled = false;
            }
          });
          actions.appendChild(button);
        }
        card.appendChild(actions);
        proposalsList.appendChild(card);
      }
    } catch (error) { notice(proposalsList, error.message); }
  }

  function renderAnalysis(card, question) {
    const previous = card.querySelector('.ti-analyze-button');
    if (previous) previous.remove();
    const button = element('button', 'ti-analyze-button', '✦ Разобрать ответ с AI');
    button.type = 'button';
    const panel = element('section', 'ti-analysis');
    panel.hidden = true;
    const result = element('div', 'ti-analysis-content');
    const form = element('form', 'ti-followup-form');
    const input = element('input');
    input.placeholder = 'Уточнить непонятный момент...';
    input.maxLength = 600;
    input.required = true;
    input.setAttribute('aria-label', 'Уточнение к ответу наставника');
    const ask = element('button', 'button button-primary', 'Уточнить');
    ask.type = 'submit';
    form.append(input, ask);
    panel.append(result, form);
    card.append(button, panel);

    async function analyze(followup = '') {
      button.disabled = true;
      ask.disabled = true;
      panel.hidden = false;
      notice(result, 'AI разбирает ответ наставника...');
      try {
        const data = await api('/mentor-ai/analyze', jsonPost({ question_id: question.id, followup }));
        result.replaceChildren();
        result.appendChild(element('p', 'ti-summary', data.summary));
        if (data.steps.length) {
          result.appendChild(element('strong', '', 'Предложенные шаги'));
          const list = element('ol');
          for (const step of data.steps) list.appendChild(element('li', '', step));
          result.appendChild(list);
          const propose = element('button', 'button button-outline ti-propose', 'Предложить шаги наставнику');
          propose.type = 'button';
          propose.addEventListener('click', async () => {
            propose.disabled = true;
            try {
              await api('/mentor-ai/proposals', jsonPost({ question_id: question.id }));
              propose.textContent = 'Отправлено наставнику на согласование';
              await loadProposals();
            } catch (error) {
              result.appendChild(element('p', 'ti-error', error.message));
              propose.disabled = false;
            }
          });
          result.appendChild(propose);
        }
        if (data.clarifications?.length) {
          result.appendChild(element('strong', '', 'Что стоит уточнить у наставника'));
          const list = element('ul');
          for (const clarification of data.clarifications) list.appendChild(element('li', '', clarification));
          result.appendChild(list);
        }
        input.value = '';
      } catch (error) { notice(result, error.message); }
      finally { button.disabled = false; ask.disabled = false; }
    }
    button.addEventListener('click', () => analyze());
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (input.value.trim()) analyze(input.value.trim());
    });
  }

  document.addEventListener('ai-buddy:mentor-questions-loaded', event => {
    const questions = event.detail?.questions;
    if (!Array.isArray(questions)) return;
    const cards = [...studentList.querySelectorAll(':scope > .mentor-item')];
    questions.forEach((q, i) => {
      if (q?.status === 'answered' && q.reply && cards[i]) {
        renderAnalysis(cards[i], q);
      }
    });
    loadProposals();
  });
  document.querySelector('[data-mentor-view="mentor"]')?.addEventListener('click', () => {
    loadProposals(); loadDocs();
  });
  loadDocs();
})();
