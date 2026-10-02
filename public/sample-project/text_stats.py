"""Small text statistics: words, sentences and the most common words."""
from __future__ import annotations

from collections import Counter


def word_count(text: str) -> int:
    """How many words text has."""
    return len([word for word in text.split(" ") if word])


def sentence_count(text: str) -> int:
    """How many sentences text has, ending in ., ! or ?."""
    return sum(text.count(mark) for mark in ".!?")


def top_words(text: str, n: int = 3) -> list[tuple[str, int]]:
    """The n most common words, ignoring case and punctuation."""
    words = [word.strip(".,!?;:").lower() for word in text.split()]
    return Counter(word for word in words if word).most_common(n)
