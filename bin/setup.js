#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const common = require("../lib/common");
const jsonc = require("../lib/jsonc");

const INSTALL_MARKER = ".oc-antigravity-install.json";
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 120000;

function usage() {
  return [
    "Usage: opencode-antigravity-setup [options]",
    "",
    "Install the pinned gulp79 fork build of opencode-antigravity-auth and pin its",
    "absolute path in the top-level plugins array of an OpenCode V2 config,",
    "without changing any other settings or comments.",
    "",
    "Options:",
    "  --config-dir <dir>      Config directory (default: OPENCODE_CONFIG_DIR",
    "                          or ~/.config/opencode).",
    "  --install-dir <dir>     Bundle install directory (default:",
    "                          OC_ANTIGRAVITY_DIR or ~/opt/oc-antigravity).",
    "  --force                 Re-download and re-verify the pinned bundle even",
    "                          when a verified install is already present.",
    "  --dry-run               Print the updated config; write nothing; never",
    "                          download, extract, or create a marker.",
    "  --write-plugin-config   Also create antigravity.json if it is absent.",
    "  -h, --help              Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = {
    configDir: null,
    installDir: null,
    force: false,
    dryRun: false,
    writePluginConfig: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--write-plugin-config") {
      opts.writePluginConfig = true;
    } else if (arg === "--config-dir") {
      if (i + 1 >= argv.length) {
        throw new Error("--config-dir requires a directory argument");
      }
      opts.configDir = argv[++i];
    } else if (arg.startsWith("--config-dir=")) {
      opts.configDir = arg.slice("--config-dir=".length);
    } else if (arg === "--install-dir") {
      if (i + 1 >= argv.length) {
        throw new Error("--install-dir requires a directory argument");
      }
      opts.installDir = argv[++i];
    } else if (arg.startsWith("--install-dir=")) {
      opts.installDir = arg.slice("--install-dir=".length);
    } else {
      throw new Error("Unknown flag: " + arg);
    }
  }

  return opts;
}

function pluginConfigContents() {
  const settings = {
    $schema: common.SCHEMA_URL,
    auto_update: false,
    keep_thinking: false,
    session_recovery: true,
  };

  return JSON.stringify(settings, null, 2) + "\n";
}

function writePluginConfig(configDir, dryRun) {
  const target = path.join(configDir, common.PLUGIN_CONFIG_FILE);

  if (fs.existsSync(target)) {
    process.stdout.write("left existing " + target + " unchanged\n");
    return;
  }

  if (dryRun) {
    process.stdout.write("would create " + target + "\n");
    return;
  }

  fs.writeFileSync(target, pluginConfigContents());
  process.stdout.write("Created " + target + "\n");
}

/** True only when the marker records the exact pinned fork build and digest. */
function markerIsValid(markerPath, fsMod = fs) {
  let raw;
  try {
    raw = fsMod.readFileSync(markerPath, "utf8");
  } catch (err) {
    return false;
  }

  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (err) {
    return false;
  }

  return Boolean(
    marker &&
    marker.version === common.PINNED_VERSION &&
    typeof marker.sha512 === "string" &&
    marker.sha512.toLowerCase() === common.BUNDLE_SHA512.toLowerCase()
  );
}

/** Download a URL to a destination file, following up to MAX_REDIRECTS redirects. */
function downloadToFile(url, dest, redirectsLeft = MAX_REDIRECTS, io = {}) {
  const fsMod = io.fs || fs;
  const get = io.get || https.get;

  return new Promise((resolve, reject) => {
    const request = get(url, (res) => {
      const status = res.statusCode || 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("too many redirects"));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        downloadToFile(next, dest, redirectsLeft - 1, io).then(resolve, reject);
        return;
      }

      if (status !== 200) {
        res.resume();
        reject(new Error("unexpected HTTP status " + status));
        return;
      }

      const hash = crypto.createHash("sha512");
      const out = fsMod.createWriteStream(dest);
      res.on("data", (chunk) => hash.update(chunk));
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => resolve(hash.digest("hex")));
      });
      out.on("error", reject);
      res.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error("download timed out"));
    });
  });
}

/**
 * Install or verify the pinned bundle.
 *
 * Idempotency is marker-based on purpose: a matching .oc-antigravity-install.json
 * means the digest was already verified, so setup does no network or tar work.
 * Tests create that marker (with a plugin directory) in a throwaway install
 * dir, which keeps the suite fully offline. --force bypasses the shortcut.
 */
async function installPlugin(opts = {}, io = {}) {
  const fsMod = io.fs || fs;
  const installDir = common.resolveInstallDir(opts);
  const markerPath = path.join(installDir, INSTALL_MARKER);
  const pluginDir = common.pluginPathFor(installDir);

  if (!opts.force && markerIsValid(markerPath, fsMod)) {
    process.stdout.write("verified install already present at " + pluginDir + "\n");
    return { installed: false, installDir };
  }

  fsMod.mkdirSync(installDir, { recursive: true });

  const tmp = path.join(installDir, ".oc-antigravity-bundle-" + process.pid + ".tar.gz");
  let digest;
  try {
    digest = await downloadToFile(common.BUNDLE_URL, tmp, MAX_REDIRECTS, io);
  } catch (err) {
    fsMod.rmSync(tmp, { force: true });
    throw new Error("Could not download the plugin bundle: " + err.message);
  }

  if (String(digest).toLowerCase() !== common.BUNDLE_SHA512.toLowerCase()) {
    fsMod.rmSync(tmp, { force: true });
    throw new Error(
      "Plugin bundle SHA-512 mismatch: expected " + common.BUNDLE_SHA512 + ", downloaded " + digest + ". Nothing was extracted."
    );
  }

  const tar = (io.spawnSync || spawnSync)("tar", ["-xzf", tmp, "-C", installDir], { encoding: "utf8" });
  fsMod.rmSync(tmp, { force: true });
  if (tar.error || tar.status !== 0) {
    const detail = tar.error ? tar.error.message : String(tar.stderr || "tar failed").trim();
    throw new Error("Could not extract the plugin bundle: " + detail);
  }

  const packageJson = path.join(pluginDir, "package.json");
  if (!fsMod.existsSync(packageJson)) {
    throw new Error("Bundle extracted but " + packageJson + " is missing.");
  }

  fsMod.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        version: common.PINNED_VERSION,
        sha512: common.BUNDLE_SHA512,
        installedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  process.stdout.write("Installed " + common.PINNED_VERSION + " at " + pluginDir + "\n");
  return { installed: true, installDir };
}

/** Update the config file. Returns an exit status. */
function updateConfig(file, configDir, pluginEntry, dryRun) {
  let original;
  try {
    original = fs.readFileSync(file, "utf8");
  } catch (err) {
    process.stderr.write("error: Could not read " + file + ": " + err.message + "\n");
    return 1;
  }

  let result;
  try {
    result = jsonc.mergePluginEntry(original, { pluginEntry });
  } catch (err) {
    if (err && err.code === "CONFLICT") {
      process.stderr.write("error: " + err.message + "\n");
    } else {
      process.stderr.write("error: Could not update " + file + ": " + err.message + "\n");
    }
    return 1;
  }

  if (!result.changed) {
    process.stdout.write("No changes: " + pluginEntry + " is already pinned in plugins.\n");
    return 0;
  }

  if (dryRun) {
    process.stdout.write(result.output);
    process.stderr.write("dry-run: no files written\n");
    return 0;
  }

  const backup = file + ".bak";
  const tmp = path.join(configDir, "." + path.basename(file) + ".tmp-" + process.pid);

  fs.writeFileSync(backup, original);
  fs.writeFileSync(tmp, result.output);
  fs.renameSync(tmp, file);

  process.stdout.write("Updated " + file + " (backup: " + backup + ")\n");
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  let opts;

  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write("error: " + err.message + "\n");
    process.stderr.write(usage() + "\n");
    return 1;
  }

  if (opts.help) {
    process.stdout.write(usage() + "\n");
    return 0;
  }

  const configDir = common.resolveConfigDir({ configDir: opts.configDir });
  const file = common.findConfigFile(configDir);

  if (!file) {
    process.stderr.write("error: No opencode.jsonc or opencode.json found in " + configDir + ". Run setup with --config-dir or create one.\n");
    return 1;
  }

  const installDir = common.resolveInstallDir({ installDir: opts.installDir });
  const pluginEntry = common.pluginEntryFor({ installDir });

  if (opts.dryRun) {
    process.stdout.write("would install/verify " + common.pluginPathFor(installDir) + "\n");
  } else {
    try {
      await installPlugin({ installDir, force: opts.force });
    } catch (err) {
      process.stderr.write("error: " + err.message + "\n");
      return 1;
    }
  }

  const status = updateConfig(file, configDir, pluginEntry, opts.dryRun);
  if (status !== 0) {
    return status;
  }

  // A no-op config update leaves the config and backup untouched, but an
  // explicit --write-plugin-config still reports on its own target file.
  if (opts.writePluginConfig) {
    writePluginConfig(configDir, opts.dryRun);
  }

  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write("error: " + (err && err.message ? err.message : String(err)) + "\n");
      process.exitCode = 1;
    }
  );
}

module.exports = {
  main,
  parseArgs,
  installPlugin,
  downloadToFile,
  updateConfig,
  writePluginConfig,
  markerIsValid,
  INSTALL_MARKER,
};
