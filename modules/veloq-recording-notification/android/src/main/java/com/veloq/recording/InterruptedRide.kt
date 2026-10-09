package com.veloq.recording

/** What the rider is told when a ride's process died, in the words JavaScript translated. */
data class InterruptedRideNotice(
  val session: Long,
  val channel: String,
  val title: String,
  val body: String
)

/** Where the notice waits between the process that ran the ride and the one that starts next. */
interface InterruptedRideStore {
  fun read(): InterruptedRideNotice?
  fun write(notice: InterruptedRideNotice)
  fun remove()
}

/**
 * Whether a process starting now follows a ride that never ended.
 *
 * Android cannot restart the ride's location service from the background: the foreground service is
 * refused, and the app has no location access without it. No JavaScript runs either, so the restart
 * is silent unless something native speaks. A live ride arms the notice, a ride that ends disarms it,
 * and the next process start takes whatever is armed. A process only starts while a ride is armed when
 * the one holding the ride died, because a live ride keeps its own process alive.
 */
class InterruptedRide(private val store: InterruptedRideStore) {
  /**
   * The ride is live and drawn. Rewritten only when what the notice would say changes, and true when
   * it was, which is also the first batch after a start took the notice.
   */
  fun armed(notice: InterruptedRideNotice): Boolean {
    if (store.read() == notice) return false
    store.write(notice)
    return true
  }

  /** The ride ended the ordinary way, so a later start has nothing to report. */
  fun disarmed() {
    store.remove()
  }

  /** The notice for a ride the last process left live, taken once so later starts stay quiet. */
  fun takeAtProcessStart(): InterruptedRideNotice? {
    val notice = store.read() ?: return null
    store.remove()
    return notice
  }

  companion object {
    /** A notice with nothing to say is not armed: an empty notification tells the rider less than none. */
    fun notice(session: Long, channel: String?, title: String?, body: String?): InterruptedRideNotice? {
      if (channel.isNullOrBlank() || title.isNullOrBlank() || body.isNullOrBlank()) return null
      return InterruptedRideNotice(session, channel, title, body)
    }
  }
}
