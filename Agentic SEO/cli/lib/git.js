const { execFileSync } = require("node:child_process");

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  }).trim();
}

function isGitRepo(cwd) {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

function currentBranch(cwd) {
  return git(cwd, ["branch", "--show-current"]);
}

function shortHead(cwd) {
  return git(cwd, ["rev-parse", "--short", "HEAD"]);
}

function statusPorcelain(cwd) {
  return git(cwd, ["status", "--porcelain"]);
}

function isDirty(cwd) {
  return statusPorcelain(cwd).length > 0;
}

function remoteUrls(cwd) {
  try {
    return git(cwd, ["remote", "-v"]);
  } catch {
    return "";
  }
}

function githubRepo(cwd, remote = "origin") {
  const url = git(cwd, ["remote", "get-url", remote]);
  const httpsMatch = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!httpsMatch) throw new Error(`Remote is not a GitHub URL: ${url}`);
  return {
    owner: httpsMatch[1],
    repo: httpsMatch[2].replace(/\.git$/i, ""),
    url,
  };
}

function checkoutNewBranch(cwd, branch, options = {}) {
  // Check if branch already exists
  try {
    const existing = git(cwd, ["branch", "--list", branch]).trim();
    if (existing) {
      // Preserve existing branch tips unless a caller explicitly requests reset.
      if (options.forceRecreate) {
        return git(cwd, ["checkout", "-B", branch]);
      }
      return git(cwd, ["checkout", branch]);
    }
  } catch {
    // branch --list may fail in edge cases, fall through to create
  }
  return git(cwd, ["checkout", "-b", branch]);
}

function add(cwd, files) {
  return git(cwd, ["add", ...files]);
}

function commit(cwd, message, options = {}) {
  const name = options.name || process.env.SEO_AGENT_GIT_NAME || "{{SITE_NAME}} Agent";
  const email = options.email || process.env.SEO_AGENT_GIT_EMAIL || "agent@{{DOMAIN}}";
  return git(cwd, ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-m", message]);
}

function push(cwd, remote = "origin", branch, setUpstream = false) {
  const args = ["push"];
  if (setUpstream) args.push("--set-upstream");
  args.push(remote);
  if (branch) args.push(branch);

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return git(cwd, args);
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      const delayMs = attempt * 2000; // 2s, 4s
      console.error(`[git push] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delayMs}...`);
      const { execFileSync } = require("node:child_process");
      // Synchronous sleep using spawnSync
      try { execFileSync(process.execPath, ["-e", `setTimeout(()=>{},${delayMs})`], { timeout: delayMs + 1000 }); } catch {}
    }
  }
}

function fetchAll(cwd, remote = "origin") {
  return git(cwd, ["fetch", remote, "--prune"]);
}

module.exports = {
  git,
  isGitRepo,
  currentBranch,
  shortHead,
  statusPorcelain,
  isDirty,
  remoteUrls,
  githubRepo,
  checkoutNewBranch,
  add,
  commit,
  push,
  fetchAll,
};
