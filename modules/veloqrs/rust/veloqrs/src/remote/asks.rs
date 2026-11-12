//! Where a connection's asks are answered: a small pool of worker threads
//! shared by every connection, and a queue per connection.
//!
//! The thread that serves a connection also drives its ICE, DTLS and SCTP
//! timers, so it never runs a read. It hands each ask to this pool and
//! collects the replies the workers send back. Asks of one connection start in
//! the order they came, and may finish in any order.

use std::collections::{HashSet, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use str0m::channel::ChannelId;

use super::peer::Gate;
use super::protocol::{self, MAX_OUTSTANDING};

/// The worker threads in the process.
const WORKERS: usize = 2;

/// The workers, alive while any connection holds the pool. Dropping the last
/// handle closes the ticket channel and the workers return once they finish
/// the ask in hand.
pub struct Pool {
    tickets: Sender<Arc<Conn>>,
}

static POOL: Mutex<Weak<Pool>> = Mutex::new(Weak::new());

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Pool {
    /// The pool the process shares, started if no connection holds one.
    pub fn shared() -> std::io::Result<Arc<Pool>> {
        let mut held = lock(&POOL);
        if let Some(pool) = held.upgrade() {
            return Ok(pool);
        }
        let (tickets, queue) = mpsc::channel::<Arc<Conn>>();
        let queue = Arc::new(Mutex::new(queue));
        for n in 0..WORKERS {
            let queue = Arc::clone(&queue);
            std::thread::Builder::new()
                .name(format!("remote-ask-{n}"))
                .spawn(move || {
                    loop {
                        // The lock is held only while waiting for a ticket, so
                        // the other worker takes the next one while this runs.
                        let ticket = lock(&queue).recv();
                        match ticket {
                            Ok(conn) => conn.run_next(),
                            Err(_) => return,
                        }
                    }
                })?;
        }
        let pool = Arc::new(Pool { tickets });
        *held = Arc::downgrade(&pool);
        Ok(pool)
    }
}

/// One ask waiting for a worker.
struct Job {
    channel: ChannelId,
    id: Option<u64>,
    request: String,
}

#[derive(Default)]
struct Pending {
    queued: VecDeque<Job>,
    /// Asks a worker is answering now. An ask with no id is counted but cannot
    /// be named.
    running: usize,
    running_ids: HashSet<u64>,
    /// Running asks whose reply is dropped when they return.
    cancelled: HashSet<u64>,
    closed: bool,
}

impl Pending {
    fn outstanding(&self) -> usize {
        self.queued.len() + self.running
    }
}

/// A reply a worker made, with the channel it goes back on.
pub type Reply = (ChannelId, String);

/// One connection's asks.
pub struct Conn {
    gate: Arc<dyn Gate>,
    presented: String,
    local: String,
    pending: Mutex<Pending>,
    replies: Sender<Reply>,
}

impl Conn {
    /// A connection answering as `presented` through `gate`, and the end its
    /// replies come back on.
    pub fn new(gate: Arc<dyn Gate>, presented: &str, local: &str) -> (Arc<Conn>, Receiver<Reply>) {
        let (replies, receiver) = mpsc::channel();
        let conn = Arc::new(Conn {
            gate,
            presented: presented.to_owned(),
            local: local.to_owned(),
            pending: Mutex::new(Pending::default()),
            replies,
        });
        (conn, receiver)
    }

    /// Queue an ask. False when [`MAX_OUTSTANDING`] are outstanding already or
    /// the connection is closed, and then nothing was queued.
    pub fn submit(
        self: &Arc<Self>,
        pool: &Pool,
        channel: ChannelId,
        id: Option<u64>,
        request: &str,
    ) -> bool {
        {
            let mut pending = lock(&self.pending);
            if pending.closed || pending.outstanding() >= MAX_OUTSTANDING {
                return false;
            }
            pending.queued.push_back(Job {
                channel,
                id,
                request: request.to_owned(),
            });
        }
        pool.tickets.send(Arc::clone(self)).is_ok()
    }

    /// Withdraw ask `id`: a queued one is removed, and a running one has its
    /// reply dropped when it returns.
    pub fn cancel(&self, id: u64) {
        let mut pending = lock(&self.pending);
        if let Some(at) = pending.queued.iter().position(|job| job.id == Some(id)) {
            pending.queued.remove(at);
        } else if pending.running_ids.contains(&id) {
            pending.cancelled.insert(id);
        }
    }

    /// Whether any ask is queued or running.
    pub fn busy(&self) -> bool {
        lock(&self.pending).outstanding() > 0
    }

    /// The connection ended: queued asks are dropped unrun.
    pub fn close(&self) {
        let mut pending = lock(&self.pending);
        pending.closed = true;
        pending.queued.clear();
    }

    /// Answer the ask at the head of the queue, if a cancel has not taken it.
    fn run_next(&self) {
        let job = {
            let mut pending = lock(&self.pending);
            let Some(job) = pending.queued.pop_front() else {
                return;
            };
            pending.running += 1;
            if let Some(id) = job.id {
                pending.running_ids.insert(id);
            }
            job
        };
        let text = catch_unwind(AssertUnwindSafe(|| {
            self.gate.answer(&self.presented, &self.local, &job.request)
        }))
        .unwrap_or_else(|_| protocol::failed(job.id));
        let mut pending = lock(&self.pending);
        let cancelled = job.id.is_some_and(|id| pending.cancelled.remove(&id));
        if !cancelled {
            let _ = self.replies.send((job.channel, text));
        }
        // After the send, so the serving loop never sees the ask gone before
        // its reply is on the channel.
        pending.running -= 1;
        if let Some(id) = job.id {
            pending.running_ids.remove(&id);
        }
    }
}
