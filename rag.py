import os
import time
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import YandexGPTEmbeddings
from langchain_community.chat_models import ChatYandexGPT
from langchain_community.vectorstores import FAISS
from langchain.chains import RetrievalQA
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv

load_dotenv()
FAISS_INDEX_PATH = "faiss_index"

def build_rag_chain():
    embeddings = YandexGPTEmbeddings(
        folder_id=os.getenv("YANDEX_FOLDER_ID"),
        api_key=os.getenv("YANDEX_API_KEY")
    )

    # 1. Проверяем, есть ли кэш
    if os.path.exists(FAISS_INDEX_PATH):
        print("Загружаем векторную базу с диска...")
        vectorstore = FAISS.load_local(
            FAISS_INDEX_PATH, 
            embeddings, 
            allow_dangerous_deserialization=True
        )
    else:
        print("Индексируем документы (займет время, не закрывай терминал)...")
        loader = DirectoryLoader(
            "knowledge/", 
            glob="**/*.txt", 
            loader_cls=TextLoader, 
            loader_kwargs={"encoding": "utf-8"}
        )
        docs = loader.load()
        
        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
        chunks = splitter.split_documents(docs)

        # Делаем батчи по 5 штук, чтобы не превысить лимиты Yandex (10 запросов/сек)
        vectorstore = None
        batch_size = 5
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            print(f"Обработка {i+1} - {min(i+batch_size, len(chunks))} из {len(chunks)}...")
            if vectorstore is None:
                vectorstore = FAISS.from_documents(batch, embeddings)
            else:
                vectorstore.add_documents(batch)
            time.sleep(1.2) # Пауза между батчами
            
        if vectorstore:
            vectorstore.save_local(FAISS_INDEX_PATH)
            print("База сохранена!")

    # 2. Модель
    llm = ChatYandexGPT(
        temperature=0,
        folder_id=os.getenv("YANDEX_FOLDER_ID"),
        api_key=os.getenv("YANDEX_API_KEY")
    )

    # 3. Промпт (сделаем его более дружелюбным, как ты просил)
    prompt_template = """Ты — дружелюбный и опытный AI-ментор для стажёров. 
Твоя задача — помогать стажёру адаптироваться, объяснять сложные вещи простым языком и поддерживать его.
Отвечай ТОЛЬКО на основе предоставленного контекста. Если в контексте нет ответа, напиши: "В базе знаний пока нет этой информации, но я могу передать твой вопрос наставнику".
Не придумывай факты. Используй эмодзи, чтобы ответ был живым. Будь вежливым и подробным.

Контекст (документы):
{context}

Вопрос стажёра: {question}

Твой подробный и дружелюбный ответ:"""

    prompt = PromptTemplate(template=prompt_template, input_variables=["context", "question"])

    # 4. Цепочка
    qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
        return_source_documents=True,
        chain_type_kwargs={"prompt": prompt}
    )
    return qa_chain