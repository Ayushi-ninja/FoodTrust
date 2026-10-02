export default function Home() {
  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: "800px", margin: "0 auto", textAlign: "center" }}>
      <h1 style={{ color: "#b30000", fontSize: "2.2rem" }}>FoodTrust Backend Platform</h1>
      <p style={{ color: "#555", fontSize: "1.1rem", marginTop: "0.5rem" }}>
        AI + IoT Smart Food Waste Monitoring &amp; Redistribution System
      </p>

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
        <a
          href="/index.html"
          style={{
            padding: "0.75rem 1.5rem",
            background: "#b30000",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: 600,
          }}
        >
          Explore Web Portal
        </a>
        <a
          href="/api/health"
          style={{
            padding: "0.75rem 1.5rem",
            background: "#222",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: 600,
          }}
        >
          Check API Health
        </a>
      </div>
    </main>
  );
}
