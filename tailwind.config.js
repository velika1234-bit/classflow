/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        outfit: ['Outfit', 'sans-serif'],
      },
      colors: {
        bg: '#0f0f14',
        bg2: '#1a1a24',
        bg3: '#242430',
        surface: '#2e2e3d',
        accent: '#7c5cfc',
        accent2: '#5c8dfc',
      },
    },
  },
  plugins: [],
}
