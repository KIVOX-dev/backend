# Calling the Node API from the Frontend (Axios)

This backend never talks to the frontend's tech stack directly — it only exposes REST/JSON over
HTTP, guarded by CORS (`CORS_ORIGINS` in `.env.node`). The frontend (whatever it is — the existing
Next.js app in `D:\Upscaler-Frontend`, or a future Vite app) should call it exactly like any other
external API. Nothing below requires touching the frontend project; copy what's useful into it.

## 1. Axios client with auth + refresh

```ts
// lib/apiClient.ts
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL, // e.g. http://localhost:5000/api/v1
  withCredentials: false, // JWTs are sent via Authorization header, not cookies
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Silently refresh once on a 401, then retry the original request.
let refreshing: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      refreshing ??= axios
        .post(`${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`, {
          refreshToken: localStorage.getItem('refreshToken'),
        })
        .then(({ data }) => {
          localStorage.setItem('accessToken', data.data.accessToken);
          localStorage.setItem('refreshToken', data.data.refreshToken);
          return data.data.accessToken;
        })
        .finally(() => {
          refreshing = null;
        });
      const token = await refreshing;
      original.headers.Authorization = `Bearer ${token}`;
      return apiClient(original);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

## 2. Environment variable (frontend side)

```
# .env.local (Next.js) or .env (Vite)
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1   # Next.js
VITE_API_URL=http://localhost:5000/api/v1          # Vite — use import.meta.env.VITE_API_URL instead
```

## 3. Example calls

```ts
// Login
const { data } = await apiClient.post('/auth/login', { email, password });
localStorage.setItem('accessToken', data.data.accessToken);
localStorage.setItem('refreshToken', data.data.refreshToken);

// Google login (send the Google Identity Services credential/idToken to the backend —
// the backend verifies it server-side; never trust a decoded profile from the client)
const { data } = await apiClient.post('/auth/google', { idToken: googleCredential });

// Authenticated request
const { data } = await apiClient.get('/students', { params: { page: 1, limit: 20 } });

// Create (role-guarded server-side; a 403 means the logged-in role can't do this)
await apiClient.post('/placements', {
  company_id, institution_id, title, job_type: 'full_time', status: 'open',
});
```

## 4. CORS

The backend only accepts requests from origins listed in `CORS_ORIGINS` (`.env.node`). Add every
frontend origin you actually use:

```
CORS_ORIGINS=http://localhost:5173,http://localhost:3000,https://your-frontend.example.com
```

Requests from any other origin are rejected before they reach a route handler.
