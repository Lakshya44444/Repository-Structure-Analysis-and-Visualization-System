import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend URL can be overridden with VITE_API_BASE at build/dev time.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
