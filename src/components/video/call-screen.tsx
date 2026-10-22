"use client";

import "@livekit/components-styles";
import "./call.css";
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  VideoConference,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useRemoteParticipants,
  useRoomContext,
  type LocalUserChoices,
} from "@livekit/components-react";
import type { RemoteParticipant } from "livekit-client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callNotice, type JoinView } from "@/modules/video/present";

type Back = { href: string; label: string };

type Props =
  | { kind: "refused"; back: Back }
  | { kind: "call"; organizationId: string; callRef: string; view: JoinView; back: Back };

type Grant = { serverUrl: string; token: string; identity: string; role: "host" | "client"; admitted: boolean };

type Step =
  | { name: "prejoin" }
  | { name: "joining"; choices: LocalUserChoices }
  | { name: "in"; choices: LocalUserChoices; grant: Grant }
  | { name: "left" }
  | { name: "problem"; title: string; copy: string };

function when(view: Pick<JoinView, "startsAt" | "endsAt">): string {
  const start = new Date(view.startsAt);
  const end = new Date(view.endsAt);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(start).find((part) => part.type === "timeZoneName")?.value ?? "";
  return `${day}, ${time.format(start)}–${time.format(end)} ${zone}`.trim();
}

async function post<T>(url: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) return { ok: false, error: data.error ?? "Something went wrong. Try again." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "You seem to be offline. Check your connection and try again." };
  }
}

/** The video call page (BUILD-SPEC §7.4): pre-join, the lobby, the call, and what to do after. */
export function CallScreen(props: Props) {
  if (props.kind === "refused") {
    return (
      <main className="cv-call">
        <section className="cv-call-card" role="alert">
          <h1>You can’t join this call</h1>
          <p>
            Only the client the consultation is with, its host and the firm’s owners can open it. Sign in with the account the booking is
            under. Staff need two-step sign-in first.
          </p>
          <a className="btn p" href={props.back.href}>
            {props.back.label}
          </a>
        </section>
      </main>
    );
  }
  return <Call {...props} />;
}

function Call({ organizationId, callRef, view, back }: Extract<Props, { kind: "call" }>) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "prejoin" });
  const notice = callNotice(view);

  // Before the window, reload when it opens (the server decides; this only asks again).
  useEffect(() => {
    if (view.state !== "early") return;
    const wait = Date.parse(view.opensAt) - Date.now() + 1000;
    const timer = window.setTimeout(() => router.refresh(), Math.min(Math.max(wait, 5000), 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [router, view.opensAt, view.state]);

  async function join(choices: LocalUserChoices) {
    setStep({ name: "joining", choices });
    const result = await post<Grant & { view?: JoinView; configured?: boolean }>(`/api/video/${callRef}/token`, { organizationId });
    if (!result.ok) {
      setStep({ name: "problem", title: "We couldn’t connect you", copy: result.error });
      return;
    }
    if (result.data.configured === false) {
      setStep({ name: "problem", title: "Video calls aren’t set up yet", copy: `${view.firmName} can’t host calls in Casevoya yet. Message them to agree another way to meet.` });
      return;
    }
    if (!result.data.token) {
      router.refresh();
      setStep({ name: "prejoin" });
      return;
    }
    setStep({ name: "in", choices, grant: result.data });
  }

  return (
    <main className="cv-call">
      <header className="cv-call-head">
        <div>
          <small>{view.firmName}</small>
          <h1>{view.title}</h1>
          <p>
            {when(view)}
            {view.hostName ? ` · with ${view.hostName}` : ""}
            {view.isSample ? " · Sample (practice)" : ""}
          </p>
        </div>
        {step.name === "in" ? null : (
          <a className="btn s sm" href={back.href}>
            {back.label}
          </a>
        )}
      </header>

      {notice ? (
        <section className="cv-call-card" role="status">
          <h2>{notice.title}</h2>
          <p>{notice.copy}</p>
        </section>
      ) : step.name === "prejoin" || step.name === "joining" ? (
        <section className="cv-call-prejoin" data-lk-theme="default" aria-busy={step.name === "joining"}>
          <p className="cv-call-lead">
            {view.role === "host"
              ? "Check your camera and microphone, then start the call. Your client waits until you let them in."
              : `Check your camera and microphone, then join. ${view.hostName ?? view.firmName} lets you in when they’re ready.`}
          </p>
          <PreJoin
            defaults={{ username: view.role === "host" ? "Host" : "Client", videoEnabled: true, audioEnabled: true }}
            persistUserChoices={false}
            joinLabel={step.name === "joining" ? "Connecting…" : view.role === "host" ? "Start the call" : "Join the call"}
            micLabel="Microphone"
            camLabel="Camera"
            onSubmit={(choices) => {
              if (step.name !== "joining") void join(choices);
            }}
            onError={() => undefined}
          />
          <p className="cv-call-fine">The call isn’t recorded. Chat messages aren’t saved.</p>
        </section>
      ) : step.name === "in" ? (
        <LiveKitRoom
          className="cv-call-room"
          data-lk-theme="default"
          serverUrl={step.grant.serverUrl}
          token={step.grant.token}
          connect
          // A client in the lobby can't publish yet; their devices start once they're let in.
          video={step.grant.admitted && step.choices.videoEnabled ? { deviceId: step.choices.videoDeviceId } : false}
          audio={step.grant.admitted && step.choices.audioEnabled ? { deviceId: step.choices.audioDeviceId } : false}
          onDisconnected={() => setStep({ name: "left" })}
          onError={() => setStep({ name: "problem", title: "The call dropped", copy: "Your connection to the call was lost. Try joining again." })}
        >
          <InCall organizationId={organizationId} callRef={callRef} grant={step.grant} choices={step.choices} hostName={view.hostName ?? view.firmName} />
          <RoomAudioRenderer />
        </LiveKitRoom>
      ) : (
        <section className="cv-call-card" role="status">
          <h2>{step.name === "left" ? "You left the call" : step.title}</h2>
          <p>{step.name === "left" ? "You can join again while the call is open." : step.copy}</p>
          <div className="cv-call-acts">
            <button className="btn p" type="button" onClick={() => setStep({ name: "prejoin" })}>
              Join again
            </button>
            <a className="btn" href={back.href}>
              {back.label}
            </a>
          </div>
        </section>
      )}
    </main>
  );
}

function InCall({ organizationId, callRef, grant, choices, hostName }: { organizationId: string; callRef: string; grant: Grant; choices: LocalUserChoices; hostName: string }) {
  const permissions = useLocalParticipantPermissions();
  const { localParticipant } = useLocalParticipant();
  const admitted = grant.role === "host" || (permissions ? permissions.canPublish && permissions.canSubscribe : grant.admitted);

  // Let in after joining: start the devices the client chose in the pre-join step.
  const started = useRef(grant.admitted);
  useEffect(() => {
    if (!admitted || started.current) return;
    started.current = true;
    void localParticipant.setCameraEnabled(choices.videoEnabled, choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined).catch(() => undefined);
    void localParticipant.setMicrophoneEnabled(choices.audioEnabled, choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined).catch(() => undefined);
  }, [admitted, choices, localParticipant]);

  if (!admitted) return <Lobby hostName={hostName} />;
  return (
    <>
      {grant.role === "host" ? <HostBar organizationId={organizationId} callRef={callRef} /> : null}
      <VideoConference />
    </>
  );
}

function Lobby({ hostName }: { hostName: string }) {
  const room = useRoomContext();
  return (
    <section className="cv-call-card cv-call-lobby" role="status" aria-live="polite">
      <h2>Waiting for {hostName} to let you in</h2>
      <p>Stay on this page. The call starts here as soon as you’re let in. Nobody can see or hear you yet.</p>
      <div className="cv-call-acts">
        <button className="btn" type="button" onClick={() => void room.disconnect()}>
          Leave
        </button>
      </div>
    </section>
  );
}

/** The host's lobby list and End for everyone. */
function HostBar({ organizationId, callRef }: { organizationId: string; callRef: string }) {
  const room = useRoomContext();
  // Re-read on every participant event (the list can be the same array with changed people in it).
  const remotes = useRemoteParticipants();
  const waiting = remotes.filter((p: RemoteParticipant) => p.attributes?.role === "client" && p.attributes?.admitted !== "1" && !p.permissions?.canPublish);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(identity: string, admit: boolean) {
    setBusy(identity);
    setError(null);
    const result = await post(`/api/video/${callRef}/admit`, { organizationId, identity, admit });
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  async function endForAll() {
    if (!window.confirm("End the call for everyone? People in it are disconnected.")) return;
    setBusy("end");
    const result = await post(`/api/video/${callRef}/end`, { organizationId });
    setBusy(null);
    if (!result.ok) setError(result.error);
    else void room.disconnect();
  }

  return (
    <div className="cv-call-hostbar">
      {waiting.length ? (
        <ul aria-label="Waiting to join" aria-live="polite">
          {waiting.map((person) => (
            <li key={person.identity}>
              <span>
                <b>{person.name || "Your client"}</b> is waiting
              </span>
              <button className="btn p sm" type="button" disabled={busy === person.identity} onClick={() => void decide(person.identity, true)}>
                Let in
              </button>
              <button className="btn sm" type="button" disabled={busy === person.identity} onClick={() => void decide(person.identity, false)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="cv-call-quiet">Nobody is waiting.</span>
      )}
      {error ? (
        <span className="cv-call-error" role="alert">
          {error}
        </span>
      ) : null}
      <button className="btn sm cv-call-end" type="button" disabled={busy === "end"} onClick={() => void endForAll()}>
        End for everyone
      </button>
    </div>
  );
}
