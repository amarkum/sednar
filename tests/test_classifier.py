"""How a request is read before any model sees it: closing remarks, questions, version bumps, hard tasks."""
import pytest

from sednar.routing import (
    heuristic_classification,
    is_acknowledgement,
    is_hard_task,
    is_question,
    needs_codebase_evidence,
)


@pytest.mark.parametrize("text", ["thanks, it works", "perfect, looks good now!", "ok great", "Thank you! That fixed it.", "lgtm", "nice, all good"])
def test_closing_remarks_are_chat_only(text):
    assert is_acknowledgement(text)
    cls = heuristic_classification(text, has_prior_turns=True)
    assert cls and cls["chat_only"] and not cls["is_actionable"]
    assert not needs_codebase_evidence(text, has_prior_turns=True)


@pytest.mark.parametrize("text", ["do the same for that one", "now fix it in the other file too", "and make these green"])
def test_real_follow_ups_still_need_the_code(text):
    assert needs_codebase_evidence(text, has_prior_turns=True)


def test_a_question_about_versions_is_not_a_version_bump():
    assert heuristic_classification("what version of node do I need to install?", has_prior_turns=False) is None
    bump = heuristic_classification("bump the version to 2.1.0", has_prior_turns=False)
    assert bump and bump["goal_kind"] == "code_change" and bump["edit_scope"] == "single_line"
    assert heuristic_classification("set version = '1.4.0' in pyproject", has_prior_turns=False)["goal_kind"] == "code_change"


@pytest.mark.parametrize("text, question, hard", [
    ("why is the implementation of foo slow?", True, False),
    ("could you explain how the migration works?", True, False),
    ("refactor the whole codebase to use async", False, True),
    ("Could you refactor the whole codebase to use async?", False, True),
    ("implement the new billing flow across all modules", False, True),
    ("how do I add a route?", True, False),
])
def test_questions_are_not_hard_tasks(text, question, hard):
    assert is_question(text) is question
    assert is_hard_task(text) is hard
