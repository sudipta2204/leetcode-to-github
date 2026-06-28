(function () {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  let isPushing = false;
  let lastSubmissionId = null;

  window.addEventListener("lc2gh_submission", async (e) => {
    const { submissionId, code, langSlug } = e.detail;
    if (!submissionId || isPushing || lastSubmissionId === submissionId) return;
    isPushing = true;

    try {
      showToast("Judging... waiting for result.", null);
      const result = await pollResult(submissionId);
      if (!result || result.status_msg !== "Accepted") { isPushing = false; return; }

      const { githubToken, githubOwner, githubRepo } = await chrome.storage.sync.get([
        "githubToken", "githubOwner", "githubRepo"
      ]);
      if (!githubToken || !githubOwner || !githubRepo) {
        showToast("Configure GitHub details in the popup.", false);
        isPushing = false;
        return;
      }

      const titleSlug = getTitleSlug();
      const problem = await fetchProblemData(titleSlug);
      if (!problem) throw new Error("Could not fetch problem details");

      const LANG_MAP = {
        "cpp": "cpp", "java": "java", "python3": "py", "python": "py",
        "javascript": "js", "typescript": "ts", "csharp": "cs", "c": "c",
        "golang": "go", "kotlin": "kt", "swift": "swift", "rust": "rs",
        "ruby": "rb", "php": "php", "dart": "dart", "scala": "scala",
        "elixir": "ex", "erlang": "erl", "racket": "rkt"
      };
      const ext = LANG_MAP[langSlug] || "txt";
      const finalCode = result.code || code || "";

      const filePath = await pushToGitHub({
        token: githubToken, owner: githubOwner, repo: githubRepo,
        difficulty: problem.difficulty, title: problem.title,
        questionId: problem.questionId,
        description: stripHtml(problem.content || ""),
        code: finalCode, ext
      });

      lastSubmissionId = submissionId;
      showToast(`Pushed!<br><code>${filePath}</code>`);
    } catch (err) {
      showToast(`Error: ${err.message}`, false);
    } finally {
      isPushing = false;
    }
  });

  async function pollResult(submissionId) {
    const url = `https://leetcode.com/submissions/detail/${submissionId}/check/`;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.state === "SUCCESS") return data;
      } catch (_) {}
    }
    return null;
  }

  function getTitleSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  async function fetchProblemData(titleSlug) {
    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query getProblem($titleSlug: String!) {
          question(titleSlug: $titleSlug) { questionId title difficulty content }
        }`,
        variables: { titleSlug }
      })
    });
    const json = await res.json();
    return json.data.question;
  }

  function stripHtml(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.innerText.trim();
  }

  async function pushToGitHub({ token, owner, repo, difficulty, title, questionId, description, code, ext }) {
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_");
    const folder = difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase();
    const path = `${folder}/${questionId}_${safeTitle}.${ext}`;

    const fileContent = [
      `/*`,
      ` * Problem #${questionId}: ${title}`,
      ` * Difficulty: ${difficulty}`,
      ` *`,
      ` * ----- Description -----`,
      ` *`,
      ...description.split("\n").map(l => ` * ${l}`),
      ` *`,
      ` * ----- Solution -----`,
      ` */`,
      ``,
      code
    ].join("\n");

    const encoded = btoa(unescape(encodeURIComponent(fileContent)));
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    let sha;
    try {
      const check = await fetch(apiUrl, {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" }
      });
      if (check.ok) sha = (await check.json()).sha;
    } catch (_) {}

    const res = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Add solution: ${title} (${difficulty})`,
        content: encoded,
        ...(sha ? { sha } : {})
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "GitHub API error");
    }
    return path;
  }

 function showToast(message, success = true) {
  
  const old = document.getElementById("lc2gh-toast");
  if (old) old.remove();

  // 2. Define Theme Configurations
  const themes = {
    true: { color: "#10b981", bg: "rgba(16, 185, 129, 0.1)", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` },
    false: { color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>` },
    null: { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.1)", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` }
  };

  const theme = themes[success] || themes[null];

  if (!document.getElementById("lc2gh-toast-styles")) {
    const style = document.createElement("style");
    style.id = "lc2gh-toast-styles";
    style.textContent = `
      @keyframes toastIn {
        from { opacity: 0; transform: translateY(-20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes toastOut {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-10px) scale(0.95); }
      }
      .lc2gh-toast-fade-out {
        animation: toastOut 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
      }
    `;
    document.head.appendChild(style);
  }

 
  const toast = document.createElement("div");
  toast.id = "lc2gh-toast";
  toast.style.cssText = `
    position: fixed; top: 24px; right: 24px; z-index: 999999;
    background: rgba(26, 26, 26, 0.85);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.05);
    color: #f3f4f6; padding: 14px 18px; border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
    font-size: 13px; max-width: 320px; min-width: 260px;
    display: flex; align-items: flex-start; gap: 12px;
    animation: toastIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    transition: all 0.2s ease;
  `;

  toast.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 6px; border-radius: 8px; color: ${theme.color}; background: ${theme.bg}; flex-shrink: 0;">
      ${theme.icon}
    </div>
    <div style="flex-grow: 1; padding-top: 2px;">
      <div style="font-weight: 700; font-size: 10px; color: #9ca3af; margin-bottom: 4px; letter-spacing: 0.8px; text-transform: uppercase;">LeetCode to GitHub</div>
      <div style="line-height: 1.45; color: #e5e7eb; font-weight: 400;">${message}</div>
    </div>
  `;

  document.body.appendChild(toast);

  const fadeTimeout = setTimeout(() => {
    toast.classList.add("lc2gh-toast-fade-out");
  }, 4700);

  const removeTimeout = setTimeout(() => {
    toast.remove();
  }, 5000);

  toast.onclick = () => {
    clearTimeout(fadeTimeout);
    clearTimeout(removeTimeout);
    toast.remove();
  };
}
})();