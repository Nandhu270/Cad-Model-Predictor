import React, { useState, useMemo } from "react";

export default function InstrumentTable({
  instruments = [],
  onSelect = () => {},
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState("tag");
  const [sortDir, setSortDir] = useState("asc");

  const items = Array.isArray(instruments) ? instruments : [];

  const filtered = useMemo(() => {
    const f = (filter || "").trim().toLowerCase();
    let arr = items.slice();

    if (f) {
      arr = arr.filter((i) => {
        const tag = (i?.tag || i?.Tag || "").toString().toLowerCase();
        const type = (i?.type || i?.Type || "").toString().toLowerCase();
        return tag.includes(f) || type.includes(f);
      });
    }

    arr.sort((a, b) => {
      let va = a?.[sortKey] ?? a?.[sortKey?.toLowerCase?.()] ?? "";
      let vb = b?.[sortKey] ?? b?.[sortKey?.toLowerCase?.()] ?? "";
      if (typeof va === "object") va = JSON.stringify(va);
      if (typeof vb === "object") vb = JSON.stringify(vb);
      va = (va ?? "").toString();
      vb = (vb ?? "").toString();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return arr;
  }, [items, filter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          placeholder="Filter tag/type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            padding: 8,
            borderRadius: 8,
            border: "1px solid #e6eefc",
          }}
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          style={{ padding: 8, borderRadius: 8 }}
        >
          <option value="tag">Tag</option>
          <option value="type">Type</option>
          <option value="pipe_diameter_mm">Diameter</option>
        </select>
      </div>

      <table
        className="inst-table"
        style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}
      >
        <thead>
          <tr>
            <th
              onClick={() => toggleSort("tag")}
              style={{ textAlign: "left", padding: 8, color: "#6b7280" }}
            >
              Tag
            </th>
            <th
              onClick={() => toggleSort("type")}
              style={{ textAlign: "left", padding: 8, color: "#6b7280" }}
            >
              Type
            </th>
            <th style={{ textAlign: "left", padding: 8, color: "#6b7280" }}>
              Upstream
            </th>
            <th style={{ textAlign: "left", padding: 8, color: "#6b7280" }}>
              Downstream
            </th>
            <th style={{ textAlign: "left", padding: 8, color: "#6b7280" }}>
              Orientation
            </th>
          </tr>
        </thead>

        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: 12, color: "#6b7280" }}>
                No instruments found.
              </td>
            </tr>
          ) : (
            filtered.map((ins, idx) => {
              const stableId =
                (ins &&
                  (ins.GlobalId || (ins.raw && ins.raw.GlobalId) || ins.tag)) ||
                `inst-${idx}`;
              const uniqueKey = `${String(stableId)}-${idx}`;

              const upPass =
                (ins.pass_fail && ins.pass_fail.upstream) ??
                (ins.passFail && ins.passFail.upstream) ??
                !!ins.upstream_pass;
              const downPass =
                (ins.pass_fail && ins.pass_fail.downstream) ??
                (ins.passFail && ins.passFail.downstream) ??
                !!ins.downstream_pass;
              const orient =
                ins.orientation &&
                typeof ins.orientation.vertical_pass !== "undefined"
                  ? ins.orientation.vertical_pass
                  : typeof ins.orientation?.tilt_deg === "number"
                  ? Math.abs(ins.orientation.tilt_deg) <= 3
                  : true;

              const rowClass = upPass && downPass && orient ? "" : "row-fail";

              return (
                <tr
                  key={uniqueKey}
                  className={rowClass}
                  onClick={() => onSelect(ins)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ padding: 10 }}>
                    {ins.tag ?? `INST-${idx + 1}`}
                  </td>
                  <td style={{ padding: 10 }}>{ins.type ?? "-"}</td>
                  <td style={{ padding: 10 }}>
                    {typeof ins.measured?.upstream_m === "number"
                      ? ins.measured.upstream_m.toFixed(3)
                      : "-"}{" "}
                    m{" "}
                    <span
                      className={`pill ${upPass ? "pill-ok" : "pill-bad"}`}
                      style={{ marginLeft: 8 }}
                    >
                      {upPass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td style={{ padding: 10 }}>
                    {typeof ins.measured?.downstream_m === "number"
                      ? ins.measured.downstream_m.toFixed(3)
                      : "-"}{" "}
                    m{" "}
                    <span
                      className={`pill ${downPass ? "pill-ok" : "pill-bad"}`}
                      style={{ marginLeft: 8 }}
                    >
                      {downPass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td style={{ padding: 10 }}>
                    {typeof ins.orientation?.tilt_deg === "number"
                      ? `${ins.orientation.tilt_deg}°`
                      : "-"}{" "}
                    <span
                      className={`pill ${orient ? "pill-ok" : "pill-bad"}`}
                      style={{ marginLeft: 8 }}
                    >
                      {orient ? "OK" : "FIX"}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
