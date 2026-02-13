export async function GET({ request }) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || 20;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const endpoint = `${supabaseUrl}/rest/v1/messages?select=id,input_text,output_text,created_at&order=created_at.desc&limit=${limit}`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      return new Response(
        JSON.stringify({ error: "Supabase request failed", detail }),
        { status: response.status, headers: { "content-type": "application/json" } }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Request failed", detail: String(error) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
