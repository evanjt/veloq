import ExpoModulesCore
import os.log

// Logger for debugging
private let logger = Logger(subsystem: "com.veloq.app", category: "RouteMatcher")

/**
 * Route Matcher native module powered by Rust.
 *
 * Uses the compiled Rust library via UniFFI for high-performance
 * GPS route matching with Average Minimum Distance (AMD) and parallel processing.
 *
 * IMPORTANT: This module REQUIRES the Rust library. There is no JavaScript fallback.
 * Build the Rust library with: npm run rust:ios
 */
public class RouteMatcherModule: Module {

    public func definition() -> ModuleDefinition {
        Name("RouteMatcher")

        // Module initialization - verify Rust library is available
        OnCreate {
            logger.info("RouteMatcher: Initializing Rust-powered route matching")
            // Call defaultConfig to verify Rust is linked
            let _ = defaultConfig()
            logger.info("RouteMatcher: Rust library verified and ready")
        }

        // Verify Rust is working - used by CI tests
        Function("verifyRustAvailable") { () -> [String: Any] in
            logger.info("verifyRustAvailable: Testing Rust library")

            // Test 1: Get default config (basic FFI test)
            let config = defaultConfig()

            // Test 2: Create a simple signature (algorithm test)
            let testPoints = [
                GpsPoint(latitude: 51.5074, longitude: -0.1278, elevation: nil),
                GpsPoint(latitude: 51.5080, longitude: -0.1290, elevation: nil),
                GpsPoint(latitude: 51.5090, longitude: -0.1300, elevation: nil),
                GpsPoint(latitude: 51.5100, longitude: -0.1310, elevation: nil),
                GpsPoint(latitude: 51.5110, longitude: -0.1320, elevation: nil)
            ]

            guard let signature = createSignatureWithConfig(
                activityId: "test-verification",
                points: testPoints,
                config: config
            ) else {
                logger.error("verifyRustAvailable: Failed to create test signature")
                return [
                    "success": false,
                    "error": "Failed to create test signature"
                ]
            }

            // Test 3: Verify signature has expected properties
            guard signature.points.count >= 2,
                  signature.totalDistance > 0 else {
                logger.error("verifyRustAvailable: Invalid signature properties")
                return [
                    "success": false,
                    "error": "Invalid signature properties"
                ]
            }

            logger.info("verifyRustAvailable: All tests passed - Rust is fully functional")

            return [
                "success": true,
                "rustVersion": "0.1.0",
                "configValues": [
                    "perfectThreshold": config.perfectThreshold,
                    "zeroThreshold": config.zeroThreshold,
                    "minMatchPercentage": config.minMatchPercentage
                ],
                "testSignature": [
                    "pointCount": signature.points.count,
                    "totalDistance": signature.totalDistance
                ]
            ]
        }

        // Create a route signature from GPS points
        Function("createSignature") { (activityId: String, points: [[String: Double]], config: [String: Any]?) -> [String: Any]? in
            logger.info("createSignature called for \(activityId) with \(points.count) points")

            let gpsPoints = points.compactMap { dict -> GpsPoint? in
                guard let lat = dict["latitude"], let lng = dict["longitude"] else { return nil }
                let elevation = dict["elevation"]
                return GpsPoint(latitude: lat, longitude: lng, elevation: elevation)
            }

            let matchConfig = self.parseConfig(config)

            guard let signature = createSignatureWithConfig(activityId: activityId, points: gpsPoints, config: matchConfig) else {
                logger.warning("Failed to create signature for \(activityId)")
                return nil
            }

            logger.info("Created signature: \(signature.points.count) points, \(Int(signature.totalDistance))m")
            return self.signatureToMap(signature)
        }

        // Compare two routes
        Function("compareRoutes") { (sig1Map: [String: Any], sig2Map: [String: Any], config: [String: Any]?) -> [String: Any]? in
            guard let sig1 = self.mapToSignature(sig1Map), let sig2 = self.mapToSignature(sig2Map) else {
                return nil
            }

            let matchConfig = self.parseConfig(config)

            logger.debug("Comparing \(sig1.activityId) vs \(sig2.activityId)")

            guard let result = ffiCompareRoutes(sig1: sig1, sig2: sig2, config: matchConfig) else {
                return nil
            }

            logger.info("Match found: \(Int(result.matchPercentage))% (\(result.direction))")

            return [
                "activityId1": result.activityId1,
                "activityId2": result.activityId2,
                "matchPercentage": result.matchPercentage,
                "direction": result.direction,
                "amd": result.amd
            ]
        }

        // Group similar routes together
        Function("groupSignatures") { (signatureMaps: [[String: Any]], config: [String: Any]?) -> [[String: Any]] in
            logger.info("RUST groupSignatures called with \(signatureMaps.count) signatures")

            let signatures = signatureMaps.compactMap { self.mapToSignature($0) }
            let matchConfig = self.parseConfig(config)

            let startTime = CFAbsoluteTimeGetCurrent()
            let groups = ffiGroupSignatures(signatures: signatures, config: matchConfig)
            let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000

            logger.info("Grouped into \(groups.count) groups in \(Int(elapsed))ms")

            return groups.map { group in
                [
                    "groupId": group.groupId,
                    "activityIds": group.activityIds
                ]
            }
        }

        // Get default configuration
        Function("getDefaultConfig") { () -> [String: Any] in
            logger.info("getDefaultConfig called - Rust is active!")
            let config = defaultConfig()
            return [
                "perfectThreshold": config.perfectThreshold,
                "zeroThreshold": config.zeroThreshold,
                "minMatchPercentage": config.minMatchPercentage,
                "minRouteDistance": config.minRouteDistance,
                "maxDistanceDiffRatio": config.maxDistanceDiffRatio,
                "endpointThreshold": config.endpointThreshold,
                "resampleCount": Int(config.resampleCount),
                "simplificationTolerance": config.simplificationTolerance,
                "maxSimplifiedPoints": Int(config.maxSimplifiedPoints)
            ]
        }

        // Create signatures from flat buffer
        Function("createSignaturesFlatBuffer") { (activityIds: [String], coords: [Double], offsets: [Int], config: [String: Any]?) -> [[String: Any]] in
            logger.info("FLAT BUFFER createSignatures: \(activityIds.count) tracks, \(coords.count) coords")

            guard activityIds.count == offsets.count else {
                logger.error("ERROR: activityIds.count (\(activityIds.count)) != offsets.count (\(offsets.count))")
                return []
            }

            let flatTracks = activityIds.enumerated().map { (index, activityId) -> FlatGpsTrack in
                let start = offsets[index]
                let end = (index + 1 < offsets.count) ? offsets[index + 1] : coords.count
                let trackCoords = Array(coords[start..<end])
                return FlatGpsTrack(activityId: activityId, coords: trackCoords)
            }

            let matchConfig = self.parseConfig(config)

            let startTime = CFAbsoluteTimeGetCurrent()
            let signatures = createSignaturesFromFlat(tracks: flatTracks, config: matchConfig)
            let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000

            logger.info("FLAT BUFFER: \(flatTracks.count) tracks -> \(signatures.count) signatures in \(Int(elapsed))ms")

            return signatures.map { self.signatureToMap($0) }
        }

        // Process routes using flat buffer with offsets
        Function("processRoutesFlatBuffer") { (activityIds: [String], coords: [Double], offsets: [Int], config: [String: Any]?) -> [[String: Any]] in
            logger.info("FLAT BUFFER processRoutes: \(activityIds.count) tracks, \(coords.count) coords")

            guard activityIds.count == offsets.count else {
                logger.error("ERROR: activityIds.count (\(activityIds.count)) != offsets.count (\(offsets.count))")
                return []
            }

            let flatTracks = activityIds.enumerated().map { (index, activityId) -> FlatGpsTrack in
                let start = offsets[index]
                let end = (index + 1 < offsets.count) ? offsets[index + 1] : coords.count
                let trackCoords = Array(coords[start..<end])
                return FlatGpsTrack(activityId: activityId, coords: trackCoords)
            }

            let matchConfig = self.parseConfig(config)

            let startTime = CFAbsoluteTimeGetCurrent()
            let groups = processRoutesFromFlat(tracks: flatTracks, config: matchConfig)
            let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000

            logger.info("FLAT BUFFER: \(flatTracks.count) tracks -> \(groups.count) groups in \(Int(elapsed))ms")

            return groups.map { group in
                [
                    "groupId": group.groupId,
                    "activityIds": group.activityIds
                ]
            }
        }

        // INCREMENTAL: Efficiently add new signatures to existing groups
        Function("groupIncremental") { (newSignatures: [[String: Any]], existingGroups: [[String: Any]], existingSignatures: [[String: Any]], config: [String: Any]?) -> [[String: Any]] in
            logger.info("INCREMENTAL grouping: \(newSignatures.count) new + \(existingSignatures.count) existing")

            let newSigs = newSignatures.compactMap { self.mapToSignature($0) }
            let existingSigs = existingSignatures.compactMap { self.mapToSignature($0) }
            let groups = existingGroups.compactMap { self.mapToRouteGroup($0) }

            let matchConfig = self.parseConfig(config)
            let startTime = CFAbsoluteTimeGetCurrent()
            let result = ffiGroupIncremental(newSignatures: newSigs, existingGroups: groups, existingSignatures: existingSigs, config: matchConfig)
            let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000

            logger.info("INCREMENTAL returned \(result.count) groups in \(Int(elapsed))ms")

            return result.map { group in
                [
                    "groupId": group.groupId,
                    "representativeId": group.representativeId,
                    "activityIds": group.activityIds,
                    "sportType": group.sportType,
                    "bounds": group.bounds.map { b in
                        ["minLat": b.minLat, "maxLat": b.maxLat, "minLng": b.minLng, "maxLng": b.maxLng]
                    } as Any,
                    "customName": group.customName ?? ""
                ]
            }
        }

        // Section detection: Get conservative section config
        Function("conservativeSectionConfig") { () -> [String: Any] in
            let config = conservativeSectionConfig()
            return [
                "proximity_threshold": config.proximityThreshold,
                "min_section_length": config.minSectionLength,
                "min_activities": config.minActivities,
                "cluster_tolerance": config.clusterTolerance,
                "sample_points": config.samplePoints
            ]
        }

        // Section detection: Get legacy section config
        Function("legacySectionConfig") { () -> [String: Any] in
            let config = legacySectionConfig()
            return [
                "proximity_threshold": config.proximityThreshold,
                "min_section_length": config.minSectionLength,
                "min_activities": config.minActivities,
                "cluster_tolerance": config.clusterTolerance,
                "sample_points": config.samplePoints
            ]
        }

        // Section detection from GPS tracks
        // Returns JSON string for efficient bridge serialization
        Function("detectSectionsFromTracks") { (activityIds: [String], allCoords: [Double], offsets: [Int], sportTypes: [[String: Any]], groups: [[String: Any]], config: [String: Any]?) -> String in
            logger.info("detectSectionsFromTracks: \(activityIds.count) activities, \(allCoords.count / 2) coords")

            let routeGroups = groups.compactMap { self.mapToRouteGroup($0) }
            let types = sportTypes.compactMap { dict -> ActivitySportType? in
                guard let activityId = dict["activity_id"] as? String,
                      let sportType = dict["sport_type"] as? String else { return nil }
                return ActivitySportType(activityId: activityId, sportType: sportType)
            }

            let sectionConfig = self.parseSectionConfig(config)
            let offsetsU32 = offsets.map { UInt32($0) }

            let startTime = CFAbsoluteTimeGetCurrent()
            let result = ffiDetectSectionsMultiscale(
                activityIds: activityIds,
                allCoords: allCoords,
                offsets: offsetsU32,
                sportTypes: types,
                groups: routeGroups,
                config: sectionConfig
            )
            let rustElapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
            logger.info("detectSectionsFromTracks Rust: \(result.sections.count) sections, \(result.potentials.count) potentials in \(Int(rustElapsed))ms")

            // Serialize confirmed sections to JSON (potentials are not yet validated sections)
            let jsonStart = CFAbsoluteTimeGetCurrent()
            let jsonResult = self.sectionsToJson(result.sections)
            let jsonElapsed = (CFAbsoluteTimeGetCurrent() - jsonStart) * 1000
            logger.info("detectSectionsFromTracks JSON: \(Int(jsonElapsed))ms, \(jsonResult.count) chars")

            return jsonResult
        }

        // Heatmap: Get default config
        Function("defaultHeatmapConfig") { () -> [String: Any] in
            // HeatmapConfig doesn't have a default function in tracematch 0.0.3
            // Create a default config with cell_size_meters = 100 and no bounds (auto-calculate)
            return [
                "cell_size_meters": 100.0,
                "bounds": nil as Any?
            ]
        }

        // Heatmap: Generate heatmap from signatures
        // All parameters are JSON strings to avoid Expo Modules bridge serialization issues with nulls
        Function("generateHeatmap") { (signaturesJson: String, activityDataJson: String, configJson: String) -> [String: Any] in
            guard let sigData = signaturesJson.data(using: .utf8),
                  let sigArray = try? JSONSerialization.jsonObject(with: sigData) as? [[String: Any]] else {
                logger.error("generateHeatmap: Failed to parse signatures JSON")
                return [:]
            }
            logger.info("generateHeatmap: \(sigArray.count) signatures")

            let signatures = sigArray.compactMap { self.mapToSignature($0) }

            guard let activityData = activityDataJson.data(using: .utf8),
                  let activityArray = try? JSONSerialization.jsonObject(with: activityData) as? [[String: Any]] else {
                logger.error("generateHeatmap: Failed to parse activityData JSON")
                return [:]
            }

            let heatmapActivityData = activityArray.map { obj -> ActivityHeatmapData in
                ActivityHeatmapData(
                    activityId: obj["activity_id"] as? String ?? "",
                    routeId: obj["route_id"] as? String,
                    routeName: obj["route_name"] as? String,
                    timestamp: (obj["timestamp"] as? NSNumber)?.int64Value
                )
            }

            guard let configData = configJson.data(using: .utf8),
                  let configObj = try? JSONSerialization.jsonObject(with: configData) as? [String: Any] else {
                logger.error("generateHeatmap: Failed to parse config JSON")
                return [:]
            }

            var heatmapBounds: HeatmapBounds? = nil
            if let boundsDict = configObj["bounds"] as? [String: Double] {
                heatmapBounds = HeatmapBounds(
                    minLat: boundsDict["min_lat"] ?? 0,
                    maxLat: boundsDict["max_lat"] ?? 0,
                    minLng: boundsDict["min_lng"] ?? 0,
                    maxLng: boundsDict["max_lng"] ?? 0
                )
            }

            let heatmapConfig = HeatmapConfig(
                cellSizeMeters: (configObj["cell_size_meters"] as? Double) ?? 100.0,
                bounds: heatmapBounds
            )

            let startTime = CFAbsoluteTimeGetCurrent()
            let result = ffiGenerateHeatmap(signatures: signatures, activityData: heatmapActivityData, config: heatmapConfig)
            let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000

            logger.info("generateHeatmap returned \(result.cells.count) cells in \(Int(elapsed))ms")

            return [
                "cells": result.cells.map { cell in
                    [
                        "row": Int(cell.row),
                        "col": Int(cell.col),
                        "center_lat": cell.centerLat,
                        "center_lng": cell.centerLng,
                        "density": cell.density,
                        "visit_count": Int(cell.visitCount),
                        "route_refs": cell.routeRefs.map { r in
                            ["route_id": r.routeId, "activity_count": Int(r.activityCount), "name": r.name as Any]
                        },
                        "unique_route_count": Int(cell.uniqueRouteCount),
                        "activity_ids": cell.activityIds,
                        "first_visit": cell.firstVisit as Any,
                        "last_visit": cell.lastVisit as Any,
                        "is_common_path": cell.isCommonPath
                    ] as [String: Any]
                },
                "bounds": [
                    "min_lat": result.bounds.minLat,
                    "max_lat": result.bounds.maxLat,
                    "min_lng": result.bounds.minLng,
                    "max_lng": result.bounds.maxLng
                ],
                "cell_size_meters": Int(result.cellSizeMeters),
                "grid_rows": Int(result.gridRows),
                "grid_cols": Int(result.gridCols),
                "max_density": result.maxDensity,
                "total_routes": Int(result.totalRoutes),
                "total_activities": Int(result.totalActivities)
            ]
        }

        // ==========================================================================
        // Persistent Route Engine (SQLite-backed, memory efficient)
        // ==========================================================================

        // PersistentEngine: Initialize with database path
        Function("persistentEngineInit") { (dbPath: String) -> Bool in
            let result = persistentEngineInit(dbPath: dbPath)
            logger.info("PersistentEngine: Initialized = \(result)")
            return result
        }

        // PersistentEngine: Check if initialized
        Function("persistentEngineIsInitialized") { () -> Bool in
            return persistentEngineIsInitialized()
        }

        // PersistentEngine: Clear all state
        Function("persistentEngineClear") { () -> Void in
            persistentEngineClear()
            logger.info("PersistentEngine: Cleared")
        }

        // PersistentEngine: Add activities from flat buffers
        Function("persistentEngineAddActivities") { (activityIds: [String], allCoords: [Double], offsets: [Int], sportTypes: [String]) -> Void in
            logger.info("PersistentEngine: Adding \(activityIds.count) activities")
            let offsetsU32 = offsets.map { UInt32($0) }
            persistentEngineAddActivities(activityIds: activityIds, allCoords: allCoords, offsets: offsetsU32, sportTypes: sportTypes)
        }

        // PersistentEngine: Remove activities
        Function("persistentEngineRemoveActivities") { (activityIds: [String]) -> Void in
            logger.info("PersistentEngine: Removing \(activityIds.count) activities")
            persistentEngineRemoveActivities(activityIds: activityIds)
        }

        // PersistentEngine: Get all activity IDs
        Function("persistentEngineGetActivityIds") { () -> [String] in
            return persistentEngineGetActivityIds()
        }

        // PersistentEngine: Get activity count
        Function("persistentEngineGetActivityCount") { () -> Int in
            return Int(persistentEngineGetActivityCount())
        }

        // PersistentEngine: Get groups as JSON
        Function("persistentEngineGetGroupsJson") { () -> String in
            return persistentEngineGetGroupsJson()
        }

        // PersistentEngine: Get sections as JSON
        Function("persistentEngineGetSectionsJson") { () -> String in
            return persistentEngineGetSectionsJson()
        }

        // PersistentEngine: Query viewport
        Function("persistentEngineQueryViewport") { (minLat: Double, maxLat: Double, minLng: Double, maxLng: Double) -> [String] in
            return persistentEngineQueryViewport(minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng)
        }

        // PersistentEngine: Get consensus route as flat coords
        Function("persistentEngineGetConsensusRoute") { (groupId: String) -> [Double] in
            return persistentEngineGetConsensusRoute(groupId: groupId)
        }

        // PersistentEngine: Get GPS track as flat coords
        Function("persistentEngineGetGpsTrack") { (activityId: String) -> [Double] in
            return persistentEngineGetGpsTrack(activityId: activityId)
        }

        // PersistentEngine: Get stats
        Function("persistentEngineGetStats") { () -> [String: Any]? in
            guard let stats = persistentEngineGetStats() else { return nil }
            return [
                "activity_count": Int(stats.activityCount),
                "signature_cache_size": Int(stats.signatureCacheSize),
                "consensus_cache_size": Int(stats.consensusCacheSize),
                "group_count": Int(stats.groupCount),
                "section_count": Int(stats.sectionCount),
                "groups_dirty": stats.groupsDirty,
                "sections_dirty": stats.sectionsDirty
            ]
        }

        // PersistentEngine: Start background section detection
        Function("persistentEngineStartSectionDetection") { (sportFilter: String?) -> Bool in
            return persistentEngineStartSectionDetection(sportFilter: sportFilter)
        }

        // PersistentEngine: Poll section detection status
        Function("persistentEnginePollSections") { () -> String in
            return persistentEnginePollSections()
        }

        // PersistentEngine: Cancel section detection
        Function("persistentEngineCancelSectionDetection") { () -> Void in
            persistentEngineCancelSectionDetection()
        }

        // PersistentEngine: Set custom route name
        Function("persistentEngineSetRouteName") { (routeId: String, name: String) -> Void in
            persistentEngineSetRouteName(routeId: routeId, name: name)
        }

        // PersistentEngine: Get custom route name
        Function("persistentEngineGetRouteName") { (routeId: String) -> String? in
            return persistentEngineGetRouteName(routeId: routeId)
        }

        // PersistentEngine: Get all custom route names as JSON
        Function("persistentEngineGetAllRouteNamesJson") { () -> String in
            return persistentEngineGetAllRouteNamesJson()
        }

        // PersistentEngine: Set custom section name
        Function("persistentEngineSetSectionName") { (sectionId: String, name: String) -> Void in
            persistentEngineSetSectionName(sectionId: sectionId, name: name)
        }

        // PersistentEngine: Get custom section name
        Function("persistentEngineGetSectionName") { (sectionId: String) -> String? in
            return persistentEngineGetSectionName(sectionId: sectionId)
        }

        // PersistentEngine: Get all custom section names as JSON
        Function("persistentEngineGetAllSectionNamesJson") { () -> String in
            return persistentEngineGetAllSectionNamesJson()
        }

        // ==========================================================================
        // Custom Sections (User-created sections)
        // ==========================================================================

        // PersistentEngine: Add a custom section from JSON
        Function("persistentEngineAddCustomSection") { (sectionJson: String) -> Bool in
            logger.info("PersistentEngine: Adding custom section")
            return persistentEngineAddCustomSection(sectionJson: sectionJson)
        }

        // PersistentEngine: Remove a custom section
        Function("persistentEngineRemoveCustomSection") { (sectionId: String) -> Bool in
            logger.info("PersistentEngine: Removing custom section \(sectionId)")
            return persistentEngineRemoveCustomSection(sectionId: sectionId)
        }

        // PersistentEngine: Get all custom sections as JSON
        Function("persistentEngineGetCustomSectionsJson") { () -> String in
            return persistentEngineGetCustomSectionsJson()
        }

        // PersistentEngine: Match a custom section against activities
        Function("persistentEngineMatchCustomSection") { (sectionId: String, activityIds: [String]) -> String in
            logger.info("PersistentEngine: Matching custom section \(sectionId) against \(activityIds.count) activities")
            return persistentEngineMatchCustomSection(sectionId: sectionId, activityIds: activityIds)
        }

        // PersistentEngine: Get cached matches for a custom section
        Function("persistentEngineGetCustomSectionMatches") { (sectionId: String) -> String in
            return persistentEngineGetCustomSectionMatches(sectionId: sectionId)
        }

        // PersistentEngine: Extract GPS trace for activity overlapping with section
        Function("persistentEngineExtractSectionTrace") { (activityId: String, polylineJson: String) -> [Double] in
            return persistentEngineExtractSectionTrace(activityId: activityId, sectionPolylineJson: polylineJson)
        }

        // ==========================================================================
        // HTTP Activity Fetching (high-performance with connection pooling)
        // ==========================================================================

        // Fetch activity map data from intervals.icu API
        // Uses connection pooling, rate limiting, and parallel fetching
        AsyncFunction("fetchActivityMaps") { (apiKey: String, activityIds: [String]) -> [[String: Any]] in
            logger.info("fetchActivityMaps: Fetching \(activityIds.count) activities")
            let startTime = Date()

            let results = fetchActivityMaps(apiKey: apiKey, activityIds: activityIds)

            let elapsed = Date().timeIntervalSince(startTime) * 1000
            let successCount = results.filter { $0.success }.count
            logger.info("fetchActivityMaps: \(successCount)/\(activityIds.count) success in \(Int(elapsed))ms")

            return results.map { result in
                [
                    "activityId": result.activityId,
                    "bounds": result.bounds,
                    "latlngs": result.latlngs,
                    "success": result.success,
                    "error": result.error as Any
                ]
            }
        }

        // Heatmap: Query cell at location
        // heatmapJson is a JSON string to avoid Expo Modules bridge issues with nulls
        Function("queryHeatmapCell") { (heatmapJson: String, lat: Double, lng: Double) -> [String: Any]? in
            guard let heatmapData = heatmapJson.data(using: .utf8),
                  let heatmapObj = try? JSONSerialization.jsonObject(with: heatmapData) as? [String: Any],
                  let cellMaps = heatmapObj["cells"] as? [[String: Any]],
                  let boundsMap = heatmapObj["bounds"] as? [String: Double] else {
                logger.error("queryHeatmapCell: Failed to parse heatmap JSON")
                return nil
            }

            let cells = cellMaps.compactMap { c -> HeatmapCell? in
                guard let routeRefMaps = c["route_refs"] as? [[String: Any]] else { return nil }
                return HeatmapCell(
                    row: Int32((c["row"] as? Int) ?? 0),
                    col: Int32((c["col"] as? Int) ?? 0),
                    centerLat: (c["center_lat"] as? Double) ?? 0,
                    centerLng: (c["center_lng"] as? Double) ?? 0,
                    density: Float((c["density"] as? Double) ?? 0),
                    visitCount: UInt32((c["visit_count"] as? Int) ?? 0),
                    routeRefs: routeRefMaps.map { r in
                        RouteRef(
                            routeId: r["route_id"] as? String ?? "",
                            activityCount: UInt32((r["activity_count"] as? Int) ?? 0),
                            name: r["name"] as? String
                        )
                    },
                    uniqueRouteCount: UInt32((c["unique_route_count"] as? Int) ?? 0),
                    activityIds: c["activity_ids"] as? [String] ?? [],
                    firstVisit: c["first_visit"] as? Int64,
                    lastVisit: c["last_visit"] as? Int64,
                    isCommonPath: (c["is_common_path"] as? Bool) ?? false
                )
            }

            let heatmap = HeatmapResult(
                cells: cells,
                bounds: HeatmapBounds(
                    minLat: boundsMap["min_lat"] ?? 0,
                    maxLat: boundsMap["max_lat"] ?? 0,
                    minLng: boundsMap["min_lng"] ?? 0,
                    maxLng: boundsMap["max_lng"] ?? 0
                ),
                cellSizeMeters: (heatmapObj["cell_size_meters"] as? Double) ?? 100,
                gridRows: UInt32((heatmapObj["grid_rows"] as? Int) ?? 0),
                gridCols: UInt32((heatmapObj["grid_cols"] as? Int) ?? 0),
                maxDensity: Float((heatmapObj["max_density"] as? Double) ?? 0),
                totalRoutes: UInt32((heatmapObj["total_routes"] as? Int) ?? 0),
                totalActivities: UInt32((heatmapObj["total_activities"] as? Int) ?? 0)
            )

            guard let queryResult = ffiQueryHeatmapCell(heatmap: heatmap, lat: lat, lng: lng) else {
                return nil
            }

            return [
                "cell": [
                    "row": Int(queryResult.cell.row),
                    "col": Int(queryResult.cell.col),
                    "center_lat": queryResult.cell.centerLat,
                    "center_lng": queryResult.cell.centerLng,
                    "density": queryResult.cell.density,
                    "visit_count": Int(queryResult.cell.visitCount),
                    "route_refs": queryResult.cell.routeRefs.map { ref in
                        ["route_id": ref.routeId, "activity_count": Int(ref.activityCount), "name": ref.name as Any]
                    },
                    "unique_route_count": Int(queryResult.cell.uniqueRouteCount),
                    "activity_ids": queryResult.cell.activityIds,
                    "first_visit": queryResult.cell.firstVisit as Any,
                    "last_visit": queryResult.cell.lastVisit as Any,
                    "is_common_path": queryResult.cell.isCommonPath
                ],
                "suggested_label": queryResult.suggestedLabel
            ]
        }
    }

    // MARK: - Helper Functions

    private func parseConfig(_ map: [String: Any]?) -> MatchConfig {
        guard let map = map else { return defaultConfig() }

        let defaults = defaultConfig()

        return MatchConfig(
            perfectThreshold: (map["perfectThreshold"] as? Double) ?? defaults.perfectThreshold,
            zeroThreshold: (map["zeroThreshold"] as? Double) ?? defaults.zeroThreshold,
            minMatchPercentage: (map["minMatchPercentage"] as? Double) ?? defaults.minMatchPercentage,
            minRouteDistance: (map["minRouteDistance"] as? Double) ?? defaults.minRouteDistance,
            maxDistanceDiffRatio: (map["maxDistanceDiffRatio"] as? Double) ?? defaults.maxDistanceDiffRatio,
            endpointThreshold: (map["endpointThreshold"] as? Double) ?? defaults.endpointThreshold,
            resampleCount: UInt32((map["resampleCount"] as? Int) ?? Int(defaults.resampleCount)),
            simplificationTolerance: (map["simplificationTolerance"] as? Double) ?? defaults.simplificationTolerance,
            maxSimplifiedPoints: UInt32((map["maxSimplifiedPoints"] as? Int) ?? Int(defaults.maxSimplifiedPoints))
        )
    }

    private func signatureToMap(_ sig: RouteSignature) -> [String: Any] {
        return [
            "activityId": sig.activityId,
            "points": sig.points.map { ["latitude": $0.latitude, "longitude": $0.longitude] },
            "totalDistance": sig.totalDistance,
            "startPoint": ["latitude": sig.startPoint.latitude, "longitude": sig.startPoint.longitude],
            "endPoint": ["latitude": sig.endPoint.latitude, "longitude": sig.endPoint.longitude],
            "bounds": [
                "minLat": sig.bounds.minLat,
                "maxLat": sig.bounds.maxLat,
                "minLng": sig.bounds.minLng,
                "maxLng": sig.bounds.maxLng
            ],
            "center": ["latitude": sig.center.latitude, "longitude": sig.center.longitude]
        ]
    }

    private func parseScalePresets(_ value: Any?) -> [ScalePreset]? {
        guard let list = value as? [[String: Any]] else { return nil }
        return list.map { preset in
            ScalePreset(
                name: (preset["name"] as? String) ?? "medium",
                minLength: (preset["min_length"] as? Double) ?? 500.0,
                maxLength: (preset["max_length"] as? Double) ?? 5000.0,
                minActivities: UInt32((preset["min_activities"] as? Int) ?? 3)
            )
        }
    }

    private func parseSectionConfig(_ map: [String: Any]?) -> SectionConfig {
        guard let map = map else { return conservativeSectionConfig() }

        let defaults = conservativeSectionConfig()

        return SectionConfig(
            proximityThreshold: (map["proximity_threshold"] as? Double) ?? defaults.proximityThreshold,
            minSectionLength: (map["min_section_length"] as? Double) ?? defaults.minSectionLength,
            maxSectionLength: (map["max_section_length"] as? Double) ?? defaults.maxSectionLength,
            minActivities: UInt32((map["min_activities"] as? Int) ?? Int(defaults.minActivities)),
            clusterTolerance: (map["cluster_tolerance"] as? Double) ?? defaults.clusterTolerance,
            samplePoints: UInt32((map["sample_points"] as? Int) ?? Int(defaults.samplePoints)),
            detectionMode: (map["detection_mode"] as? String) ?? defaults.detectionMode,
            includePotentials: (map["include_potentials"] as? Bool) ?? defaults.includePotentials,
            scalePresets: parseScalePresets(map["scale_presets"]) ?? defaults.scalePresets,
            preserveHierarchy: (map["preserve_hierarchy"] as? Bool) ?? defaults.preserveHierarchy
        )
    }

    private func sectionToMap(_ section: FrequentSection) -> [String: Any] {
        return [
            "id": section.id,
            "sport_type": section.sportType,
            "polyline": section.polyline.map { ["latitude": $0.latitude, "longitude": $0.longitude] },
            "representative_activity_id": section.representativeActivityId,
            "activity_ids": section.activityIds,
            "activity_portions": section.activityPortions.map { portion in
                [
                    "activity_id": portion.activityId,
                    "start_index": portion.startIndex,
                    "end_index": portion.endIndex,
                    "distance_meters": portion.distanceMeters,
                    "direction": portion.direction
                ] as [String: Any]
            },
            "route_ids": section.routeIds,
            "visit_count": section.visitCount,
            "distance_meters": section.distanceMeters,
            // Pre-computed activity traces: map of activityId -> GPS points overlapping with section
            "activity_traces": section.activityTraces.mapValues { points in
                points.map { ["latitude": $0.latitude, "longitude": $0.longitude] }
            },
            // Consensus polyline metrics
            "confidence": section.confidence,
            "observation_count": section.observationCount,
            "average_spread": section.averageSpread,
            // Per-point density for section splitting
            "point_density": section.pointDensity.map { Int($0) }
        ]
    }

    /// Serialize FrequentSection list to JSON string.
    /// Much faster than dictionary conversion for complex nested structures.
    private func sectionsToJson(_ sections: [FrequentSection]) -> String {
        var jsonArray: [[String: Any]] = []

        for section in sections {
            var sectionDict: [String: Any] = [
                "id": section.id,
                "sport_type": section.sportType,
                "representative_activity_id": section.representativeActivityId,
                "visit_count": section.visitCount,
                "distance_meters": section.distanceMeters,
                "activity_ids": section.activityIds,
                "route_ids": section.routeIds
            ]

            // Polyline
            sectionDict["polyline"] = section.polyline.map { point in
                ["latitude": point.latitude, "longitude": point.longitude]
            }

            // Activity portions
            sectionDict["activity_portions"] = section.activityPortions.map { portion in
                [
                    "activity_id": portion.activityId,
                    "start_index": portion.startIndex,
                    "end_index": portion.endIndex,
                    "distance_meters": portion.distanceMeters,
                    "direction": portion.direction
                ] as [String: Any]
            }

            // Activity traces
            var tracesDict: [String: [[String: Double]]] = [:]
            for (activityId, points) in section.activityTraces {
                tracesDict[activityId] = points.map { point in
                    ["latitude": point.latitude, "longitude": point.longitude]
                }
            }
            sectionDict["activity_traces"] = tracesDict

            // Consensus metrics
            sectionDict["confidence"] = section.confidence
            sectionDict["observation_count"] = section.observationCount
            sectionDict["average_spread"] = section.averageSpread
            sectionDict["point_density"] = section.pointDensity.map { Int($0) }

            jsonArray.append(sectionDict)
        }

        // Serialize to JSON string
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: jsonArray, options: [])
            return String(data: jsonData, encoding: .utf8) ?? "[]"
        } catch {
            logger.error("Failed to serialize sections to JSON: \(error.localizedDescription)")
            return "[]"
        }
    }

    private func mapToSignature(_ map: [String: Any]) -> RouteSignature? {
        guard let activityId = map["activityId"] as? String,
              let pointMaps = map["points"] as? [[String: Double]],
              let totalDistance = map["totalDistance"] as? Double,
              let startMap = map["startPoint"] as? [String: Double],
              let endMap = map["endPoint"] as? [String: Double],
              let boundsMap = map["bounds"] as? [String: Double],
              let centerMap = map["center"] as? [String: Double] else {
            return nil
        }

        let points = pointMaps.compactMap { dict -> GpsPoint? in
            guard let lat = dict["latitude"], let lng = dict["longitude"] else { return nil }
            let elevation = dict["elevation"]
            return GpsPoint(latitude: lat, longitude: lng, elevation: elevation)
        }

        guard let startLat = startMap["latitude"], let startLng = startMap["longitude"],
              let endLat = endMap["latitude"], let endLng = endMap["longitude"],
              let minLat = boundsMap["minLat"], let maxLat = boundsMap["maxLat"],
              let minLng = boundsMap["minLng"], let maxLng = boundsMap["maxLng"],
              let centerLat = centerMap["latitude"], let centerLng = centerMap["longitude"] else {
            return nil
        }

        let startElevation = startMap["elevation"]
        let endElevation = endMap["elevation"]
        let centerElevation = centerMap["elevation"]

        let startPoint = GpsPoint(latitude: startLat, longitude: startLng, elevation: startElevation)
        let endPoint = GpsPoint(latitude: endLat, longitude: endLng, elevation: endElevation)
        let bounds = Bounds(minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng)
        let center = GpsPoint(latitude: centerLat, longitude: centerLng, elevation: centerElevation)

        return RouteSignature(
            activityId: activityId,
            points: points,
            totalDistance: totalDistance,
            startPoint: startPoint,
            endPoint: endPoint,
            bounds: bounds,
            center: center
        )
    }

    private func parseBounds(_ dict: [String: Double]?) -> Bounds? {
        guard let b = dict else { return nil }
        return Bounds(
            minLat: b["minLat"] ?? 0,
            maxLat: b["maxLat"] ?? 0,
            minLng: b["minLng"] ?? 0,
            maxLng: b["maxLng"] ?? 0
        )
    }

    private func mapToRouteGroup(_ dict: [String: Any]) -> RouteGroup? {
        guard let groupId = dict["groupId"] as? String,
              let activityIds = dict["activityIds"] as? [String] else { return nil }

        return RouteGroup(
            groupId: groupId,
            representativeId: dict["representativeId"] as? String ?? activityIds.first ?? "",
            activityIds: activityIds,
            sportType: dict["sportType"] as? String ?? "",
            bounds: parseBounds(dict["bounds"] as? [String: Double]),
            customName: dict["customName"] as? String
        )
    }
}
