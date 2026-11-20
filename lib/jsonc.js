"use strict";

const { PLUGIN_ID, pluginEntryFor, isPluginEntry } = require("./common");

/**
 * Raised when an existing config cannot be updated automatically because a
 * human decision is required (wrong type, a different or duplicate plugin
 * entry). `code` is always "CONFLICT".
 */
class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.code = "CONFLICT";
  }
}

/**
 * Replace comment characters with spaces (keeping newlines so line numbers
 * stay correct) while leaving quoted strings untouched. Returns the sanitized
 * text plus a per-character state map: "code", "string", or "comment".
 */
function scanMask(text) {
  const n = text.length;
  const out = new Array(n);
  const states = new Array(n);
  let i = 0;
  let state = "code";

  while (i < n) {
    const c = text[i];

    if (state === "code") {
      if (c === '"') {
        state = "string";
        out[i] = c;
        states[i] = "string";
        i++;
      } else if (c === "/" && text[i + 1] === "/") {
        state = "line";
        out[i] = " ";
        states[i] = "comment";
        i++;
        out[i] = " ";
        states[i] = "comment";
        i++;
      } else if (c === "/" && text[i + 1] === "*") {
        state = "block";
        out[i] = " ";
        states[i] = "comment";
        i++;
        out[i] = " ";
        states[i] = "comment";
        i++;
      } else {
        out[i] = c;
        states[i] = "code";
        i++;
      }
      continue;
    }

    if (state === "string") {
      out[i] = c;
      states[i] = "string";

      if (c === "\\" && i + 1 < n) {
        i++;
        out[i] = text[i];
        states[i] = "string";
      } else if (c === '"') {
        state = "code";
      }
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n" || c === "\r") {
        out[i] = c;
        state = "code";
      } else {
        out[i] = " ";
      }
      states[i] = "comment";
      i++;
      continue;
    }

    // state === "block"
    if (c === "*" && text[i + 1] === "/") {
      out[i] = " ";
      states[i] = "comment";
      i++;
      out[i] = " ";
      states[i] = "comment";
      i++;
      state = "code";
      continue;
    }

    out[i] = c === "\n" || c === "\r" ? c : " ";
    states[i] = "comment";
    i++;
  }

  return { out: out.join(""), states };
}

/**
 * Remove commas that are followed (ignoring whitespace) by a closing brace or
 * bracket. Only code commas are considered, never commas inside strings.
 */
function stripTrailingCommas(text, states) {
  const chars = text.split("");
  const n = text.length;

  for (let i = 0; i < n; i++) {
    if (chars[i] !== "," || states[i] !== "code") {
      continue;
    }

    let j = i + 1;
    while (j < n && /\s/.test(text[j])) {
      j++;
    }

    if (j < n && (text[j] === "}" || text[j] === "]")) {
      chars[i] = " ";
    }
  }

  return chars.join("");
}

/**
 * Convert JSONC into strict JSON: comments become whitespace and trailing
 * commas are removed. The result is suitable for JSON.parse.
 */
function toJson(text) {
  const { out, states } = scanMask(text);
  return stripTrailingCommas(out, states);
}

/**
 * Parse JSONC (line comments, block comments, trailing commas). Malformed input
 * throws an Error whose message includes the 1-based line number.
 */
function parseJsonc(text) {
  const json = toJson(text);

  try {
    return JSON.parse(json);
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const positionMatch = message.match(/position (\d+)/);
    let line = 1;

    if (positionMatch) {
      line = json.slice(0, Number(positionMatch[1])).split("\n").length;
    } else {
      const lineMatch = message.match(/line (\d+)/);
      if (lineMatch) {
        line = Number(lineMatch[1]);
      }
    }

    throw new Error(message + " (line " + line + ")");
  }
}

const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * Lex the document into structural tokens, skipping comments. Each token has
 * `type`, `start`, `end`, `depth` (number of open braces/brackets at that
 * point) and, for strings/literals, a decoded `value`. Closing tokens record
 * the depth after they close; opening tokens record the depth before they open.
 */
function tokenize(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let depth = 0;

  while (i < n) {
    const c = text[i];

    if (c === '"') {
      const start = i;
      let value = "";
      i++;

      while (i < n) {
        const ch = text[i];
        if (ch === "\\") {
          const next = text[i + 1];
          if (next === "u" && i + 5 < n) {
            value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
            i += 6;
          } else if (Object.prototype.hasOwnProperty.call(ESCAPES, next)) {
            value += ESCAPES[next];
            i += 2;
          } else {
            value += next;
            i += 2;
          }
        } else if (ch === '"') {
          i++;
          break;
        } else {
          value += ch;
          i++;
        }
      }

      tokens.push({ type: "string", start, end: i, value, depth });
      continue;
    }

    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < n && text[i] !== "\n" && text[i] !== "\r") {
        i++;
      }
      continue;
    }

    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }

    if (c === "{" || c === "[") {
      const type = c === "{" ? "lbrace" : "lbracket";
      tokens.push({ type, start: i, end: i + 1, depth });
      depth++;
      i++;
      continue;
    }

    if (c === "}" || c === "]") {
      depth--;
      const type = c === "}" ? "rbrace" : "rbracket";
      tokens.push({ type, start: i, end: i + 1, depth });
      i++;
      continue;
    }

    if (c === ":") {
      tokens.push({ type: "colon", start: i, end: i + 1, depth });
      i++;
      continue;
    }

    if (c === ",") {
      tokens.push({ type: "comma", start: i, end: i + 1, depth });
      i++;
      continue;
    }

    if (/[0-9A-Za-z\-]/.test(c)) {
      const start = i;
      while (i < n && !/[\s,{}\[\]:"]/.test(text[i]) && !(text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*"))) {
        i++;
      }
      tokens.push({ type: "literal", start, end: i, value: text.slice(start, i), depth });
      continue;
    }

    i++;
  }

  return tokens;
}

/**
 * Find the TOP-LEVEL "plugins" member: a string token with value "plugins" at
 * depth 1 followed by a colon. Strings, comments and nested objects cannot
 * produce a false match. Returns { tokens, keyIndex, valueToken } with
 * keyIndex === -1 when no such member exists.
 */
function scanTopLevel(text) {
  const tokens = tokenize(text);

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    if (token.type === "string" && token.value === "plugins" && token.depth === 1) {
      const colon = tokens[idx + 1];
      if (colon && colon.type === "colon") {
        return { tokens, keyIndex: idx, valueToken: tokens[idx + 2] || null };
      }
    }
  }

  return { tokens, keyIndex: -1, valueToken: null };
}

/** Return the closing bracket token matching the given opening bracket token. */
function findMatchingClose(tokens, openToken) {
  const openIdx = tokens.indexOf(openToken);
  for (let i = openIdx + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "rbracket" && token.depth === openToken.depth) {
      return token;
    }
  }
  return null;
}

/** Info about the whitespace at the start of the line containing `pos`. */
function lineIndentAt(text, pos) {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  return { lineStart, indent: text.slice(lineStart, pos) };
}

/**
 * Split the contents of the plugins array into groups of tokens, one group per
 * element, on top-level commas. Also reports whether a trailing comma is
 * present (the last group is empty).
 */
function arrayElements(text, tokens, valueToken, closeToken) {
  const openIdx = tokens.indexOf(valueToken);
  const closeIdx = tokens.indexOf(closeToken);
  const elemDepth = valueToken.depth + 1;
  const groups = [[]];

  for (const token of tokens.slice(openIdx + 1, closeIdx)) {
    if (token.type === "comma" && token.depth === elemDepth) {
      groups.push([]);
    } else {
      groups[groups.length - 1].push(token);
    }
  }

  return {
    groups,
    elemDepth,
    hasTrailingComma: groups.length > 1 && groups[groups.length - 1].length === 0,
  };
}

/**
 * Describe one element group. Returns { value, related } where related says
 * whether the entry refers to this plugin (path or npm-style specifier).
 */
function describeElement(group, elemDepth) {
  if (group.length === 0) {
    return null;
  }

  const first = group[0];
  let value = null;

  if (first.type === "string" && first.depth === elemDepth) {
    value = first.value;
  } else if (first.type === "lbrace" && first.depth === elemDepth) {
    for (let i = 0; i + 2 < group.length; i++) {
      const token = group[i];
      const colon = group[i + 1];
      const val = group[i + 2];
      if (token.type === "string" && token.value === "package" && token.depth === elemDepth + 1 && colon.type === "colon" && val.type === "string") {
        value = val.value;
        break;
      }
    }
  } else {
    return { value: first.value, related: isPluginEntry(first.value) };
  }

  return { value, related: isPluginEntry(value) };
}

/** Count pinned entries, accepting both the string and { package } forms. */
function countPinned(plugins, pluginEntry) {
  let count = 0;
  for (const entry of plugins) {
    if (entry === pluginEntry) {
      count++;
    } else if (entry && typeof entry === "object" && entry.package === pluginEntry) {
      count++;
    }
  }
  return count;
}

/** Validate built output and assemble the merge result object. */
function finish(original, output, action, detail, pluginEntry) {
  let parsed;
  try {
    parsed = JSON.parse(toJson(output));
  } catch (err) {
    throw new Error("Generated config is not valid JSON: " + err.message);
  }

  const plugins = parsed && parsed.plugins;
  if (!Array.isArray(plugins) || countPinned(plugins, pluginEntry) !== 1) {
    throw new Error("Generated config does not contain exactly one " + pluginEntry + " entry in the top-level plugins array.");
  }

  return { changed: output !== original, output, action, detail };
}

/** Insert the pinned entry into a plugins array that has no plugin entry yet. */
function insertIntoArray(text, tokens, valueToken, closeToken, pluginEntry, groupsInfo) {
  const innerStart = valueToken.end;
  const innerEnd = closeToken.start;
  const innerText = text.slice(innerStart, innerEnd);
  const meaningful = groupsInfo.groups.filter((group) => group.length > 0);

  if (meaningful.length === 0) {
    return text.slice(0, innerStart) + JSON.stringify(pluginEntry) + text.slice(innerEnd);
  }

  const lastEnd = meaningful[meaningful.length - 1].slice(-1)[0].end;
  const firstStart = meaningful[0][0].start;
  const firstIndent = lineIndentAt(text, firstStart);
  const elemIndent = /^\s*$/.test(firstIndent.indent) ? firstIndent.indent : "  ";
  const closeIndent = lineIndentAt(text, closeToken.start);
  const multiline = innerText.includes("\n") && /^\s*$/.test(closeIndent.indent);

  if (multiline) {
    let insertPos;
    let insertion;

    if (groupsInfo.hasTrailingComma) {
      const comma = tokens.find((token) => token.type === "comma" && token.depth === groupsInfo.elemDepth && token.start >= lastEnd && token.start < closeToken.start);
      insertPos = comma.end;
      insertion = "\n" + elemIndent + JSON.stringify(pluginEntry) + ",";
    } else {
      insertPos = lastEnd;
      insertion = ",\n" + elemIndent + JSON.stringify(pluginEntry);
    }

    return text.slice(0, insertPos) + insertion + text.slice(insertPos);
  }

  let contentEnd = innerEnd;
  while (contentEnd > innerStart && /\s/.test(text[contentEnd - 1])) {
    contentEnd--;
  }

  const separator = groupsInfo.hasTrailingComma ? " " : ", ";
  return text.slice(0, contentEnd) + separator + JSON.stringify(pluginEntry) + text.slice(contentEnd);
}

/** Add a top-level "plugins" member to the root object, preserving its content. */
function addPluginsMember(text, tokens, pluginEntry) {
  const rootOpen = tokens.find((token) => token.type === "lbrace" && token.depth === 0);
  if (!rootOpen) {
    throw new Error("Could not find the top-level object in the config file.");
  }

  const rootClose = tokens.find((token) => token.type === "rbrace" && token.depth === 0 && token.start > rootOpen.start);
  if (!rootClose) {
    throw new Error("Could not find the closing brace of the top-level object.");
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const inner = text.slice(rootOpen.end, rootClose.start);
  const firstMember = tokens.find((token) => token.start >= rootOpen.end && token.start < rootClose.start && token.depth === 1);
  let indent = "  ";

  if (firstMember) {
    const firstIndent = lineIndentAt(text, firstMember.start);
    if (/^\s*$/.test(firstIndent.indent) && firstIndent.lineStart >= rootOpen.end) {
      indent = firstIndent.indent;
    }
  }

  const member = indent + '"plugins": [' + JSON.stringify(pluginEntry) + "]";

  if (inner.trim() === "") {
    return text.slice(0, rootOpen.end) + eol + member + eol + text.slice(rootOpen.end);
  }

  return text.slice(0, rootOpen.end) + eol + member + "," + text.slice(rootOpen.end);
}

/**
 * Ensure the config's top-level plugins array pins the absolute plugin path.
 *
 * Returns { changed, output, action, detail }. ConflictError is thrown for a
 * non-array plugins value, any other related entry (npm specifier, different
 * path, or bare id), or duplicate entries. The input string is never mutated.
 *
 * @param {string} text JSONC source.
 * @param {{ pluginEntry?: string, pluginId?: string }} options
 */
function mergePluginEntry(text, { pluginEntry = pluginEntryFor(), pluginId = PLUGIN_ID } = {}) {
  const { tokens, keyIndex, valueToken } = scanTopLevel(text);

  if (keyIndex === -1) {
    const output = addPluginsMember(text, tokens, pluginEntry);
    return finish(text, output, "created-plugins", "Added top-level plugins with " + pluginEntry + ".", pluginEntry);
  }

  if (!valueToken || valueToken.type !== "lbracket") {
    throw new ConflictError('The top-level "plugins" member must be an array of plugin entries. Change it to an array before running setup.');
  }

  const closeToken = findMatchingClose(tokens, valueToken);
  if (!closeToken) {
    throw new Error("Could not find the end of the top-level plugins array.");
  }

  const groupsInfo = arrayElements(text, tokens, valueToken, closeToken);
  const related = [];
  for (const group of groupsInfo.groups) {
    const element = describeElement(group, groupsInfo.elemDepth);
    if (element && element.related) {
      related.push(element);
    }
  }

  if (related.length > 1) {
    const found = related.map((entry) => entry.value).join(", ");
    throw new ConflictError('Duplicate plugin entries for "' + pluginId + '" found in the top-level plugins array (' + found + '). Keep exactly one entry: ' + pluginEntry + '.');
  }

  if (related.length === 1) {
    const found = related[0];
    if (found.value === pluginEntry) {
      return finish(text, text, "already-present", "Already pinned: " + pluginEntry + ".", pluginEntry);
    }
    throw new ConflictError('The plugins array already contains "' + found.value + '" but this setup pins the plugin at ' + pluginEntry + '. Remove or update that entry before running setup.');
  }

  const output = insertIntoArray(text, tokens, valueToken, closeToken, pluginEntry, groupsInfo);
  return finish(text, output, "added", "Added " + pluginEntry + " to the top-level plugins array.", pluginEntry);
}

module.exports = {
  ConflictError,
  parseJsonc,
  toJson,
  mergePluginEntry,
  scanTopLevel,
  arrayElements,
  tokenize,
};
