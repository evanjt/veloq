//! One async fetcher per intervals.icu endpoint: build request → transport →
//! serde parse → convert. Added per slice as endpoints migrate off axios.
