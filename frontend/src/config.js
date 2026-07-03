// Dynamic configuration for local vs production environments
export const BACKEND_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000`;
