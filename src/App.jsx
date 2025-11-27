import React, { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Dropzone from "react-dropzone";
import InstrumentTable from "./components/InstrumentTable";
import DetailsPanel from "./components/DetailsPanel";
import { API_BASE } from "./config";
import IfcBrowserViewer from "./components/IfcBrowserViewer";
import "./App.css";

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
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [chatHistory, setChatHistory] = useState([]); 
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

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
        } catch {}
        setUploadedFileUrl(null);
      }
      return;
    }
    if (!(file instanceof Blob) && !(file instanceof File)) return;
    const url = URL.createObjectURL(file);
    setUploadedFileUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {}
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
              } catch {
                return null;
              }
            })();

          if (resp && resp.job_id) {
            setUploadPct(100);
            setJobId(resp.job_id);
            setJobStatus(resp.status || "queued");
          } else {
            setError("Invalid response from server (no job_id). See console.");
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
          } catch {
            errDetail = `${xhr.status} ${xhr.statusText}`;
          }
          setError(`Upload failed: ${errDetail}`);
          console.error("Upload failed:", errDetail);
        }
      };

      xhr.onerror = () => {
        setError("Network error during upload. Check backend and CORS.");
      };

      xhr.ontimeout = () => {
        setError("Upload timed out.");
      };

      xhr.onabort = () => {
        setError("Upload aborted.");
      };

      xhr.send(form);
    } catch (err) {
      setError("Upload failed: " + (err?.message || String(err)));
    }
  }, [file]);

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

  async function sendChatQuestion(questionText) {
    if (!questionText || !report) return;
    setChatLoading(true);
    setChatHistory((h) => [...h, { role: "user", text: questionText }]);
    try {
      const payload = {
        report: report,
        question: questionText,
        history: chatHistory || [],
      };
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) {
        const errText = j.error || JSON.stringify(j);
        setChatHistory((h) => [
          ...h,
          { role: "assistant", text: `Error: ${errText}` },
        ]);
      } else {
        const assistantText = j.answer || (j.raw ? String(j.raw) : "No answer");
        setChatHistory((h) => [
          ...h,
          { role: "assistant", text: assistantText },
        ]);
        if (Array.isArray(j.recommendations) && j.recommendations.length) {
          setChatHistory((h) => [
            ...h,
            {
              role: "assistant",
              text: "Recommendations:\n" + j.recommendations.join("\n- "),
            },
          ]);
        }
      }
    } catch (err) {
      setChatHistory((h) => [
        ...h,
        { role: "assistant", text: `Network error: ${err.message}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const onSendClick = async () => {
    if (!chatInput || chatInput.trim().length === 0) return;
    const q = chatInput.trim();
    setChatInput("");
    await sendChatQuestion(q);
  };

  const askAboutSelected = async () => {
    if (!selected) return;
    const q = `Explain issues and fixes for ${selected.tag || selected.Tag}.`;
    await sendChatQuestion(q);
  };

  const progressLabel = jobStatus
    ? jobStatus
    : uploadPct
    ? `Upload ${uploadPct}%`
    : "No analysis yet";

    const chatWindowRef = useRef(null);

    const handleEnterKey = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSendClick();
      }
    };

   useEffect(() => {
     const el = chatWindowRef.current;
     if (!el) return;

     const raf = requestAnimationFrame(() => {
       try {
         el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
       } catch (e) {
         el.scrollTop = el.scrollHeight;
       }
     });

     return () => cancelAnimationFrame(raf);
   }, [chatHistory, chatLoading]);


  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon" aria-hidden>
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="2"
                y="5"
                width="20"
                height="14"
                rx="3"
                fill="currentColor"
                opacity="0.12"
              />
              <path
                d="M6 12h12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="9" cy="10" r="1.2" fill="currentColor" />
              <circle cx="15" cy="14" r="1.2" fill="currentColor" />
            </svg>
          </div>

          <div>
            <h1 className="title">IFC Flow Instrument Inspector</h1>
            <p className="subtitle">
              Visualize • Validate • Improve — AI-assisted checks for piping
              instruments
            </p>
          </div>
        </div>

        <div className="header-actions">
          <div className="file-drop-cta">
            <Dropzone
              onDropAccepted={(accepted) => setFile(accepted[0])}
              maxFiles={1}
              accept={{ "application/octet-stream": [".ifc"] }}
            >
              {({ getRootProps, getInputProps, isDragActive }) => (
                <div
                  {...getRootProps()}
                  className={`drop-area ${isDragActive ? "active" : ""}`}
                >
                  <input {...getInputProps()} />
                  <span>
                    {file ? file.name : "Drop .ifc or click to upload"}
                  </span>
                </div>
              )}
            </Dropzone>
            <button
              className="btn primary"
              onClick={startAnalysis}
              disabled={!file || isPolling}
            >
              {isPolling ? "Analyzing..." : "Start Analysis"}
            </button>
            <button
              className="btn ghost"
              onClick={downloadReport}
              disabled={!report}
            >
              Export JSON
            </button>
          </div>
        </div>
      </header>

      <main className="app-main container">
        <section className="left-column">
          <div className="card viewer-card">
            <div className="card-head">
              <h3>3D Viewer</h3>
              <div className="muted">{progressLabel}</div>
            </div>

            <div className="viewer">
              <IfcBrowserViewer
                key={uploadedFileUrl || "no-ifc"}
                fileUrl={uploadedFileUrl}
              />
            </div>

            <div className="card-foot">
              <div className="upload-meta">
                <div className="progress-wrap" aria-hidden>
                  <div className="progress-track">
                    <div
                      className="progress-bar"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                  <small className="muted">{uploadPct}%</small>
                </div>

                <div className="poll-ctrl">
                  <label>Poll interval</label>
                  <input
                    type="number"
                    value={pollIntervalMs}
                    onChange={(e) =>
                      setPollIntervalMs(Number(e.target.value) || 2000)
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card instruments-card">
            <div className="card-head">
              <h3>Instruments</h3>
              <div className="muted">Click a row or marker to inspect</div>
            </div>

            <div className="table-area">
              <InstrumentTable
                instruments={report ? report.instruments : []}
                onSelect={(ins) => setSelected(ins)}
              />
            </div>
          </div>
        </section>

        <aside className="right-column">
          <div className="card details-card">
            <div className="card-head split">
              <div>
                <h3>Details</h3>
                <div className="muted">Selected instrument details</div>
              </div>
              <div className="small-actions">
                <button className="btn small" onClick={() => setSelected(null)}>
                  Clear
                </button>
              </div>
            </div>

            <div className="details-area">
              <AnimatePresence>
                <motion.div
                  key={selected ? selected.tag || selected.Tag : "empty"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                >
                  <DetailsPanel instrument={selected} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="card ai-card">
            <div className="card-head split">
              <div>
                <h3>AI Summary</h3>
                <div className="muted">
                  Quick automated review and recommendations
                </div>
              </div>
              <div>
                <button
                  className="btn small ghost"
                  onClick={requestAiSummary}
                  disabled={!report || aiLoading}
                >
                  {aiLoading ? "Working..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="ai-body">
              {aiLoading ? (
                <div className="summary-skeleton">
                  <div className="skeleton-row big"></div>
                  <div className="skeleton-row"></div>
                  <div className="skeleton-grid">
                    <div className="skeleton-box"></div>
                    <div className="skeleton-box"></div>
                    <div className="skeleton-box"></div>
                  </div>
                  <div className="skeleton-row"></div>
                  <div className="skeleton-row short"></div>
                </div>
              ) : aiSummary ? (
                aiSummary.error ? (
                  <pre className="ai-error">{aiSummary.error}</pre>
                ) : (
                  <div className="summary-grid">
                    <div className="summary-item">
                      <div className="summary-num">
                        {aiSummary.total_instruments}
                      </div>
                      <div className="summary-label">Total</div>
                    </div>

                    <div className="summary-item">
                      <div className="summary-num">
                        {(aiSummary.by_type || []).length}
                      </div>
                      <div className="summary-label">Types</div>
                    </div>

                    <div className="summary-item">
                      <div className="summary-num">
                        {(aiSummary.failures || []).length}
                      </div>
                      <div className="summary-label">Failures</div>
                    </div>

                    <div className="summary-recs">
                      <strong>Recommendations</strong>
                      <ol>
                        {(aiSummary.summary_recommendations || []).map(
                          (r, i) => (
                            <li key={i}>{r}</li>
                          )
                        )}
                      </ol>
                    </div>
                  </div>
                )
              ) : (
                <div className="ai-empty">
                  No summary yet — run analysis and click Refresh.
                </div>
              )}
            </div>
          </div>

          <div className="card chat-card">
            <div className="card-head split">
              <div>
                <h3>AI Chat</h3>
                <div className="muted">
                  Ask follow-ups, request fixes, or deep-dive
                </div>
              </div>
              <div className="small-actions">
                <button
                  className="btn small"
                  onClick={() => {
                    setChatHistory([]);
                    setChatInput("");
                  }}
                >
                  Clear
                </button>
                <button
                  className="btn small ghost"
                  onClick={askAboutSelected}
                  disabled={!selected}
                >
                  Ask selected
                </button>
              </div>
            </div>

            <div className="chat-body">
              <div className="chat-window" role="log" ref={chatWindowRef}>
                {chatHistory.length === 0 ? (
                  <div className="chat-empty muted">
                    No messages yet. Ask something about the model.
                  </div>
                ) : (
                  <>
                    {chatHistory.map((m, i) => (
                      <div
                        key={i}
                        className={`chat-bubble ${
                          m.role === "user" ? "user" : "assistant"
                        }`}
                      >
                        <div
                          className="bubble-text"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          {m.text}
                        </div>
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="chat-bubble assistant thinking-bubble">
                        <div className="typing">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="chat-input-row">
                <input
                  placeholder={
                    report
                      ? "Example: Which instruments need immediate attention?"
                      : "Run an analysis first"
                  }
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={!report || chatLoading}
                  onKeyDown={handleEnterKey}
                />

                <button
                  className="btn primary"
                  onClick={onSendClick}
                  disabled={!report || chatLoading || !chatInput}
                >
                  {chatLoading ? "Thinking..." : "Send"}
                </button>
              </div>
            </div>
          </div>

          {error && <div className="error-strip">{error}</div>}
        </aside>
      </main>

      <footer className="app-footer">
        <div>IFC Viewer</div>
        <div className="footer-right">
          <small>v1.0</small>
        </div>
      </footer>
    </div>
  );
}
