//! Names for the threads the engine does its work on.
//!
//! Linux gives a new thread the creating thread's `comm`, and rayon's global
//! pool is built lazily on the first `par_iter`, which is reached from an FFI
//! call on the JavaScript thread. Unnamed, every worker in the pool reports as
//! `mqt_v_js` and a per-thread sampler cannot tell a pool worker from the thread
//! it is relieving. The same inheritance is what makes a bare `thread::spawn`
//! for a long pass invisible.

use std::sync::Once;
use std::thread::{Builder, JoinHandle};

static CPU_POOL: Once = Once::new();

/// Name rayon's global pool, once per process.
///
/// Call it before anything can reach a `par_iter`: the pool takes its names when
/// it is built, and a pool already built cannot be renamed.
pub fn name_cpu_pool() {
    CPU_POOL.call_once(|| {
        if let Err(err) = rayon::ThreadPoolBuilder::new()
            .thread_name(|i| format!("veloq-cpu-{i}"))
            .build_global()
        {
            log::warn!(
                "veloqrs: [threads] the rayon pool was already built, its workers keep the name of whatever thread reached it first: {err}"
            );
        }
    });
}

/// Longest thread name the kernel keeps whole.
const MAX_THREAD_NAME_BYTES: usize = 15;

/// Spawn a worker under a name a sampler can read.
///
/// Keep the name to fifteen bytes or fewer: the kernel's `comm` holds sixteen
/// including the terminator, and a truncated name is worse than a short one to
/// group by. A longer name panics in a debug build.
pub fn spawn_named<F, T>(name: &str, work: F) -> JoinHandle<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    debug_assert!(
        name.len() <= MAX_THREAD_NAME_BYTES,
        "veloqrs: [threads] {name} is {} bytes and Linux truncates thread names to {MAX_THREAD_NAME_BYTES}",
        name.len()
    );
    // `Builder::spawn` fails only where `thread::spawn` panics, when the OS
    // refuses the thread, so this is the call it replaces and not a new risk.
    Builder::new()
        .name(name.to_string())
        .spawn(work)
        .unwrap_or_else(|err| panic!("veloqrs: [threads] could not spawn {name}: {err}"))
}
