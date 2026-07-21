import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], build:{ rollupOptions:{ input:{floating:'floating.html',chat:'chat.html'} } } });