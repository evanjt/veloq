//! # LRU Cache
//!
//! A simple Least Recently Used (LRU) cache implementation.
//! Used by the persistent engine to cache frequently accessed signatures.

use std::collections::HashMap;
use std::hash::Hash;

/// A simple LRU cache with O(n) eviction.
///
/// For our use case (200 entries max), the linear scan for eviction
/// is acceptable and simpler than maintaining a linked list.
#[derive(Debug)]
pub struct LruCache<K, V> {
    capacity: usize,
    entries: HashMap<K, CacheEntry<V>>,
    access_counter: u64,
}

#[derive(Debug)]
struct CacheEntry<V> {
    value: V,
    last_access: u64,
}

impl<K: Eq + Hash + Clone, V: Clone> LruCache<K, V> {
    /// Create a new LRU cache with the given capacity.
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: HashMap::with_capacity(capacity),
            access_counter: 0,
        }
    }

    /// Get a value from the cache, updating its access time.
    pub fn get(&mut self, key: &K) -> Option<&V> {
        if let Some(entry) = self.entries.get_mut(key) {
            self.access_counter += 1;
            entry.last_access = self.access_counter;
            Some(&entry.value)
        } else {
            None
        }
    }

    /// Get a cloned value from the cache (useful when you can't hold a reference).
    pub fn get_cloned(&mut self, key: &K) -> Option<V> {
        self.get(key).cloned()
    }

    /// Insert a value into the cache, evicting the oldest if at capacity.
    pub fn insert(&mut self, key: K, value: V) {
        // If key exists, just update it
        if let Some(entry) = self.entries.get_mut(&key) {
            self.access_counter += 1;
            entry.value = value;
            entry.last_access = self.access_counter;
            return;
        }

        // Evict oldest if at capacity
        if self.entries.len() >= self.capacity {
            self.evict_oldest();
        }

        self.access_counter += 1;
        self.entries.insert(
            key,
            CacheEntry {
                value,
                last_access: self.access_counter,
            },
        );
    }

    /// Remove a specific key from the cache.
    pub fn invalidate(&mut self, key: &K) {
        self.entries.remove(key);
    }

    /// Clear all entries from the cache.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.access_counter = 0;
    }

    /// Get the number of entries in the cache.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Check if the cache contains a key.
    pub fn contains(&self, key: &K) -> bool {
        self.entries.contains_key(key)
    }

    /// Evict the least recently used entry.
    fn evict_oldest(&mut self) {
        if self.entries.is_empty() {
            return;
        }

        // Find the entry with the smallest last_access
        let oldest_key = self
            .entries
            .iter()
            .min_by_key(|(_, entry)| entry.last_access)
            .map(|(k, _)| k.clone());

        if let Some(key) = oldest_key {
            self.entries.remove(&key);
        }
    }
}

impl<K: Eq + Hash + Clone, V: Clone> Default for LruCache<K, V> {
    fn default() -> Self {
        Self::new(100)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_operations() {
        let mut cache: LruCache<String, i32> = LruCache::new(3);

        cache.insert("a".to_string(), 1);
        cache.insert("b".to_string(), 2);
        cache.insert("c".to_string(), 3);

        assert_eq!(cache.get(&"a".to_string()), Some(&1));
        assert_eq!(cache.get(&"b".to_string()), Some(&2));
        assert_eq!(cache.get(&"c".to_string()), Some(&3));
        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn test_eviction() {
        let mut cache: LruCache<String, i32> = LruCache::new(3);

        cache.insert("a".to_string(), 1);
        cache.insert("b".to_string(), 2);
        cache.insert("c".to_string(), 3);

        // Access "a" to make it recently used
        cache.get(&"a".to_string());

        // Insert "d", should evict "b" (oldest)
        cache.insert("d".to_string(), 4);

        assert!(cache.contains(&"a".to_string()));
        assert!(!cache.contains(&"b".to_string())); // Evicted
        assert!(cache.contains(&"c".to_string()));
        assert!(cache.contains(&"d".to_string()));
        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn test_update_existing() {
        let mut cache: LruCache<String, i32> = LruCache::new(3);

        cache.insert("a".to_string(), 1);
        cache.insert("a".to_string(), 10); // Update

        assert_eq!(cache.get(&"a".to_string()), Some(&10));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_invalidate() {
        let mut cache: LruCache<String, i32> = LruCache::new(3);

        cache.insert("a".to_string(), 1);
        cache.insert("b".to_string(), 2);

        cache.invalidate(&"a".to_string());

        assert!(!cache.contains(&"a".to_string()));
        assert!(cache.contains(&"b".to_string()));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_clear() {
        let mut cache: LruCache<String, i32> = LruCache::new(3);

        cache.insert("a".to_string(), 1);
        cache.insert("b".to_string(), 2);

        cache.clear();

        assert!(cache.is_empty());
    }
}
