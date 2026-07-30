"""
similarity.py - Pure Python semantic similarity & token normalization.

Uses string normalization, filler word removal, word stem matching, Jaccard similarity, and
token/keyterm overlap algorithms to detect duplicate questions in O(n) time.
Zero LLM, zero embeddings, zero external API calls.
"""

import re
from typing import Set, Tuple

# Common question filler words that obscure core semantic intent
_FILLER_WORDS: Set[str] = {
    "can", "you", "could", "please", "tell", "me", "about", "explain", "describe",
    "how", "did", "what", "which", "why", "where", "when", "your", "the", "a", "an",
    "with", "for", "in", "on", "of", "to", "at", "by", "is", "are", "was", "were",
    "some", "any", "also", "would", "like", "us", "kindly", "give", "share", "used", "using",
    "techniques", "approach", "method", "work", "process"
}


def _stem_word(word: str) -> str:
    """Simple, fast, pure Python word stemmer for morphological variations."""
    if len(word) <= 4:
        return word
    for suffix in ("ing", "tion", "tions", "ment", "ments", "ed", "es", "s", "able", "ability", "ize", "ization", "ity"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[:-len(suffix)]
    return word[:5] if len(word) >= 6 else word


def normalize_question(text: str) -> Tuple[Set[str], Set[str], Set[str], str]:
    """
    Normalizes question text:
    1. Lowercase and remove punctuation.
    2. Extract all normalized word tokens.
    3. Extract core non-filler content tokens and stems.
    Returns (all_tokens, content_tokens, stem_tokens, cleaned_string).
    """
    if not text:
        return set(), set(), set(), ""

    cleaned = text.lower().strip()
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    words = [w for w in re.split(r"\s+", cleaned) if w]

    all_tokens = set(words)
    content_tokens = {w for w in words if w not in _FILLER_WORDS and len(w) > 1}
    stem_tokens = {_stem_word(w) for w in content_tokens}
    cleaned_string = " ".join(words)

    return all_tokens, content_tokens, stem_tokens, cleaned_string


def calculate_jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    """Calculate Jaccard similarity coefficient between two token sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = set_a.intersection(set_b)
    union = set_a.union(set_b)
    return len(intersection) / len(union)


def calculate_overlap_ratio(set_a: Set[str], set_b: Set[str]) -> float:
    """Calculate containment ratio of the smaller token set within the larger set."""
    if not set_a or not set_b:
        return 0.0
    intersection = set_a.intersection(set_b)
    min_size = min(len(set_a), len(set_b))
    return len(intersection) / min_size


def is_duplicate_question(new_q: str, existing_q: str, threshold: float = 0.80) -> bool:
    """
    Determines whether new_q is semantically equivalent to existing_q.
    """
    if not new_q or not existing_q:
        return False

    all_a, content_a, stems_a, clean_a = normalize_question(new_q)
    all_b, content_b, stems_b, clean_b = normalize_question(existing_q)

    # 1. Exact cleaned match
    if clean_a == clean_b and len(clean_a) > 5:
        return True

    if not content_a or not content_b:
        return False

    # 2. Content-token Jaccard similarity & Stem Jaccard similarity
    jaccard_content = calculate_jaccard_similarity(content_a, content_b)
    jaccard_stems = calculate_jaccard_similarity(stems_a, stems_b)
    if jaccard_content >= threshold or jaccard_stems >= threshold:
        return True

    # 3. Containment overlap on content & stems
    overlap_content = calculate_overlap_ratio(content_a, content_b)
    overlap_stems = calculate_overlap_ratio(stems_a, stems_b)
    if (overlap_content >= 0.70 or overlap_stems >= 0.70) and min(len(stems_a), len(stems_b)) >= 1:
        return True

    # 4. Shared technical keywords / stems with moderate overlap
    shared_stems = stems_a.intersection(stems_b)
    if len(shared_stems) >= 2 and overlap_stems >= 0.50:
        return True
    if len(shared_stems) >= 1 and overlap_stems >= 0.50 and min(len(stems_a), len(stems_b)) <= 2:
        return True

    return False
