package com.veloq;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;

/**
 * The body of a tile the tile host is still being asked for.
 *
 * <p>The interceptor hands this to the WebView at once, and the WebView reads
 * it off its own thread. {@code read} waits until the engine calls
 * {@link #complete} or {@link #fail}, so no thread is held while the request
 * is on the wire. A failure reaches the page as a network error, which the
 * map counts as a tile error and asks for again on the next pan.
 */
public final class PendingTile extends InputStream {

  /**
   * How long a read waits before giving up on the engine. Past the tile
   * client's own timeout, so this fires only when the engine never answers.
   */
  static final long DEADLINE_MS = 30_000;

  private final long deadlineMs;
  private byte[] bytes;
  private int failed;
  private int position;

  public PendingTile() {
    this(DEADLINE_MS);
  }

  PendingTile(long deadlineMs) {
    this.deadlineMs = deadlineMs;
  }

  /** The tile arrived. Called once, from the engine's runtime. */
  public synchronized void complete(byte[] tile) {
    if (isSettled()) return;
    bytes = tile == null ? new byte[0] : tile;
    notifyAll();
  }

  /** The tile host answered {@code status} rather than a tile. */
  public synchronized void fail(int status) {
    if (isSettled()) return;
    failed = status == 0 ? 502 : status;
    notifyAll();
  }

  synchronized boolean isSettled() {
    return bytes != null || failed != 0;
  }

  private void awaitSettled() throws IOException {
    long until = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(deadlineMs);
    while (!isSettled()) {
      long left = until - System.nanoTime();
      if (left <= 0) {
        failed = 504;
        break;
      }
      try {
        TimeUnit.NANOSECONDS.timedWait(this, left);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IOException("interrupted waiting for a tile", e);
      }
    }
    if (failed != 0) {
      throw new IOException("tile host answered " + failed);
    }
  }

  @Override
  public synchronized int read() throws IOException {
    awaitSettled();
    return position < bytes.length ? (bytes[position++] & 0xff) : -1;
  }

  @Override
  public synchronized int read(byte[] into, int offset, int length) throws IOException {
    if (length == 0) return 0;
    awaitSettled();
    if (position >= bytes.length) return -1;
    int n = Math.min(length, bytes.length - position);
    System.arraycopy(bytes, position, into, offset, n);
    position += n;
    return n;
  }

  @Override
  public synchronized int available() {
    return bytes == null ? 0 : bytes.length - position;
  }
}
