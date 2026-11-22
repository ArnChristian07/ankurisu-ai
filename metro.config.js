const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Workaround for NativeWind (react-native-css-interop) triggering React Native 0.88+
// ImageBackground deprecation getter warning on startup.
const interopComponentsPath = path.join(
  __dirname,
  "node_modules",
  "react-native-css-interop",
  "dist",
  "runtime",
  "components.js"
);
if (fs.existsSync(interopComponentsPath)) {
  const content = fs.readFileSync(interopComponentsPath, "utf8");
  const patched = content.replace(
    /\(0,\s*api_1\.remapProps\)\(react_native_1\.ImageBackground,\s*\{[\s\S]*?\}\);\r?\n?/,
    ""
  );
  if (patched !== content) {
    fs.writeFileSync(interopComponentsPath, patched, "utf8");
  }
}

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
