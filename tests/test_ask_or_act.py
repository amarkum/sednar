"""Reading an answer that stops to ask permission for its next step."""
import pytest

from sednar.routing import asks_permission


@pytest.mark.parametrize("answer, verb", [
    ("I've typed the message. Shall I send it?", "send"),
    ("The message is ready. Do you want me to send it now?", "send"),
    ("Shall I send it? Let me know.", "send"),
    ("Should I go ahead?", "go ahead"),
    ("I opened the page. Would you like me to click Submit?", "click"),
    ("Done. Want me to also add tests?", ""),
    ("Sent it to Gurubani.", ""),
    ("Shall I send it? Also, which font do you prefer?", ""),
])
def test_asks_permission(answer, verb):
    assert asks_permission(answer) == verb
