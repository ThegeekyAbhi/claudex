// macOS-only asset preparation; no Swift runtime is needed by the extension.
// Usage: swift scripts/assemble-mascot.swift OUTPUT_DIR state=SOURCE.png ...
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

enum AssetError: Error {
    case invalid(String)
}

let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue

func context(width: Int, height: Int) throws -> CGContext {
    guard let result = CGContext(data: nil, width: width, height: height,
                                 bitsPerComponent: 8, bytesPerRow: width * 4,
                                 space: colorSpace, bitmapInfo: bitmapInfo) else {
        throw AssetError.invalid("Cannot allocate image context")
    }
    return result
}

func load(_ path: String) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw AssetError.invalid("Cannot load \(path)")
    }
    return image
}

// Determine the main character's bounds, excluding isolated generation speckles.
func characterBounds(_ image: CGImage) throws -> CGRect {
    let width = image.width
    let height = image.height
    let bitmap = try context(width: width, height: height)
    bitmap.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let data = bitmap.data else { throw AssetError.invalid("No pixel data") }
    let pixels = data.assumingMemoryBound(to: UInt8.self)
    let transparent = (0..<(width * height)).filter { pixels[$0 * 4 + 3] == 0 }.count
    guard Double(transparent) / Double(width * height) > 0.15 else {
        throw AssetError.invalid("Sheet has an opaque background")
    }
    var visited = [Bool](repeating: false, count: width * height)
    var bestCount = 0
    var bestBounds = CGRect.null
    for start in 0..<(width * height) where !visited[start] && pixels[start * 4 + 3] > 64 {
        var queue = [start]
        visited[start] = true
        var position = 0
        var minX = width
        var minY = height
        var maxX = 0
        var maxY = 0
        while position < queue.count {
            let pixel = queue[position]
            position += 1
            let x = pixel % width
            let y = pixel / width
            minX = min(minX, x); maxX = max(maxX, x)
            minY = min(minY, y); maxY = max(maxY, y)
            for (nx, ny) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
                guard nx >= 0, nx < width, ny >= 0, ny < height else { continue }
                let neighbor = ny * width + nx
                if !visited[neighbor], pixels[neighbor * 4 + 3] > 64 {
                    visited[neighbor] = true
                    queue.append(neighbor)
                }
            }
        }
        if queue.count > bestCount {
            bestCount = queue.count
            bestBounds = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
        }
    }
    guard !bestBounds.isNull else { throw AssetError.invalid("No character found") }
    // Bitmap memory and CGImage cropping both use image row order here.
    return bestBounds
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw AssetError.invalid("Cannot create \(url.lastPathComponent)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw AssetError.invalid("PNG export failed") }
}

func writeGIF(_ frames: [CGImage], to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, frames.count, nil) else {
        throw AssetError.invalid("Cannot create GIF")
    }
    CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
    for frame in frames {
        CGImageDestinationAddImage(destination, frame, [kCGImagePropertyGIFDictionary: [
            kCGImagePropertyGIFDelayTime: 0.15,
            kCGImagePropertyGIFUnclampedDelayTime: 0.15,
        ]] as CFDictionary)
    }
    guard CGImageDestinationFinalize(destination) else { throw AssetError.invalid("GIF export failed") }
    // Full transparent frames must clear before the next frame rather than leave trails.
    var bytes = [UInt8](try Data(contentsOf: url))
    var offset = 13
    if bytes[10] & 0x80 != 0 { offset += 3 * (1 << (Int(bytes[10] & 7) + 1)) }
    func skipBlocks(_ start: Int) throws -> Int {
        var cursor = start
        while cursor < bytes.count {
            let count = Int(bytes[cursor]); cursor += 1
            if count == 0 { return cursor }
            cursor += count
        }
        throw AssetError.invalid("Truncated GIF")
    }
    while offset < bytes.count {
        switch bytes[offset] {
        case 0x21:
            guard offset + 2 < bytes.count else { throw AssetError.invalid("Truncated extension") }
            if bytes[offset + 1] == 0xF9 { bytes[offset + 3] = (bytes[offset + 3] & 0xE3) | 0x08 }
            offset = try skipBlocks(offset + 2)
        case 0x2C:
            guard offset + 9 < bytes.count else { throw AssetError.invalid("Truncated frame") }
            let packed = bytes[offset + 9]
            offset += 10
            if packed & 0x80 != 0 { offset += 3 * (1 << (Int(packed & 7) + 1)) }
            offset = try skipBlocks(offset + 1)
        case 0x3B: offset = bytes.count
        default: throw AssetError.invalid("Invalid GIF block")
        }
    }
    try Data(bytes).write(to: url)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) == 8 else {
        throw AssetError.invalid("GIF must contain eight frames")
    }
}

guard [7, 8].contains(CommandLine.arguments.count) else {
    throw AssetError.invalid("Usage: swift scripts/assemble-mascot.swift OUTPUT_DIR working=PATH thinking=PATH planning=PATH coding=PATH reading=PATH [REFERENCE.png]")
}
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
var sources: [(name: String, frames: [CGImage])] = []
var sharedBounds = CGRect.null
for argument in CommandLine.arguments.dropFirst(2).prefix(5) {
    let parts = argument.split(separator: "=", maxSplits: 1).map(String.init)
    guard parts.count == 2 else { throw AssetError.invalid("Expected state=path") }
    let sheet = try load(parts[1])
    var frames: [CGImage] = []
    for index in 0..<8 {
        let left = (index % 4) * sheet.width / 4
        let top = (index / 4) * sheet.height / 2
        let right = ((index % 4) + 1) * sheet.width / 4
        let bottom = ((index / 4) + 1) * sheet.height / 2
        guard let frame = sheet.cropping(to: CGRect(x: left, y: top, width: right - left, height: bottom - top)) else {
            throw AssetError.invalid("Cannot crop frame")
        }
        sharedBounds = sharedBounds.union(try characterBounds(frame))
        frames.append(frame)
    }
    sources.append((parts[0], frames))
}
sharedBounds = sharedBounds.insetBy(dx: -4, dy: -4).integral
let scale = min(112 / sharedBounds.width, 112 / sharedBounds.height)
for source in sources {
    var frames: [CGImage] = []
    for frame in source.frames {
        guard let cropped = frame.cropping(to: sharedBounds) else { throw AssetError.invalid("Cannot normalize frame") }
        let bitmap = try context(width: 128, height: 128)
        bitmap.interpolationQuality = .none
        let size = CGSize(width: sharedBounds.width * scale, height: sharedBounds.height * scale)
        bitmap.draw(cropped, in: CGRect(x: (128 - size.width) / 2, y: (128 - size.height) / 2, width: size.width, height: size.height))
        guard let image = bitmap.makeImage() else { throw AssetError.invalid("Cannot render frame") }
        frames.append(image)
    }
    let strip = try context(width: 1024, height: 128)
    for (index, frame) in frames.enumerated() { strip.draw(frame, in: CGRect(x: index * 128, y: 0, width: 128, height: 128)) }
    guard let stripImage = strip.makeImage() else { throw AssetError.invalid("Cannot render strip") }
    try writePNG(stripImage, to: output.appendingPathComponent("\(source.name).png"))
    try writeGIF(frames, to: output.appendingPathComponent("\(source.name).gif"))
    if source.name == "working" {
        try writePNG(frames[0], to: output.appendingPathComponent("attentive.png"))
        try writePNG(frames[0], to: output.appendingPathComponent("icon.png"))
    }
    print("Exported \(source.name): 1024×128 PNG, 128×128 GIF, 8 frames × 0.15 seconds")
}

// Use the user-supplied character itself for branding and non-animated waits.
if CommandLine.arguments.count == 8 {
    let reference = try load(CommandLine.arguments[7])
    let bounds = try characterBounds(reference)
    guard let cropped = reference.cropping(to: bounds) else { throw AssetError.invalid("Cannot crop reference") }
    let bitmap = try context(width: 128, height: 128)
    bitmap.interpolationQuality = .none
    let scale = min(112 / bounds.width, 112 / bounds.height)
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    bitmap.draw(cropped, in: CGRect(x: (128 - size.width) / 2, y: (128 - size.height) / 2, width: size.width, height: size.height))
    guard let image = bitmap.makeImage() else { throw AssetError.invalid("Cannot render reference") }
    try writePNG(image, to: output.appendingPathComponent("icon.png"))
    try writePNG(image, to: output.appendingPathComponent("attentive.png"))
}
