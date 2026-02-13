# Screen Summary Web

Astro website that shows the latest rows from the Supabase `messages` table.

## Setup

```bash
cd /Users/bryanchew/Desktop/Development/otherbryan/web
npm install
```

Create `.env`:

```bash
cp .env.example .env
```

Fill in:

```
SUPABASE_URL=http://89.167.51.65:8000
SUPABASE_ANON_KEY=your-anon-key
```

Run locally:

```bash
npm run dev
```

## API

The web client fetches from the Astro API route:

```
GET /api/messages?limit=20
```

## Query

```sql
select id, input_text, output_text, created_at
from messages
order by created_at desc
limit 20;
```
