import { api } from "../../lib/api";

/* Admin panel API — /api/v2/admin/* (backend/admin_v2.py, mock/admin.js).
   The session is an httpOnly cookie scoped to /api/v2/admin; the browser
   never sees the token. A 401 `admin_session` anywhere signs the panel out. */
const g = (url, params) => api.get(`/v2/admin${url}`, { params }).then((r) => { bump(); return r.data; });
const p = (url, body) => api.post(`/v2/admin${url}`, body || {}).then((r) => { bump(); return r.data; });

const subs = new Set();
let expiresAt = null;
function bump() {
  expiresAt = Date.now() + 30 * 60e3; // server slides the session on every call
  subs.forEach((f) => f(expiresAt));
}
export const onSessionChange = (f) => { subs.add(f); return () => subs.delete(f); };
export const sessionExpiry = () => expiresAt;

api.interceptors.response.use((r) => r, (e) => {
  if (e?.response?.status === 401 && e.response.data?.code === "admin_session") {
    expiresAt = null;
    window.dispatchEvent(new Event("bk:admin-signed-out"));
  }
  return Promise.reject(e);
});

export const admin = {
  login: (username, password) => api.post("/v2/admin/login", { username, password }).then((r) => { bump(); return r.data; }),
  logout: () => api.post("/v2/admin/logout").then((r) => { expiresAt = null; return r.data; }),
  session: () => g("/session"),
  overview: (params) => g("/overview", params),
  users: (params) => g("/users", params),
  user: (id) => g(`/users/${id}`),
  extendTrial: (id, body) => p(`/users/${id}/extend-trial`, body),
  suspend: (id, reason) => p(`/users/${id}/suspend`, { reason }),
  unsuspend: (id) => p(`/users/${id}/unsuspend`),
  revenue: (params) => g("/revenue", params),
  usage: (params) => g("/usage", params),
  sandbox: (params) => g("/sandbox", params),
};
