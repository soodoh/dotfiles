export function requestViaEvent<TRequest extends { requestId: string; respond: (response: unknown) => void }, TResult>(events: any, channel: string, request: Omit<TRequest, "requestId" | "respond">, timeoutMs = 10_000): Promise<TResult> {
  const requestId = `pwf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${channel}`)), timeoutMs);
    const payload = {
      ...request,
      requestId,
      respond: (response: unknown) => { clearTimeout(timeout); resolve(response as TResult); },
    };
    events.emit(channel, payload);
  });
}

export function waitForEvent<T>(events: any, channel: string, predicate: (event: T) => boolean, timeoutMs = 24 * 60 * 60 * 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const off = events.on(channel, (data: T) => {
      if (!predicate(data)) return;
      cleanup(); resolve(data);
    });
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${channel}`)); }, timeoutMs);
    function cleanup() { clearTimeout(timer); if (typeof off === "function") off(); }
  });
}
