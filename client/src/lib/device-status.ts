export type DeviceStatus = {
  batteryPercent: number | null;
  charging: boolean | null;
  signalDbm: number | null;
  networkDownlinkMbps: number | null;
  cpuCores: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  source: "native" | "browser" | "unavailable";
};

type DeviceStatusPlugin = { getStatus?: () => Promise<DeviceStatus> };
type NavigatorWithDeviceApis = Navigator & {
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
  connection?: { downlink?: number };
  deviceMemory?: number;
};

export async function readDeviceStatus(): Promise<DeviceStatus> {
  const root = globalThis as typeof globalThis & {
    Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, DeviceStatusPlugin> };
  };
  const native = root.Capacitor;
  const plugin = native?.Plugins?.DeviceStatusBridge;
  if (native?.isNativePlatform?.() && plugin?.getStatus) {
    try { return { ...(await plugin.getStatus()), source: "native" }; } catch { /* fall through */ }
  }

  const browser = navigator as NavigatorWithDeviceApis;
  try {
    const battery = await browser.getBattery?.();
    const connection = browser.connection;
    return {
      batteryPercent: battery ? Math.round(battery.level * 100) : null,
      charging: battery?.charging ?? null,
      signalDbm: null,
      networkDownlinkMbps: typeof connection?.downlink === "number" ? connection.downlink : null,
      cpuCores: navigator.hardwareConcurrency ?? null,
      ramUsedMb: null,
      ramTotalMb: browser.deviceMemory ? Math.round(browser.deviceMemory * 1024) : null,
      source: battery || connection || navigator.hardwareConcurrency ? "browser" : "unavailable",
    };
  } catch {
    return { batteryPercent: null, charging: null, signalDbm: null, networkDownlinkMbps: null, cpuCores: null, ramUsedMb: null, ramTotalMb: null, source: "unavailable" };
  }
}
