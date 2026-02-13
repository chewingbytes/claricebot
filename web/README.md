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
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
```

Run locally:

```bash
npm run dev
```

## Query

```sql
select id, input_text, output_text, created_at
from messages
order by created_at desc
limit 20;
```
