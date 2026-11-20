"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jsonc = require("../lib/jsonc");
const common = require("../lib/common");

const FIXTURES = path.join(__dirname, "..", "fixtures");
const FIXTURE_NAMES = ["basic", "with-plugin", "conflict", "comments", "no-plugins"];
const TEST_INSTALL_DIR = "/tmp/oc-antigravity-test";
const TEST_PLUGIN_ENTRY = common.pluginEntryFor({ installDir: TEST_INSTALL_DIR });

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name, "opencode.jsonc"), "utf8");
}

function pluginsOf(text) {
  return JSON.parse(jsonc.toJson(text)).plugins;
}

function commentsOf(text) {
  return text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) || [];
}

function merge(text) {
  return jsonc.mergePluginEntry(text, { pluginEntry: TEST_PLUGIN_ENTRY });
}

test("parseJsonc parses every fixture", () => {
  for (const name of FIXTURE_NAMES) {
    const value = jsonc.parseJsonc(fixture(name));
    assert.equal(typeof value, "object");
    assert.ok(!Array.isArray(value));
  }
});

test("toJson produces strict JSON for every fixture", () => {
  for (const name of FIXTURE_NAMES) {
    assert.doesNotThrow(() => JSON.parse(jsonc.toJson(fixture(name))), name);
  }
});

test("parseJsonc reports a line number on malformed input", () => {
  assert.throws(
    () => jsonc.parseJsonc('{\n  "a": 1,\n  "b":,\n}'),
    (err) => err instanceof Error && /line \d+/.test(err.message),
  );
});

test("mergePluginEntry adds the pinned absolute path to a basic config", () => {
  const input = fixture("basic");
  const result = merge(input);

  assert.equal(result.changed, true);
  assert.equal(result.action, "added");
  assert.notEqual(result.output, input);

  for (const comment of commentsOf(input)) {
    assert.ok(result.output.includes(comment), "preserved comment: " + comment);
  }

  assert.ok(result.output.includes('"sourcefed"'));
  assert.ok(result.output.includes('"mcp"'));
  assert.ok(result.output.includes('"$schema"'));

  const plugins = pluginsOf(result.output);
  assert.ok(Array.isArray(plugins));
  assert.equal(plugins.filter((entry) => entry === TEST_PLUGIN_ENTRY).length, 1);
});

test("mergePluginEntry is a no-op for a config already pinned by path", () => {
  const input = fixture("with-plugin");
  const result = merge(input);

  assert.equal(result.changed, false);
  assert.equal(result.action, "already-present");
  assert.equal(result.output, input);
});

test("mergePluginEntry accepts the object package form of the pinned path", () => {
  const input =
    '{"plugins": [' + JSON.stringify({ package: TEST_PLUGIN_ENTRY }) + "]}";
  const result = merge(input);

  assert.equal(result.changed, false);
  assert.equal(result.action, "already-present");
  assert.equal(result.output, input);
});

test("mergePluginEntry rejects the conflicting npm-style entry by name", () => {
  assert.throws(
    () => merge(fixture("conflict")),
    (err) => {
      assert.ok(err instanceof jsonc.ConflictError);
      assert.equal(err.code, "CONFLICT");
      assert.match(err.message, /opencode-antigravity-auth@2\.1\.2/);
      assert.ok(err.message.includes(TEST_PLUGIN_ENTRY));
      return true;
    },
  );
});

test("mergePluginEntry rejects an npm specifier for another version", () => {
  const input = '{"plugins": ["opencode-antigravity-auth@2.0.0"]}';
  assert.throws(
    () => merge(input),
    (err) => err instanceof jsonc.ConflictError && /2\.0\.0/.test(err.message),
  );
});

test("mergePluginEntry rejects a different absolute path", () => {
  const input = '{"plugins": ["/elsewhere/node_modules/opencode-antigravity-auth"]}';
  assert.throws(
    () => merge(input),
    (err) => err instanceof jsonc.ConflictError && /elsewhere/.test(err.message),
  );
});

test("mergePluginEntry rejects a bare plugin id", () => {
  const input = '{"plugins": ["opencode-antigravity-auth"]}';
  assert.throws(
    () => merge(input),
    (err) => err instanceof jsonc.ConflictError,
  );
});

test("mergePluginEntry throws ConflictError for duplicate path entries", () => {
  const input = [
    "{",
    '  "plugins": [',
    "    " + JSON.stringify(TEST_PLUGIN_ENTRY) + ",",
    "    " + JSON.stringify(TEST_PLUGIN_ENTRY) + ",",
    "  ],",
    "}",
  ].join("\n");

  assert.throws(
    () => merge(input),
    (err) => err instanceof jsonc.ConflictError && err.code === "CONFLICT" && /duplicate/i.test(err.message),
  );
});

test("mergePluginEntry throws ConflictError when plugins is not an array", () => {
  assert.throws(
    () => merge('{"plugins": "opencode-antigravity-auth@2.1.2"}'),
    (err) => err instanceof jsonc.ConflictError && /must be an array/.test(err.message),
  );
});

test("mergePluginEntry preserves heavy comments", () => {
  const input = fixture("comments");
  const result = merge(input);

  assert.equal(result.changed, true);
  for (const comment of commentsOf(input)) {
    assert.ok(result.output.includes(comment), "preserved comment: " + comment);
  }
  assert.equal(pluginsOf(result.output).filter((entry) => entry === TEST_PLUGIN_ENTRY).length, 1);
});

test("mergePluginEntry creates the plugins key when absent", () => {
  const input = fixture("no-plugins");
  const result = merge(input);

  assert.equal(result.changed, true);
  assert.equal(result.action, "created-plugins");

  const parsed = JSON.parse(jsonc.toJson(result.output));
  assert.deepEqual(parsed.plugins, [TEST_PLUGIN_ENTRY]);
  assert.equal(parsed.model, "openai/gpt-5");
  assert.equal(parsed.theme, "system");
  assert.ok(Object.prototype.hasOwnProperty.call(parsed, "mcp"));
  assert.equal(parsed.$schema, "https://opencode.ai/config.json");
});

test("mergePluginEntry is idempotent", () => {
  const first = merge(fixture("basic"));
  const second = merge(first.output);

  assert.equal(second.changed, false);
  assert.equal(second.action, "already-present");
  assert.equal(second.output, first.output);
});

test("mergePluginEntry handles single-line and empty arrays", () => {
  const single = merge('{"plugins": ["a","b"]}');
  assert.deepEqual(pluginsOf(single.output), ["a", "b", TEST_PLUGIN_ENTRY]);

  const empty = merge('{"plugins": []}');
  assert.deepEqual(pluginsOf(empty.output), [TEST_PLUGIN_ENTRY]);
});

test("mergePluginEntry defaults to the resolved install dir path", () => {
  const result = jsonc.mergePluginEntry('{"plugins": []}');
  assert.deepEqual(pluginsOf(result.output), [common.pluginEntryFor()]);
});

test("scanTopLevel ignores nested and string mentions of plugins", () => {
  const nested = merge('{"x": {"plugins": ["fake"]}, "model": "m"}');
  assert.equal(nested.action, "created-plugins");

  const inString = merge('{"description": "use the plugins key", "plugins": []}');
  assert.equal(inString.action, "added");
});

test("isPluginEntry recognises path, npm, and bare-id forms only", () => {
  assert.equal(common.isPluginEntry(TEST_PLUGIN_ENTRY), true);
  assert.equal(common.isPluginEntry("opencode-antigravity-auth@2.1.2"), true);
  assert.equal(common.isPluginEntry("opencode-antigravity-auth"), true);
  assert.equal(common.isPluginEntry("sourcefed"), false);
  assert.equal(common.isPluginEntry(42), false);
});

test("shared version helpers parse and compare versions", () => {
  assert.deepEqual(common.parseVersion("opencode v2.1.2-beta"), [2, 1, 2]);
  assert.equal(common.parseVersion("no version here"), null);
  assert.equal(common.versionGte("2.1.2", common.MIN_OPENCODE), true);
  assert.equal(common.versionGte([2, 0, 0], common.MIN_NODE), false);
  assert.equal(common.versionGte("nope", common.MIN_OPENCODE), false);
});
