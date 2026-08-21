import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  dts: false,
  sourcemap: true,
  // The shebang in src/cli.ts survives, but the bit does not; `bin` needs it.
  banner: {},
  onSuccess: "chmod +x dist/cli.js",
});
