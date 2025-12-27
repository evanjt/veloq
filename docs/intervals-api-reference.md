# Intervals.icu API Reference

This document contains key API endpoint documentation for the Velox app.

## Authentication

- Use API key with Basic Auth: `API_KEY:api_key_value`
- Get API key from intervals.icu Settings > Developer Settings

## Base URL

```
https://intervals.icu/api/v1
```

---

## Power Curves

### GET `/athlete/{id}/power-curves.json`

List best power curves for the athlete.

#### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | path, string | Athlete identifier |
| `type` | query, string | Activity sport type (Ride, Run, Swim, etc.) |
| `f1` | query, string | Activity filter in format: `oldest=YYYY-MM-DD,newest=YYYY-MM-DD` |

#### Optional Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `newest` | query, string | Date limit for newest data |
| `curves` | query, string | Comma-separated curve specifications (default: last year) |
| `includeRanks` | query, boolean | Whether to include ranking data |
| `subMaxEfforts` | query, integer | Number of sub-maximum efforts to return |
| `now` | query, string | Current local date reference |
| `pmType` | query, string | Power modeling type: MS_2P, MORTON_3P, FFT_CURVES, ECP |
| `f2` | query, string | Second filter set for comparison |
| `f3` | query, string | Third filter set for comparison |

#### Example Request

```bash
curl "https://intervals.icu/api/v1/athlete/{id}/power-curves.json?type=Ride&f1=oldest=2024-01-01,newest=2024-12-21" \
  -u "API_KEY:your_api_key"
```

#### Response

```json
{
  "secs": [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, ...],
  "watts": [1200, 1150, 1100, 1050, 950, 850, 800, 750, 700, 650, ...]
}
```

---

## Activity Power Curve

### GET `/activity/{id}/power-curve.json`

Get power curve for a specific activity.

---

## Best Efforts

### GET `/activity/{id}/best-efforts`

Find best efforts in an activity.

---

## MMP Model

### GET `/athlete/{id}/mmp-model`

Get the power model used to resolve %MMP steps in workouts.

---

## Activities

### GET `/athlete/{id}/activities`

List activities for the athlete.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `oldest` | query, string | Start date (YYYY-MM-DD) |
| `newest` | query, string | End date (YYYY-MM-DD) |

---

## Activity Streams

### GET `/activity/{id}/streams.json`

Get activity data streams (GPS, HR, power, etc.)

Note: Requires `.json` suffix.

---

## Wellness

### GET `/athlete/{id}/wellness`

Get wellness data (HRV, RHR, sleep, weight, CTL, ATL).

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `oldest` | query, string | Start date (YYYY-MM-DD) |
| `newest` | query, string | End date (YYYY-MM-DD) |

---

## Full Documentation

- Swagger UI: https://intervals.icu/api/v1/docs/swagger-ui/index.html
- API Guide: https://forum.intervals.icu/t/api-access-to-intervals-icu/609
