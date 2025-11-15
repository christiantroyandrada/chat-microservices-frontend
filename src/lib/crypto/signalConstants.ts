/**
 * Signal Protocol Constants
 *
 * Centralized configuration values for Signal Protocol implementation
 *
 * @module crypto/signalConstants
 */

/** Default device ID used for Signal Protocol addressing */
export const DEFAULT_DEVICE_ID = 1;

/** Default signed prekey ID */
export const DEFAULT_SIGNED_PREKEY_ID = 1;

/** Number of one-time prekeys to generate */
export const PREKEY_COUNT = 5;

/** Maximum prekey ID to scan when exporting keys */
export const MAX_PREKEY_SCAN = 100;

/** IndexedDB store name for Signal Protocol state */
export const STORE_NAME = 'state';

/** Database name prefix for user-specific isolation */
export const DB_NAME_PREFIX = 'signal-protocol-store-';
