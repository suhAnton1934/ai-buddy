FROM python:3.11-slim

WORKDIR /app

# Устанавливаем системные зависимости для работы gRPC (Yandex) и FAISS
RUN apt-get update && apt-get install -y \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Открываем порт
EXPOSE 5001

# Запускаем unified_app.py в режиме RAG
ENV AI_MODE=rag
CMD ["python", "unified_app.py"]