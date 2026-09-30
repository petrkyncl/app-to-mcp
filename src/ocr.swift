import Foundation
import Vision
import ImageIO
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let source = CGImageSourceCreateWithData(data as CFData, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(1) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.automaticallyDetectsLanguage = true
try VNImageRequestHandler(cgImage: image).perform([request])
let output: [[String: Any]] = (request.results ?? []).compactMap { item in
  guard let candidate = item.topCandidates(1).first else { return nil }
  let b = item.boundingBox
  return ["text": candidate.string, "confidence": candidate.confidence, "bounds": [Int(b.minX * Double(image.width)), Int((1 - b.maxY) * Double(image.height)), Int(b.maxX * Double(image.width)), Int((1 - b.minY) * Double(image.height))]]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output))
