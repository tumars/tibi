// Android 上 API Key / WebDAV 密码再加一层加密（keys.rs 的 file_store）：AndroidKeyStore 里的 AES-256-GCM 密钥（不出系统），
// secrets.json 里只存密文（"ks1:" + base64(iv ‖ 密文)）。壳里的小插件 tibi-keystore 经 register_android_plugin 注册（lib.rs）。
// 手写的文件，不是 tauri android init 生成的；重新 init 时要保留。
package app.tibi

import android.app.Activity
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
class KeystoreTextArgs {
  lateinit var text: String
}

@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
  private val alias = "tibi.secrets"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  @Command
  fun encrypt(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(KeystoreTextArgs::class.java)
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.ENCRYPT_MODE, key())
      val out = c.iv + c.doFinal(args.text.toByteArray(Charsets.UTF_8))
      val ret = JSObject()
      ret.put("text", Base64.encodeToString(out, Base64.NO_WRAP))
      invoke.resolve(ret)
    } catch (e: Exception) {
      invoke.reject("加密失败：${e.message}")
    }
  }

  @Command
  fun decrypt(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(KeystoreTextArgs::class.java)
      val raw = Base64.decode(args.text, Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
      val ret = JSObject()
      ret.put("text", String(c.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8))
      invoke.resolve(ret)
    } catch (e: Exception) {
      invoke.reject("解密失败：${e.message}")
    }
  }
}
