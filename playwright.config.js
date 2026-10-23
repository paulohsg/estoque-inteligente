// Configuração dos testes automáticos (Playwright + Chromium)
const { defineConfig } = require("@playwright/test");
const path = require("path");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        // Câmera falsa: o Chromium "vê" um código de barras gravado em vídeo
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${path.join(__dirname, "tests/fixtures/camera-ean.mjpeg")}`
      ]
    }
  }
});
