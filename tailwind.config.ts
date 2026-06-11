import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "muted-foreground": "#64748b",
        "fengshui-red": "#9E2B25",
        "fengshui-darkgray": "#333333",
      },
      fontFamily: {
        "noto-sans-sc": ['"Noto Sans SC"', "system-ui", "sans-serif"],
        "noto-serif-sc": ['"Noto Serif SC"', "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
