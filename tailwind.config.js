/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/webview/**/*.{tsx,ts}"],
  theme: {
    extend: {
      colors: {
        coop: {
          accent: "#3B82F6"
        }
      }
    }
  },
  plugins: []
};
