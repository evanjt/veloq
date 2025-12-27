package expo.modules.routematcher

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import uniffi.route_matcher.*

/**
 * Route Matcher native module powered by Rust.
 *
 * Uses the compiled Rust library via UniFFI for high-performance
 * GPS route matching with Average Minimum Distance (AMD) and parallel processing.
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
      Log.i(TAG, "createSignature called for $activityId with ${points.size} points")

      val gpsPoints = points.mapNotNull { dict ->
        val lat = dict["latitude"] ?: return@mapNotNull null
        val lng = dict["longitude"] ?: return@mapNotNull null
        GpsPoint(lat, lng)
      }

      val matchConfig = parseConfig(config)

      val signature = createSignatureWithConfig(activityId, gpsPoints, matchConfig)

      if (signature != null) {
        Log.i(TAG, "Created signature: ${signature.points.size} points, ${signature.totalDistance.toInt()}m")
        signatureToMap(signature)
      } else {
        Log.w(TAG, "Failed to create signature for $activityId")
        null
      }
    }

    // Compare two routes
    Function("compareRoutes") { sig1Map: Map<String, Any>, sig2Map: Map<String, Any>, config: Map<String, Any>? ->
      val sig1 = mapToSignature(sig1Map) ?: return@Function null
      val sig2 = mapToSignature(sig2Map) ?: return@Function null
      val matchConfig = parseConfig(config)

      Log.d(TAG, "Comparing ${sig1.activityId} vs ${sig2.activityId}")

      val result = ffiCompareRoutes(sig1, sig2, matchConfig)

      if (result != null) {
        Log.i(TAG, "Match found: ${result.matchPercentage.toInt()}% (${result.direction})")
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
      Log.i(TAG, "RUST groupSignatures called with ${signatureMaps.size} signatures")

      val signatures = signatureMaps.mapNotNull { mapToSignature(it) }
      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val groups = ffiGroupSignatures(signatures, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "Grouped into ${groups.size} groups in ${elapsed}ms")

      groups.map { group ->
        mapOf(
          "groupId" to group.groupId,
          "activityIds" to group.activityIds
        )
      }
    }

    // Get default configuration
    Function("getDefaultConfig") {
      Log.i(TAG, "getDefaultConfig called - Rust is active!")
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
      Log.i(TAG, "BATCH createSignatures called with ${tracks.size} tracks")

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

      Log.i(TAG, "BATCH created ${signatures.size} signatures in ${elapsed}ms")

      signatures.map { signatureToMap(it) }
    }

    // BATCH: Full end-to-end processing (signatures + grouping) in one call
    Function("processRoutesBatch") { tracks: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "FULL BATCH processRoutes called with ${tracks.size} tracks")

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

      Log.i(TAG, "FULL BATCH: ${gpsTracks.size} tracks -> ${groups.size} groups in ${elapsed}ms")

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
      Log.i(TAG, "FLAT processRoutes called with ${activityIds.size} tracks")

      if (activityIds.size != coordArrays.size) {
        Log.e(TAG, "ERROR: activityIds.size (${activityIds.size}) != coordArrays.size (${coordArrays.size})")
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

      Log.i(TAG, "FLAT BATCH: ${flatTracks.size} tracks -> ${groups.size} groups in ${elapsed}ms")

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
      Log.i(TAG, "FLAT BUFFER createSignatures: ${activityIds.size} tracks, ${coords.size} coords")

      if (activityIds.size != offsets.size) {
        Log.e(TAG, "ERROR: activityIds.size (${activityIds.size}) != offsets.size (${offsets.size})")
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

      Log.i(TAG, "FLAT BUFFER: ${flatTracks.size} tracks -> ${signatures.size} signatures in ${elapsed}ms")

      signatures.map { signatureToMap(it) }
    }

    // OPTIMIZED V2: Single flat buffer with offsets (most efficient)
    // coords: flat DoubleArray [lat1, lng1, lat2, lng2, ...]
    // offsets: IntArray marking where each track starts in the coords array
    // activityIds: List<String> of activity IDs in same order as offsets
    Function("processRoutesFlatBuffer") { activityIds: List<String>, coords: DoubleArray, offsets: IntArray, config: Map<String, Any>? ->
      Log.i(TAG, "FLAT BUFFER processRoutes: ${activityIds.size} tracks, ${coords.size} coords")

      if (activityIds.size != offsets.size) {
        Log.e(TAG, "ERROR: activityIds.size (${activityIds.size}) != offsets.size (${offsets.size})")
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

      Log.i(TAG, "FLAT BUFFER: ${flatTracks.size} tracks -> ${groups.size} groups in ${elapsed}ms")

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
      Log.i(TAG, "HTTP fetchActivityMaps [v6-sustained] called for ${activityIds.size} activities")

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

      Log.i(TAG, "[TIMING] Rust fetch+parse: ${rustElapsed}ms (${String.format("%.1f", rate)} req/s)")
      Log.i(TAG, "[DATA] $successCount success ($errorCount errors), $totalPoints points, ${totalBytes / 1024}KB")

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
      Log.i(TAG, "[TIMING] Kotlin->Map: ${convertElapsed}ms | Total: ${totalElapsed}ms")

      converted
    }

    // HTTP: Fetch activity map data WITH real-time progress events
    // Emits "onFetchProgress" event after each activity is fetched
    // Uses AsyncFunction so JS isn't blocked and can receive events
    AsyncFunction("fetchActivityMapsWithProgress") { apiKey: String, activityIds: List<String> ->
      Log.i(TAG, "HTTP fetchActivityMapsWithProgress called for ${activityIds.size} activities")

      val totalStart = System.currentTimeMillis()
      val module = this@RouteMatcherModule

      // Create a callback that sends progress events to JS
      val progressCallback = object : FetchProgressCallback {
        override fun onProgress(completed: UInt, total: UInt) {
          Log.d(TAG, "Progress: $completed/$total")
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

      Log.i(TAG, "[TIMING] Rust fetch+progress: ${rustElapsed}ms (${String.format("%.1f", rate)} req/s)")
      Log.i(TAG, "[DATA] $successCount success ($errorCount errors)")

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
      Log.i(TAG, "[TIMING] Total: ${totalElapsed}ms")

      converted
    }

    // HTTP: Fetch and process activities in one call (fetch maps + create signatures)
    Function("fetchAndProcessActivities") { apiKey: String, activityIds: List<String>, config: Map<String, Any>? ->
      Log.i(TAG, "HTTP fetchAndProcessActivities called for ${activityIds.size} activities")

      val matchConfig = parseConfig(config)

      val startTime = System.currentTimeMillis()
      val result = fetchAndProcessActivities(apiKey, activityIds, matchConfig)
      val elapsed = System.currentTimeMillis() - startTime

      val successCount = result.mapResults.count { it.success }
      Log.i(TAG, "HTTP+Process: $successCount/${activityIds.size} fetched, ${result.signatures.size} signatures in ${elapsed}ms")

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
      Log.i(TAG, "groupIncremental: ${newSigMaps.size} new + ${existingSigMaps.size} existing")

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

      Log.i(TAG, "groupIncremental returned ${result.size} groups in ${elapsed}ms")

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
        "proximity_threshold" to config.proximityThreshold,
        "min_section_length" to config.minSectionLength,
        "min_activities" to config.minActivities.toInt(),
        "cluster_tolerance" to config.clusterTolerance,
        "sample_points" to config.samplePoints.toInt()
      )
    }

    Function("detectFrequentSections") { sigMaps: List<Map<String, Any>>, groupMaps: List<Map<String, Any>>, sportTypeMaps: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "detectFrequentSections: ${sigMaps.size} signatures")

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

      val sectionConfig = parseSectionConfig(config)

      val startTime = System.currentTimeMillis()
      val result = ffiDetectFrequentSections(signatures, groups, sportTypes, sectionConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "detectFrequentSections returned ${result.size} sections in ${elapsed}ms")

      result.map { sectionToMap(it) }
    }

    // Section detection from FULL GPS tracks (medoid-based)
    // Returns JSON string for efficient bridge serialization (avoids slow Map conversion)
    Function("detectSectionsFromTracks") { activityIds: List<String>, allCoords: DoubleArray, offsets: IntArray, sportTypeMaps: List<Map<String, Any>>, groupMaps: List<Map<String, Any>>, config: Map<String, Any>? ->
      Log.i(TAG, "detectSectionsFromTracks: ${activityIds.size} activities, ${allCoords.size / 2} coords")

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

      val sectionConfig = parseSectionConfig(config)
      val offsetsU32 = offsets.map { it.toUInt() }

      val startTime = System.currentTimeMillis()
      val result = ffiDetectSectionsFromTracks(
        activityIds,
        allCoords.toList(),
        offsetsU32,
        sportTypes,
        groups,
        sectionConfig
      )
      val rustElapsed = System.currentTimeMillis() - startTime
      Log.i(TAG, "detectSectionsFromTracks Rust: ${result.size} sections in ${rustElapsed}ms")

      // Serialize to JSON for efficient bridge transfer
      val jsonStart = System.currentTimeMillis()
      val jsonResult = sectionsToJson(result)
      val jsonElapsed = System.currentTimeMillis() - jsonStart
      Log.i(TAG, "detectSectionsFromTracks JSON: ${jsonElapsed}ms, ${jsonResult.length} chars")

      jsonResult
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

    Function("generateHeatmap") { signaturesJson: String, activityDataJson: String, configJson: String ->
      // Parse all parameters from JSON strings (avoids Expo Modules bridge serialization issues with nulls)
      val sigArray = JSONArray(signaturesJson)
      Log.i(TAG, "generateHeatmap: ${sigArray.length()} signatures")

      val signatures = (0 until sigArray.length()).mapNotNull { i ->
        jsonToSignature(sigArray.getJSONObject(i))
      }

      val activityDataArray = JSONArray(activityDataJson)
      val activityData = (0 until activityDataArray.length()).map { i ->
        val obj = activityDataArray.getJSONObject(i)
        ActivityHeatmapData(
          activityId = obj.getString("activity_id"),
          routeId = if (obj.isNull("route_id")) null else obj.getString("route_id"),
          routeName = if (obj.isNull("route_name")) null else obj.getString("route_name"),
          timestamp = if (obj.isNull("timestamp")) null else obj.getLong("timestamp")
        )
      }

      val configObj = JSONObject(configJson)
      val heatmapConfig = HeatmapConfig(
        cellSizeMeters = if (configObj.has("cell_size_meters")) configObj.getDouble("cell_size_meters") else 100.0,
        bounds = if (configObj.isNull("bounds")) null else {
          val boundsObj = configObj.getJSONObject("bounds")
          HeatmapBounds(
            minLat = boundsObj.getDouble("min_lat"),
            maxLat = boundsObj.getDouble("max_lat"),
            minLng = boundsObj.getDouble("min_lng"),
            maxLng = boundsObj.getDouble("max_lng")
          )
        }
      )

      val startTime = System.currentTimeMillis()
      val result = ffiGenerateHeatmap(signatures, activityData, heatmapConfig)
      val elapsed = System.currentTimeMillis() - startTime

      Log.i(TAG, "generateHeatmap returned ${result.cells.size} cells in ${elapsed}ms")

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

    Function("queryHeatmapCell") { heatmapJson: String, lat: Double, lng: Double ->
      // Parse heatmap from JSON string to avoid Expo Modules bridge issues with nulls
      val heatmapObj = JSONObject(heatmapJson)
      val cellsArray = heatmapObj.getJSONArray("cells")
      val boundsObj = heatmapObj.getJSONObject("bounds")

      val cells = (0 until cellsArray.length()).map { i ->
        val c = cellsArray.getJSONObject(i)
        val routeRefsArray = c.getJSONArray("route_refs")
        HeatmapCell(
          row = c.getInt("row"),
          col = c.getInt("col"),
          centerLat = c.getDouble("center_lat"),
          centerLng = c.getDouble("center_lng"),
          density = c.getDouble("density").toFloat(),
          visitCount = c.getInt("visit_count").toUInt(),
          routeRefs = (0 until routeRefsArray.length()).map { j ->
            val r = routeRefsArray.getJSONObject(j)
            RouteRef(
              routeId = r.getString("route_id"),
              activityCount = r.getInt("activity_count").toUInt(),
              name = if (r.isNull("name")) null else r.getString("name")
            )
          },
          uniqueRouteCount = c.getInt("unique_route_count").toUInt(),
          activityIds = (0 until c.getJSONArray("activity_ids").length()).map { j ->
            c.getJSONArray("activity_ids").getString(j)
          },
          firstVisit = if (c.isNull("first_visit")) null else c.getLong("first_visit"),
          lastVisit = if (c.isNull("last_visit")) null else c.getLong("last_visit"),
          isCommonPath = c.getBoolean("is_common_path")
        )
      }

      val heatmap = HeatmapResult(
        cells = cells,
        bounds = HeatmapBounds(
          minLat = boundsObj.getDouble("min_lat"),
          maxLat = boundsObj.getDouble("max_lat"),
          minLng = boundsObj.getDouble("min_lng"),
          maxLng = boundsObj.getDouble("max_lng")
        ),
        cellSizeMeters = heatmapObj.getDouble("cell_size_meters"),
        gridRows = heatmapObj.getInt("grid_rows").toUInt(),
        gridCols = heatmapObj.getInt("grid_cols").toUInt(),
        maxDensity = heatmapObj.getDouble("max_density").toFloat(),
        totalRoutes = heatmapObj.getInt("total_routes").toUInt(),
        totalActivities = heatmapObj.getInt("total_activities").toUInt()
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

  private fun parseSectionConfig(map: Map<String, Any>?): SectionConfig {
    if (map == null) return defaultSectionConfig()

    val defaults = defaultSectionConfig()

    return SectionConfig(
      proximityThreshold = (map["proximity_threshold"] as? Number)?.toDouble()
        ?: defaults.proximityThreshold,
      minSectionLength = (map["min_section_length"] as? Number)?.toDouble()
        ?: defaults.minSectionLength,
      maxSectionLength = (map["max_section_length"] as? Number)?.toDouble()
        ?: defaults.maxSectionLength,
      minActivities = (map["min_activities"] as? Number)?.toInt()?.toUInt()
        ?: defaults.minActivities,
      clusterTolerance = (map["cluster_tolerance"] as? Number)?.toDouble()
        ?: defaults.clusterTolerance,
      samplePoints = (map["sample_points"] as? Number)?.toInt()?.toUInt()
        ?: defaults.samplePoints
    )
  }

  private fun sectionToMap(section: FrequentSection): Map<String, Any> {
    return mapOf(
      "id" to section.id,
      "sport_type" to section.sportType,
      "polyline" to section.polyline.map { mapOf("latitude" to it.latitude, "longitude" to it.longitude) },
      "representative_activity_id" to section.representativeActivityId,
      "activity_ids" to section.activityIds,
      "activity_portions" to section.activityPortions.map { portion ->
        mapOf(
          "activity_id" to portion.activityId,
          "start_index" to portion.startIndex.toInt(),
          "end_index" to portion.endIndex.toInt(),
          "distance_meters" to portion.distanceMeters,
          "direction" to portion.direction
        )
      },
      "route_ids" to section.routeIds,
      "visit_count" to section.visitCount.toInt(),
      "distance_meters" to section.distanceMeters,
      // Pre-computed activity traces: map of activityId -> GPS points overlapping with section
      "activity_traces" to section.activityTraces.mapValues { (_, points) ->
        points.map { mapOf("latitude" to it.latitude, "longitude" to it.longitude) }
      },
      // Consensus polyline metrics
      "confidence" to section.confidence,
      "observation_count" to section.observationCount.toInt(),
      "average_spread" to section.averageSpread,
      "point_density" to section.pointDensity.map { it.toInt() }
    )
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

  /**
   * Serialize FrequentSection list to JSON string.
   * Much faster than Map conversion for complex nested structures.
   */
  private fun sectionsToJson(sections: List<FrequentSection>): String {
    val jsonArray = JSONArray()
    for (section in sections) {
      val sectionJson = JSONObject()
      sectionJson.put("id", section.id)
      sectionJson.put("sport_type", section.sportType)
      sectionJson.put("representative_activity_id", section.representativeActivityId)
      sectionJson.put("visit_count", section.visitCount.toInt())
      sectionJson.put("distance_meters", section.distanceMeters)

      // Polyline as array of {latitude, longitude}
      val polylineArray = JSONArray()
      for (point in section.polyline) {
        val pointJson = JSONObject()
        pointJson.put("latitude", point.latitude)
        pointJson.put("longitude", point.longitude)
        polylineArray.put(pointJson)
      }
      sectionJson.put("polyline", polylineArray)

      // Activity IDs as simple array
      val activityIdsArray = JSONArray()
      for (id in section.activityIds) {
        activityIdsArray.put(id)
      }
      sectionJson.put("activity_ids", activityIdsArray)

      // Activity portions
      val portionsArray = JSONArray()
      for (portion in section.activityPortions) {
        val portionJson = JSONObject()
        portionJson.put("activity_id", portion.activityId)
        portionJson.put("start_index", portion.startIndex.toInt())
        portionJson.put("end_index", portion.endIndex.toInt())
        portionJson.put("distance_meters", portion.distanceMeters)
        portionJson.put("direction", portion.direction)
        portionsArray.put(portionJson)
      }
      sectionJson.put("activity_portions", portionsArray)

      // Route IDs
      val routeIdsArray = JSONArray()
      for (id in section.routeIds) {
        routeIdsArray.put(id)
      }
      sectionJson.put("route_ids", routeIdsArray)

      // Activity traces - map of activityId -> GPS points
      val tracesJson = JSONObject()
      for ((activityId, points) in section.activityTraces) {
        val pointsArray = JSONArray()
        for (point in points) {
          val pointJson = JSONObject()
          pointJson.put("latitude", point.latitude)
          pointJson.put("longitude", point.longitude)
          pointsArray.put(pointJson)
        }
        tracesJson.put(activityId, pointsArray)
      }
      sectionJson.put("activity_traces", tracesJson)

      jsonArray.put(sectionJson)
    }
    return jsonArray.toString()
  }

  /**
   * Parse a RouteSignature from a JSONObject.
   * Used for generateHeatmap which receives signatures as JSON string
   * to avoid Expo Modules bridge serialization issues.
   */
  private fun jsonToSignature(json: JSONObject): RouteSignature? {
    try {
      val activityId = json.getString("activityId")
      val totalDistance = json.getDouble("totalDistance")

      val pointsArray = json.getJSONArray("points")
      val points = (0 until pointsArray.length()).mapNotNull { i ->
        val pt = pointsArray.getJSONObject(i)
        GpsPoint(pt.getDouble("latitude"), pt.getDouble("longitude"))
      }

      val startJson = json.getJSONObject("startPoint")
      val startPoint = GpsPoint(
        startJson.getDouble("latitude"),
        startJson.getDouble("longitude")
      )

      val endJson = json.getJSONObject("endPoint")
      val endPoint = GpsPoint(
        endJson.getDouble("latitude"),
        endJson.getDouble("longitude")
      )

      val boundsJson = json.getJSONObject("bounds")
      val bounds = Bounds(
        minLat = boundsJson.getDouble("minLat"),
        maxLat = boundsJson.getDouble("maxLat"),
        minLng = boundsJson.getDouble("minLng"),
        maxLng = boundsJson.getDouble("maxLng")
      )

      val centerJson = json.getJSONObject("center")
      val center = GpsPoint(
        centerJson.getDouble("latitude"),
        centerJson.getDouble("longitude")
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
    } catch (e: Exception) {
      Log.w(TAG, "Failed to parse signature from JSON: ${e.message}")
      return null
    }
  }
}
