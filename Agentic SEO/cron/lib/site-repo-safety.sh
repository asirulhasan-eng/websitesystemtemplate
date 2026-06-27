#!/usr/bin/env bash
# Shared site-repository safety helpers for cron workers.
#
# These helpers preserve unrelated work left in /opt/website-site before
# a worker checks out the production branch. They intentionally preflight the git
# index before invoking `git stash` so an unmerged or unwritable index is reported
# as a clear blocker instead of surfacing the low-signal `could not write index`
# stash failure that previously starved ops/blog handoffs.

site_repo_log() {
  local timestamp="$1"
  local level="$2"
  local message="$3"
  echo "[${timestamp}] [site-repo-${level}] ${message}"
}

resolve_site_production_branch() {
  local agent_root="$1"
  local fallback="${2:-main}"
  local branch="${CLOUDFLARE_PRODUCTION_BRANCH:-}"
  local line value

  if [ -z "$branch" ] && [ -f "${agent_root}/.env" ]; then
    while IFS= read -r line; do
      case "$line" in
        CLOUDFLARE_PRODUCTION_BRANCH=*)
          value="${line#CLOUDFLARE_PRODUCTION_BRANCH=}"
          value="${value%$'\r'}"
          value="${value#\"}"
          value="${value%\"}"
          value="${value#\'}"
          value="${value%\'}"
          branch="$value"
          ;;
      esac
    done < "${agent_root}/.env"
  fi

  printf '%s' "${branch:-$fallback}"
}

site_repo_current_branch() {
  git -C "$1" symbolic-ref --short HEAD 2>/dev/null || true
}

site_repo_is_dirty() {
  local site_root="$1"
  [ -n "$(git -C "$site_root" status --porcelain=v1 --untracked-files=all -- . 2>/dev/null || true)" ]
}

site_repo_unmerged_paths() {
  local site_root="$1"
  git -C "$site_root" ls-files -u -- . 2>/dev/null | while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      *$'\t'*) printf '%s\n' "${line#*$'\t'}" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done | sort -u
}

site_repo_index_preflight_for_stash() {
  local site_root="$1"
  local timestamp="$2"
  local unmerged index_lock git_dir refresh_log

  if ! git -C "$site_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    site_repo_log "$timestamp" error "${site_root} is not a git worktree; cannot preserve state."
    return 65
  fi

  unmerged="$(site_repo_unmerged_paths "$site_root")"
  if [ -n "$unmerged" ]; then
    site_repo_log "$timestamp" error "site repo has unmerged index entries; refusing to run git stash. Resolve/abort merge first. Paths: $(printf '%s' "$unmerged" | paste -sd ', ' -)"
    return 66
  fi

  git_dir="$(git -C "$site_root" rev-parse --git-dir 2>/dev/null || true)"
  if [ -n "$git_dir" ]; then
    case "$git_dir" in
      /*) index_lock="${git_dir}/index.lock" ;;
      *) index_lock="${site_root}/${git_dir}/index.lock" ;;
    esac
    if [ -e "$index_lock" ]; then
      site_repo_log "$timestamp" error "site repo has ${index_lock}; refusing to run git stash until stale lock/active git process is cleared."
      return 67
    fi
  fi

  refresh_log="$(mktemp)"
  if ! git -C "$site_root" update-index -q --refresh -- . >"$refresh_log" 2>&1; then
    site_repo_log "$timestamp" error "site repo index is not refreshable; refusing to run git stash. $(tr '\n' ' ' < "$refresh_log")"
    rm -f "$refresh_log"
    return 67
  fi
  rm -f "$refresh_log"
  return 0
}

site_repo_preserve_and_checkout_production() {
  local site_root="$1"
  local prod_branch="$2"
  local job="$3"
  local timestamp="$4"
  local current_branch status_output stash_message stash_output

  prod_branch="${prod_branch:-main}"
  if ! git -C "$site_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    site_repo_log "$timestamp" error "${site_root} is not a git worktree."
    return 65
  fi

  current_branch="$(site_repo_current_branch "$site_root")"
  status_output="$(git -C "$site_root" status --porcelain=v1 --untracked-files=all -- . 2>/dev/null || true)"

  if [ -z "$status_output" ] && [ -n "$current_branch" ] && [ "$current_branch" = "$prod_branch" ]; then
    return 0
  fi

  if [ -n "$status_output" ]; then
    local preflight_rc=0
    site_repo_index_preflight_for_stash "$site_root" "$timestamp" || preflight_rc=$?
    if [ "$preflight_rc" -ne 0 ]; then
      return "$preflight_rc"
    fi

    stash_message="${job:-site-worker}-preserve-before-${prod_branch}-${timestamp}"
    if stash_output="$(git -C "$site_root" stash push -u -m "$stash_message" -- . 2>&1)"; then
      site_repo_log "$timestamp" preserve "dirty site repo state preserved in git stash: ${stash_message}. Restore with: git -C ${site_root} stash list && git -C ${site_root} stash pop"
    else
      site_repo_log "$timestamp" error "failed to preserve dirty site repo state with git stash after index preflight: ${stash_output}"
      return 67
    fi
  fi

  current_branch="$(site_repo_current_branch "$site_root")"
  if [ -n "$current_branch" ] && [ "$current_branch" != "$prod_branch" ]; then
    if git -C "$site_root" checkout "$prod_branch" >/dev/null 2>&1; then
      site_repo_log "$timestamp" fix "site repo was on '${current_branch}', checked out '${prod_branch}' for worker-safe production handoff."
    else
      site_repo_log "$timestamp" error "failed to checkout production branch '${prod_branch}' from '${current_branch}'."
      return 65
    fi
  fi

  return 0
}
