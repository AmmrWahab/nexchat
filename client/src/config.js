// Central backend URL config.
// Local dev uses http://localhost:5000 (default).
// When the client is deployed (not served from localhost), it automatically
// uses the live backend. Override explicitly with VITE_API_URL if needed.
const isLocalHost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const API_URL =
  import.meta.env.VITE_API_URL ||
  (isLocalHost ? 'http://localhost:5000' : 'https://nexchat-xg2v.onrender.com');

export { API_URL };