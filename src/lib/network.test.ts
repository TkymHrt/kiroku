import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { withNetworkDeadline } from "./network";

afterEach(() => vi.useRealTimers());

describe("network deadlines", () => {
  it("bounds stalled response headers and aborts the transport", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const pending = withNetworkDeadline((requestSignal) => {
      signal = requestSignal;
      return new Promise<Response>(() => {});
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active while a JSON response body is stalled", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    const response = new Response(new ReadableStream(), {
      headers: { "Content-Type": "application/json" },
    });
    const pending = withNetworkDeadline(
      async (requestSignal) => {
        signal = requestSignal;
        return response.json();
      },
      { timeoutMs: 500 },
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(signal.aborted).toBe(true);
  });

  it("distinguishes caller cancellation and removes its listener on success", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let requestSignal!: AbortSignal;
    const pending = withNetworkDeadline(
      (signal) => {
        requestSignal = signal;
        return new Promise<void>(() => {});
      },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(requestSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const finishedController = new AbortController();
    let finishedSignal!: AbortSignal;
    await expect(
      withNetworkDeadline(
        async (signal) => {
          finishedSignal = signal;
          return "done";
        },
        { signal: finishedController.signal },
      ),
    ).resolves.toBe("done");
    finishedController.abort();
    expect(finishedSignal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts a request that was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    await expect(withNetworkDeadline(request, { signal: controller.signal })).rejects.toMatchObject(
      {
        name: "AbortError",
      },
    );
    expect(request).not.toHaveBeenCalled();
  });
});
