//! Unified error handling for the route-matcher library.
//!
//! This module provides a consistent error type for all route-matcher operations,
//! replacing mixed error handling patterns (Option, panic, silent failures).

use std::fmt;

/// Unified error type for route-matcher operations.
#[derive(Debug, Clone)]
pub enum RouteMatchError {
    /// Route has insufficient points for processing
    InsufficientPoints {
        activity_id: String,
        point_count: usize,
        minimum_required: usize,
    },
    /// Route has invalid GPS coordinates
    InvalidCoordinates {
        activity_id: String,
        message: String,
    },
    /// Route is too short for the operation
    RouteTooShort {
        activity_id: String,
        distance: f64,
        minimum_required: f64,
    },
    /// Section detection failed
    SectionDetectionFailed { message: String },
    /// Overlap detection failed
    OverlapDetectionFailed { message: String },
    /// Persistence/storage error
    PersistenceError { message: String },
    /// HTTP/API error
    HttpError {
        message: String,
        status_code: Option<u16>,
    },
    /// Configuration error
    ConfigError { message: String },
    /// R-tree/spatial index error
    SpatialIndexError { message: String },
    /// Generic internal error
    Internal { message: String },
}

impl fmt::Display for RouteMatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RouteMatchError::InsufficientPoints {
                activity_id,
                point_count,
                minimum_required,
            } => {
                write!(
                    f,
                    "Route '{}' has {} points, minimum {} required",
                    activity_id, point_count, minimum_required
                )
            }
            RouteMatchError::InvalidCoordinates {
                activity_id,
                message,
            } => {
                write!(
                    f,
                    "Route '{}' has invalid coordinates: {}",
                    activity_id, message
                )
            }
            RouteMatchError::RouteTooShort {
                activity_id,
                distance,
                minimum_required,
            } => {
                write!(
                    f,
                    "Route '{}' is {:.0}m, minimum {:.0}m required",
                    activity_id, distance, minimum_required
                )
            }
            RouteMatchError::SectionDetectionFailed { message } => {
                write!(f, "Section detection failed: {}", message)
            }
            RouteMatchError::OverlapDetectionFailed { message } => {
                write!(f, "Overlap detection failed: {}", message)
            }
            RouteMatchError::PersistenceError { message } => {
                write!(f, "Persistence error: {}", message)
            }
            RouteMatchError::HttpError {
                message,
                status_code,
            } => {
                if let Some(code) = status_code {
                    write!(f, "HTTP error ({}): {}", code, message)
                } else {
                    write!(f, "HTTP error: {}", message)
                }
            }
            RouteMatchError::ConfigError { message } => {
                write!(f, "Configuration error: {}", message)
            }
            RouteMatchError::SpatialIndexError { message } => {
                write!(f, "Spatial index error: {}", message)
            }
            RouteMatchError::Internal { message } => {
                write!(f, "Internal error: {}", message)
            }
        }
    }
}

impl std::error::Error for RouteMatchError {}

/// Result type alias for route-matcher operations.
pub type Result<T> = std::result::Result<T, RouteMatchError>;

/// Extension trait for converting Option to RouteMatchError.
pub trait OptionExt<T> {
    /// Convert Option to Result with insufficient points error.
    fn ok_or_insufficient_points(
        self,
        activity_id: &str,
        point_count: usize,
        minimum: usize,
    ) -> Result<T>;

    /// Convert Option to Result with generic internal error.
    fn ok_or_internal(self, message: &str) -> Result<T>;
}

impl<T> OptionExt<T> for Option<T> {
    fn ok_or_insufficient_points(
        self,
        activity_id: &str,
        point_count: usize,
        minimum: usize,
    ) -> Result<T> {
        self.ok_or_else(|| RouteMatchError::InsufficientPoints {
            activity_id: activity_id.to_string(),
            point_count,
            minimum_required: minimum,
        })
    }

    fn ok_or_internal(self, message: &str) -> Result<T> {
        self.ok_or_else(|| RouteMatchError::Internal {
            message: message.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = RouteMatchError::InsufficientPoints {
            activity_id: "test-1".to_string(),
            point_count: 1,
            minimum_required: 2,
        };
        assert!(err.to_string().contains("test-1"));
        assert!(err.to_string().contains("1 points"));
    }

    #[test]
    fn test_option_ext() {
        let none: Option<i32> = None;
        let result = none.ok_or_insufficient_points("test", 0, 2);
        assert!(matches!(
            result,
            Err(RouteMatchError::InsufficientPoints { .. })
        ));
    }
}
