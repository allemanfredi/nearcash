// Renders the NearCash iOS app icon: a 1024×1024 opaque PNG.
//
//   swift scripts/make-app-icon.swift ios/NearCashWallet/Assets.xcassets/AppIcon.appiconset/AppIcon.png
//
// Full-bleed artwork: iOS applies the rounded mask itself.
import AppKit

let outputPath = CommandLine.arguments.dropFirst().first ?? "AppIcon.png"
let pixels = 1024

// RGBX: an opaque 8-bit bitmap CoreGraphics can draw into. The PNG is saved
// without an alpha channel, as Apple requires for app icons.
guard let context = CGContext(
    data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("cannot create bitmap context") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)

let canvas = NSRect(x: 0, y: 0, width: pixels, height: pixels)

// Background: the app's banknote green, light top-left to dark bottom-right.
NSGradient(
    starting: NSColor(red: 0.16, green: 0.47, blue: 0.36, alpha: 1),
    ending: NSColor(red: 0.05, green: 0.24, blue: 0.18, alpha: 1)
)!.draw(in: canvas, angle: -45)

// A banknote card outline, ISO ID-1 proportions (85.60 × 53.98).
let cardWidth = 660.0
let cardHeight = cardWidth / (85.60 / 53.98)
let card = NSRect(x: (1024 - cardWidth) / 2, y: (1024 - cardHeight) / 2, width: cardWidth, height: cardHeight)
let outline = NSBezierPath(roundedRect: card, xRadius: 64, yRadius: 64)
outline.lineWidth = 30
NSColor.white.setStroke()
outline.stroke()

// NFC waves, centred on the card.
let configuration = NSImage.SymbolConfiguration(pointSize: 230, weight: .bold)
    .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
if let waves = NSImage(systemSymbolName: "wave.3.right", accessibilityDescription: nil)?
    .withSymbolConfiguration(configuration) {
    let size = waves.size
    waves.draw(in: NSRect(x: card.midX - size.width / 2, y: card.midY - size.height / 2,
                          width: size.width, height: size.height))
}

NSGraphicsContext.restoreGraphicsState()

guard let image = context.makeImage(),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
    fatalError("cannot encode PNG")
}
try png.write(to: URL(fileURLWithPath: outputPath))
print("wrote \(outputPath)")
