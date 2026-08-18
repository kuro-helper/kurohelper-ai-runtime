/**
 * KuroHelper AI Runtime configuration.
 *
 * User-facing deployment settings live in the repository-level .env file.
 * Discord credentials remain exclusively in the separate kurohelper project.
 */

const { createEnvConfig } = require("./env-config");

module.exports = createEnvConfig();
