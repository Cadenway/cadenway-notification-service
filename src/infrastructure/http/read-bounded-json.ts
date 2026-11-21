/** Reads private JSON without buffering an unbounded or timed-out upstream body. */
export async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<unknown> {
  if (response.body === null) throw new Error('An upstream response body is required.');
  const reader = response.body.getReader();
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return JSON.parse(text + decoder.decode()) as unknown;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new Error('An upstream response exceeded its size limit.');
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error: unknown) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
