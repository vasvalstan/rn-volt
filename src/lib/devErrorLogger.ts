type GlobalErrorUtils = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

const installedKey = "__voltDevErrorLoggerInstalled";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, error.stack].filter(Boolean).join("\n");
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function logDevError(label: string, error: unknown, extra?: Record<string, unknown>) {
  const payload = extra ? `${formatError(error)}\n${JSON.stringify(extra, null, 2)}` : formatError(error);
  console.error(`[VOLT_DEV_ERROR] ${label}\n${payload}`);
}

export function installDevErrorLogger() {
  if (!__DEV__) return;

  const globalWithMarker = globalThis as typeof globalThis & {
    [installedKey]?: boolean;
    ErrorUtils?: GlobalErrorUtils;
    onunhandledrejection?: (event: unknown) => void;
  };

  if (globalWithMarker[installedKey]) return;
  globalWithMarker[installedKey] = true;

  const errorUtils = globalWithMarker.ErrorUtils;
  const previousGlobalHandler = errorUtils?.getGlobalHandler?.();

  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    logDevError("global-handler", error, { isFatal: Boolean(isFatal) });
    previousGlobalHandler?.(error, isFatal);
  });

  const previousUnhandledRejection = globalWithMarker.onunhandledrejection;
  globalWithMarker.onunhandledrejection = (event: unknown) => {
    const reason =
      event && typeof event === "object" && "reason" in event
        ? (event as { reason?: unknown }).reason
        : event;
    logDevError("unhandled-promise-rejection", reason);
    previousUnhandledRejection?.(event);
  };

  console.log("[VOLT_DEV_ERROR] logger installed");
}
