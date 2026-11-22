/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./context/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Mirrors constants/theme.ts (HUD)
        hud: {
          bg: "#04070D",
          panel: "#08121E",
          line: "#123049",
          lineDim: "#0B1D2D",
          holo: "#4FD8FF",
          holoDim: "#2A86AD",
          crimson: "#E8344E",
          nixie: "#FF9B3D",
          ok: "#3BE3A4",
          warn: "#FFB547",
          text: "#EAF6FF",
          textMuted: "#7F9BB3",
          textDim: "#4A6378",
        },
      },
    },
  },
  plugins: [],
};
