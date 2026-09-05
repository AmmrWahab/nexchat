// Central backend URL config.
// Local dev uses http://localhost:5000 (default).
// For a deployed/production build, set VITE_API_URL to your live backend,
// e.g. VITE_API_URL=https://nexchat-xg2v.onrender.com
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export { API_URL };
