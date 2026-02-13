import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function MessageFeed() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLatest = async () => {
    setError("");
    try {
      const { data, error: fetchError } = await supabase
        .from("messages")
        .select("id, input_text, output_text, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      if (fetchError) {
        throw fetchError;
      }

      setRows(data || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLatest();
  }, []);

  if (loading) {
    return <div className="empty">Loading...</div>;
  }

  return (
    <>
      {error.length > 0 ? <div className="error">{error}</div> : null}
      {rows.length === 0 ? (
        <div className="empty">No messages yet.</div>
      ) : (
        <div className="grid">
          {rows.map((row) => (
            <article className="card" key={row.id}>
              <div className="timestamp">
                {new Date(row.created_at).toLocaleString()}
              </div>
              <div className="label">Input</div>
              <div className="body">{row.input_text || "(empty)"}</div>
              <div className="label">Output</div>
              <div className="body">{row.output_text || "(empty)"}</div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
