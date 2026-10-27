---
title: AI Study Assistant API
emoji: 📚
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 8000
pinned: false
---

Backend API for the AI Study Assistant. Configure secrets in the Space settings
(GROQ_API_KEY, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, DATABASE_URL, ALLOWED_ORIGINS, optional TAVILY_API_KEY).
DATABASE_URL must be a hosted Postgres (e.g. Neon): the Space's own disk is wiped on restart.
