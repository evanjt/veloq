/**
 * EngineClient - Backward compatibility layer for existing app code.
 *
 * Delegates to the generated UniFFI engine handle (`VeloqEngineLike`). Every
 * call is checked by tsc against `./generated/veloqrs`, so a method the
 * bindings no longer export fails the typecheck.
 */

import type {
  FfiFeedSeen,
  FfiStartResult,
  SuggestedHome,
  ExportPrivacyPreview,
  FfiGpsPoint,
  GpxFile as FfiGpxFile,
  PersistentEngineStats,
  EngineObserver,
  FfiBulkExportResult,
  VeloqEngineLike,
  FfiActivityDetailData,
  FfiActivityMetrics,
  FfiActivityNotification,
  FfiCallOutcome,
  FfiUploadResult,
  FfiExerciseActivities,
  FfiExerciseSession,
  FfiExerciseDetailData,
  FfiExerciseSet,
  FfiMuscleGroup,
  FfiStrengthScreenData,
  FfiBackupScreenData,
  FfiCacheScreenData,
  FfiBackgroundJobsData,
  FfiPreviewTrack,
  FfiMapScreenData,
  FfiBestEffortsData,
  FfiTrainingScreenData,
  FfiTrainingScreenWindows,
  MapDistanceBand,
  FfiRouteGroup,
  FfiSection,
  FfiMapSection,
  FfiNamedCorridor,
  FfiSectionDetailData,
  FfiSectionPerformanceData,
  FfiSectionPerformanceResult,
  FfiRoutePerformanceResult,
  FfiEfficiencyTrend,
  SectionSummary,
  GroupSummary,
  FfiSummaryCardData,
  FfiFitnessScreenData,
  FfiInsightsData,
  FfiInsightsParams,
  FfiStartupData,
  FfiRoutesScreenData,
  FfiRoutesScreenQuery,
  FfiActivityBodiesPage,
  FfiMatchStrictness,
  FfiSectionConfig,
  FfiIndexActivitySummary,
  FfiMergeDropped,
  DownloadProgressResult,
  DerivedClearCounts,
  FfiNotificationTemplates,
  SettingPair,
  BulkExportFormat,
  FfiQuarantineReport,
  FfiPushRun,
  LibraryCoverage,
  FfiDepartedRide,
  FfiMergeOutcome,
  FfiRecordRestoreResult,
  FfiUnplacedRecord,
} from './generated/veloqrs';
import { FfiInitOutcome, FfiStartOutcome, RangeCoverage } from './generated/veloqrs';
import * as generated from './generated/veloqrs';

import type { SectionDetectionProgress } from './conversions';
import type { DelegateHost } from './delegates/host';
import * as activityDelegates from './delegates/activities';
import * as detectionDelegates from './delegates/detection';
import * as connectivityDelegates from './delegates/connectivity';
import * as elevationDelegates from './delegates/elevation';
import type { ElevationBackfillProgress } from './delegates/elevation';
import * as streamBackfillDelegates from './delegates/streamBackfill';
import type { StreamBackfillProgress } from './delegates/streamBackfill';
import type { NetworkPush } from './delegates/connectivity';
import * as cutoverDelegates from './delegates/cutover';
import * as routesStatusDelegates from './delegates/routesStatus';
import type { RoutesStatus } from './delegates/routesStatus';
import type { CutoverDiff, CutoverProgress } from './delegates/cutover';
import * as fitnessDelegates from './delegates/fitness';
import * as previewDelegates from './delegates/preview';
import * as routeGroupingPreviewDelegates from './delegates/routeGroupingPreview';
import type {
  PreviewCentre,
  PreviewPollStatus,
  PreviewResult,
  PreviewSection,
} from './delegates/preview';
import * as heatmapDelegates from './delegates/heatmap';
import * as launchDelegates from './delegates/launch';
import * as recordingDelegates from './delegates/recordings';
import * as mapsDelegates from './delegates/maps';
import * as routeDelegates from './delegates/routes';
import * as sectionDelegates from './delegates/sections';
import * as settingsDelegates from './delegates/settings';
import * as strengthDelegates from './delegates/strength';
import * as syncDelegates from './delegates/sync';
import type { SyncAuthMethod, SyncStatus } from './delegates/sync';
import type {
  FfiActivityRouteHighlight,
  FfiSectionMatch,
  HeatmapDay,
} from './delegates/shared-types';

// Declarations live in ./delegates/shared-types.ts; re-exported here so
// existing consumers (e.g. `import { FfiSectionMatch } from '...'`) keep working.
export type {
  FfiSectionMatch,
  FfiActivityRouteHighlight,
  FfiActivityIndicator,
  FfiMergeCandidate,
  SectionEncounter,
} from './delegates/shared-types';

/** Pre-computed daily activity intensity from Rust heatmap cache. Re-exported from delegates. */
export type { HeatmapDay };

/**
 * The channels Rust announces on, one per `EngineObserver` method.
 *
 * `sync` is the pre-existing coarse channel and stays: `syncSettled` fans out
 * on both so a subscriber written against either keeps working.
 */
export type EngineEvent =
  | 'sync'
  | 'syncProgress'
  | 'syncSettled'
  | 'activitiesStored'
  | 'bodyStored'
  | 'timeStreamsStored'
  | 'gpsTrackStored'
  | 'gpsTracksMutated'
  | 'fitParsed'
  | 'detectionApplied'
  | 'tilesGenerated'
  | 'backfillPhase'
  | 'streamBackfillPhase'
  | 'cutoverSettled'
  | 'previewPhase'
  | 'previewFinished'
  | 'recordingsChanged'
  | 'uploadPermissionRefused';

/** What an announcement carries. Events with no subject carry nothing. */
export type EnginePayload =
  | { kind: string; activityId: string }
  | { activityIds: string[] }
  | { activityId: string }
  | { phase: string };

export type EngineListener = (payload?: EnginePayload) => void;

/** What `engineEventDiagnostics` reports about the Rust to JavaScript seam. */
export interface EngineEventDiagnostics {
  live: boolean;
  bindingInitError: string | null;
  observerError: string | null;
  received: Record<string, number>;
  delivered: Record<string, number>;
  listeners: Record<string, number>;
}

/** One write held from before the engine opened, kept with its timing label. */
interface PendingWrite {
  name: string;
  run: () => void;
}

/**
 * How many pre-init writes the client holds. Demo entry issues about twenty
 * and a cold start a handful, so this is generous. A launch that never opens
 * the engine must not grow the queue without bound.
 */
const MAX_PENDING_WRITES = 256;

/** Where a call is made from, which sets its budget: a frame in a gesture, 100 ms on a tap or mount, 200 ms once at launch. */
export type CallPlace = 'gesture' | 'tap' | 'mount' | 'launch';

class EngineClient implements DelegateHost {
  private static instance: EngineClient;
  private listeners: Map<string, Set<EngineListener>> = new Map();
  private pendingNotifications: Set<string> = new Set();
  private notifyScheduled = false;
  private initialized = false;
  private dbPath: string | null = null;
  /** The generated binding installs its vtables once per process. */
  private bindingInitialised = false;
  /**
   * Whether Rust can announce anything. False until `setObserver` has been
   * accepted, and it stays false when the checksum check or the call itself
   * throws. A caller with no polling fallback reads it and polls.
   */
  private observerRegistered = false;
  /** What the binding's initialise threw, kept because release strips the warn. */
  private bindingInitError: string | null = null;
  /** What `setObserver` threw, for the same reason. */
  private observerError: string | null = null;
  /**
   * Announcements counted the moment Rust's callback lands here, per channel,
   * before the microtask that delivers them. A channel that Rust announces on
   * and that never appears here is an event lost inside the binding.
   */
  private received = new Map<string, number>();
  /** Deliveries that found at least one listener, per channel. */
  private delivered = new Map<string, number>();
  private pendingWrites: PendingWrite[] = [];
  private droppedWrites = 0;

  // Cached domain object handles (created once via VeloqEngine factory)
  private handle: VeloqEngineLike | null = null;

  private constructor() {}

  /**
   * Why the last `initWithPath` ended as it did.
   *
   * Kept here rather than read on demand, because a failed init leaves no
   * engine handle to ask.
   */
  private lastInitOutcome: FfiInitOutcome = FfiInitOutcome.NotAttempted;

  /** Why the engine did not open, for the banner to translate. */
  initOutcome(): FfiInitOutcome {
    return this.lastInitOutcome;
  }

  /**
   * The quarantine this launch did, if there was one, and never twice.
   *
   * A database that could not be opened is renamed aside and a fresh one takes
   * its place, and init then reports success, so nothing else on this handle
   * says the library the athlete had is gone. The counts are the rows a rebuild
   * cannot re-derive and that came across anyway. What the athlete is shown for
   * it is not decided; reading it here is not showing it, and taking it rather
   * than reading it is what stops a notice outliving its own dismissal.
   */
  takeQuarantineReport(): FfiQuarantineReport | null {
    if (!this.initialized) return null;
    return this.timed('takeQuarantineReport', () => generated.takeQuarantineReport()) ?? null;
  }

  /** The engine handle. Throws before `initWithPath` succeeds; guard on `ready` first. */
  get engine(): VeloqEngineLike {
    if (this.handle === null) throw new Error('Engine not initialized');
    return this.handle;
  }

  set engine(handle: VeloqEngineLike | null) {
    this.handle = handle;
  }

  /** Check if engine is ready. Methods called before initWithPath() return safe defaults. */
  get ready(): boolean {
    return this.handle !== null;
  }

  /** How many held writes have been dropped since the last replay. */
  get droppedPendingWrites(): number {
    return this.droppedWrites;
  }

  /**
   * Run a write now, or hold it until the engine opens.
   *
   * The oldest write goes when the queue is full: a cold start that never
   * opens the engine must not grow this without bound, and the newest write
   * to a key is the one the athlete meant. Dropping one is still the athlete's
   * data going, so it is named as it goes and counted for the replay to total.
   */
  write(name: string, run: () => void): void {
    if (this.ready) {
      this.timed(name, run);
      return;
    }
    if (this.pendingWrites.length >= MAX_PENDING_WRITES) {
      const dropped = this.pendingWrites.shift();
      this.droppedWrites += 1;
      console.warn(
        `[EngineClient] Queue full at ${MAX_PENDING_WRITES}, dropped held write ${dropped?.name}`
      );
    }
    this.pendingWrites.push({ name, run });
  }

  timed<T>(name: string, fn: () => T, place?: CallPlace): T {
    if (!EngineClient.debugEnabled) return fn();
    const start = performance.now();
    const result = fn();
    EngineClient.recordMetric(place ? `${name}@${place}` : name, performance.now() - start);
    return result;
  }

  private static debugEnabled = false;
  private static recordMetric: (name: string, ms: number) => void = () => {};

  static setDebugEnabled(enabled: boolean): void {
    EngineClient.debugEnabled = enabled;
  }

  static setMetricRecorder(recorder: (name: string, ms: number) => void): void {
    EngineClient.recordMetric = recorder;
  }

  static getInstance(): EngineClient {
    if (!this.instance) {
      this.instance = new EngineClient();
    }
    return this.instance;
  }

  initWithPath(dbPath: string): boolean {
    if (this.initialized && this.dbPath === dbPath) return true;
    const result = this.timed(
      'initWithPath',
      () => {
        // create() itself never throws. Rust reports open/migration failure
        // (including quarantine-and-recreate failover) via isInitialized().
        // Without this check a failed init looks successful and every later
        // FFI call silently returns empty data.
        try {
          const engine = generated.VeloqEngine.create(dbPath);
          // Read the reason from the handle whether or not it opened: a failed
          // init leaves `this.engine` null, so this is the only moment the
          // outcome is reachable at all.
          this.lastInitOutcome = engine.initOutcome();
          if (!engine.isInitialized()) {
            console.warn('[EngineClient] Engine reported failed init for', dbPath);
            return false;
          }
          this.engine = engine;
          return true;
        } catch (e) {
          console.warn('[EngineClient] Engine init threw:', e);
          this.lastInitOutcome = FfiInitOutcome.Failed;
          this.engine = null;
          return false;
        }
      },
      'launch'
    );
    if (result) {
      this.initialized = true;
      this.dbPath = dbPath;
      // Registered here and not in create(): before this point there is no
      // engine to announce anything, and a failed init must leave Rust with no
      // handle into a listener map nobody is reading.
      //
      // The binding's own initialise runs first. It ends by installing the
      // EngineObserver vtable, and nothing else calls it, so without this
      // `setObserver` hands Rust a handle into a vtable cell that was never
      // set and every notify panics inside uniffi rather than reaching a
      // channel. The observer is withheld if it throws: a handle Rust cannot
      // call through is worse than none, since the polling fallback still
      // works and a panic per event does not.
      this.observerRegistered = false;
      this.observerError = null;
      if (this.ensureBindingInitialised()) {
        try {
          const observer = this.observer();
          this.timed('setObserver', () => this.engine.setObserver(observer));
          this.observerRegistered = true;
        } catch (e) {
          this.observerError = String(e);
          console.warn('[EngineClient] Engine refused the observer:', e);
        }
      }
      // Heatmap tiles path is set lazily via enableHeatmapTiles() - called from app
      // code when the heatmap setting is enabled. This avoids importing provider stores
      // in the native module. What the athlete last chose is re-applied here,
      // because the path lives only in the engine's memory and a clear opens a
      // new one: the layout's post-init block does not run again for a clear
      // mid-session, so the path stayed unset and the previous library's tiles
      // went on being served.
      if (this.heatmapTilesPath) {
        this.applyHeatmapTilesPath(this.heatmapTilesPath);
      }
      this.replayPendingWrites();
    }
    return result;
  }

  /**
   * Install the generated binding's vtables, once per process.
   *
   * It also verifies every FFI checksum, so a Rust library out of step with
   * the bindings throws here instead of returning nonsense later.
   */
  private ensureBindingInitialised(): boolean {
    if (this.bindingInitialised) return true;
    try {
      generated.default.initialize();
      this.bindingInitialised = true;
      this.bindingInitError = null;
      return true;
    } catch (e) {
      this.bindingInitError = String(e);
      console.warn('[EngineClient] Binding init failed, observer withheld:', e);
      return false;
    }
  }

  /**
   * Send what was written before the engine opened, oldest first.
   *
   * Drained into a local and the field reset first, so a write that reaches
   * back into the client during replay queues behind rather than re-running
   * what is already going out. Each write is isolated: one that throws must
   * not take the rest of the queue with it.
   */
  private replayPendingWrites(): void {
    if (this.droppedWrites > 0) {
      console.warn(
        `[EngineClient] ${this.droppedWrites} held write(s) were dropped before the engine opened`
      );
      this.droppedWrites = 0;
    }
    if (this.pendingWrites.length === 0) return;
    const held = this.pendingWrites;
    this.pendingWrites = [];
    for (const { name, run } of held) {
      try {
        this.timed(name, run);
      } catch (e) {
        console.warn(`[EngineClient] Held write ${name} failed on replay:`, e);
      }
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** Wipe everything the engine can re-derive, resolving with what went. */
  async runClearDerived(): Promise<DerivedClearCounts> {
    if (!this.ready) {
      return { sectionsRemoved: 0, activitiesRemoved: 0, activitiesKept: 0 };
    }
    const removed = await this.engine.runClearDerived();
    // The wipe removes activities, and the sections and groups built on them,
    // so every mounted read of those channels is stale once it commits.
    this.notifyAll('activities', 'groups', 'sections');
    return removed;
  }

  /**
   * Wipe the whole database and resolve when the wipe has ended.
   *
   * No ceiling lives here: the destroy and re-open that follow are this
   * class's own and must come after the wipe however long it took, including
   * a wait that spanned a suspension. A caller that needs a ceiling applies
   * one itself, as `shared/native/engineClears.ts` does for the sibling wipes.
   *
   * The tiles directory goes with it whether or not the heatmap is on: the
   * engine learns the path only when the heatmap turns on, and the login
   * screen wipes before that, over tiles the previous athlete left on disk.
   */
  private async awaitWipe(): Promise<void> {
    const tilesPath = heatmapDelegates.heatmapTilesPath();
    await this.engine.runClearAll(tilesPath);
  }

  /** Drop the Rust engine singleton without clearing data. Used before database restore. */
  destroyEngine(): void {
    try {
      // The observer handle is dropped with the engine it was registered on,
      // so a re-open registers a fresh one rather than announcing into a
      // listener map from a client state that has moved on.
      if (this.observerRegistered) this.handle?.clearObserver?.();
      this.handle?.destroy();
    } catch {
      // Best-effort destroy
    }
    this.initialized = false;
    this.dbPath = null;
    this.engine = null;
    this.observerRegistered = false;
    this.pendingWrites = [];
  }

  /**
   * Wipe the engine and re-open it on the same database.
   *
   * Callers keep using the handle straight after this: the identity write that
   * follows "Clear & Sync" is one, and it is a no-op on a closed handle. The
   * re-open is what makes the wipe a wipe rather than a shutdown. A re-open
   * that fails leaves the handle closed and reported closed, which is the same
   * state a failed launch leaves.
   */
  async clear(openIfClosed?: string): Promise<void> {
    // The login screen holds a closed handle by design, and both Try Demo and
    // a sign-in to another account wipe from it. A closed handle used to make
    // the wipe a no-op whose failure was swallowed, so the call resolved having
    // touched nothing, one tap after the athlete accepted "Continue and delete". A wipe opens the
    // database it was given rather than skipping.
    if (!this.ready) {
      const path = openIfClosed ?? this.dbPath;
      if (!path) {
        throw new Error('Engine wipe has no database to open: the engine is closed');
      }
      if (!this.initWithPath(path)) {
        throw new Error(`Engine wipe could not open ${path}`);
      }
    }
    const dbPath = this.dbPath;
    // The wipe runs on a Rust thread and this waits for it, so the destroy
    // and re-open below stay ordered after it rather than racing it. On the
    // JavaScript thread the same wipe cost 401 ms on a 750-activity library
    // and froze every caller's screen for it.
    //
    // A failure is raised rather than swallowed: the caller has told the
    // athlete their library is gone, and the one thing worse than a wipe that
    // fails is a wipe that fails quietly.
    let wipeError: unknown;
    try {
      await this.awaitWipe();
    } catch (e) {
      wipeError = e;
    }
    try {
      // Drop the Rust PERSISTENT_ENGINE global so the next create() re-initializes
      // from scratch. Without this, the global retains stale data (e.g., from demo mode)
      // because create() skips init when the global is already Some.
      if (this.observerRegistered) this.handle?.clearObserver?.();
      this.handle?.destroy();
    } catch {
      // Best-effort destroy
    }
    this.initialized = false;
    this.dbPath = null;
    this.engine = null;
    this.observerRegistered = false;
    this.pendingWrites = [];
    if (dbPath) this.initWithPath(dbPath);
    this.notifyAll('activities', 'groups', 'sections', 'syncReset');
    if (wipeError) throw wipeError;
  }

  addActivities = (
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[]
  ): Promise<void> =>
    activityDelegates.addActivities(this, activityIds, allCoords, offsets, sportTypes);

  saveProvisionalActivity = (
    activityId: string,
    fitPath: string | undefined,
    body: { activityId: string; date: number; raw: string }
  ): Promise<boolean> => activityDelegates.saveProvisionalActivity(this, activityId, fitPath, body);

  provisionalActivityId = (recordingId: string): string =>
    activityDelegates.provisionalActivityId(this, recordingId);

  activityNotification = (
    activityId: string,
    activityName: string,
    announcePrs: boolean,
    announceMilestones: boolean = false
  ): FfiActivityNotification | null =>
    activityDelegates.activityNotification(
      this,
      activityId,
      activityName,
      announcePrs,
      announceMilestones
    );

  recordActivityUpload = (activityId: string, intervalsId: string): boolean =>
    activityDelegates.recordActivityUpload(this, activityId, intervalsId);

  getActivityIds = (): string[] => activityDelegates.getActivityIds(this);

  getRefusedTrackIds = (): string[] => activityDelegates.getRefusedTrackIds(this);
  hasActivity = (activityId: string): boolean => activityDelegates.hasActivity(this, activityId);

  getActivityCount = (): number => activityDelegates.getActivityCount(this);

  /** Whether the engine took the request; false when it is closed or the call failed. */
  markForRecomputation(): boolean {
    if (!this.ready) return false;
    try {
      this.timed('markForRecomputation', () => this.engine.markForRecomputation());
      return true;
    } catch (e) {
      console.error('[Engine] markForRecomputation failed:', e);
      return false;
    }
  }

  startSectionDetection = (): FfiStartResult => detectionDelegates.startSectionDetection(this);

  sectionDetectionAwaiting = (): number | null => detectionDelegates.sectionDetectionAwaiting(this);
  cancelSectionDetection = (): boolean => detectionDelegates.cancelSectionDetection(this);

  pollSectionDetection = (): string => detectionDelegates.pollSectionDetection(this);

  pollSectionDetectionRun = (runId: string): string =>
    detectionDelegates.pollSectionDetectionRun(this, runId);

  /** How the last finished run ended. Reads nothing the follower needs. */
  lastSectionDetectionOutcome = (): string => detectionDelegates.lastSectionDetectionOutcome(this);

  getSectionDetectionProgress = (): SectionDetectionProgress | null =>
    detectionDelegates.getSectionDetectionProgress(this);

  getPreviewCentres = (limit: number): PreviewCentre[] =>
    previewDelegates.getPreviewCentres(this, limit);

  getPreviewCurrentSections = (lat: number, lng: number): PreviewSection[] | null =>
    previewDelegates.getPreviewCurrentSections(this, lat, lng);

  startPreviewDetect = (lat: number, lng: number, config: FfiSectionConfig): FfiStartResult =>
    previewDelegates.startPreviewDetect(this, lat, lng, config);

  pollPreviewDetect = (): PreviewPollStatus => previewDelegates.pollPreviewDetect(this);

  getPreviewProgress = (): SectionDetectionProgress | null =>
    previewDelegates.getPreviewProgress(this);

  takePreviewResult = (): PreviewResult | null => previewDelegates.takePreviewResult(this);

  cancelPreviewDetect = (): void => previewDelegates.cancelPreviewDetect(this);

  runRouteGroupingPreview = (
    minMatchPercentage: number,
    endpointThreshold: number
  ): Promise<routeGroupingPreviewDelegates.RouteGroupingOutcome> =>
    routeGroupingPreviewDelegates.runRouteGroupingPreview(
      this,
      minMatchPercentage,
      endpointThreshold
    );

  cancelRouteGroupingPreview = (): void =>
    routeGroupingPreviewDelegates.cancelRouteGroupingPreview(this);

  setNetworkOnline = (online: boolean): void =>
    connectivityDelegates.setNetworkOnline(this, online);

  getNetworkPush = (): NetworkPush | null => connectivityDelegates.getNetworkPush(this);

  /**
   * Take whatever a push handler wrote from another process while the app was
   * away, and say whether there was anything to take.
   *
   * False before the engine is open, which is a launch that has not reached
   * `initWithPath` yet: it has nothing stale to take, because its first read
   * of the file is still ahead of it.
   */
  takeExternalWrites = (): boolean => {
    try {
      const handle = this.handle;
      if (!handle) return false;
      return this.timed('takeExternalWrites', () => handle.takeExternalWrites());
    } catch (e) {
      console.warn('[EngineClient] Could not take what a push handler wrote:', e);
      return false;
    }
  };

  startElevationBackfill = (): FfiStartOutcome => elevationDelegates.startElevationBackfill(this);

  pauseElevationBackfill = (): void => elevationDelegates.pauseElevationBackfill(this);
  resumeElevationBackfill = (): boolean => elevationDelegates.resumeElevationBackfill(this);
  isElevationBackfillPaused = (): boolean => elevationDelegates.isElevationBackfillPaused(this);

  getElevationBackfillProgress = (): ElevationBackfillProgress | null =>
    elevationDelegates.getElevationBackfillProgress(this);

  getElevationBackfillRemaining = (): number | null =>
    elevationDelegates.getElevationBackfillRemaining(this);

  startStreamBackfill = (): FfiStartOutcome => streamBackfillDelegates.startStreamBackfill(this);

  consentStreamBackfill = (): FfiStartOutcome =>
    streamBackfillDelegates.consentStreamBackfill(this);

  stopStreamBackfill = (): void => streamBackfillDelegates.stopStreamBackfill(this);

  getStreamBackfillProgress = (): StreamBackfillProgress | null =>
    streamBackfillDelegates.getStreamBackfillProgress(this);

  getStreamBackfillRemaining = (): number | null =>
    streamBackfillDelegates.getStreamBackfillRemaining(this);

  isCutoverPending = (): boolean => cutoverDelegates.isCutoverPending(this);

  isCutoverRunning = (): boolean => cutoverDelegates.isCutoverRunning(this);

  startDetectorCutover = (): FfiStartOutcome => cutoverDelegates.startDetectorCutover(this);

  cancelDetectorCutover = (): void => cutoverDelegates.cancelDetectorCutover(this);

  getChangeCardSupport = () => cutoverDelegates.getChangeCardSupport(this);

  getCutoverProgress = (): CutoverProgress | null => cutoverDelegates.getCutoverProgress(this);

  /**
   * Every routes background-job figure in one read, for the poller that
   * follows a run. One call a tick rather than four, and the figures agree
   * with each other because they were taken together.
   */
  getRoutesStatusData = (): RoutesStatus | null => routesStatusDelegates.getRoutesStatusData(this);

  getCutoverDiff = (): CutoverDiff | null => cutoverDelegates.getCutoverDiff(this);

  setSyncCredentials = (method: SyncAuthMethod, secret: string, athleteId: string): void =>
    syncDelegates.setSyncCredentials(this, method, secret, athleteId);

  clearSyncCredentials = (): void => syncDelegates.clearSyncCredentials(this);

  syncNow = (): FfiStartOutcome => syncDelegates.syncNow(this);

  offlineEstimate = (oldest: number, newest: number): syncDelegates.OfflineEstimate | null =>
    syncDelegates.offlineEstimate(this, oldest, newest);

  syncActivitiesWindow = (oldest: string, newest: string): FfiStartOutcome =>
    syncDelegates.syncActivitiesWindow(this, oldest, newest);

  rangeCoverage = (oldest: string, newest: string): RangeCoverage =>
    syncDelegates.rangeCoverage(this, oldest, newest);

  libraryCoverage = (): LibraryCoverage => syncDelegates.libraryCoverage(this);

  syncPowerCurve = (sport: string, days: number): FfiStartResult =>
    syncDelegates.syncPowerCurve(this, sport, days);

  syncPaceCurve = (sport: string, days: number, gap: boolean): FfiStartResult =>
    syncDelegates.syncPaceCurve(this, sport, days, gap);

  syncActivityIntervals = (activityId: string): FfiStartResult =>
    syncDelegates.syncActivityIntervals(this, activityId);

  syncCalendarEvents = (oldest: string, newest: string): FfiStartResult =>
    syncDelegates.syncCalendarEvents(this, oldest, newest);

  syncActivityStreams = (activityId: string, types: string): FfiStartResult =>
    syncDelegates.syncActivityStreams(this, activityId, types);

  syncActivityDetail = (activityId: string): FfiStartResult =>
    syncDelegates.syncActivityDetail(this, activityId);

  syncTimeStreams = (activityIds: string[]): FfiStartResult =>
    syncDelegates.syncTimeStreams(this, activityIds);

  updateActivityRpe = (intervalsId: string, rpe: number): Promise<FfiCallOutcome> =>
    syncDelegates.updateActivityRpe(this, intervalsId, rpe);

  confirmActivityUploaded = (intervalsId: string): Promise<FfiCallOutcome> =>
    syncDelegates.confirmActivityUploaded(this, intervalsId);

  cancelSync = (): void => syncDelegates.cancelSync(this);

  getSyncStatus = (): SyncStatus | null => syncDelegates.getSyncStatus(this);

  getBodiesStored = (): number => syncDelegates.getBodiesStored(this);

  getGroups = (): FfiRouteGroup[] => routeDelegates.getGroups(this);

  /** Six fields and the encoded line, for the regional map's section overlay. */
  getMapSections = (sportType?: string, minVisits?: number): FfiMapSection[] =>
    sectionDelegates.getMapSections(this, sportType, minVisits);

  getSectionsForActivity = (activityId: string): FfiSection[] =>
    sectionDelegates.getSectionsForActivity(this, activityId);

  getSectionCount = (): number => sectionDelegates.getSectionCount(this);

  getSectionSummaries = (sportType?: string): { totalCount: number; summaries: SectionSummary[] } =>
    sectionDelegates.getSectionSummaries(this, sportType);

  getFilteredSectionSummaries = (
    sportType: string | undefined,
    minVisits: number,
    sortKey: sectionDelegates.SectionSortKey
  ): { totalCount: number; summaries: SectionSummary[] } =>
    sectionDelegates.getFilteredSectionSummaries(this, sportType, minVisits, sortKey);

  getFilteredGroupSummaries = (
    minActivities: number,
    sortKey: routeDelegates.GroupSortKey
  ): { totalCount: number; summaries: GroupSummary[] } =>
    routeDelegates.getFilteredGroupSummaries(this, minActivities, sortKey);

  getSectionById = (sectionId: string): FfiSection | null =>
    sectionDelegates.getSectionById(this, sectionId);

  getMapScreenData = (
    startDate: Date,
    endDate: Date,
    sportTypesArray: string[],
    distanceBand: MapDistanceBand,
    isMetric: boolean,
    routeLines: boolean,
    sections: boolean,
    nameNeedle: string
  ): FfiMapScreenData | undefined =>
    mapsDelegates.getMapScreenData(
      this,
      startDate,
      endDate,
      sportTypesArray,
      distanceBand,
      isMetric,
      routeLines,
      sections,
      nameNeedle
    );

  getAllMapSignatures = (): {
    activityId: string;
    encodedCoords: ArrayBuffer;
    centerLat: number;
    centerLng: number;
  }[] => mapsDelegates.getAllMapSignatures(this);

  setRouteName = (routeId: string, name: string): void =>
    routeDelegates.setRouteName(this, routeId, name);

  setRouteRepresentative = (routeId: string, activityId: string): boolean =>
    routeDelegates.setRouteRepresentative(this, routeId, activityId);

  setSectionName = (
    sectionId: string,
    name: string
  ): import('./delegates/sections/mutations').SetSectionNameOutcome =>
    sectionDelegates.setSectionName(this, sectionId, name);

  setSectionIsLift = (sectionId: string, isLift: boolean): boolean =>
    sectionDelegates.setSectionIsLift(this, sectionId, isLift);

  getNamedCorridors = (): FfiNamedCorridor[] => sectionDelegates.getNamedCorridors(this);

  removeNamedCorridor = (intentId: string): boolean =>
    sectionDelegates.removeNamedCorridor(this, intentId);

  setNameTranslations = (routeWord: string, sectionWord: string): void =>
    settingsDelegates.setNameTranslations(this, routeWord, sectionWord);

  getAllRouteNames = (): Record<string, string> => routeDelegates.getAllRouteNames(this);

  getAllSectionNames = (): Record<string, string> => sectionDelegates.getAllSectionNames(this);

  /** Coordinate-encoded; put it through `decodeCoords`. */
  getGpsTrack = (activityId: string): ArrayBuffer =>
    activityDelegates.getGpsTrack(this, activityId);

  /**
   * One feed card's preview line, from the cached signature. Coordinate
   * encoded, so put `encodedCoords` through `decodeCoords`.
   */
  getPreviewTrack = (activityId: string): FfiPreviewTrack | undefined =>
    activityDelegates.getPreviewTrack(this, activityId);

  /** Coordinate-encoded; put it through `decodeCoords`. */
  getRepresentativeRoute = (groupId: string): ArrayBuffer =>
    routeDelegates.getRepresentativeRoute(this, groupId);

  getRoutePerformances = (
    routeGroupId: string,
    currentActivityId: string,
    sportType?: string
  ): FfiRoutePerformanceResult =>
    routeDelegates.getRoutePerformances(this, routeGroupId, currentActivityId, sportType);

  excludeActivityFromRoute = (routeId: string, activityId: string): void =>
    routeDelegates.excludeActivityFromRoute(this, routeId, activityId);

  includeActivityInRoute = (routeId: string, activityId: string): void =>
    routeDelegates.includeActivityInRoute(this, routeId, activityId);

  getExcludedRouteActivityIds = (routeId: string): string[] =>
    routeDelegates.getExcludedRouteActivityIds(this, routeId);

  getExcludedRoutePerformances = (routeId: string, sportType?: string): FfiRoutePerformanceResult =>
    routeDelegates.getExcludedRoutePerformances(this, routeId, sportType);

  getSectionPerformances = (sectionId: string, sportType?: string): FfiSectionPerformanceResult =>
    sectionDelegates.getSectionPerformances(this, sectionId, sportType);

  /**
   * Batched section-performance fetch - one FFI call for many section IDs.
   * Use this anywhere a `for (id of ids) getSectionPerformances(id)` loop
   * would otherwise pay N round-trips of FFI overhead (~10-30 ms each).
   */
  getPerformancesBatch = (
    sectionIds: string[],
    sportType?: string
  ): { sectionId: string; result: FfiSectionPerformanceResult }[] =>
    sectionDelegates.getPerformancesBatch(this, sectionIds, sportType);

  getWorkoutSections = (sportType: string, limit: number): sectionDelegates.FfiWorkoutSection[] =>
    sectionDelegates.getWorkoutSections(this, sportType, limit);

  getSectionEfficiencyTrend = (sectionId: string, sportType: string): FfiEfficiencyTrend | null =>
    sectionDelegates.getSectionEfficiencyTrend(this, sectionId, sportType);

  excludeActivityFromSection = (sectionId: string, activityId: string): boolean =>
    sectionDelegates.excludeActivityFromSection(this, sectionId, activityId);

  includeActivityInSection = (sectionId: string, activityId: string): boolean =>
    sectionDelegates.includeActivityInSection(this, sectionId, activityId);

  getExcludedActivityIds = (sectionId: string): string[] =>
    sectionDelegates.getExcludedActivityIds(this, sectionId);

  excludeSectionLap = (sectionId: string, activityId: string, startIndex: number): boolean =>
    sectionDelegates.excludeSectionLap(this, sectionId, activityId, startIndex);

  includeSectionLap = (sectionId: string, activityId: string, startIndex: number): boolean =>
    sectionDelegates.includeSectionLap(this, sectionId, activityId, startIndex);

  getSectionHistory = (sectionId: string) => sectionDelegates.getSectionHistory(this, sectionId);
  getSectionGeometryVersions = (sectionId: string) =>
    sectionDelegates.getSectionGeometryVersions(this, sectionId);
  getSectionGeometryVersionPolyline = (sectionId: string, version: number) =>
    sectionDelegates.getSectionGeometryVersionPolyline(this, sectionId, version);
  revertSectionToVersion = (sectionId: string, version: number) =>
    sectionDelegates.revertSectionToVersion(this, sectionId, version);
  unpinSection = (sectionId: string) => sectionDelegates.unpinSection(this, sectionId);
  getPinnedSectionVersion = (sectionId: string) =>
    sectionDelegates.getPinnedSectionVersion(this, sectionId);
  getRetiredSections = () => sectionDelegates.getRetiredSections(this);

  getRouteDetailData = (
    groupId: string,
    currentActivityId: string | undefined,
    minGroupActivities: number
  ): routeDelegates.RouteDetailData | undefined =>
    routeDelegates.getRouteDetailData(this, groupId, currentActivityId, minGroupActivities);

  getSectionDetailData = (sectionId: string): FfiSectionDetailData | undefined =>
    sectionDelegates.getSectionDetailData(this, sectionId);

  getSectionDetailPerformance = (
    sectionId: string,
    timeRangeDays: number,
    sportFilter?: string
  ): FfiSectionPerformanceData | undefined =>
    sectionDelegates.getSectionDetailPerformance(this, sectionId, timeRangeDays, sportFilter);

  setActivityMetrics = (metrics: FfiActivityMetrics[]): void =>
    activityDelegates.setActivityMetrics(this, metrics);

  setTimeStreams = (streams: { activityId: string; times: number[] }[]): void =>
    activityDelegates.setTimeStreams(this, streams);

  getActivitiesMissingTimeStreams = (activityIds: string[]): string[] =>
    activityDelegates.getActivitiesMissingTimeStreams(this, activityIds);

  queryViewport = (minLat: number, maxLat: number, minLng: number, maxLng: number): string[] =>
    mapsDelegates.queryViewport(this, minLat, maxLat, minLng, maxLng);

  /**
   * Everything launch does to the engine once the library's identity is
   * settled, in one call across the binding.
   */
  launchData = (input: launchDelegates.LaunchDataInput): PersistentEngineStats | undefined =>
    launchDelegates.launchData(this, input);

  getStats(): PersistentEngineStats | undefined {
    if (!this.ready) return undefined;
    return this.timed('getStats', () => this.engine.getStats());
  }

  /**
   * What each recent native push run did, newest first, for the Developer
   * Dashboard.
   *
   * The Android worker runs in a process with no JavaScript in it, so nothing
   * it does reaches the task-run ring in `AsyncStorage`. The engine is the one
   * thing both it and this screen can see.
   */
  pushRuns(): FfiPushRun[] {
    if (!this.ready) return [];
    return this.timed('pushRuns', () => this.engine.pushRuns());
  }

  /** Get activity IDs needing time stream fetch (NULL lap_time, no time_stream). */
  getActivitiesNeedingTimeStreams(): string[] {
    if (!this.ready) return [];
    return this.timed('getActivitiesNeedingTimeStreams', () =>
      this.engine.getActivitiesNeedingTimeStreams()
    );
  }

  getRoutesScreenData = (query: FfiRoutesScreenQuery): FfiRoutesScreenData | undefined =>
    routeDelegates.getRoutesScreenData(this, query);

  getSummaryCardData = (
    currentStart: number,
    currentEnd: number,
    prevStart: number,
    prevEnd: number
  ): FfiSummaryCardData =>
    fitnessDelegates.getSummaryCardData(this, currentStart, currentEnd, prevStart, prevEnd);

  getInsightsData = (params: FfiInsightsParams): FfiInsightsData | undefined =>
    fitnessDelegates.getInsightsData(this, params);

  getStartupData = (
    params: FfiInsightsParams,
    previewActivityIds: string[]
  ): FfiStartupData | undefined =>
    fitnessDelegates.getStartupData(this, params, previewActivityIds);

  recordFeedSeen = (event: FfiFeedSeen): void => fitnessDelegates.recordFeedSeen(this, event);

  composeWidgetSnapshot = (
    contextJson: string,
    nowSeconds: number,
    nowWallSeconds: number
  ): string | undefined =>
    fitnessDelegates.composeWidgetSnapshot(this, contextJson, nowSeconds, nowWallSeconds);

  setWidgetContext = (contextJson: string): boolean =>
    fitnessDelegates.setWidgetContext(this, contextJson);

  getZoneDistribution = (sportType: string, zoneType: string, startTs: number, endTs: number) =>
    fitnessDelegates.getZoneDistribution(this, sportType, zoneType, startTs, endTs);

  /**
   * Record one critical-speed snapshot under the range the curve covered.
   *
   * `windowDays` is part of what makes a snapshot distinct, because the pace
   * curve screen and the sync both write this and over different ranges. The
   * trend compares one window only.
   */
  savePaceSnapshot = (
    sportType: string,
    criticalSpeed: number,
    windowDays: number,
    dPrime?: number,
    r2?: number,
    date?: number
  ): void =>
    fitnessDelegates.savePaceSnapshot(this, sportType, criticalSpeed, windowDays, dPrime, r2, date);

  getAvailableSportTypes = (): string[] => fitnessDelegates.getAvailableSportTypes(this);

  /** The activities that moved the accepted eFTP, oldest first. */

  /** The cycling FTP trend across `lookbackDays`, with that window's daily series. */
  getFitnessScreenData = (): FfiFitnessScreenData => fitnessDelegates.getFitnessScreenData(this);

  getPeriodStats = (startTs: number, endTs: number) =>
    fitnessDelegates.getPeriodStats(this, startTs, endTs);

  getDailyActivityLoads = (startTs: number, endTs: number) =>
    fitnessDelegates.getDailyActivityLoads(this, startTs, endTs);

  getTrainingScreenData = (windows: FfiTrainingScreenWindows): FfiTrainingScreenData =>
    fitnessDelegates.getTrainingScreenData(this, windows);

  // ==========================================================================
  // Heatmap Tiles (Raster tile generation for map overlay)
  // ==========================================================================
  // Tile generation is handled in Rust on background threads.
  // Only clear is exposed to JS (for settings "clear cache").

  /** Enable heatmap tile generation by setting the tiles path. */
  enableHeatmapTiles = (): void => heatmapDelegates.enableHeatmapTiles(this);

  /**
   * The tiles path in force, or null when the athlete has the heatmap off.
   *
   * Remembered on this side because the engine's own copy is in memory and
   * goes with a clear, a quarantine reopen or an init retry.
   */
  heatmapTilesPath: string | null = null;

  /** Re-apply a remembered path to a freshly opened engine. */
  applyHeatmapTilesPath(path: string): void {
    try {
      this.handle?.heatmap().setTilesPath(path);
    } catch (e) {
      console.warn('[EngineClient] Failed to re-apply the heatmap tiles path:', e);
    }
  }

  /** Disable heatmap tile generation by clearing the tiles path in the engine. */
  disableHeatmapTiles = (): void => heatmapDelegates.disableHeatmapTiles(this);

  /** Stop the tile pass and the invalidation sweep, if either is running. */
  cancelHeatmapWork = (): boolean => heatmapDelegates.cancelHeatmapWork(this);

  setHeatmapPriorityView = (latitude: number, longitude: number, zoom: number): void =>
    heatmapDelegates.setHeatmapPriorityView(this, latitude, longitude, zoom);

  clearHeatmapPriorityView = (): void => heatmapDelegates.clearHeatmapPriorityView(this);

  startHeatmapCacheSize = (basePath: string): void =>
    heatmapDelegates.startHeatmapCacheSize(this, basePath);

  pollHeatmapCacheSize = (): heatmapDelegates.HeatmapCacheSizePoll =>
    heatmapDelegates.pollHeatmapCacheSize(this);

  /** Stop any tile pass, then clear the heatmap tiles. Rejects on a tile left on disk. */
  clearHeatmapTiles = (basePath: string): Promise<void> =>
    heatmapDelegates.clearHeatmapTiles(this, basePath);

  /** Get heatmap tile generation progress: [processed, total] */
  getHeatmapTileProgress = (): number[] | null => heatmapDelegates.getHeatmapTileProgress(this);

  /** Poll tile generation status: 'idle' | 'running' | 'complete' */
  pollTileGeneration = (): string => heatmapDelegates.pollTileGeneration(this);

  // ==========================================================================
  // Recording index (what this device has recorded, and its upload state)
  // ==========================================================================

  /** Add a recording. False means a row with that id was already there. */
  addRecording = (entry: recordingDelegates.RecordingEntry): boolean =>
    recordingDelegates.addRecording(this, entry);

  /** Every recording, newest first. */
  listRecordings = (): recordingDelegates.RecordingEntry[] =>
    recordingDelegates.listRecordings(this);

  getRecording = (id: string): recordingDelegates.RecordingEntry | null =>
    recordingDelegates.getRecording(this, id);

  listVisibleRecordings = (athleteId: string | undefined): recordingDelegates.RecordingEntry[] =>
    recordingDelegates.listVisibleRecordings(this, athleteId);

  getVisibleRecording = (
    id: string,
    athleteId: string | undefined
  ): recordingDelegates.RecordingEntry | null =>
    recordingDelegates.getVisibleRecording(this, id, athleteId);

  unuploadedVisibleRecordingCount = (athleteId: string | undefined): number =>
    recordingDelegates.unuploadedVisibleRecordingCount(this, athleteId);

  attachRecordingEngineActivity = (id: string, engineActivityId: string): void =>
    recordingDelegates.attachRecordingEngineActivity(this, id, engineActivityId);

  /** The engine row has taken the id intervals.icu gave the upload. */
  markRecordingReconciled = (id: string): void =>
    recordingDelegates.markRecordingReconciled(this, id);

  /** intervals.icu has the effort the athlete set. */
  markRecordingRpeSent = (id: string): void => recordingDelegates.markRecordingRpeSent(this, id);

  /** Move one recording's upload by a named transition. */
  transitionRecording = (
    id: string,
    transition: recordingDelegates.RecordingTransition,
    nowMs: number
  ): recordingDelegates.RecordingTransitionAnswer =>
    recordingDelegates.transitionRecording(this, id, transition, nowMs);

  /** Stops auto-uploading every ride this athlete did not record. */
  holdRecordingsOfOtherAthletes = (athleteId: string): void =>
    recordingDelegates.holdRecordingsOfOtherAthletes(this, athleteId);

  /** Names the library's athlete on every ride that has none. */
  stampOwnerlessRecordings = (athleteId: string): void =>
    recordingDelegates.stampOwnerlessRecordings(this, athleteId);

  clearRecordingPermissionBlocked = (athleteId: string): void =>
    recordingDelegates.clearRecordingPermissionBlocked(this, athleteId);

  /** Start the engine's upload schedule if it is not running, and wake it. */
  wakeUploadSchedule = (): void => recordingDelegates.wakeUploadSchedule(this);

  /** Upload one recording now and answer how it ended. */
  uploadRecording = (id: string, manual: boolean): Promise<FfiUploadResult> =>
    recordingDelegates.uploadRecording(this, id, manual);

  /** Remove a recording, answering the row so its files can be deleted too. */
  deleteOwnRecording = (
    id: string,
    athleteId: string | undefined
  ): recordingDelegates.RecordingEntry | null =>
    recordingDelegates.deleteOwnRecording(this, id, athleteId);

  /** Drop every recording row, which a `.veloqdb` restore leaves stale. */
  clearRecordings = (): void => recordingDelegates.clearRecordings(this);

  upsertWellness = (rows: fitnessDelegates.WellnessRowInput[]): void =>
    fitnessDelegates.upsertWellness(this, rows);

  getWellnessDays = (oldest: string, newest: string): fitnessDelegates.WellnessDay[] =>
    fitnessDelegates.getWellnessDays(this, oldest, newest);

  getWellnessLatestDate = (): string | null => fitnessDelegates.getWellnessLatestDate(this);

  getActivityBody = (activityId: string): string | null =>
    activityDelegates.getActivityBody(this, activityId);

  getActivityBodies = (oldestTs: number, newestTs: number): string[] =>
    activityDelegates.getActivityBodies(this, oldestTs, newestTs);

  searchActivityBodies = (
    query: activityDelegates.ActivityBodiesSearch
  ): FfiActivityBodiesPage | undefined => activityDelegates.searchActivityBodies(this, query);

  upsertActivityBodies = (rows: activityDelegates.ActivityBodyInput[]): void =>
    activityDelegates.upsertActivityBodies(this, rows);

  getActivityNames = (activityIds: string[]): activityDelegates.ActivityName[] =>
    activityDelegates.getActivityNames(this, activityIds);

  setIntervalBody = (activityId: string, raw: string): void =>
    activityDelegates.setIntervalBody(this, activityId, raw);

  setCurveBody = (
    kind: 'power' | 'pace',
    sport: string,
    days: number,
    gap: boolean,
    raw: string
  ): void => activityDelegates.setCurveBody(this, kind, sport, days, gap, raw);

  replaceCalendarEvents = (
    oldestTs: number,
    newestTs: number,
    rows: activityDelegates.CalendarEventBodyInput[]
  ): void => activityDelegates.replaceCalendarEvents(this, oldestTs, newestTs, rows);

  getStreamBody = (activityId: string, types: string): string | null =>
    activityDelegates.getStreamBody(this, activityId, types);

  getPowerCurve = (sport: string, days: number): fitnessDelegates.PowerCurveRow | null =>
    fitnessDelegates.getPowerCurve(this, sport, days);

  getPaceCurve = (
    sport: string,
    days: number,
    gap: boolean
  ): fitnessDelegates.PaceCurveRow | null => fitnessDelegates.getPaceCurve(this, sport, days, gap);

  getBestEffortsData = (days: number): FfiBestEffortsData | null =>
    fitnessDelegates.getBestEffortsData(this, days);

  getIntervalBody = (activityId: string): string | null =>
    fitnessDelegates.getIntervalBody(this, activityId);

  getCalendarEventBodies = (oldestTs: number, newestTs: number): string[] =>
    fitnessDelegates.getCalendarEventBodies(this, oldestTs, newestTs);

  getWeeklySummaries = (weekStarts: number[], weekLengthSecs: number) =>
    fitnessDelegates.getWeeklySummaries(this, weekStarts, weekLengthSecs);

  getWellnessSparklines = (days: number): fitnessDelegates.WellnessSparklines | null =>
    fitnessDelegates.getWellnessSparklines(this, days);

  // ==========================================================================
  // Athlete Profile & Sport Settings Cache
  // ==========================================================================

  setAthleteProfile = (json: string): void => settingsDelegates.setAthleteProfile(this, json);

  getAthleteProfile = (): string => settingsDelegates.getAthleteProfile(this);

  setSportSettings = (json: string): void => settingsDelegates.setSportSettings(this, json);

  getSportSettings = (): string => settingsDelegates.getSportSettings(this);

  hrZoneFor = (sportType: string, bpm: number): number | null =>
    settingsDelegates.hrZoneFor(this, sportType, bpm);

  // ==========================================================================
  // User Preferences (SQLite settings table)
  // ==========================================================================

  /** The export privacy row's suggested home, or null when there is no guess. */
  suggestExportHome = (): SuggestedHome | null => settingsDelegates.suggestExportHome(this);
  getBackupScreenData = (): FfiBackupScreenData | undefined =>
    settingsDelegates.getBackupScreenData(this);
  getCacheScreenData = (): FfiCacheScreenData | undefined =>
    settingsDelegates.getCacheScreenData(this);
  getBackgroundJobsData = (): FfiBackgroundJobsData | undefined =>
    settingsDelegates.getBackgroundJobsData(this);

  exportPrivacyPreview = (
    homeLat: number,
    homeLng: number,
    radiusM: number
  ): ExportPrivacyPreview | null =>
    settingsDelegates.exportPrivacyPreview(this, homeLat, homeLng, radiusM);

  buildGpxFile = (
    name: string,
    sport: string | undefined,
    time: string | undefined,
    points: FfiGpsPoint[]
  ): FfiGpxFile | null => settingsDelegates.buildGpxFile(this, name, sport, time, points);

  engineInstall = (): number => settingsDelegates.engineInstall(this);

  getSetting = (key: string): string | undefined => settingsDelegates.getSetting(this, key);

  setSetting = (key: string, value: string): void => settingsDelegates.setSetting(this, key, value);

  setSettings = (pairs: SettingPair[]): void => settingsDelegates.setSettings(this, pairs);

  setNotificationTemplates = (locale: string, templates: SettingPair[]): boolean =>
    settingsDelegates.setNotificationTemplates(this, locale, templates);

  notificationTemplates = (): FfiNotificationTemplates | undefined =>
    settingsDelegates.notificationTemplates(this);

  deleteSetting = (key: string): void => settingsDelegates.deleteSetting(this, key);

  streamRetentionDays = (): number | undefined => settingsDelegates.streamRetentionDays(this);

  setStreamRetentionDays = (days: number): void =>
    settingsDelegates.setStreamRetentionDays(this, days);

  streamStoreBytes = (): number => settingsDelegates.streamStoreBytes(this);

  // ==========================================================================
  // Backup
  // ==========================================================================

  /**
   * Copy the database on a Rust thread as the rollback a destructive clear
   * stands on, resolving when the copy has landed.
   *
   * The ceiling is the caller's: `features/settings/lib/clearSnapshot.ts` stops
   * waiting at its budget, and the copy runs on. A failed copy rejects,
   * carrying the Rust message.
   */
  async writeClearSnapshot(destPath: string): Promise<void> {
    if (!this.ready) throw new Error('Engine not initialized');
    await this.engine.writeClearSnapshot(destPath);
  }

  async runRecordBackup(destPath: string): Promise<void> {
    if (!this.ready) throw new Error('Engine not initialized');
    await this.engine.runRecordBackup(destPath);
  }

  /** Rejects with the restore's own refusal, without restoring anything. */
  async checkRecordZip(path: string): Promise<void> {
    if (!this.ready) throw new Error('Engine not initialized');
    await this.engine.checkRecordZip(path);
  }

  async restoreRecordZip(path: string): Promise<FfiRecordRestoreResult> {
    if (!this.ready) throw new Error('Engine not initialized');
    return this.engine.restoreRecordZip(path);
  }

  async restoreRecordJson(json: string): Promise<FfiRecordRestoreResult> {
    if (!this.ready) throw new Error('Engine not initialized');
    return this.engine.restoreRecordJson(json);
  }

  /** Drops the paused import, leaving the library and the waiting records. */
  async discardRecordImport(): Promise<void> {
    if (!this.ready) throw new Error('Engine not initialized');
    await this.engine.discardRecordImport();
  }

  async getUnplacedBackupRecords(): Promise<FfiUnplacedRecord[]> {
    if (!this.ready) throw new Error('Engine not initialized');
    return this.engine.getUnplacedBackupRecords();
  }

  async convertLegacyDatabaseToRecordBackup(sourcePath: string, destPath: string): Promise<void> {
    await generated.convertLegacyDatabaseToRecordBackup(sourcePath, destPath);
  }

  getBackupMetadata(): Record<string, unknown> {
    if (!this.ready) return {};
    const raw = this.timed('getBackupMetadata', () => this.engine.getBackupMetadata());
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /**
   * Write every GPS activity to one file on a Rust thread, resolving with what
   * it wrote.
   *
   * The file is written from a connection of its own, so neither this thread
   * nor the engine's write lock waits for it. The ceiling is the caller's, and
   * `bulkExportProgress` is what a progress bar reads while it runs.
   */
  async runBulkExport(
    format: BulkExportFormat,
    destPath: string
  ): Promise<{
    exported: number;
    noTrack: number;
    trimmed: number;
    failed: number;
    totalBytes: number;
  }> {
    if (!this.ready) throw new Error('Engine not initialized');
    const result: FfiBulkExportResult = await this.engine.runBulkExport(format, destPath);
    return {
      exported: result.exported,
      noTrack: result.noTrack,
      trimmed: result.trimmed,
      failed: result.failed,
      totalBytes: Number(result.totalBytes),
    };
  }

  /** How far the running export has got, or nothing running. */
  bulkExportProgress(): { running: boolean; visited: number; total: number } {
    if (!this.ready) return { running: false, visited: 0, total: 0 };
    return this.timed('bulkExportProgress', () => this.engine.bulkExportProgress());
  }

  computePolylineOverlap(coordsA: number[], coordsB: number[], thresholdMeters = 50): number {
    return this.timed('computePolylineOverlap', () =>
      generated.computePolylineOverlap(coordsA, coordsB, thresholdMeters)
    );
  }

  getSectionsByType = (sectionType?: 'auto' | 'custom'): FfiSection[] =>
    sectionDelegates.getSectionsByType(this, sectionType);

  createSectionFromIndices = (
    activityId: string,
    startIndex: number,
    endIndex: number,
    sportType: string,
    name?: string
  ): string =>
    sectionDelegates.createSectionFromIndices(
      this,
      activityId,
      startIndex,
      endIndex,
      sportType,
      name
    );

  deleteSection = (sectionId: string): boolean => sectionDelegates.deleteSection(this, sectionId);

  disableSection = (sectionId: string): boolean => sectionDelegates.disableSection(this, sectionId);

  enableSection = (sectionId: string): boolean => sectionDelegates.enableSection(this, sectionId);

  setSectionReference = (sectionId: string, activityId: string): FfiDepartedRide[] | null =>
    sectionDelegates.setSectionReference(this, sectionId, activityId);

  resetSectionReference = (sectionId: string): FfiDepartedRide[] | null =>
    sectionDelegates.resetSectionReference(this, sectionId);

  getSectionReferenceInfo = (sectionId: string): { activityId?: string; isUserDefined: boolean } =>
    sectionDelegates.getSectionReferenceInfo(this, sectionId);

  // ==========================================================================
  // Section Bounds Trimming
  // ==========================================================================

  trimSection = (
    sectionId: string,
    startIndex: number,
    endIndex: number
  ): FfiDepartedRide[] | null =>
    sectionDelegates.trimSection(this, sectionId, startIndex, endIndex);

  resetSectionBounds = (sectionId: string): FfiDepartedRide[] | null =>
    sectionDelegates.resetSectionBounds(this, sectionId);

  getSectionExtensionTrack = (
    sectionId: string
  ): {
    encodedTrack: ArrayBuffer;
    sectionStartIdx: number;
    sectionEndIdx: number;
  } | null => sectionDelegates.getSectionExtensionTrack(this, sectionId);

  expandSectionBounds = (
    sectionId: string,
    activityId: string,
    startIndex: number,
    endIndex: number
  ): FfiDepartedRide[] | null =>
    sectionDelegates.expandSectionBounds(this, sectionId, activityId, startIndex, endIndex);

  getFetchRunProgress(run: number): DownloadProgressResult {
    return this.timed('getFetchRunProgress', () => generated.getFetchRunProgress(run));
  }

  startFetchAndStore(
    activityIds: string[],
    sportTypes: generated.ActivitySportMapping[],
    priority: generated.DownloadPriority
  ): number {
    return this.timed('startFetchAndStore', () =>
      generated.startFetchAndStore(activityIds, sportTypes, priority)
    );
  }

  cancelFetchAndStore(run: number): boolean {
    return this.timed('cancelFetchAndStore', () => generated.cancelFetchAndStore(run));
  }

  takeFetchAndStoreResult(run: number): generated.FetchAndStoreResult | undefined {
    return this.timed('takeFetchAndStoreResult', () => generated.takeFetchAndStoreResult(run));
  }

  removeActivity = (activityId: string): activityDelegates.RemoveActivityResult =>
    activityDelegates.removeActivity(this, activityId);

  debugCloneActivity = (sourceId: string, count: number): number =>
    activityDelegates.debugCloneActivity(this, sourceId, count);

  getActivityHighlightsBundle = (
    activityIds: string[]
  ): activityDelegates.ActivityHighlightsBundle =>
    activityDelegates.getActivityHighlightsBundle(this, activityIds);

  getActivityDetailData = (
    activityId: string,
    minRouteActivities: number
  ): FfiActivityDetailData | undefined =>
    activityDelegates.getActivityDetailData(this, activityId, minRouteActivities);

  // ========================================================================
  // Strength Training
  // ========================================================================

  getExerciseSets = (activityId: string): FfiExerciseSession =>
    strengthDelegates.getExerciseSets(this, activityId);

  getExerciseDetailData = (exerciseCategory: number): FfiExerciseDetailData | null =>
    strengthDelegates.getExerciseDetailData(this, exerciseCategory);

  isFitProcessed = (activityId: string): boolean =>
    strengthDelegates.isFitProcessed(this, activityId);

  fetchAndParseExerciseSets = (activityId: string): FfiStartResult =>
    strengthDelegates.fetchAndParseExerciseSets(this, activityId);

  /**
   * Insert pre-parsed exercise sets for an activity without touching the
   * network. Demo-mode only - production uses fetchAndParseExerciseSets.
   */
  bulkInsertExerciseSets = (activityId: string, sets: FfiExerciseSet[]): void =>
    strengthDelegates.bulkInsertExerciseSets(this, activityId, sets);

  getMuscleGroups = (activityId: string): FfiMuscleGroup[] =>
    strengthDelegates.getMuscleGroups(this, activityId);

  /** Every strength activity still owed a FIT. */
  getUnprocessedStrengthIds = (): string[] => strengthDelegates.getUnprocessedStrengthIds(this);

  batchFetchExerciseSets = (activityIds: string[]): FfiStartResult =>
    strengthDelegates.batchFetchExerciseSets(this, activityIds);

  getStrengthScreenData = (
    startTs: number,
    endTs: number,
    weekRanges: { startTs: number; endTs: number }[]
  ): FfiStrengthScreenData =>
    strengthDelegates.getStrengthScreenData(this, startTs, endTs, weekRanges);

  getMuscleDetail = (
    activityId: string,
    muscleSlug: string
  ): strengthDelegates.MuscleGroupDetailFfi | null =>
    strengthDelegates.getMuscleDetail(this, activityId, muscleSlug);

  hasStrengthData = (): boolean => strengthDelegates.hasStrengthData(this);

  getActivitiesForExercise = (
    startTs: number,
    endTs: number,
    muscleSlug: string,
    exerciseCategory: number
  ): FfiExerciseActivities =>
    strengthDelegates.getActivitiesForExercise(this, startTs, endTs, muscleSlug, exerciseCategory);

  // ========================================================================
  // Section Matching, Nearby, Merge, Re-detect
  // ========================================================================

  matchActivityToSections = (activityId: string): FfiSectionMatch[] =>
    sectionDelegates.matchActivityToSections(this, activityId);

  rematchActivityToSection = (activityId: string, sectionId: string): boolean =>
    sectionDelegates.rematchActivityToSection(this, activityId, sectionId);

  indexNewActivity = (activityId: string): FfiIndexActivitySummary | null =>
    sectionDelegates.indexNewActivity(this, activityId);

  mergeSections = (primaryId: string, secondaryId: string): FfiMergeOutcome | null =>
    sectionDelegates.mergeSections(this, primaryId, secondaryId);

  mergePreview = (primaryId: string, secondaryId: string): FfiMergeDropped[] | null =>
    sectionDelegates.mergePreview(this, primaryId, secondaryId);

  acceptSection = (sectionId: string): boolean => sectionDelegates.acceptSection(this, sectionId);

  acceptAllSections = (): number => sectionDelegates.acceptAllSections(this);

  getActivityRouteHighlights = (activityIds: string[]): FfiActivityRouteHighlight[] =>
    routeDelegates.getActivityRouteHighlights(this, activityIds);

  forceRedetectSections = (): FfiStartResult => detectionDelegates.forceRedetectSections(this);

  setSectionConfig = (config: FfiSectionConfig): void =>
    detectionDelegates.setSectionConfig(this, config);

  getSectionConfig = (): FfiSectionConfig | null => detectionDelegates.getSectionConfig(this);

  setMatchStrictness = (minMatchPct: number, endpointThreshold: number): void =>
    detectionDelegates.setMatchStrictness(this, minMatchPct, endpointThreshold);

  getMatchStrictness = (): FfiMatchStrictness | null => detectionDelegates.getMatchStrictness(this);

  /**
   * Whether a subscription can ever fire.
   *
   * Withholding the observer is deliberate, see `initWithPath`, but it turns
   * every announcement into nothing. Paths that follow a run on its event
   * alone read this to decide whether the event is worth waiting for.
   */
  eventsAreLive(): boolean {
    return this.observerRegistered;
  }

  /**
   * The event seam, end to end, for the Developer Dashboard.
   *
   * Three counts per channel say where an announcement stopped: arrived here
   * from Rust, delivered to a listener, and how many are listening now. The
   * two errors are the reasons registration can fail, kept as strings because
   * a release build drops the warn that used to be the only record.
   */
  engineEventDiagnostics(): EngineEventDiagnostics {
    const listeners: Record<string, number> = {};
    for (const [event, set] of this.listeners) {
      if (set.size > 0) listeners[event] = set.size;
    }
    return {
      live: this.observerRegistered,
      bindingInitError: this.bindingInitError,
      observerError: this.observerError,
      received: Object.fromEntries(this.received),
      delivered: Object.fromEntries(this.delivered),
      listeners,
    };
  }

  subscribe(event: string, callback: EngineListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * The listener Rust calls when work finishes off the JavaScript thread.
   *
   * The binding blocks the calling Rust thread until each method returns, so
   * every one of these hands straight to a microtask and returns. No method
   * here may read the engine.
   */
  private observer(): EngineObserver {
    const post = (event: EngineEvent, payload?: EnginePayload) => {
      this.received.set(event, (this.received.get(event) ?? 0) + 1);
      queueMicrotask(() => this.deliver(event, payload));
    };
    return {
      syncProgress: () => post('syncProgress'),
      syncSettled: () => {
        post('syncSettled');
        post('sync');
      },
      activitiesStored: () => post('activitiesStored'),
      bodyStored: (kind, activityId) => post('bodyStored', { kind, activityId }),
      timeStreamsStored: (activityIds) => post('timeStreamsStored', { activityIds }),
      gpsTrackStored: (activityId) => post('gpsTrackStored', { activityId }),
      gpsTracksMutated: (activityIds) => post('gpsTracksMutated', { activityIds }),
      fitParsed: (activityId) => post('fitParsed', { activityId }),
      // The worker applies and settles its own run, so no poll sees it end:
      // this notice is the one place that knows the catalogue changed. The
      // refresh is queued like every other, so it reads nothing here either.
      detectionApplied: () => {
        post('detectionApplied');
        this.triggerRefresh('sections');
      },
      tilesGenerated: () => post('tilesGenerated'),
      backfillPhase: (phase) => post('backfillPhase', { phase }),
      streamBackfillPhase: (phase) => post('streamBackfillPhase', { phase }),
      cutoverSettled: () => post('cutoverSettled'),
      previewPhase: (phase) => post('previewPhase', { phase }),
      previewFinished: () => post('previewFinished'),
      recordingsChanged: () => post('recordingsChanged'),
      uploadPermissionRefused: () => post('uploadPermissionRefused'),
    };
  }

  /**
   * Hand one event to everyone listening for it.
   *
   * Over a copy, because `Set.forEach` visits entries added during its own
   * iteration and a listener that re-subscribes from inside its callback,
   * which `requestSyncRefresh` does whenever the outcome is retryable, was
   * then visited again for as long as it kept doing so. `NotReady` is
   * retryable and holds for the whole window between `destroy` and
   * `initWithPath`, so pull to refresh followed by Clear and Sync span it and
   * the loop never ends.
   *
   * A listener that unsubscribed earlier in the same delivery is skipped: the
   * copy says who was listening when the event arrived, and the live set says
   * who still is.
   *
   * Each call is wrapped, because one listener throwing used to skip every
   * listener behind it on that channel and nothing said so.
   */
  private deliver(event: string, payload?: EnginePayload): void {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return;
    this.delivered.set(event, (this.delivered.get(event) ?? 0) + 1);
    for (const cb of [...listeners]) {
      if (!listeners.has(cb)) continue;
      try {
        cb(payload);
      } catch (e) {
        console.warn(`[EngineClient] a ${event} listener threw:`, e);
      }
    }
  }

  /**
   * Announce a body this process wrote, the way Rust announces one it stored.
   *
   * Demo mode seeds the same tables a live sync writes, through the same engine
   * writers, but the writes are FFI calls and nothing announces them. A reader
   * that follows a body's kind rather than the coarse `activities` channel would
   * otherwise never hear about a seeded table.
   */
  announceBodyStored(kind: string, activityId = ''): void {
    queueMicrotask(() => this.deliver('bodyStored', { kind, activityId }));
  }

  triggerRefresh(event: 'groups' | 'sections' | 'activities' | 'syncReset'): void {
    if (event === 'syncReset') {
      this.notifyImmediate(event);
      return;
    }
    this.pendingNotifications.add(event);
    if (!this.notifyScheduled) {
      this.notifyScheduled = true;
      queueMicrotask(() => {
        const events = [...this.pendingNotifications];
        this.pendingNotifications.clear();
        this.notifyScheduled = false;
        for (const e of events) {
          this.notifyImmediate(e);
        }
      });
    }
  }

  notify(event: string): void {
    this.triggerRefresh(event as 'groups' | 'sections' | 'activities' | 'syncReset');
  }

  private notifyImmediate(event: string): void {
    this.deliver(event);
  }

  notifyAll(...events: string[]): void {
    events.forEach((event) =>
      this.triggerRefresh(event as 'groups' | 'sections' | 'activities' | 'syncReset')
    );
  }
}

export { EngineClient };
