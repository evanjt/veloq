//! Taking a lock whose holder panicked.
//!
//! A poisoned lock still guards a usable value: the panic happened in a
//! caller's closure, and refusing the lock afterwards would leave every later
//! caller unserved for the rest of the session. These methods take the guard
//! the poison error carries. A site that must treat poison as a failure
//! matches on the `LockResult` itself instead.

use std::sync::{Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};

pub(crate) trait Recover<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> Recover<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(crate) trait RecoverRw<T> {
    fn read_recover(&self) -> RwLockReadGuard<'_, T>;
    fn write_recover(&self) -> RwLockWriteGuard<'_, T>;
}

impl<T> RecoverRw<T> for RwLock<T> {
    fn read_recover(&self) -> RwLockReadGuard<'_, T> {
        self.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_recover(&self) -> RwLockWriteGuard<'_, T> {
        self.write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::{Recover, RecoverRw};
    use std::sync::{Arc, Mutex, RwLock};

    fn poisoned_mutex() -> Arc<Mutex<i32>> {
        let m = Arc::new(Mutex::new(7));
        let held = Arc::clone(&m);
        let _ = std::thread::spawn(move || {
            let _guard = held.lock().unwrap();
            panic!("poison the mutex");
        })
        .join();
        assert!(m.is_poisoned());
        m
    }

    #[test]
    fn a_poisoned_mutex_still_yields_its_value() {
        let m = poisoned_mutex();
        assert_eq!(*m.lock_recover(), 7);
        *m.lock_recover() = 9;
        assert_eq!(*m.lock_recover(), 9);
    }

    #[test]
    fn a_poisoned_rwlock_still_reads_and_writes() {
        let l = Arc::new(RwLock::new(3));
        let held = Arc::clone(&l);
        let _ = std::thread::spawn(move || {
            let _guard = held.write().unwrap();
            panic!("poison the lock");
        })
        .join();
        assert!(l.is_poisoned());
        assert_eq!(*l.read_recover(), 3);
        *l.write_recover() = 4;
        assert_eq!(*l.read_recover(), 4);
    }

    #[test]
    fn a_healthy_lock_is_unchanged() {
        let m = Mutex::new(1);
        assert_eq!(*m.lock_recover(), 1);
    }
}
