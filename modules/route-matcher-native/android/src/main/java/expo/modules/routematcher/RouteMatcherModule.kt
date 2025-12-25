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
    // Uses Rust HTTP client with rate limiting (30 req/s burst, 131 req/10s sustained)
    Function("fetchActivityMaps") { apiKey: String, activityIds: List<String> ->
      Log.i(TAG, "🦀🦀🦀 HTTP fetchActivityMaps called for ${activityIds.size} activities 🦀🦀🦀")

      val startTime = System.currentTimeMillis()
      val results = fetchActivityMaps(apiKey, activityIds)
      val elapsed = System.currentTimeMillis() - startTime

      val successCount = results.count { it.success }
      Log.i(TAG, "🦀 HTTP: Fetched $successCount/${activityIds.size} activities in ${elapsed}ms")

      results.map { result ->
        mapOf(
          "activityId" to result.activityId,
          "bounds" to result.bounds,
          "latlngs" to result.latlngs,
          "success" to result.success,
          "error" to result.error
        )
      }
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
      "endPoint" to mapOf("latitude" to sig.endPoint.latitude, "longitude" to sig.endPoint.longitude)
    )
  }

  @Suppress("UNCHECKED_CAST")
  private fun mapToSignature(map: Map<String, Any>): RouteSignature? {
    val activityId = map["activityId"] as? String ?: return null
    val pointMaps = map["points"] as? List<Map<String, Double>> ?: return null
    val totalDistance = (map["totalDistance"] as? Number)?.toDouble() ?: return null
    val startMap = map["startPoint"] as? Map<String, Double> ?: return null
    val endMap = map["endPoint"] as? Map<String, Double> ?: return null

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

    return RouteSignature(
      activityId = activityId,
      points = points,
      totalDistance = totalDistance,
      startPoint = startPoint,
      endPoint = endPoint
    )
  }
}
