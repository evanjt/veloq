//! The `schema_info` key-value table, read and written through one owner.
//!
//! Every caller that reads, stores or removes a row goes through these
//! functions. Each returns the error it hit, and the caller decides whether to
//! propagate it or to take the stored value as absent.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

/// The value stored under `key`, `None` when no row carries it.
pub(crate) fn get(conn: &Connection, key: &str) -> SqlResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM schema_info WHERE key = ?",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// The value stored under `key` read the way SQLite casts text to an integer,
/// `None` when no row carries it.
pub(crate) fn get_integer(conn: &Connection, key: &str) -> SqlResult<Option<i64>> {
    conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = ?",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

/// Store `value` under `key`, replacing the row already there.
pub(crate) fn set(conn: &Connection, key: &str, value: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![key, value],
    )
    .map(|_| ())
}

/// Remove the row stored under `key`, if there is one.
pub(crate) fn delete(conn: &Connection, key: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM schema_info WHERE key = ?", params![key])
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute(
            "CREATE TABLE schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            [],
        )
        .expect("create");
        conn
    }

    #[test]
    fn get_of_an_unset_key_is_none() {
        let conn = table();
        assert_eq!(get(&conn, "missing").unwrap(), None);
        assert_eq!(get_integer(&conn, "missing").unwrap(), None);
    }

    #[test]
    fn set_then_get_round_trips_and_replaces() {
        let conn = table();
        set(&conn, "k", "first").unwrap();
        assert_eq!(get(&conn, "k").unwrap().as_deref(), Some("first"));
        set(&conn, "k", "second").unwrap();
        assert_eq!(get(&conn, "k").unwrap().as_deref(), Some("second"));
    }

    /// Expected behaviour: the integer read casts the stored text as SQLite does,
    /// so a number reads back and text that is not a number reads as zero.
    #[test]
    fn get_integer_casts_the_stored_text() {
        let conn = table();
        set(&conn, "n", "12").unwrap();
        set(&conn, "text", "twelve").unwrap();
        assert_eq!(get_integer(&conn, "n").unwrap(), Some(12));
        assert_eq!(get_integer(&conn, "text").unwrap(), Some(0));
    }

    /// Expected behaviour: a delete removes the row, and deleting an absent row is not an error.
    #[test]
    fn delete_removes_the_row_and_tolerates_absence() {
        let conn = table();
        set(&conn, "k", "v").unwrap();
        delete(&conn, "k").unwrap();
        assert_eq!(get(&conn, "k").unwrap(), None);
        delete(&conn, "k").unwrap();
    }

    /// Expected behaviour: a read that fails reports the error rather than an absent value,
    /// so a caller that propagates it sees the failure.
    #[test]
    fn get_reports_a_failed_read() {
        let conn = Connection::open_in_memory().expect("open");
        assert!(get(&conn, "k").is_err());
    }
}
