import React from "react";

export default function DetailsPanel({ instrument }) {
  if (!instrument) {
    return (
      <div className="details-card">
        <h4>No instrument selected</h4>
        <p className="small-muted">
          Click a marker in the 3D view or a row in the table to inspect an
          instrument.
        </p>
      </div>
    );
  }

  return (
    <div className="details-card">
      <h4>{instrument.tag}</h4>
      <div className="small-muted">{instrument.type}</div>

      <div style={{ marginTop: 10 }}>
        <strong>Location</strong>
        <div className="muted">
          {(instrument.location || [])
            .map((n) => n.toFixed?.(3) ?? n)
            .join(", ") || "-"}
        </div>

        <strong style={{ marginTop: 8 }}>Pipe Ø</strong>
        <div className="muted">{instrument.pipe_diameter_mm ?? "-"} mm</div>

        <strong style={{ marginTop: 8 }}>Measured</strong>
        <div className="muted">
          Upstream: {instrument.measured?.upstream_m} m
        </div>
        <div className="muted">
          Downstream: {instrument.measured?.downstream_m} m
        </div>

        <strong style={{ marginTop: 8 }}>Orientation</strong>
        <div className="muted">Tilt: {instrument.orientation?.tilt_deg}°</div>
        <div className="muted">
          Vertical: {instrument.orientation?.vertical_pass ? "Yes" : "No"}
        </div>

        {instrument.suggestions && instrument.suggestions.length > 0 && (
          <>
            <strong style={{ marginTop: 8 }}>Suggestions</strong>
            <ul className="suggestions">
              {instrument.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
