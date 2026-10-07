package com.veloq

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Scenario: a map page asks the interceptor for a sprite or glyph file, and the
 * path is the page's to choose.
 *
 * Expected behaviour: a file under the sprite and font directories resolves to
 * its asset path, a path outside them or one that tries to leave the asset root
 * resolves to nothing, so the interceptor answers 404 at once.
 */
class BasemapAssetPathTest {
  @Test
  fun a_sprite_file_resolves_under_the_asset_root() {
    assertEquals(
      "basemap/sprites/ofm_f384/ofm@2x.png",
      BasemapAssetPath.resolve("sprites/ofm_f384/ofm@2x.png")
    )
  }

  @Test
  fun a_glyph_range_decodes_the_font_stack_the_page_encoded() {
    assertEquals(
      "basemap/fonts/Noto Sans Regular/0-255.pbf",
      BasemapAssetPath.resolve("fonts/Noto%20Sans%20Regular/0-255.pbf")
    )
  }

  @Test
  fun a_query_string_is_not_part_of_the_path() {
    assertEquals(
      "basemap/sprites/ofm_f384/ofm.json",
      BasemapAssetPath.resolve("sprites/ofm_f384/ofm.json?x=1")
    )
  }

  @Test
  fun a_path_that_leaves_the_asset_root_resolves_to_nothing() {
    assertNull(BasemapAssetPath.resolve("fonts/../../secret.pbf"))
    assertNull(BasemapAssetPath.resolve("fonts/%2e%2e/%2e%2e/secret.pbf"))
    assertNull(BasemapAssetPath.resolve("fonts/..%2fsecret.pbf"))
    assertNull(BasemapAssetPath.resolve("fonts\\..\\secret.pbf"))
    assertNull(BasemapAssetPath.resolve("../fonts/Noto Sans Regular/0-255.pbf"))
    assertNull(BasemapAssetPath.resolve("fonts//0-255.pbf"))
    assertNull(BasemapAssetPath.resolve("fonts/./0-255.pbf"))
  }

  @Test
  fun a_directory_other_than_the_two_the_app_ships_resolves_to_nothing() {
    assertNull(BasemapAssetPath.resolve("planet/2/1/1.pbf"))
    assertNull(BasemapAssetPath.resolve("fonts"))
    assertNull(BasemapAssetPath.resolve(""))
    assertNull(BasemapAssetPath.resolve(null))
  }

  @Test
  fun the_content_type_follows_the_extension() {
    assertEquals("application/json", BasemapAssetPath.mimeFor("basemap/sprites/a/ofm.json"))
    assertEquals("image/png", BasemapAssetPath.mimeFor("basemap/sprites/a/ofm.png"))
    assertEquals("application/x-protobuf", BasemapAssetPath.mimeFor("basemap/fonts/a/0-255.pbf"))
  }

  @Test
  fun a_glyph_range_path_names_its_stack_and_range() {
    val request = BasemapAssetPath.glyphRequest("basemap/fonts/Noto Sans Bold/19968-20223.pbf")
    assertEquals(listOf("Noto Sans Bold", "19968-20223"), request?.toList())
  }

  @Test
  fun a_path_that_is_not_a_glyph_range_names_no_request() {
    assertNull(BasemapAssetPath.glyphRequest("basemap/sprites/ofm_f384/ofm.png"))
    assertNull(BasemapAssetPath.glyphRequest("basemap/fonts/Noto Sans Bold/index.json"))
    assertNull(BasemapAssetPath.glyphRequest("basemap/fonts/0-255.pbf"))
    assertNull(BasemapAssetPath.glyphRequest(null))
  }
}
