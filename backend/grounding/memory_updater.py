"""
memory_updater.py - Extracts topics from Resume/JD text and candidate spoken answers.

Updates the AllowedTopicStore whenever:
1. Initial system prompt (Resume + JD) is ingested at session start.
2. Candidate speaks during the interview (expanding allowed topics with candidate-introduced skills).
"""

import re
from typing import Set
from .allowed_topics import AllowedTopicStore

# Comprehensive technical dictionary for zero-LLM topic extraction
_TECH_DICTIONARY: Set[str] = {
    "python", "javascript", "typescript", "java", "c++", "c#", "golang", "go", "rust",
    "ruby", "php", "swift", "kotlin", "scala", "r", "dart", "html", "css", "sql", "bash",
    "react", "react.js", "reactjs", "next.js", "nextjs", "vue", "vue.js", "angular",
    "svelte", "ember", "redux", "tailwind", "bootstrap", "sass", "webpack", "vite",
    "node", "node.js", "nodejs", "express", "express.js", "fastapi", "flask", "django",
    "spring", "spring boot", "nest.js", "nestjs", "asp.net", "rails", "laravel",
    "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch", "sqlite",
    "dynamodb", "cassandra", "neo4j", "supabase", "firebase", "oracle", "mariadb",
    "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "terraform", "ansible",
    "jenkins", "github actions", "gitlab", "circleci", "nginx", "apache", "linux",
    "kafka", "rabbitmq", "celery", "graphql", "rest", "grpc", "websocket", "microservices",
    "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "keras", "opencv",
    "git", "jira", "confluence", "figma", "postman", "swagger", "datadog", "sentry",
    "prompt engineering", "langchain", "llama", "openai", "gemini", "rag", "vector db"
}


def extract_topics_from_text(text: str) -> Set[str]:
    """
    Pure Python, zero-LLM extraction of technical topics, skills, and concepts from text.
    Extracts terms matching the tech dictionary, camelCase/PascalCase tokens, and hyphenated tech terms.
    """
    if not text:
        return set()

    found: Set[str] = set()
    text_lower = text.lower()

    # 1. Match dictionary terms
    for term in _TECH_DICTIONARY:
        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, text_lower):
            found.add(term.title() if len(term) <= 4 else term.capitalize())

    # 2. Match camelCase, PascalCase, or Tech-Formatted words in original text (e.g. TensorFlow, FastAPI, MongoDB)
    tokens = re.findall(r"\b[A-Z][a-zA-Z0-9\+\#\.\-]{2,}\b", text)
    for token in tokens:
        if token.lower() not in {"the", "and", "for", "with", "this", "that", "from", "have", "been", "hello", "thanks"}:
            found.add(token)

    return found


def initialize_memory_from_prompt(
    store: AllowedTopicStore,
    system_prompt: str,
    topics_remaining: list = None,
    topics_covered: list = None
) -> None:
    """Parse Resume & JD from initial system prompt and state topics to seed AllowedTopicStore."""
    if system_prompt:
        extracted = extract_topics_from_text(system_prompt)
        store.add_topics(extracted, is_primary=True)

    if topics_remaining:
        store.add_topics(topics_remaining, is_primary=True)

    if topics_covered:
        store.add_topics(topics_covered, is_primary=True)


def update_memory_from_candidate(
    store: AllowedTopicStore,
    user_text: str,
    profile_skills: list = None,
    profile_tech: list = None
) -> None:
    """Expand AllowedTopicStore when candidate mentions new skills in spoken answers."""
    if user_text:
        spoken_topics = extract_topics_from_text(user_text)
        store.add_topics(spoken_topics, is_primary=False)

    if profile_skills:
        store.add_topics(profile_skills, is_primary=False)

    if profile_tech:
        store.add_topics(profile_tech, is_primary=False)
