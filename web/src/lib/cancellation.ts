/** Cancel one caller's wait without aborting a shared request. */
export function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Request cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Request cancelled", "AbortError"));
    signal.addEventListener("abort", abort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
