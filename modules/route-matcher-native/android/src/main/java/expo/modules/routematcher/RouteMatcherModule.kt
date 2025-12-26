package expo.modules.routematcher

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.route_matcher.*

/**
 * Route Matcher native module powered by Rust.
 *
 * Uses the compiled Rust library via UniFFI for high-performance
 * GPS route matching with Fréchet distance and parallel processing.
 */
class RouteMatcherModule : Module() {
  companion object {
    private const val TAG = "RouteMatcherRust"
  }

  override fun definition() = ModuleDefinition {
    Name("RouteMatcher")

    // Define events that can be sent to JS
    Events("onFetchProgress")

    // Create a route signature from GPS points
    Function("createSignature") { activityId: String, points: List<Map<String, Double>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀 createSignature called for $activityId with ${points.size} points")

      val gpsPoints = points.mapNotNull { dict ->
        val lat = dict["latitude"] ?: return@mapNotNull null
        val lng = dict["longitude"] ?: return@mapNotNull null
        GpsPoint(lat, lng)
      }

      val matchConfig = parseConfig(config)

      val signature = createSignatureWithConfig(activityId, gpsPoints, matchConfig)

      if (signature != null) {
        Log.i(TAG, "🦀 Created signature: ${signature.points.size} points, ${signature.totalDistance.toInt()}m")
        signatureToMap(signature)
      } else {
        Log.w(TAG, "🦀 Failed to create signature for $activityId")
        null
      }
    }

    // Compare two routes
    Function("compareRoutes") { sig1Map: Map<String, Any>, sig2Map: Map<String, Any>, config: Map<String, Any>? ->
      val sig1 = mapToSignature(sig1Map) ?: return@Function null
      val sig2 = mapToSignature(sig2Map) ?: return@Function null
      val matchConfig = parseConfig(config)

      Log.d(TAG, "🦀 Comparing ${sig1.activityId} vs ${sig2.activityId}")

      val result = ffiCompareRoutes(sig1, sig2, matchConfig)

      if (result != null) {
        Log.i(TAG, "🦀 Match found: ${result.matchPercentage.toInt()}% (${result.direction})")
        mapOf(
          "activityId1" to result.activityId1,
          "activityId2" to result.activityId2,
          "matchPercentage" to result.matchPercentage,
          "direction" to result.direction,
          "amd" to result.amd
        )
      } else {
        null
      }
    }

    // Group similar routes together
    Function("groupSignatures") { signatureMaps: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 RUST groupSignatures called with ${signatureMaps.size} signatures 🦀🦀🦀")

      val signatures = signatureMaps.mapNotNull { mapToSignature(it) }
      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val groups = ffiGroupSignatures(signatures, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 Grouped into ${groups.size} groups in ${elapsed}ms")

      groups.map { group ->
        mapOf(
          "groupId" to group.groupId,
          "activityIds" to group.activityIds
        )
      }
    }

    // Get default configuration
    Function("getDefaultConfig") {
      Log.i(TAG, "🦀 getDefaultConfig called - Rust is active!")
      val config = defaultConfig()
      mapOf(
        "perfectThreshold" to config.perfectThreshold,
        "zeroThreshold" to config.zeroThreshold,
        "minMatchPercentage" to config.minMatchPercentage,
        "minRouteDistance" to config.minRouteDistance,
        "maxDistanceDiffRatio" to config.maxDistanceDiffRatio,
        "endpointThreshold" to config.endpointThreshold,
        "resampleCount" to config.resampleCount.toInt(),
        "simplificationTolerance" to config.simplificationTolerance,
        "maxSimplifiedPoints" to config.maxSimplifiedPoints.toInt()
      )
    }

    // BATCH: Create multiple signatures in parallel (MUCH faster for many activities)
    Function("createSignaturesBatch") { tracks: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 BATCH createSignatures called with ${tracks.size} tracks 🦀🦀🦀")

      @Suppress("UNCHECKED_CAST")
      val gpsTracks = tracks.mapNotNull { track ->
        val activityId = track["activityId"] as? String ?: return@mapNotNull null
        val pointMaps = track["points"] as? List<Map<String, Double>> ?: return@mapNotNull null

        val gpsPoints = pointMaps.mapNotNull { dict ->
          val lat = dict["latitude"] ?: return@mapNotNull null
          val lng = dict["longitude"] ?: return@mapNotNull null
          GpsPoint(lat, lng)
        }

        GpsTrack(activityId, gpsPoints)
      }

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val signatures = createSignaturesBatch(gpsTracks, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 BATCH created ${signatures.size} signatures in ${elapsed}ms")

      signatures.map { signatureToMap(it) }
    }

    // BATCH: Full end-to-end processing (signatures + grouping) in one call
    Function("processRoutesBatch") { tracks: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 FULL BATCH processRoutes called with ${tracks.size} tracks 🦀🦀🦀")

      @Suppress("UNCHECKED_CAST")
      val gpsTracks = tracks.mapNotNull { track ->
        val activityId = track["activityId"] as? String ?: return@mapNotNull null
        val pointMaps = track["points"] as? List<Map<String, Double>> ?: return@mapNotNull null

        val gpsPoints = pointMaps.mapNotNull { dict ->
          val lat = dict["latitude"] ?: return@mapNotNull null
          val lng = dict["longitude"] ?: return@mapNotNull null
          GpsPoint(lat, lng)
        }

        GpsTrack(activityId, gpsPoints)
      }

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val groups = processRoutesBatch(gpsTracks, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 FULL BATCH: ${gpsTracks.size} tracks -> ${groups.size} groups in ${elapsed}ms")

      groups.map { group ->
        mapOf(
          "groupId" to group.groupId,
          "activityIds" to group.activityIds
        )
      }
    }

    // OPTIMIZED: Process routes using flat coordinate arrays (TypedArray from JS)
    // Each track has activityId (String) and coords (DoubleArray: [lat1, lng1, lat2, lng2, ...])
    // This avoids the overhead of Map<String, Double> for each GPS point
    Function("processRoutesFlat") { activityIds: List<String>, coordArrays: List<DoubleArray>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 FLAT processRoutes called with ${activityIds.size} tracks 🦀🦀🦀")

      if (activityIds.size != coordArrays.size) {
        Log.e(TAG, "🦀 ERROR: activityIds.size (${activityIds.size}) != coordArrays.size (${coordArrays.size})")
        return@Function emptyList<Map<String, Any>>()
      }

      // Convert to FlatGpsTrack for Rust
      val flatTracks = activityIds.mapIndexed { index, activityId ->
        FlatGpsTrack(activityId, coordArrays[index].toList())
      }

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val groups = processRoutesFromFlat(flatTracks, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 FLAT BATCH: ${flatTracks.size} tracks -> ${groups.size} groups in ${elapsed}ms")

      groups.map { group ->
        mapOf(
          "groupId" to group.groupId,
          "activityIds" to group.activityIds
        )
      }
    }

    // OPTIMIZED: Create signatures from flat buffer (returns signatures, not groups)
    // Used when we need signatures for incremental caching
    Function("createSignaturesFlatBuffer") { activityIds: List<String>, coords: DoubleArray, offsets: IntArray, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 FLAT BUFFER createSignatures: ${activityIds.size} tracks, ${coords.size} coords 🦀🦀🦀")

      if (activityIds.size != offsets.size) {
        Log.e(TAG, "🦀 ERROR: activityIds.size (${activityIds.size}) != offsets.size (${offsets.size})")
        return@Function emptyList<Map<String, Any>>()
      }

      // Split the flat buffer into individual track coords using offsets
      val flatTracks = activityIds.mapIndexed { index, activityId ->
        val start = offsets[index]
        val end = if (index + 1 < offsets.size) offsets[index + 1] else coords.size
        val trackCoords = coords.slice(start until end)
        FlatGpsTrack(activityId, trackCoords)
      }

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val signatures = createSignaturesFromFlat(flatTracks, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 FLAT BUFFER: ${flatTracks.size} tracks -> ${signatures.size} signatures in ${elapsed}ms")

      signatures.map { signatureToMap(it) }
    }

    // OPTIMIZED V2: Single flat buffer with offsets (most efficient)
    // coords: flat DoubleArray [lat1, lng1, lat2, lng2, ...]
    // offsets: IntArray marking where each track starts in the coords array
    // activityIds: List<String> of activity IDs in same order as offsets
    Function("processRoutesFlatBuffer") { activityIds: List<String>, coords: DoubleArray, offsets: IntArray, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 FLAT BUFFER processRoutes: ${activityIds.size} tracks, ${coords.size} coords 🦀🦀🦀")

      if (activityIds.size != offsets.size) {
        Log.e(TAG, "🦀 ERROR: activityIds.size (${activityIds.size}) != offsets.size (${offsets.size})")
        return@Function emptyList<Map<String, Any>>()
      }

      // Split the flat buffer into individual track coords using offsets
      val flatTracks = activityIds.mapIndexed { index, activityId ->
        val start = offsets[index]
        val end = if (index + 1 < offsets.size) offsets[index + 1] else coords.size
        val trackCoords = coords.slice(start until end)
        FlatGpsTrack(activityId, trackCoords)
      }

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val groups = processRoutesFromFlat(flatTracks, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 FLAT BUFFER: ${flatTracks.size} tracks -> ${groups.size} groups in ${elapsed}ms")

      groups.map { group ->
        mapOf(
          "groupId" to group.groupId,
          "activityIds" to group.activityIds
        )
      }
    }

    // HTTP: Fetch activity map data from intervals.icu API
    // Uses Rust HTTP client with dispatch rate limiting (12.5 req/s, 80ms intervals)
    Function("fetchActivityMaps") { apiKey: String, activityIds: List<String> ->
      Log.i(TAG, "🦀🦀🦀 HTTP fetchActivityMaps [v6-sustained] called for ${activityIds.size} activities 🦀🦀🦀")

      val totalStart = System.currentTimeMillis()

      // Time the Rust call (network + parsing)
      val rustStart = System.currentTimeMillis()
      val results = fetchActivityMaps(apiKey, activityIds)
      val rustElapsed = System.currentTimeMillis() - rustStart

      val successCount = results.count { it.success }
      val errorCount = results.count { !it.success }
      val totalPoints = results.sumOf { it.latlngs.size / 2 }
      val totalBytes = results.sumOf { it.latlngs.size * 8 }  // 8 bytes per f64
      val rate = activityIds.size.toDouble() / (rustElapsed / 1000.0)

      Log.i(TAG, "🦀 [TIMING] Rust fetch+parse: ${rustElapsed}ms (${String.format("%.1f", rate)} req/s)")
      Log.i(TAG, "🦀 [DATA] $successCount success ($errorCount errors), $totalPoints points, ${totalBytes / 1024}KB")

      // Time FFI: Rust -> Kotlin object conversion (this is in the Rust call above)
      // Time the Kotlin->JS map conversion
      val convertStart = System.currentTimeMillis()
      val converted = results.map { result ->
        mapOf(
          "activityId" to result.activityId,
          "bounds" to result.bounds,
          "latlngs" to result.latlngs,
          "success" to result.success,
          "error" to result.error
        )
      }
      val convertElapsed = System.currentTimeMillis() - convertStart

      val totalElapsed = System.currentTimeMillis() - totalStart
      Log.i(TAG, "🦀 [TIMING] Kotlin->Map: ${convertElapsed}ms | Total: ${totalElapsed}ms")

      converted
    }

    // HTTP: Fetch activity map data WITH real-time progress events
    // Emits "onFetchProgress" event after each activity is fetched
    // Uses AsyncFunction so JS isn't blocked and can receive events
    AsyncFunction("fetchActivityMapsWithProgress") { apiKey: String, activityIds: List<String> ->
      Log.i(TAG, "🦀🦀🦀 HTTP fetchActivityMapsWithProgress called for ${activityIds.size} activities 🦀🦀🦀")

      val totalStart = System.currentTimeMillis()
      val module = this@RouteMatcherModule

      // Create a callback that sends progress events to JS
      val progressCallback = object : FetchProgressCallback {
        override fun onProgress(completed: UInt, total: UInt) {
          Log.d(TAG, "🦀 Progress: $completed/$total")
          module.sendEvent("onFetchProgress", mapOf(
            "completed" to completed.toInt(),
            "total" to total.toInt()
          ))
        }
      }

      // Time the Rust call with progress callback
      val rustStart = System.currentTimeMillis()
      val results = fetchActivityMapsWithProgress(apiKey, activityIds, progressCallback)
      val rustElapsed = System.currentTimeMillis() - rustStart

      val successCount = results.count { it.success }
      val errorCount = results.count { !it.success }
      val rate = activityIds.size.toDouble() / (rustElapsed / 1000.0)

      Log.i(TAG, "🦀 [TIMING] Rust fetch+progress: ${rustElapsed}ms (${String.format("%.1f", rate)} req/s)")
      Log.i(TAG, "🦀 [DATA] $successCount success ($errorCount errors)")

      // Convert to JS maps
      val converted = results.map { result ->
        mapOf(
          "activityId" to result.activityId,
          "bounds" to result.bounds,
          "latlngs" to result.latlngs,
          "success" to result.success,
          "error" to result.error
        )
      }

      val totalElapsed = System.currentTimeMillis() - totalStart
      Log.i(TAG, "🦀 [TIMING] Total: ${totalElapsed}ms")

      converted
    }

    // HTTP: Fetch and process activities in one call (fetch maps + create signatures)
    Function("fetchAndProcessActivities") { apiKey: String, activityIds: List<String>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀🦀🦀 HTTP fetchAndProcessActivities called for ${activityIds.size} activities 🦀🦀🦀")

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val result = fetchAndProcessActivities(apiKey, activityIds, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      val successCount = result.mapResults.count { it.success }
      Log.i(TAG, "🦀 HTTP+Process: $successCount/${activityIds.size} fetched, ${result.signatures.size} signatures in ${elapsed}ms")

      mapOf(
        "mapResults" to result.mapResults.map { r ->
          mapOf(
            "activityId" to r.activityId,
            "bounds" to r.bounds,
            "latlngs" to r.latlngs,
            "success" to r.success,
            "error" to r.error
          )
        },
        "signatures" to result.signatures.map { signatureToMap(it) }
      )
    }

    // Incremental grouping - add new signatures to existing groups
    Function("groupIncremental") { newSigMaps: List<Map<String, Any>>, existingGroupMaps: List<Map<String, Any>>, existingSigMaps: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀 groupIncremental: ${newSigMaps.size} new + ${existingSigMaps.size} existing")

      val newSignatures = newSigMaps.mapNotNull { mapToSignature(it) }
      val existingSignatures = existingSigMaps.mapNotNull { mapToSignature(it) }
      val existingGroups = existingGroupMaps.map { m ->
        @Suppress("UNCHECKED_CAST")
        RouteGroup(
          groupId = m["groupId"] as String,
          activityIds = m["activityIds"] as List<String>
        )
      }

      val matchConfig = parseConfig(config)
      val startTime = System.currentTimeMillis()
      val result = ffiGroupIncremental(newSignatures, existingGroups, existingSignatures, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 groupIncremental returned ${result.size} groups in ${elapsed}ms")

      result.map { group ->
        mapOf(
          "groupId" to group.groupId,
          "activityIds" to group.activityIds
        )
      }
    }

    // Section detection
    Function("defaultSectionConfig") {
      val config = defaultSectionConfig()
      mapOf(
        "cell_size_meters" to config.cellSizeMeters.toInt(),
        "min_visits" to config.minVisits.toInt(),
        "min_cells" to config.minCells.toInt(),
        "diagonal_connect" to config.diagonalConnect
      )
    }

    Function("detectFrequentSections") { sigMaps: List<Map<String, Any>>, groupMaps: List<Map<String, Any>>, sportTypeMaps: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀 detectFrequentSections: ${sigMaps.size} signatures")

      val signatures = sigMaps.mapNotNull { mapToSignature(it) }
      val groups = groupMaps.map { m ->
        @Suppress("UNCHECKED_CAST")
        RouteGroup(
          groupId = m["groupId"] as String,
          activityIds = m["activityIds"] as List<String>
        )
      }
      val sportTypes = sportTypeMaps.map { m ->
        ActivitySportType(
          activityId = m["activity_id"] as String,
          sportType = m["sport_type"] as String
        )
      }

      val sectionConfig = if (config != null) {
        SectionConfig(
          cellSizeMeters = (config["cell_size_meters"] as? Number)?.toDouble() ?: 100.0,
          minVisits = (config["min_visits"] as? Number)?.toInt()?.toUInt() ?: 3u,
          minCells = (config["min_cells"] as? Number)?.toInt()?.toUInt() ?: 5u,
          diagonalConnect = (config["diagonal_connect"] as? Boolean) ?: true
        )
      } else {
        defaultSectionConfig()
      }

      val startTime = System.currentTimeMillis()
      val result = ffiDetectFrequentSections(signatures, groups, sportTypes, sectionConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 detectFrequentSections returned ${result.size} sections in ${elapsed}ms")

      result.map { section ->
        mapOf(
          "id" to section.id,
          "sport_type" to section.sportType,
          "cells" to section.cells.map { mapOf("row" to it.row.toInt(), "col" to it.col.toInt()) },
          "polyline" to section.polyline.map { mapOf("latitude" to it.latitude, "longitude" to it.longitude) },
          "activity_ids" to section.activityIds,
          "route_ids" to section.routeIds,
          "visit_count" to section.visitCount.toInt(),
          "distance_meters" to section.distanceMeters,
          "first_visit" to section.firstVisit.toLong(),
          "last_visit" to section.lastVisit.toLong()
        )
      }
    }

    // Heatmap generation
    Function("defaultHeatmapConfig") {
      val config = defaultHeatmapConfig()
      mapOf(
        "cell_size_meters" to config.cellSizeMeters.toInt(),
        "bounds" to config.bounds?.let { b ->
          mapOf("min_lat" to b.minLat, "max_lat" to b.maxLat, "min_lng" to b.minLng, "max_lng" to b.maxLng)
        }
      )
    }

    Function("generateHeatmap") { sigMaps: List<Map<String, Any>>, activityDataMaps: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "🦀 generateHeatmap: ${sigMaps.size} signatures")

      val signatures = sigMaps.mapNotNull { mapToSignature(it) }
      val activityData = activityDataMaps.map { m ->
        ActivityHeatmapData(
          activityId = m["activity_id"] as String,
          routeId = m["route_id"] as? String,
          routeName = m["route_name"] as? String,
          timestamp = (m["timestamp"] as? Number)?.toLong()
        )
      }

      @Suppress("UNCHECKED_CAST")
      val boundsMap = config?.get("bounds") as? Map<String, Double>
      val heatmapConfig = HeatmapConfig(
        cellSizeMeters = (config?.get("cell_size_meters") as? Number)?.toDouble() ?: 100.0,
        bounds = boundsMap?.let { b ->
          HeatmapBounds(
            minLat = b["min_lat"]!!,
            maxLat = b["max_lat"]!!,
            minLng = b["min_lng"]!!,
            maxLng = b["max_lng"]!!
          )
        }
      )

      val startTime = System.currentTimeMillis()
      val result = ffiGenerateHeatmap(signatures, activityData, heatmapConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "🦀 generateHeatmap returned ${result.cells.size} cells in ${elapsed}ms")

      mapOf(
        "cells" to result.cells.map { cell ->
          mapOf(
            "row" to cell.row.toInt(),
            "col" to cell.col.toInt(),
            "center_lat" to cell.centerLat,
            "center_lng" to cell.centerLng,
            "density" to cell.density,
            "visit_count" to cell.visitCount.toInt(),
            "route_refs" to cell.routeRefs.map { r ->
              mapOf("route_id" to r.routeId, "activity_count" to r.activityCount.toInt(), "name" to r.name)
            },
            "unique_route_count" to cell.uniqueRouteCount.toInt(),
            "activity_ids" to cell.activityIds,
            "first_visit" to cell.firstVisit?.toLong(),
            "last_visit" to cell.lastVisit?.toLong(),
            "is_common_path" to cell.isCommonPath
          )
        },
        "bounds" to mapOf(
          "min_lat" to result.bounds.minLat,
          "max_lat" to result.bounds.maxLat,
          "min_lng" to result.bounds.minLng,
          "max_lng" to result.bounds.maxLng
        ),
        "cell_size_meters" to result.cellSizeMeters.toInt(),
        "grid_rows" to result.gridRows.toInt(),
        "grid_cols" to result.gridCols.toInt(),
        "max_density" to result.maxDensity,
        "total_routes" to result.totalRoutes.toInt(),
        "total_activities" to result.totalActivities.toInt()
      )
    }

    Function("queryHeatmapCell") { heatmapMap: Map<String, Any>, lat: Double, lng: Double ->
      @Suppress("UNCHECKED_CAST")
      val cellMaps = heatmapMap["cells"] as List<Map<String, Any>>
      val boundsMap = heatmapMap["bounds"] as Map<String, Double>

      val cells = cellMaps.map { c ->
        @Suppress("UNCHECKED_CAST")
        val routeRefMaps = c["route_refs"] as List<Map<String, Any>>
        HeatmapCell(
          row = (c["row"] as Number).toInt(),
          col = (c["col"] as Number).toInt(),
          centerLat = c["center_lat"] as Double,
          centerLng = c["center_lng"] as Double,
          density = (c["density"] as Number).toFloat(),
          visitCount = (c["visit_count"] as Number).toInt().toUInt(),
          routeRefs = routeRefMaps.map { r ->
            RouteRef(
              routeId = r["route_id"] as String,
              activityCount = (r["activity_count"] as Number).toInt().toUInt(),
              name = r["name"] as? String
            )
          },
          uniqueRouteCount = (c["unique_route_count"] as Number).toInt().toUInt(),
          activityIds = c["activity_ids"] as List<String>,
          firstVisit = (c["first_visit"] as? Number)?.toLong(),
          lastVisit = (c["last_visit"] as? Number)?.toLong(),
          isCommonPath = c["is_common_path"] as Boolean
        )
      }

      val heatmap = HeatmapResult(
        cells = cells,
        bounds = HeatmapBounds(
          minLat = boundsMap["min_lat"]!!,
          maxLat = boundsMap["max_lat"]!!,
          minLng = boundsMap["min_lng"]!!,
          maxLng = boundsMap["max_lng"]!!
        ),
        cellSizeMeters = (heatmapMap["cell_size_meters"] as Number).toDouble(),
        gridRows = (heatmapMap["grid_rows"] as Number).toInt().toUInt(),
        gridCols = (heatmapMap["grid_cols"] as Number).toInt().toUInt(),
        maxDensity = (heatmapMap["max_density"] as Number).toFloat(),
        totalRoutes = (heatmapMap["total_routes"] as Number).toInt().toUInt(),
        totalActivities = (heatmapMap["total_activities"] as Number).toInt().toUInt()
      )

      val result = ffiQueryHeatmapCell(heatmap, lat, lng)
      result?.let { r ->
        mapOf(
          "cell" to mapOf(
            "row" to r.cell.row.toInt(),
            "col" to r.cell.col.toInt(),
            "center_lat" to r.cell.centerLat,
            "center_lng" to r.cell.centerLng,
            "density" to r.cell.density,
            "visit_count" to r.cell.visitCount.toInt(),
            "route_refs" to r.cell.routeRefs.map { ref ->
              mapOf("route_id" to ref.routeId, "activity_count" to ref.activityCount.toInt(), "name" to ref.name)
            },
            "unique_route_count" to r.cell.uniqueRouteCount.toInt(),
            "activity_ids" to r.cell.activityIds,
            "first_visit" to r.cell.firstVisit?.toLong(),
            "last_visit" to r.cell.lastVisit?.toLong(),
            "is_common_path" to r.cell.isCommonPath
          ),
          "suggested_label" to r.suggestedLabel
        )
      }
    }
  }

  private fun parseConfig(map: Map<String, Any>?): MatchConfig {
    if (map == null) return defaultConfig()

    val defaults = defaultConfig()

    return MatchConfig(
      perfectThreshold = (map["perfectThreshold"] as? Number)?.toDouble()
        ?: defaults.perfectThreshold,
      zeroThreshold = (map["zeroThreshold"] as? Number)?.toDouble()
        ?: defaults.zeroThreshold,
      minMatchPercentage = (map["minMatchPercentage"] as? Number)?.toDouble()
        ?: defaults.minMatchPercentage,
      minRouteDistance = (map["minRouteDistance"] as? Number)?.toDouble()
        ?: defaults.minRouteDistance,
      maxDistanceDiffRatio = (map["maxDistanceDiffRatio"] as? Number)?.toDouble()
        ?: defaults.maxDistanceDiffRatio,
      endpointThreshold = (map["endpointThreshold"] as? Number)?.toDouble()
        ?: defaults.endpointThreshold,
      resampleCount = (map["resampleCount"] as? Number)?.toInt()?.toUInt()
        ?: defaults.resampleCount,
      simplificationTolerance = (map["simplificationTolerance"] as? Number)?.toDouble()
        ?: defaults.simplificationTolerance,
      maxSimplifiedPoints = (map["maxSimplifiedPoints"] as? Number)?.toInt()?.toUInt()
        ?: defaults.maxSimplifiedPoints
    )
  }

  private fun signatureToMap(sig: RouteSignature): Map<String, Any> {
    return mapOf(
      "activityId" to sig.activityId,
      "points" to sig.points.map { mapOf("latitude" to it.latitude, "longitude" to it.longitude) },
      "totalDistance" to sig.totalDistance,
      "startPoint" to mapOf("latitude" to sig.startPoint.latitude, "longitude" to sig.startPoint.longitude),
      "endPoint" to mapOf("latitude" to sig.endPoint.latitude, "longitude" to sig.endPoint.longitude),
      "bounds" to mapOf(
        "minLat" to sig.bounds.minLat,
        "maxLat" to sig.bounds.maxLat,
        "minLng" to sig.bounds.minLng,
        "maxLng" to sig.bounds.maxLng
      ),
      "center" to mapOf("latitude" to sig.center.latitude, "longitude" to sig.center.longitude)
    )
  }

  @Suppress("UNCHECKED_CAST")
  private fun mapToSignature(map: Map<String, Any>): RouteSignature? {
    val activityId = map["activityId"] as? String ?: return null
    val pointMaps = map["points"] as? List<Map<String, Double>> ?: return null
    val totalDistance = (map["totalDistance"] as? Number)?.toDouble() ?: return null
    val startMap = map["startPoint"] as? Map<String, Double> ?: return null
    val endMap = map["endPoint"] as? Map<String, Double> ?: return null
    val boundsMap = map["bounds"] as? Map<String, Double> ?: return null
    val centerMap = map["center"] as? Map<String, Double> ?: return null

    val points = pointMaps.mapNotNull { dict ->
      val lat = dict["latitude"] ?: return@mapNotNull null
      val lng = dict["longitude"] ?: return@mapNotNull null
      GpsPoint(lat, lng)
    }

    val startPoint = GpsPoint(
      startMap["latitude"] ?: return null,
      startMap["longitude"] ?: return null
    )

    val endPoint = GpsPoint(
      endMap["latitude"] ?: return null,
      endMap["longitude"] ?: return null
    )

    val bounds = Bounds(
      minLat = boundsMap["minLat"] ?: return null,
      maxLat = boundsMap["maxLat"] ?: return null,
      minLng = boundsMap["minLng"] ?: return null,
      maxLng = boundsMap["maxLng"] ?: return null
    )

    val center = GpsPoint(
      centerMap["latitude"] ?: return null,
      centerMap["longitude"] ?: return null
    )

    return RouteSignature(
      activityId = activityId,
      points = points,
      totalDistance = totalDistance,
      startPoint = startPoint,
      endPoint = endPoint,
      bounds = bounds,
      center = center
    )
  }
}
