# Отчёт о проверках и покрытии

## Последний предоставленный пользователем запуск (16.11.2026, до правок этого пакета)

| Проверка | Результат | Ограничения |
|---|---|---|
| Python: `pytest -q` + `pytest-cov` | 56 passed, 0 failed; измеренное покрытие 86% | `rag.py`, `intent_router.py` не импортировались, поэтому **86% не является полным покрытием Python-проекта** |
| JavaScript: `npm run test:coverage` | 44 passed, 0 failed | Lines 94.3%, Statements 90.72%, Branches 76.96%, Functions 90.78% |

Значения выше являются результатом проверки до обновления зависимостей, SQL и фронтенда.
Они **не** доказывают автоматически, что новые файлы прошли все проверки или что RAG доступен в Yandex Cloud.

## Как перепроверить окончательную версию

```bash
python -m pip install -r requirements-demo.txt pytest pytest-cov
python -m pytest -q --cov=unified_app --cov=demo_chat --cov=db \
  --cov=intent_router --cov=team_memory --cov=mentor_intelligence \
  --cov=knowledge_sync --cov=tickets --cov=routes --cov=rag --cov-report=term-missing
npm ci
npm run test:coverage
```

Отдельно убедитесь, что нет предупреждений `module-not-imported`. Для оценки
требования **более 80% строк** нужен полный воспроизводимый отчёт без пропущенных
прикладных модулей. Указанные 86% и 94,3% нельзя усреднять как проценты разных языков.

## Smoke-test реальных интеграций

```bash
curl -s http://localhost:5001/health
```

В режиме RAG после успешной инициализации должно быть `mode=rag`,
`rag_ready=true`. Это не заменяет тест самого запроса к YandexGPT.
Интеграционные тесты с настоящими API-ключами безопасно выполняйте локально,
без записи ключей в лог или CI-отчёты.
