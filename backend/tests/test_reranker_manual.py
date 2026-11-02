from pathlib import Path
import sys

# Add backend directory to Python path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from app.config import Settings
from app.reranker import CloudflareReranker
from langchain_core.documents import Document

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

load_dotenv()

settings = Settings.from_env()
reranker = CloudflareReranker(settings)

query = "What is retrieval augmented generation?"

documents = [
    Document(page_content="RAG retrieves relevant information and uses it to ground LLM responses."),
    Document(page_content="A neural network consists of interconnected computational layers."),
    Document(page_content="Retrieval augmented generation combines information retrieval with text generation."),
]

results = reranker.rerank(query, documents, top_k=3)

for i, doc in enumerate(results, 1):
    print(f"\nRank: {i}")
    print(f"Score: {doc.metadata['rerank_score']:.4f}")
    print(f"Text: {doc.page_content}")
