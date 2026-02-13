# iOS Screenshot Uploader

Node.js Express server that receives iOS Shortcut screenshots + text, sends them to GPT-5-mini, stores text in Supabase, and removes uploaded images.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Create a Supabase table:

```sql
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_text text,
  output_text text
);
```

4. Run the server:

```bash
npm run dev
```

Server listens on `http://localhost:4000`.

## iOS Shortcut Notes

- POST to `http://<your-mac-ip>:4000/upload`
- Send text field named `text`
- Attach screenshots as files (any field name)

## Supabase + OpenAI initialization

- `OPENAI_API_KEY` in `.env`
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (recommended for server-side writes)

## Response

The endpoint returns:

```json
{ "output": "..." }
```
