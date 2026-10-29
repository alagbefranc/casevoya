"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { goStepUp } from "@/lib/auth/step-up-resume";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { createClient } from "@/lib/supabase/client";
import { completeDocumentUpload, createUploadIntent, recordCameraAssembly } from "@/modules/documents/actions";
import { assemblePages } from "@/modules/documents/assemble";
import { assemblyPages } from "@/modules/documents/capture";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { checkUploadFile, uploadFailure } from "@/modules/portal/upload-failure";
import { PageList, PagePreview, readCaptureFiles, releasePages, type CapturePage } from "@/components/documents/page-capture";

export type StaffCaptureData = {
  organizationId: string;
  matterId: string;
  maxBytes: number;
  people: { id: string; name: string }[];
};

/** Staff capture on a matter: several pages, turned and ordered, saved as one PDF through the upload check. */
export function StaffCapture({ data }: { data: StaffCaptureData }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState(data.people[0]?.id ?? "");
  const [purpose, setPurpose] = useState("");
  const [pages, setPages] = useState<CapturePage[]>([]);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const add = async (list: FileList | null, source: "camera" | "library") => {
    if (!list || list.length === 0) return;
    const read = await readCaptureFiles(list, source, pages.length);
    if (read.error && read.pages.length === 0) {
      setMessage(read.error);
      return;
    }
    setMessage(read.error ?? "");
    setPages([...pages, ...read.pages]);
  };

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const close = () => {
    releasePages(pages);
    setPages([]);
    setMessage("");
    setOpen(false);
  };

  const save = () => {
    if (purpose.trim().length < 2) {
      setMessage("Say what this document is.");
      return;
    }
    if (!personId || pages.length === 0) {
      setMessage("Add at least one page.");
      return;
    }
    setMessage("");
    start(async () => {
      const bytes = await assemblePages(pages.map((page) => ({ bytes: page.bytes, mediaType: page.mediaType, rotation: page.rotation, source: page.source })));
      const file = new File([Uint8Array.from(bytes)], "pages.pdf", { type: "application/pdf" });
      const refused = checkUploadFile(file, { maxBytes: data.maxBytes });
      if (refused) {
        setMessage(refused.copy);
        return;
      }
      const intent = await createUploadIntent({
        organizationId: data.organizationId,
        matterId: data.matterId,
        personId,
        filename: file.name,
        byteSize: file.size,
        purpose: purpose.trim(),
        code: code || null,
      });
      if ("error" in intent) {
        if (needsStepUp(intent.error)) {
          goStepUp(stepUpHref(`${window.location.pathname}${window.location.search}`, "document_capture"));
          return;
        }
        setMessage(intent.error ?? "The pages could not be saved.");
        return;
      }
      const supabase = createClient();
      const uploaded = await supabase.storage.from("documents").uploadToSignedUrl(intent.path, intent.token, file);
      if (uploaded.error) {
        setMessage(uploadFailure({ stage: "transfer", message: uploaded.error.message }).copy);
        return;
      }
      const noted = await recordCameraAssembly({
        organizationId: data.organizationId,
        versionId: intent.versionId,
        pages: assemblyPages(pages),
      });
      if ("error" in noted) {
        setMessage(noted.error ?? "The page order could not be saved.");
        return;
      }
      const done = await completeDocumentUpload({ organizationId: data.organizationId, versionId: intent.versionId });
      if ("error" in done) {
        setMessage(done.error ?? "The file could not be checked.");
        return;
      }
      releasePages(pages);
      setPages([]);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>
        Capture pages
      </button>
      <dialog
        className="dlg"
        ref={dialog}
        aria-labelledby="capH"
        style={{ width: "min(720px, calc(100vw - 16px))" }}
        onClose={() => {
          setPages((current) => {
            releasePages(current);
            return [];
          });
          setOpen(false);
        }}
      >
          <div className="dh">
            <h2 id="capH">Capture pages</h2>
            <button type="button" className="x" aria-label="Close" onClick={close}>
              ×
            </button>
          </div>
          <div className="db">
            <p className="mu">Take a photo of each page, turn it upright, and put the pages in order. They are saved as one PDF.</p>
            <div className="g2">
              <label className="fld">
                Person
                <select className="sel" value={personId} onChange={(event) => setPersonId(event.target.value)}>
                  {data.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                What it is
                <input className="inp" value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)} />
              </label>
            </div>
            <div className="kd-row" style={{ marginTop: 12 }}>
              <label className="btn p sm">
                Use camera
                <input type="file" className="sr" accept="image/*" capture="environment" onChange={(event) => void add(event.target.files, "camera")} />
              </label>
              <label className="btn sm">
                Add a page
                <input type="file" className="sr" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple onChange={(event) => void add(event.target.files, "library")} />
              </label>
            </div>
            <PageList pages={pages} onChange={setPages} disabled={pending} />
            {pages.length > 0 ? <PagePreview pages={pages} /> : null}
            <label className="fld" style={{ marginTop: 12 }}>
              Authenticator code
              <input className="inp" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
            </label>
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
            <button type="button" className="btn p" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save as one PDF"}
            </button>
          </div>
      </dialog>
    </>
  );
}
