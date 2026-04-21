const { createProxyMiddleware } = require("http-proxy-middleware");

const BACKEND = "http://127.0.0.1:8002";

module.exports = function (app) {
  // HTTP API
  app.use(
    "/api",
    createProxyMiddleware({
      target: BACKEND,
      changeOrigin: true,
      ws: false,
    })
  );
  // WebSockets (MP2 + any future /ws/*)
  app.use(
    "/ws",
    createProxyMiddleware({
      target: BACKEND,
      changeOrigin: true,
      ws: true,
      logLevel: "warn",
    })
  );
};
