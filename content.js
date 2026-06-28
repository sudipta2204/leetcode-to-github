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
    const toast = document.createElement("div");
    toast.id = "lc2gh-toast";
    const borderColor = success === null ? "#ffa116" : success ? "#00b8a3" : "#ef4444";
    const dot = success === null ? "🟡" : success ? "🟢" : "🔴";
    toast.style.cssText = `
      position: fixed; top: 64px; right: 20px; z-index: 99999;
      background: #282828;
      border: 1px solid ${borderColor};
      color: #eff1f6; padding: 12px 16px; border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; max-width: 300px; min-width: 220px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: flex; align-items: flex-start; gap: 10px;
    `;
    toast.innerHTML =
      '<span style="font-size:16px;line-height:1.4">' + dot + '</span>' +
      '<div>' +
        '<div style="font-weight:600;font-size:11px;color:#a8b3cf;margin-bottom:3px;letter-spacing:0.5px">LEETCODE TO GITHUB</div>' +
        '<div style="line-height:1.5">' + message + '</div>' +
      '</div>';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
})();