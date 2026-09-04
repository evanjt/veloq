//! Test target for the shared seeding helper, so its own checks run without
//! waiting on a consumer to include it. Other migration tests reach the same
//! code with `mod migration_support;`.

#[path = "mod.rs"]
mod migration_support;
