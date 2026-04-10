// craco.config.js
const path = require("path");
const fs = require("fs");
const dotenvParse = require("dotenv").parse;

// Read .env directly from disk so OS-level env vars cannot override it
const envFromFile = fs.existsSync(path.resolve(__dirname, ".env"))
  ? dotenvParse(fs.readFileSync(path.resolve(__dirname, ".env")))
  : {};

// Apply to process.env with override so CRA picks up our values
require("dotenv").config({ override: true });

// Check if we're in development/preview mode (not production build)
// Craco sets NODE_ENV=development for start, NODE_ENV=production for build
const isDevServer = process.env.NODE_ENV !== "production";

// Environment variable overrides
const config = {
  enableHealthCheck: process.env.ENABLE_HEALTH_CHECK === "true",
};

// Conditionally load health check modules only if enabled
let WebpackHealthPlugin;
let setupHealthEndpoints;
let healthPluginInstance;

if (config.enableHealthCheck) {
  WebpackHealthPlugin = require("./plugins/health-check/webpack-health-plugin");
  setupHealthEndpoints = require("./plugins/health-check/health-endpoints");
  healthPluginInstance = new WebpackHealthPlugin();
}

let webpackConfig = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig) => {

      // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
        ],
      };

      // Force REACT_APP_* env vars from .env file, overriding OS-level vars.
      // CRA's DefinePlugin stores all env vars under the 'process.env' key as a nested object.
      webpackConfig.plugins.forEach((plugin) => {
        if (plugin && plugin.constructor && plugin.constructor.name === "DefinePlugin" && plugin.definitions) {
          const processEnvDef = plugin.definitions["process.env"];
          if (processEnvDef && typeof processEnvDef === "object") {
            Object.keys(envFromFile).forEach((key) => {
              if (key.startsWith("REACT_APP_")) {
                processEnvDef[key] = JSON.stringify(envFromFile[key]);
              }
            });
          }
        }
      });

      // Add health check plugin to webpack if enabled
      if (config.enableHealthCheck && healthPluginInstance) {
        webpackConfig.plugins.push(healthPluginInstance);
      }
      return webpackConfig;
    },
  },
};

// Wrap with visual edits (automatically adds babel plugin, dev server, and overlay in dev mode)
if (isDevServer) {
  try {
    const { withVisualEdits } = require("@emergentbase/visual-edits/craco");
    webpackConfig = withVisualEdits(webpackConfig);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('@emergentbase/visual-edits/craco')) {
      console.warn(
        "[visual-edits] @emergentbase/visual-edits not installed — visual editing disabled."
      );
    } else {
      throw err;
    }
  }

  // Re-wrap devServer AFTER withVisualEdits so our proxy middleware is
  // prepended to the Express app BEFORE withVisualEdits' own handlers.
  // withVisualEdits intercepts POST /api/* — this defeats it.
  const { createProxyMiddleware } = require("http-proxy-middleware");
  const _veDevServer = webpackConfig.devServer;
  webpackConfig.devServer = (devServerConfig) => {
    const finalConfig =
      typeof _veDevServer === "function" ? _veDevServer(devServerConfig) : devServerConfig;

    const _veSetup = finalConfig.setupMiddlewares;
    finalConfig.setupMiddlewares = (middlewares, devServer) => {
      // prepend — runs before any withVisualEdits handler.
      // app.use('/api', ...) lets Express match only /api/* paths.
      // Express strips '/api' from req.url before passing to the middleware,
      // so pathRewrite adds it back: /saves → /api/saves.
      devServer.app.use(
        createProxyMiddleware(
          (pathname) => pathname.startsWith("/api"),
          {
            target: "http://localhost:8000",
            changeOrigin: true,
            secure: false,
            logLevel: "silent",
          }
        )
      );
      if (config.enableHealthCheck && setupHealthEndpoints && healthPluginInstance) {
        setupHealthEndpoints(devServer, healthPluginInstance);
      }
      if (_veSetup) return _veSetup(middlewares, devServer);
      return middlewares;
    };
    return finalConfig;
  };
}

module.exports = webpackConfig;
