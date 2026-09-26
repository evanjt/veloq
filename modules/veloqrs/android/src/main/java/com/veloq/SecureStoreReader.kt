package com.veloq

import android.content.Context
import android.util.Log
import expo.modules.core.ModuleRegistry
import expo.modules.securestore.AuthenticationHelper
import expo.modules.securestore.SecureStoreModule
import expo.modules.securestore.SecureStoreOptions
import expo.modules.securestore.encryptors.AESEncryptor
import java.security.KeyStore
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

/**
 * The credential a cold-started worker has no other way to read.
 *
 * A data push wakes the process with no JavaScript in it, so nothing has called
 * `set_credentials_from_native` and the engine's credential slot is empty. The
 * token is in `expo-secure-store`, whose module cannot be constructed outside
 * the Expo module registry, so the worker goes to the same two places the
 * module goes: the shared preferences file holding the AES-GCM envelope, and
 * the keystore entry that decrypts it.
 *
 * The decryption itself is `expo-secure-store`'s own, so the format is pinned in
 * one place rather than reimplemented here. What this spells for itself is the
 * preferences file name and the entry key, both private to the module, which is
 * why `SecureStoreReaderTest` writes a value through the real module and reads
 * it back through this: a version bump that moves either fails there rather
 * than silently stopping push enrichment.
 *
 * Every failure answers null. A worker with no credential does nothing, which
 * is the correct outcome, rather than fetching unauthenticated.
 */
object SecureStoreReader {
  private const val TAG = "VeloqSecureStore"

  /** The module's own `SHARED_PREFERENCES_NAME`, which is private to it. */
  private const val SHARED_PREFERENCES_NAME = "SecureStore"

  /** The module's own `createKeychainAwareKey`, which is private to it. */
  private fun keychainAwareKey(key: String, keychainService: String) = "$keychainService-$key"

  /**
   * The value stored under `key`, or null when there is none, when the keystore
   * has no matching entry, or when the envelope will not decrypt.
   *
   * `keychainService` is the app's, and the app sets none on Android, so the
   * default is what its entries were written under.
   */
  @JvmStatic
  @JvmOverloads
  fun read(
    context: Context,
    key: String,
    keychainService: String = SecureStoreModule.DEFAULT_KEYSTORE_ALIAS
  ): String? {
    val prefs = context.getSharedPreferences(SHARED_PREFERENCES_NAME, Context.MODE_PRIVATE)
    // The keychain-aware key is what every current write uses; the bare key is
    // what an entry written by an older `expo-secure-store` sits under, and the
    // module still reads both.
    val envelope = prefs.getString(keychainAwareKey(key, keychainService), null)
      ?: prefs.getString(key, null)
      ?: return null

    return try {
      val item = JSONObject(envelope)
      val scheme = item.optString("scheme")
      if (scheme != AESEncryptor.NAME) {
        // The hybrid scheme is what Android below 23 wrote, which this app has
        // never supported. Nothing to do but say so.
        Log.w(TAG, "credential $key is stored under scheme $scheme, not ${AESEncryptor.NAME}")
        return null
      }

      val encryptor = AESEncryptor()
      val options = SecureStoreOptions(keychainService = keychainService)
      val usesKeystoreSuffix = item.optBoolean(SecureStoreModule.USES_KEYSTORE_SUFFIX_PROPERTY, false)
      val alias = if (usesKeystoreSuffix) {
        // Read requests never require authentication, and the unauthenticated
        // entry is the one the app's own writes created.
        encryptor.getExtendedKeyStoreAlias(options, false)
      } else {
        encryptor.getKeyStoreAlias(options)
      }

      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry ?: run {
        Log.w(TAG, "no keystore entry under $alias for $key")
        return null
      }

      // `decryptItem` is suspending only for the authentication prompt, which
      // an unauthenticated entry never opens: the helper hands the cipher back
      // untouched. The caller is an expedited worker already off the main
      // thread, so blocking here is the shape it expects.
      runBlocking {
        encryptor.decryptItem(
          key,
          item,
          entry,
          options,
          AuthenticationHelper(context, ModuleRegistry(emptyList(), emptyList()))
        )
      }
    } catch (e: Exception) {
      Log.w(TAG, "could not read credential $key: ${e.message}")
      null
    }
  }
}
