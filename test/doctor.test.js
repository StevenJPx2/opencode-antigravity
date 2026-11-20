"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { runDoctor } = require("../bin/doctor");
const {
  ACCOUNTS_FILE,
  PINNED_VERSION,
  BUNDLE_SHA512,
  pluginPathFor,
  pluginEntryFor,
} = require("../lib/common");

const OK_VERSION = "opencode v2.3.2";
const OK_PLUGINS = "opencode-antigravity-auth@2.1.2";
const OK_MODELS =
  "google/antigravity-gemini-3.8-flash-high\n" +
  "google/antigravity-claude-opus-4-6-thinking";
const APPEAL_URL = "https://forms.gle/hGzM9MEUv2azZsrb9";
const FORUM_URL =
  "https://discuss.ai.google.dev/t/account-disabled-for-tos-violation-in-google-antigravity-where-to-submit-an-appeal/200686";
const MARKER = ".oc-antigravity-install.json";

function makeTmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));

  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  return dir;
}

function writeFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

function healthyConfig(plugins) {
  return JSON.stringify({ plugins });
}

function validMarker() {
  return { version: PINNED_VERSION, sha512: BUNDLE_SHA512 };
}

function setupInstall(t, options = {}) {
  const installDir = makeTmpDir(t);
  const pluginPath = pluginPathFor(installDir);

  if (options.withPlugin !== false) {
    fs.mkdirSync(pluginPath, { recursive: true });
    fs.writeFileSync(
      path.join(pluginPath, "package.json"),
      JSON.stringify({ name: "opencode-antigravity-auth", version: "2.1.2" })
    );
  }

  if (options.marker) {
    writeFile(installDir, MARKER, JSON.stringify(options.marker));
  }

  return { installDir, pluginPath };
}

function setupConfig(t, installDir, plugins) {
  const configDir = makeTmpDir(t);
  const entry = pluginEntryFor({ installDir });
  const entries = plugins === undefined ? [entry] : plugins;

  writeFile(configDir, "opencode.jsonc", healthyConfig(entries));

  return configDir;
}

function optsFor(configDir, installDir) {
  return { configDir, installDir, nodeVersion: "v26.13.1" };
}

function makeRunner(overrides = {}) {
  const { version = OK_VERSION, plugins = OK_PLUGINS, models = OK_MODELS } = overrides;

  return async function runner(cmd, args) {
    let stdout = "";

    if (args[0] === "--version") {
      stdout = version;
    } else if (args[0] === "plugin") {
      stdout = plugins;
    } else if (args[0] === "models") {
      stdout = models;
    }

    return { exitCode: 0, stdout, stderr: "" };
  };
}

function checkNamed(result, name) {
  const check = result.checks.find((entry) => entry.name === name);

  assert.ok(check, `missing check: ${name}`);

  return check;
}

test("healthy setup passes and never exposes the accounts file", async (t) => {
  const { installDir } = setupInstall(t, { marker: validMarker() });
  const configDir = setupConfig(t, installDir);
  const secret = "TOP-SECRET-DO-NOT-PRINT-9f3a";

  writeFile(configDir, ACCOUNTS_FILE, secret);

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });

  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(
    result.checks.map((check) => check.name),
    [
      "node-version",
      "opencode-version",
      "config-file",
      "plugin-entry",
      "plugin-path",
      "accounts-file",
      "models-discovery",
      "plugin-build",
      "plugin-resolvable",
    ]
  );

  const accounts = checkNamed(result, "accounts-file");

  assert.equal(accounts.ok, true);
  assert.ok(accounts.detail.includes(ACCOUNTS_FILE));
  assert.ok(accounts.detail.includes(configDir));
  assert.equal(checkNamed(result, "plugin-build").ok, true);
});

test("a missing build marker is not a failure", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const build = checkNamed(result, "plugin-build");

  assert.equal(result.ok, true);
  assert.equal(build.ok, true);
  assert.equal(build.detail, "marker absent (manual verified install)");
  assert.equal(build.hint, "");
});

test("a present marker with a mismatched version fails", async (t) => {
  const { installDir } = setupInstall(t, { marker: { version: "0.0.1", sha512: BUNDLE_SHA512 } });
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const build = checkNamed(result, "plugin-build");

  assert.equal(result.ok, false);
  assert.equal(build.ok, false);
  assert.match(build.hint, /setup/i);
});

test("a present marker with a mismatched sha512 fails", async (t) => {
  const { installDir } = setupInstall(t, { marker: { version: PINNED_VERSION, sha512: "wrong-hash" } });
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });

  assert.equal(checkNamed(result, "plugin-build").ok, false);
});

test("missing plugin entry fails with a setup hint", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir, []);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const entry = checkNamed(result, "plugin-entry");

  assert.equal(result.ok, false);
  assert.equal(entry.ok, false);
  assert.match(entry.hint, /setup/i);
});

test("duplicate plugin entries fail with a duplicate detail", async (t) => {
  const { installDir } = setupInstall(t);
  const entry = pluginEntryFor({ installDir });
  const configDir = setupConfig(t, installDir, [entry, entry]);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const pluginEntry = checkNamed(result, "plugin-entry");

  assert.equal(pluginEntry.ok, false);
  assert.match(pluginEntry.detail, /duplicate/i);
});

test("an npm-style plugin entry fails with safe detail", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir, ["opencode-antigravity-auth@2.1.2"]);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const pluginEntry = checkNamed(result, "plugin-entry");

  assert.equal(result.ok, false);
  assert.equal(pluginEntry.ok, false);
  assert.equal(JSON.stringify(result).includes("opencode-antigravity-auth@2.1.2"), false);
});

test("missing plugin directory or package.json fails with the path as detail", async (t) => {
  const { installDir, pluginPath } = setupInstall(t, { withPlugin: false });
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const pluginPathCheck = checkNamed(result, "plugin-path");

  assert.equal(result.ok, false);
  assert.equal(pluginPathCheck.ok, false);
  assert.equal(pluginPathCheck.detail, pluginPath);
});

test("missing accounts file fails with a re-login hint", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  const result = await runDoctor(optsFor(configDir, installDir), { runner: makeRunner() });
  const accounts = checkNamed(result, "accounts-file");

  assert.equal(result.ok, false);
  assert.equal(accounts.ok, false);
  assert.match(accounts.hint, /auth login google/i);
});

test("old opencode version fails the version check", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), {
    runner: makeRunner({ version: "opencode v1.18.31" }),
  });

  assert.equal(checkNamed(result, "opencode-version").ok, false);
});

test("models output without antigravity-* fails discovery", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), {
    runner: makeRunner({ models: "google/gemini-2.5-pro\nopenai/gpt-5" }),
  });

  assert.equal(checkNamed(result, "models-discovery").ok, false);
});

test("TOS_VIOLATION reports a label and appeal link, never the raw text", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), {
    runner: makeRunner({
      models: OK_MODELS + "\n403 TOS_VIOLATION for user@example.com token=abc123",
    }),
  });

  assert.equal(result.signatures[0].name, "tos-violation");
  assert.equal(result.signatures[0].url, APPEAL_URL);
  assert.match(result.signatures[0].hint, /forms\.gle/);
  assert.match(result.signatures[0].hint, /discuss\.ai\.google\.dev/);

  const serialized = JSON.stringify(result);

  for (const secret of ["TOS_VIOLATION", "user@example.com", "abc123"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("quota, session_move and invalid_grant produce safe signatures", async (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const result = await runDoctor(optsFor(configDir, installDir), {
    runner: makeRunner({
      models:
        OK_MODELS +
        "\n429 RESOURCE_EXHAUSTED quota" +
        "\nsession_move rejected" +
        "\ninvalid_grant for user@example.com",
    }),
  });

  assert.deepEqual(
    result.signatures.map((signature) => signature.name),
    ["quota-429", "session-move", "invalid-grant"]
  );

  const sessionMove = result.signatures.find((signature) => signature.name === "session-move");

  assert.match(sessionMove.hint, /PR #624/);

  const serialized = JSON.stringify(result);

  for (const secret of ["RESOURCE_EXHAUSTED", "session_move", "invalid_grant", "user@example.com"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

function stubOpencode(dir) {
  const stubPath = path.join(dir, "stub-opencode");

  fs.writeFileSync(
    stubPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo "opencode v2.3.2"; fi',
      'if [ "$1" = "plugin" ]; then echo "opencode-antigravity-auth@2.1.2"; fi',
      'if [ "$1" = "models" ]; then echo "google/antigravity-gemini-3.8-flash-high"; fi',
      "",
    ].join("\n")
  );
  fs.chmodSync(stubPath, 0o755);

  return stubPath;
}

test("CLI prints JSON and exits 0 through a stub opencode binary", (t) => {
  const { installDir } = setupInstall(t);
  const configDir = setupConfig(t, installDir);

  writeFile(configDir, ACCOUNTS_FILE, "{}");

  const doctorPath = path.join(__dirname, "..", "bin", "doctor.js");
  const res = spawnSync(
    process.execPath,
    [
      doctorPath,
      "--config-dir",
      configDir,
      "--install-dir",
      installDir,
      "--opencode-bin",
      stubOpencode(installDir),
      "--json",
    ],
    { encoding: "utf8" }
  );

  assert.equal(res.status, 0, res.stderr);

  const parsed = JSON.parse(res.stdout);

  assert.equal(parsed.ok, true);
});

test("CLI --help lists the supported flags", (t) => {
  const doctorPath = path.join(__dirname, "..", "bin", "doctor.js");
  const res = spawnSync(process.execPath, [doctorPath, "--help"], { encoding: "utf8" });

  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /--install-dir/);
  assert.match(res.stdout, /--config-dir/);
  assert.match(res.stdout, /--opencode-bin/);
  assert.match(res.stdout, /--json/);
});
