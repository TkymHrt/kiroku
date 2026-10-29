export interface NetworkDeadlineOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Bound the complete request, including response parsing and adapter work. */
export async function withNetworkDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: NetworkDeadlineOptions = {},
): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline!: (error: DOMException) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const interrupt = (error: DOMException) => {
    // Settle our promise even if a response parser or injected transport ignores abort.
    rejectDeadline(error);
    controller.abort(error);
  };
  const cancel = () => interrupt(new DOMException("Request cancelled", "AbortError"));
  if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(
    () => interrupt(new DOMException("Request timed out", "TimeoutError")),
    options.timeoutMs ?? 15_000,
  );
  try {
    return await Promise.race([request(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
