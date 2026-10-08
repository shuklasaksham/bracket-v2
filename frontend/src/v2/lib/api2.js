import { api } from "../../lib/api";

/* Bracket v2 API — one function per endpoint (contract: docs/API_V2.md).
   Every call resolves to response.data. */
const g = (url, params) => api.get(url, { params }).then((r) => r.data);
const p = (url, body) => api.post(url, body || {}).then((r) => r.data);
const pa = (url, body) => api.patch(url, body || {}).then((r) => r.data);
const del = (url, params, data) => api.delete(url, { params, data }).then((r) => r.data);
const W = (wid) => `/v2/w/${wid}`;

export const v2 = {
  /* workspaces */
  workspaces: () => g("/v2/workspaces"),
  createWorkspace: (body) => p("/v2/workspaces", body),
  workspace: (wid) => g(W(wid)),
  updateWorkspace: (wid, body) => pa(W(wid), body),
  seen: (wid) => p(`${W(wid)}/seen`),
  archive: (wid) => p(`${W(wid)}/archive`),
  unarchive: (wid) => p(`${W(wid)}/unarchive`),
  leave: (wid) => p(`${W(wid)}/leave`),
  deleteWorkspace: (wid, confirm) => p(`${W(wid)}/delete`, { confirm }),
  restoreWorkspace: (wid) => p(`${W(wid)}/restore`),
  exportWorkspace: (wid, format) => p(`${W(wid)}/export`, { format }),
  workspaceSettings: (wid) => g(`${W(wid)}/settings`),
  updateWorkspaceSettings: (wid, body) => pa(`${W(wid)}/settings`, body),

  /* overview + attention */
  overview: (wid) => g(`${W(wid)}/overview`),
  attention: (wid, view) => g(`${W(wid)}/attention`, { view }),
  snooze: (wid, aid, until) => p(`${W(wid)}/attention/${aid}/snooze`, { until }),
  saveForLater: (wid, aid) => p(`${W(wid)}/attention/${aid}/save`),
  restoreAttention: (wid, aid) => p(`${W(wid)}/attention/${aid}/restore`),
  dismissAttention: (wid, aid) => p(`${W(wid)}/attention/${aid}/dismiss`),
  conflict: (wid, cid) => g(`${W(wid)}/conflicts/${cid}`),
  resolveConflict: (wid, cid, option, date, note) => p(`${W(wid)}/conflicts/${cid}/resolve`, { option, date, note }),

  /* memory */
  categories: (wid) => g(`${W(wid)}/categories`),
  suggestCategory: (wid, name, description) => p(`${W(wid)}/categories/suggest`, { name, description }),
  renameCategory: (wid, key, label) => pa(`${W(wid)}/categories/${key}`, { label }),
  memory: (wid, params) => g(`${W(wid)}/memory`, params),
  memoryItem: (wid, mid) => g(`${W(wid)}/memory/${mid}`),
  addMemory: (wid, body) => p(`${W(wid)}/memory`, body),
  editMemory: (wid, mid, body) => pa(`${W(wid)}/memory/${mid}`, body),
  markIncorrect: (wid, mid, reason) => p(`${W(wid)}/memory/${mid}/incorrect`, { reason }),
  restoreMemory: (wid, mid) => p(`${W(wid)}/memory/${mid}/restore`),
  people: (wid) => g(`${W(wid)}/people`),
  evidence: (wid, eid) => g(`${W(wid)}/evidence/${eid}`),
  person: (wid, pid) => g(`${W(wid)}/people/${pid}`),

  /* reviews */
  reviews: (wid) => g(`${W(wid)}/reviews`),
  review: (wid, rid) => g(`${W(wid)}/reviews/${rid}`),
  acceptReview: (wid, rid, selected, edits) => p(`${W(wid)}/reviews/${rid}/accept`, { selected, edits }),
  undoReview: (wid, rid) => p(`${W(wid)}/reviews/${rid}/undo`),
  dismissReview: (wid, rid, reason, note) => p(`${W(wid)}/reviews/${rid}/dismiss`, { reason, note }),
  saveReview: (wid, rid) => p(`${W(wid)}/reviews/${rid}/save`),

  /* conversations */
  threads: (wid, filter) => g(`${W(wid)}/threads`, { filter }),
  thread: (wid, tid) => g(`${W(wid)}/threads/${tid}`),
  draft: (wid, tid, instruction) => p(`${W(wid)}/threads/${tid}/draft`, { instruction }),
  send: (wid, tid, body, to) => p(`${W(wid)}/threads/${tid}/send`, { body, to }),
  newMessage: (wid, body) => p(`${W(wid)}/messages`, body),
  messageTemplates: (wid) => g(`${W(wid)}/message-templates`),

  /* ask */
  ask: (wid, question, scope) => p(`${W(wid)}/ask`, { question, scope }),
  askHistory: (wid) => g(`${W(wid)}/ask/history`),
  askItem: (wid, qid) => g(`${W(wid)}/ask/${qid}`),
  askFeedback: (wid, qid, body) => p(`${W(wid)}/ask/${qid}/feedback`, body),

  /* timeline */
  timeline: (wid, params) => g(`${W(wid)}/timeline`, params),
  event: (wid, eid) => g(`${W(wid)}/timeline/${eid}`),
  restoreEvent: (wid, eid) => p(`${W(wid)}/timeline/${eid}/restore`),
  exportTimeline: (wid, body) => p(`${W(wid)}/timeline/export`, body),

  /* sources */
  sources: (wid) => g(`${W(wid)}/sources`),
  source: (wid, sid) => g(`${W(wid)}/sources/${sid}`),
  updateSource: (wid, sid, body) => pa(`${W(wid)}/sources/${sid}`, body),
  syncSource: (wid, sid) => p(`${W(wid)}/sources/${sid}/sync`),
  pauseSource: (wid, sid) => p(`${W(wid)}/sources/${sid}/pause`),
  resumeSource: (wid, sid) => p(`${W(wid)}/sources/${sid}/resume`),
  reconnectSource: (wid, sid) => p(`${W(wid)}/sources/${sid}/reconnect`),
  reconnected: (wid, sid) => p(`${W(wid)}/sources/${sid}/reconnected`),
  disconnectSource: (wid, sid, keep_memory) => p(`${W(wid)}/sources/${sid}/disconnect`, { keep_memory }),
  addThreads: (wid, sid, ids) => p(`${W(wid)}/sources/${sid}/threads`, { ids }),
  stopReading: (wid, sid, tid, keep) => del(`${W(wid)}/sources/${sid}/threads/${tid}`, { keep: keep ? "1" : "0" }),
  candidates: (wid, provider) => g(`${W(wid)}/sources/candidates/${provider}`),
  addSource: (wid, provider, ids) => p(`${W(wid)}/sources/add`, { provider, ids }),
  addNote: (wid, title, text) => p(`${W(wid)}/notes`, { title, text }),
  acceptNote: (wid, nid, items) => p(`${W(wid)}/notes/${nid}/accept`, { items }),

  /* files */
  files: (wid) => g(`${W(wid)}/files`),
  file: (wid, fid) => g(`${W(wid)}/files/${fid}`),
  uploadFile: (wid, meta) => p(`${W(wid)}/files`, meta),
  deleteFile: (wid, fid, keep) => del(`${W(wid)}/files/${fid}`, { keep: keep ? "1" : "0" }),

  /* members */
  members: (wid) => g(`${W(wid)}/members`),
  invite: (wid, emails, role, message) => p(`${W(wid)}/members/invite`, { emails, role, message }),
  updateMember: (wid, mid, body) => pa(`${W(wid)}/members/${mid}`, body),
  removeMember: (wid, mid) => del(`${W(wid)}/members/${mid}`),
  resendInvite: (wid, mid) => p(`${W(wid)}/members/${mid}/resend`),
  invite_: (token) => g(`/v2/invites/${token}`),
  acceptInvite: (token) => p(`/v2/invites/${token}/accept`),

  /* account */
  sessions: () => g("/v2/me/sessions"),
  signOutOthers: () => p("/v2/me/sessions/sign-out-others"),
  notificationPrefs: () => g("/v2/me/notifications"),
  updateNotificationPrefs: (body) => pa("/v2/me/notifications", body),
  exportAccount: () => p("/v2/me/export"),
  deleteAccount: (confirm) => del("/v2/me", null, { confirm }),
  forgotPassword: (email) => p("/v2/auth/password/forgot", { email }),
  resetPassword: (token, password) => p("/v2/auth/password/reset", { token, password }),
  contact: (body) => p("/v2/contact", body),

  /* billing */
  billing: () => g("/v2/billing"),
  checkout: (plan, currency) => p("/v2/billing/checkout", { plan, currency }),
  changePlan: (plan) => p("/v2/billing/change", { plan }),
  cancel: (reason, note) => p("/v2/billing/cancel", { reason, note }),
  resume: () => p("/v2/billing/resume"),
  retryPayment: () => p("/v2/billing/retry"),

  /* updates + search */
  updates: () => g("/v2/updates"),
  readUpdates: (ids) => p("/v2/updates/read", { ids }),
  search: (wid, q) => g(`${W(wid)}/search`, { q }),

  /* mock-only */
  scenario: () => g("/__mock/scenario"),
  setScenario: (name) => p("/__mock/scenario", { name }),
};

export const errCode = (e) => e?.response?.data?.code;
export const errStatus = (e) => e?.response?.status;
