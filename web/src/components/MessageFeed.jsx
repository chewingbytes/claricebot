import { useEffect, useState } from "react";

const API_BASE_URL = "https://clarice.singaporewebsitesagain.com";

export default function MessageFeed() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLatest = async () => {
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/messages?limit=20`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to load messages");
      }

      const payload = await response.json();
      setRows(payload.data || []);
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
