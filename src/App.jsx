import React, { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Dropzone from "react-dropzone";
import InstrumentTable from "./components/InstrumentTable";
import DetailsPanel from "./components/DetailsPanel";
import { API_BASE } from "./config";
import IfcBrowserViewer from "./components/IfcBrowserViewer";

export default function App() {
  const [file, setFile] = useState(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pollIntervalMs, setPollIntervalMs] = useState(2000);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const canvasRef = useRef();
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function requestAiSummary() {
    if (!report || !report.instruments) return;
    setAiLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ai/summarize-instruments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruments: report.instruments }),
      });
      const j = await res.json();
      if (!j.ok) {
        console.error("AI summary failed", j);
        setAiSummary({ error: j.error, raw: j.raw || null });
      } else {
        setAiSummary(j.ai_result);
      }
    } catch (err) {
      setAiSummary({ error: err.message });
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    if (!file) {
      if (uploadedFileUrl) {
        try {
          URL.revokeObjectURL(uploadedFileUrl);
        } catch (e) {}
        setUploadedFileUrl(null);
      }
      return;
    }

    if (!(file instanceof Blob) && !(file instanceof File)) {
      console.warn("Selected `file` is not a Blob/File:", file);
      return;
    }

    const url = URL.createObjectURL(file);
    setUploadedFileUrl(url);

    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    };
  }, [file]);

  const startAnalysis = useCallback(async () => {
    setError(null);
    if (!file) {
      setError("Please choose an IFC file first.");
      return;
    }

    setUploadPct(0);
    setJobId(null);
    setJobStatus("queued");
    setReport(null);
    setSelected(null);

    const form = new FormData();
    form.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    const endpoint = `${API_BASE.replace(/\/$/, "")}/analyze-model-async`;

    try {
      xhr.open("POST", endpoint, true);
      xhr.responseType = "json";
      xhr.timeout = 120000;

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setUploadPct(pct);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const resp =
            xhr.response ??
            (() => {
              try {
                return JSON.parse(xhr.responseText);
              } catch (e) {
                return null;
              }
            })();

          if (resp && resp.job_id) {
            setUploadPct(100);
            setJobId(resp.job_id);
            setJobStatus(resp.status || "queued");
          } else {
            setError(
              "Invalid response from server (no job_id). See console for details."
            );
            console.warn(
              "Invalid server response:",
              xhr.response,
              xhr.responseText
            );
          }
        } else {
          let errDetail = "";
          try {
            if (xhr.response && typeof xhr.response === "object")
              errDetail = JSON.stringify(xhr.response);
            else
              errDetail = xhr.responseText || `${xhr.status} ${xhr.statusText}`;
          } catch (e) {
            errDetail = `${xhr.status} ${xhr.statusText}`;
          }
          setError(`Upload failed: ${errDetail}`);
          console.error("Upload failed:", errDetail);
        }
      };

      xhr.onerror = (ev) => {
        console.error("XHR network error", ev);
        setError(
          "Network error during upload. Check backend is running and CORS is configured."
        );
      };

      xhr.ontimeout = () => {
        console.error("XHR timeout");
        setError(
          "Upload timed out. Try increasing xhr.timeout or use the async job endpoint."
        );
      };

      xhr.onabort = () => {
        console.warn("XHR aborted by client");
        setError("Upload aborted.");
      };

      xhr.send(form);
    } catch (err) {
      console.error("startAnalysis throwable error:", err);
      setError("Upload failed: " + (err?.message || String(err)));
    }
  }, [file, API_BASE]);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    setIsPolling(true);

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/jobs/${jobId}`);
        if (!res.ok) {
          setError(`Job status error: ${res.status}`);
          setIsPolling(false);
          return;
        }
        const j = await res.json();
        setJobStatus(j.status);
        if (j.status === "done") {
          setReport(j.result);
          setIsPolling(false);
          setJobId(null);
        } else if (j.status === "failed") {
          setError(j.error || "Job failed");
          setIsPolling(false);
          setJobId(null);
        } else {
          if (!stopped) setTimeout(poll, pollIntervalMs);
        }
      } catch (err) {
        setError("Polling error: " + err.message);
        setIsPolling(false);
      }
    };

    poll();

    return () => {
      stopped = true;
      setIsPolling(false);
    };
  }, [jobId, pollIntervalMs]);

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ifc-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>IFC Flow Instrument Inspector</h1>
          <p className="tagline">Upload IFC → automated checks → JSON report</p>
        </div>

        <div className="actions">
          <Dropzone
            onDropAccepted={(accepted) => setFile(accepted[0])}
            maxFiles={1}
            accept={{ "application/octet-stream": [".ifc"] }}
          >
            {({ getRootProps, getInputProps, isDragActive }) => (
              <div
                {...getRootProps()}
                className={`file-drop ${isDragActive ? "active" : ""}`}
              >
                <input {...getInputProps()} />
                <div className="file-drop-text">
                  {file
                    ? file.name
                    : "Drag & drop .ifc here or click to select"}
                </div>
              </div>
            )}
          </Dropzone>

          <div className="controls-row">
            <button
              className="btn primary"
              onClick={startAnalysis}
              disabled={!file || isPolling}
            >
              {isPolling ? "Analyzing..." : "Start Analysis"}
            </button>
            <button
              className="btn outline"
              onClick={downloadReport}
              disabled={!report}
            >
              Export JSON
            </button>
          </div>
        </div>
      </header>

      <main className="grid">
        <section className="left-card">
          <div className="card-header">
            <h3>3D Viewer</h3>
            <div className="small-muted">
              {jobStatus
                ? `Job status: ${jobStatus}`
                : uploadPct
                ? `Upload ${uploadPct}%`
                : "No analysis yet"}
            </div>
          </div>

          <div className="viewer">
            <IfcBrowserViewer
              key={uploadedFileUrl || "no-ifc"}
              fileUrl={uploadedFileUrl}
            />
          </div>

          <div className="card-footer">
            <div>
              <strong>Upload Progress:</strong>
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            </div>

            <div>
              <label>Poll interval (ms)</label>
              <input
                type="number"
                value={pollIntervalMs}
                onChange={(e) =>
                  setPollIntervalMs(Number(e.target.value) || 2000)
                }
              />
            </div>
          </div>
        </section>

        <aside className="right-card">
          <div className="card-header">
            <h3>Instruments</h3>
            <div className="small-muted">Click a marker or row to inspect</div>
          </div>

          <div className="table-wrapper">
            <InstrumentTable
              instruments={report ? report.instruments : []}
              onSelect={(ins) => setSelected(ins)}
            />
          </div>

          <div className="details-area">
            <AnimatePresence>
              <motion.div
                key={selected ? selected.tag : "empty"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <DetailsPanel instrument={selected} />
              </motion.div>
            </AnimatePresence>
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              className="btn outline"
              onClick={requestAiSummary}
              disabled={!report || aiLoading}
            >
              {aiLoading ? "Analyzing…" : "AI Summary"}
            </button>

            {aiSummary && (
              <div
                className="ai-summary card"
                style={{ marginTop: 10, padding: 10 }}
              >
                {aiSummary.error ? (
                  <pre>{aiSummary.error}</pre>
                ) : (
                  <>
                    <div>
                      <strong>Total instruments:</strong>{" "}
                      {aiSummary.total_instruments}
                    </div>
                    <div>
                      <strong>By type:</strong>
                      <ul>
                        {(aiSummary.by_type || []).map((t, i) => (
                          <li key={i}>
                            {t.type}: {t.count}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <strong>Failures:</strong>
                      {(aiSummary.failures || []).length === 0 ? (
                        <div>None detected</div>
                      ) : (
                        <ul>
                          {(aiSummary.failures || []).map((f, idx) => (
                            <li key={idx}>
                              <strong>{f.tag}</strong> ({f.type}) — issues:{" "}
                              {f.issues.join(", ")}
                              <div style={{ fontSize: 12, color: "#666" }}>
                                {JSON.stringify(f.details)}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <strong>Recommendations:</strong>
                      <ol>
                        {(aiSummary.summary_recommendations || []).map(
                          (r, i) => (
                            <li key={i}>{r}</li>
                          )
                        )}
                      </ol>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {error && <div className="error">{error}</div>}
        </aside>
      </main>

      <footer className="footer">
        <div>Built with React • Upload size limits depend on your backend.</div>
      </footer>
    </div>
  );
}
