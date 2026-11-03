// Recodifica un vídeo a H.264 con la tasa de bits elegida (avconvert no deja elegirla), con el
// índice al principio para que el navegador pueda empezar a reproducirlo mientras se descarga.
// Usa AVFoundation, que viene con macOS.
//
// Uso: swift tools/recodificar_video.swift entrada.mp4 salida.mp4 [bits/s] [ancho] [alto]
//      swift tools/recodificar_video.swift ulises-kling.mp4 web/public/vivos/ulises-alta.mp4 4500000 1920 1080
import AVFoundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    print("uso: recodificar_video.swift entrada salida [bits/s] [ancho] [alto]")
    exit(1)
}
let entrada = URL(fileURLWithPath: args[1])
let destino = URL(fileURLWithPath: args[2])
// Se escribe en la carpeta temporal y luego se mueve: así no quedan copias intermedias junto
// al archivo final.
let salida = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
let bitrate = args.count > 3 ? Int(args[3])! : 4_500_000
let ancho = args.count > 4 ? Int(args[4])! : 1920
let alto = args.count > 5 ? Int(args[5])! : 1080

let asset = AVURLAsset(url: entrada)
let pista = asset.tracks(withMediaType: .video)[0]
let lector = try! AVAssetReader(asset: asset)
let leido = AVAssetReaderTrackOutput(track: pista, outputSettings: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
])
lector.add(leido)

try? FileManager.default.removeItem(at: salida)
let escritor = try! AVAssetWriter(outputURL: salida, fileType: .mp4)
escritor.shouldOptimizeForNetworkUse = true
let escrito = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: ancho,
    AVVideoHeightKey: alto,
    AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: 48,
    ],
])
escrito.expectsMediaDataInRealTime = false
escritor.add(escrito)

lector.startReading()
escritor.startWriting()
escritor.startSession(atSourceTime: .zero)
let hecho = DispatchSemaphore(value: 0)
escrito.requestMediaDataWhenReady(on: DispatchQueue(label: "recodificar")) {
    while escrito.isReadyForMoreMediaData {
        if let muestra = leido.copyNextSampleBuffer() {
            escrito.append(muestra)
        } else {
            escrito.markAsFinished()
            escritor.finishWriting { hecho.signal() }
            return
        }
    }
}
hecho.wait()
if escritor.status != .completed {
    print("error: \(String(describing: escritor.error))")
    exit(1)
}
try? FileManager.default.removeItem(at: destino)
try! FileManager.default.moveItem(at: salida, to: destino)
let tamano = (try? FileManager.default.attributesOfItem(atPath: destino.path)[.size] as? Int) ?? 0
print("✓ \(destino.lastPathComponent) · \(ancho)×\(alto) · \(bitrate / 1000) kb/s · \(tamano / 1024) KB")
