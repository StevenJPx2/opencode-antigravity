"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const afterEach = require("node:test").afterEach;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const common = require("../lib/common");
const setup = require("../bin/setup");

const SETUP = path.join(__dirname, "..", "bin", "setup.js");
const FIXTURES = path.join(__dirname, "..", "fixtures");
const dirs = [];

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-antigravity-test-"));
  dirs.push(dir);
  return dir;
}

function copyFixture(name, dir) {
  const source = path.join(FIXTURES, name, "opencode.jsonc");
  const target = path.join(dir, "opencode.jsonc");
  fs.copyFileSync(source, target);
  return target;
}

function run(...args) {
  return spawnSync(process.execPath, [SETUP, ...args], { encoding: "utf8" });
}

// A verified marker short-circuits download and extraction in installPlugin.
// Tests build one in a throwaway directory so the suite needs no network and
// never touches real credentials or real install paths.
function makeInstallDir() {
  const dir = makeDir();
  const installDir = path.join(dir, "opt", "oc-antigravity");
  const pluginDir = common.pluginPathFor(installDir);

  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "package.json"),
    JSON.stringify({ name: common.PLUGIN_ID, version: common.PACKAGE_VERSION }) + "\n"
  );
  fs.writeFileSync(
    path.join(installDir, setup.INSTALL_MARKER),
    JSON.stringify({
      version: common.PINNED_VERSION,
      sha512: common.BUNDLE_SHA512,
      installedAt: "2026-11-20T00:00:00.000Z",
    }) + "\n"
  );

  return installDir;
}

function fakeGet(body, opts = {}) {
  return (url, cb) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => request;

    process.nextTick(() => {
      const res = Readable.from([Buffer.from(body)]);
      res.statusCode = opts.status || 200;
      res.headers = opts.location ? { location: opts.location } : {};
      cb(res);
    });

    return request;
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--help exits successfully and lists the new flags", () => {
  const result = run("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--config-dir/);
  assert.match(result.stdout, /--install-dir/);
  assert.match(result.stdout, /--force/);
});

test("unknown flags are a usage error", () => {
  const result = run("--bogus");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /error:/);
  assert.match(result.stderr, /Unknown flag/);
});

test("a missing config file is reported before any install", () => {
  const dir = makeDir();
  const result = run("--config-dir", dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No opencode\.jsonc or opencode\.json found/);
});

test("--dry-run prints the pinned path but writes nothing and never installs", () => {
  const dir = makeDir();
  const file = copyFixture("basic", dir);
  const before = fs.readFileSync(file);
  const installDir = path.join(dir, "not-created");
  const entry = common.pluginEntryFor({ installDir });

  const result = run("--config-dir", dir, "--install-dir", installDir, "--dry-run");

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(entry));
  assert.ok(result.stdout.includes("would install/verify " + common.pluginPathFor(installDir)));
  assert.match(result.stderr, /dry-run: no files written/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(file + ".bak"), false);
  assert.equal(fs.existsSync(installDir), false);
});

test("setup verifies a prepared install, updates the config and writes a backup", () => {
  const dir = makeDir();
  const file = copyFixture("basic", dir);
  const before = fs.readFileSync(file);
  const installDir = makeInstallDir();
  const entry = common.pluginEntryFor({ installDir });

  const result = run("--config-dir", dir, "--install-dir", installDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified install already present/);
  assert.match(result.stdout, /Updated /);
  assert.match(result.stdout, /backup/);
  assert.deepEqual(fs.readFileSync(file + ".bak"), before);
  assert.ok(fs.readFileSync(file, "utf8").includes(entry));
});

test("a second run reports no changes and leaves the backup alone", () => {
  const dir = makeDir();
  const file = copyFixture("basic", dir);
  const installDir = makeInstallDir();
  const entry = common.pluginEntryFor({ installDir });

  assert.equal(run("--config-dir", dir, "--install-dir", installDir).status, 0);
  const backupBefore = fs.readFileSync(file + ".bak");
  const configBefore = fs.readFileSync(file);

  const result = run("--config-dir", dir, "--install-dir", installDir);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("No changes: " + entry + " is already pinned in plugins."));
  assert.deepEqual(fs.readFileSync(file + ".bak"), backupBefore);
  assert.deepEqual(fs.readFileSync(file), configBefore);
});

test("a conflicting npm-style entry fails without writing anything", () => {
  const dir = makeDir();
  const file = copyFixture("conflict", dir);
  const before = fs.readFileSync(file);
  const installDir = makeInstallDir();
  const entry = common.pluginEntryFor({ installDir });

  const result = run("--config-dir", dir, "--install-dir", installDir);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /error:/);
  assert.match(result.stderr, /opencode-antigravity-auth@2\.1\.2/);
  assert.ok(result.stderr.includes(entry));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(file + ".bak"), false);
});

test("--write-plugin-config creates the file once and never overwrites it", () => {
  const dir = makeDir();
  copyFixture("basic", dir);
  const installDir = makeInstallDir();
  const pluginConfig = path.join(dir, common.PLUGIN_CONFIG_FILE);

  const first = run("--config-dir", dir, "--install-dir", installDir, "--write-plugin-config");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(fs.existsSync(pluginConfig), true);

  const content = fs.readFileSync(pluginConfig, "utf8");
  const parsed = JSON.parse(content);
  assert.equal(parsed.$schema, common.SCHEMA_URL);
  assert.equal(parsed.auto_update, false);
  assert.equal(parsed.keep_thinking, false);
  assert.equal(parsed.session_recovery, true);
  assert.ok(content.endsWith("\n"));

  const second = run("--config-dir", dir, "--install-dir", installDir, "--write-plugin-config");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /left existing/);
  assert.deepEqual(fs.readFileSync(pluginConfig, "utf8"), content);
});

test("--write-plugin-config with --dry-run reports but does not create", () => {
  const dir = makeDir();
  copyFixture("basic", dir);
  const installDir = path.join(dir, "not-created");
  const pluginConfig = path.join(dir, common.PLUGIN_CONFIG_FILE);

  const result = run(
    "--config-dir", dir, "--install-dir", installDir, "--write-plugin-config", "--dry-run"
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would create/);
  assert.equal(fs.existsSync(pluginConfig), false);
  assert.equal(fs.existsSync(installDir), false);
});

test("--force is parsed as an explicit re-download request", () => {
  const opts = setup.parseArgs(["--force", "--install-dir", "/some/place"]);
  assert.equal(opts.force, true);
  assert.equal(opts.installDir, "/some/place");
});

test("a valid marker skips download and extraction entirely", async () => {
  const dir = makeDir();
  const installDir = path.join(dir, "opt", "oc-antigravity");
  fs.mkdirSync(common.pluginPathFor(installDir), { recursive: true });
  fs.writeFileSync(
    path.join(installDir, setup.INSTALL_MARKER),
    JSON.stringify({ version: common.PINNED_VERSION, sha512: common.BUNDLE_SHA512 })
  );

  const result = await setup.installPlugin(
    { installDir },
    { get: () => { throw new Error("network must not be used"); } }
  );

  assert.equal(result.installed, false);
});

test("a checksum mismatch deletes the temp file and never extracts", async () => {
  const dir = makeDir();
  const installDir = path.join(dir, "opt", "oc-antigravity");
  let tarCalled = false;

  await assert.rejects(
    () =>
      setup.installPlugin(
        { installDir },
        {
          get: fakeGet("not-a-real-bundle"),
          spawnSync: () => {
            tarCalled = true;
            return { status: 0 };
          },
        }
      ),
    /SHA-512 mismatch/
  );

  assert.equal(tarCalled, false);
  assert.equal(fs.existsSync(path.join(installDir, setup.INSTALL_MARKER)), false);
  const leftovers = fs.readdirSync(installDir).filter((name) => name.includes(".tar.gz"));
  assert.deepEqual(leftovers, []);
});
