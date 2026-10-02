"""The prompts render: a stray brace in the system prompt's f-string broke every turn once."""
import string

from sednar import prompts


def test_system_prompt_renders():
    text = prompts.build_system_prompt("/tmp/project", has_project_rules=False)
    assert "restart_command" in text and "built-in browser" not in text


def test_every_template_formats_with_its_fields():
    for name in dir(prompts):
        if not name.endswith("_TEMPLATE"):
            continue
        template = getattr(prompts, name)
        fields = {f for _, f, _, _ in string.Formatter().parse(template) if f}
        template.format(**{f: "x" for f in fields})


def test_no_hardcoded_python_quality_guidance_or_commit_trailer():
    text = prompts.build_system_prompt("/tmp/project", has_project_rules=False)
    for gone in ("pre-commit", "SonarQube", "ruff", "black --check", "committer@sednar.ai"):
        assert gone not in text
    assert not hasattr(prompts, "SEDNAR_COMPACT_SYSTEM_PROMPT")


def test_git_commits_run_as_written():
    from sednar import tools
    assert not hasattr(tools, "inject_sednar_commit_coauthor")
    spec = next(t for t in tools.SEDNAR_TOOLS if t["function"]["name"] == "run_command")
    assert "Co-authored-by" not in spec["function"]["description"]


READ_ONLY = ["glob_files", "grep_repo", "read_repo_file", "find_symbol", "ask_question", "attempt_completion"]


def test_the_prompt_lists_only_the_tools_offered():
    text = prompts.build_system_prompt("/tmp/project", mode="ask", tool_names=READ_ONLY)
    assert "**Tools this turn:** glob_files, grep_repo, read_repo_file, find_symbol, ask_question, attempt_completion." in text
    for absent in ("**Editing:**", "**Commands:**", "**Verifying:**", "**Parallel agents:**", "**Task list:**", "write_file", "run_command", "spawn_subagent"):
        assert absent not in text, absent
    assert "**Asking:**" in text and "shall I send it" not in text


def test_agent_mode_with_every_tool_has_the_working_sections():
    text = prompts.build_system_prompt("/tmp/project", mode="agent")
    for present in ("**Editing:**", "**Commands:**", "**Verifying:**", "**Parallel agents:**", "**Task list:**"):
        assert present in text, present
    assert "pre-authenticated" not in text and "Sednar PAT" not in text


def test_paragraphs_are_readable():
    text = prompts.build_system_prompt("/tmp/project", mode="agent")
    longest = max(len(p) for p in text.split("\n\n"))
    assert longest < 1500, longest
