//! Scenario: Linux gives a new thread the creating thread's `comm`, and rayon's
//! global pool is built lazily from an FFI call on the JavaScript thread. Every
//! worker then reports as `mqt_v_js` and a per-thread sampler cannot tell a pool
//! worker from the thread it is meant to be relieving.
//!
//! Expected behaviour: the pool carries its own names, and a worker spawned for a
//! long pass carries the name it was given.

use rayon::prelude::*;
use std::collections::HashSet;

#[test]
fn the_cpu_pool_names_its_workers() {
    veloqrs::threads::name_cpu_pool();

    let names: HashSet<String> = (0..256u32)
        .into_par_iter()
        .map(|_| {
            std::thread::current()
                .name()
                .unwrap_or("unnamed")
                .to_string()
        })
        .collect();

    assert!(!names.is_empty(), "the pool ran nothing");
    for name in &names {
        assert!(
            name.starts_with("veloq-cpu-"),
            "a pool worker reported as {name}"
        );
    }
}

#[test]
fn a_spawned_worker_carries_the_name_it_was_given() {
    let worker = veloqrs::threads::spawn_named("veloq-detect", || {
        std::thread::current().name().map(str::to_string)
    });

    assert_eq!(worker.join().unwrap().as_deref(), Some("veloq-detect"));
}

/// Naming the pool twice is what a second engine init does, and the second call
/// has to be a no-op rather than a panic or a pool nobody named.
#[test]
fn naming_the_pool_twice_is_harmless() {
    veloqrs::threads::name_cpu_pool();
    veloqrs::threads::name_cpu_pool();

    let named = (0..64u32).into_par_iter().all(|_| {
        std::thread::current()
            .name()
            .is_some_and(|n| n.starts_with("veloq-cpu-"))
    });

    assert!(named, "a pool worker lost its name");
}

/// A name the kernel would truncate is refused at the spawn, so the sampler
/// never sees one that matches nothing in the source.
#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "truncates thread names")]
fn a_name_longer_than_the_kernel_keeps_is_refused() {
    let _ = veloqrs::threads::spawn_named("veloq-sixteen-char", || ());
}
