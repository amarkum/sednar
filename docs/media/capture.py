"""Takes the README screenshots and the demo GIF. It runs Sednar in hosted mode on a free local port with
a throwaway account and a scripted model, so it needs no API key and the agent's turn is the same every
time. The model's replies are canned; the tool calls they make run for real on the sample project.

Needs Google Chrome, Playwright for Python (pip install playwright) and Pillow.
Run from the repository's parent folder: python3 sednar/docs/media/capture.py"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
MODEL = "claude-sonnet-4-5"
PROMPT = "word_count gives the wrong answer for text with line breaks. Fix it and add a test."


def _call(name: str, **arguments) -> dict:
    return {"id": f"call_{uuid.uuid4().hex[:12]}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)}}


# The agent's side of the demo turn, one entry per model call that offers tools.
STEPS = [
    {"content": "Let me look at how `word_count` splits the text.",
     "tool_calls": [_call("read_repo_file", file_path="text_stats.py")]},
    {"content": "It splits on single spaces only, so `\"one\\ntwo\"` counts as one word. `str.split()` with no "
                "argument splits on any run of whitespace.",
     "tool_calls": [_call("edit_file", file_path="text_stats.py",
                          old_string='return len([word for word in text.split(" ") if word])',
                          new_string="return len(text.split())")]},
    {"content": "Now a test for text across lines.",
     "tool_calls": [_call("edit_file", file_path="test_text_stats.py",
                          old_string='    assert word_count("the quick brown fox") == 4\n',
                          new_string='    assert word_count("the quick brown fox") == 4\n\n\n'
                                     'def test_word_count_across_lines():\n'
                                     '    assert word_count("the quick\\nbrown  fox\\n") == 4\n')]},
]
FINAL = ("Fixed. `word_count` now uses `text.split()`, which splits on spaces, tabs and line breaks and ignores "
         "repeats, so `\"the quick\\nbrown  fox\\n\"` counts 4 words instead of 2.\n\n"
         "- `text_stats.py`: `word_count` uses `text.split()`.\n"
         "- `test_text_stats.py`: new `test_word_count_across_lines`.")
CLASSIFICATION = {"goal_kind": "code_change", "is_actionable": True, "chat_only": False, "complexity": "simple",
                  "edit_scope": "single_file", "needs_code_execution": False}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve(root: str, port: int) -> None:
    """Runs in a child process: Sednar with the scripted model."""
    os.environ.update({"SEDNAR_PUBLIC": "1", "SEDNAR_PUBLIC_ROOT": root, "SEDNAR_PORT": str(port),
                       "SEDNAR_HOST": "127.0.0.1", "SEDNAR_SECRET_KEY": uuid.uuid4().hex, "HOME": root})
    sys.path.insert(0, os.path.dirname(REPO))
    from sednar.llm import router, settings

    turns: dict[str, int] = {}
    lock = threading.Lock()

    def complete_with_tools(self, model, messages, tools, **kwargs):
        if not tools:
            return {"content": json.dumps(CLASSIFICATION)}
        first = next((str(m.get("content")) for m in messages if m.get("role") == "user"), "")
        with lock:
            n = turns.get(first, 0)
            turns[first] = n + 1
        time.sleep(1.2)  # Long enough for the GIF to show each step arrive.
        step = STEPS[n] if n < len(STEPS) else {"content": FINAL}
        return dict(step, prompt_tokens=1800, completion_tokens=120)

    def complete(self, model, messages, **kwargs):
        text = " ".join(str(m.get("content")) for m in messages)
        if "title" in text.lower():
            return "Fix word_count across lines"
        return json.dumps(CLASSIFICATION)

    def stream(self, model, messages, **kwargs):
        for word in FINAL.split(" "):
            time.sleep(0.03)
            yield word + " "

    router.LLMRouter.complete_with_tools = complete_with_tools
    router.LLMRouter.complete = complete
    router.LLMRouter.stream = stream
    router.LLMRouter.supports_model = lambda self, model: True
    settings._fetch_model_ids = lambda provider, key: [MODEL, "claude-haiku-4-5", "claude-opus-4-1"]
    import runpy
    sys.argv = [os.path.join(REPO, "server.py")]
    runpy.run_path(sys.argv[0], run_name="__main__")


def capture(base: str, out: str, frames: str) -> None:
    from playwright.sync_api import sync_playwright

    shot = 0

    def frame(page, hold: int = 1) -> None:
        nonlocal shot
        for _ in range(hold):
            page.screenshot(path=os.path.join(frames, f"{shot:04d}.png"))
            shot += 1

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page.on("pageerror", lambda e: print("page error:", e))
        page.on("console", lambda m: m.type == "error" and print("console error:", m.text))
        page.goto(base + "/signup")
        page.screenshot(path=os.path.join(out, "sign-in.png"))
        page.fill("input[name=email]", "demo@example.test")
        page.fill("input[name=password]", "demo-password-" + uuid.uuid4().hex[:8])
        page.click("button[type=submit]")
        page.wait_for_selector("#sednar-chat-input", timeout=30000)
        page.evaluate("""() => fetch('/sednar/llm/settings', {method: 'POST', headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({provider: 'anthropic', api_key: 'demo-placeholder-not-a-key'})})""")
        page.reload()
        page.wait_for_selector("#sednar-chat-input")
        page.wait_for_timeout(2500)
        if page.locator(".lc-public-welcome").count():
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
        frame(page, 6)

        page.get_by_text("text_stats.py", exact=True).first.click()
        page.wait_for_selector(".monaco-editor .view-lines")
        page.wait_for_timeout(1200)
        frame(page, 6)

        page.click("#sednar-chat-input")
        for i in range(0, len(PROMPT), 6):
            page.keyboard.type(PROMPT[i:i + 6])
            frame(page)
        frame(page, 3)
        page.keyboard.press("Enter")
        deadline = time.time() + 60
        while time.time() < deadline:
            page.wait_for_timeout(500)
            frame(page)
            if page.locator("#sednar-chat-messages").get_by_text("test_word_count_across_lines").count() and \
                    not page.locator(".is-running, .sednar-turn-running").count():
                break
        page.wait_for_timeout(1500)
        frame(page, 8)
        page.screenshot(path=os.path.join(out, "agent.png"))

        page.get_by_text("test_text_stats.py", exact=True).first.click()
        page.wait_for_timeout(1500)
        frame(page, 6)
        page.screenshot(path=os.path.join(out, "editor.png"))

        page.click("#sednar-settings-open")
        page.wait_for_selector("#sednar-settings-page")
        page.wait_for_timeout(800)
        frame(page, 6)
        page.screenshot(path=os.path.join(out, "settings.png"))
        page.keyboard.press("Escape")
        browser.close()


def make_gif(frames: str, gif: str) -> None:
    from PIL import Image

    names = sorted(f for f in os.listdir(frames) if f.endswith(".png"))
    images = []
    for name in names:
        with Image.open(os.path.join(frames, name)) as im:
            im = im.convert("RGB")
            im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
            images.append(im.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    images[0].save(gif, save_all=True, append_images=images[1:], duration=250, loop=0, optimize=True)


def main() -> None:
    if len(sys.argv) == 4 and sys.argv[1] == "--serve":
        serve(sys.argv[2], int(sys.argv[3]))
        return
    root = tempfile.mkdtemp(prefix="sednar-media-")
    frames = os.path.join(root, "frames")
    os.makedirs(frames)
    port = _free_port()
    server = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--serve", root, str(port)],
                              stdout=open(os.path.join(root, "server.log"), "w"), stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                time.sleep(0.5)
        capture(base, HERE, frames)
        make_gif(frames, os.path.join(HERE, "demo.gif"))
        print("Wrote", ", ".join(sorted(f for f in os.listdir(HERE) if f.endswith((".png", ".gif")))))
    finally:
        server.terminate()
        server.wait(10)
        if os.environ.get("KEEP"):
            print("Kept", root)
        else:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
