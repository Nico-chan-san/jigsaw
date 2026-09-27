import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import sqliteApi from './server/api.js'

export default defineConfig({
  plugins: [react(), sqliteApi({ file: 'data/puzzle.db' })],
  server: { watch: { ignored: ['**/data/**'] } },
})
