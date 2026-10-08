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
        if let Err(err) = cpu_pool_builder().build_global() {
            log::warn!(
                "veloqrs: [threads] the rayon pool was already built, its workers keep the name of whatever thread reached it first: {err}"
            );
        }
    });
}

/// The pool's shape: named workers, each started at background priority.
fn cpu_pool_builder() -> rayon::ThreadPoolBuilder {
    rayon::ThreadPoolBuilder::new()
        .thread_name(|i| format!("veloq-cpu-{i}"))
        .start_handler(|_| lower_background_priority())
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

/// Spawn a worker nobody is waiting on, named and run at background priority.
///
/// Use it for compute and backfill passes. A sync the athlete is watching stays
/// on `spawn_named`.
pub fn spawn_background<F, T>(name: &str, work: F) -> JoinHandle<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    spawn_named(name, move || {
        lower_background_priority();
        work()
    })
}

/// Zero the calling thread's `errno`, so a `-1` from `getpriority` can be told from a priority.
///
/// glibc and Bionic name the accessor differently.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn clear_errno() {
    // SAFETY: the C library hands back the calling thread's own `errno`, which is always valid.
    unsafe {
        #[cfg(target_os = "android")]
        let location = libc::__errno();
        #[cfg(not(target_os = "android"))]
        let location = libc::__errno_location();
        *location = 0;
    }
}

/// Lower the calling thread below the JavaScript and render threads.
///
/// A new thread starts at its creator's priority, which for a worker begun from
/// an FFI call is the foreground one, so a pass nobody waits on would compete
/// with the frame on equal terms. Nice 10 on Android and Linux, which only ever
/// lowers: a thread already further down is left there. The utility QoS class
/// on iOS. A refusal is logged and the thread runs where it was.
pub fn lower_background_priority() {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        const BACKGROUND_NICE: libc::c_int = 10;
        // SAFETY: the calls take plain integers and touch only the calling thread.
        unsafe {
            let tid = libc::gettid() as libc::id_t;
            clear_errno();
            let current = libc::getpriority(libc::PRIO_PROCESS, tid);
            if current >= BACKGROUND_NICE {
                return;
            }
            if libc::setpriority(libc::PRIO_PROCESS, tid, BACKGROUND_NICE) != 0 {
                log::warn!(
                    "veloqrs: [threads] could not lower a worker to nice {BACKGROUND_NICE}: {}",
                    std::io::Error::last_os_error()
                );
            }
        }
    }
    #[cfg(target_os = "ios")]
    {
        // SAFETY: sets the QoS class of the calling thread only.
        let status =
            unsafe { libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0) };
        if status != 0 {
            log::warn!("veloqrs: [threads] could not set the utility QoS class: {status}");
        }
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "android")))]
mod tests {
    use super::*;

    fn nice_of_current_thread() -> i32 {
        // SAFETY: reads the calling thread's own priority.
        unsafe {
            clear_errno();
            libc::getpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t)
        }
    }

    /// Run on a fresh thread so a lowered priority never leaks into the test runner.
    fn on_fresh_thread<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
        spawn_named("veloq-test-nice", work).join().unwrap()
    }

    #[test]
    fn background_worker_runs_at_lowered_priority() {
        let spawner = nice_of_current_thread();
        let worker = spawn_background("veloq-test-bg", nice_of_current_thread)
            .join()
            .unwrap();
        assert_eq!(worker, spawner.max(10));
    }

    #[test]
    fn named_worker_keeps_the_spawners_priority() {
        let spawner = nice_of_current_thread();
        let worker = spawn_named("veloq-test-fg", nice_of_current_thread)
            .join()
            .unwrap();
        assert_eq!(worker, spawner);
    }

    #[test]
    fn lowering_twice_leaves_the_priority_where_the_first_put_it() {
        let (first, second) = on_fresh_thread(|| {
            lower_background_priority();
            let first = nice_of_current_thread();
            lower_background_priority();
            (first, nice_of_current_thread())
        });
        assert_eq!(first, second);
    }

    #[test]
    fn a_thread_already_below_background_is_not_raised() {
        let nice = on_fresh_thread(|| {
            // SAFETY: lowers the calling thread only.
            unsafe {
                libc::setpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t, 15);
            }
            lower_background_priority();
            nice_of_current_thread()
        });
        assert_eq!(nice, 15);
    }

    #[test]
    fn cpu_pool_workers_start_at_background_priority() {
        let pool = cpu_pool_builder().num_threads(2).build().unwrap();
        let spawner = nice_of_current_thread();
        let niceness: Vec<i32> = pool.install(|| {
            use rayon::prelude::*;
            (0..64)
                .into_par_iter()
                .map(|_| nice_of_current_thread())
                .collect()
        });
        assert!(
            niceness.iter().all(|n| *n == spawner.max(10)),
            "{niceness:?}"
        );
    }
}
