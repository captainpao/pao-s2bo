/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Remap Tailwind blue to SC Blue palette
        blue: {
          50:  '#EBF5FF',
          100: '#C3DEFA',
          200: '#9BC9F8',
          300: '#7BB6F5',
          400: '#4F9DF0',
          500: '#0473EA',
          600: '#0473EA',   // SC Blue primary
          700: '#0061C7',   // SC Blue hover/pressed
          800: '#2C3A87',   // SC Navy
          900: '#2C3A87',
        },
      },
      fontFamily: {
        sans: ['"SC Prosper Sans"', 'Helvetica', 'Arial', '"Lucida Grande"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
