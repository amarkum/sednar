// Host-page helpers the Sednar frontend expects (chat composer, @-mentions,
// attachments, markdown rendering, model picker). Ported from the original
// sednar common.js; only the pieces Sednar calls are included.

window.SEDNAR_MODEL_OPTIONS = [{ value: "auto", label: "Auto" }];

window.getChatbotModelOptions = function() {
  return window.SEDNAR_MODEL_OPTIONS.slice();
};

window.sednarChatWaitingMarkup = function() {
  return '<div class="wb-chat-waiting" aria-busy="true" aria-label="Loading">' + '<span class="wb-chat-wait-dot"></span>' + '<span class="wb-chat-wait-dot"></span>' + '<span class="wb-chat-wait-dot"></span>' + "</div>";
};

window.sednarCommandHeaderLabel = function(command) {
  let s = String(command || "").trim();
  if (!s) return "command";
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\$\s*/, "");
  const truncate = label => {
    const t = String(label || "").trim();
    if (t.length <= 48) return t;
    return t.slice(0, 45) + "...";
  };
  const heredocMatch = s.match(/^([^\s|;&]+(?:\s+-[a-zA-Z]?)?)\s+(?:<<-?|<<)\s*['"]?/);
  if (heredocMatch) return truncate(heredocMatch[1]);
  const chainParts = s.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
  let primary = chainParts[0].trim();
  if (chainParts.length > 1 && /^cd\s+/i.test(primary)) {
    const rest = chainParts.slice(1).join(" && ").trim();
    if (rest) return window.sednarCommandHeaderLabel(rest);
  }
  const tokens = primary.split(/\s+/);
  if (tokens.length === 1) return truncate(tokens[0]);
  const exe = tokens[0];
  const sub = tokens[1];
  if (sub === "-m" && tokens[2]) return truncate(`${exe} -m ${tokens[2]}`);
  const withSub = ["git", "npm", "pnpm", "yarn", "bun", "docker", "kubectl", "aws", "gcloud", "go", "cargo", "make", "pip", "pip3"];
  const exeBase = exe.replace(/^\.\//, "");
  if (withSub.includes(exeBase) && sub && !sub.startsWith("-")) {
    return truncate(`${exe} ${sub}`);
  }
  if (sub && sub.startsWith("-") && tokens.length === 2) return truncate(`${exe} ${sub}`);
  return truncate(exe);
};

let _monacoHighlightContainer = null;

function _monacoSizingTarget(el) {
  if (_monacoHighlightContainer) return _monacoHighlightContainer;
  if (el && el.closest) return el;
  return null;
}

function _monacoUseInheritedSizing(el) {
  const target = _monacoSizingTarget(el);
  if (!target || !target.closest) return false;
  return !!target.closest(".mdpdf-preview-body, #sednar-chat-messages, #lazie-output");
}

function _monacoUseCompactSizing(el) {
  const target = _monacoSizingTarget(el);
  if (!target || !target.closest) return false;
  const isJsonBlock = target.classList && (target.classList.contains("language-json") || !!target.closest(".lazie-json-content, .sednar-json-content"));
  return isJsonBlock || !!target.closest("#lazie-output, #sednar-chat-messages, #airflow-debug-output, #chatbot-output, .chat-output, #files-chat-messages, #mongodb-chat-messages");
}

function _applyMonacoFontSizing(el) {
  if (!el || !el.style) return;
  if (_monacoUseInheritedSizing(el)) {
    el.style.fontSize = "";
    el.style.lineHeight = "";
    return;
  }
  if (_monacoUseCompactSizing(el)) {
    el.style.fontSize = "11.5px";
    el.style.lineHeight = "1.5";
    return;
  }
  el.style.fontSize = "14px";
  el.style.lineHeight = "1.6";
}

function createSpan(className, text, parentElement) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  span.style.fontFamily = "'SednarMono', Consolas, 'Liberation Mono', 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
  _applyMonacoFontSizing(parentElement || span);
  return span;
}

function createTextSpan(text, parentElement) {
  const span = document.createElement("span");
  span.textContent = text;
  span.style.fontFamily = "'SednarMono', Consolas, 'Liberation Mono', 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
  _applyMonacoFontSizing(parentElement || span);
  return span;
}

function highlightPython(container, code) {
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n"));
    let pos = 0;
    const tokens = [];
    const commentMatch = line.match(/(.*?)(#.*$)/);
    let lineContent = line;
    let comment = "";
    if (commentMatch) {
      lineContent = commentMatch[1];
      comment = commentMatch[2];
    }
    const keywordRegex = /\b(def|class|import|from|as|if|else|elif|for|while|try|except|finally|with|return|yield|break|continue|pass|and|or|not|in|is|True|False|None)\b/g;
    const functionRegex = /\b(print|input|len|range|str|int|float|list|dict|set|tuple)\b/g;
    const stringRegex = /(".*?"|'.*?')/g;
    const numberRegex = /\b(\d+\.?\d*)\b/g;
    let lastIndex = 0;
    const matches = [];
    let match;
    while ((match = keywordRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "keyword"
      });
    }
    while ((match = functionRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "function"
      });
    }
    while ((match = stringRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "string"
      });
    }
    while ((match = numberRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "number"
      });
    }
    matches.sort((a, b) => a.start - b.start);
    let currentPos = 0;
    matches.forEach(match => {
      if (match.start > currentPos) {
        container.appendChild(createTextSpan(lineContent.slice(currentPos, match.start)));
      }
      container.appendChild(createSpan("monaco-" + match.type, match.text));
      currentPos = match.end;
    });
    if (currentPos < lineContent.length) {
      container.appendChild(createTextSpan(lineContent.slice(currentPos)));
    }
    if (comment) {
      container.appendChild(createSpan("monaco-comment", comment));
    }
  });
}

function highlightJavaScript(container, code) {
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n"));
    const commentMatch = line.match(/(.*?)(\/\/.*$|\/\*[\s\S]*?\*\/)/);
    let lineContent = line;
    let comment = "";
    if (commentMatch) {
      lineContent = commentMatch[1];
      comment = commentMatch[2];
    }
    const keywordRegex = /\b(function|var|let|const|if|else|for|while|do|switch|case|default|try|catch|finally|throw|return|break|continue|class|extends|constructor|static|async|await|import|export|from|as|new|this|super|null|undefined|true|false)\b/g;
    const functionRegex = /\b(console|document|window|Array|Object|String|Number|Boolean|Math|Date|JSON|Promise|setTimeout|setInterval|alert|prompt|confirm)\b/g;
    const stringRegex = /(".*?"|'.*?'|`.*?`)/g;
    const numberRegex = /\b(\d+\.?\d*)\b/g;
    const matches = [];
    let match;
    while ((match = keywordRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "keyword"
      });
    }
    while ((match = functionRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "function"
      });
    }
    while ((match = stringRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "string"
      });
    }
    while ((match = numberRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "number"
      });
    }
    matches.sort((a, b) => a.start - b.start);
    let currentPos = 0;
    matches.forEach(match => {
      if (match.start > currentPos) {
        container.appendChild(createTextSpan(lineContent.slice(currentPos, match.start)));
      }
      container.appendChild(createSpan("monaco-" + match.type, match.text));
      currentPos = match.end;
    });
    if (currentPos < lineContent.length) {
      container.appendChild(createTextSpan(lineContent.slice(currentPos)));
    }
    if (comment) {
      container.appendChild(createSpan("monaco-comment", comment));
    }
  });
}

function highlightShell(container, code) {
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n"));
    const commentMatch = line.match(/(.*?)(#.*$)/);
    let lineContent = line;
    let comment = "";
    if (commentMatch) {
      lineContent = commentMatch[1];
      comment = commentMatch[2];
    }
    const keywordRegex = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|break|continue|echo|printf|read|cd|ls|mkdir|rm|cp|mv|grep|find|curl|wget|sudo|chmod|chown|ps|kill|top|tar|zip|unzip|git|npm|pip|javac|java)\b/g;
    const flagRegex = /(-+[a-zA-Z0-9\-]+)/g;
    const stringRegex = /(".*?"|'.*?')/g;
    const matches = [];
    let match;
    while ((match = keywordRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "keyword"
      });
    }
    while ((match = flagRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "function"
      });
    }
    while ((match = stringRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "string"
      });
    }
    matches.sort((a, b) => a.start - b.start);
    let currentPos = 0;
    matches.forEach(match => {
      if (match.start > currentPos) {
        container.appendChild(createTextSpan(lineContent.slice(currentPos, match.start)));
      }
      container.appendChild(createSpan("monaco-" + match.type, match.text));
      currentPos = match.end;
    });
    if (currentPos < lineContent.length) {
      container.appendChild(createTextSpan(lineContent.slice(currentPos)));
    }
    if (comment) {
      container.appendChild(createSpan("monaco-comment", comment));
    }
  });
}

function highlightJava(container, code) {
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n"));
    const commentMatch = line.match(/(.*?)(\/\/.*$|\/\*[\s\S]*?\*\/)/);
    let lineContent = line;
    let comment = "";
    if (commentMatch) {
      lineContent = commentMatch[1];
      comment = commentMatch[2];
    }
    const keywordRegex = /\b(public|private|protected|static|final|abstract|class|interface|extends|implements|import|package|if|else|for|while|do|switch|case|default|try|catch|finally|throw|throws|return|break|continue|new|this|super|null|true|false|void)\b/g;
    const typeRegex = /\b(int|long|short|byte|float|double|boolean|char|String|Object|Integer|Long|Short|Byte|Float|Double|Boolean|Character|List|ArrayList|Map|HashMap|Set|HashSet)\b/g;
    const functionRegex = /\b(System|out|println|print|length|size|get|put|add|remove|contains|isEmpty|equals|toString|parseInt|parseDouble|valueOf)\b/g;
    const stringRegex = /(".*?")/g;
    const numberRegex = /\b(\d+\.?\d*[fFdDlL]?)\b/g;
    const matches = [];
    let match;
    while ((match = keywordRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "keyword"
      });
    }
    while ((match = typeRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "type"
      });
    }
    while ((match = functionRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "function"
      });
    }
    while ((match = stringRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "string"
      });
    }
    while ((match = numberRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "number"
      });
    }
    matches.sort((a, b) => a.start - b.start);
    let currentPos = 0;
    matches.forEach(match => {
      if (match.start > currentPos) {
        container.appendChild(createTextSpan(lineContent.slice(currentPos, match.start)));
      }
      container.appendChild(createSpan("monaco-" + match.type, match.text));
      currentPos = match.end;
    });
    if (currentPos < lineContent.length) {
      container.appendChild(createTextSpan(lineContent.slice(currentPos)));
    }
    if (comment) {
      container.appendChild(createSpan("monaco-comment", comment));
    }
  });
}

function highlightHTML(container, code) {
  
  const STATES = { TEXT: 0, TAG_OPEN: 1, TAG_NAME: 2, ATTR_KEY: 3, ATTR_VALUE: 4, COMMENT: 5 };
  let state = STATES.TEXT;
  let buf = "";
  let i = 0;

  function flush(cls) {
    if (!buf) return;
    if (cls) {
      
      const parts = buf.split("\n");
      parts.forEach((part, idx) => {
        if (idx > 0) container.appendChild(createTextSpan("\n"));
        if (part) container.appendChild(createSpan(cls, part));
      });
    } else {
      const parts = buf.split("\n");
      parts.forEach((part, idx) => {
        if (idx > 0) container.appendChild(createTextSpan("\n"));
        if (part) container.appendChild(createTextSpan(part));
      });
    }
    buf = "";
  }

  while (i < code.length) {
    const ch = code[i];

    if (state === STATES.TEXT) {
      if (code.startsWith("<!--", i)) {
        flush(null);
        state = STATES.COMMENT;
        buf = "<!--";
        i += 4;
        continue;
      } else if (ch === "<") {
        flush(null);
        state = STATES.TAG_OPEN;
        buf = "<";
        i++;
        continue;
      }
      buf += ch;

    } else if (state === STATES.COMMENT) {
      buf += ch;
      if (buf.endsWith("-->")) {
        flush("monaco-comment");
        state = STATES.TEXT;
      }

    } else if (state === STATES.TAG_OPEN) {
      
      if (ch === ">") {
        buf += ch;
        
        _emitTagSpans(container, buf);
        buf = "";
        state = STATES.TEXT;
      } else if (ch === "<") {
        
        flush(null);
        buf = "<";
      } else {
        buf += ch;
      }
    }

    i++;
  }

  
  if (buf) flush(state === STATES.TAG_OPEN ? "monaco-keyword" : (state === STATES.COMMENT ? "monaco-comment" : null));
}

function _emitTagSpans(container, tag) {
  
  
  let i = 0;
  let buf = "";
  let inQuote = false;
  let quoteChar = "";

  function appendSpan(text, cls) {
    if (!text) return;
    if (cls) container.appendChild(createSpan(cls, text));
    else container.appendChild(createTextSpan(text));
  }

  while (i < tag.length) {
    const ch = tag[i];
    if (!inQuote && (ch === '"' || ch === "'")) {
      appendSpan(buf, "monaco-keyword");
      buf = ch;
      inQuote = true;
      quoteChar = ch;
    } else if (inQuote && ch === quoteChar) {
      buf += ch;
      appendSpan(buf, "monaco-string");
      buf = "";
      inQuote = false;
    } else {
      buf += ch;
    }
    i++;
  }
  appendSpan(buf, inQuote ? "monaco-string" : "monaco-keyword");
}

function highlightCSS(container, code) {
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n"));
    const commentMatch = line.match(/(.*?)(\/\*[\s\S]*?\*\/)/);
    let lineContent = line;
    let comment = "";
    if (commentMatch) {
      lineContent = commentMatch[1];
      comment = commentMatch[2];
    }
    const selectorRegex = /([.#]?[a-zA-Z][a-zA-Z0-9_-]*(?:\s*[>+~]\s*[a-zA-Z][a-zA-Z0-9_-]*)*)\s*\{/g;
    const propertyRegex = /([a-zA-Z-]+)\s*:/g;
    const valueRegex = /:\s*([^;{}]+)/g;
    const stringRegex = /(".*?"|'.*?')/g;
    const matches = [];
    let match;
    while ((match = selectorRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[1].length,
        text: match[1],
        type: "keyword"
      });
    }
    while ((match = propertyRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[1].length,
        text: match[1],
        type: "function"
      });
    }
    while ((match = stringRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "string"
      });
    }
    matches.sort((a, b) => a.start - b.start);
    let currentPos = 0;
    matches.forEach(match => {
      if (match.start > currentPos) {
        container.appendChild(createTextSpan(lineContent.slice(currentPos, match.start)));
      }
      container.appendChild(createSpan("monaco-" + match.type, match.text));
      currentPos = match.end;
    });
    if (currentPos < lineContent.length) {
      container.appendChild(createTextSpan(lineContent.slice(currentPos)));
    }
    if (comment) {
      container.appendChild(createSpan("monaco-comment", comment));
    }
  });
}

function highlightJSON(container, code) {
  if (!container || !container.appendChild) return;
  const lines = code.split("\n");
  const codeElement = container.closest ? container.closest("code") : container.parentElement && container.parentElement.tagName === "CODE" ? container.parentElement : null;
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n", codeElement));
    const tokens = [];
    let pos = 0;
    while (pos < line.length) {
      const stringMatch = line.slice(pos).match(/^"((?:[^"\\]|\\.)*)"/);
      if (stringMatch) {
        const fullMatch = stringMatch[0];
        const remaining = line.slice(pos + fullMatch.length);
        const nextNonWhitespace = remaining.match(/^\s*(\S)/);
        if (nextNonWhitespace && nextNonWhitespace[1] === ":") {
          tokens.push({
            start: pos,
            end: pos + fullMatch.length,
            text: fullMatch,
            type: "property"
          });
        } else {
          tokens.push({
            start: pos,
            end: pos + fullMatch.length,
            text: fullMatch,
            type: "string"
          });
        }
        pos += fullMatch.length;
        continue;
      }
      const numberMatch = line.slice(pos).match(/^-?\d+\.?\d*(?:[eE][+-]?\d+)?/);
      if (numberMatch) {
        tokens.push({
          start: pos,
          end: pos + numberMatch[0].length,
          text: numberMatch[0],
          type: "number"
        });
        pos += numberMatch[0].length;
        continue;
      }
      const keywordMatch = line.slice(pos).match(/^(true|false|null)\b/);
      if (keywordMatch) {
        tokens.push({
          start: pos,
          end: pos + keywordMatch[0].length,
          text: keywordMatch[0],
          type: "keyword"
        });
        pos += keywordMatch[0].length;
        continue;
      }
      pos++;
    }
    let currentPos = 0;
    tokens.forEach(token => {
      if (token.start > currentPos) {
        container.appendChild(createTextSpan(line.slice(currentPos, token.start), codeElement));
      }
      const span = createSpan("monaco-" + token.type, token.text, codeElement);
      container.appendChild(span);
      currentPos = token.end;
    });
    if (currentPos < line.length) {
      container.appendChild(createTextSpan(line.slice(currentPos), codeElement));
    }
  });
}

function highlightGeneric(container, code) {
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(createTextSpan("\n", container));
    const commentMatch = line.match(/(.*?)(#.*$|\/\/.*$|\/\*[\s\S]*?\*\/)/);
    let lineContent = line;
    let comment = "";
    if (commentMatch) {
      lineContent = commentMatch[1];
      comment = commentMatch[2];
    }
    const stringRegex = /(".*?"|'.*?')/g;
    const numberRegex = /\b(\d+\.?\d*)\b/g;
    const matches = [];
    let match;
    while ((match = stringRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "string"
      });
    }
    while ((match = numberRegex.exec(lineContent)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        type: "number"
      });
    }
    matches.sort((a, b) => a.start - b.start);
    let currentPos = 0;
    matches.forEach(match => {
      if (match.start > currentPos) {
        container.appendChild(createTextSpan(lineContent.slice(currentPos, match.start), container));
      }
      container.appendChild(createSpan("monaco-" + match.type, match.text, container));
      currentPos = match.end;
    });
    if (currentPos < lineContent.length) {
      container.appendChild(createTextSpan(lineContent.slice(currentPos), container));
    }
    if (comment) {
      container.appendChild(createSpan("monaco-comment", comment));
    }
  });
}

function _normalizeBlockCodeText(code) {
  if (!code) return code;
  let normalized = code.replace(/^(?:[ \t]*\r?\n)+/, "");
  const firstBreak = normalized.indexOf("\n");
  if (firstBreak === -1) {
    return normalized.replace(/^[ \t]+/, "");
  }
  return normalized.slice(0, firstBreak).replace(/^[ \t]+/, "") + normalized.slice(firstBreak);
}

function _normalizeInlineChatCode(container) {
  if (!container) return;
  
  container.querySelectorAll("table code").forEach(codeEl => {
    if (!codeEl || codeEl.closest("pre")) return;
    const parent = codeEl.parentNode;
    if (!parent) return;
    while (codeEl.firstChild) parent.insertBefore(codeEl.firstChild, codeEl);
    parent.removeChild(codeEl);
  });
  container.querySelectorAll("code").forEach(codeEl => {
    if (!codeEl || codeEl.closest("pre") || codeEl.closest("table")) return;
    const text = codeEl.textContent || "";
    const trimmed = text.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    if (trimmed !== text) codeEl.textContent = trimmed;
  });
}

function applyMonacoStyling(codeEl, code, lang) {
  if (!codeEl || !codeEl.dataset) return;
  code = _normalizeBlockCodeText(code);
  codeEl.innerHTML = "";
  codeEl.style.fontFamily = "'SednarMono', Consolas, 'Liberation Mono', 'Courier New', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
  codeEl.style.fontVariantLigatures = "contextual";
  _monacoHighlightContainer = codeEl;
  try {
    if (lang === "python") {
      highlightPython(codeEl, code);
    } else if (lang === "javascript" || lang === "js" || lang === "jsx" || lang === "ts" || lang === "tsx") {
      highlightJavaScript(codeEl, code);
    } else if (lang === "java") {
      highlightJava(codeEl, code);
    } else if (lang === "html" || lang === "xml") {
      highlightHTML(codeEl, code);
    } else if (lang === "css" || lang === "scss" || lang === "sass") {
      highlightCSS(codeEl, code);
    } else if (lang === "sh" || lang === "bash" || lang === "shell") {
      highlightShell(codeEl, code);
    } else if (lang === "json") {
      highlightJSON(codeEl, code);
    } else {
      highlightGeneric(codeEl, code);
    }
    codeEl.querySelectorAll("span").forEach(function(span) {
      _applyMonacoFontSizing(span);
    });
    _applyMonacoFontSizing(codeEl);
  } finally {
    _monacoHighlightContainer = null;
  }
}

function _compactMarkdownGlobal(md) {
  const lines = md.split("\n");
  let out = [];
  let inFence = false;
  let emptyCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^(`{3,})/.test(trimmed)) {
      inFence = !inFence;
      emptyCount = 0;
      out.push(line);
      continue;
    }
    if (!inFence) {
      if (trimmed === "") {
        emptyCount++;
        if (emptyCount <= 1) out.push("");
      } else {
        emptyCount = 0;
        out.push(line);
      }
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function normalizeLazieMarkdownCodeFences(text) {
  const raw = String(text || "");
  if (/```/.test(raw)) return raw;
  const lines = raw.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(import |from .+ import |def |class |@|if __name__|#!\/)/.test(line) || /^\s*(const |let |var |function |public |package |#include)/.test(line)) {
      start = i;
      break;
    }
  }
  if (start < 0) return raw;
  let end = start;
  while (end + 1 < lines.length) {
    const next = lines[end + 1];
    const trimmed = next.trim();
    if (!trimmed) {
      end++;
      continue;
    }
    if (/^\s*(import |from |def |class |@|if |elif |else:|for |while |try:|except |finally:|return |print|#|    |"""|''')/.test(next) || /^\s*[\)}\]]\s*(#.*)?$/.test(next) || /^\s*[a-zA-Z_][\w.]*\s*[=\(]/.test(next)) {
      end++;
    } else {
      break;
    }
  }
  const intro = lines.slice(0, start).join("\n").trimEnd();
  const code = lines.slice(start, end + 1).join("\n").trimEnd();
  const outro = lines.slice(end + 1).join("\n").trim();
  let lang = "text";
  if (/\b(import |def |print\(|pyttsx3|__name__)/.test(code)) lang = "python"; else if (/\b(function |const |let |console\.)/.test(code)) lang = "javascript"; else if (/\b(public class |System\.out)/.test(code)) lang = "java";
  let result = intro ? `${intro}\n\n` : "";
  result += "```" + lang + "\n" + code + "\n```";
  if (outro) result += "\n\n" + outro;
  return result;
}

function _convertAsciiTableToMarkdownGlobal(asciiTable) {
  const lines = asciiTable.split("\n").map(line => line.trim());
  if (lines.length < 3) return null;
  if (!lines[0].includes("+") || !lines[0].includes("-")) return null;
  const dataRows = [];
  let currentRow = [];
  for (let line of lines) {
    if (line.startsWith("+") && line.includes("-")) {
      if (currentRow.length > 0) {
        dataRows.push(currentRow);
        currentRow = [];
      }
    } else if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line.slice(1, -1).split("|").map(cell => cell.trim());
      if (currentRow.length === 0) {
        currentRow = cells;
      } else {
        for (let i = 0; i < cells.length && i < currentRow.length; i++) {
          if (cells[i]) {
            currentRow[i] += " " + cells[i];
          }
        }
      }
    }
  }
  if (currentRow.length > 0) {
    dataRows.push(currentRow);
  }
  if (dataRows.length === 0) return null;
  let markdownTable = "";
  if (dataRows.length > 0) {
    markdownTable += "| " + dataRows[0].join(" | ") + " |\n";
    markdownTable += "|" + dataRows[0].map(() => "---").join("|") + "|\n";
  }
  if (dataRows.length > 1) {
    for (let i = 1; i < dataRows.length; i++) {
      markdownTable += "| " + dataRows[i].join(" | ") + " |\n";
    }
  }
  return markdownTable;
}

function _convertAsciiTablesInMarkdownGlobal(markdown) {
  return markdown.replace(/(\+[-+\|]+\+[\s\S]*?\+[-+\|]+\+)/g, match => _convertAsciiTableToMarkdownGlobal(match.trim()) || match);
}

function _findTableTitleElement(table) {
  let prev = table.previousElementSibling;
  while (prev) {
    const tag = prev.tagName;
    if (tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4") {
      return prev;
    }
    if ((tag === "P" || tag === "BR") && !(prev.textContent || "").trim()) {
      prev = prev.previousElementSibling;
      continue;
    }
    break;
  }
  return null;
}

function _decorateTablesGlobal(container, options) {
  try {
    if (!container) return;
    const opts = options || {};
    const inSednar = opts.sednar === true || !!(container.closest && container.closest("#sednar-chat-messages"));
    const inLazie = !inSednar && (opts.lazie === true || !!(container.closest && container.closest("#lazie-output")));
    const prefix = inSednar ? "sednar" : inLazie ? "lazie" : null;
    const inSidebar = !prefix && !!(container.closest && container.closest("[data-chat='sidebar']"));
    if (inSidebar) {
      Array.from(container.querySelectorAll("table")).filter(t => !t.closest(".sidebar-table-wrap")).forEach(table => {
        if (!table.parentNode) return;
        const wrap = document.createElement("div");
        wrap.className = "sidebar-table-wrap";
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      });
      return;
    }
    if (!prefix) return;
    const tables = Array.from(container.querySelectorAll("table")).filter(table => !table.closest(".lazie-table-display-block, .lazie-csv-display-block, .sednar-table-display-block, .sednar-csv-display-block"));
    tables.forEach(table => {
      if (!table.parentNode) return;
      const titleEl = opts.keepTableTitle === true ? null : _findTableTitleElement(table);
      const title = titleEl ? (titleEl.textContent || "").trim() : "";
      if (titleEl) titleEl.remove();
      const card = document.createElement("div");
      card.className = prefix + "-table-display-block";
      if (title) {
        const header = document.createElement("div");
        header.className = prefix + "-table-header";
        const titleSpan = document.createElement("span");
        titleSpan.className = prefix + "-table-title";
        titleSpan.textContent = title;
        header.appendChild(titleSpan);
        card.appendChild(header);
      }
      const content = document.createElement("div");
      content.className = prefix + "-table-content";
      table.classList.add(prefix + "-md-table");
      table.parentNode.insertBefore(card, table);
      content.appendChild(table);
      card.appendChild(content);
    });
  } catch (e) {}
}

function _decorateCodeBlocksGlobal(container, options) {
  try {
    if (!container) return;
    const opts = options || {};
    const inSednar = opts.sednar === true || !!(container.closest && container.closest("#sednar-chat-messages"));
    const inLazie = !inSednar && (opts.lazie === true || !!(container.closest && container.closest("#lazie-output")));
    const prefix = inSednar ? "sednar" : inLazie ? "lazie" : null;
    
    Array.from(container.querySelectorAll("pre")).forEach(pre => {
      if (!pre || pre.closest(".code-card")) return;
      if (pre.querySelector("code")) return;
      const code = document.createElement("code");
      code.textContent = pre.textContent || "";
      pre.textContent = "";
      pre.appendChild(code);
    });
    const blocks = Array.from(container.querySelectorAll("pre code"));
    blocks.forEach(codeEl => {
      if (!codeEl) return;
      if (codeEl.closest(".code-card")) return;
      const pre = codeEl.closest("pre");
      if (!pre || !pre.parentNode) return;
      let lang = "text";
      const m = (codeEl.className || "").match(/language-([\w+-]+)/i);
      if (m && m[1]) {
        lang = m[1].toLowerCase();
      } else {
        const code = codeEl.textContent || "";
        if (code.trim().startsWith("{") || code.trim().startsWith("[")) {
          lang = "json";
        } else if (/^\s*(\$\s*)?curl\b/m.test(code) || /^\s*#!\s*\/.+\b(ba)?sh\b/m.test(code) || /\b(apt-get|brew |npm |yarn |pnpm |docker |kubectl )\b/.test(code)) {
          lang = "bash";
        } else if (code.includes("def ") || code.includes("print(") || code.includes("import ") || code.includes("from ")) {
          lang = "python";
        } else if (code.includes("public class") || code.includes("System.out") || code.includes("public static void")) {
          lang = "java";
        } else if (code.includes("function ") || code.includes("console.log") || code.includes("const ") || code.includes("let ")) {
          lang = "javascript";
        }
      }
      if (lang === "sh" || lang === "shell" || lang === "zsh") lang = "bash";
      const card = document.createElement("div");
      card.className = prefix ? ("code-card " + prefix + "-code-card") : "code-card";
      if (prefix) {
        pre.classList.add(prefix + "-code-block");
      }
      const header = document.createElement("div");
      header.className = "code-card-header";
      const langSpan = document.createElement("span");
      langSpan.className = "lang";
      langSpan.textContent = lang;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-code-btn";
      btn.title = "Copy code";
      btn.setAttribute("aria-label", "Copy code");
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const showCopySuccess = b => {
        const old = b.innerHTML;
        b.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => {
          b.innerHTML = old;
        }, 1200);
      };
      const fallbackCopy = (text, b) => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "top:0;left:0;position:fixed;opacity:0;pointer-events:none";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          if (document.execCommand("copy")) showCopySuccess(b);
        } catch (e) {}
        document.body.removeChild(ta);
      };
      btn.addEventListener("click", function() {
        try {
          const text = codeEl.innerText || codeEl.textContent || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => showCopySuccess(btn)).catch(() => fallbackCopy(text, btn));
          } else {
            fallbackCopy(text, btn);
          }
        } catch (e) {}
      });
      header.appendChild(langSpan);
      header.appendChild(btn);
      pre.parentNode.insertBefore(card, pre);
      card.appendChild(header);
      card.appendChild(pre);
    });
  } catch (e) {}
}

function _linkifyBareUrlsInMarkdownGlobal(md) {
  if (!md) return "";
  var parts = String(md).split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]]*\]\([^)]+\))/g);
  var urlRe = /(^|[\s(])((?:https?:\/\/)[^\s<>\])"'`]+)/g;
  return parts.map(function(part) {
    if (!part) return part;
    if (/^```/.test(part) || /^`/.test(part) || /^\[[^\]]*\]\(/.test(part)) return part;
    return part.replace(urlRe, function(_m, prefix, url) {
      var clean = url;
      var trailing = "";
      while (clean.length && /[.,;:!?]+$/.test(clean)) {
        trailing = clean.slice(-1) + trailing;
        clean = clean.slice(0, -1);
      }
      if (clean.endsWith(")")) {
        var opens = (clean.match(/\(/g) || []).length;
        var closes = (clean.match(/\)/g) || []).length;
        if (closes > opens) {
          trailing = ")" + trailing;
          clean = clean.slice(0, -1);
        }
      }
      if (!clean) return prefix + url;
      return prefix + "[" + clean + "](" + clean + ")" + trailing;
    });
  }).join("");
}

function _decorateChatLinksGlobal(el) {
  if (!el || !el.querySelectorAll) return;
  el.querySelectorAll("a[href]").forEach(function(a) {
    var href = a.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.classList.add("chat-external-link");
  });
}

function _looksLikeRawMarkdown(el) {
  if (!el) return false;
  if (el.querySelector(".sednar-code-card, .lazie-code-card, .sednar-diff-block, .lazie-diff-block, .sednar-json-display-block, .lazie-json-display-block, .sednar-table-display-block, .lazie-table-display-block, .sednar-csv-display-block, .lazie-csv-display-block, .sednar-agent-steps, .lazie-agent-steps")) {
    return false;
  }
  if (el.querySelector("h1,h2,h3,h4,h5,h6,ul,ol,pre,.code-card,table")) return false;
  const text = String(el.textContent || "").trim();
  if (!text) return false;
  return /^#{1,6}\s/m.test(text) || /\*\*[^*\n]+\*\*/m.test(text) || /^[-*+]\s/m.test(text) || /^\d+\.\s/m.test(text) || /```/.test(text);
}

function _resolveSednarChatPane(el, options) {
  const opts = options || {};
  if (opts.sednar === true) return { sednar: true, lazie: false };
  if (opts.lazie === true) return { sednar: false, lazie: true };
  const inSednar = !!(el && el.closest && el.closest("#sednar-chat-messages, #airflow-debug-output"));
  const inLazie = !inSednar && !!(el && el.closest && el.closest("#lazie-output"));
  return { sednar: inSednar, lazie: inLazie };
}

window.renderMarkdownInElement = function(el, markdown, options) {
  if (!el || markdown == null) return;
  const opts = options || {};
  const pane = _resolveSednarChatPane(el, opts);
  const inSednar = pane.sednar;
  const inLazie = pane.lazie;
  const chatCard = inSednar || inLazie;
  let md = String(markdown);
  if (opts.persistRaw === true) {
    try {
      el.dataset.rawMd = md;
    } catch (_) {}
  }
  if (chatCard && typeof normalizeLazieMarkdownCodeFences === "function") {
    md = normalizeLazieMarkdownCodeFences(md);
  }
  let mdForRender = _compactMarkdownGlobal(md);
  mdForRender = _convertAsciiTablesInMarkdownGlobal(mdForRender);
  mdForRender = _linkifyBareUrlsInMarkdownGlobal(mdForRender);
  const html = typeof DOMPurify !== "undefined" && typeof marked !== "undefined" ? DOMPurify.sanitize(marked.parse(mdForRender)) : md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  el.innerHTML = html;
  _decorateChatLinksGlobal(el);
  _normalizeInlineChatCode(el);
  
  
  _decorateCodeBlocksGlobal(el, {
    lazie: inLazie,
    sednar: inSednar
  });
  el.querySelectorAll("pre code").forEach(block => {
    if (!block || !block.dataset) return;
    if (block.dataset.monacoEnhanced === "true") return;
    const lang = (block.className || "").match(/language-([\w+-]+)/i);
    let language = lang ? lang[1].toLowerCase() : "text";
    if (language === "sh" || language === "shell" || language === "zsh") language = "bash";
    const code = block.textContent || "";
    if (!code.trim() || typeof applyMonacoStyling !== "function") return;
    try {
      applyMonacoStyling(block, code, language);
      block.classList.add("monaco-enhanced");
      block.dataset.monacoEnhanced = "true";
    } catch (e) {}
  });
  _decorateTablesGlobal(el, {
    lazie: inLazie,
    sednar: inSednar,
    keepTableTitle: opts.keepTableTitle === true
  });
};

// Draws each .mermaid node under root (its text is the diagram source) as an SVG. A diagram that does not
// parse stays as its source with the parse error under it. Diagrams render one at a time, as mermaid needs.
let _sednarMermaidCount = 0;
function _mdpdfRenderMermaidDiagrams(root, _sourcePrefix, renderPrefix, _forPdf, themeVariables) {
  if (!root || typeof mermaid === "undefined") return Promise.resolve();
  const nodes = Array.prototype.slice.call(root.querySelectorAll(".mermaid:not([data-processed])"));
  if (!nodes.length) return Promise.resolve();
  const vars = themeVariables || {};
  const light = document.body.classList.contains("white-theme") || document.body.classList.contains("pink-theme");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: Object.keys(vars).length ? "base" : (light ? "default" : "dark"),
    themeVariables: vars,
  });
  return nodes.reduce(function(chain, node) {
    return chain.then(function() {
      const source = node.textContent || "";
      const id = (renderPrefix || "sednar-mermaid-") + "svg-" + (++_sednarMermaidCount);
      node.setAttribute("data-processed", "true");
      return mermaid.render(id, source).then(function(result) {
        node.innerHTML = result.svg;
        if (result.bindFunctions) result.bindFunctions(node);
      }).catch(function(err) {
        // mermaid leaves its scratch element behind when a diagram fails to parse.
        const scratch = document.getElementById("d" + id);
        if (scratch) scratch.remove();
        node.textContent = "";
        const pre = document.createElement("pre");
        pre.className = "mermaid-source";
        pre.textContent = source;
        const msg = document.createElement("div");
        msg.className = "mermaid-error";
        msg.textContent = "Diagram error: " + String((err && err.message) || err).split("\n")[0];
        node.appendChild(pre);
        node.appendChild(msg);
      });
    });
  }, Promise.resolve());
}

window.mountSednarChatMarkdown = function(el, markdown, options) {
  if (!el) return;
  const opts = Object.assign({ persistRaw: true }, options || {});
  const pane = _resolveSednarChatPane(el, opts);
  if (typeof window.renderMarkdownInElement === "function") {
    window.renderMarkdownInElement(el, markdown || "", {
      sednar: pane.sednar,
      lazie: pane.lazie,
      persistRaw: opts.persistRaw === true,
      keepTableTitle: opts.keepTableTitle === true,
    });
    return;
  }
  if (typeof marked !== "undefined" && typeof DOMPurify !== "undefined") {
    el.innerHTML = window.renderSednarChatMarkdownHtml(markdown || "", opts);
  } else {
    el.textContent = markdown || "";
  }
};

window.renderSednarChatMarkdownHtml = function(markdown, options) {
  const opts = options || {};
  let md = String(markdown || "");
  const chatCard = opts.sednar === true || opts.lazie === true;
  if (chatCard && typeof normalizeLazieMarkdownCodeFences === "function") {
    md = normalizeLazieMarkdownCodeFences(md);
  }
  let mdForRender = _compactMarkdownGlobal(md);
  mdForRender = _convertAsciiTablesInMarkdownGlobal(mdForRender);
  mdForRender = _linkifyBareUrlsInMarkdownGlobal(mdForRender);
  if (typeof DOMPurify !== "undefined" && typeof marked !== "undefined") {
    return DOMPurify.sanitize(marked.parse(mdForRender));
  }
  return md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
};

window.rehydrateSednarChatMarkdown = function(root) {
  if (!root) return;
  const selector = [
    ".chat-msg.assistant.sednar-plain-msg",
    ".chat-msg.assistant.sednar-stream-msg",
    ".chat-msg.assistant.lazie-plain-msg",
    "#airflow-debug-output .chat-msg.assistant",
  ].join(",");
  root.querySelectorAll(selector).forEach(function(el) {
    if (el.closest(".sednar-agent-steps, .lazie-agent-steps")) return;
    if (el.classList.contains("sednar-status-msg") || el.classList.contains("lazie-status-msg")) return;
    if (el.classList.contains("sednar-permission-msg") || el.classList.contains("lazie-permission-msg")) return;
    if (el.classList.contains("sednar-error-msg") || el.classList.contains("lazie-error-msg")) return;
    if (el.classList.contains("sednar-agent-steps")) return;
    // Tool cards (commands, diffs) live in assistant bubbles too; their output can look like markdown,
    // and re-rendering it would flatten the card into text.
    if (el.closest(".sednar-term-row, .sednar-diff-row") ||
        el.querySelector(".sednar-term-card, .sednar-diff-block, .ui-edit-tool-call, .ui-tool-call-card")) return;
    const stored = el.dataset && el.dataset.rawMd ? String(el.dataset.rawMd) : "";
    if (stored.trim()) {
      window.mountSednarChatMarkdown(el, stored);
      return;
    }
    if (_looksLikeRawMarkdown(el)) {
      window.mountSednarChatMarkdown(el, el.textContent || "");
    }
  });
};

window.buildChatAttachmentPrompt = function(attachments) {
  attachments = attachments || [];
  var fileNames = attachments.map(function(a) { return a.name; }).join(", ");
  return "Analyze the attached file" + (attachments.length > 1 ? "s" : "") + ": " + fileNames;
};

window.showRenameModal = function(currentTitle, onConfirm) {
  const existing = document.getElementById("rename-modal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "rename-modal";
  modal.innerHTML = `\n              <div id="rename-modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,0.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:99999;">\n                 <div id="rename-modal-card" class="theme-transition" style="width:600px;max-width:90vw;background:#fff;border:1px solid #e5e7eb;box-shadow:0 10px 25px rgba(0,0,0,0.15);border-radius:12px;overflow:hidden;">\n                   <div id="rename-modal-header" class="theme-transition" style="display:flex;align-items:center;justify-content:space-between;padding:2px 16px;background:#f8fafc;">\n                     <div style="width:40px;"></div>\n                     <div id="rename-modal-title" style="font-weight:600;text-align:center">Rename Chat</div>\n                     <button id="rename-modal-close" style="width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;border:none !important;outline:none !important;box-shadow:none !important;background:transparent !important;cursor:pointer;" onmouseover="this.style.background='transparent';this.style.border='none';this.style.boxShadow='none';" onmouseout="this.style.background='transparent';this.style.border='none';this.style.boxShadow='none';">\n                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n                           <line x1="18" y1="6" x2="6" y2="18"></line>\n                           <line x1="6" y1="6" x2="18" y2="18"></line>\n                        </svg>\n                     </button>\n                   </div>\n                   <div style="padding:16px;">\n                     <input type="text" id="rename-modal-input" class="border px-4 py-2 theme-transition" style="width:100%;height:46px;background:transparent !important;border-radius:6px;" placeholder="Enter new name" />\n                   </div>\n                   <div style="padding:16px;display:flex;justify-content:flex-end;gap:10px;">\n                     <button id="rename-modal-cancel" class="btn btn-ghost">Cancel</button>\n                     <button id="rename-modal-confirm" class="btn btn-ghost">Save</button>\n                   </div>\n                 </div>\n              </div>`;
  document.body.appendChild(modal);
  (function() {
    const card = document.getElementById("rename-modal-card");
    const header = document.getElementById("rename-modal-header");
    const bodyCls = document.body.className || "";
    let bg = "#ffffff", text = "#111827", border = "#e5e7eb", headerBg = "#f8fafc";
    if (bodyCls.includes("dark-theme")) {
      bg = "#1e293b";
      text = "#e2e8f0";
      border = "#334155";
      headerBg = "#0f172a";
    } else if (bodyCls.includes("white-theme")) {
      bg = "#f8fafc";
      text = "#1e293b";
      border = "#cbd5e1";
      headerBg = "#f1f5f9";
    } else if (bodyCls.includes("pink-theme")) {
      bg = "#fdf2f8";
      text = "#831843";
      border = "#f9a8d4";
      headerBg = "#fce7f3";
    }
    if (card) {
      card.style.background = bg;
      card.style.borderColor = border;
    }
    if (header) {
      header.style.background = headerBg;
    }
  })();
  const input = document.getElementById("rename-modal-input");
  input.value = currentTitle;
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
  const closeModal = () => modal.remove();
  document.getElementById("rename-modal-close").addEventListener("click", closeModal);
  document.getElementById("rename-modal-cancel").addEventListener("click", closeModal);
  document.getElementById("rename-modal-backdrop").addEventListener("click", e => {
    if (e.target.id === "rename-modal-backdrop") closeModal();
  });
  const doConfirm = () => {
    const newTitle = input.value;
    closeModal();
    if (onConfirm) onConfirm(newTitle);
  };
  document.getElementById("rename-modal-confirm").addEventListener("click", doConfirm);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      doConfirm();
    } else if (e.key === "Escape") {
      closeModal();
    }
  });
};

window.closeChatMenus = function() {
  const menus = document.querySelectorAll(".chat-history-menu");
  menus.forEach(menu => menu.remove());
  document.querySelectorAll('.chat-history-item-more[aria-expanded="true"]').forEach(btn => btn.setAttribute("aria-expanded", "false"));
};

window.chatAttachmentsLoadingCount = 0;

const CHAT_ATTACHMENT_MAX_CHARS = 40000;

const CHAT_MAX_ATTACHMENTS = 10;

window.shortenStartExtFilename = function(name, maxLen) {
  const full = String(name || "");
  maxLen = maxLen || 28;
  if (full.length <= maxLen) {
    return full;
  }

  const lastDot = full.lastIndexOf(".");
  if (lastDot <= 0) {
    return full.slice(0, Math.max(1, maxLen - 3)) + "...";
  }

  const base = full.slice(0, lastDot);
  const ext = full.slice(lastDot);
  const ellipsis = "...";
  const availableForStart = maxLen - ellipsis.length - ext.length;

  if (availableForStart <= 0) {
    return full.slice(0, Math.max(1, maxLen - ellipsis.length)) + ellipsis;
  }

  if (base.length + ext.length <= maxLen) {
    return full;
  }

  return base.slice(0, availableForStart) + ellipsis + ext;
};

window.isLocalOllamaModel = function(model) {
  const value = String(model || "").trim().toLowerCase();
  if (!value) {
    return false;
  }
  return value.includes(":");
};

window.renderChatbotModelDropdownList = function(selectedValue) {
  const list = document.getElementById("chatbot-model-dropdown-list");
  if (!list) {
    return;
  }
  const options = window.getChatbotModelOptions();
  const currentValue = selectedValue || (typeof window.getSednarAiModel === "function" ? window.getSednarAiModel() : "auto");
  list.innerHTML = options.map(function(opt) {
    const isSelected = opt.value === currentValue;
    const checkSvg = '<svg class="chatbot-model-dropdown-item-check sednar-mode-dropdown-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    return '<div class="chatbot-model-dropdown-item sednar-mode-dropdown-item' + (isSelected ? " is-selected" : "") + '" data-value="' + opt.value + '" role="option" aria-selected="' + (isSelected ? "true" : "false") + '"><span>' + opt.label + "</span>" + checkSvg + "</div>";
  }).join("");
  list.querySelectorAll(".chatbot-model-dropdown-item").forEach(function(item) {
    item.addEventListener("click", function(e) {
      e.stopPropagation();
      window.setChatbotModelValue(this.getAttribute("data-value"));
      window.closeChatbotModelDropdown();
    });
  });
};

window.closeChatbotModelDropdown = function() {
  const dropdown = document.getElementById("chatbot-model-dropdown");
  if (dropdown) {
    dropdown.style.display = "none";
  }
  document.querySelectorAll("[data-chatbot-model-trigger]").forEach(function(trigger) {
    trigger.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  });
};

window.setChatbotModelValue = function(value) {
  const options = window.getChatbotModelOptions();
  const resolvedValue = options.some(function(opt) {
    return opt.value === value;
  }) ? value : "auto";
  try {
    localStorage.setItem("sednar-ai-model", resolvedValue);
  } catch (e) {}
  document.querySelectorAll("[data-chatbot-model-select]").forEach(function(input) {
    input.value = resolvedValue;
  });
  const global = document.getElementById("global-ai-model");
  if (global && global.value !== resolvedValue) {
    global.value = resolvedValue;
  }
  if (typeof window.syncAuxiliaryModelSelectors === "function") {
    window.syncAuxiliaryModelSelectors();
  }
  window.syncChatbotModelLabels();
  window.renderChatbotModelDropdownList(resolvedValue);
};

window.toggleChatbotModelDropdown = function(trigger) {
  const dropdown = document.getElementById("chatbot-model-dropdown");
  if (!dropdown || !trigger) {
    return;
  }
  const wasOpen = dropdown.style.display === "flex";
  const activeTrigger = document.querySelector("[data-chatbot-model-trigger].is-open");
  window.closeChatbotModelDropdown();
  if (wasOpen && activeTrigger === trigger) {
    return;
  }
  if (typeof window.closeSednarModeDropdown === "function") {
    window.closeSednarModeDropdown();
  }
  const rect = trigger.getBoundingClientRect();
  const currentValue = trigger.querySelector("[data-chatbot-model-select]");
  window.renderChatbotModelDropdownList(currentValue ? currentValue.value : "");
  dropdown.style.display = "flex";
  dropdown.style.minWidth = Math.max(rect.width, 180) + "px";
  dropdown.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdown.offsetWidth - 8)) + "px";
  dropdown.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  dropdown.style.zIndex = "10050";
  trigger.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
};

window.isImageFile = function(file) {
  if (file.type && file.type.startsWith('image/')) return true;
  var ext = (file.name || '').split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].indexOf(ext) !== -1;
};

window.compressImage = function(file, maxWidth, maxHeight, quality) {
  maxWidth = maxWidth || 1024;
  maxHeight = maxHeight || 1024;
  quality = quality || 0.7;
  
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var width = img.width;
        var height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          var ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = function() { reject(new Error('Failed to load image')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsDataURL(file);
  });
};

window.CHAT_FILE_LIMITS = {
  image: { maxSize: 5 * 1024 * 1024, maxDimension: 1024 },
  pdf: { maxSize: 10 * 1024 * 1024, maxPages: 20 },
  docx: { maxSize: 5 * 1024 * 1024 },
  txt: { maxSize: 2 * 1024 * 1024, maxChars: 100000 }
};

window.isPDFFile = function(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
};

window.isDOCXFile = function(file) {
  return file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
         || /\.docx$/i.test(file.name);
};

window.isBinaryAttachmentFile = function(file) {
  if (!file) return false;
  if (window.isImageFile(file) || window.isPDFFile(file) || window.isDOCXFile(file)) return false;
  var name = String(file.name || "");
  var type = String(file.type || "");
  if (/\.(zip|tar|gz|tgz|rar|7z|bz2|xz|exe|dll|so|dylib|bin|wasm|dmg|pkg|iso|mp[34]|wav|mov|avi|mkv|webm)$/i.test(name)) {
    return true;
  }
  if (/^(application\/(zip|x-zip-compressed|gzip|x-tar|x-7z-compressed|octet-stream|x-msdownload|vnd\.rar)|video\/|audio\/)/i.test(type)) {
    return true;
  }
  return false;
};

window.isLikelyDirectoryStub = function(file) {
  if (!file) return false;
  if (file._chatRelativePath) return false;
  var name = String(file.name || "");
  if (!name || /\./.test(name)) return false;
  return file.size === 0 && (!file.type || file.type === "");
};

window.extractPDFText = function(file, maxPages) {
  maxPages = maxPages || 20;
  return new Promise(function(resolve, reject) {
    if (typeof pdfjsLib === 'undefined') {
      reject(new Error('PDF.js library not loaded'));
      return;
    }
    
    var reader = new FileReader();
    reader.onload = function(e) {
      var typedArray = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
        var numPages = Math.min(pdf.numPages, maxPages);
        var textPromises = [];
        
        for (var i = 1; i <= numPages; i++) {
          textPromises.push(
            pdf.getPage(i).then(function(page) {
              return page.getTextContent().then(function(content) {
                return content.items.map(function(item) { return item.str; }).join(' ');
              });
            })
          );
        }
        
        Promise.all(textPromises).then(function(pageTexts) {
          var fullText = pageTexts.join('\n\n--- Page Break ---\n\n');
          var truncated = pdf.numPages > maxPages;
          if (truncated) {
            fullText += '\n\n[Note: PDF truncated to first ' + maxPages + ' pages out of ' + pdf.numPages + ' total]';
          }
          resolve({ text: fullText, pageCount: pdf.numPages, truncated: truncated });
        }).catch(reject);
      }).catch(reject);
    };
    reader.onerror = function() { reject(new Error('Failed to read PDF file')); };
    reader.readAsArrayBuffer(file);
  });
};

window.extractDOCXText = function(file) {
  return new Promise(function(resolve, reject) {
    if (typeof mammoth === 'undefined') {
      reject(new Error('Mammoth.js library not loaded'));
      return;
    }
    
    var reader = new FileReader();
    reader.onload = function(e) {
      mammoth.extractRawText({ arrayBuffer: e.target.result })
        .then(function(result) {
          resolve({ text: result.value, messages: result.messages });
        })
        .catch(reject);
    };
    reader.onerror = function() { reject(new Error('Failed to read DOCX file')); };
    reader.readAsArrayBuffer(file);
  });
};

window.renderPDFPagesToImages = function(file, maxPages, scale) {
  maxPages = maxPages || 8;
  scale = scale || 1.5;
  return new Promise(function(resolve, reject) {
    if (typeof pdfjsLib === 'undefined') {
      reject(new Error('PDF.js library not loaded'));
      return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
      var typedArray = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: typedArray }).promise.then(function(pdf) {
        var numPages = Math.min(pdf.numPages, maxPages);
        var imagePromises = [];

        for (var i = 1; i <= numPages; i++) {
          (function(pageNum) {
            imagePromises.push(
              pdf.getPage(pageNum).then(function(page) {
                var viewport = page.getViewport({ scale: scale });
                var canvas = document.createElement('canvas');
                var context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                return page.render({
                  canvasContext: context,
                  viewport: viewport
                }).promise.then(function() {
                  var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                  return {
                    pageNum: pageNum,
                    data: dataUrl,
                    width: canvas.width,
                    height: canvas.height
                  };
                });
              })
            );
          })(i);
        }

        Promise.all(imagePromises).then(function(images) {
          images.sort(function(a, b) { return a.pageNum - b.pageNum; });
          resolve({
            images: images,
            totalPages: pdf.numPages,
            renderedPages: numPages,
            truncated: pdf.numPages > maxPages
          });
        }).catch(reject);
      }).catch(reject);
    };
    reader.onerror = function() { reject(new Error('Failed to read PDF file')); };
    reader.readAsArrayBuffer(file);
  });
};

window.isPDFImageBased = function(text, pageCount) {
  if (!text || pageCount === 0) return true;
  var cleanText = text.replace(/---\s*Page\s*Break\s*---/gi, '')
                      .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '')
                      .replace(/\[Note:.*?\]/gi, '')
                      .trim();
  var avgCharsPerPage = cleanText.length / Math.max(pageCount, 1);
  return avgCharsPerPage < 100;
};

window.processPDFForChat = function(file, maxPages, forceImages) {
  maxPages = maxPages || 20;
  return new Promise(function(resolve, reject) {
    window.extractPDFText(file, maxPages).then(function(textResult) {
      var isImageBased = window.isPDFImageBased(textResult.text, textResult.pageCount);
      
      if (forceImages || isImageBased) {
        var imageMaxPages = Math.min(maxPages, 8);
        window.renderPDFPagesToImages(file, imageMaxPages, 1.5).then(function(imageResult) {
          resolve({
            mode: 'images',
            images: imageResult.images,
            totalPages: imageResult.totalPages,
            renderedPages: imageResult.renderedPages,
            truncated: imageResult.truncated,
            fallbackText: textResult.text
          });
        }).catch(function(err) {
          console.warn('PDF image render failed, falling back to text:', err);
          resolve({
            mode: 'text',
            text: textResult.text,
            pageCount: textResult.pageCount,
            truncated: textResult.truncated,
            isImageBased: isImageBased
          });
        });
      } else {
        resolve({
          mode: 'text',
          text: textResult.text,
          pageCount: textResult.pageCount,
          truncated: textResult.truncated,
          isImageBased: false
        });
      }
    }).catch(reject);
  });
};

window.getFileTypeCategory = function(file) {
  if (window.isImageFile(file)) return 'image';
  if (window.isPDFFile(file)) return 'pdf';
  if (window.isDOCXFile(file)) return 'docx';
  return 'txt';
};

window.getFileSizeLimit = function(file) {
  var category = window.getFileTypeCategory(file);
  var limits = window.CHAT_FILE_LIMITS[category] || window.CHAT_FILE_LIMITS.txt;
  return limits.maxSize;
};

window.sednarPendingAttachments = [];

window.sednarAttachmentsLoadingCount = 0;

window._sednarInsertRange = null;

const SEDNAR_MAX_ATTACHMENTS = 10;

window._sednarMakeAttachmentId = function() {
  return "sednar-att-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9);
};

window._sednarGetComposerInput = function() {
  return document.getElementById("sednar-chat-input");
};

window._sednarUpdateComposerPlaceholder = function() {
  var input = window._sednarGetComposerInput();
  if (!input) return;
  var empty = typeof window._sednarComposerIsVisuallyEmpty === "function"
    ? window._sednarComposerIsVisuallyEmpty(input)
    : (!(input.textContent || "").trim() && !input.querySelector(".sednar-inline-file-chip"));
  input.classList.toggle("is-empty", empty);
};

window._sednarResizeComposerInput = function() {
  var input = window._sednarGetComposerInput();
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
};

window._sednarGetComposerSelectionRange = function() {
  var input = window._sednarGetComposerInput();
  if (!input) return null;
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  var range = sel.getRangeAt(0);
  if (!input.contains(range.startContainer)) return null;
  return range.cloneRange();
};

window._sednarSetComposerSelection = function(range) {
  if (!range) return;
  var sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
};

window._sednarComposerIsVisuallyEmpty = function(input) {
  if (!input) return true;
  if (input.querySelector(".sednar-inline-file-chip")) return false;
  var text = (input.textContent || "").replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();
  return !text;
};

window._sednarPlaceComposerCaretAt = function(input, childIndex) {
  if (!input) return null;
  var range = document.createRange();
  var kids = input.childNodes;
  
  if (window._sednarComposerIsVisuallyEmpty(input)) {
    if (input.innerHTML !== "") input.innerHTML = "";
    range.setStart(input, 0);
    range.collapse(true);
  } else {
    var idx = typeof childIndex === "number" ? childIndex : 0;
    if (idx < 0) idx = 0;
    if (idx > kids.length) idx = kids.length;
    if (idx < kids.length) {
      range.setStart(input, idx);
      range.collapse(true);
    } else {
      range.selectNodeContents(input);
      range.collapse(false);
    }
  }
  window._sednarSetComposerSelection(range);
  return range;
};

window._sednarInsertNodeAtComposerCaret = function(node, atRange) {
  var input = window._sednarGetComposerInput();
  if (!input || !node) return;
  var range = atRange || window._sednarInsertRange || window._sednarGetComposerSelectionRange();
  if (!range) {
    input.appendChild(node);
    range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
  } else {
    range.collapse(true);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
  }
  var spacer = document.createTextNode("\u00a0");
  range.insertNode(spacer);
  range.setStartAfter(spacer);
  range.collapse(true);
  window._sednarSetComposerSelection(range);
  window._sednarInsertRange = null;
  window._sednarUpdateComposerPlaceholder();
  window._sednarResizeComposerInput();
};

window.buildSednarInlineFileChipElement = function(attachment, options) {
  options = options || {};
  var chip = document.createElement("span");
  chip.className = "sednar-inline-file-chip theme-transition";
  var isChat = attachment.type === "chat";
  if (attachment.type === "repo_folder") {
    chip.classList.add("sednar-inline-repo-chip", "sednar-inline-repo-folder-chip");
  } else if (attachment.type === "repo_file") {
    chip.classList.add("sednar-inline-repo-chip");
  } else if (isChat) {
    chip.classList.add("sednar-inline-repo-chip", "sednar-inline-chat-chip");
  }
  chip.contentEditable = "false";
  chip.setAttribute("data-attachment-id", attachment.id || "");
  var chipTitle = attachment.name || "";
  if (attachment.repo_path) chipTitle = attachment.repo_path;
  if (isChat) chipTitle = "Previous chat: " + (attachment.name || "");
  chip.title = chipTitle;

  var fileName = attachment.name || "file";
  if (!isChat && /\.json$/i.test(fileName)) {
    chip.classList.add("sednar-json-pill");
  }
  if (isChat) {
    var chatIcon = document.createElement("span");
    chatIcon.className = "sednar-inline-file-icon sednar-inline-chat-icon";
    chatIcon.setAttribute("aria-hidden", "true");
    chatIcon.innerHTML = window._SEDNAR_CHAT_MENTION_SVG || "";
    chip.appendChild(chatIcon);
  } else {
    var iconSrc;
    if (attachment.type === "repo_folder") {
      iconSrc = "/asset/common/folder.png";
    } else {
      iconSrc = typeof window.getFileIcon === "function"
        ? window.getFileIcon(fileName)
        : "/asset/file-icons/file.png";
    }
    var iconImg = document.createElement("img");
    iconImg.className = "sednar-inline-file-icon";
    iconImg.src = iconSrc;
    iconImg.alt = "";
    iconImg.setAttribute("aria-hidden", "true");
    chip.appendChild(iconImg);
  }

  var nameSpan = document.createElement("span");
  nameSpan.className = "sednar-inline-file-name";
  if (isChat) {
    var chatLabel = attachment.name || "chat";
    nameSpan.textContent = chatLabel.length > 32 ? chatLabel.slice(0, 31) + "…" : chatLabel;
  } else {
    nameSpan.textContent = typeof window.shortenStartExtFilename === "function"
      ? window.shortenStartExtFilename(attachment.name || "file", 28)
      : (attachment.name || "file");
  }
  chip.appendChild(nameSpan);

  return chip;
};

window.insertSednarInlineFileChip = function(attachment, atRange) {
  if (!attachment || !attachment.id) return;
  var chip = window.buildSednarInlineFileChipElement(attachment, {});
  window._sednarInsertNodeAtComposerCaret(chip, atRange);
};

window.addSednarRepoContextToChat = function(opts) {
  opts = opts || {};
  var projectPath = typeof window.getSednarProjectPath === "function"
    ? window.getSednarProjectPath()
    : null;
  if (!projectPath) {
    alert("Open a project folder first.");
    return false;
  }
  var repoPath = String(opts.repoPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  var kind = opts.kind === "folder" ? "folder" : "file";
  var attType = kind === "folder" ? "repo_folder" : "repo_file";
  var name = opts.name || (repoPath ? repoPath.split("/").pop() : "") || (kind === "folder" ? "folder" : "file");
  var pending = window.sednarPendingAttachments || [];
  if (pending.length >= SEDNAR_MAX_ATTACHMENTS) {
    alert("Maximum " + SEDNAR_MAX_ATTACHMENTS + " attachments per message.");
    return false;
  }
  var isDupe = pending.some(function(a) {
    return a && a.type === attType && String(a.repo_path || "") === repoPath;
  });
  if (isDupe) return false;
  var attachment = {
    id: window._sednarMakeAttachmentId(),
    name: name,
    type: attType,
    repo_path: repoPath,
    size: 0
  };
  pending.push(attachment);
  window.sednarPendingAttachments = pending;
  window.insertSednarInlineFileChip(attachment);
  window._sednarUpdateComposerPlaceholder();
  window._sednarResizeComposerInput();
  if (typeof window.updateSednarComposerSendState === "function") {
    window.updateSednarComposerSendState();
  }
  var input = window._sednarGetComposerInput();
  if (input && typeof input.focus === "function") input.focus();
  return true;
};

window._sednarMentionState = {
  active: false,
  query: "",
  results: [],
  selectedIndex: 0,
  debounceTimer: null,
  browseDir: "",
  searching: false,
  chats: null,
  chatResults: [],
  chatSelectedIndex: 0,
  chatsLoading: false
};

window._sednarSlashState = {
  active: false,
  query: "",
  results: [],
  selectedIndex: 0,
  allSkills: null,
  loading: false
};

window.addSednarImageThumbnail = function(attachment) {
  if (!attachment || !attachment.id || attachment.type !== "image") return;
  var strip = document.getElementById("sednar-image-thumbnails");
  if (!strip) return;
  if (strip.querySelector('[data-attachment-id="' + attachment.id + '"]')) return;

  var wrap = document.createElement("div");
  wrap.className = "sednar-image-thumb-wrap theme-transition";
  wrap.setAttribute("data-attachment-id", attachment.id);

  var img = document.createElement("img");
  img.className = "sednar-image-thumb";
  img.src = attachment.data || "";
  img.alt = attachment.name || "image";
  wrap.appendChild(img);

  var removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "sednar-image-thumb-remove";
  removeBtn.title = "Remove image";
  removeBtn.setAttribute("aria-label", "Remove image");
  removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  removeBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.removeSednarAttachmentById(attachment.id);
    return false;
  };
  wrap.appendChild(removeBtn);

  img.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    window.openSednarImageViewer(attachment);
    return false;
  };

  strip.appendChild(wrap);
  strip.style.display = "flex";
  strip.removeAttribute("aria-hidden");
};

window._sednarRouteAttachmentToComposer = function(attachment) {
  if (!attachment) return;
  if (!attachment.id) attachment.id = window._sednarMakeAttachmentId();
  if (attachment.type === "image" && attachment.data) {
    window.addSednarImageThumbnail(attachment);
  } else {
    
    var atRange = window._sednarInsertRange
      ? window._sednarInsertRange.cloneRange()
      : window._sednarGetComposerSelectionRange();
    window.insertSednarInlineFileChip(attachment, atRange);
    window._sednarInsertRange = window._sednarGetComposerSelectionRange();
  }
};

window.removeSednarAttachmentById = function(id) {
  if (!id) return false;
  var input = window._sednarGetComposerInput();
  var caretIndex = null;
  if (input) {
    var chip = input.querySelector('.sednar-inline-file-chip[data-attachment-id="' + id + '"]');
    if (chip && chip.parentNode === input) {
      caretIndex = Array.prototype.indexOf.call(input.childNodes, chip);
      var next = chip.nextSibling;
      chip.remove();
      
      if (next && next.nodeType === Node.TEXT_NODE && (next.textContent === "\u00a0" || next.textContent === " ")) {
        next.remove();
      }
    } else if (chip) {
      chip.remove();
      caretIndex = 0;
    }
  }
  window.sednarPendingAttachments = (window.sednarPendingAttachments || []).filter(function(a) {
    return a && a.id !== id;
  });
  var strip = document.getElementById("sednar-image-thumbnails");
  if (strip) {
    var thumb = strip.querySelector('[data-attachment-id="' + id + '"]');
    if (thumb) thumb.remove();
    if (!strip.children.length) {
      strip.style.display = "none";
      strip.setAttribute("aria-hidden", "true");
    }
  }
  if (input) {
    window._sednarUpdateComposerPlaceholder();
    input.focus();
    var placeIdx = caretIndex != null ? caretIndex : 0;
    var caretRange = window._sednarPlaceComposerCaretAt(input, placeIdx);
    window._sednarInsertRange = caretRange ? caretRange.cloneRange() : null;
    
    requestAnimationFrame(function() {
      var again = window._sednarPlaceComposerCaretAt(input, placeIdx);
      if (again) window._sednarInsertRange = again.cloneRange();
      window._sednarUpdateComposerPlaceholder();
    });
  } else {
    window._sednarUpdateComposerPlaceholder();
  }
  window._sednarResizeComposerInput();
  if (typeof window.updateSednarComposerSendState === "function") {
    window.updateSednarComposerSendState();
  }
  return false;
};

window._sednarSyncAttachmentsFromDom = function() {
  var input = window._sednarGetComposerInput();
  var strip = document.getElementById("sednar-image-thumbnails");
  var liveIds = {};
  if (input) {
    input.querySelectorAll(".sednar-inline-file-chip[data-attachment-id]").forEach(function(el) {
      var id = el.getAttribute("data-attachment-id");
      if (id) liveIds[id] = true;
    });
  }
  if (strip) {
    strip.querySelectorAll("[data-attachment-id]").forEach(function(el) {
      var id = el.getAttribute("data-attachment-id");
      if (id) liveIds[id] = true;
    });
  }
  var pending = window.sednarPendingAttachments || [];
  var next = pending.filter(function(a) {
    return a && a.id && liveIds[a.id];
  });
  if (next.length !== pending.length) {
    window.sednarPendingAttachments = next;
    if (typeof window.updateSednarComposerSendState === "function") {
      window.updateSednarComposerSendState();
    }
  }
};

window.getSednarComposerState = function() {
  var input = window._sednarGetComposerInput();
  var segments = [];
  var textParts = [];

  function walk(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      var val = node.textContent || "";
      if (!val || val === "\u00a0") return;
      segments.push({ type: "text", value: val });
      textParts.push(val);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList && node.classList.contains("sednar-inline-file-chip")) {
      var attId = node.getAttribute("data-attachment-id") || "";
      segments.push({ type: "file", attachment_id: attId });
      return;
    }
    Array.from(node.childNodes).forEach(walk);
  }

  if (input) Array.from(input.childNodes).forEach(walk);

  var attachments = (window.sednarPendingAttachments || []).map(function(a) {
    var copy = {
      id: a.id,
      name: a.name,
      type: a.type || "file",
      size: a.size || 0
    };
    if (a.type === "image" && a.data) {
      copy.data = a.data;
    } else if (a.type === "repo_file" || a.type === "repo_folder") {
      copy.repo_path = a.repo_path || "";
    } else if (a.type === "chat") {
      copy.session_id = a.session_id || "";
    } else if (a.type === "binary") {
      copy.content = a.content || "";
      if (a.note) copy.note = a.note;
    } else if (a.content !== undefined) {
      copy.content = a.content;
      if (a.truncated) copy.truncated = true;
      if (a.pageCount !== undefined) copy.pageCount = a.pageCount;
    }
    return copy;
  });

  return {
    text: textParts.join("").trim(),
    segments: segments,
    attachments: attachments
  };
};

window.clearSednarComposer = function() {
  var input = window._sednarGetComposerInput();
  if (input) input.innerHTML = "";
  var strip = document.getElementById("sednar-image-thumbnails");
  if (strip) {
    strip.innerHTML = "";
    strip.style.display = "none";
    strip.setAttribute("aria-hidden", "true");
  }
  window.sednarPendingAttachments = [];
  window._sednarInsertRange = null;
  if (typeof window._sednarCloseMentionMenu === "function") {
    window._sednarCloseMentionMenu();
  }
  if (typeof window._sednarCloseSlashMenu === "function") {
    window._sednarCloseSlashMenu();
  }
  window._sednarUpdateComposerPlaceholder();
  window._sednarResizeComposerInput();
};

window._sednarGetActiveMention = function() {
  var input = window._sednarGetComposerInput();
  if (!input) return null;
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  var range = sel.getRangeAt(0);
  if (!input.contains(range.startContainer)) return null;
  var preRange = range.cloneRange();
  preRange.selectNodeContents(input);
  preRange.setEnd(range.startContainer, range.startOffset);
  var before = preRange.toString();
  var atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  if (atIndex > 0 && !/\s/.test(before.charAt(atIndex - 1))) return null;
  var query = before.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { query: query, atIndex: atIndex, before: before };
};

window._sednarCaptureMentionDeleteRange = function(mention) {
  if (!mention) return null;
  var input = window._sednarGetComposerInput();
  var sel = window.getSelection();
  if (!input || !sel || sel.rangeCount === 0) return null;
  var endRange = sel.getRangeAt(0);
  var walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT, null, false);
  var charsLeft = mention.atIndex;
  var startNode = null;
  var startOffset = 0;
  while (walker.nextNode()) {
    var node = walker.currentNode;
    var len = (node.textContent || "").length;
    if (charsLeft <= len) {
      startNode = node;
      startOffset = charsLeft;
      break;
    }
    charsLeft -= len;
  }
  if (!startNode) return null;
  var delRange = document.createRange();
  delRange.setStart(startNode, startOffset);
  delRange.setEnd(endRange.endContainer, endRange.endOffset);
  return delRange;
};

window._sednarCloseMentionMenu = function() {
  var menu = document.getElementById("sednar-mention-menu");
  if (menu) {
    menu.style.display = "none";
    menu.innerHTML = "";
  }
  window._sednarMentionSearchSeq = (window._sednarMentionSearchSeq || 0) + 1;
  window._sednarMentionState.active = false;
  window._sednarMentionState.query = "";
  window._sednarMentionState.results = [];
  window._sednarMentionState.selectedIndex = 0;
  window._sednarMentionState.browseDir = "";
  window._sednarMentionState.searching = false;
  window._sednarMentionState.chats = null;
  window._sednarMentionState.chatResults = [];
  window._sednarMentionState.chatSelectedIndex = 0;
  window._sednarMentionState.chatsLoading = false;
  if (window._sednarMentionState.debounceTimer) {
    clearTimeout(window._sednarMentionState.debounceTimer);
    window._sednarMentionState.debounceTimer = null;
  }
};

window._sednarMentionParentDir = function(dir) {
  var path = String(dir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) return "";
  var parts = path.split("/");
  parts.pop();
  return parts.join("/");
};

window._sednarMentionEscapeHtml = function(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
};

window._sednarPositionMentionMenu = function() {

};

window._sednarReplaceActiveMentionText = function(nextText) {
  var mention = window._sednarGetActiveMention();
  var delRange = window._sednarCaptureMentionDeleteRange(mention);
  if (!delRange) return false;
  delRange.deleteContents();
  var textNode = document.createTextNode(nextText == null ? "@" : String(nextText));
  delRange.insertNode(textNode);
  var caret = document.createRange();
  caret.setStart(textNode, textNode.textContent.length);
  caret.collapse(true);
  window._sednarSetComposerSelection(caret);
  window._sednarInsertRange = caret.cloneRange();
  return true;
};

window._sednarBrowseMentionDir = function(dir) {
  window._sednarMentionState.browseDir = String(dir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  window._sednarMentionState.query = "";
  window._sednarMentionState.active = true;
  window._sednarMentionState.searching = false;
  
  window._sednarReplaceActiveMentionText("@");
  window._sednarSearchMentionTargets("", window._sednarMentionState.browseDir);
};

window._sednarAttachMentionItem = function(item) {
  if (!item) return;
  var mention = window._sednarGetActiveMention();
  var delRange = window._sednarCaptureMentionDeleteRange(mention);
  if (delRange) {
    delRange.deleteContents();
    window._sednarSetComposerSelection(delRange);
  }
  window._sednarCloseMentionMenu();
  window.addSednarRepoContextToChat({
    repoPath: item.path || "",
    kind: item.kind === "folder" ? "folder" : "file",
    name: item.name || item.path || ""
  });
};

window._SEDNAR_CHAT_MENTION_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

window._sednarFilterMentionChats = function() {
  var state = window._sednarMentionState;
  var all = state.chats || [];
  var q = String(state.query || "").trim().toLowerCase();
  state.chatResults = all.filter(function(c) {
    if (!q) return true;
    var hay = ((c.title || "") + " " + (c.preview || "") + " " + (c.session_id || "")).toLowerCase();
    return hay.indexOf(q) !== -1;
  }).slice(0, 6);
  state.chatSelectedIndex = 0;
};

window._sednarLoadMentionChats = function() {
  var state = window._sednarMentionState;
  
  if (typeof window.getSednarKnownSessions !== "function") {
    state.chatResults = [];
    return;
  }
  state.chatsLoading = true;
  window.getSednarKnownSessions()
    .then(function(sessions) {
      state.chatsLoading = false;
      state.chats = (sessions || [])
        .filter(function(s) {
          return s && s.session_id;
        })
        .map(function(s) {
          return {
            session_id: s.session_id,
            title: s.title || s.first_user_preview || "Untitled chat",
            preview: s.first_user_preview || ""
          };
        });
      if (!window._sednarMentionState.active) return;
      window._sednarFilterMentionChats();
      window._sednarRenderMentionMenu();
    })
    .catch(function() {
      state.chatsLoading = false;
      state.chats = [];
      state.chatResults = [];
      if (!window._sednarMentionState.active) return;
      window._sednarRenderMentionMenu();
    });
};

window._sednarSelectMentionChat = function(index) {
  var state = window._sednarMentionState;
  var chat = (state.chatResults || [])[index];
  if (!chat) return;
  var mention = window._sednarGetActiveMention();
  var delRange = window._sednarCaptureMentionDeleteRange(mention);
  if (delRange) {
    delRange.deleteContents();
    window._sednarSetComposerSelection(delRange);
  }
  window._sednarCloseMentionMenu();
  window.addSednarChatContextToChat({ session_id: chat.session_id, name: chat.title });
};

window.addSednarChatContextToChat = function(opts) {
  opts = opts || {};
  var sessionId = String(opts.session_id || "").trim();
  if (!sessionId) return false;
  var name = String(opts.name || "").trim() || ("chat " + sessionId.slice(0, 8));
  var pending = window.sednarPendingAttachments || [];
  if (pending.length >= SEDNAR_MAX_ATTACHMENTS) {
    alert("Maximum " + SEDNAR_MAX_ATTACHMENTS + " attachments per message.");
    return false;
  }
  var isDupe = pending.some(function(a) {
    return a && a.type === "chat" && String(a.session_id || "") === sessionId;
  });
  if (isDupe) return false;
  var attachment = {
    id: window._sednarMakeAttachmentId(),
    name: name,
    type: "chat",
    session_id: sessionId,
    size: 0
  };
  pending.push(attachment);
  window.sednarPendingAttachments = pending;
  window.insertSednarInlineFileChip(attachment);
  window._sednarUpdateComposerPlaceholder();
  window._sednarResizeComposerInput();
  if (typeof window.updateSednarComposerSendState === "function") {
    window.updateSednarComposerSendState();
  }
  var input = window._sednarGetComposerInput();
  if (input && typeof input.focus === "function") input.focus();
  return true;
};

window._sednarRenderMentionMenu = function() {
  var menu = document.getElementById("sednar-mention-menu");
  if (!menu) return;
  var state = window._sednarMentionState;
  var results = state.results || [];
  var browseDir = String(state.browseDir || "");
  var isBrowse = !state.searching;
  var headerLabel = state.searching
    ? "Files &amp; Folders"
    : (browseDir ? window._sednarMentionEscapeHtml(browseDir) : "Files &amp; Folders");

  var html = "";

  
  var chatResults = browseDir ? [] : (state.chatResults || []);
  var chatHtml = "";
  if (!browseDir) {
    if (state.chats === null && !state.chatsLoading &&
        typeof window._sednarLoadMentionChats === "function" &&
        (typeof window.getSednarProjectPath !== "function" || window.getSednarProjectPath())) {
      window._sednarLoadMentionChats();
    }
    chatHtml += '<div class="sednar-mention-header sednar-mention-header--chats theme-transition">' +
      '<span class="sednar-mention-header-title">Chats</span></div>';
    var chatsReady = Array.isArray(state.chats) && !state.chatsLoading;
    if (!chatsReady) {
      chatHtml += '<div class="sednar-mention-empty">Loading chats…</div>';
    } else if (!chatResults.length) {
      chatHtml += '<div class="sednar-mention-empty">' +
        (state.chats.length ? "No chats match" : "No other chats in this project yet") +
        "</div>";
    } else {
      var chatNavActive = !results.length;
      chatResults.forEach(function(chat, idx) {
        var escTitle = window._sednarMentionEscapeHtml(chat.title || "Untitled chat");
        var escPrev = window._sednarMentionEscapeHtml(chat.preview || "");
        chatHtml += '<button type="button" class="sednar-mention-item sednar-mention-chat-item theme-transition' +
          (chatNavActive && idx === state.chatSelectedIndex ? " is-selected" : "") +
          '" data-mention-chat-index="' + idx + '">' +
          '<span class="sednar-mention-icon sednar-mention-chat-icon" aria-hidden="true">' + window._SEDNAR_CHAT_MENTION_SVG + "</span>" +
          '<span class="sednar-mention-label">' + escTitle + "</span>" +
          '<span class="sednar-mention-path">' + escPrev + "</span>" +
          "</button>";
      });
    }
  }

  html += '<div class="sednar-mention-header theme-transition">' +
    '<span class="sednar-mention-header-title">' + headerLabel + "</span>" +
    '<span class="sednar-mention-header-actions">';
  if (isBrowse && browseDir) {
    html += '<button type="button" class="sednar-mention-attach-folder theme-transition" data-mention-attach-current="1" title="Attach this folder">Attach</button>';
  }
  html += "</span></div>";

  if (isBrowse && browseDir) {
    var parent = window._sednarMentionParentDir(browseDir);
    html += '<button type="button" class="sednar-mention-crumb theme-transition" data-mention-back="1">' +
      '<span aria-hidden="true">←</span>' +
      '<span class="sednar-mention-crumb-path">' +
      window._sednarMentionEscapeHtml(parent || "/") +
      "</span></button>";
  }

  if (!results.length) {
    html += '<div class="sednar-mention-empty">No files or folders found</div>';
    html += chatHtml;
    menu.innerHTML = html;
    menu.style.display = "block";
    window._sednarBindMentionMenuEvents(menu);
    window._sednarPositionMentionMenu();
    return;
  }

  results.forEach(function(item, idx) {
    var icon = item.kind === "folder" ? "/asset/common/folder.png" : (
      typeof window.getFileIcon === "function" ? window.getFileIcon(item.name || item.path) : "/asset/file-icons/file.png"
    );
    var path = item.path || "";
    var escPath = window._sednarMentionEscapeHtml(path);
    var escName = window._sednarMentionEscapeHtml(item.name || path);
    var hint = item.kind === "folder" ? '<span class="sednar-mention-folder-hint">›</span>' : "";
    html += '<button type="button" class="sednar-mention-item theme-transition' +
      (idx === state.selectedIndex ? " is-selected" : "") +
      '" data-mention-index="' + idx + '">' +
      '<img class="sednar-mention-icon" src="' + icon + '" alt="" />' +
      '<span class="sednar-mention-label">' + escName + "</span>" +
      '<span class="sednar-mention-path">' + escPath + "</span>" +
      hint +
      "</button>";
  });
  html += chatHtml;
  menu.innerHTML = html;
  menu.style.display = "block";
  window._sednarBindMentionMenuEvents(menu);
  var selected = menu.querySelector(".sednar-mention-item.is-selected");
  if (selected && typeof selected.scrollIntoView === "function") {
    selected.scrollIntoView({ block: "nearest" });
  }
  window._sednarPositionMentionMenu();
};

window._sednarBindMentionMenuEvents = function(menu) {
  if (!menu) return;
  var backBtn = menu.querySelector("[data-mention-back]");
  if (backBtn) {
    backBtn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var parent = window._sednarMentionParentDir(window._sednarMentionState.browseDir);
      window._sednarBrowseMentionDir(parent);
    });
  }
  var attachCurrent = menu.querySelector("[data-mention-attach-current]");
  if (attachCurrent) {
    attachCurrent.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var dir = window._sednarMentionState.browseDir || "";
      if (!dir) return;
      window._sednarAttachMentionItem({
        kind: "folder",
        path: dir,
        name: dir.split("/").pop() || dir
      });
    });
  }
  menu.querySelectorAll("[data-mention-chat-index]").forEach(function(btn) {
    btn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      window._sednarSelectMentionChat(parseInt(btn.getAttribute("data-mention-chat-index"), 10));
    });
  });
  menu.querySelectorAll(".sednar-mention-item[data-mention-index]").forEach(function(btn) {
    btn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var index = parseInt(btn.getAttribute("data-mention-index"), 10);
      window._sednarSelectMentionResult(index);
    });
  });
};

window._sednarSearchMentionTargets = function(query, directory) {
  var projectPath = typeof window.getSednarProjectPath === "function"
    ? window.getSednarProjectPath()
    : null;
  if (!projectPath) {
    window._sednarMentionState.results = [];
    window._sednarRenderMentionMenu();
    return;
  }
  var q = query || "";
  var searching = !!String(q).trim();
  var requestSeq = (window._sednarMentionSearchSeq || 0) + 1;
  window._sednarMentionSearchSeq = requestSeq;
  window._sednarMentionState.searching = searching;
  var dir = null;
  if (!searching) {
    dir = directory !== undefined ? directory : window._sednarMentionState.browseDir;
  }
  var workspace = typeof window._sednarCurrentWorkspacePayload === "function"
    ? window._sednarCurrentWorkspacePayload()
    : null;
  var workspaceIdentity = typeof window._sednarWorkspaceIdentityKey === "function"
    ? window._sednarWorkspaceIdentityKey()
    : JSON.stringify(workspace || {});
  fetch("/sednar/context-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_path: projectPath,
      q: q,
      limit: 40,
      directory: dir,
      workspace: workspace,
    }),
  }).then(function(resp) { return resp.json(); }).then(function(data) {
    if (requestSeq !== window._sednarMentionSearchSeq) return;
    if (typeof window._sednarWorkspaceIdentityKey === "function" && workspaceIdentity !== window._sednarWorkspaceIdentityKey()) return;
    if (!window._sednarMentionState.active) return;
    if (window._sednarMentionState.query !== q && searching) return;
    if (!searching && (directory !== undefined) &&
        String(window._sednarMentionState.browseDir || "") !== String(directory || "")) {
      return;
    }
    window._sednarMentionState.results = (data && data.results) || [];
    window._sednarMentionState.selectedIndex = 0;
    if (!searching && data && data.directory !== undefined && String(directory || dir || "") !== "") {
      window._sednarMentionState.browseDir = data.directory || "";
    }
    window._sednarRenderMentionMenu();
  }).catch(function() {
    if (requestSeq !== window._sednarMentionSearchSeq) return;
    if (typeof window._sednarWorkspaceIdentityKey === "function" && workspaceIdentity !== window._sednarWorkspaceIdentityKey()) return;
    if (!window._sednarMentionState.active) return;
    window._sednarMentionState.results = [];
    window._sednarRenderMentionMenu();
  });
};

window._sednarSelectMentionResult = function(index) {
  var state = window._sednarMentionState;
  var item = (state.results || [])[index];
  if (!item) return;
  if (item.kind === "folder") {
    window._sednarBrowseMentionDir(item.path || "");
    return;
  }
  window._sednarAttachMentionItem(item);
};

window._sednarHandleMentionInput = function() {
  var mention = window._sednarGetActiveMention();
  if (!mention) {
    window._sednarCloseMentionMenu();
    return;
  }
  var wasActive = window._sednarMentionState.active;
  window._sednarMentionState.active = true;
  window._sednarMentionState.query = mention.query;
  if (!wasActive || window._sednarMentionState.chats === null) {
    window._sednarLoadMentionChats();
  } else {
    window._sednarFilterMentionChats();
  }
  if (window._sednarMentionState.debounceTimer) {
    clearTimeout(window._sednarMentionState.debounceTimer);
  }
  window._sednarMentionState.debounceTimer = setTimeout(function() {
    var q = window._sednarMentionState.query || "";
    if (String(q).trim()) {
      window._sednarSearchMentionTargets(q);
    } else {
      window._sednarSearchMentionTargets("", window._sednarMentionState.browseDir || "");
    }
  }, 120);
};

window._sednarGetActiveSlash = function() {
  var input = window._sednarGetComposerInput();
  if (!input) return null;
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  var range = sel.getRangeAt(0);
  if (!input.contains(range.startContainer)) return null;
  var preRange = range.cloneRange();
  preRange.selectNodeContents(input);
  preRange.setEnd(range.startContainer, range.startOffset);
  var before = preRange.toString();
  if (before.charAt(0) !== "/") return null;
  var query = before.slice(1);
  if (/\s/.test(query)) return null;
  return { query: query, before: before };
};

window._sednarCloseSlashMenu = function() {
  var menu = document.getElementById("sednar-slash-menu");
  if (menu) {
    menu.style.display = "none";
    menu.innerHTML = "";
  }
  window._sednarSlashState.active = false;
  window._sednarSlashState.query = "";
  window._sednarSlashState.results = [];
  window._sednarSlashState.selectedIndex = 0;
};

window._sednarPositionSlashMenu = function() {

};

window._sednarRenderSlashMenu = function() {
  var menu = document.getElementById("sednar-slash-menu");
  if (!menu) return;
  var state = window._sednarSlashState;
  var results = state.results || [];

  var html = '<div class="sednar-mention-header theme-transition">' +
    '<span class="sednar-mention-header-title">Skills</span></div>';

  if (state.loading) {
    html += '<div class="sednar-mention-empty">Loading skills…</div>';
    menu.innerHTML = html;
    menu.style.display = "block";
    window._sednarPositionSlashMenu();
    return;
  }

  if (!results.length) {
    html += '<div class="sednar-mention-empty">No skills found in this project</div>';
    menu.innerHTML = html;
    menu.style.display = "block";
    window._sednarPositionSlashMenu();
    return;
  }

  results.forEach(function(item, idx) {
    var escName = window._sednarMentionEscapeHtml(item.name || "");
    var escDesc = window._sednarMentionEscapeHtml(item.description || "");
    html += '<button type="button" class="sednar-mention-item sednar-slash-item theme-transition' +
      (idx === state.selectedIndex ? " is-selected" : "") +
      '" data-slash-index="' + idx + '">' +
      '<span class="sednar-slash-item-label">/' + escName + "</span>" +
      '<span class="sednar-slash-item-desc">' + escDesc + "</span>" +
      "</button>";
  });
  menu.innerHTML = html;
  menu.style.display = "block";
  menu.querySelectorAll(".sednar-mention-item").forEach(function(btn) {
    btn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      var index = parseInt(btn.getAttribute("data-slash-index"), 10);
      window._sednarSelectSlashResult(index);
    });
  });
  var selected = menu.querySelector(".sednar-mention-item.is-selected");
  if (selected && typeof selected.scrollIntoView === "function") {
    selected.scrollIntoView({ block: "nearest" });
  }
  window._sednarPositionSlashMenu();
};

window._sednarFilterSlashSkills = function(query) {
  var state = window._sednarSlashState;
  var all = state.allSkills || [];
  var q = String(query || "").trim().toLowerCase();
  state.results = !q ? all.slice() : all.filter(function(item) {
    return (item.name || "").toLowerCase().indexOf(q) !== -1;
  });
  state.selectedIndex = 0;
  window._sednarRenderSlashMenu();
};

window._sednarLoadProjectSkills = function() {
  var projectPath = typeof window.getSednarProjectPath === "function"
    ? window.getSednarProjectPath()
    : null;
  if (!projectPath) {
    window._sednarSlashState.allSkills = [];
    window._sednarFilterSlashSkills(window._sednarSlashState.query);
    return;
  }
  window._sednarSlashState.loading = true;
  window._sednarRenderSlashMenu();
  var workspacePayload = typeof window._sednarCurrentWorkspacePayload === "function"
    ? window._sednarCurrentWorkspacePayload()
    : null;
  fetch("/sednar/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_path: projectPath, workspace: workspacePayload })
  })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      window._sednarSlashState.loading = false;
      window._sednarSlashState.allSkills = (data && data.skills) || [];
      if (!window._sednarSlashState.active) return;
      window._sednarFilterSlashSkills(window._sednarSlashState.query);
    })
    .catch(function() {
      window._sednarSlashState.loading = false;
      window._sednarSlashState.allSkills = [];
      if (!window._sednarSlashState.active) return;
      window._sednarFilterSlashSkills(window._sednarSlashState.query);
    });
};

window._sednarCaptureSlashDeleteRange = function() {
  var input = window._sednarGetComposerInput();
  var sel = window.getSelection();
  if (!input || !sel || sel.rangeCount === 0) return null;
  var endRange = sel.getRangeAt(0);
  var startNode = input.firstChild;
  if (!startNode) return null;
  var delRange = document.createRange();
  delRange.setStart(startNode, 0);
  delRange.setEnd(endRange.endContainer, endRange.endOffset);
  return delRange;
};

window._sednarSelectSlashResult = function(index) {
  var state = window._sednarSlashState;
  var item = (state.results || [])[index];
  if (!item) return;
  var delRange = window._sednarCaptureSlashDeleteRange();
  window._sednarCloseSlashMenu();
  if (!delRange) return;
  delRange.deleteContents();
  var tag = document.createElement("span");
  tag.className = "sednar-slash-tag";
  tag.contentEditable = "false";
  tag.textContent = "/" + item.name;
  var spaceNode = document.createTextNode(" ");
  var frag = document.createDocumentFragment();
  frag.appendChild(tag);
  frag.appendChild(spaceNode);
  delRange.insertNode(frag);
  var caret = document.createRange();
  caret.setStart(spaceNode, spaceNode.textContent.length);
  caret.collapse(true);
  window._sednarSetComposerSelection(caret);
  window._sednarInsertRange = caret.cloneRange();
  window._sednarUpdateComposerPlaceholder();
  window._sednarResizeComposerInput();
};

window._sednarHandleSlashInput = function() {
  var slash = window._sednarGetActiveSlash();
  if (!slash) {
    window._sednarCloseSlashMenu();
    return;
  }
  var state = window._sednarSlashState;
  var wasActive = state.active;
  state.active = true;
  state.query = slash.query;
  if (!wasActive || state.allSkills === null) {
    window._sednarLoadProjectSkills();
  } else {
    window._sednarFilterSlashSkills(state.query);
  }
};

window._sednarCleanupSlashTags = function() {
  var input = window._sednarGetComposerInput();
  if (!input) return;
  var tags = input.querySelectorAll(".sednar-slash-tag");
  for (var i = 0; i < tags.length; i++) {
    var tag = tags[i];
    var text = tag.textContent || "";
    if (text && text.charAt(0) === "/" && !/\s/.test(text)) continue;
    var parent = tag.parentNode;
    if (!parent) continue;
    if (text) {
      parent.replaceChild(document.createTextNode(text), tag);
    } else {
      parent.removeChild(tag);
    }
  }
};

window.initSednarComposerInput = function() {
  var input = window._sednarGetComposerInput();
  if (!input || input.dataset.sednarComposerInit) return;
  input.dataset.sednarComposerInit = "true";

  input.addEventListener("input", function() {
    window._sednarCleanupSlashTags();
    window._sednarSyncAttachmentsFromDom();
    window._sednarUpdateComposerPlaceholder();
    window._sednarResizeComposerInput();
    window._sednarHandleMentionInput();
    window._sednarHandleSlashInput();
  });

  input.addEventListener("paste", function(e) {
    var clipboard = e.clipboardData || window.clipboardData;
    if (!clipboard) return;
    var imageFiles = [];
    if (clipboard.items) {
      for (var i = 0; i < clipboard.items.length; i++) {
        var item = clipboard.items[i];
        if (item.kind === "file" && item.type && item.type.indexOf("image/") === 0) {
          var file = item.getAsFile && item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      window.queueSednarAttachmentFiles(imageFiles);
      return;
    }
    e.preventDefault();
    var text = clipboard.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
  });

  input.addEventListener("keydown", function(e) {
    if (window._sednarSlashState.active) {
      var slashResults = window._sednarSlashState.results || [];
      if (e.key === "ArrowDown" && slashResults.length) {
        e.preventDefault();
        window._sednarSlashState.selectedIndex =
          (window._sednarSlashState.selectedIndex + 1) % slashResults.length;
        window._sednarRenderSlashMenu();
        return;
      }
      if (e.key === "ArrowUp" && slashResults.length) {
        e.preventDefault();
        window._sednarSlashState.selectedIndex =
          (window._sednarSlashState.selectedIndex - 1 + slashResults.length) % slashResults.length;
        window._sednarRenderSlashMenu();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (slashResults.length) {
          e.preventDefault();
          window._sednarSelectSlashResult(window._sednarSlashState.selectedIndex);
        } else {
          window._sednarCloseSlashMenu();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        window._sednarCloseSlashMenu();
        return;
      }
    }
    if (window._sednarMentionState.active) {
      var results = window._sednarMentionState.results || [];
      var chatResults = window._sednarMentionState.chatResults || [];
      
      if (!results.length && chatResults.length && !(window._sednarMentionState.browseDir || "")) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          window._sednarMentionState.chatSelectedIndex =
            (window._sednarMentionState.chatSelectedIndex + 1) % chatResults.length;
          window._sednarRenderMentionMenu();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          window._sednarMentionState.chatSelectedIndex =
            (window._sednarMentionState.chatSelectedIndex - 1 + chatResults.length) % chatResults.length;
          window._sednarRenderMentionMenu();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          window._sednarSelectMentionChat(window._sednarMentionState.chatSelectedIndex);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          window._sednarCloseMentionMenu();
          return;
        }
      }
      if (e.key === "ArrowDown" && results.length) {
        e.preventDefault();
        window._sednarMentionState.selectedIndex =
          (window._sednarMentionState.selectedIndex + 1) % results.length;
        window._sednarRenderMentionMenu();
        return;
      }
      if (e.key === "ArrowUp" && results.length) {
        e.preventDefault();
        window._sednarMentionState.selectedIndex =
          (window._sednarMentionState.selectedIndex - 1 + results.length) % results.length;
        window._sednarRenderMentionMenu();
        return;
      }
      if (e.key === "ArrowLeft" && !window._sednarMentionState.searching) {
        var browseDir = window._sednarMentionState.browseDir || "";
        if (browseDir) {
          e.preventDefault();
          window._sednarBrowseMentionDir(window._sednarMentionParentDir(browseDir));
          return;
        }
      }
      if (e.key === "ArrowRight" && results.length) {
        var rightItem = results[window._sednarMentionState.selectedIndex];
        if (rightItem && rightItem.kind === "folder") {
          e.preventDefault();
          window._sednarBrowseMentionDir(rightItem.path || "");
          return;
        }
      }
      if (e.key === "Enter" && results.length) {
        e.preventDefault();
        var focused = results[window._sednarMentionState.selectedIndex];
        if (e.shiftKey && focused && focused.kind === "folder") {
          window._sednarAttachMentionItem(focused);
          return;
        }
        window._sednarSelectMentionResult(window._sednarMentionState.selectedIndex);
        return;
      }
      if (e.key === "Enter" && !results.length && (window._sednarMentionState.browseDir || "") && e.shiftKey) {
        e.preventDefault();
        var dir = window._sednarMentionState.browseDir;
        window._sednarAttachMentionItem({
          kind: "folder",
          path: dir,
          name: dir.split("/").pop() || dir
        });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        window._sednarCloseMentionMenu();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (typeof window.sendSednarAgentMessage === "function") {
        window.sendSednarAgentMessage();
      }
      return;
    }
    if (e.key === "Backspace") {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      var offset = range.startOffset;
      var prev = null;
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        prev = node.previousSibling;
      } else if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
        prev = node.childNodes[offset - 1];
      } else if (node.nodeType === Node.TEXT_NODE && offset > 0) {
        return;
      }
      if (prev && prev.classList && prev.classList.contains("sednar-inline-file-chip")) {
        e.preventDefault();
        var attId = prev.getAttribute("data-attachment-id");
        window.removeSednarAttachmentById(attId);
      } else if (prev && prev.classList && prev.classList.contains("sednar-slash-tag")) {
        e.preventDefault();
        if (prev.parentNode) prev.parentNode.removeChild(prev);
        window._sednarUpdateComposerPlaceholder();
        window._sednarResizeComposerInput();
        window._sednarHandleSlashInput();
      }
    }
  });

  window._sednarUpdateComposerPlaceholder();
  document.addEventListener("mousedown", function(ev) {
    var menu = document.getElementById("sednar-mention-menu");
    if (!menu || menu.style.display === "none") return;
    if (menu.contains(ev.target) || (input && input.contains(ev.target))) return;
    window._sednarCloseMentionMenu();
  });
  document.addEventListener("mousedown", function(ev) {
    var menu = document.getElementById("sednar-slash-menu");
    if (!menu || menu.style.display === "none") return;
    if (menu.contains(ev.target) || (input && input.contains(ev.target))) return;
    window._sednarCloseSlashMenu();
  });
};

window.queueSednarAttachmentFiles = function(files) {
  if (!files || !files.length) return;
  
  var liveRange = window._sednarGetComposerSelectionRange();
  if (liveRange) {
    window._sednarInsertRange = liveRange;
  } else if (!window._sednarInsertRange) {
    var input = window._sednarGetComposerInput();
    if (input) {
      input.focus();
      var endRange = document.createRange();
      endRange.selectNodeContents(input);
      endRange.collapse(false);
      window._sednarSetComposerSelection(endRange);
      window._sednarInsertRange = endRange.cloneRange();
    }
  }
  window.sednarQueueAttachmentFiles(files, {
    maxAttachments: SEDNAR_MAX_ATTACHMENTS,
    getList: function() { return window.sednarPendingAttachments || []; },
    setList: function(list) { window.sednarPendingAttachments = list; },
    loadingKey: "sednarAttachmentsLoadingCount",
    onAttachment: function(attachment) {
      if (!attachment.id) attachment.id = window._sednarMakeAttachmentId();
      var list = window.sednarPendingAttachments || [];
      
      if (list.some(function(a) { return a && a.id === attachment.id; })) {
        window._sednarRouteAttachmentToComposer(attachment);
        return;
      }
      list.push(attachment);
      window.sednarPendingAttachments = list;
      window._sednarRouteAttachmentToComposer(attachment);
    },
    onUpdate: function() {
      window.updateSednarComposerSendState();
    }
  });
};

window.areSednarAttachmentsReady = function() {
  return (window.sednarAttachmentsLoadingCount || 0) === 0;
};

window.updateSednarComposerSendState = function() {
  var loading = (window.sednarAttachmentsLoadingCount || 0) > 0;
  var composer = document.getElementById("sednar-chat-composer");
  if (composer) {
    composer.classList.toggle("is-attachments-loading", loading);
  }
  var sendBtn = document.querySelector("#sednar-chat-composer .chatbot-composer-send-btn");
  if (sendBtn) {
    sendBtn.disabled = loading;
    sendBtn.title = loading ? "Waiting for files to finish loading" : "Send";
    sendBtn.setAttribute("aria-label", loading ? "Waiting for files" : "Send");
  }
};

window.buildSednarImageThumbnailsRow = function(images, options) {
  options = options || {};
  images = (images || []).filter(function(a) {
    return a && a.type === "image" && a.data;
  });
  if (!images.length) return null;

  var thumbRow = document.createElement("div");
  thumbRow.className = "sednar-user-image-thumbnails";
  images.forEach(function(imgAtt) {
    var wrap = document.createElement("div");
    wrap.className = "sednar-image-thumb-wrap theme-transition" + (options.readonly ? " readonly" : "");
    wrap.setAttribute("data-attachment-id", imgAtt.id || "");
    var img = document.createElement("img");
    img.className = "sednar-image-thumb";
    img.src = imgAtt.data;
    img.alt = imgAtt.name || "image";
    wrap.appendChild(img);
    thumbRow.appendChild(wrap);
  });
  return thumbRow;
};

window.buildSednarUserMessageElement = function(displayPayload) {
  displayPayload = displayPayload || {};
  var block = document.createElement("div");
  block.className = "chat-user-block";

  var attMap = {};
  (displayPayload.attachments || []).forEach(function(a) {
    if (a && a.id) attMap[a.id] = a;
  });

  var images = (displayPayload.attachments || []).filter(function(a) {
    return a && a.type === "image" && a.data;
  });
  var segments = displayPayload.segments;
  var text = String(displayPayload.text || "").trim();
  var hasSegments = segments && segments.length;
  var hasImages = images.length > 0;
  var hasTextContent = hasSegments || text;

  if (hasImages || hasTextContent) {
    var msgEl = document.createElement("div");
    msgEl.className = "chat-msg user sednar-user-inline";

    if (hasImages) {
      var thumbRow = window.buildSednarImageThumbnailsRow(images, { readonly: true });
      if (thumbRow) msgEl.appendChild(thumbRow);
    }

    if (hasSegments) {
      segments.forEach(function(seg) {
        if (!seg) return;
        if (seg.type === "text" && seg.value) {
          msgEl.appendChild(document.createTextNode(seg.value));
        } else if (seg.type === "file" && seg.attachment_id && attMap[seg.attachment_id]) {
          msgEl.appendChild(window.buildSednarInlineFileChipElement(attMap[seg.attachment_id], { readonly: true }));
        }
      });
    } else if (text) {
      msgEl.appendChild(document.createTextNode(text));
    }

    if (msgEl.childNodes.length) block.appendChild(msgEl);
  }

  return block;
};

window.renderSednarUserMessage = function(output, displayPayload) {
  if (!output) return null;
  displayPayload = displayPayload || {};
  var hasContent = (displayPayload.text || "").trim() ||
    (displayPayload.segments && displayPayload.segments.length) ||
    (displayPayload.attachments && displayPayload.attachments.length);
  if (!hasContent) return null;

  var userRow = document.createElement("div");
  userRow.className = "chat-row sednar-user-row";
  userRow.appendChild(window.buildSednarUserMessageElement(displayPayload));
  output.appendChild(userRow);
  return userRow;
};

window.serializeSednarDisplayPayload = function(state) {
  state = state || window.getSednarComposerState();
  return {
    text: state.text || "",
    segments: (state.segments || []).slice(),
    attachments: (state.attachments || []).slice()
  };
};

window.getSednarApiAttachments = function() {
  return (window.sednarPendingAttachments || []).map(function(a) {
    var copy = {
      name: a.name,
      type: a.type || "file",
      size: a.size || 0
    };
    if (a.type === "image" && a.data) {
      copy.data = a.data;
    } else if (a.type === "repo_file" || a.type === "repo_folder") {
      copy.repo_path = a.repo_path || "";
    } else if (a.type === "chat") {
      copy.session_id = a.session_id || "";
    } else if (a.type === "binary") {
      copy.content = a.content || "";
      if (a.note) copy.note = a.note;
    } else if (a.content !== undefined) {
      copy.content = a.content;
      if (a.truncated) copy.truncated = true;
      if (a.pageCount !== undefined) copy.pageCount = a.pageCount;
    }
    return copy;
  });
};

window._sednarAttachmentDisplayName = function(file) {
  if (!file) return "file";
  return file._chatRelativePath || file.name || "file";
};

window.sednarProcessSingleAttachmentFile = function(file, onPush, onDone) {
  var displayName = window._sednarAttachmentDisplayName(file);
  if (window.isLikelyDirectoryStub(file)) {
    console.warn("Skipping directory stub:", displayName);
    alert(
      "\"" + displayName + "\" is a folder. Drop its files, or drag the folder from the Sednar explorer to add project context."
    );
    onDone();
    return;
  }
  if (window.isBinaryAttachmentFile(file)) {
    onPush({
      name: displayName,
      type: "binary",
      content: "",
      truncated: false,
      size: file.size || 0,
      note: "Binary file attached by name only (content not inlined)."
    });
    onDone();
    return;
  }
  if (window.isImageFile(file)) {
    window.compressImage(file, 1024, 1024, 0.7).then(function(dataUrl) {
      onPush({
        name: displayName,
        type: "image",
        data: dataUrl,
        size: file.size
      });
      onDone();
    }).catch(function(err) {
      console.error("Could not process image:", displayName, err);
      alert("Could not process image: " + displayName);
      onDone();
    });
    return;
  }
  if (window.isPDFFile(file)) {
    window.processPDFForChat(file, window.CHAT_FILE_LIMITS.pdf.maxPages, false).then(function(result) {
      if (result.mode === "images" && result.images && result.images.length > 0) {
        result.images.forEach(function(img) {
          onPush({
            name: displayName + " (page " + img.pageNum + "/" + result.totalPages + ")",
            type: "image",
            data: img.data,
            size: file.size,
            pdfPage: img.pageNum,
            pdfTotalPages: result.totalPages
          });
        });
      } else {
        var content = result.text;
        var truncated = result.truncated;
        if (content.length > (window.CHAT_FILE_LIMITS.txt.maxChars || 100000)) {
          content = content.slice(0, window.CHAT_FILE_LIMITS.txt.maxChars || 100000);
          truncated = true;
        }
        onPush({
          name: displayName,
          type: "pdf",
          content: content,
          truncated: truncated,
          size: file.size,
          pageCount: result.pageCount
        });
      }
      onDone();
    }).catch(function(err) {
      console.error("Could not process PDF:", displayName, err);
      alert("Could not process PDF: " + displayName + ". " + (err.message || ""));
      onDone();
    });
    return;
  }
  if (window.isDOCXFile(file)) {
    window.extractDOCXText(file).then(function(result) {
      var content = result.text;
      var truncated = false;
      if (content.length > (window.CHAT_FILE_LIMITS.txt.maxChars || 100000)) {
        content = content.slice(0, window.CHAT_FILE_LIMITS.txt.maxChars || 100000);
        truncated = true;
      }
      onPush({
        name: displayName,
        type: "docx",
        content: content,
        truncated: truncated,
        size: file.size
      });
      onDone();
    }).catch(function(err) {
      console.error("Could not extract DOCX text:", displayName, err);
      alert("Could not process DOCX: " + displayName + ". " + (err.message || ""));
      onDone();
    });
    return;
  }
  var reader = new FileReader();
  reader.onload = function(evt) {
    var content = String(evt.target.result || "");
    var truncated = false;
    if (content.length > CHAT_ATTACHMENT_MAX_CHARS) {
      content = content.slice(0, CHAT_ATTACHMENT_MAX_CHARS);
      truncated = true;
    }
    onPush({
      name: displayName,
      type: "text",
      content: content,
      truncated: truncated,
      size: file.size
    });
    onDone();
  };
  reader.onerror = function() {
    console.error("Could not read file:", displayName);
    alert(
      "Could not read \"" + displayName + "\". " +
      "If this is a folder, drop its files instead, or drag the folder from the Sednar explorer to add project context."
    );
    onDone();
  };
  reader.readAsText(file);
};

window.sednarQueueAttachmentFiles = function(files, options) {
  options = options || {};
  var maxAttachments = options.maxAttachments || CHAT_MAX_ATTACHMENTS;
  var getList = options.getList || function() { return []; };
  var setList = options.setList || function() {};
  var loadingKey = options.loadingKey || "chatAttachmentsLoadingCount";
  var onUpdate = options.onUpdate || function() {};

  if (!files || !files.length) return;
  var filesToProcess = Array.from(files);
  var currentCount = (getList() || []).length;
  var availableSlots = maxAttachments - currentCount;

  var skippedDirs = [];
  filesToProcess = filesToProcess.filter(function(file) {
    if (window.isLikelyDirectoryStub && window.isLikelyDirectoryStub(file)) {
      skippedDirs.push(file.name || "folder");
      return false;
    }
    return true;
  });
  if (skippedDirs.length) {
    alert(
      "Skipped folder" + (skippedDirs.length > 1 ? "s" : "") + ": " + skippedDirs.join(", ") +
      ". Drop files inside, or drag from the Sednar explorer for project context."
    );
  }
  if (!filesToProcess.length) return;

  if (filesToProcess.length > availableSlots) {
    alert(
      "You can attach up to " + maxAttachments + " files. " +
      (availableSlots > 0 ? "Only " + availableSlots + " more file(s) can be added." : "Remove some files first.")
    );
    if (availableSlots <= 0) return;
    filesToProcess = filesToProcess.slice(0, availableSlots);
  }

  var oversizedFiles = [];
  var validFiles = [];
  filesToProcess.forEach(function(file) {
    var maxSize = window.getFileSizeLimit(file);
    var category = window.getFileTypeCategory(file);
    if (file.size > maxSize) {
      var limitMB = Math.round(maxSize / (1024 * 1024));
      oversizedFiles.push(file.name + " (max " + limitMB + " MB for " + category + ")");
    } else {
      validFiles.push(file);
    }
  });
  if (oversizedFiles.length > 0) {
    alert("These files are too large: " + oversizedFiles.join(", "));
  }
  if (validFiles.length === 0) return;

  window[loadingKey] = (window[loadingKey] || 0) + validFiles.length;
  onUpdate();

  var processedCount = 0;
  var finishOne = function() {
    processedCount++;
    window[loadingKey] = Math.max(0, (window[loadingKey] || 0) - 1);
    if (processedCount === validFiles.length) {
      onUpdate();
    }
  };

  validFiles.forEach(function(file) {
    window.sednarProcessSingleAttachmentFile(file, function(attachment) {
      if (typeof options.onAttachment === "function") {
        options.onAttachment(attachment);
      } else {
        var list = getList() || [];
        list.push(attachment);
        setList(list);
      }
    }, finishOne);
  });
};

window.updateChatbotModelLabel = function(input) {
  if (!input) {
    return;
  }
  const wrap = input.closest(".chatbot-composer-model-wrap");
  if (!wrap) {
    return;
  }
  const labelEl = wrap.querySelector("[data-chatbot-model-label]");
  if (!labelEl) {
    return;
  }
  const value = String(input.value || "").trim();
  const options = window.getChatbotModelOptions();
  const opt = options.find(function(item) {
    return item.value === value;
  });
  const label = opt ? opt.label : value;
  labelEl.textContent = label;
  if (label) {
    labelEl.title = label;
    wrap.title = label;
    wrap.setAttribute("aria-label", "Select model: " + label);
  }
};

window.syncChatbotModelLabels = function() {
  document.querySelectorAll("[data-chatbot-model-select]").forEach(function(sel) {
    window.updateChatbotModelLabel(sel);
  });
};

window.initChatbotModelSelectors = function() {
  try {
    const currentModel = typeof window.getSednarAiModel === "function" ? window.getSednarAiModel() : "auto";
    document.querySelectorAll("[data-chatbot-model-select]").forEach(function(input) {
      const options = window.getChatbotModelOptions();
      const resolvedModel = options.some(function(opt) {
        return opt.value === currentModel;
      }) ? currentModel : "auto";
      input.value = resolvedModel;
      window.updateChatbotModelLabel(input);
    });
    document.querySelectorAll("[data-chatbot-model-trigger]").forEach(function(trigger) {
      if (trigger.dataset.listenerAdded) {
        return;
      }
      trigger.addEventListener("click", function(e) {
        e.stopPropagation();
        e.preventDefault();
        window.toggleChatbotModelDropdown(trigger);
      });
      trigger.addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.toggleChatbotModelDropdown(trigger);
        } else if (e.key === "Escape") {
          window.closeChatbotModelDropdown();
        }
      });
      trigger.dataset.listenerAdded = "true";
    });
    if (!window._chatbotModelDocClickInitialized) {
      window._chatbotModelDocClickInitialized = true;
      document.addEventListener("click", function(e) {
        const dropdown = document.getElementById("chatbot-model-dropdown");
        if (!dropdown || dropdown.style.display !== "flex") {
          return;
        }
        const clickedTrigger = e.target.closest("[data-chatbot-model-trigger]");
        if (!dropdown.contains(e.target) && !clickedTrigger) {
          window.closeChatbotModelDropdown();
        }
      });
    }
    window.renderChatbotModelDropdownList(currentModel);
  } catch (e) {
    console.error("Error initializing chatbot model selectors:", e);
  }
};

window.getSednarAiModel = function() {
  const defaultModel = "auto";
  try {
    const saved = localStorage.getItem("sednar-ai-model");
    if (saved && String(saved).trim() && !window.isLocalOllamaModel(saved)) {
      return String(saved).trim();
    }
    if (saved && window.isLocalOllamaModel(saved)) {
      localStorage.setItem("sednar-ai-model", defaultModel);
      return defaultModel;
    }
    const modelSelect = document.getElementById("global-ai-model");
    if (modelSelect && modelSelect.value && !window.isLocalOllamaModel(modelSelect.value)) {
      return modelSelect.value;
    }
  } catch (e) {}
  return defaultModel;
};

window.syncAuxiliaryModelSelectors = function() {
  try {
    const model = window.getSednarAiModel();
    [ "airflow-debug-model", "airflow-debug-model-selector" ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = model;
    });
    document.querySelectorAll("[data-chatbot-model-select]").forEach(function(sel) {
      if (sel.value !== model) {
        sel.value = model;
      }
    });
    if (typeof window.syncChatbotModelLabels === "function") {
      window.syncChatbotModelLabels();
    }
  } catch (e) {}
};

window.openSednarImageViewer = function(attachment) {
  if (!attachment || !attachment.data) return;
  var modal = document.getElementById("sednarImageViewerModal");
  var img = document.getElementById("sednar-image-viewer-img");
  var title = document.getElementById("sednar-image-viewer-title");
  var info = document.getElementById("sednar-image-viewer-info");
  if (!modal || !img) return;
  img.src = attachment.data;
  img.alt = attachment.name || "Image preview";
  if (title) title.textContent = attachment.name || "Image";
  if (info) {
    info.textContent = attachment.size ? (attachment.size / 1024).toFixed(1) + " KB" : "";
  }
  modal.style.display = "flex";
  requestAnimationFrame(function() {
    modal.classList.add("is-open");
  });
};



// Drag-and-drop and file-picker attachments for the Sednar composer.
window.sednarCollectFilesFromDataTransfer = function(dataTransfer, options) {
  options = options || {};
  var maxFiles = options.maxFiles || 50;

  return new Promise(function(resolve) {
    if (!dataTransfer) {
      resolve([]);
      return;
    }

    var items = dataTransfer.items;
    var canUseEntries = !!(items && items.length && items[0] && typeof items[0].webkitGetAsEntry === "function");
    if (!canUseEntries) {
      resolve(Array.prototype.slice.call(dataTransfer.files || [], 0));
      return;
    }

    var rootEntries = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind !== "file") continue;
      var entry = items[i].webkitGetAsEntry();
      if (entry) rootEntries.push(entry);
    }
    if (!rootEntries.length) {
      resolve(Array.prototype.slice.call(dataTransfer.files || [], 0));
      return;
    }

    var collected = [];
    var pending = 0;
    var settled = false;

    var settle = function() {
      if (settled || pending > 0) return;
      settled = true;
      resolve(collected);
    };
    var bump = function() { pending++; };
    var doneOne = function() {
      pending = Math.max(0, pending - 1);
      settle();
    };

    var shouldSkipDir = function(name) {
      return !!(window.SEDNAR_DROP_SKIP_DIRS && window.SEDNAR_DROP_SKIP_DIRS[name]);
    };
    var shouldSkipFile = function(name) {
      return name === ".DS_Store" || name === "Thumbs.db";
    };

    var addFileEntry = function(fileEntry) {
      if (collected.length >= maxFiles) return;
      if (shouldSkipFile(fileEntry.name)) return;
      bump();
      fileEntry.file(function(file) {
        if (collected.length < maxFiles) {
          var rel = String(fileEntry.fullPath || file.name || "").replace(/^\//, "");
          try {
            Object.defineProperty(file, "_chatRelativePath", {
              value: rel,
              enumerable: false,
              configurable: true
            });
          } catch (err) {  }
          collected.push(file);
        }
        doneOne();
      }, function() {
        doneOne();
      });
    };

    var readDirectory = function(dirEntry) {
      if (shouldSkipDir(dirEntry.name)) return;
      bump();
      var reader = dirEntry.createReader();
      var readNext = function() {
        reader.readEntries(function(entries) {
          if (!entries || !entries.length) {
            doneOne();
            return;
          }
          for (var j = 0; j < entries.length; j++) {
            if (collected.length >= maxFiles) break;
            var child = entries[j];
            if (child.isDirectory) {
              readDirectory(child);
            } else if (child.isFile) {
              addFileEntry(child);
            }
          }
          if (collected.length >= maxFiles) {
            doneOne();
            return;
          }
          readNext();
        }, function() {
          doneOne();
        });
      };
      readNext();
    };

    bump();
    rootEntries.forEach(function(entry) {
      if (collected.length >= maxFiles) return;
      if (entry.isDirectory) {
        readDirectory(entry);
      } else if (entry.isFile) {
        addFileEntry(entry);
      }
    });
    doneOne();
  });
};

(function setupSednarFileAttachInput() {
  function bindFileInput() {
    var fileInput = document.getElementById("sednar-attach-file-input");
    if (!fileInput || fileInput.dataset.listenerAdded) return;
    fileInput.addEventListener("change", function(e) {
      var files = e.target.files;
      if (!files || files.length === 0) return;
      window.queueSednarAttachmentFiles(files);
      fileInput.value = "";
    });
    fileInput.dataset.listenerAdded = "true";
  }

  function bindDragDrop() {
    var pillWrapper = document.getElementById("sednar-chat-pill-wrapper");
    var composer = document.getElementById("sednar-chat-composer");
    var dropTarget = pillWrapper || composer;
    if (!dropTarget || window._sednarDragDropBound) return;
    window._sednarDragDropBound = true;

    var dragDepth = 0;
    var ghostEl = document.getElementById("sednar-drag-ghost-pill");
    var repoMime = "application/x-sednar-repo-context";

    var isRepoContextDrag = function(dt) {
      return dt && Array.from(dt.types || []).indexOf(repoMime) !== -1;
    };

    var isFileSystemDrag = function(dt) {
      return dt && Array.from(dt.types || []).indexOf("Files") !== -1;
    };

    var isAcceptedDrag = function(dt) {
      return isRepoContextDrag(dt) || isFileSystemDrag(dt) || !!window._sednarRepoDragPayload;
    };

    var parseRepoDragPayload = function(dt) {
      if (window._sednarRepoDragPayload) {
        return window._sednarRepoDragPayload;
      }
      if (!dt) return null;
      try {
        var raw = dt.getData(repoMime);
        if (raw) return JSON.parse(raw);
      } catch (err) {  }
      return null;
    };

    var hideGhost = function() {
      if (ghostEl) {
        ghostEl.style.display = "none";
        ghostEl.innerHTML = "";
      }
    };

    var showGhostForEvent = function(e) {
      if (!ghostEl) return;
      var repoPayload = window._sednarRepoDragPayload;
      if (repoPayload && (repoPayload.name || repoPayload.repoPath)) {
        ghostEl.innerHTML = window.buildSednarDragGhostPillHtml(
          repoPayload.name || repoPayload.repoPath
        );
        ghostEl.style.display = "block";
        return;
      }
      if (!e.dataTransfer || !e.dataTransfer.items) return;
      var fileName = "";
      for (var i = 0; i < e.dataTransfer.items.length; i++) {
        var item = e.dataTransfer.items[i];
        if (item.kind !== "file") continue;
        var entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (entry && entry.name) {
          fileName = entry.name;
          break;
        }
        var asFile = item.getAsFile && item.getAsFile();
        if (asFile && asFile.name) {
          fileName = asFile.name;
          break;
        }
      }
      if (!fileName) return;
      ghostEl.innerHTML = window.buildSednarDragGhostPillHtml(fileName);
      ghostEl.style.display = "block";
    };

    var setDragState = function(active, e) {
      if (composer) composer.classList.toggle("sednar-composer-drag-dim", active);
      if (pillWrapper) pillWrapper.classList.toggle("sednar-composer-drag-dim", active);
      if (active && e) {
        showGhostForEvent(e);
        window._sednarSaveDropCaret(e);
      } else {
        hideGhost();
      }
    };

    dropTarget.addEventListener("dragenter", function(e) {
      if (!isAcceptedDrag(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth++;
      setDragState(true, e);
    });
    dropTarget.addEventListener("dragover", function(e) {
      if (!isAcceptedDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragState(true, e);
    });
    dropTarget.addEventListener("dragleave", function() {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragState(false);
    });
    dropTarget.addEventListener("drop", function(e) {
      e.preventDefault();
      dragDepth = 0;
      setDragState(false);
      window._sednarSaveDropCaret(e);
      var payload = parseRepoDragPayload(e.dataTransfer);
      if (payload && typeof window.addSednarRepoContextToChat === "function") {
        window._sednarRepoDragPayload = null;
        window.addSednarRepoContextToChat({
          repoPath: payload.repoPath,
          kind: payload.kind,
          name: payload.name
        });
        return;
      }
      if (!e.dataTransfer) return;
      window.sednarCollectFilesFromDataTransfer(e.dataTransfer, {
        maxFiles: SEDNAR_MAX_ATTACHMENTS
      }).then(function(files) {
        if (!files || !files.length) {
          alert(
            "No files found to attach. Drop files, or a folder that contains files " +
            "(project folders from the Sednar explorer add context chips instead)."
          );
          return;
        }
        window.queueSednarAttachmentFiles(files);
      });
    });
  }

  function init() {
    bindFileInput();
    bindDragDrop();
    window.initSednarComposerInput();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  setTimeout(init, 300);
})();


window._sednarSaveDropCaret = function(e) {
  var input = window._sednarGetComposerInput();
  if (!input || !e) return;
  var range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } else if (e.clientX != null && document.caretPositionFromPoint) {
    var pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (range && input.contains(range.startContainer)) {
    window._sednarInsertRange = range.cloneRange();
  }
};


window.buildSednarDragGhostPillHtml = function(fileName) {
  var name = String(fileName || "file");
  var isJson = /\.json$/i.test(name);
  var iconSrc = typeof window.getFileIcon === "function"
    ? window.getFileIcon(name)
    : "/asset/file-icons/file.png";
  return '<div class="sednar-drag-ghost-pill-inner sednar-inline-file-chip' + (isJson ? " sednar-json-pill" : "") + '">' +
    '<img src="' + iconSrc + '" class="sednar-inline-file-icon" alt="" aria-hidden="true">' +
    '<span class="sednar-inline-file-name">' + (window.shortenStartExtFilename ? window.shortenStartExtFilename(name, 28) : name) + "</span>" +
    "</div>";
};
