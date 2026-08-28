import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    // cloudflared のクイックトンネル経由でモバイル実機から動作確認するために許可
    allowedHosts: [".trycloudflare.com"],
  },
  build: {
    // 警告の閾値を 2000kB (2MB) に設定して警告を非表示にする
    chunkSizeWarningLimit: 2000,

    // ファイル名にハッシュを含めない。dist/ を配布先へ上書きコピーするだけで
    // 更新できるようにするため（ハッシュ付きだとビルドの度にファイル名が変わり、
    // 古いファイルを消せない環境では配布先にゴミが溜まってしまう）。
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});

