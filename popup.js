const tokenInput = document.getElementById("token");
const ownerInput = document.getElementById("owner");
const repoInput  = document.getElementById("repo");
const saveBtn    = document.getElementById("saveBtn");
const statusEl   = document.getElementById("status");

// Load saved settings
chrome.storage.sync.get(["githubToken", "githubOwner", "githubRepo"], (data) => {
  if (data.githubToken) tokenInput.value = data.githubToken;
  if (data.githubOwner) ownerInput.value = data.githubOwner;
  if (data.githubRepo)  repoInput.value  = data.githubRepo;
});

// Save settings + verify token by hitting GitHub API
saveBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  const owner = ownerInput.value.trim();
  const repo  = repoInput.value.trim();

  if (!token || !owner || !repo) {
    showStatus("⚠️ All fields are required.", true);
    return;
  }

  saveBtn.textContent = "Verifying...";
  saveBtn.disabled = true;

  try {
    // Verify that the repo exists and token has access
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json"
      }
    });

    if (res.status === 401) throw new Error("Invalid token — check your PAT.");
    if (res.status === 404) throw new Error("Repo not found — check owner/repo name.");
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);

    await chrome.storage.sync.set({ githubToken: token, githubOwner: owner, githubRepo: repo });
    showStatus("✅ Saved & verified! You're all set.", false);
  } catch (err) {
    showStatus(`❌ ${err.message}`, true);
  } finally {
    saveBtn.textContent = "💾 Save Settings";
    saveBtn.disabled = false;
  }
});

function showStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}
