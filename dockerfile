# Используем официальный образ Python
FROM python:3.11-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файл с зависимостями (создай его командой pip freeze > requirements.txt)
COPY requirements.txt .

# Устанавливаем зависимости
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь остальной код
COPY . .

# Открываем порт (тот, который ты указал в app.py, у тебя это 5001)
EXPOSE 5001

# Запускаем сервер
CMD ["python", "app.py"]