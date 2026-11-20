#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  PLUGIN_ID,
  PINNED_VERSION,
  BUNDLE_SHA512,
  MIN_OPENCODE,
  MIN_NODE,
  ACCOUNTS_FILE,
  resolveConfigDir,
  findConfigFile,
  resolveInstallDir,
  pluginPathFor,
  pluginEntryFor,
  isPluginEntry,
  parseVersion,
  versionGte,
} = require("../lib/common");
const { parseJsonc } = require("../lib/jsonc");

const execFileAsync = promisify(execFile);

const APPEAL_URL = "https://forms.gle/hGzM9MEUv2azZsrb9";
const FORUM_URL =
  "https://discuss.ai.google.dev/t/account-disabled-for-tos-violation-in-google-antigravity-where-to-submit-an-appeal/200686";
const QUOTA_URL =
  "https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/docs/TROUBLESHOOTING.md#rate-limits-shadow-bans-and-hanging-prompts";
const FORK_RELEASES_URL = "https://github.com/gulp79/opencode-antigravity-auth/releases";

const SIGNATURES = [
  {
    name: "tos-violation",
    pattern: /TOS_VIOLATION|403|permission denied/i,
    hint:
      "Account-level restriction from an unofficial OAuth client. Appeal once via " +
      APPEAL_URL +
      "; forum context: " +
      FORUM_URL,
    url: APPEAL_URL,
  },
  {
    name: "quota-429",
    pattern: /429|RESOURCE_EXHAUSTED|rate.?limit|quota/i,
    hint: "Quota or rate limit reached; wait for the reset window before retrying",
    url: QUOTA_URL,
  },
  {
    name: "session-move",
    pattern: /session_move/i,
    hint: "carried PR #624 sanitizes this; ensure fork build is active",
    url: FORK_RELEASES_URL,
  },
  {
    name: "invalid-grant",
    pattern: /invalid_grant/i,
    hint: "Refresh token expired; sign in again",
    url: FORK_RELEASES_URL,
  },
];

async function defaultRunner(cmd, args) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });

    return { exitCode: 0, stdout: stdout || "", stderr: stderr || "" };
  } catch (err) {
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

function versionText(parsed) {
  return Array.isArray(parsed) ? parsed.join(".") : "unparseable";
}

function entryValue(entry) {
  if (typeof entry === "string") {
    return entry;
  }

  if (entry && typeof entry === "object" && typeof entry.package === "string") {
    return entry.package;
  }

  return null;
}

function isAntigravityEntry(entry, expected) {
  const value = entryValue(entry);

  if (value === null) {
    return false;
  }

  if (value === expected) {
    return true;
  }

  return typeof isPluginEntry === "function" ? isPluginEntry(value) : value.includes(PLUGIN_ID);
}

function pluginEntryCheck(configPath, fs, expected) {
  const fail = (detail, hint) => ({ name: "plugin-entry", ok: false, detail, hint });

  if (!configPath) {
    return fail("missing", "Run npm run setup");
  }

  try {
    const text = fs.readFileSync(configPath, "utf8");
    const config = parseJsonc(text);
    const plugins = config && Array.isArray(config.plugins) ? config.plugins : [];
    const entries = plugins.filter((entry) => isAntigravityEntry(entry, expected));

    if (entries.length === 0) {
      return fail("missing", "Run npm run setup");
    }

    if (entries.length > 1) {
      return fail(
        `duplicate entries (${entries.length})`,
        "Remove conflicting or duplicate antigravity plugin entries"
      );
    }

    if (entryValue(entries[0]) === expected) {
      return {
        name: "plugin-entry",
        ok: true,
        detail: "pinned absolute plugin path present exactly once",
        hint: "",
      };
    }

    return fail("unexpected plugin entry (npm-style or wrong path)", "Run npm run setup");
  } catch {
    return fail("could not read plugin entry", "Run npm run setup");
  }
}

function pluginPathCheck(installDir, fs) {
  const pluginPath = pluginPathFor(installDir);
  const ok = fs.existsSync(pluginPath) && fs.existsSync(path.join(pluginPath, "package.json"));

  return {
    name: "plugin-path",
    ok,
    detail: pluginPath,
    hint: ok ? "" : "Run npm run setup",
  };
}

function pluginBuildCheck(installDir, fs) {
  const markerPath = path.join(installDir, ".oc-antigravity-install.json");

  if (!fs.existsSync(markerPath)) {
    return {
      name: "plugin-build",
      ok: true,
      detail: "marker absent (manual verified install)",
      hint: "",
    };
  }

  let marker;

  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return { name: "plugin-build", ok: false, detail: "marker unreadable", hint: "Run npm run setup" };
  }

  const version = marker && marker.version;
  const sha512 = marker && marker.sha512;

  if (version === PINNED_VERSION && sha512 === BUNDLE_SHA512) {
    return { name: "plugin-build", ok: true, detail: `pinned build ${PINNED_VERSION}`, hint: "" };
  }

  return {
    name: "plugin-build",
    ok: false,
    detail: "marker does not match the pinned build",
    hint: "Run npm run setup",
  };
}

async function pluginResolvableCheck(runner, opencodeBin, pluginPath, captured) {
  try {
    const res = await runner(opencodeBin, ["plugin", "list"]);

    captured.push(res.stdout || "");

    if (res.exitCode !== 0) {
      return { name: "plugin-resolvable", ok: true, detail: "not available (informational)", hint: "" };
    }

    const stdout = typeof res.stdout === "string" ? res.stdout : "";
    const listed = stdout.includes(PLUGIN_ID) || (Boolean(pluginPath) && stdout.includes(pluginPath));

    return {
      name: "plugin-resolvable",
      ok: true,
      detail: listed ? "plugin listed" : "not listed (plugin-path check is authoritative)",
      hint: "",
    };
  } catch {
    return { name: "plugin-resolvable", ok: true, detail: "not available (informational)", hint: "" };
  }
}

function findSignatures(captured) {
  const found = [];

  for (const signature of SIGNATURES) {
    if (captured.some((text) => signature.pattern.test(text))) {
      found.push({ name: signature.name, hint: signature.hint, url: signature.url });
    }
  }

  return found;
}

async function runDoctor(opts = {}, deps = {}) {
  const runner = deps.runner || defaultRunner;
  const fs = deps.fs || require("fs");

  const configDir = resolveConfigDir(opts);
  const installDir = resolveInstallDir(opts);
  const expectedEntry = pluginEntryFor({ installDir });
  const pluginPath = pluginPathFor(installDir);
  const opencodeBin = opts.opencodeBin || "opencode";
  const captured = [];
  const checks = [];

  const nodeText = opts.nodeVersion || process.version;
  const parsedNode = parseVersion(nodeText);
  const nodeOk = parsedNode !== null && versionGte(parsedNode, MIN_NODE);

  checks.push({
    name: "node-version",
    ok: nodeOk,
    detail: parsedNode
      ? `v${versionText(parsedNode)} (>= ${MIN_NODE} required)`
      : `unparseable Node version (>= ${MIN_NODE} required)`,
    hint: "Upgrade Node.js to 20 or newer",
  });

  try {
    const res = await runner(opencodeBin, ["--version"]);

    captured.push(res.stdout || "");

    const parsed = res.exitCode === 0 ? parseVersion(res.stdout) : null;
    const ok = parsed !== null && versionGte(parsed, MIN_OPENCODE);

    checks.push({
      name: "opencode-version",
      ok,
      detail: parsed
        ? `opencode v${versionText(parsed)} (>= ${MIN_OPENCODE} required)`
        : `opencode version unavailable (>= ${MIN_OPENCODE} required)`,
      hint: `Install OpenCode >= ${MIN_OPENCODE}`,
    });
  } catch {
    checks.push({
      name: "opencode-version",
      ok: false,
      detail: "opencode not found",
      hint: `Install OpenCode >= ${MIN_OPENCODE}`,
    });
  }

  const configPath = findConfigFile(configDir);

  checks.push({
    name: "config-file",
    ok: configPath !== null && configPath !== undefined,
    detail: configPath || "no config file found",
    hint: "Run npm run setup to add the plugin entry",
  });

  checks.push(pluginEntryCheck(configPath, fs, expectedEntry));
  checks.push(pluginPathCheck(installDir, fs));

  const accountsPath = path.join(configDir, ACCOUNTS_FILE);
  const accountsPresent = fs.existsSync(accountsPath);

  checks.push({
    name: "accounts-file",
    ok: accountsPresent,
    detail: accountsPresent ? `present at ${accountsPath}` : "missing",
    hint: "Run: opencode auth login google, then choose Google OAuth (Antigravity)",
  });

  try {
    const res = await runner(opencodeBin, ["models"]);
    const stdout = res.stdout || "";

    captured.push(stdout);

    const count = stdout.split("\n").filter((line) => /antigravity-/.test(line)).length;

    checks.push({
      name: "models-discovery",
      ok: res.exitCode === 0 && count > 0,
      detail: count > 0 ? `${count} antigravity models found` : "no antigravity-* models",
      hint: "Sign in with Antigravity OAuth, then refresh via /antigravity",
    });
  } catch {
    checks.push({
      name: "models-discovery",
      ok: false,
      detail: "no antigravity-* models",
      hint: "Sign in with Antigravity OAuth, then refresh via /antigravity",
    });
  }

  checks.push(pluginBuildCheck(installDir, fs));
  checks.push(await pluginResolvableCheck(runner, opencodeBin, pluginPath, captured));

  return {
    ok: checks.every((check) => check.ok),
    checks,
    signatures: findSignatures(captured),
  };
}

function usage() {
  return [
    "Usage: opencode-antigravity-doctor [options]",
    "",
    "Options:",
    "  --config-dir <dir>      Config directory (default: OPENCODE_CONFIG_DIR",
    "                          or ~/.config/opencode).",
    "  --install-dir <dir>     Plugin install directory.",
    "  --opencode-bin <path>   OpenCode executable (default: opencode).",
    "  --json                  Machine-readable JSON output.",
    "  -h, --help              Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { configDir: undefined, installDir: undefined, opencodeBin: undefined, json: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--config-dir") {
      args.configDir = argv[i + 1];
      i += 1;
    } else if (arg === "--install-dir") {
      args.installDir = argv[i + 1];
      i += 1;
    } else if (arg === "--opencode-bin") {
      args.opencodeBin = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function printHuman(result) {
  for (const check of result.checks) {
    const status = check.ok ? "PASS" : "FAIL";

    console.log(`${status} ${check.name}: ${check.detail}`);

    if (!check.ok) {
      console.log(`  hint: ${check.hint}`);
    }
  }

  for (const signature of result.signatures) {
    console.log(`WARN ${signature.name}: ${signature.hint} (${signature.url})`);
  }

  console.log(`doctor: ${result.ok ? "PASS" : "FAIL"}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(usage());

    return 0;
  }

  const result = await runDoctor({
    configDir: args.configDir,
    installDir: args.installDir,
    opencodeBin: args.opencodeBin,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err && err.message ? err.message : String(err));
      process.exitCode = 1;
    });
}

module.exports = { runDoctor, main };
