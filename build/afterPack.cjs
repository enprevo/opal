/**
 * electron-builder afterPack hook: keep only the ONNX Runtime binaries for the platform/arch being packaged
 * (onnxruntime-node ships every OS and CPU, ~290 MB).
 */
const fs = require('node:fs')
const path = require('node:path')

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

exports.default = async function afterPack(context) {
  const arch = ARCH[context.arch]
  const platform = context.electronPlatformName
  const resources = platform === 'darwin' ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources')
  const bin = path.join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
  if (!fs.existsSync(bin) || arch === 'universal') return
  for (const os of fs.readdirSync(bin)) {
    for (const cpu of fs.readdirSync(path.join(bin, os))) {
      const dir = path.join(bin, os, cpu)
      if (os !== platform || cpu !== arch) {
        fs.rmSync(dir, { recursive: true, force: true })
        continue
      }
      // GPU execution providers (CUDA/TensorRT, ~230 MB on Linux x64) are never used: Opal runs on the CPU.
      for (const f of fs.readdirSync(dir)) if (/providers_(cuda|tensorrt)/i.test(f)) fs.rmSync(path.join(dir, f), { force: true })
    }
  }
}
