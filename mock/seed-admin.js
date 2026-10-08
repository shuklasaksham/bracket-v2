/* Admin panel test credentials — LOCAL MOCK ONLY.
   username: owner
   password: bracket-admin-local
   The real backend never ships credentials: it reads ADMIN_USERNAME and a
   bcrypt ADMIN_PASSWORD_HASH from the environment (see backend/admin_v2.py and
   `python backend/scripts/admin_hash.py`). The mock accepts the same env vars
   (MOCK_ADMIN_USERNAME / MOCK_ADMIN_PASSWORD_HASH, scrypt format below) so you
   can test your own values. */
module.exports = {
  username: process.env.MOCK_ADMIN_USERNAME || "owner",
  password_hash: process.env.MOCK_ADMIN_PASSWORD_HASH || "scrypt$56c52f6e12c5c1ef90ee67ad492f4c9b$27e960fda78c47a946bf3a7ec5117b643ecfa03f7eb9ffb857c93298c6473d30",
};
