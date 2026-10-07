use super::*;

#[test]
fn test_poll_status_reports_track_read_failure() {
    let (sender, receiver) = mpsc::channel();
    sender.send(PreviewOutcome::ReadFailed).unwrap();
    let mut handle = SectionPreviewHandle {
        receiver,
        progress: SectionDetectionProgress::default(),
        cancel: Arc::new(AtomicBool::new(false)),
        outcome: None,
    };

    assert!(matches!(handle.poll_status(), PreviewPoll::ReadFailed));
    assert!(matches!(handle.poll_status(), PreviewPoll::ReadFailed));
}
