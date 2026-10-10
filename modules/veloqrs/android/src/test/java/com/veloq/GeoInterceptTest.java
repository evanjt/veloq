package com.veloq;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

/**
 * Scenario: the map page asks for one activity's line at a `/veloq-geo/` URL
 * on its own origin, beside the tile and asset requests it already makes.
 *
 * Expected behaviour: a geo URL reaches the engine's geo entry with its path
 * whole, query string and all, and is never parsed as a tile, which would
 * refuse it as a 400. Tile and asset URLs keep their own routes.
 */
public class GeoInterceptTest {

  private static final byte[] LINE = "{\"type\":\"Feature\"}".getBytes(StandardCharsets.UTF_8);

  /** The engine's side, answering one line and refusing everything else. */
  private static final class FakeGeo implements GeoIntercept.Geo {
    final List<String> asked = new ArrayList<>();
    private final int refusal;

    FakeGeo(int refusal) {
      this.refusal = refusal;
    }

    @Override
    public byte[] answer(String path, int[] status) {
      asked.add(path);
      if (path.startsWith("track/abc")) {
        status[0] = 200;
        return LINE;
      }
      status[0] = refusal;
      return null;
    }
  }

  private static byte[] read(InputStream body) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[256];
    int n;
    while ((n = body.read(buffer)) >= 0) out.write(buffer, 0, n);
    return out.toByteArray();
  }

  @Test
  public void a_geo_url_reaches_the_geo_entry_and_not_the_tile_parser() throws IOException {
    FakeGeo geo = new FakeGeo(404);
    MapRequestPath route = MapRequestPath.of("https://veloq.fit/veloq-geo/track/abc?v=3");

    assertEquals(MapRequestPath.Kind.GEO, route.kind);
    TileIntercept.Answer answer = new GeoIntercept(geo).answer(route.rest);

    assertEquals(Collections.singletonList("track/abc?v=3"), geo.asked);
    assertEquals(200, answer.status);
    assertEquals("application/geo+json", answer.mime);
    assertArrayEquals(LINE, read(answer.body));
  }

  @Test
  public void a_geo_url_on_the_ios_origin_routes_the_same_way() {
    MapRequestPath route = MapRequestPath.of("veloq-tile://map/veloq-geo/track/abc?v=0");

    assertEquals(MapRequestPath.Kind.GEO, route.kind);
    assertEquals("track/abc?v=0", route.rest);
  }

  @Test
  public void tile_and_asset_urls_keep_their_own_routes() {
    MapRequestPath tile =
        MapRequestPath.of("https://veloq.fit/veloq-tile/openmaptiles/14/8000/5000.pbf");
    assertEquals(MapRequestPath.Kind.TILE, tile.kind);
    assertEquals("openmaptiles/14/8000/5000.pbf", tile.rest);

    MapRequestPath heatmap = MapRequestPath.of("https://veloq.fit/veloq-tile/heatmap/12/1/2.png?v=4");
    assertEquals(MapRequestPath.Kind.TILE, heatmap.kind);
    assertEquals("heatmap/12/1/2.png?v=4", heatmap.rest);

    MapRequestPath asset =
        MapRequestPath.of("https://veloq.fit/veloq-asset/fonts/Noto%20Sans/0-255.pbf");
    assertEquals(MapRequestPath.Kind.ASSET, asset.kind);
    assertEquals("fonts/Noto%20Sans/0-255.pbf", asset.rest);
  }

  @Test
  public void a_url_with_no_marker_is_left_to_the_library() {
    assertNull(MapRequestPath.of("https://veloq.fit/index.html"));
    assertNull(MapRequestPath.of("https://example.test/veloq-geography/track/abc"));
  }

  @Test
  public void a_refusal_crosses_with_its_status_and_no_body() throws IOException {
    TileIntercept.Answer notFound = new GeoIntercept(new FakeGeo(404)).answer("track/unknown");
    assertEquals(404, notFound.status);
    assertEquals(0, read(notFound.body).length);

    TileIntercept.Answer badPath = new GeoIntercept(new FakeGeo(400)).answer("track/../x");
    assertEquals(400, badPath.status);
  }

  @Test
  public void a_native_call_that_reports_nothing_reads_as_a_failure() {
    TileIntercept.Answer silent = new GeoIntercept((path, status) -> null).answer("track/abc");

    assertEquals(502, silent.status);
  }
}
