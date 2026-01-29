use log::info;
use rusqlite::{params, Connection, Result};

/// Migration: Add section_type column to sections table.
/// Adds discriminator for 'auto' vs 'custom' sections.
pub fn migrate_add_section_type(conn: &Connection) -> Result<()> {
    info!("Running migration: add_section_type");

    // Check if migration already ran
    let column_exists: i64 = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sections') WHERE name = 'section_type'")?
        .query_row([], |row| row.get(0))?;

    if column_exists > 0 {
        info!("Migration add_section_type already applied, skipping");
        return Ok(());
    }

    // Add section_type column
    conn.execute("ALTER TABLE sections ADD COLUMN section_type TEXT")?;

    // Set section_type based on ID prefix (custom_ = custom)
    conn.execute("UPDATE sections SET section_type = 'custom' WHERE id LIKE 'custom_%'")?;

    // Set all other sections to 'auto'
    conn.execute("UPDATE sections SET section_type = 'auto' WHERE section_type IS NULL")?;

    // Add index for queries
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sections_section_type ON sections(section_type)")?;

    info!("Migration add_section_type completed successfully");

    Ok(())
}

/// Check if migration is needed.
pub fn needs_section_type_migration(conn: &Connection) -> Result<bool> {
    let count: i64 = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sections') WHERE name = 'section_type'")?
        .query_row([], |row| row.get(0))?;

    Ok(count == 0)
}
