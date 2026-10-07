use super::db_path;

#[test]
fn test_db_path_requires_explicit_database() {
    assert!(db_path(None).is_err());
    assert!(db_path(Some(String::new())).is_err());
    assert_eq!(
        db_path(Some("library.veloqdb".to_string())),
        Ok("library.veloqdb".to_string())
    );
}
