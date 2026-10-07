use super::FitnessManager;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

#[test]
fn test_get_summary_card_data_writer_held() {
    let _serial = serial_global_state();
    let _tmp = init_global_engine("summary_card_under_a_writer.db");

    let card = read_while_writer_holds(|| {
        FitnessManager::new()
            .get_summary_card_data(100.0, 200.0, 0.0, 99.0)
            .expect("summary card read")
    });
    assert_eq!(card.current_week.count, 0);
}
