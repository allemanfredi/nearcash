// Renders NearCash's mark (apps/website/public/favicon.svg) as an opaque,
// square PNG: the iOS wallet's app icon and the kiosk's Home Screen icon.
//
//   swift scripts/make-app-icon.swift ios/NearCashWallet/Assets.xcassets/AppIcon.appiconset/AppIcon.png 1024
//   swift scripts/make-app-icon.swift apps/kiosk/public/apple-touch-icon.png 180
//
// Full-bleed artwork: iOS rounds the corners itself. The SVG's own rounded
// corners are drawn over a canvas already filled with the same green, so the
// PNG comes out a full green square, with no transparency (Apple requires it).
// macOS reads SVG files natively (NSImage, macOS 14 and later).
import AppKit

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 2, let pixels = Int(arguments[1]), pixels > 0 else {
    fatalError("usage: swift scripts/make-app-icon.swift <output.png> <pixels>")
}
let outputPath = arguments[0]

// The one drawing of the mark, found from this script's own place in the repo.
let markURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()                       // scripts/
    .appendingPathComponent("../apps/website/public/favicon.svg")
    .standardizedFileURL
guard let mark = NSImage(contentsOf: markURL) else {
    fatalError("cannot read \(markURL.path) (SVG needs macOS 14 or later)")
}

// RGBX: an opaque 8-bit bitmap CoreGraphics can draw into. The PNG is saved
// without an alpha channel.
guard let context = CGContext(
    data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("cannot create bitmap context") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)

let canvas = NSRect(x: 0, y: 0, width: pixels, height: pixels)

// NearCash green (#00EC97), the mark's background, under its rounded corners.
NSColor(srgbRed: 0x00 / 255.0, green: 0xEC / 255.0, blue: 0x97 / 255.0, alpha: 1).setFill()
canvas.fill()

// The mark, scaled from its 64-unit square to the whole canvas.
mark.draw(in: canvas)

NSGraphicsContext.restoreGraphicsState()

guard let image = context.makeImage(),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
    fatalError("cannot encode PNG")
}
try png.write(to: URL(fileURLWithPath: outputPath))
print("wrote \(outputPath) (\(pixels) × \(pixels))")
