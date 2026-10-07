/* Parse a connection's cached digest (content_cache) into messages.
   Gmail:   "--- From: A <a@x> | Date: … | Subject: …\n<body>"
   Others:  "- Author (timestamp): message"                                  */
export function parseDigest(provider, content = "") {
  if (!content) return [];
  if (provider === "gmail" || content.includes("--- From:")) {
    return content
      .split(/\n(?=--- From:)/)
      .map((b) => b.trim())
      .filter((b) => b.startsWith("--- From:"))
      .map((b) => {
        const [head, ...rest] = b.split("\n");
        const get = (k) => (head.match(new RegExp(`${k}:\\s*([^|]*)`)) || [])[1]?.trim() || "";
        const from = get("From");
        const name = from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || from;
        const email = (from.match(/<([^>]+)>/) || [])[1] || "";
        return { author: name, email, date: get("Date"), subject: get("Subject"), body: rest.join("\n").trim() };
      });
  }
  const lines = content.split("\n").map((l) => l.trim());
  const msgs = [];
  for (const l of lines) {
    const m = l.match(/^- ([^(]+?) \(([^)]*)\):\s?(.*)$/);
    if (m) msgs.push({ author: m[1].trim(), date: m[2].trim(), body: m[3].trim() });
    else if (msgs.length && l && !/^[A-Z ]+(\(|:)/.test(l)) msgs[msgs.length - 1].body += `\n${l}`;
  }
  if (msgs.length) return msgs;
  return [{ author: "", date: "", body: content.trim() }];
}

/* Highlight memory titles inside a message body (best-effort phrase match). */
export function findSignals(body, items) {
  if (!body || !items?.length) return [];
  const low = body.toLowerCase();
  return items.filter((m) => {
    const t = (m.title || "").toLowerCase();
    if (!t) return false;
    const words = t.split(/\s+/).filter((w) => w.length > 4).slice(0, 4);
    return words.length >= 2 && words.filter((w) => low.includes(w)).length >= Math.min(3, words.length);
  });
}
