(function () {
  let lastSubmissionId = null;

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0]?.url || "");

      if (url.includes("submit") && args[1]?.method === "POST") {
        const clone = response.clone();
        clone.json().then(data => {
          const subId = data.submission_id || data.submissionId;
          if (subId && String(subId) !== lastSubmissionId) {
            lastSubmissionId = String(subId);
            let code = null, langSlug = "java";
            try {
              const body = JSON.parse(args[1].body);
              code = body.typed_code || null;
              langSlug = body.lang || body.language || "java";
            } catch (_) {}
            window.dispatchEvent(new CustomEvent("lc2gh_submission", {
              detail: { submissionId: lastSubmissionId, code, langSlug }
            }));
          }
        }).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._lc2gh_url = url;
    this._lc2gh_method = method;
    return origOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._lc2gh_url?.includes("submit") && this._lc2gh_method === "POST") {
      this.addEventListener("load", () => {
        try {
          const data = JSON.parse(this.responseText);
          const subId = data.submission_id || data.submissionId;
          if (subId) {
            let code = null, langSlug = "java";
            try { const b = JSON.parse(body); code = b.typed_code; langSlug = b.lang || "java"; } catch (_) {}
            window.dispatchEvent(new CustomEvent("lc2gh_submission", {
              detail: { submissionId: String(subId), code, langSlug }
            }));
          }
        } catch (_) {}
      });
    }
    return origSend.apply(this, [body]);
  };
})();