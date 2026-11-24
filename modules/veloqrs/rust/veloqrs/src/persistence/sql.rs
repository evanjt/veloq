//! SQL text shared by every module that builds a statement at run time.

/// `?,?,?` for `n` bound parameters, the body of an `IN (...)` list or a
/// `VALUES (...)` row. Empty for `0`, which no caller binds: `IN ()` is valid
/// in SQLite and matches nothing.
pub(crate) fn question_marks(n: usize) -> String {
    let mut marks = String::with_capacity(n.saturating_mul(2));
    for i in 0..n {
        if i > 0 {
            marks.push(',');
        }
        marks.push('?');
    }
    marks
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Expected behaviour: one `?` per parameter, comma separated with no spaces and no
    /// trailing comma, and nothing for zero.
    #[test]
    fn question_marks_has_one_mark_per_parameter() {
        assert_eq!(question_marks(0), "");
        assert_eq!(question_marks(1), "?");
        assert_eq!(question_marks(3), "?,?,?");
    }
}
