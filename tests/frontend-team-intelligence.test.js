import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), 'frontend', 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const ok = data => ({ok:true,json:async()=>data});
let fetchMock;
let created;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = body;
  created = false;
  fetchMock = vi.fn(async (url, options) => {
    if (url === '/knowledge-sync/status') return ok({count:0, documents:[], last_sync:null,index_ready:false});
    if (url === '/knowledge-sync/run') return ok({updated:['backend'],removed:[],rag_enabled:false,index_ready:false,documents:[{title:'Backend'}]});
    if (url === '/mentor-ai/proposals?user_id=1') return ok({proposals:created ? [{id:4, question_id:3,question:'Как работать с Git?', steps:['Создать ветку'], created_at:'2026-11-15'}] : []});
    if (url === '/mentor-ai/analyze') return ok({summary:'Создай ветку.', steps:['Создать ветку'], clarifications:[], mode:'rag'});
    if (url === '/mentor-ai/proposals' && options?.method === 'POST') {created=true; return ok({proposal_id:4,status:'pending'});}
    if (url === '/mentor-ai/proposals/4/approve') return ok({ok:true,status:'approved'});
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();});

function dispatchQuestion() {
  document.getElementById('student-question-list').innerHTML='<article class="mentor-item">Ответ наставника</article>';
  document.dispatchEvent(new CustomEvent('ai-buddy:mentor-questions-loaded', {
    detail:{questions:[{id:3,text:'Как работать с Git?',reply:'Создай ветку.',status:'answered'}]}
  }));
}

test('adds an explicit AI explanation button to answered mentor messages', async () => {
  await import('../frontend/team_intelligence.js');
  dispatchQuestion();
  expect(document.querySelector('.ti-analyze-button')).not.toBeNull();
  expect(fetchMock).not.toHaveBeenCalledWith('/mentor-ai/analyze', expect.anything());
  document.querySelector('.ti-analyze-button').click();
  await vi.waitFor(()=>expect(document.querySelector('.ti-summary').textContent).toContain('Создай ветку'));
  expect(fetchMock).toHaveBeenCalledWith('/mentor-ai/analyze', expect.objectContaining({method:'POST'}));
});

test('plan is proposed, but tasks are not created before mentor approval', async () => {
  await import('../frontend/team_intelligence.js');
  dispatchQuestion();
  document.querySelector('.ti-analyze-button').click();
  await vi.waitFor(()=>expect(document.querySelector('.ti-propose')).not.toBeNull());
  document.querySelector('.ti-propose').click();
  await vi.waitFor(()=>expect(document.querySelector('#ti-proposals .ti-item')).not.toBeNull());
  expect(fetchMock).not.toHaveBeenCalledWith('/mentor-ai/proposals/4/approve',expect.anything());
  document.querySelector('#ti-proposals .button-primary').click();
  await vi.waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url==='/mentor-ai/proposals/4/approve')).toBe(true));
});

test('mentor can launch document synchronization explicitly', async () => {
  await import('../frontend/team_intelligence.js');
  const button=document.getElementById('ti-sync-docs');
  expect(button).not.toBeNull();
  button.click();
  await vi.waitFor(()=>expect(document.getElementById('ti-docs-status').textContent).toContain('1 изменений'));
  expect(fetchMock.mock.calls.some(([url])=>url==='/knowledge-sync/run')).toBe(true);
});
