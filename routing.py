from __future__ import annotations

import re
from typing import Any

from sednar.session import get_projected_messages

_CODEBASE_EVIDENCE_RE = re.compile(
    r"\b(api|json|response|payload|schema|endpoint|typescript|interface|"
    r"request\s+body|workorder|work\s*order)\b",
    re.IGNORECASE,
)
_FOLLOW_UP_RE = re.compile(
    r"\b(for this|for that|this one|that one|above|those|these|the same|it)\b",
    re.IGNORECASE,
)
_STRUCTURED_JSON_RE = re.compile(
    r"(json\s+response|api\s+response|sample\s+response|response\s+structure|"
    r"proper\s+api|response\s+example|example\s+response|response\s+payload|"
    r"payload\s+(?:example|structure|schema|format))",
    re.IGNORECASE,
)
_STRUCTURE_DISCUSSION_RE = re.compile(
    r"\b(structured_output|structured\s+output|sse|event\s+stream|payload)\b",
    re.IGNORECASE,
)
_FILE_DISCOVERY_RE = re.compile(
    r"\b(where is|find file|which file|locate|list.*files|file named|files? (?:for|named|called|matching))\b",
    re.IGNORECASE,
)
_USER_WEB_REQUEST_RE = re.compile(
    r"\b(search the (?:web|internet)|look (?:it )?up online|google (?:this|for)|"
    r"search online|check online|web search|from the internet|browse (?:to|this url)|"
    r"fetch (?:this )?url|read (?:this )?url|open (?:this )?link)\b|https?://",
    re.IGNORECASE,
)
_MCP_TOOL_INTENT_RE = re.compile(
    r"\b(mcp|mcps|enabled\s+(?:mcp|tool|server)s?|disabled\s+(?:mcp|tool|server)s?|"
    r"selected\s+(?:mcp|tool|server)s?|use\s+(?:a\s+)?(?:simple\s+)?mcp|"
    r"debug(?:ger)?\s+(?:session|sessions|breakpoint|breakpoints|stack|status)|"
    r"list\s+debug\s+sessions|airflow|s3|cloudwatch|mongodb|mongo|github|gh)\b",
    re.IGNORECASE,
)

_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey|thanks|thank you|thx|ok|okay|yo|cool|great|nice)(?:\s+(?:there|so much|a lot|again))?[\s!.?,:)]*$",
    re.IGNORECASE,
)
# "thanks, it works", "perfect, looks good now": the user is closing the loop, not asking for more.
_ACKNOWLEDGEMENT_RE = re.compile(
    r"^\s*(?:(?:ok(?:ay)?|thanks?|thank you|thx|great|perfect|awesome|nice|cool|good|sweet|brilliant|excellent|lgtm|yep|yes|got it|all good)[\s,.!]*)+"
    r"(?:(?:it|that|this|everything|the\s+\w+)\s+(?:works?|worked|looks?\s+good|fixed\s+it|did\s+it|solved\s+it|is\s+(?:fixed|working|fine|good|done|better))(?:\s+now)?|"
    r"(?:looks?|working)\s+(?:good|fine|great)(?:\s+now)?|works?(?:\s+now)?|fixed|done|all\s+good|no\s+more\s+(?:questions|changes))?[\s!.,:)]*$",
    re.IGNORECASE,
)
# A question about the code, not an instruction to change it: "why is the implementation slow?".
_QUESTION_RE = re.compile(
    r"^\s*(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:tell|explain|show|describe|help\s+me\s+understand)\b|"
    r"(?:why|what|how|is|are|does|do|did|where|which|who|when|whose|whom)\b)",
    re.IGNORECASE,
)
_POLITE_LEAD_RE = re.compile(r"^\s*(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?", re.IGNORECASE)
_META_RE = re.compile(
    r"\b(what can you do|your capabilities|how do you work|who are you)\b",
    re.IGNORECASE,
)
_CODE_CHANGE_RE = re.compile(
    r"\b(fix|bug|patch|implement|add test|write test|unit tests?|"
    r"exception|error handling|logging|refactor|update code|change code|bump|"
    r"rewrite|migrate|rename|convert|integrate|build (?:a|an|the|me)|create (?:a|an|the)|"
    r"add (?:a|an|the|support)|remove (?:the|all)|replace (?:the|all))\b",
    re.IGNORECASE,
)
_HARD_TASK_RE = re.compile(
    r"\b(refactor\w*|rewrit\w*|re-?architect\w*|redesign\w*|migrat\w*|overhaul\w*|"
    r"implement\w*|from scratch|end[- ]to[- ]end|"
    r"port (?:it|this|the)\b|convert (?:the|this|it|all)\b|"
    r"across (?:the )?(?:code ?base|repo|project|app|files|modules)|"
    r"(?:entire|whole) (?:code ?base|repo|project|app|module|system)|"
    r"all (?:the )?(?:files|modules|endpoints|components|call ?sites)|"
    r"every (?:file|module|component|endpoint|call ?site))",
    re.IGNORECASE,
)
_BULK_TASK_RE = re.compile(
    r"\b(across (?:the )?(?:code ?base|repo|project|app|files|modules)|(?:entire|whole) (?:code ?base|repo|project|app)|"
    r"all (?:the )?(?:files|modules|endpoints|components|call ?sites)|every (?:file|module|component|endpoint|call ?site))",
    re.IGNORECASE,
)


def is_question(question: str) -> bool:
    """A request for an explanation rather than a change ("why is X slow?", "could you explain Y?")."""
    q = (question or "").strip()
    if not q:
        return False
    if _QUESTION_RE.match(q):
        return True
    stripped = _POLITE_LEAD_RE.sub("", q)
    return bool(_QUESTION_RE.match(stripped)) and not _CODE_CHANGE_RE.match(stripped)


def is_hard_task(question: str) -> bool:
    q = question or ""
    if is_question(q) and not _BULK_TASK_RE.search(q):
        return False
    if _HARD_TASK_RE.search(q):
        return True
    return len(q) > 600 and bool(_CODE_CHANGE_RE.search(q))


def bump_for_hard_task(question: str, classification: dict[str, Any]) -> dict[str, Any]:
    if not is_hard_task(question):
        return classification
    out = dict(classification)
    out.update(
        is_meta=False,
        chat_only=False,
        is_actionable=True,
        expects_multi_step=True,
        complexity="complex",
        needs_flagship_model=True,
    )
    if str(out.get("goal_kind") or "") in ("", "meta", "analysis", "research") and _CODE_CHANGE_RE.search(question or ""):
        out["goal_kind"] = "code_change"
    if out.get("goal_kind") == "code_change":
        out["needs_code_execution"] = True
        if str(out.get("edit_scope") or "none") in ("none", "single_line", "single_file"):
            out["edit_scope"] = "multi_file"
    if _BULK_TASK_RE.search(question or ""):
        out["expects_bulk_work"] = True
        out["edit_scope"] = "bulk" if out.get("goal_kind") == "code_change" else out.get("edit_scope", "none")
    return out


# "bump the version to 2.1", "set version = '1.4.0'": an instruction with a target number, not a question
# about versions ("what version of node do I need?").
_VERSION_BUMP_RE = re.compile(
    r"\b(bump|update|change|set|increment|raise|upgrade)\b[^.?!]{0,40}\bversion\b|"
    r"\bversion\b[^.?!]{0,30}\b(?:to|=)\s*['\"]?v?\d",
    re.IGNORECASE,
)

def _intelligent_defaults(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "goal_kind": "analysis",
        "edit_scope": "none",
        "needs_flagship_model": False,
    }
    base.update(overrides)
    return base

def heuristic_classification(question: str, *, has_prior_turns: bool) -> dict[str, Any] | None:
    q = (question or "").strip()
    if not q:
        return None
    if _META_RE.search(q):
        return _intelligent_defaults(
            is_meta=True,
            is_actionable=False,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=True,
            expects_multi_step=False,
            complexity="simple",
            is_follow_up=False,
            prior_context_hint="",
            goal_kind="meta",
            edit_scope="none",
            needs_flagship_model=False,
        )
    if _GREETING_RE.match(q) or _ACKNOWLEDGEMENT_RE.match(q):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=False,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=True,
            expects_multi_step=False,
            complexity="simple",
            is_follow_up=False,
            prior_context_hint="",
            goal_kind="meta",
        )
    if _VERSION_BUMP_RE.search(q) and not is_question(q):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=True,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=False,
            expects_multi_step=True,
            complexity="medium",
            is_follow_up=bool(has_prior_turns and _FOLLOW_UP_RE.search(q)),
            prior_context_hint="",
            goal_kind="code_change",
            edit_scope="single_line",
            needs_flagship_model=False,
        )
    if needs_codebase_evidence(q, has_prior_turns=has_prior_turns):
        return _intelligent_defaults(
            is_meta=False,
            is_actionable=True,
            needs_local_save=False,
            expects_bulk_work=False,
            needs_code_execution=False,
            needs_shell=False,
            chat_only=False,
            expects_multi_step=True,
            complexity="medium",
            is_follow_up=bool(has_prior_turns and _FOLLOW_UP_RE.search(q)),
            prior_context_hint="",
            goal_kind="research",
        )
    return None

def get_session_chat_history_for_classify(
    project_path: str,
    session_id: str,
    current_question: str,
) -> list[dict[str, Any]]:
    projected = get_projected_messages(
        project_path, session_id, current_question, wrap_query=False,
    )
    if not projected:
        return []
    last = projected[-1]
    if last.get("role") == "user" and last.get("content") == current_question:
        return projected[:-1]
    return projected

def is_acknowledgement(question: str) -> bool:
    return bool(_GREETING_RE.match(question or "") or _ACKNOWLEDGEMENT_RE.match(question or ""))


def needs_codebase_evidence(question: str, *, has_prior_turns: bool = False) -> bool:
    q = (question or "").strip()
    if not q or is_acknowledgement(q):
        return False
    if _CODEBASE_EVIDENCE_RE.search(q):
        return True
    # A follow-up ("do the same for that one") needs the code; a closing remark ("thanks, it works") was ruled out above.
    return bool(has_prior_turns and _FOLLOW_UP_RE.search(q))

def wants_structured_json(question: str) -> bool:
    q = question or ""
    if not _STRUCTURED_JSON_RE.search(q):
        return False
    if _STRUCTURE_DISCUSSION_RE.search(q) and re.search(
        r"\b(what\s+happened|why|fix\s+it|improv|debug|aborted|sudden|this)\b",
        q,
        re.IGNORECASE,
    ):
        return False
    return True

def needs_file_discovery(question: str) -> bool:
    return bool(_FILE_DISCOVERY_RE.search(question or ""))

def user_requests_web_lookup(question: str) -> bool:
    return bool(_USER_WEB_REQUEST_RE.search(question or ""))

# An answer that stops to ask permission for the next step ("Shall I send it?", "Should I go ahead?").
_PERMISSION_RE = re.compile(
    r"(?:\b(?:shall|should|can|may)\s+i\b|\bdo\s+you\s+want\s+me\s+to\b|\bwould\s+you\s+like\s+me\s+to\b|\bwant\s+me\s+to\b|"
    r"\bis\s+it\s+ok(?:ay)?\s+(?:if|to)\b|\bready\s+(?:for\s+me\s+)?to\b|\bok(?:ay)?\s+to\b|\bconfirm\s+(?:that|whether|if)?\b|\blet\s+me\s+know\s+if\b)"
    r"[^?]{0,160}?\b(?P<verb>send|post|submit|publish|apply|book|buy|purchase|pay|place|proceed|go\s+ahead|continue|do\s+(?:it|that|this|so)|click|press|hit)\b[^?]{0,100}\?",
    re.I,
)


def asks_permission(answer: str) -> str:
    """The step a final answer stops to ask permission for, or "" when it does not."""
    tail = (answer or "").strip()[-500:]
    found = None
    for found in _PERMISSION_RE.finditer(tail):
        pass
    rest = tail[found.end():] if found else ""
    # Only when it ends the answer (a short "Let me know." after it is still the ending).
    if not found or "?" in rest or len(rest.strip(" \n\t*_)\"'")) > 60:
        return ""
    return re.sub(r"\s+", " ", found.group("verb").lower())


def user_requests_mcp_or_tool_use(question: str) -> bool:
    return bool(_MCP_TOOL_INTENT_RE.search(question or ""))

def needs_code_change(question: str, classification: dict[str, Any] | None) -> bool:
    cls = classification or {}
    if str(cls.get("goal_kind") or "").lower() == "code_change":
        return True
    if cls.get("needs_code_execution") or cls.get("needs_local_save"):
        return True
    if cls.get("expects_bulk_work"):
        return True
    if cls.get("is_actionable") and not cls.get("chat_only"):
        if _CODE_CHANGE_RE.search(question or ""):
            return True
    return False

def needs_flagship_edit(classification: dict[str, Any] | None) -> bool:
    cls = classification or {}
    if cls.get("needs_flagship_model"):
        return True
    scope = str(cls.get("edit_scope") or "").lower()
    if scope in ("multi_file", "bulk"):
        return True
    if cls.get("expects_bulk_work"):
        return True
    if str(cls.get("complexity") or "").lower() == "complex" and str(cls.get("goal_kind") or "") == "code_change":
        return True
    return False

def normalize_sednar_classification(
    question: str,
    classification: dict[str, Any],
    *,
    has_prior_turns: bool,
) -> dict[str, Any]:
    out = dict(classification)
    if not needs_codebase_evidence(question, has_prior_turns=has_prior_turns) and not user_requests_mcp_or_tool_use(question):
        return out
    out["chat_only"] = False
    out["is_actionable"] = True
    out["is_meta"] = False
    if out.get("complexity") == "simple":
        out["complexity"] = "medium"
    out["expects_multi_step"] = True
    return out

def pick_tool_choice(
    iteration: int,
    classification: dict[str, Any],
    question: str,
    *,
    has_prior_turns: bool = False,
    force_required: bool = False,
) -> str:
    if force_required:
        return "required"
    if iteration != 1:
        return "auto"
    if user_requests_mcp_or_tool_use(question):
        return "required"
    if not classification.get("is_actionable"):
        return "auto"
    if classification.get("is_meta") or classification.get("chat_only"):
        return "auto"
    if (
        classification.get("needs_shell")
        or classification.get("needs_local_save")
        or classification.get("expects_bulk_work")
    ):
        return "required"
    if classification.get("expects_multi_step") or classification.get("complexity") == "complex":
        return "required"
    if needs_codebase_evidence(question, has_prior_turns=has_prior_turns):
        return "required"
    if needs_file_discovery(question):
        return "required"
    return "auto"
