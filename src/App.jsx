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
  // inside component state:
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);

  // create/revoke object URL only when `file` changes
  useEffect(() => {
    // if no file, clear any previous url
    if (!file) {
      if (uploadedFileUrl) {
        try {
          URL.revokeObjectURL(uploadedFileUrl);
        } catch (e) {}
        setUploadedFileUrl(null);
      }
      return;
    }

    // ensure `file` is a File/Blob before creating object URL
    if (!(file instanceof Blob) && !(file instanceof File)) {
      console.warn("Selected `file` is not a Blob/File:", file);
      return;
    }

    const url = URL.createObjectURL(file);
    // console.log("[debug] created object URL →", url); // IMPORTANT
    setUploadedFileUrl(url);

    return () => {
      // revoke the URL when file changes or component unmounts
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    };
  }, [file]); // runs only when `file` changes

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
    // console.log("Uploading file to:", endpoint, "file:", file.name, file.size);

    try {
      xhr.open("POST", endpoint, true);
      // ask browser to parse JSON response for us
      xhr.responseType = "json";
      // optional timeout (ms). Increase if your analysis is slow to start.
      xhr.timeout = 120000; // 2 minutes

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setUploadPct(pct);
          // console.log("upload progress:", pct, "%");
        }
      };

      xhr.onload = () => {
        // console.log("XHR load. status:", xhr.status, "response:", xhr.response);
        // When responseType = 'json', xhr.response may be null if server returned non-json
        if (xhr.status >= 200 && xhr.status < 300) {
          const resp =
            xhr.response ??
            (() => {
              // fallback: try parsing text
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
            // console.log("Job created:", resp.job_id);
          } else {
            // server returned 200 but no job id — show full body for debugging
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
          // non-2xx: try to show server-provided error message (json or text)
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
  }, [file, API_BASE]); // include API_BASE so the hook updates if you change the backend URL

  // Poll job status until done/failed
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
          // still running -> poll again
          if (!stopped) setTimeout(poll, pollIntervalMs);
        }
      } catch (err) {
        setError("Polling error: " + err.message);
        setIsPolling(false);
      }
    };

    // first poll
    poll();

    return () => {
      stopped = true;
      setIsPolling(false);
    };
  }, [jobId, pollIntervalMs]);

  // Download JSON report
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

  // Capture snapshot of 3D canvas (renderer dom element)
  const captureSnapshot = async () => {
    try {
      // find the canvas element produced by react-three-fiber
      const canvas = document.querySelector("canvas");
      if (!canvas) return alert("3D canvas not found.");
      const data = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = data;
      a.download = `snapshot-${Date.now()}.png`;
      a.click();
    } catch (err) {
      console.error(err);
      alert("Snapshot failed: " + err.message);
    }
  };

  // debugUpload.js - paste inside your React component
  function debugUploadFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("No file provided"));
        return;
      }
      const xhr = new XMLHttpRequest();
      const endpoint =
        (process.env.REACT_APP_API_BASE || "http://localhost:8000") +
        "/analyze-model-async";
      // console.log("Uploading to:", endpoint);

      xhr.open("POST", endpoint, true);
      xhr.responseType = "json";

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          // console.log("upload progress:", pct + "%");
          // update state if you want
        }
      };

      xhr.onload = () => {
        // console.log(
          // "XHR status:",
          // xhr.status,
          // xhr.statusText,
          // "response:",
          // xhr.response
        // );
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else {
          // try to parse response text for server error
          let text = xhr.response;
          if (!text) {
            try {
              text = xhr.responseText;
            } catch (e) {
              text = null;
            }
          }
          reject(
            new Error(
              `Upload failed: ${xhr.status} ${
                xhr.statusText
              } - ${JSON.stringify(text)}`
            )
          );
        }
      };

      xhr.onerror = (e) => {
        console.error("XHR onerror", e);
        reject(new Error("Network error during upload"));
      };

      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    });
  }

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
            <button
              className="btn outline"
              onClick={captureSnapshot}
              disabled={!report}
            >
              Capture Snapshot
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
            {/* <IfcBrowserViewer
              fileUrl={uploadedFileUrl}
              // onModelLoaded={() => console.log("IFC loaded in viewer")}
            /> */}
            <IfcBrowserViewer
              key={uploadedFileUrl || "no-ifc"}
              fileUrl={uploadedFileUrl}
              // onModelLoaded={() => {
              //   console.log(
              //     "IFC loaded in viewer — App sees it:",
              //     uploadedFileUrl
              //   );
              //   // trigger one render pass on the viewer if available
              //   try {
              //     window.ifcViewer?.context?.render?.();
              //   } catch (e) {}
              // }}
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

          {error && <div className="error">{error}</div>}
        </aside>
      </main>

      <footer className="footer">
        <div>Built with React • Upload size limits depend on your backend.</div>
      </footer>
    </div>
  );
}
