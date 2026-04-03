# PG Network V2

Performance Golf -- Networking Intelligence. Clean rebuild.

## Setup

```bash
cd v2
npm install
cp .env.example .env.local
# Fill in your API keys in .env.local
npm run dev
```

## Architecture

- **Next.js 15** (App Router) + **Tailwind CSS** + **Supabase**
- 3-panel layout: Research Hub | Outreach + Follow-ups | Lead Database
- Persistent command bar (bottom, always visible)
- PIN auth (PG26)
- Single Brand DNA source (`/lib/brand-dna.ts`)
- Post-generation message linter (`/lib/validate.ts`)

## Deploy

```bash
vercel deploy
```
