import os
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import YandexGPTEmbeddings
from langchain_community.chat_models import ChatYandexGPT
from langchain_community.vectorstores import FAISS
from langchain_classic.chains import RetrievalQA
from langchain_core.prompts import PromptTemplate
from dotenv import load_dotenv

load_dotenv()

def build_rag_chain():
    # 1. Загрузка ВСЕХ txt-файлов из папки knowledge
    loader = DirectoryLoader(
        "knowledge/", 
        glob="**/*.txt", 
        loader_cls=TextLoader, 
        loader_kwargs={"encoding": "utf-8"}
    )
    docs = loader.load()

    if not docs:
        print("ВНИМАНИЕ: В папке knowledge нет .txt файлов!")

    # 2. Нарезка на куски
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_documents(docs)

    # 3. Векторизация через Yandex
    embeddings = YandexGPTEmbeddings(
        folder_id=os.getenv("YANDEX_FOLDER_ID"),
        api_key=os.getenv("YANDEX_API_KEY")
    )
    vectorstore = FAISS.from_documents(chunks, embeddings)

    # 4. Модель YandexGPT
    llm = ChatYandexGPT(
        temperature=0,
        folder_id=os.getenv("YANDEX_FOLDER_ID"),
        api_key=os.getenv("YANDEX_API_KEY")
    )

    # 5. Промпт 
    prompt_template = """Ты — AI-помощник стажёра. 
Отвечай на вопрос, используя предоставленный контекст (документы) и информацию о текущих задачах (если она есть).
Если вопрос про задачи, используй переданный список задач.
Если в контексте нет ответа, напиши: "В базе знаний нет информации по этому вопросу". Не придумывай ничего от себя.

Контекст (документы):
{context}

Вопрос стажёра: {question}

Твой ответ:"""

    prompt = PromptTemplate(
        template=prompt_template,
        input_variables=["context", "question"] # Оставляем только эти две переменные
    )

    # 6. Сборка цепочки
    qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),
        return_source_documents=True,
        chain_type_kwargs={"prompt": prompt}
    )

    return qa_chain