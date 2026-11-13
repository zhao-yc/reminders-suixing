package uts.sdk.modules.suixingLocal

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.nio.charset.StandardCharsets

object LocalFiles {
    private fun file(context: Context, key: String): AtomicFile {
        require(Regex("accounts|snapshot-(legacy-(cn|global)|[a-z0-9]{20,48})").matches(key))
        return AtomicFile(File(context.noBackupFilesDir, "suixing-reminders/$key.json"))
    }

    @Synchronized
    fun read(context: Context, key: String): String? = try {
        String(file(context, key).readFully(), StandardCharsets.UTF_8)
    } catch (_: FileNotFoundException) {
        null
    }

    /** AtomicFile 保留上次写入，直到新的 UTF-8 快照完整落盘。 */
    @Synchronized
    fun write(context: Context, key: String, value: String) {
        val target = file(context, key)
        val stream = target.startWrite()
        try {
            stream.write(value.toByteArray(StandardCharsets.UTF_8))
            stream.fd.sync()
            target.finishWrite(stream)
            check(target.baseFile.exists() && !File(target.baseFile.path + ".new").exists())
        } catch (error: Exception) {
            target.failWrite(stream)
            throw error
        }
    }

    @Synchronized
    fun remove(context: Context, key: String) {
        val target = file(context, key)
        target.delete()
        check(!target.baseFile.exists())
    }
}
