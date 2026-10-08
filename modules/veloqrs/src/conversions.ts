/**
 * Point conversions, validators, and shared types for the veloqrs module.
 */

import type { FfiDetectionProgress } from './generated/veloqrs';

/**
 * Progress state for section detection.
 * Alias for the generated FfiDetectionProgress type.
 */
export type SectionDetectionProgress = FfiDetectionProgress;

/**
 * Maximum allowed length for user-provided names (route names, section names).
 */
const MAX_NAME_LENGTH = 255;

/**
 * Regular expression to detect control characters (except common whitespace).
 * Allows: space, tab, newline, carriage return
 * Blocks: null, bell, backspace, form feed, vertical tab, escape, etc.
 */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Validate a user-provided name string.
 * Throws an error if the name is invalid.
 */
export function validateName(name: string, fieldName: string): void {
  if (typeof name !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_REGEX.test(name)) {
    throw new Error(`Invalid ${fieldName}: contains disallowed control characters`);
  }
}

/**
 * Validate a user-provided ID string.
 * Throws an error if the ID is invalid.
 */
export function validateId(id: string, fieldName: string): void {
  if (typeof id !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (id.length === 0) {
    throw new Error(`Invalid ${fieldName}: cannot be empty`);
  }
  if (id.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${fieldName}: exceeds maximum length of ${MAX_NAME_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_REGEX.test(id)) {
    throw new Error(`Invalid ${fieldName}: contains disallowed control characters`);
  }
}
