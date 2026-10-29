"use client";

import { moveItem, nextTurn, type CaptureSource, type QuarterTurn } from "@/modules/documents/capture";

export type CapturePage = {
  id: string;
  previewUrl: string;
  rotation: QuarterTurn;
  source: CaptureSource;
  mediaType: "image/jpeg" | "image/png";
  bytes: Uint8Array;
};

const PAGE_CSS = `
.cap-pages{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.cap-page{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px;align-items:center;padding:8px;border:1px solid var(--line,#e6e2db);border-radius:12px;background:#fff}
.cap-page img{width:72px;height:72px;object-fit:contain;background:#f3f2f0;border-radius:8px}
.cap-acts{display:flex;flex-wrap:wrap;gap:6px}
.cap-acts button{min-height:44px}
.cap-preview{display:flex;flex-direction:column;gap:12px}
.cap-preview figure{margin:0}
.cap-preview img{width:100%;max-height:420px;object-fit:contain;background:#f3f2f0;border-radius:12px}
@media (min-width:800px){
  .cap-pages{display:grid;grid-template-columns:1fr 1fr}
}
`;

export function imageMedia(file: File): "image/jpeg" | "image/png" | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/png" || name.endsWith(".png")) return "image/png";
  if (file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

export async function readCaptureFiles(files: Iterable<File>, source: CaptureSource, already: number): Promise<{ pages: CapturePage[]; error: string | null }> {
  const pages: CapturePage[] = [];
  for (const file of files) {
    if (already + pages.length >= 40) return { pages, error: "A capture can have up to 40 pages." };
    const media = imageMedia(file);
    if (!media) return { pages, error: file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic") ? "That photo is HEIC. Take it again, or choose a JPEG or PNG." : "Choose a JPEG or PNG for each page." };
    pages.push({
      id: crypto.randomUUID(),
      previewUrl: URL.createObjectURL(file),
      rotation: 0,
      source,
      mediaType: media,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return { pages, error: null };
}

export function releasePages(pages: readonly CapturePage[]) {
  for (const page of pages) URL.revokeObjectURL(page.previewUrl);
}

/** The page list: turn, reorder, remove. One column on a phone, with 44px controls. */
export function PageList({ pages, onChange, disabled }: { pages: CapturePage[]; onChange: (pages: CapturePage[]) => void; disabled?: boolean }) {
  if (pages.length === 0) return null;
  const update = (index: number, rotation: QuarterTurn) => {
    onChange(pages.map((page, at) => (at === index ? { ...page, rotation } : page)));
  };
  return (
    <>
      <style>{PAGE_CSS}</style>
      <ol className="cap-pages">
        {pages.map((page, index) => (
          <li key={page.id} className="cap-page">
            {/* Object URL from the camera. next/image does not load those. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={page.previewUrl} alt="" style={{ transform: `rotate(${page.rotation}deg)` }} />
            <div>
              <b style={{ fontWeight: 500 }}>Page {index + 1}</b>
              <div className="cap-acts">
                <button type="button" className="btn sm" disabled={disabled} onClick={() => update(index, nextTurn(page.rotation))}>
                  Rotate
                </button>
                <button type="button" className="btn sm" disabled={disabled || index === 0} aria-label={`Move page ${index + 1} earlier`} onClick={() => onChange(moveItem(pages, index, -1))}>
                  Earlier
                </button>
                <button type="button" className="btn sm" disabled={disabled || index === pages.length - 1} aria-label={`Move page ${index + 1} later`} onClick={() => onChange(moveItem(pages, index, 1))}>
                  Later
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={disabled}
                  aria-label={`Remove page ${index + 1}`}
                  onClick={() => {
                    URL.revokeObjectURL(page.previewUrl);
                    onChange(pages.filter((item) => item.id !== page.id));
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Readable check: every page, turned the way it will be saved. */
export function PagePreview({ pages }: { pages: CapturePage[] }) {
  return (
    <div className="cap-preview">
      <style>{PAGE_CSS}</style>
      {pages.map((page, index) => (
        <figure key={page.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.previewUrl} alt={`Page ${index + 1}`} style={{ transform: `rotate(${page.rotation}deg)` }} />
          <figcaption className="lbl">Page {index + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}
