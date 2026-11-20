"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGIN_ID = "opencode-antigravity-auth";
const PACKAGE_VERSION = "2.1.2";
const PINNED_VERSION = "2.1.2-gulp.8";
const BUNDLE_URL =
  "https://github.com/gulp79/opencode-antigravity-auth/releases/download/v2.1.2-gulp.8/opencode-antigravity-auth-2.1.2-bundle.tar.gz";
const BUNDLE_SHA512 =
  "bc1d760ebf0e6f61408c722c2476cbdd566631cd0ce11e40b7608e6388a0dea3f220e17ac8a4e5ad41474f3141f5e99bc588541187499b67bfc1537d4bf1b074";
const NPM_TGZ_SHA512 =
  "54b60a7d907d787d9b0d4c34a7e369d44ec46fe689edcedc9deb2ef47793cc79582ebf0ed4ed800baafd5eec650a19f32639bf701bfa59cb99aacfd739b7b8d5";
const DEFAULT_INSTALL_DIR = path.join(os.homedir(), "opt", "oc-antigravity");
const MIN_OPENCODE = "2.1.2";
const MIN_NODE = "20.0.0";
const SCHEMA_URL =
  "https://raw.githubusercontent.com/NoeFabris/opencode-antigravity-auth/main/assets/antigravity.schema.json";
const ACCOUNTS_FILE = "antigravity-accounts.json";
const PLUGIN_CONFIG_FILE = "antigravity.json";

function resolveConfigDir(opts = {}) {
  return opts.configDir || process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}

function findConfigFile(configDir) {
  const jsoncPath = path.join(configDir, "opencode.jsonc");
  if (fs.existsSync(jsoncPath)) {
    return jsoncPath;
  }

  const jsonPath = path.join(configDir, "opencode.json");
  if (fs.existsSync(jsonPath)) {
    return jsonPath;
  }

  return null;
}

function resolveInstallDir(opts = {}) {
  return opts.installDir || process.env.OC_ANTIGRAVITY_DIR || DEFAULT_INSTALL_DIR;
}

function pluginPathFor(installDir) {
  return path.join(installDir, "node_modules", PLUGIN_ID);
}

function pluginEntryFor(opts = {}) {
  return pluginPathFor(resolveInstallDir(opts));
}

/**
 * True for any plugins-array value that refers to this plugin: an absolute or
 * relative path whose basename is PLUGIN_ID, a node_modules/<id> path, the bare
 * id, or an npm-style specifier such as opencode-antigravity-auth@2.1.2.
 */
function isPluginEntry(value) {
  if (typeof value !== "string") {
    return false;
  }

  if (path.basename(value) === PLUGIN_ID) {
    return true;
  }

  if (value.split(path.sep).join("/").endsWith("node_modules/" + PLUGIN_ID)) {
    return true;
  }

  return value.startsWith(PLUGIN_ID);
}

function parseVersion(text) {
  if (typeof text !== "string") {
    return null;
  }

  const match = text.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionGte(a, b) {
  const left = Array.isArray(a) ? a : parseVersion(a);
  const right = Array.isArray(b) ? b : parseVersion(b);

  if (!left || !right) {
    return false;
  }

  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) {
      return true;
    }
    if (left[i] < right[i]) {
      return false;
    }
  }

  return true;
}

module.exports = {
  PLUGIN_ID,
  PACKAGE_VERSION,
  PINNED_VERSION,
  BUNDLE_URL,
  BUNDLE_SHA512,
  NPM_TGZ_SHA512,
  DEFAULT_INSTALL_DIR,
  MIN_OPENCODE,
  MIN_NODE,
  SCHEMA_URL,
  ACCOUNTS_FILE,
  PLUGIN_CONFIG_FILE,
  resolveConfigDir,
  findConfigFile,
  resolveInstallDir,
  pluginPathFor,
  pluginEntryFor,
  isPluginEntry,
  parseVersion,
  versionGte,
};
