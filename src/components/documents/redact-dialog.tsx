"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { goStepUp } from "@/lib/auth/step-up-resume";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { authorizeDocumentDownload, createRedactedCopy } from "@/modules/documents/actions";
import type { RedactionRegion } from "@/modules/documents/redact";
import { needsStepUp } from "@/modules/sheet/matter-wire";

type MatterChoice = { id: string; label: string };
type Target = { versionId: string; organizationId: string; title: string; mediaType: string; matters: MatterChoice[] };
type Box = RedactionRegion;
type PageView = { url: string };

const CSS = `
dialog.redact-dlg{width:min(880px,calc(100vw - 24px));max-height:calc(100dvh - 24px)}
dialog.redact-dlg .sheet{position:relative;touch-action:none;background:#f3f2f0;border-radius:12px;overflow:hidden}
dialog.redact-dlg .sheet img{display:block;width:100%;height:auto}
dialog.redact-dlg .box{position:absolute;background:#111;outline:1px solid #111}
dialog.redact-dlg .acts{display:flex;flex-wrap:wrap;gap:6px}
dialog.redact-dlg .acts button{min-height:44px}
@media (max-width:600px){
  dialog.redact-dlg{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;margin:0;border-radius:0}
}
`;

function parseMatters(raw: string | undefined): MatterChoice[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MatterChoice[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}

/** Staff mark areas on a clean PDF or image. The server stores a new copy; this view is only for marking. */
export function RedactHost() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [pages, setPages] = useState<PageView[]>([]);
  const [page, setPage] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [draft, setDraft] = useState<Box | null>(null);
  const [matterId, setMatterId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();
  const origin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-redact]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const matters = parseMatters(button.dataset.matters);
      setLoading(true);
      setPages([]);
      setTarget({
        versionId: button.dataset.redact ?? "",
        organizationId: button.dataset.org ?? "",
        title: button.dataset.title ?? "Document",
        mediaType: button.dataset.type ?? "",
        matters,
      });
      setMatterId(matters[0]?.id ?? "");
      setBoxes([]);
      setPage(0);
      setMessage("");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!target) return;
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    let cancelled = false;
    void (async () => {
      const granted = await authorizeDocumentDownload({ organizationId: target.organizationId, versionId: target.versionId });
      if (cancelled) return;
      if ("error" in granted) {
        setLoading(false);
        if (needsStepUp(granted.error)) {
          goStepUp(stepUpHref(`${window.location.pathname}${window.location.search}`, "document_redact"));
          setTarget(null);
          return;
        }
        setMessage(granted.error ?? "That file can’t be opened.");
        return;
      }
      const response = await fetch(granted.url);
      if (!response.ok) {
        setLoading(false);
        setMessage("That file can’t be opened right now.");
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const views = target.mediaType === "application/pdf" ? await renderPdf(bytes) : [{ url: URL.createObjectURL(new Blob([bytes], { type: target.mediaType })) }];
      if (cancelled) {
        for (const view of views) URL.revokeObjectURL(view.url);
        return;
      }
      setPages(views);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const close = () => {
    for (const view of pages) URL.revokeObjectURL(view.url);
    setPages([]);
    setTarget(null);
    dialog.current?.close();
  };

  const pointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    return { x, y };
  };

  const save = () => {
    if (!target || boxes.length === 0 || !matterId) {
      setMessage("Mark at least one area.");
      return;
    }
    setMessage("");
    start(async () => {
      const result = await createRedactedCopy({
        organizationId: target.organizationId,
        sourceVersionId: target.versionId,
        matterId,
        regions: boxes,
      });
      if ("error" in result) {
        if (needsStepUp(result.error)) {
          goStepUp(stepUpHref(`${window.location.pathname}${window.location.search}`, "document_redact"));
          return;
        }
        setMessage(result.error ?? "The redacted copy could not be saved.");
        return;
      }
      close();
      router.refresh();
    });
  };

  if (!target) return null;
  const current = pages[page];
  const onPage = boxes.filter((box) => box.page === page);

  return (
    <dialog className="dlg redact-dlg" ref={dialog} aria-labelledby="redH" onClose={close}>
      <style>{CSS}</style>
      <div className="dh">
        <h2 id="redH">Redact a copy</h2>
        <button type="button" className="x" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <div className="db">
        <p className="mu">
          Drag over what should be removed from <b style={{ fontWeight: 500 }}>{target.title}</b>. The copy drops the text and image data under each box. The original file is not changed.
        </p>
        {target.matters.length > 1 ? (
          <label className="fld">
            Matter
            <select className="sel" value={matterId} onChange={(event) => setMatterId(event.target.value)}>
              {target.matters.map((matter) => (
                <option key={matter.id} value={matter.id}>
                  {matter.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {pages.length > 1 ? (
          <div className="acts" role="tablist" aria-label="Pages">
            {pages.map((_, index) => (
              <button key={index} type="button" className={index === page ? "btn p sm" : "btn sm"} onClick={() => setPage(index)}>
                Page {index + 1}
              </button>
            ))}
          </div>
        ) : null}
        {loading ? <p>Opening the file…</p> : null}
        {current ? (
          <div
            className="sheet"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const at = pointer(event);
              origin.current = at;
              setDraft({ page, ...at, width: 0, height: 0 });
            }}
            onPointerMove={(event) => {
              if (!origin.current) return;
              const at = pointer(event);
              setDraft({
                page,
                x: Math.min(origin.current.x, at.x),
                y: Math.min(origin.current.y, at.y),
                width: Math.abs(at.x - origin.current.x),
                height: Math.abs(at.y - origin.current.y),
              });
            }}
            onPointerUp={() => {
              if (draft && draft.width >= 0.01 && draft.height >= 0.01) setBoxes([...boxes, draft]);
              origin.current = null;
              setDraft(null);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt={`Page ${page + 1} of ${target.title}`} />
            {onPage.map((box, index) => (
              <span key={index} className="box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />
            ))}
            {draft && draft.page === page ? (
              <span className="box" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />
            ) : null}
          </div>
        ) : null}
        {boxes.length > 0 ? (
          <ul className="acts" style={{ listStyle: "none", padding: 0 }}>
            {boxes.map((box, index) => (
              <li key={index}>
                <button type="button" className="btn sm" onClick={() => setBoxes(boxes.filter((_, at) => at !== index))}>
                  Remove area {index + 1}
                  {pages.length > 1 ? ` on page ${box.page + 1}` : ""}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {message ? (
          <p className="lbl" role="alert">
            {message}
          </p>
        ) : null}
      </div>
      <div className="df">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn p" disabled={pending || boxes.length === 0} onClick={save}>
          {pending ? "Saving…" : "Save redacted copy"}
        </button>
      </div>
    </dialog>
  );
}

async function renderPdf(bytes: Uint8Array): Promise<PageView[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const views: PageView[] = [];
  const count = Math.min(doc.numPages, 40);
  for (let number = 1; number <= count; number += 1) {
    const sheet = await doc.getPage(number);
    const base = sheet.getViewport({ scale: 1 });
    const viewport = sheet.getViewport({ scale: Math.min(2, 900 / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await sheet.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob) views.push({ url: URL.createObjectURL(blob) });
  }
  return views;
}
