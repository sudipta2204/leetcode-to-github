// LeetCode to GitHub - Content Script
// Watches for "Accepted" verdict and pushes solution to GitHub

(function () {
  let lastPushedKey = null; // prevents duplicate pushes for same submission

  // ── Utility: fetch problem metadata via LeetCode's GraphQL API ──
  async function fetchProblemData(titleSlug) {
    const query = {
      query: `
        query getProblem($titleSlug: String!) {
          question(titleSlug: $titleSlug) {
            questionId
            title
            difficulty
            content
            topicTags { name }
          }
        }
      `,
      variables: { titleSlug }
    };

    const res = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query)
    });
    const json = await res.json();
    return json.data.question;
  }

  // ── Utility: strip HTML tags from problem description ──
  function stripHtml(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.innerText.trim();
  }

  // ── Utility: get title slug from current URL ──
  function getTitleSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

    // ── Utility: detect selected language and return { code, extension, langName } ──
  const LANG_MAP = {
    "c++":        { ext: "cpp",    name: "C++" },
    "java":       { ext: "java",   name: "Java" },
    "python3":    { ext: "py",     name: "Python3" },
    "python":     { ext: "py",     name: "Python" },
    "javascript": { ext: "js",     name: "JavaScript" },
    "typescript": { ext: "ts",     name: "TypeScript" },
    "c#":         { ext: "cs",     name: "C#" },
    "c":          { ext: "c",      name: "C" },
    "go":         { ext: "go",     name: "Go" },
    "kotlin":     { ext: "kt",     name: "Kotlin" },
    "swift":      { ext: "swift",  name: "Swift" },
    "rust":       { ext: "rs",     name: "Rust" },
    "ruby":       { ext: "rb",     name: "Ruby" },
    "php":        { ext: "php",    name: "PHP" },
    "dart":       { ext: "dart",   name: "Dart" },
    "scala":      { ext: "scala",  name: "Scala" },
    "elixir":     { ext: "ex",     name: "Elixir" },
    "erlang":     { ext: "erl",    name: "Erlang" },
    "racket":     { ext: "rkt",    name: "Racket" },
  };

  function getLanguageInfo() {
    // LeetCode shows selected language in a button in the editor toolbar
    const langBtn = document.querySelector('[data-track-load="description_content"] button') ||
                    document.querySelector('button[id*="headlessui-listbox-button"]') ||
                    [...document.querySelectorAll("button")].find(b =>
                      Object.keys(LANG_MAP).includes(b.textContent.trim().toLowerCase())
                    );

    let langRaw = langBtn ? langBtn.textContent.trim().toLowerCase() : "java";

    // Also try reading from the URL or editor title
    const editorLangEl = document.querySelector('[class*="language-"] span, [data-mode-id]');
    if (editorLangEl) {
      const candidate = (editorLangEl.textContent || editorLangEl.getAttribute("data-mode-id") || "").trim().toLowerCase();
      if (LANG_MAP[candidate]) langRaw = candidate;
    }

    return LANG_MAP[langRaw] || { ext: "txt", name: langRaw };
  }

  // ── Utility: get the solution code from the Monaco editor ──
  function getSolutionCode() {
    // Try monaco editor model first
    if (window.monaco && window.monaco.editor) {
      const editors = window.monaco.editor.getEditors();
      if (editors.length > 0) {
        return editors[0].getValue();
      }
    }
    // Fallback: grab from CodeMirror or textarea
    const cm = document.querySelector(".CodeMirror");
    if (cm && cm.CodeMirror) return cm.CodeMirror.getValue();
    const ta = document.querySelector("textarea.inputarea");
    if (ta) return ta.value;
    return null;
  }

  // ── Push file to GitHub via API ──
  async function pushToGitHub({ token, owner, repo, difficulty, title, questionId, description, code, langInfo }) {
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_");
    const folder = difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase();
    const ext = langInfo ? langInfo.ext : "java";
    const path = `${folder}/${questionId}_${safeTitle}.${ext}`;

    // Build file content
    const fileContent = [
      `/*`,
      ` * Problem #${questionId}: ${title}`,
      ` * Difficulty: ${difficulty}`,
      ` *`,
      ` * ----- Description -----`,
      ` *`,
      ...description.split("\n").map(line => ` * ${line}`),
      ` *`,
      ` * ----- Solution -----`,
      ` */`,
      ``,
      code
    ].join("\n");

    const encoded = btoa(unescape(encodeURIComponent(fileContent)));
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    // Check if file already exists (to get its SHA for update)
    let sha = undefined;
    try {
      const checkRes = await fetch(apiUrl, {
        headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" }
      });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        sha = existing.sha;
      }
    } catch (_) {}

    const body = {
      message: `✅ Add solution: ${title} (${difficulty})`,
      content: encoded,
      ...(sha ? { sha } : {})
    };

    const res = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "GitHub API error");
    }
    return path;
  }

  // ── Show a small toast notification on screen ──
  function showToast(message, success = true) {
    const old = document.getElementById("lc2gh-toast");
    if (old) old.remove();

    const toast = document.createElement("div");
    toast.id = "lc2gh-toast";
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      background: ${success ? "#22c55e" : "#ef4444"};
      color: white; padding: 12px 18px; border-radius: 10px;
      font-family: monospace; font-size: 14px; max-width: 320px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      animation: fadeIn 0.3s ease;
    `;
    toast.innerHTML = `<b>LeetCode→GitHub</b><br>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // ── Main: observe the DOM for "Accepted" result ──
  async function handleAccepted() {
    const titleSlug = getTitleSlug();
    if (!titleSlug) return;

    // Deduplicate: don't push twice for same problem in same session
    if (lastPushedKey === titleSlug) return;

    const { githubToken, githubOwner, githubRepo } = await chrome.storage.sync.get([
      "githubToken", "githubOwner", "githubRepo"
    ]);

    if (!githubToken || !githubOwner || !githubRepo) {
      showToast("⚠️ Please configure your GitHub details in the extension popup.", false);
      return;
    }

    try {
      const code = getSolutionCode();
      if (!code) {
        showToast("⚠️ Could not read solution code. Please try again.", false);
        return;
      }

      const langInfo = getLanguageInfo();
      const problem = await fetchProblemData(titleSlug);
      if (!problem) throw new Error("Could not fetch problem details");

      const description = stripHtml(problem.content || "");

      const filePath = await pushToGitHub({
        token: githubToken,
        owner: githubOwner,
        repo: githubRepo,
        difficulty: problem.difficulty,
        title: problem.title,
        questionId: problem.questionId,
        description,
        code,
        langInfo
      });

      lastPushedKey = titleSlug;
      showToast(`🎉 Pushed to GitHub!<br><code>${filePath}</code>`);
    } catch (err) {
      showToast(`❌ Error: ${err.message}`, false);
      console.error("[LeetCode→GitHub]", err);
    }
  }

  // ── Watch DOM for the "Accepted" text appearing ──
  const observer = new MutationObserver(() => {
    // LeetCode shows result in elements with these patterns
    const resultEl =
      document.querySelector('[data-e2e-locator="submission-result"]') ||
      document.querySelector(".text-green-s") ||
      document.querySelector('[class*="accepted"]');

    if (resultEl) {
      const text = resultEl.textContent.trim().toLowerCase();
      if (text === "accepted") {
        // Small delay to ensure Monaco has the latest code
        setTimeout(handleAccepted, 800);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();