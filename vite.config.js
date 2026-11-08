import { defineConfig } from "vite";

function nonBlockingBuildCss() {
  return {
    name: "non-blocking-build-css",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(
          /<link\s+rel="stylesheet"([^>]*href="[^"]+\.css"[^>]*)>/g,
          (tag, attrs) => {
            const href = attrs.match(/href="([^"]+)"/)?.[1];
            if (!href) return tag;
            const crossorigin = attrs.match(/crossorigin(?:="([^"]*)")?/)?.[0] || "";
            return '<link rel="preload" as="style" href="' + href + '" ' + crossorigin +
              ' onload="this.onload=null;this.rel=\'stylesheet\'">' +
              '<noscript><link rel="stylesheet" href="' + href + '" ' + crossorigin + '></noscript>';
          }
        );
      }
    }
  };
}

export default defineConfig({
  plugins: [nonBlockingBuildCss()],
  build: { outDir: "dist" }
});
