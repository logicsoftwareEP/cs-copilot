/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Figtree', 'sans-serif'],
      },
      colors: {
        bv: {
          primary:   '#6955ED',
          hover:     '#523FCB',
          active:    '#3C2BA9',
          light:     '#E4E2FB',
          xlight:    '#F1F2FE',
          secondary: '#D9ED54',
          ink:       '#26262B',
          body:      '#4A4A54',
          muted:     '#6F6F80',
          subtle:    '#A1A1B2',
          border:    '#DEDEE5',
          divider:   '#EDEDF2',
          surface:   '#F7F7FC',
        },
      },
    },
  },
  plugins: [],
};
