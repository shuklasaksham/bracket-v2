/* Dev server only: forward /api to a backend. Defaults to the mock API
   (`node mock/server.js`, port 4300). Point it at the real FastAPI backend with
   API_PROXY=http://localhost:8001 npm start. */
const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function setupProxy(app) {
  const target = process.env.API_PROXY || "http://localhost:4300";
  app.use("/api", createProxyMiddleware({ target, changeOrigin: true, pathRewrite: (p) => (p.startsWith("/api") ? p : `/api${p}`) }));
};
