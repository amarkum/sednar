from text_stats import sentence_count, top_words, word_count


def test_word_count_on_one_line():
    assert word_count("the quick brown fox") == 4


def test_sentence_count():
    assert sentence_count("Hi. How are you? Fine!") == 3


def test_top_words_ignores_case():
    assert top_words("The cat and the hat. THE end.", 1) == [("the", 3)]
