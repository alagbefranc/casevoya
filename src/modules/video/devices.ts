/**
 * Starting the camera and microphone in a call (browser side, no LiveKit import so it can be
 * tested with a fake participant). A device that can't start (none plugged in, blocked, in use
 * by another app, a saved device that is gone) never ends the call: the person stays in with
 * that device off and is told so. Before this, LiveKitRoom's own `audio`/`video` props started
 * them and a failure reached `onError`, which the call page treated as a lost connection
 * (prod test 2026-10-22: the host's first "Start the call" on a machine with no camera dropped
 * within a second; "Join again" with both off worked).
 */

export type DeviceKind = "camera" | "microphone";

export type DeviceChoices = {
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
};

type DeviceOptions = { deviceId?: string } | undefined;

/** The two LocalParticipant methods used (livekit-client). */
export type DevicePublisher = {
  setCameraEnabled(enabled: boolean, options?: DeviceOptions): Promise<unknown>;
  setMicrophoneEnabled(enabled: boolean, options?: DeviceOptions): Promise<unknown>;
};

type Warn = (message: string, detail?: Record<string, unknown>) => void;

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "Error";
}

/** A chosen device id worth asking for; "" and "default" mean the browser's default. */
function chosen(id: string | undefined): string | undefined {
  return id && id !== "default" ? id : undefined;
}

async function startOne(kind: DeviceKind, enable: (on: boolean, options?: DeviceOptions) => Promise<unknown>, deviceId: string | undefined, warn: Warn): Promise<boolean> {
  try {
    await enable(true, deviceId ? { deviceId } : undefined);
    return true;
  } catch (error) {
    warn(`[call] ${kind} could not start${deviceId ? " with the chosen device" : ""}`, { error: errorName(error) });
  }
  if (deviceId) {
    // The device picked before joining may be gone or busy: the default one may still work.
    try {
      await enable(true, undefined);
      return true;
    } catch (error) {
      warn(`[call] ${kind} could not start with the default device`, { error: errorName(error) });
    }
  }
  await enable(false).catch(() => undefined);
  return false;
}

/**
 * Turns on what the person chose before joining, one device at a time. Answers the devices that
 * were chosen but couldn't start (empty when all is well). Never throws.
 */
export async function startDevices(participant: DevicePublisher, choices: DeviceChoices, warn: Warn = (message, detail) => console.warn(message, detail)): Promise<DeviceKind[]> {
  const failed: DeviceKind[] = [];
  if (choices.audioEnabled) {
    const ok = await startOne("microphone", (on, options) => participant.setMicrophoneEnabled(on, options), chosen(choices.audioDeviceId), warn);
    if (!ok) failed.push("microphone");
  }
  if (choices.videoEnabled) {
    const ok = await startOne("camera", (on, options) => participant.setCameraEnabled(on, options), chosen(choices.videoDeviceId), warn);
    if (!ok) failed.push("camera");
  }
  return failed;
}

/** What the call page says when a device didn't start. Null when nothing failed. */
export function deviceNotice(failed: readonly DeviceKind[]): string | null {
  const camera = failed.includes("camera");
  const mic = failed.includes("microphone");
  if (!camera && !mic) return null;
  const what = camera && mic ? "Your camera and microphone" : camera ? "Your camera" : "Your microphone";
  const them = camera && mic ? "them" : "it";
  return `${what} didn’t start, so you’re in the call with ${them} off. Check that no other app is using ${them} and that the browser may use ${them}, then turn ${them} on with the buttons below.`;
}

/** A participant identity for logs without the person's id: "staff", "client" or "other". */
export function identityRole(identity: string | undefined): "staff" | "client" | "other" {
  if (identity?.startsWith("staff:")) return "staff";
  if (identity?.startsWith("client:")) return "client";
  return "other";
}
