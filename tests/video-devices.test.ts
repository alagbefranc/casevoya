import { describe, expect, it, vi } from "vitest";
import { deviceNotice, identityRole, startDevices, type DevicePublisher } from "@/modules/video/devices";

// A device that can't start never ends the call (prod test 2026-10-22: the host's first join on a
// machine with no camera dropped as "The call dropped"). The person joins with it off and is told.

function publisher(fail: { camera?: "always" | "chosen"; microphone?: "always" | "chosen" } = {}) {
  const calls: string[] = [];
  const make = (kind: "camera" | "microphone") =>
    vi.fn(async (on: boolean, options?: { deviceId?: string }) => {
      calls.push(`${kind}:${on ? "on" : "off"}${options?.deviceId ? `:${options.deviceId}` : ""}`);
      const mode = fail[kind];
      if (on && (mode === "always" || (mode === "chosen" && options?.deviceId))) {
        throw Object.assign(new Error("Requested device not found"), { name: "NotFoundError" });
      }
    });
  const p = { setCameraEnabled: make("camera"), setMicrophoneEnabled: make("microphone") } satisfies DevicePublisher;
  return { p, calls };
}

const warn = () => undefined;

describe("startDevices", () => {
  it("starts what was chosen, with the chosen devices", async () => {
    const { p, calls } = publisher();
    const failed = await startDevices(p, { videoEnabled: true, audioEnabled: true, videoDeviceId: "cam-1", audioDeviceId: "mic-1" }, warn);
    expect(failed).toEqual([]);
    expect(calls).toEqual(["microphone:on:mic-1", "camera:on:cam-1"]);
  });

  it("starts nothing that was turned off", async () => {
    const { p, calls } = publisher();
    expect(await startDevices(p, { videoEnabled: false, audioEnabled: false }, warn)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("no camera or microphone at all: never throws, both reported, both left off", async () => {
    const { p, calls } = publisher({ camera: "always", microphone: "always" });
    const failed = await startDevices(p, { videoEnabled: true, audioEnabled: true, videoDeviceId: "default", audioDeviceId: "" }, warn);
    expect(failed).toEqual(["microphone", "camera"]);
    expect(calls).toEqual(["microphone:on", "microphone:off", "camera:on", "camera:off"]);
  });

  it("a chosen device that is gone falls back to the default one", async () => {
    const { p, calls } = publisher({ camera: "chosen" });
    expect(await startDevices(p, { videoEnabled: true, audioEnabled: false, videoDeviceId: "unplugged" }, warn)).toEqual([]);
    expect(calls).toEqual(["camera:on:unplugged", "camera:on"]);
  });

  it("logs the failure by error name only", async () => {
    const { p } = publisher({ camera: "always" });
    const log = vi.fn();
    await startDevices(p, { videoEnabled: true, audioEnabled: false }, log);
    expect(log).toHaveBeenCalledWith("[call] camera could not start", { error: "NotFoundError" });
  });
});

describe("deviceNotice and identityRole", () => {
  it("says what didn't start", () => {
    expect(deviceNotice([])).toBeNull();
    expect(deviceNotice(["camera"])).toMatch(/^Your camera didn’t start, so you’re in the call with it off/);
    expect(deviceNotice(["microphone"])).toMatch(/^Your microphone didn’t start/);
    expect(deviceNotice(["microphone", "camera"])).toMatch(/^Your camera and microphone didn’t start, so you’re in the call with them off/);
  });

  it("keeps ids out of logs", () => {
    expect(identityRole("staff:0b3d9e37-738d-47c4-847d-72ebdbfe4a8b")).toBe("staff");
    expect(identityRole("client:445a122c-8aec-4aa2-a82f-a9171a41a80c")).toBe("client");
    expect(identityRole(undefined)).toBe("other");
  });
});
