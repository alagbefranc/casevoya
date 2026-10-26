"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authorizeDocumentDownload } from "@/modules/documents/actions";
import { acknowledgeMessage, markThreadRead, sendMessage } from "@/modules/messages/actions";
import {
  MAX_BODY,
  audienceBlocked,
  audienceLine,
  clockLabel,
  groupByDay,
  initialOf,
  listTime,
  type ChatData,
  type ChatDocument,
  type ChatMessage,
  type ChatThread,
  readState,
  whatsappLine,
} from "@/modules/messages/present";
import { fillTemplate, firstNameOf, unfilledNotice } from "@/modules/messages/templates";
// "Draft in French" (OPS-04): a machine draft the sender checks before sending; see the module.
import { draftTranslation } from "@/modules/messages/translation-hook";
import { draftWithVo, sendVoDraft } from "@/modules/vo/actions";
import { NEEDS_RULE } from "@/modules/vo/prompt";
import { CHAT_CSS } from "./chat-css";

const SPRITE = "/assets/icons-coreui/sprite.svg";
const NEW = "new";

function Icon({ name }: { name: string }) {
  return (
    <svg className="ic s" aria-hidden="true">
      <use href={`${SPRITE}#i-${name}`} />
    </svg>
  );
}

type Pending = {
  key: string;
  threadId: string;
  body: string;
  documentIds: string[];
  requiresAck: boolean;
  createdAt: string;
  state: "sending" | "failed";
  error?: string;
  /** Set once the database accepted it; the row is dropped when the refreshed list has it. */
  messageId?: string;
  personIds: string[] | null;
  matterId: string;
  /** Sent as the reviewed text of this Vo draft (send_vo_draft), not as a fresh message. */
  voDraftId?: string;
};

function newKey(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return random.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40).padEnd(8, "0");
}

/** Whether a document may go to everyone in an audience: the same rule the database applies. */
function shareable(doc: ChatDocument, people: string[]): boolean {
  if (doc.audience === "staff") return false;
  if (doc.audience === "matter" && doc.sensitivity === "ordinary") return true;
  return people.length > 0 && people.every((id) => id === doc.personId);
}

/** Sizes the chat to the visible viewport (the on-screen keyboard included). */
function useFit(ref: React.RefObject<HTMLElement | null>, view: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const vv = window.visualViewport;
      const viewH = vv ? vv.height : window.innerHeight;
      const narrow = window.matchMedia("(max-width:900px)").matches;
      if (narrow && view === "thread") {
        el.style.setProperty("--cv-top", `${vv ? vv.offsetTop : 0}px`);
        el.style.setProperty("--cv-h", `${Math.round(viewH)}px`);
        return;
      }
      const sheet = el.closest<HTMLElement>(".sheet");
      const rect = el.getBoundingClientRect();
      if (!narrow && sheet) {
        const box = sheet.getBoundingClientRect();
        const top = rect.top - box.top + sheet.scrollTop;
        el.style.setProperty("--cv-h", `${Math.max(360, Math.round(sheet.clientHeight - top - 12))}px`);
      } else {
        const top = rect.top + window.scrollY;
        el.style.setProperty("--cv-h", `${Math.max(360, Math.round(viewH - top - 12))}px`);
      }
    };
    fit();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [ref, view]);
}

/**
 * The chat page for portal Messages and the matter's Messages tab: conversations on the left, the
 * open thread on the right (one screen at a time on a phone), the audience always shown above the
 * composer. Every write goes through the database's checks; this view only asks.
 */
export function ChatView({ data }: { data: ChatData }) {
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const attach = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(data.selectedId ?? (data.threads.length ? null : NEW));
  // On a phone the list shows first unless a thread was linked (?thread=); on a desktop both show.
  const [view, setView] = useState<"list" | "thread">(data.opened && data.selectedId ? "thread" : "list");
  const [text, setText] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [critical, setCritical] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [matterId, setMatterId] = useState<string>(data.matterId ?? data.matters[0]?.id ?? "");
  const [pending, setPending] = useState<Pending[]>([]);
  const [readThreads, setReadThreads] = useState<string[]>([]);
  const [acked, setAcked] = useState<string[]>([]);
  const [notice, setNoticeText] = useState<string | null>(null);
  // An info notice (Vo's draft is ready) is shown as a status, not as an error.
  const [noticeInfo, setNoticeInfo] = useState(false);
  const setNotice = (text: string | null) => {
    setNoticeInfo(false);
    setNoticeText(text);
  };
  const showInfo = (text: string) => {
    setNoticeInfo(true);
    setNoticeText(text);
  };
  const [atBottom, setAtBottom] = useState(true);
  // The Vo draft now in the composer (staff only): Send sends the reviewed text of that draft.
  const [voDraft, setVoDraft] = useState<string | null>(null);
  const [voBusy, setVoBusy] = useState(false);
  // The records Vo cited for the draft now in the composer (labels only).
  const [voSources, setVoSources] = useState<{ label: string; href: string | null; attestation?: string | null; edit?: string | null }[]>([]);
  const [query, setQuery] = useState("");
  const voMenu = useRef<HTMLDetailsElement>(null);
  // OPS-04: Insert template, and a French machine draft waiting for the sender's check.
  const tplMenu = useRef<HTMLDetailsElement>(null);
  const [french, setFrench] = useState<{ english: string; checked: boolean } | null>(null);
  const [translating, setTranslating] = useState(false);
  useFit(root, view);

  const thread = data.threads.find((row) => row.id === selected) ?? null;
  const composing = selected === NEW;
  const confirmed = new Set(data.messages.map((message) => message.id));
  const live = pending.filter((row) => !row.messageId || !confirmed.has(row.messageId));

  const messages = useMemo(
    () => (thread ? data.messages.filter((message) => message.threadId === thread.id) : []),
    [data.messages, thread],
  );
  const groups = useMemo(() => groupByDay(messages, data.now, data.timezone), [messages, data.now, data.timezone]);
  const firstUnread = messages
    .filter((message) => message.unread && !readThreads.includes(message.threadId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id;

  // Audience for the composer: the open thread's, or the new conversation's choice.
  const audiencePeople = composing ? (data.mode === "portal" ? (data.selfPersonId ? [data.selfPersonId] : []) : people) : null;
  const optionName = new Map(data.audienceOptions.map((option) => [option.personId, option.name]));
  const audience = thread
    ? audienceLine({
        mode: data.mode,
        firmName: data.firmName,
        // The portal says "You" for the reader's own person.
        audience: data.mode === "portal" ? thread.audience.filter((_, index) => thread.audienceIds[index] !== data.selfPersonId) : thread.audience,
        excluded: thread.excluded,
      })
    : data.mode === "staff"
      ? people.length
        ? audienceLine({
            mode: "staff",
            firmName: data.firmName,
            audience: people.map((id) => optionName.get(id) ?? "Client"),
            excluded: data.audienceOptions.filter((option) => !people.includes(option.personId)).map((option) => option.name),
          })
        : null
      : audienceLine({ mode: "portal", firmName: data.firmName, audience: [], excluded: [] });

  // The thread open on arrival is marked read on the server; the next refresh clears its badge.
  const markedOnLoad = useRef(false);
  useEffect(() => {
    if (markedOnLoad.current || !thread || !thread.unread) return;
    markedOnLoad.current = true;
    void markThreadRead({ organizationId: data.organizationId, threadId: thread.id }).then(() => router.refresh());
  }, [thread, data.organizationId, router]);

  const scrollToEnd = useCallback((smooth = false) => {
    const el = log.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Newest on open.
  useLayoutEffect(() => {
    scrollToEnd(false);
  }, [selected, view, scrollToEnd]);

  // New messages: followed when at the bottom; otherwise the "New messages" pill shows.
  const count = messages.length + live.filter((row) => row.threadId === selected).length;
  const [seenCount, setSeenCount] = useState(count);
  const fresh = !atBottom && count > seenCount;
  useEffect(() => {
    if (atBottom) scrollToEnd(true);
  }, [count, atBottom, scrollToEnd]);

  const onScroll = () => {
    const el = log.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAtBottom(bottom);
    if (bottom) setSeenCount(count);
  };

  const grow = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
  };

  const open = (id: string) => {
    const target = data.threads.find((row) => row.id === id);
    if (target?.unread && !readThreads.includes(id)) {
      setReadThreads((list) => [...list, id]);
      void markThreadRead({ organizationId: data.organizationId, threadId: id });
    }
    setSeenCount(Number.MAX_SAFE_INTEGER);
    setAtBottom(true);
    setSelected(id);
    setView("thread");
    setDocs([]);
    setNotice(null);
    // A Vo draft belongs to its own conversation.
    if (voDraft) {
      setVoDraft(null);
      setVoSources([]);
      setText("");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("vo");
    if (id === NEW) url.searchParams.delete("thread");
    else url.searchParams.set("thread", id);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  const submit = async (row: Pending) => {
    setPending((list) => list.map((item) => (item.key === row.key ? { ...item, state: "sending", error: undefined } : item)));
    const result = row.voDraftId
      ? await sendVoDraft({ organizationId: data.organizationId, draftId: row.voDraftId, body: row.body, clientKey: row.key })
      : await sendMessage({
          organizationId: data.organizationId,
          matterId: row.matterId,
          threadId: row.threadId === NEW ? null : row.threadId,
          personIds: row.threadId === NEW ? row.personIds : null,
          body: row.body,
          requiresAck: row.requiresAck,
          documentIds: row.documentIds,
          clientKey: row.key,
        });
    if ("error" in result) {
      setPending((list) => list.map((item) => (item.key === row.key ? { ...item, state: "failed", error: result.error } : item)));
      return;
    }
    setPending((list) => list.map((item) => (item.key === row.key ? { ...item, messageId: result.messageId, threadId: result.threadId } : item)));
    if (row.threadId === NEW) open(result.threadId);
    router.refresh();
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (body.length > MAX_BODY) return setNotice("Write a message of up to 4,000 characters.");
    if (composing && data.mode === "staff" && people.length === 0) return setNotice("Choose who can read this message.");
    if (composing && !matterId) return setNotice("Choose a matter.");
    const target = thread?.matterId ?? matterId;
    // A Vo draft goes out only as text a person reviewed: no placeholder may remain, and it
    // can't carry attachments or a critical-instruction flag it wasn't drafted with.
    const asVo = voDraft && thread ? voDraft : undefined;
    if (asVo && body.toLowerCase().includes(NEEDS_RULE)) return setNotice("Replace “[needs a sourced rule]” with a checked, sourced fact, or remove it, before sending.");
    if (asVo && (docs.length || critical)) return setNotice("Send the Vo draft on its own, then attach documents or mark a critical instruction in a new message.");
    // OPS-04: a template field nobody filled, or a French draft nobody checked, isn't sent.
    const gap = unfilledNotice(body);
    if (gap) return setNotice(gap);
    if (french && !french.checked) return setNotice("Check the French draft, then press “I checked it” before you send.");
    const row: Pending = {
      key: newKey(),
      threadId: thread?.id ?? NEW,
      body,
      documentIds: docs,
      requiresAck: data.mode === "staff" && critical,
      createdAt: new Date().toISOString(),
      state: "sending",
      personIds: composing ? audiencePeople : null,
      matterId: target,
      voDraftId: asVo,
    };
    setPending((list) => [...list, row]);
    setVoDraft(null);
    setVoSources([]);
    setText("");
    setDocs([]);
    setCritical(false);
    setNotice(null);
    setFrench(null);
    requestAnimationFrame(() => {
      grow();
      scrollToEnd(true);
    });
    void submit(row);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    // Enter sends on a keyboard-and-pointer device; on a phone it is a new line.
    if (!window.matchMedia("(pointer:fine)").matches) return;
    event.preventDefault();
    send();
  };

  // Opened from Vo drafts (Accept or Edit, `?vo=<draft>`): the draft fills this conversation's
  // composer for the person to review, edit and send. Nothing is sent until they press Send.
  const voPrefilled = useRef(false);
  useEffect(() => {
    if (voPrefilled.current || !data.vo || !thread) return;
    voPrefilled.current = true;
    const id = new URLSearchParams(window.location.search).get("vo");
    const draft = id ? data.vo.drafts.find((row) => row.id === id && row.threadId === thread.id) : undefined;
    if (!draft) return;
    requestAnimationFrame(() => {
      setVoDraft(draft.id);
      setText(draft.body);
      if (draft.needsRule) setNotice("Vo left “[needs a sourced rule]” where a rule, fee or deadline would go. Replace it with a checked, sourced fact, or remove it, before sending.");
      requestAnimationFrame(() => {
        grow();
        input.current?.focus();
      });
    });
  }, [data.vo, thread]);

  const askVo = async (kind: "message_reply" | "document_request") => {
    if (!thread || voBusy) return;
    if (voMenu.current) voMenu.current.open = false;
    setVoBusy(true);
    setNotice(null);
    const result = await draftWithVo({ organizationId: data.organizationId, threadId: thread.id, kind });
    setVoBusy(false);
    if ("error" in result) return setNotice(result.error);
    if ("abstained" in result) return showInfo("Vo didn’t draft this one: it needs a consultant (advice, eligibility or a rule without an approved source). Please answer it yourself.");
    setVoDraft(result.draftId);
    setVoSources(result.sources.map((source) => ({ label: source.label, href: source.href, attestation: source.attestation, edit: source.edit ?? null })));
    setText(result.text);
    if (result.needsRule) setNotice("Replace “[needs a sourced rule]” with a checked, sourced fact, or remove it, then review and send.");
    requestAnimationFrame(() => {
      grow();
      input.current?.focus();
    });
  };

  // A machine draft in French for the sender to review and edit; only the text they send is stored,
  // and only after they say they checked it.
  const translate = async () => {
    const draft = draftTranslation;
    if (!draft || !text.trim() || translating) return;
    setTranslating(true);
    const english = text;
    const result = await draft(english, data.organizationId);
    setTranslating(false);
    if ("error" in result) return setNotice(result.error);
    setFrench({ english, checked: false });
    setText(result.text);
    setNotice(null);
    requestAnimationFrame(grow);
  };

  // Insert template (OPS-04): the firm's approved text with the fields the composer knows filled.
  // A field it doesn't know stays as {field}, and the message isn't sent until it is filled.
  const insertTemplate = (body: string) => {
    if (tplMenu.current) tplMenu.current.open = false;
    if (text.trim() && !window.confirm("Replace what you wrote with this template?")) return;
    const readers = thread ? thread.audienceIds : people;
    const only = readers.length === 1 ? (data.audienceOptions.find((option) => option.personId === readers[0])?.name ?? thread?.audience[0] ?? null) : null;
    const filled = fillTemplate(body, {
      client_first_name: firstNameOf(only),
      matter_reference: data.merge?.matterReference ?? null,
      firm_name: data.merge?.firmName ?? data.firmName,
      consultant_name: data.merge?.consultantName ?? null,
    });
    setText(filled);
    setFrench(null);
    const gap = unfilledNotice(filled);
    if (gap) showInfo(`${gap} Casevoya doesn’t know ${gap.includes(",") ? "these" : "this"} for this conversation.`);
    else setNotice(null);
    requestAnimationFrame(() => {
      grow();
      input.current?.focus();
    });
  };

  const acknowledge = async (message: ChatMessage) => {
    setAcked((list) => [...list, message.id]);
    const result = await acknowledgeMessage({ organizationId: data.organizationId, messageId: message.id });
    if ("error" in result) {
      setAcked((list) => list.filter((id) => id !== message.id));
      setNotice(result.error);
      return;
    }
    router.refresh();
  };

  const download = async (versionId: string) => {
    const result = await authorizeDocumentDownload({ organizationId: data.organizationId, versionId });
    if ("error" in result) return setNotice(result.error ?? "That file can’t be opened.");
    window.location.assign(result.url);
  };

  const needle = query.trim().toLowerCase();
  const shownThreads = needle
    ? data.threads.filter((row) => `${row.title} ${row.preview} ${row.matterTitle}`.toLowerCase().includes(needle))
    : data.threads;
  const sendingHere = live.filter((row) => row.threadId === (thread?.id ?? NEW));
  const busy = sendingHere.some((row) => row.state === "sending");
  const attachTo = thread ? thread.audienceIds : audiencePeople ?? [];
  const docName = new Map(data.documents.map((doc) => [doc.id, doc.label]));
  const title = composing
    ? data.mode === "staff"
      ? "New conversation"
      : `Write to ${data.firmName}`
    : thread?.title ?? "Messages";

  return (
    <section ref={root} className="cv" data-view={view} aria-label="Messages">
      <style dangerouslySetInnerHTML={{ __html: CHAT_CSS }} />
      <aside className="cv-list" aria-label="Conversations">
        <div className="cv-lh">
          <h2>Conversations</h2>
          {data.mode === "staff" ? (
            data.audienceOptions.length ? (
              <button type="button" className="btn p sm" onClick={() => open(NEW)}>
                <Icon name="plus" />
                New
              </button>
            ) : null
          ) : data.matters.length ? (
            <button type="button" className="btn p sm" onClick={() => open(NEW)}>
              <Icon name="edit" />
              Write
            </button>
          ) : null}
        </div>
        {data.threads.length > 3 ? (
          <label className="cv-search">
            <Icon name="search" />
            <span className="cv-sr">Search conversations</span>
            <input type="search" value={query} placeholder="Search" onChange={(event) => setQuery(event.target.value)} />
          </label>
        ) : null}
        <div className="cv-threads">
          {data.threads.length === 0 ? (
            <p className="cv-none">
              {data.mode === "staff"
                ? data.audienceOptions.length
                  ? "No conversations on this matter yet."
                  : "Add a client to this matter to message them."
                : "No messages yet."}
            </p>
          ) : (
            <ul style={{ listStyle: "none" }}>
              {shownThreads.map((row) => (
                <li key={row.id}>
                  <ThreadRow row={row} data={data} current={row.id === selected} unread={readThreads.includes(row.id) ? 0 : row.unread} onOpen={() => open(row.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="cv-pane">
        <header className="cv-ph">
          <button type="button" className="cv-back" aria-label="Back to conversations" onClick={() => setView("list")}>
            <Icon name="chevron-left" />
          </button>
          {thread ? <span className={`cv-av${data.mode === "portal" ? " st" : ""}`} aria-hidden="true">{initialOf(thread.title)}</span> : null}
          <div>
            <b>{title}</b>
            <small>{thread ? thread.matterTitle : data.mode === "staff" ? data.matters[0]?.title ?? "" : "Before you send, you’ll see who can read it."}</small>
          </div>
        </header>

        {!thread && !composing ? (
          <div className="cv-empty">
            <div>
              <b>No messages yet</b>
              <small>
                {data.mode === "portal"
                  ? `Write to ${data.firmName} any time. You’ll see who can read it before you send.`
                  : "Start a conversation with someone on this matter. You choose who can read it."}
              </small>
              {(data.mode === "portal" ? data.matters.length : data.audienceOptions.length) ? (
                <button type="button" className="btn p sm" onClick={() => open(NEW)}>
                  {data.mode === "portal" ? "Write a message" : "New conversation"}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div ref={log} className="cv-log" role="log" aria-live="polite" aria-label={`Messages${thread ? ` with ${thread.title}` : ""}`} onScroll={onScroll}>
              {groups.length === 0 && sendingHere.length === 0 ? (
                <div className="cv-empty">
                  <div>
                    <b>{composing ? "A new conversation" : "No messages yet"}</b>
                    <small>{composing ? "Only the people shown above the box can read it, with the firm’s staff on the matter." : "Write the first message below."}</small>
                  </div>
                </div>
              ) : null}
              {groups.map((group) => (
                <DayBlock key={group.key} label={group.label}>
                  {group.messages.map((message, index) => (
                    <Bubble
                      key={message.id}
                      message={message}
                      data={data}
                      cont={index > 0 && group.messages[index - 1].authorName === message.authorName && group.messages[index - 1].mine === message.mine}
                      newMarker={message.id === firstUnread}
                      acked={message.acknowledged || acked.includes(message.id)}
                      onAck={() => void acknowledge(message)}
                      onDownload={(versionId) => void download(versionId)}
                    />
                  ))}
                </DayBlock>
              ))}
              {sendingHere.map((row) => (
                <div key={row.key} className={`cv-row me${row.state === "sending" ? " cv-sending" : ""}`}>
                  <div className="cv-b">
                    {row.requiresAck ? <span className="cv-crit"><Icon name="alert" />Critical instruction</span> : null}
                    {row.body}
                    {row.documentIds.length ? (
                      <span className="cv-chips">
                        {row.documentIds.map((id) => (
                          <span key={id} className="cv-chip"><Icon name="paperclip" />{docName.get(id) ?? "Document"}</span>
                        ))}
                      </span>
                    ) : null}
                    <span className="cv-foot">
                      {row.state === "sending" ? (
                        "Sending…"
                      ) : (
                        <>
                          <span className="cv-fail" role="alert">Not sent. {row.error}</span>
                          <button type="button" className="cv-retry" onClick={() => void submit(row)}>Retry</button>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {fresh ? (
              <button type="button" className="cv-jump" onClick={() => scrollToEnd(true)}>
                <Icon name="move-down" />
                New messages
              </button>
            ) : null}

            <div className="cv-compose">
              {notice ? (
                <div className={noticeInfo ? "cv-err cv-info" : "cv-err"} role={noticeInfo ? "status" : "alert"}>
                  <span>{notice}</span>
                  <button type="button" className="cv-retry" onClick={() => setNotice(null)}>Dismiss</button>
                </div>
              ) : null}
              {composing && data.mode === "portal" && data.matters.length > 1 ? (
                <label className="cv-aud">
                  <span>About</span>
                  <select className="sel" value={matterId} onChange={(event) => setMatterId(event.target.value)} style={{ height: 34 }}>
                    {data.matters.map((matter) => (
                      <option key={matter.id} value={matter.id}>{matter.title}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className={`cv-box${voDraft ? " vo" : ""}`}>
                {composing && data.mode === "staff" ? (
                  <fieldset className="cv-pick">
                    <legend className="cv-sr">Who can read it</legend>
                    <span className="cv-to" aria-hidden="true">To</span>
                    {data.audienceOptions.map((option) => {
                      const blocked = audienceBlocked(option);
                      return (
                        <label key={option.personId} title={blocked ? "An employer or sponsor needs portal access to this matter to be in a conversation." : undefined}>
                          <input
                            type="checkbox"
                            disabled={Boolean(blocked)}
                            checked={people.includes(option.personId)}
                            onChange={(event) =>
                              setPeople((list) => (event.target.checked ? [...list, option.personId] : list.filter((id) => id !== option.personId)))
                            }
                          />
                          {option.name}
                          <span className="cv-role">{blocked ? `${option.role} · ${blocked}` : option.role}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <p className="cv-aud" id="cv-aud">
                  <Icon name="eye" />
                  {audience ? (
                    <span>
                      Visible to: <b>{audience.visible}</b>
                      {audience.hidden ? `. ${audience.hidden}.` : "."}
                      {data.mode === "staff" && whatsappLine(thread, data.timezone) ? ` ${whatsappLine(thread, data.timezone)}` : null}
                    </span>
                  ) : (
                    <span>Choose who can read it before you write.</span>
                  )}
                </p>
                {voDraft ? (
                  <div className="cv-vo" role="status">
                    <span className="cv-vo-t">
                      <Icon name="sparkles" />
                      Vo draft. Review and edit before you send.
                    </span>
                    {voSources.length ? (
                      <details className="cv-src">
                        <summary>{voSources.length === 1 ? "1 source" : `${voSources.length} sources`}</summary>
                        <ul>
                          {voSources.map((source, index) => (
                            <li key={index}>
                              {source.href ? <a href={source.href}>{source.label}</a> : source.label}
                              {source.attestation ? ` (${source.attestation})` : null}
                              {source.edit ? ` (${source.edit})` : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <button
                      type="button"
                      className="cv-retry"
                      onClick={() => {
                        setVoDraft(null);
                        setVoSources([]);
                        setText("");
                        setNotice(null);
                        requestAnimationFrame(grow);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
                {french ? (
                  <div className="cv-vo" role="status">
                    <span className="cv-vo-t">
                      {french.checked ? "French draft checked. You can send it." : "Machine draft in French. Check every word before you send."}
                    </span>
                    {french.checked ? null : (
                      <button type="button" className="cv-retry" onClick={() => setFrench({ ...french, checked: true })}>
                        I checked it
                      </button>
                    )}
                    <button
                      type="button"
                      className="cv-retry"
                      onClick={() => {
                        setText(french.english);
                        setFrench(null);
                        requestAnimationFrame(grow);
                      }}
                    >
                      Back to English
                    </button>
                  </div>
                ) : null}
                {docs.length ? (
                  <div className="cv-sel">
                    {docs.map((id) => (
                      <span key={id} className="cv-chip">
                        <Icon name="paperclip" />
                        {docName.get(id) ?? "Document"}
                        <button type="button" aria-label={`Remove ${docName.get(id) ?? "document"}`} onClick={() => setDocs((list) => list.filter((doc) => doc !== id))}>
                          <Icon name="close" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <label className="cv-sr" htmlFor="cv-input">Message</label>
                <textarea
                  id="cv-input"
                  ref={input}
                  className="cv-ta"
                  rows={1}
                  value={text}
                  maxLength={MAX_BODY}
                  placeholder="Write a message"
                  aria-describedby="cv-aud"
                  onChange={(event) => {
                    setText(event.target.value);
                    grow();
                  }}
                  onKeyDown={onKey}
                />
                <div className="cv-tools">
                  <button
                    type="button"
                    className="cv-ib"
                    aria-label="Attach a document"
                    disabled={!data.documents.length}
                    title={data.documents.length ? "Attach a document" : "No documents to attach yet"}
                    onClick={() => attach.current?.showModal()}
                  >
                    <Icon name="paperclip" />
                  </button>
                  {data.mode === "staff" ? (
                    <label className="cv-tg" title="Critical instruction: ask them to acknowledge it">
                      <input type="checkbox" checked={critical} onChange={(event) => setCritical(event.target.checked)} />
                      <Icon name="alert" />
                      <span aria-hidden="true">Critical</span>
                      <span className="cv-sr">Critical instruction: ask them to acknowledge it</span>
                    </label>
                  ) : null}
                  {/* Staff only: "Draft in French" (src/modules/messages/translation-hook.ts). */}
                  {draftTranslation && data.mode === "staff" ? (
                    <button type="button" className="cv-tg" disabled={!text.trim() || translating || Boolean(french)} onClick={() => void translate()}>
                      <span>{translating ? "Drafting…" : "Draft in French"}</span>
                    </button>
                  ) : null}
                  {data.mode === "staff" && data.templates?.length ? (
                    <details ref={tplMenu} className="cv-menu">
                      <summary className="cv-vob" title="Insert one of the firm’s approved templates">
                        <Icon name="file" />
                        Insert template
                        <Icon name="chevron-down" />
                      </summary>
                      <div className="cv-pop" role="menu">
                        {data.templates.map((template) => (
                          <button key={template.id} type="button" role="menuitem" onClick={() => insertTemplate(template.body)}>
                            <b>{template.name}</b>
                            <small>{template.body.length > 70 ? `${template.body.slice(0, 69)}…` : template.body}</small>
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {data.mode === "staff" && data.vo?.enabled && thread ? (
                    <details ref={voMenu} className="cv-menu">
                      <summary
                        className={`cv-vob${voBusy ? " busy" : ""}`}
                        aria-disabled={voBusy || !data.vo.available ? "true" : undefined}
                        title={data.vo.available ? "Vo drafts for you to review. Nothing is sent." : "Vo is unavailable right now. Write it yourself."}
                        onClick={(event) => {
                          if (voBusy || !data.vo?.available) event.preventDefault();
                        }}
                      >
                        <Icon name="sparkles" />
                        {voBusy ? "Vo is drafting…" : "Vo"}
                        <Icon name="chevron-down" />
                      </summary>
                      <div className="cv-pop" role="menu">
                        <button type="button" role="menuitem" onClick={() => void askVo("message_reply")}>
                          <b>Draft with Vo</b>
                          <small>A reply to the client’s latest message</small>
                        </button>
                        <button type="button" role="menuitem" onClick={() => void askVo("document_request")}>
                          <b>Explain requests with Vo</b>
                          <small>The open document requests, in plain words</small>
                        </button>
                      </div>
                    </details>
                  ) : null}
                  <span className="cv-hint" aria-hidden="true">Enter to send · Shift+Enter for a new line</span>
                  <button type="button" className="btn p cv-send" onClick={send} disabled={!text.trim() || busy}>
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <dialog ref={attach} className="dlg" aria-labelledby="cv-attach-h">
        <div className="dh">
          <h2 id="cv-attach-h">Attach a document</h2>
          <button type="button" className="x" aria-label="Close" onClick={() => attach.current?.close()}>
            <Icon name="close" />
          </button>
        </div>
        <div className="db">
          <p className="lbl" style={{ marginBottom: 10 }}>
            The message links to the document already on file. Each reader opens it with their own access; nothing is copied.
          </p>
          <div className="cv-docs">
            {data.documents.map((doc) => {
              const allowed = attachTo.length ? shareable(doc, attachTo) : true;
              return (
                <label key={doc.id}>
                  <input
                    type="checkbox"
                    disabled={!allowed}
                    checked={docs.includes(doc.id)}
                    onChange={(event) => setDocs((list) => (event.target.checked ? [...list, doc.id].slice(0, 5) : list.filter((id) => id !== doc.id)))}
                  />
                  <span>
                    {doc.label}
                    <small>{allowed ? "Everyone who can read this conversation can open it." : "Not shared with everyone in this conversation."}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="df">
          <button type="button" className="btn p" onClick={() => attach.current?.close()}>
            Done
          </button>
        </div>
      </dialog>
    </section>
  );
}

function ThreadRow({ row, data, current, unread, onOpen }: { row: ChatThread; data: ChatData; current: boolean; unread: number; onOpen: () => void }) {
  return (
    <button type="button" className={`cv-tr${unread ? " un" : ""}`} aria-current={current ? "true" : undefined} onClick={onOpen}>
      <span className={`cv-av${data.mode === "portal" ? " st" : ""}`} aria-hidden="true">{initialOf(row.title)}</span>
      <span className="cv-tm">
        <span className="cv-l1">
          <b>{row.title}</b>
          <time dateTime={row.lastAt}>{listTime(row.lastAt, data.now, data.timezone)}</time>
        </span>
        <span className="cv-l2">
          <small>{row.preview || row.matterTitle}</small>
          {unread ? <span className="cv-badge" aria-label={`${unread} unread`}>{unread}</span> : null}
        </span>
        {data.mode === "portal" && data.matters.length > 1 ? <small>{row.matterTitle}</small> : null}
      </span>
    </button>
  );
}

function DayBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="cv-day" role="separator">{label}</div>
      {children}
    </>
  );
}

function Bubble({
  message,
  data,
  cont,
  newMarker,
  acked,
  onAck,
  onDownload,
}: {
  message: ChatMessage;
  data: ChatData;
  cont: boolean;
  newMarker: boolean;
  acked: boolean;
  onAck: () => void;
  onDownload: (versionId: string) => void;
}) {
  const staffAuthor = message.authorKind === "staff";
  // Staff (OPS-04): delivered to their portal, then read by whom; and the email notice's state.
  const status = data.mode === "staff" ? (message.authorKind === "staff" ? readState(message.readBy) : null) : message.mine ? "Sent" : null;
  const email = data.mode === "staff" && message.authorKind === "staff" ? (message.email ?? null) : null;
  return (
    <>
      {newMarker ? <div className="cv-new">New</div> : null}
      <div className={`cv-row${message.mine ? " me" : ""}${cont ? " cont" : ""}`}>
        {!message.mine ? <span className={`cv-av${staffAuthor ? " st" : ""}`} aria-hidden="true">{initialOf(message.authorName)}</span> : null}
        <div className="cv-b">
          {!message.mine && !cont ? <span className="cv-who">{message.authorName}</span> : null}
          {message.requiresAck ? (
            <span className="cv-crit">
              <Icon name="alert" />
              Critical instruction
            </span>
          ) : null}
          {message.body}
          {message.attachments.length ? (
            <span className="cv-chips">
              {message.attachments.map((file) =>
                file.href ? (
                  <a key={file.documentId} className="cv-chip" href={file.href}>
                    <Icon name="paperclip" />
                    {file.label}
                  </a>
                ) : file.versionId ? (
                  <button key={file.documentId} type="button" className="cv-chip" onClick={() => onDownload(file.versionId ?? "")}>
                    <Icon name="paperclip" />
                    {file.label}
                  </button>
                ) : (
                  <span key={file.documentId} className="cv-chip">
                    <Icon name="paperclip" />
                    {file.label}
                  </span>
                ),
              )}
            </span>
          ) : null}
          {message.requiresAck ? (
            <span className="cv-ack">
              {data.mode === "portal" && !message.mine ? (
                acked ? (
                  <span className="cv-acked"><Icon name="check-circle" />Acknowledged</span>
                ) : (
                  <button type="button" className="btn p sm" onClick={onAck}>Acknowledge</button>
                )
              ) : message.acknowledgedBy.length ? (
                <span className="cv-acked"><Icon name="check-circle" />{`Acknowledged by ${message.acknowledgedBy.join(", ")}`}</span>
              ) : (
                <span>Waiting for acknowledgement</span>
              )}
            </span>
          ) : null}
          <span className="cv-foot">
            <time dateTime={message.createdAt}>{clockLabel(message.createdAt, data.timezone)}</time>
            {message.channel === "whatsapp" ? <span>· WhatsApp</span> : null}
            {status ? <span>· {status}</span> : null}
            {email ? <span>· {email}</span> : null}
          </span>
        </div>
      </div>
    </>
  );
}

/** Shown while the conversations load again after an error. */
export function ChatSkeleton() {
  return (
    <section className="cv" aria-busy="true" aria-label="Loading messages">
      <style dangerouslySetInnerHTML={{ __html: CHAT_CSS }} />
      <div className="cv-list">
        <div className="cv-sk"><i /><i /><i /></div>
      </div>
      <div className="cv-pane">
        <div className="cv-sk"><i /><i /><i /><i /></div>
      </div>
    </section>
  );
}

/** The loader failed: say so, and try again. */
export function ChatError() {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  if (retrying) return <ChatSkeleton />;
  return (
    <section className="cv" aria-label="Messages">
      <style dangerouslySetInnerHTML={{ __html: CHAT_CSS }} />
      <div className="cv-empty" style={{ gridColumn: "1 / -1" }}>
        <div>
          <b>Messages didn’t load</b>
          <small>Nothing was lost. Try again in a moment.</small>
          <button
            type="button"
            className="btn p sm"
            onClick={() => {
              setRetrying(true);
              router.refresh();
              window.setTimeout(() => setRetrying(false), 4000);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}
