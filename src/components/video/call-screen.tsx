"use client";

import "@livekit/components-styles";
import "./call.css";
import {
  LiveKitRoom,
  PreJoin,
  RoomAudioRenderer,
  VideoConference,
  useConnectionState,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useRemoteParticipants,
  useRoomContext,
  type LocalUserChoices,
} from "@livekit/components-react";
import {
  ConnectionState,
  RemoteVideoTrack,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  type TrackPublication,
} from "livekit-client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { deviceNotice, identityRole, startDevices } from "@/modules/video/devices";
import { callNotice, type JoinView } from "@/modules/video/present";

type Back = { href: string; label: string };

type Props =
  | { kind: "refused"; back: Back; title?: string; copy?: string }
  | { kind: "call"; organizationId: string; callRef: string; view: JoinView; back: Back; guestToken?: string | null };

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

const noSubscribe = () => () => undefined;

/**
 * True in the browser, false on the server and during hydration. The call time is formatted in the
 * viewer's own zone, which the server (UTC on Workers) doesn't know, so it is shown only once
 * hydrated, never as server text that would mismatch.
 */
function useInBrowser(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
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
          <h1>{props.title ?? "You can’t join this call"}</h1>
          <p>
            {props.copy ??
              "Only the client the consultation is with, its host and the firm’s owners can open it. Sign in with the account the booking is under. Staff need two-step sign-in first."}
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

function Call({ organizationId, callRef, view, back, guestToken }: Extract<Props, { kind: "call" }>) {
  const router = useRouter();
  const inBrowser = useInBrowser();
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
    const result = await post<Grant & { view?: JoinView; configured?: boolean }>(
      `/api/video/${callRef}/token`,
      guestToken ? { guestToken, name: choices.username } : { organizationId },
    );
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
            {inBrowser ? when(view) : "\u00a0"}
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
            // A guest (CRM-03) confirms the name on their booking here; it is the name the host sees.
            defaults={{ username: guestToken ? (view.bookedName ?? "") : view.role === "host" ? "Host" : "Client", videoEnabled: true, audioEnabled: true }}
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
          // Devices are started by InCall once connected (and, for a client, let in), never by
          // LiveKitRoom: its device errors reach onError, and a missing camera ended the call.
          video={false}
          audio={false}
          onDisconnected={() => setStep({ name: "left" })}
          // Only the connection itself now (connect refused, no server URL): a device that can't
          // start is a notice inside the call (onMediaDeviceFailure, InCall).
          onError={(error) => {
            console.warn("[call] connection failed", { error: error?.name ?? "Error" });
            setStep({ name: "problem", title: "We couldn’t connect you", copy: "Your connection to the call was lost or couldn’t start. Try joining again." });
          }}
          onMediaDeviceFailure={(failure, kind) => console.warn("[call] device failure", { failure, kind })}
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
  const connection = useConnectionState();
  const room = useRoomContext();
  const admitted = grant.role === "host" || (permissions ? permissions.canPublish && permissions.canSubscribe : grant.admitted);
  const [deviceProblem, setDeviceProblem] = useState<string | null>(null);
  useCallDiagnostics(room);

  // Once connected and allowed to publish (a host at once, a client when let in), start the
  // devices chosen in the pre-join step. One that fails leaves the person in the call with it off.
  const started = useRef(false);
  useEffect(() => {
    if (!admitted || started.current || connection !== ConnectionState.Connected) return;
    started.current = true;
    console.info("[call] starting devices", { role: grant.role, camera: choices.videoEnabled, microphone: choices.audioEnabled });
    void startDevices(localParticipant, choices).then((failed) => setDeviceProblem(deviceNotice(failed)));
  }, [admitted, choices, connection, grant.role, localParticipant]);

  if (!admitted) return <Lobby hostName={hostName} />;
  return (
    <>
      {grant.role === "host" ? <HostBar organizationId={organizationId} callRef={callRef} /> : null}
      {deviceProblem ? (
        <p className="cv-call-device" role="status">
          {deviceProblem}
          <button className="btn sm" type="button" onClick={() => setDeviceProblem(null)}>
            OK
          </button>
        </p>
      ) : null}
      <VideoConference />
    </>
  );
}

function trackLabel(publication: TrackPublication | undefined): Record<string, unknown> {
  return { source: publication?.source ?? "unknown", kind: publication?.kind ?? "unknown", muted: publication?.isMuted ?? null };
}

/**
 * Browser console diagnostics for a call ("[call] …"): connection changes, what is published and
 * subscribed, permission changes (a client being let in), and a few seconds after a camera starts
 * or is received, whether video frames are really flowing. For a black tile this tells "the
 * camera sends no frames" (local `muted`/`framesSent: 0` on the sender) from "frames are sent but
 * not received or decoded" (remote `framesDecoded: 0`). No ids, tokens or names are logged.
 */
function useCallDiagnostics(room: Room) {
  useEffect(() => {
    const timers: number[] = [];
    const later = (run: () => Promise<void>) => {
      timers.push(window.setTimeout(() => void run().catch(() => undefined), 5000));
    };
    const who = (participant: Participant | undefined) => identityRole(participant?.identity);
    const onState = (state: ConnectionState) => console.info("[call] connection", { state });
    const onDisconnected = (reason?: unknown) => console.info("[call] disconnected", { reason });
    const onLocalPublished = (publication: LocalTrackPublication) => {
      console.info("[call] published", trackLabel(publication));
      if (publication.source !== Track.Source.Camera) return;
      later(async () => {
        const track = publication.videoTrack;
        const media = track?.mediaStreamTrack;
        const settings = media?.getSettings();
        const sent = track ? await track.getSenderStats() : [];
        console.info("[call] camera after 5s", {
          readyState: media?.readyState ?? null,
          // true: the camera gives no frames (often in use by another app or covered).
          trackMuted: media?.muted ?? null,
          width: settings?.width ?? null,
          height: settings?.height ?? null,
          framesSent: sent.reduce((sum, layer) => sum + (layer.framesSent ?? 0), 0),
        });
      });
    };
    const onRemotePublished = (publication: RemoteTrackPublication, participant: RemoteParticipant) =>
      console.info("[call] remote published", { from: who(participant), ...trackLabel(publication), subscribed: publication.isSubscribed });
    const onSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      console.info("[call] subscribed", { from: who(participant), ...trackLabel(publication) });
      if (!(track instanceof RemoteVideoTrack)) return;
      later(async () => {
        const stats = await track.getReceiverStats();
        const decoded = stats ? stats.framesDecoded : null;
        const log = decoded === 0 ? console.warn : console.info;
        log("[call] remote video after 5s", {
          from: who(participant),
          source: publication.source,
          muted: publication.isMuted,
          framesReceived: stats?.framesReceived ?? null,
          framesDecoded: decoded,
          width: stats?.frameWidth ?? null,
          height: stats?.frameHeight ?? null,
        });
      });
    };
    const onSubscriptionFailed = (_sid: string, participant: RemoteParticipant, reason?: unknown) =>
      console.warn("[call] subscription failed", { from: who(participant), reason });
    const onMuted = (publication: TrackPublication, participant: Participant) => console.info("[call] muted", { who: who(participant), ...trackLabel(publication) });
    const onUnmuted = (publication: TrackPublication, participant: Participant) => console.info("[call] unmuted", { who: who(participant), ...trackLabel(publication) });
    const onPermissions = (_previous: unknown, participant: Participant) =>
      console.info("[call] permissions", {
        who: participant === room.localParticipant ? "me" : who(participant),
        canPublish: participant.permissions?.canPublish ?? null,
        canSubscribe: participant.permissions?.canSubscribe ?? null,
      });
    const onDeviceError = (error: Error, kind?: MediaDeviceKind) => console.warn("[call] device error", { error: error?.name, kind });
    room
      .on(RoomEvent.ConnectionStateChanged, onState)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.LocalTrackPublished, onLocalPublished)
      .on(RoomEvent.TrackPublished, onRemotePublished)
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackSubscriptionFailed, onSubscriptionFailed)
      .on(RoomEvent.TrackMuted, onMuted)
      .on(RoomEvent.TrackUnmuted, onUnmuted)
      .on(RoomEvent.ParticipantPermissionsChanged, onPermissions)
      .on(RoomEvent.MediaDevicesError, onDeviceError);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      room
        .off(RoomEvent.ConnectionStateChanged, onState)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.LocalTrackPublished, onLocalPublished)
        .off(RoomEvent.TrackPublished, onRemotePublished)
        .off(RoomEvent.TrackSubscribed, onSubscribed)
        .off(RoomEvent.TrackSubscriptionFailed, onSubscriptionFailed)
        .off(RoomEvent.TrackMuted, onMuted)
        .off(RoomEvent.TrackUnmuted, onUnmuted)
        .off(RoomEvent.ParticipantPermissionsChanged, onPermissions)
        .off(RoomEvent.MediaDevicesError, onDeviceError);
    };
  }, [room]);
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
