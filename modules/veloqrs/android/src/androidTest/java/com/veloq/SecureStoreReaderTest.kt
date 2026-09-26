package com.veloq

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.securestore.SecureStoreModule
import expo.modules.securestore.SecureStoreOptions
import expo.modules.securestore.encryptors.AESEncryptor
import java.security.KeyStore
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Scenario: a cold-started push worker reads the intervals.icu credential from
 * the store `expo-secure-store` wrote it to, spelling the preferences file and
 * the entry key itself because both are private to that module.
 *
 * Expected behaviour: a value written with the store's own encryptor reads back
 * through [SecureStoreReader], and the two spellings it pins are the ones the
 * module uses. An `expo-secure-store` bump that moves either fails here rather
 * than silently stopping push enrichment on every device.
 *
 * Runs on a device: the decryption goes through `AndroidKeyStore`, which has no
 * JVM stand-in.
 */
@RunWith(AndroidJUnit4::class)
class SecureStoreReaderTest {
  private val context: Context
    get() = InstrumentationRegistry.getInstrumentation().targetContext

  private val service = SecureStoreModule.DEFAULT_KEYSTORE_ALIAS

  /** The module's own `SHARED_PREFERENCES_NAME`, read off the class. */
  private fun storePreferencesName(): String {
    val field = SecureStoreModule::class.java.getDeclaredField("SHARED_PREFERENCES_NAME")
    field.isAccessible = true
    return field.get(null) as String
  }

  /** The module's own `createKeychainAwareKey`, called on the class. */
  private fun storeEntryKey(key: String): String {
    val method = SecureStoreModule::class.java
      .getDeclaredMethod("createKeychainAwareKey", String::class.java, String::class.java)
    method.isAccessible = true
    val module = SecureStoreModule()
    return method.invoke(module, key, service) as String
  }

  /**
   * One value in the store, written with the module's own encryptor and saved
   * the way `saveEncryptedItem` saves it.
   */
  private fun store(key: String, value: String) {
    val encryptor = AESEncryptor()
    val options = SecureStoreOptions(keychainService = service)
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val entry = encryptor.initializeKeyStoreEntry(keyStore, options)

    val item = runBlocking {
      encryptor.createEncryptedItem(value, entry, false, " ", authenticationHelper())
    }
    item.put("scheme", AESEncryptor.NAME)
    item.put(SecureStoreModule.USES_KEYSTORE_SUFFIX_PROPERTY, true)
    item.put("keystoreAlias", service)
    item.put("requireAuthentication", false)

    context
      .getSharedPreferences(storePreferencesName(), Context.MODE_PRIVATE)
      .edit()
      .putString(storeEntryKey(key), item.toString())
      .commit()
  }

  private fun authenticationHelper() =
    expo.modules.securestore.AuthenticationHelper(
      context,
      expo.modules.core.ModuleRegistry(emptyList(), emptyList())
    )

  @After
  fun clear() {
    context
      .getSharedPreferences(storePreferencesName(), Context.MODE_PRIVATE)
      .edit()
      .remove(storeEntryKey(KEY))
      .commit()
  }

  @Test
  fun the_reader_returns_what_the_stores_own_encryptor_wrote() {
    store(KEY, "a-token-only-the-keystore-can-read")

    assertEquals("a-token-only-the-keystore-can-read", SecureStoreReader.read(context, KEY))
  }

  @Test
  fun the_preferences_file_and_the_entry_key_are_the_ones_the_store_uses() {
    assertEquals("SecureStore", storePreferencesName())
    assertEquals("$service-$KEY", storeEntryKey(KEY))
  }

  @Test
  fun a_key_the_store_never_held_reads_as_nothing() {
    assertNull(SecureStoreReader.read(context, "intervals_nothing_wrote_this"))
  }

  @Test
  fun an_envelope_the_keystore_cannot_open_reads_as_nothing() {
    store(KEY, "a-token-only-the-keystore-can-read")
    val prefs = context.getSharedPreferences(storePreferencesName(), Context.MODE_PRIVATE)
    val tampered = JSONObject(prefs.getString(storeEntryKey(KEY), null)!!)
    tampered.put("ct", "bm90LWEtY2lwaGVydGV4dA==")
    prefs.edit().putString(storeEntryKey(KEY), tampered.toString()).commit()

    assertNull(SecureStoreReader.read(context, KEY))
  }

  private companion object {
    const val KEY = "intervals_api_key"
  }
}
