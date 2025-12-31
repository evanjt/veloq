//! Union-Find (Disjoint Set Union) data structure.
//!
//! This module provides a generic Union-Find implementation with path compression
//! for efficient grouping operations. Used by route grouping algorithms.

use std::collections::HashMap;
use std::hash::Hash;

/// Union-Find data structure with path compression.
///
/// Provides near-constant time operations for:
/// - Finding the representative (root) of a set
/// - Unioning two sets together
///
/// # Example
/// ```
/// use route_matcher::union_find::UnionFind;
///
/// let mut uf = UnionFind::new();
/// uf.make_set("a");
/// uf.make_set("b");
/// uf.make_set("c");
///
/// uf.union("a", "b");
/// assert_eq!(uf.find("a"), uf.find("b"));
/// assert_ne!(uf.find("a"), uf.find("c"));
/// ```
#[derive(Debug, Clone)]
pub struct UnionFind<T: Eq + Hash + Clone> {
    parent: HashMap<T, T>,
    rank: HashMap<T, usize>,
}

impl<T: Eq + Hash + Clone> Default for UnionFind<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Eq + Hash + Clone> UnionFind<T> {
    /// Create a new empty Union-Find structure.
    pub fn new() -> Self {
        Self {
            parent: HashMap::new(),
            rank: HashMap::new(),
        }
    }

    /// Create a Union-Find with pre-allocated capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            parent: HashMap::with_capacity(capacity),
            rank: HashMap::with_capacity(capacity),
        }
    }

    /// Add a new element as its own set.
    pub fn make_set(&mut self, item: T) {
        if !self.parent.contains_key(&item) {
            self.parent.insert(item.clone(), item.clone());
            self.rank.insert(item, 0);
        }
    }

    /// Find the representative (root) of the set containing `item`.
    /// Uses path compression for efficiency.
    ///
    /// Returns the item itself if not in the structure (auto-creates set).
    pub fn find(&mut self, item: &T) -> T {
        // Auto-create if not exists
        if !self.parent.contains_key(item) {
            self.parent.insert(item.clone(), item.clone());
            self.rank.insert(item.clone(), 0);
            return item.clone();
        }

        let current = self.parent.get(item).cloned().unwrap();
        if &current == item {
            return item.clone();
        }

        // Path compression: recursively find root and update parent
        let root = self.find(&current);
        self.parent.insert(item.clone(), root.clone());
        root
    }

    /// Union the sets containing `a` and `b`.
    /// Uses union by rank for efficiency.
    ///
    /// Returns true if the sets were different (union performed),
    /// false if they were already in the same set.
    pub fn union(&mut self, a: &T, b: &T) -> bool {
        let root_a = self.find(a);
        let root_b = self.find(b);

        if root_a == root_b {
            return false;
        }

        // Union by rank: attach smaller tree under larger tree
        let rank_a = *self.rank.get(&root_a).unwrap_or(&0);
        let rank_b = *self.rank.get(&root_b).unwrap_or(&0);

        if rank_a < rank_b {
            self.parent.insert(root_a, root_b);
        } else if rank_a > rank_b {
            self.parent.insert(root_b, root_a);
        } else {
            self.parent.insert(root_b, root_a.clone());
            self.rank.insert(root_a, rank_a + 1);
        }

        true
    }

    /// Check if two elements are in the same set.
    pub fn connected(&mut self, a: &T, b: &T) -> bool {
        self.find(a) == self.find(b)
    }

    /// Get all unique groups as a map from root -> members.
    pub fn groups(&mut self) -> HashMap<T, Vec<T>> {
        let items: Vec<T> = self.parent.keys().cloned().collect();
        let mut groups: HashMap<T, Vec<T>> = HashMap::new();

        for item in items {
            let root = self.find(&item);
            groups.entry(root).or_default().push(item);
        }

        groups
    }

    /// Get the number of elements in the structure.
    pub fn len(&self) -> usize {
        self.parent.len()
    }

    /// Check if the structure is empty.
    pub fn is_empty(&self) -> bool {
        self.parent.is_empty()
    }
}

/// Helper module for String-based Union-Find (most common use case).
pub mod string_uf {
    use super::*;

    /// Create a Union-Find from an iterator of string IDs.
    pub fn from_ids<'a, I>(ids: I) -> UnionFind<String>
    where
        I: IntoIterator<Item = &'a str>,
    {
        let mut uf = UnionFind::new();
        for id in ids {
            uf.make_set(id.to_string());
        }
        uf
    }

    /// Find operation for string slices.
    pub fn find(uf: &mut UnionFind<String>, id: &str) -> String {
        uf.find(&id.to_string())
    }

    /// Union operation for string slices.
    pub fn union(uf: &mut UnionFind<String>, a: &str, b: &str) -> bool {
        uf.union(&a.to_string(), &b.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_operations() {
        let mut uf: UnionFind<i32> = UnionFind::new();

        uf.make_set(1);
        uf.make_set(2);
        uf.make_set(3);

        assert!(!uf.connected(&1, &2));

        uf.union(&1, &2);
        assert!(uf.connected(&1, &2));
        assert!(!uf.connected(&1, &3));
    }

    #[test]
    fn test_path_compression() {
        let mut uf: UnionFind<i32> = UnionFind::new();

        // Create chain: 1 -> 2 -> 3 -> 4
        uf.make_set(1);
        uf.make_set(2);
        uf.make_set(3);
        uf.make_set(4);

        uf.union(&1, &2);
        uf.union(&2, &3);
        uf.union(&3, &4);

        // After find, all should point to same root
        let root = uf.find(&1);
        assert_eq!(uf.find(&2), root);
        assert_eq!(uf.find(&3), root);
        assert_eq!(uf.find(&4), root);
    }

    #[test]
    fn test_groups() {
        let mut uf: UnionFind<String> = UnionFind::new();

        uf.make_set("a".to_string());
        uf.make_set("b".to_string());
        uf.make_set("c".to_string());
        uf.make_set("d".to_string());

        uf.union(&"a".to_string(), &"b".to_string());
        uf.union(&"c".to_string(), &"d".to_string());

        let groups = uf.groups();
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn test_string_helpers() {
        let ids = vec!["route-1", "route-2", "route-3"];
        let mut uf = string_uf::from_ids(ids);

        string_uf::union(&mut uf, "route-1", "route-2");

        assert_eq!(
            string_uf::find(&mut uf, "route-1"),
            string_uf::find(&mut uf, "route-2")
        );
    }
}
