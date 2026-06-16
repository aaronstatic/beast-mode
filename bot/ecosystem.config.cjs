const path = require("path");

module.exports = {
  apps: [
    {
      name: "beast-mode-discord-bot",
      script: "bot.ts",
      interpreter: "bun",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      min_uptime: "5s",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(__dirname, "..", "logs", "bot-out.log"),
      error_file: path.join(__dirname, "..", "logs", "bot-error.log"),
      merge_logs: true,
    },
  ],
};
