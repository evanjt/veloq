import CoreLocation
import Foundation
import UserNotifications

/// Runs a loaded guide: location from the moment the athlete loads a section,
/// the cue judge on every fix, and a time-sensitive local notification for each
/// cue, because a haptic played directly runs only while the app is in front.
///
/// Location starts in the foreground and keeps arriving behind the Workout app
/// through the `location` background mode. There is no workout session and no
/// HealthKit here: the guide records nothing, and it stops itself 500 m past the
/// end or when the athlete ends it.
final class GuideLocation: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var payload: GuidePayload?
    @Published private(set) var position: GuideCoordinate?
    @Published private(set) var lastCue: GuideCue?
    @Published private(set) var notificationsAuthorised = false

    private let manager = CLLocationManager()
    private var judge: GuideCueJudge?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.activityType = .fitness
        manager.allowsBackgroundLocationUpdates = true
    }

    /// Load a section and start location. Loading another replaces it.
    func start(_ payload: GuidePayload) {
        stop()
        self.payload = payload
        judge = GuideCueJudge(line: payload.coordinates)
        lastCue = nil
        refreshNotificationAuthorisation()
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
    }

    /// End the guide and location with it.
    func stop() {
        manager.stopUpdatingLocation()
        judge = nil
        payload = nil
        position = nil
    }

    /// What the phone's notification permission came to, as the watch reads it.
    /// The watch never asks: the phone asks once and the watch mirrors it.
    func refreshNotificationAuthorisation() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let allowed = settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
            DispatchQueue.main.async { self.notificationsAuthorised = allowed }
        }
    }

    // MARK: CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations {
            let coordinate = GuideCoordinate(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                elevation: location.altitude
            )
            DispatchQueue.main.async { self.position = coordinate }
            guard var judge else { return }
            let cues = judge.judge(GuideFix(coordinate: coordinate, time: location.timestamp.timeIntervalSince1970))
            let finished = judge.isFinished
            self.judge = judge
            for cue in cues {
                notify(cue)
                DispatchQueue.main.async { self.lastCue = cue }
            }
            if finished {
                DispatchQueue.main.async { self.stop() }
                return
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func notify(_ cue: GuideCue) {
        let content = UNMutableNotificationContent()
        content.title = payload?.name ?? "Veloq"
        switch cue {
        case .start: content.body = String(localized: "Section starts in 200 m")
        case .end: content.body = String(localized: "Section end")
        case .offRoute: content.body = String(localized: "Off the section's line")
        }
        // The default level: the time-sensitive level needs an entitlement the watch target does not hold.
        content.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        )
    }
}
