// Guarda como PNG un fotograma de un vídeo (por defecto el primero, para alinearlo con su cuadro).
// Usa AVFoundation, que viene con macOS.
//
// Uso: swift tools/fotograma_video.swift video.mp4 fotograma.png [segundo]
import AVFoundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3 || args.count == 4 else {
    print("uso: fotograma_video.swift video.mp4 fotograma.png [segundo]")
    exit(1)
}
let instante = args.count == 4 ? CMTime(seconds: Double(args[3])!, preferredTimescale: 600) : .zero
let generador = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: args[1])))
generador.appliesPreferredTrackTransform = true
generador.requestedTimeToleranceBefore = .zero
generador.requestedTimeToleranceAfter = .zero
let imagen = try! generador.copyCGImage(at: instante, actualTime: nil)
let destino = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destino, imagen, nil)
CGImageDestinationFinalize(destino)
print("✓ \(imagen.width)×\(imagen.height)")
