function previewHostnameForBranch(branch) {
  const slug = String(branch || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return slug || "preview";
}

function previewUrlForBranch(branch, domain) {
  if (!domain) return `branch:${branch}`;
  return `https://${previewHostnameForBranch(branch)}.${domain}`;
}

module.exports = {
  previewHostnameForBranch,
  previewUrlForBranch,
};
