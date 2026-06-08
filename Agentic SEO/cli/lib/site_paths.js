const fs = require("node:fs");
const path = require("node:path");

function resolveSitePath(siteRoot, value, label = "site path") {
  if (value === undefined || value === null || value === "") return null;

  const root = path.resolve(siteRoot);
  let raw = String(value).trim();
  if (!raw) return null;

  let fromUrl = false;
  if (/^https?:\/\//i.test(raw)) {
    fromUrl = true;
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
    } catch {
      raw = raw.replace(/^https?:\/\/[^/]+/i, "");
    }
  }

  let resolved;
  if (!fromUrl && path.isAbsolute(raw)) {
    const absolute = path.resolve(raw);
    const absoluteRelative = path.relative(root, absolute);
    if (!absoluteRelative.startsWith("..") && !path.isAbsolute(absoluteRelative)) {
      resolved = absolute;
    } else if (fs.existsSync(path.dirname(absolute))) {
      throw new Error(`Refusing to use ${label} outside siteRoot: ${absolute}`);
    } else {
      // A leading slash like `/services/foo.html` usually comes from a site URL
      // path, not a filesystem root. Treat it as site-root-relative unless it
      // clearly resolves to an existing filesystem location outside siteRoot.
      resolved = path.resolve(root, raw.replace(/^[\\/]+/, ""));
    }
  } else {
    resolved = path.resolve(root, raw.replace(/^[\\/]+/, ""));
  }
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to use ${label} outside siteRoot: ${resolved}`);
  }

  return resolved;
}

module.exports = {
  resolveSitePath,
};
