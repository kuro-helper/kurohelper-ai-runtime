#!/usr/bin/env node
/**
 * KuroHelper AI Runtime release-readiness checks.
 *
 * This project is deployed with Compose rather than published to npm. Keep
 * this checklist aligned with the executable services and container images.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  return result.status === 0;
}

function capture(command, args, cwd = repositoryRoot) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });
}

function commandIsAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  return result.status === 0;
}

function testFiles(directory, suffix) {
  return fs
    .readdirSync(path.join(repositoryRoot, directory))
    .filter((file) => file.endsWith(suffix))
    .sort()
    .map((file) => path.join(directory, file));
}

function findComposeCommand() {
  for (const command of ["docker", "podman"]) {
    if (commandIsAvailable(command, ["compose", "version"])) {
      return command;
    }
  }
  return null;
}

function findPythonCommand() {
  for (const command of ["python", "python3"]) {
    if (commandIsAvailable(command)) {
      return command;
    }
  }
  return null;
}

function validateCompose() {
  const command = findComposeCommand();
  if (!command) {
    console.error("Docker Compose or Podman Compose is required.");
    return false;
  }
  return run(command, ["compose", "config", "--quiet"]);
}

function buildImages() {
  const command = findComposeCommand();
  if (!command) {
    console.error("Docker Compose or Podman Compose is required.");
    return false;
  }
  return run(command, ["compose", "build"]);
}

function testMemoryService() {
  const command = findPythonCommand();
  if (!command) {
    console.error("Python is required for the memory service tests.");
    return false;
  }
  return run(
    command,
    ["-m", "unittest", "discover", "-p", "test_*.py"],
    path.join(repositoryRoot, "memory-service"),
  );
}

function scanReleaseFiles() {
  if (!commandIsAvailable("gitleaks")) {
    console.error("Gitleaks is required for the release secret scan.");
    return false;
  }

  const listed = capture("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr || "Unable to list release files.\n");
    return false;
  }

  const scanRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "kurohelper-ai-runtime-release-"),
  );
  try {
    for (const relativePath of listed.stdout.split("\0").filter(Boolean)) {
      const source = path.resolve(repositoryRoot, relativePath);
      const destination = path.resolve(scanRoot, relativePath);
      const relativeToRoot = path.relative(repositoryRoot, source);
      if (
        relativeToRoot.startsWith("..") ||
        path.isAbsolute(relativeToRoot) ||
        !fs.existsSync(source) ||
        !fs.statSync(source).isFile()
      ) {
        continue;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }

    return run("gitleaks", [
      "dir",
      "--no-banner",
      "--redact",
      "--log-level",
      "warn",
      scanRoot,
    ]);
  } finally {
    fs.rmSync(scanRoot, { recursive: true, force: true });
  }
}

const serverTests = testFiles("server", ".test.js");
const browserTests = testFiles("src", ".test.mjs");
const checks = [
  {
    name: "Server tests",
    run: () => run("node", ["--test", ...serverTests]),
  },
  {
    name: "Browser runtime tests",
    run: () => run("node", ["--test", ...browserTests]),
  },
  {
    name: "Character seed tests",
    run: () =>
      run("node", ["--test", "deploy/character-seed/seed.test.mjs"]),
  },
  {
    name: "Metrics proxy tests",
    run: () => run("node", ["--test", "metrics-proxy/server.test.js"]),
  },
  {
    name: "Memory service tests",
    run: testMemoryService,
  },
  {
    name: "Browser worker syntax",
    run: () => run("node", ["--check", "deploy/browser/runner.js"]),
  },
  {
    name: "Compose configuration",
    run: validateCompose,
  },
  {
    name: "Container image builds",
    run: buildImages,
  },
  {
    name: "Release secret scan",
    run: scanReleaseFiles,
  },
];

let failed = false;
console.log("\n=== KuroHelper AI Runtime Release Checklist ===");
for (const check of checks) {
  let ok = false;
  try {
    ok = check.run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${check.name}`);
  if (!ok) failed = true;
}

if (failed) {
  console.error("\nRelease checklist failed. Resolve the failing items above.");
  process.exit(1);
}

console.log("\nRelease checklist passed.");
